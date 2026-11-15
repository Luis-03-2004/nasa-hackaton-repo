#!/usr/bin/env python3
"""Empacota código, publica fontes no S3 e solicita o deploy via SSM."""
import argparse
from datetime import datetime, timezone
import hashlib
import gzip
import json
from pathlib import Path
import tarfile
import subprocess
import sqlite3
import sys
import os
import shutil

from common import INFRA, REPO, aws, command, config_from_terraform, verify_account

EXCLUDED_PARTS = {".git", ".aws", ".venv", "node_modules", "__pycache__", "dist", ".terraform", "tests", ".pytest_cache"}
EXCLUDED_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".tfvars", ".tfstate", ".tfplan", ".pyc", ".log", ".sqlite", ".db"}
SOURCES = ("backend", "frontend", "deploy/aws", ".dockerignore")
DATA_DIRS = ("parquet_1km", "parquet_025deg", "previsao_mapa_mundi", "experimento_2000_2025")
CALENDAR = "entrega_drive_equipe/02_calendario_harmonizado_mensal_2000_2025.csv"


def included(relative):
    return (not any(p in EXCLUDED_PARTS or p.startswith(".env") for p in relative.parts)
            and relative.suffix not in EXCLUDED_SUFFIXES)


def package(source=REPO, output=None):
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    destination = output or INFRA / ".release"
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / f"source-{stamp}.tar.gz"
    with tarfile.open(archive, "w:gz", dereference=False) as stream:
        for name in SOURCES:
            root = source / name
            paths = sorted(root.rglob("*")) if root.is_dir() else [root]
            for path in paths:
                relative = path.relative_to(source)
                if included(relative) and path.is_file() and not path.is_symlink():
                    stream.add(path, arcname=str(relative), recursive=False)
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    release_id = f"{stamp}-{digest[:12]}"
    return archive, {"release_id": release_id, "sha256": digest,
                     "source_key": f"releases/{release_id}/source.tar.gz"}


def data_inventory(data):
    global_root = data / "global_1km_2000_2025"
    paths = []
    for directory in DATA_DIRS:
        root = global_root / directory
        entries = sorted(p for p in root.rglob("*") if p.is_file() and p.suffix in {".parquet", ".json", ".csv"})
        if not entries:
            raise RuntimeError(f"Fonte obrigatória ausente: {root}")
        if directory in {"parquet_1km", "parquet_025deg"} and len([p for p in entries if p.suffix == ".parquet"]) != 48:
            raise RuntimeError(f"Esperados 48 Parquet em {root}; confira a base antes de publicar.")
        paths.extend(entries)
    calendar = global_root / CALENDAR
    if not calendar.is_file():
        raise RuntimeError(f"Calendário obrigatório ausente: {calendar}")
    paths.append(calendar)
    for sensor in ("modis", "viirs-snpp", "viirs-jpss1"):
        sources = sorted((data / sensor).glob("*_all_countries.zip"))
        expected = {"modis": 26, "viirs-snpp": 14, "viirs-jpss1": 8}[sensor]
        if len(sources) != expected:
            raise RuntimeError(f"Esperados {expected} ZIPs originais em {data / sensor}; necessários ao histórico diário.")
        paths.extend(sources)
    if any(p.is_symlink() or not p.resolve().is_relative_to(data.resolve()) for p in paths):
        raise RuntimeError("Fonte contém link externo; confira os caminhos.")
    return paths


def upload_data(config, profile, data):
    # Prefixos/formatos explícitos e sync incremental: repetições preservam timestamps
    # remotos e não invalidam o cubo quando os arquivos permanecem iguais.
    groups = [(data / "global_1km_2000_2025" / name, ["*.parquet", "*.json", "*.csv"]) for name in DATA_DIRS]
    groups.append((data / "global_1km_2000_2025/entrega_drive_equipe", [Path(CALENDAR).name]))
    groups.extend((data / sensor, ["*_all_countries.zip"]) for sensor in ("modis", "viirs-snpp", "viirs-jpss1"))
    for directory, patterns in groups:
        print(f"Sincronizando fontes: {directory.relative_to(data)}", flush=True)
        arguments = ["aws", "--profile", profile, "--region", config["region"], "s3", "sync", directory,
                     f"s3://{config['artifact_bucket']}/data/{directory.relative_to(data).as_posix()}/",
                     "--no-follow-symlinks", "--exclude", "*"]
        for pattern in patterns:
            arguments.extend(["--include", pattern])
        command([*arguments, "--only-show-errors"])
        print(f"Fontes sincronizadas: {directory.relative_to(data)}", flush=True)
    expected = {path.relative_to(data).as_posix(): path for path in data_inventory(data)}
    listed = aws(config, profile, "s3api", "list-objects-v2", "--bucket", config["artifact_bucket"], "--prefix", "data/")
    remote = {item["Key"].removeprefix("data/"): item["Size"] for item in listed.get("Contents", [])}
    for key, path in expected.items():
        if remote.get(key) != path.stat().st_size:
            print(f"Conferindo transferência individual: {key}", flush=True)
            command(["aws", "--profile", profile, "--region", config["region"], "s3", "cp", path,
                     f"s3://{config['artifact_bucket']}/data/{key}", "--only-show-errors"])


def build_images(manifest):
    artifacts = {}
    for name in ("api", "web"):
        tag = f"firecal-{name}:{manifest['release_id']}"
        command(["docker", "build", "--platform", "linux/amd64", "-f", REPO / f"deploy/aws/Dockerfile.{name}", "-t", tag, REPO])
        target = INFRA / ".release" / f"{manifest['release_id']}-{name}.tar.gz"
        with target.open("wb") as output:
            process = subprocess.Popen(["docker", "save", tag], stdout=subprocess.PIPE)
            try:
                with gzip.GzipFile(fileobj=output, mode="wb", compresslevel=1) as compressed:
                    while chunk := process.stdout.read(1024 * 1024):
                        compressed.write(chunk)
            finally:
                process.stdout.close()
            if process.wait():
                raise RuntimeError("Falha ao exportar a imagem Docker local.")
        with target.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        artifacts[name] = {"key": f"releases/{manifest['release_id']}/{name}.tar.gz", "sha256": digest}
    return artifacts


def prepare_caches(data, manifest):
    """Prepara no computador local e publica snapshots consistentes para a micro."""
    scientific = data.resolve() / "global_1km_2000_2025"
    environment = {**os.environ, "PYTHONPATH": str(REPO / "backend"), "FIRE_DATA_DIR": str(scientific), "FIRE_ANALYTICS_STORAGE": "sqlite"}
    preparation = subprocess.run([sys.executable, "-c",
        "import pyarrow as pa; pa.set_cpu_count(2); pa.set_io_thread_count(2); "
        "from app.exploration import build_cube, status; from app.forecast_selection import build_cache, forecast_selection; "
        "build_cube(); assert status()['ready']; build_cache(); forecast_selection(reference_date='2025-12-22')"], env=environment)
    if preparation.returncode:
        raise RuntimeError("Falha na preparação local dos índices; não publicar caches incompletos.")
    staging = INFRA / ".release" / manifest["release_id"]
    staging.mkdir(parents=True, exist_ok=True)
    inventory = []
    for path in sorted((scientific / "parquet_025deg").glob("*/*.parquet")):
        stat = path.stat()
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        inventory.append({"name": str(path.relative_to(scientific)), "size": stat.st_size,
                          "mtime_ns": stat.st_mtime_ns, "sha256": digest})
    for relative in ("exploration.sqlite", "f2/weekly.sqlite"):
        source = scientific / "web_v2" / relative
        target = staging / "web_v2" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as origin, sqlite3.connect(target) as destination:
            origin.backup(destination, pages=4096)
    responses = scientific / "web_v2/f2/responses"
    if responses.is_dir():
        shutil.copytree(responses, staging / "web_v2/f2/responses", dirs_exist_ok=True)
    (staging / "source_inventory.json").write_text(json.dumps(inventory))
    archive = INFRA / ".release" / f"{manifest['release_id']}-prepared.tar.gz"
    with tarfile.open(archive, "w:gz", compresslevel=1) as stream:
        for path in sorted(staging.rglob("*")):
            if path.is_file():
                stream.add(path, arcname=str(path.relative_to(staging)), recursive=False)
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    shutil.rmtree(staging)
    return archive, {"key": f"releases/{manifest['release_id']}/prepared.tar.gz", "sha256": digest}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", default="firecal-terraform")
    parser.add_argument("--data-root", type=Path, default=REPO.parent / "data")
    parser.add_argument("--prepare-only", action="store_true", help="Gera o pacote e confere os dados sem acessar AWS.")
    parser.add_argument("--skip-data", action="store_true", help="Reutiliza fontes já publicadas; indicado para atualização apenas do código.")
    parser.add_argument("--replace-analytics", action="store_true", help="Autoriza substituir um snapshot analítico diferente no RDS.")
    parser.add_argument("--build-on-host", action="store_true", help="Constrói imagens na EC2; evite no perfil micro.")
    args = parser.parse_args()
    paths = [] if args.skip_data else data_inventory(args.data_root)
    archive, manifest = package()
    manifest["replace_analytics"] = args.replace_analytics
    manifest["build_on_host"] = args.build_on_host
    print(f"Pacote: {archive}; SHA-256: {manifest['sha256']}")
    if paths:
        print(f"Fontes: {len(paths)} arquivos, {sum(p.stat().st_size for p in paths) / 1024**3:.2f} GiB.")
    if args.prepare_only:
        print("Preparação local concluída. Nenhum recurso AWS foi acessado.")
        return
    config = config_from_terraform()
    verify_account(config, args.profile)
    if config.get("duckdns_auto_update", False):
        aws(config, args.profile, "ssm", "get-parameter", "--name", config["duckdns_parameter"])
    if paths:
        upload_data(config, args.profile, args.data_root)
    bucket = config["artifact_bucket"]
    prepared, manifest["prepared"] = prepare_caches(args.data_root, manifest)
    command(["aws", "--profile", args.profile, "--region", config["region"], "s3", "cp", prepared,
             f"s3://{bucket}/{manifest['prepared']['key']}", "--only-show-errors"])
    if not args.build_on_host:
        manifest["images"] = build_images(manifest)
        for name, artifact in manifest["images"].items():
            target = INFRA / ".release" / f"{manifest['release_id']}-{name}.tar.gz"
            command(["aws", "--profile", args.profile, "--region", config["region"], "s3", "cp", target,
                     f"s3://{bucket}/{artifact['key']}", "--only-show-errors"])
    command(["aws", "--profile", args.profile, "--region", config["region"], "s3", "cp", archive,
             f"s3://{bucket}/{manifest['source_key']}", "--only-show-errors"])
    manifest_path = archive.with_suffix(".json")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    for key in (f"releases/{manifest['release_id']}/manifest.json", "releases/current.json"):
        command(["aws", "--profile", args.profile, "--region", config["region"], "s3", "cp", manifest_path,
                 f"s3://{bucket}/{key}", "--only-show-errors"])
    response = aws(config, args.profile, "ssm", "send-command", "--cli-input-json", "file:///dev/stdin", payload={
        "InstanceIds": [config["instance_id"]], "DocumentName": "AWS-RunShellScript",
        "TimeoutSeconds": 600, "Comment": f"FireCal {manifest['release_id']}",
        "Parameters": {"commands": ["cloud-init status --wait >/dev/null || true", "test -f /etc/firecal/bootstrap-ready && systemctl start firecal-deploy.service"],
                       "executionTimeout": ["8400"]}})
    command_id = response["Command"]["CommandId"]
    print(f"Deploy solicitado via SSM: {command_id}")
    print(f"Acompanhe: aws ssm get-command-invocation --profile {args.profile} --region {config['region']} --command-id {command_id} --instance-id {config['instance_id']}")
    print(f"Destino após concluir: https://{config['domain']}")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, KeyboardInterrupt) as error:
        raise SystemExit(str(error))
