"""Cria o papel da aplicação usando credenciais recebidas somente por stdin."""
import json
import sys

import psycopg
from psycopg import sql


def main():
    config = json.load(sys.stdin)
    with psycopg.connect(
        host=config["host"], port=config["port"], dbname=config["dbname"],
        user=config["master_username"], password=config["master_password"],
        sslmode="verify-full", sslrootcert="/run/firecal/rds-ca.pem",
        connect_timeout=30,
    ) as connection:
        username = config["username"]
        if not connection.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (username,)).fetchone():
            connection.execute(sql.SQL("CREATE ROLE {} LOGIN").format(sql.Identifier(username)))
        connection.execute(sql.SQL("ALTER ROLE {} WITH LOGIN PASSWORD {} NOSUPERUSER NOCREATEDB NOCREATEROLE").format(
            sql.Identifier(username), sql.Literal(config["password"])))
        connection.execute(sql.SQL("GRANT CONNECT, CREATE, TEMPORARY ON DATABASE {} TO {}").format(
            sql.Identifier(config["dbname"]), sql.Identifier(username)))
    print("Papel da aplicação preparado.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Não imprimir DSN, senha ou conteúdo da entrada.
        print(f"Falha ao preparar o papel da aplicação ({type(error).__name__}).", file=sys.stderr)
        raise SystemExit(1)
