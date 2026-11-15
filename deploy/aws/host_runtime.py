#!/usr/bin/env python3
"""Operações no host EC2. Segredos transitam por memória/stdin, sem shell ou logs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tarfile
import time
import urllib.parse
import urllib.request

ROOT = Path("/opt/firecal")
CONFIG = Path("/etc/firecal/config.json")
ENV = Path("/etc/firecal/backend.env")
CA = ROOT / "rds-ca.pem"


def run(command, *, payload=None, capture=False, environment=None):
    result = subprocess.run(command, input=payload, text=True, env=environment,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None)
    if result.returncode:
        # Erros do SDK podem incluir argumentos sensíveis. Identifica só o programa.
        raise RuntimeError(f"{command[0]} falhou (código {result.returncode}); consulte os logs sem exibir segredos.")
    return result.stdout if capture else None


def aws(config, *arguments, payload=None):
    result = run(["aws", "--region", config["region"], "--output", "json", *arguments],
                 payload=json.dumps(payload) if payload is not None else None, capture=True)
    return json.loads(result) if result.strip() else None


def write_private(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".new")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(content)
    temporary.replace(path)


def public_ip():
    request = urllib.request.Request("http://169.254.169.254/latest/api/token", method="PUT",
                                     headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"})
    with urllib.request.urlopen(request, timeout=10) as response:
        token = response.read().decode()
    request = urllib.request.Request("http://169.254.169.254/latest/meta-data/public-ipv4",
                                     headers={"X-aws-ec2-metadata-token": token})
    with urllib.request.urlopen(request, timeout=10) as response:
        return response.read().decode().strip()


def duckdns(config, wait=False):
    address = public_ip()
    automatic = config.get("duckdns_auto_update", False)
    if automatic:
        token = aws(config, "ssm", "get-parameter", "--name", config["duckdns_parameter"],
                    "--with-decryption")["Parameter"]["Value"]
        query = urllib.parse.urlencode({"domains": config["domain"].removesuffix(".duckdns.org"),
                                       "token": token, "ip": address})
        # Nunca registrar URL ou exceção contendo a URL.
        try:
            with urllib.request.urlopen("https://www.duckdns.org/update?" + query, timeout=30) as response:
                answer = response.read().decode().strip()
        except Exception:
            raise RuntimeError("Falha ao chamar DuckDNS; confira o parâmetro SSM e a conectividade.") from None
        if answer != "OK":
            raise RuntimeError("DuckDNS recusou a atualização. Confira domínio e token no SSM.")
    if wait:
        for _ in range(60):
            try:
                if address in socket.gethostbyname_ex(config["domain"])[2]:
                    break
            except OSError:
                pass
            time.sleep(5)
        else:
            raise RuntimeError("DNS ainda não aponta ao IP da EC2. Aguarde a propagação e repita.")
    print("Registro DuckDNS atualizado." if automatic else f"DNS manual conferido: {config['domain']} → {address}.", flush=True)


def extract_source(archive, destination):
    with tarfile.open(archive, "r:gz") as source:
        for member in source.getmembers():
            if not (member.isfile() or member.isdir()):
                raise RuntimeError("Release contém link ou arquivo especial.")
            if not (destination / member.name).resolve().is_relative_to(destination.resolve()):
                raise RuntimeError("Caminho inválido na release.")
        source.extractall(destination, filter="data")
    public_tree(destination)


def public_tree(directory):
    """Fontes científicas/código são legíveis pelo UID da API; segredos ficam fora."""
    for root, dirs, files in os.walk(directory, followlinks=False):
        Path(root).chmod(0o755)
        for name in files:
            path = Path(root) / name
            if not path.is_symlink():
                path.chmod(0o644)


def compose(release, *arguments):
    return run(["docker", "compose", "--env-file", str(release / "release.env"), "-f",
                str(release / "deploy/aws/compose.yml"), *arguments])


def install_prepared(config, manifest):
    artifact = manifest.get("prepared")
    if not artifact:
        raise RuntimeError("O perfil econômico requer índices preparados localmente.")
    archive = ROOT / "prepared.tar.gz"
    run(["aws", "--region", config["region"], "s3", "cp",
         f"s3://{config['artifact_bucket']}/{artifact['key']}", str(archive), "--only-show-errors"])
    with archive.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != artifact["sha256"]:
            raise RuntimeError("SHA-256 dos índices divergente.")
    staging = ROOT / "prepared-staging"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir()
    extract_source(archive, staging)
    scientific = ROOT / "data/global_1km_2000_2025"
    inventory = json.loads((staging / "source_inventory.json").read_text())
    if len(inventory) != 48:
        raise RuntimeError("O manifesto precisa dos 48 Parquet regionais.")
    for entry in inventory:
        path = scientific / entry["name"]
        if not path.resolve().is_relative_to((scientific / "parquet_025deg").resolve()):
            raise RuntimeError("Caminho inesperado no manifesto de fontes.")
        if path.stat().st_size != entry["size"]:
            raise RuntimeError("Tamanho da fonte incompatível com os índices.")
        with path.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != entry["sha256"]:
                raise RuntimeError("Conteúdo da fonte incompatível com os índices.")
        # Só normaliza metadata da cópia EC2 após verificar conteúdo integral.
        os.utime(path, ns=(path.stat().st_atime_ns, entry["mtime_ns"]))
    cache = scientific / "web_v2"
    cache.mkdir(exist_ok=True)
    for relative in ("exploration.sqlite", "f2/weekly.sqlite"):
        target = cache / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        (staging / "web_v2" / relative).replace(target)
        for suffix in ("-wal", "-shm"):
            Path(str(target) + suffix).unlink(missing_ok=True)
    responses = staging / "web_v2/f2/responses"
    if responses.is_dir():
        shutil.copytree(responses, cache / "f2/responses", dirs_exist_ok=True)
    shutil.rmtree(staging)
    archive.unlink()


def _preserved_env_lines():
    preserved = []
    for candidate in (ENV, Path("/etc/firecal/.env"), ROOT / ".env"):
        if candidate.is_file():
            try:
                for line in candidate.read_text(encoding="utf-8").splitlines():
                    stripped = line.strip()
                    if stripped.startswith(("GROQ_API_KEY=", "GROK_API_KEY=", "GROQ_MODEL=", "GROQ_FALLBACK_MODEL=")):
                        if stripped not in preserved:
                            preserved.append(stripped)
            except OSError:
                pass
    return preserved


def credentials(config, release):
    extra = _preserved_env_lines()
    if config.get("analytics_storage", "sqlite") == "sqlite":
        write_private(ENV, "\n".join([
            "FIRE_STORAGE=parquet", "FIRE_ANALYTICS_STORAGE=sqlite",
            "FIRE_DATA_DIR=/data/global_1km_2000_2025", "CORS_ORIGINS=https://" + config["domain"], *extra, ""]))
        return
    master = json.loads(aws(config, "secretsmanager", "get-secret-value",
                            "--secret-id", config["db_master_secret_arn"])["SecretString"])
    existing = aws(config, "secretsmanager", "describe-secret", "--secret-id", config["db_app_secret_arn"])
    # O container do segredo existe desde Terraform, inicialmente sem versão.
    if existing.get("VersionIdsToStages"):
        app = json.loads(aws(config, "secretsmanager", "get-secret-value",
                             "--secret-id", config["db_app_secret_arn"])["SecretString"])
        password = app["password"]
    else:
        password = secrets.token_urlsafe(36)
    payload = dict(host=config["db_host"], port=config["db_port"], dbname=config["db_name"],
                   username=config["db_username"], password=password,
                   master_username=master["username"], master_password=master["password"])
    release_id = release.name
    run(["docker", "run", "--rm", "-i", "--read-only", "--cap-drop=ALL",
         "--security-opt=no-new-privileges", "-v", f"{CA}:/run/firecal/rds-ca.pem:ro",
         f"firecal-api:{release_id}", "python", "ops/bootstrap_database.py"], payload=json.dumps(payload))
    if not existing.get("VersionIdsToStages"):
        aws(config, "secretsmanager", "put-secret-value", "--cli-input-json", "file:///dev/stdin",
            payload={"SecretId": config["db_app_secret_arn"], "SecretString": json.dumps({
                "username": config["db_username"], "password": password})})
    user = urllib.parse.quote(config["db_username"], safe="")
    password_encoded = urllib.parse.quote(password, safe="")
    suffix = f"{user}:{password_encoded}@{config['db_host']}:{config['db_port']}/{config['db_name']}?sslmode=verify-full&sslrootcert=/run/firecal/rds-ca.pem"
    write_private(ENV, "\n".join([
        "FIRE_STORAGE=parquet", "FIRE_ANALYTICS_STORAGE=postgres",
        "ANALYTICS_DATABASE_URL=postgresql://" + suffix,
        "DATABASE_URL=postgresql+psycopg://" + suffix,
        "FIRE_DATA_DIR=/data/global_1km_2000_2025", "CORS_ORIGINS=https://" + config["domain"], *extra, ""]))


def deploy(config):
    if not os.path.ismount(ROOT):
        raise RuntimeError("EBS não está montado em /opt/firecal; publicação interrompida.")
    bucket = config["artifact_bucket"]
    manifest = aws(config, "s3api", "get-object", "--bucket", bucket,
                   "--key", "releases/current.json", str(ROOT / "manifest.json"))
    manifest = json.loads((ROOT / "manifest.json").read_text())
    release_id = manifest["release_id"]
    if not release_id or any(c not in "0123456789abcdefghijklmnopqrstuvwxyz-" for c in release_id):
        raise RuntimeError("Identificador de release inválido.")
    release = ROOT / "releases" / release_id
    if not release.exists():
        archive = ROOT / f"{release_id}.tar.gz"
        run(["aws", "--region", config["region"], "s3", "cp",
             f"s3://{bucket}/{manifest['source_key']}", str(archive), "--only-show-errors"])
        with archive.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != manifest["sha256"]:
            raise RuntimeError("SHA-256 da release divergente.")
        staging = release.with_name(release.name + ".staging")
        if staging.exists():
            shutil.rmtree(staging)  # Somente nossa extração derivada incompleta.
        staging.mkdir(parents=True)
        extract_source(archive, staging)
        staging.rename(release)
        archive.unlink()
    print(f"Preparando release {release_id}.", flush=True)
    run(["aws", "--region", config["region"], "s3", "sync", f"s3://{bucket}/data/",
         str(ROOT / "data"), "--only-show-errors"])
    public_tree(ROOT / "data")
    # Interrompe apenas a API FireCal antes de trocar o snapshot e arquivos WAL.
    current = ROOT / "current"
    if current.exists():
        compose(current.resolve(), "stop", "api")
    install_prepared(config, manifest)
    cache = ROOT / "data/global_1km_2000_2025/web_v2"
    (cache / "tmp").mkdir(parents=True, exist_ok=True)
    for root, dirs, files in os.walk(cache):
        os.chown(root, 10001, 10001)
        for name in files:
            os.chown(Path(root) / name, 10001, 10001)
    # O perfil SQLite não acessa RDS nem solicita senhas no Secrets Manager.
    if config.get("analytics_storage", "sqlite") == "postgres":
        with urllib.request.urlopen("https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem", timeout=60) as response:
            CA.write_bytes(response.read())
    else:
        CA.touch(exist_ok=True)
    CA.chmod(0o644)
    write_private(release / "release.env", f"RELEASE_ID={release_id}\nDOMAIN={config['domain']}\n")
    # Compose exige o env_file antes do build; ainda não inicia os serviços.
    if not ENV.exists():
        write_private(ENV, "FIRE_STORAGE=parquet\n")
    images = manifest.get("images", {})
    if images:
        for name, artifact in images.items():
            if name not in {"api", "web"}:
                raise RuntimeError("Imagem desconhecida no manifesto.")
            target = ROOT / f"{release_id}-{name}.tar.gz"
            run(["aws", "--region", config["region"], "s3", "cp",
                 f"s3://{bucket}/{artifact['key']}", str(target), "--only-show-errors"])
            with target.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != artifact["sha256"]:
                    raise RuntimeError("SHA-256 da imagem divergente.")
            run(["docker", "load", "--input", str(target)])
            target.unlink()
    elif manifest.get("build_on_host") is True:
        compose(release, "build")
    else:
        raise RuntimeError("A release precisa de imagens pré-construídas para o perfil econômico.")
    credentials(config, release)
    print("Conferindo índices preparados localmente; sem reconstrução na EC2 micro.", flush=True)
    compose(release, "run", "--rm", "--no-deps", "-T", "-e", "FIRE_ANALYTICS_STORAGE=sqlite", "api",
            "python", "-c", "from app.exploration import status; from app.forecast_selection import cache_ready; assert status()['ready']; assert cache_ready(), 'Cache F2 incompatível'")
    if config.get("analytics_storage", "sqlite") == "postgres":
        migration = ["run", "--rm", "--no-deps", "-T", "api", "python", "-m", "app.migrate_analytics",
                     "--source", "/data/global_1km_2000_2025/web_v2/exploration.sqlite"]
        if manifest.get("replace_analytics") is True:
            migration.append("--replace")
        compose(release, *migration)
    else:
        # Backup consistente por API SQLite, incluindo WAL confirmado. Só derivados.
        compose(release, "run", "--rm", "--no-deps", "-T", "api", "python", "-c",
                "import sqlite3; from pathlib import Path; p=Path('/data/global_1km_2000_2025/web_v2'); "
                "a=sqlite3.connect((p/'exploration.sqlite').as_uri()+'?mode=ro',uri=True); "
                "b=sqlite3.connect(p/'exploration.backup.sqlite'); a.backup(b); b.close(); a.close()")
        run(["aws", "--region", config["region"], "s3", "cp", str(cache / "exploration.backup.sqlite"),
             f"s3://{bucket}/backups/exploration.sqlite", "--only-show-errors"])
        (cache / "exploration.backup.sqlite").unlink()
    duckdns(config, wait=True)
    compose(release, "up", "-d", "--wait", "--wait-timeout", "240")
    # HTTPS só é declarado pronto após emissão do certificado e resposta do backend.
    for attempt in range(36):
        try:
            with urllib.request.urlopen(f"https://{config['domain']}/api/explore/status", timeout=20) as response:
                status = json.load(response)
                if status.get("ready") or status.get("status") == "ready":
                    break
        except Exception:
            pass
        time.sleep(5)
    else:
        raise RuntimeError("Serviços iniciados, mas a verificação HTTPS/banco não concluiu. Consulte os logs.")
    link = ROOT / "current.new"
    link.unlink(missing_ok=True)
    link.symlink_to(release)
    link.replace(ROOT / "current")
    print(f"Sistema disponível em https://{config['domain']} (release {release_id}).", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("deploy", "duckdns"))
    args = parser.parse_args()
    config = json.loads(CONFIG.read_text())
    identity = aws(config, "sts", "get-caller-identity")
    if identity["Account"] != config["expected_account_id"]:
        raise RuntimeError("Conta AWS inesperada; operação interrompida.")
    if args.action == "deploy":
        deploy(config)
    else:
        duckdns(config)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # HTTPError pode conter URL com token. Não imprimir erros desconhecidos.
        message = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print("Falha: " + message, file=sys.stderr)
        raise SystemExit(1)
