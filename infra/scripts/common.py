"""Utilitários de implantação local; nunca lê arquivos de credenciais."""
import json
from pathlib import Path
import subprocess
import tempfile

INFRA = Path(__file__).resolve().parents[1]
REPO = INFRA.parent


def command(arguments, *, payload=None, capture=False):
    result = subprocess.run([str(a) for a in arguments], input=payload, text=True,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None)
    if result.returncode:
        raise RuntimeError(f"{arguments[0]} falhou (código {result.returncode}). Confira login, região e permissões.")
    return result.stdout if capture else None


def config_from_terraform():
    result = command([INFRA / "tf", f"-chdir={INFRA / 'terraform'}", "output", "-json", "deployment_config"], capture=True)
    return json.loads(result)


def aws(config, profile, *arguments, payload=None):
    base = ["aws", "--profile", profile, "--region", config["region"], "--output", "json"]
    if payload is not None:
        # O CLI desta estação não lê /dev/stdin de forma confiável. O descritor
        # anônimo mantém o JSON fora de argumentos e de arquivos permanentes.
        with tempfile.TemporaryFile() as stream:
            stream.write(json.dumps(payload).encode()); stream.seek(0)
            arguments = [f"file:///proc/self/fd/{stream.fileno()}" if value == "file:///dev/stdin" else value for value in arguments]
            response = subprocess.run([*base, *arguments], pass_fds=(stream.fileno(),), capture_output=True, text=True)
        if response.returncode:
            raise RuntimeError(f"AWS CLI falhou (código {response.returncode}). Confira login e permissões.")
        result = response.stdout
    else:
        result = command([*base, *arguments], capture=True)
    return json.loads(result) if result.strip() else None


def verify_account(config, profile):
    identity = aws(config, profile, "sts", "get-caller-identity")
    if identity["Account"] != config["expected_account_id"]:
        raise RuntimeError("A conta do perfil difere da conta pessoal definida no Terraform; operação cancelada.")
    print(f"Conta conferida: {identity['Account']}; região: {config['region']}.")
