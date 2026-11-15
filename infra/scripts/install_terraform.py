#!/usr/bin/env python3
"""Instala Terraform localmente, validando o SHA-256 publicado pela HashiCorp."""
import hashlib
import io
import platform
from pathlib import Path
import urllib.request
import zipfile

VERSION = "1.17.2"


def main():
    system = platform.system().lower()
    arch = {"x86_64": "amd64", "aarch64": "arm64", "arm64": "arm64"}.get(platform.machine())
    if system not in {"linux", "darwin"} or not arch:
        raise SystemExit("Use Linux/macOS AMD64 ou ARM64, ou instale Terraform >= 1.11 manualmente.")
    filename = f"terraform_{VERSION}_{system}_{arch}.zip"
    base = f"https://releases.hashicorp.com/terraform/{VERSION}/"
    with urllib.request.urlopen(base + f"terraform_{VERSION}_SHA256SUMS", timeout=60) as response:
        checksums = dict(line.split()[::-1] for line in response.read().decode().splitlines())
    with urllib.request.urlopen(base + filename, timeout=60) as response:
        archive = response.read()
    if hashlib.sha256(archive).hexdigest() != checksums[filename]:
        raise SystemExit("SHA-256 inválido; instalação cancelada.")
    target = Path(__file__).resolve().parents[1] / ".tools" / "terraform"
    target.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        target.write_bytes(zipped.read("terraform"))
    target.chmod(0o755)
    print(f"Terraform {VERSION} instalado em {target}; use infra/tf.")


if __name__ == "__main__":
    main()
