#!/usr/bin/env python3
"""Solicita o token DuckDNS sem eco e grava diretamente no SSM SecureString."""
import argparse
import getpass
import sys

from common import aws, config_from_terraform, verify_account


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", default="firecal-terraform")
    parser.add_argument("--account-id", help="Permite cadastrar o token antes de executar Terraform.")
    args = parser.parse_args()
    config = ({"expected_account_id": args.account_id, "region": "us-east-1",
               "domain": "firecalglobal.duckdns.org", "duckdns_parameter": "/firecalglobal/duckdns/token"}
              if args.account_id else config_from_terraform())
    verify_account(config, args.profile)
    if not sys.stdin.isatty():
        raise RuntimeError("Execute em terminal interativo para ocultar o token.")
    token = getpass.getpass(f"Token DuckDNS para {config['domain']} (entrada oculta): ").strip()
    if not token:
        raise RuntimeError("Token vazio; nenhuma alteração realizada.")
    aws(config, args.profile, "ssm", "put-parameter", "--cli-input-json", "file:///dev/stdin",
        payload={"Name": config["duckdns_parameter"], "Value": token, "Type": "SecureString", "Overwrite": True,
                 "Description": "Token DuckDNS FireCal; não gerenciado no estado Terraform."})
    print("Token gravado como SecureString. Nenhum arquivo local de segredo foi criado.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, KeyboardInterrupt) as error:
        raise SystemExit(str(error))
