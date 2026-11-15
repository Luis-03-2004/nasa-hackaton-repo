"""Publica um snapshot do cubo analítico no PostgreSQL/RDS por COPY.

Não importa observações de 1 km, não executa na inicialização da API e não
altera o SQLite de origem. Atualizações do conjunto exigem --replace.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import time

from psycopg import sql

from app.analytics_database import SCHEMA, connect_postgres, postgres_status
from app.exploration import CUBE_PATH, VERSION

LOADING_SCHEMA = SCHEMA + '_loading'
PREVIOUS_SCHEMA = SCHEMA + '_previous'
OWNER_MARKER = 'firecal.analytics'
ADVISORY_LOCK = 6154002601

# Explicit schemas preserve counts as bigint and measurements as double precision.
TABLES = {
    'monthly': (
        ('year', 'INTEGER'), ('sensor', 'TEXT'), ('country', 'TEXT'),
        ('month', 'SMALLINT'), ('lat', 'SMALLINT'), ('lon', 'SMALLINT'),
        ('records', 'BIGINT'), ('detections', 'BIGINT'),
        ('frp', 'DOUBLE PRECISION'), ('harmonized', 'DOUBLE PRECISION'),
    ),
    'country_monthly': (
        ('year', 'INTEGER'), ('sensor', 'TEXT'), ('country', 'TEXT'),
        ('month', 'SMALLINT'), ('records', 'BIGINT'), ('detections', 'BIGINT'),
        ('frp', 'DOUBLE PRECISION'), ('harmonized', 'DOUBLE PRECISION'),
    ),
    'annual': (
        ('year', 'INTEGER'), ('sensor', 'TEXT'), ('country', 'TEXT'),
        ('month', 'SMALLINT'), ('lat', 'SMALLINT'), ('lon', 'SMALLINT'),
        ('records', 'BIGINT'), ('detections', 'BIGINT'),
        ('frp', 'DOUBLE PRECISION'), ('harmonized', 'DOUBLE PRECISION'),
    ),
    'cell_inventory': (('country', 'TEXT'), ('lat', 'SMALLINT'), ('lon', 'SMALLINT')),
    'availability': (('sensor', 'TEXT'), ('year', 'INTEGER'), ('month', 'SMALLINT')),
    'sources': (('name', 'TEXT'), ('size', 'BIGINT'), ('mtime', 'BIGINT'), ('rows', 'BIGINT')),
}
PRIMARY_KEYS = {
    'monthly': ('year', 'sensor', 'country', 'month', 'lat', 'lon'),
    'country_monthly': ('year', 'sensor', 'country', 'month'),
    'annual': ('year', 'sensor', 'country', 'lat', 'lon'),
    'cell_inventory': ('country', 'lat', 'lon'),
    'availability': ('sensor', 'year', 'month'),
    'sources': ('name',),
}
INDEXES = {
    'monthly': (('country', 'year', 'month'), ('lat', 'lon', 'year', 'month'), ('year', 'month')),
    'country_monthly': (('country', 'year', 'month'), ('year', 'month')),
    'annual': (('country', 'year'), ('lat', 'lon', 'year'), ('year',)),
    'cell_inventory': (('country',), ('lat', 'lon')),
}


def inspect_source(connection: sqlite3.Connection) -> dict[str, int]:
    """Confere tabela/colunas e totais sem materializar as linhas na memória."""
    existing = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    missing = set(TABLES) - existing
    if missing:
        raise ValueError('Cubo incompleto; faltam tabelas: ' + ', '.join(sorted(missing)))
    counts = {}
    for table, fields in TABLES.items():
        actual = {row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')}
        required = {column for column, _ in fields}
        if not required <= actual:
            raise ValueError(f'Colunas ausentes em {table}: ' + ', '.join(sorted(required - actual)))
        counts[table] = connection.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
    if not counts['sources'] or not counts['monthly']:
        raise ValueError('Cubo sem fontes ou sem registros mensais; prepare os índices antes da migração.')
    return counts


def snapshot_source(source: Path, target: Path) -> dict[str, int]:
    if not source.is_file():
        raise FileNotFoundError('SQLite de origem não encontrado; execute a preparação dos índices.')
    # SQLite backup includes committed WAL pages consistently. The original is read-only.
    with sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True) as origin:
        inspect_source(origin)
        with sqlite3.connect(target) as destination:
            origin.backup(destination, pages=4096)
            return inspect_source(destination)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def _schema_exists(connection, name: str) -> bool:
    return connection.execute('SELECT 1 FROM pg_namespace WHERE nspname=%s', (name,)).fetchone() is not None


def _manifest(connection, schema: str = SCHEMA) -> dict[str, str]:
    exists = connection.execute('SELECT to_regclass(%s)', (f'{schema}.manifest',)).fetchone()[0]
    if exists is None:
        return {}
    return dict(connection.execute(sql.SQL('SELECT key,value FROM {}.manifest').format(sql.Identifier(schema))).fetchall())


def _create_table(connection, table: str):
    definitions = [sql.SQL('{} {} NOT NULL').format(sql.Identifier(column), sql.SQL(kind)) for column, kind in TABLES[table]]
    definitions.append(sql.SQL('PRIMARY KEY ({})').format(sql.SQL(',').join(map(sql.Identifier, PRIMARY_KEYS[table]))))
    connection.execute(sql.SQL('CREATE TABLE {}.{} ({})').format(
        sql.Identifier(LOADING_SCHEMA), sql.Identifier(table), sql.SQL(',').join(definitions),
    ))


def _copy_table(destination, origin: sqlite3.Connection, table: str, batch_size: int) -> int:
    names = [name for name, _ in TABLES[table]]
    # Names are from TABLES, never from user input or the SQLite schema text.
    cursor = origin.execute('SELECT ' + ','.join(f'"{name}"' for name in names) + f' FROM "{table}"')
    copy_statement = sql.SQL('COPY {}.{} ({}) FROM STDIN').format(
        sql.Identifier(LOADING_SCHEMA), sql.Identifier(table), sql.SQL(',').join(map(sql.Identifier, names)),
    )
    count = 0
    with destination.cursor() as pg_cursor:
        with pg_cursor.copy(copy_statement) as copier:
            while rows := cursor.fetchmany(batch_size):
                for row in rows:
                    copier.write_row(row)
                count += len(rows)
    return count


def migrate(source: Path, *, replace: bool = False, dry_run: bool = False, batch_size: int = 10_000) -> dict:
    if not 1 <= batch_size <= 100_000:
        raise ValueError('batch_size deve estar entre 1 e 100000.')
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='firecal-rds-snapshot-') as temporary:
        snapshot = Path(temporary) / 'exploration.sqlite'
        counts = snapshot_source(source, snapshot)
        checksum = file_sha256(snapshot)
        planned = {'version': VERSION, 'source_sha256': checksum, 'source_files': counts['sources'], 'row_counts': counts}
        if dry_run:
            return {'status': 'dry_run', **planned, 'bytes': snapshot.stat().st_size}
        with connect_postgres() as adapter:
            destination = adapter.connection
            destination.execute('SELECT pg_advisory_xact_lock(%s)', (ADVISORY_LOCK,))
            current = _manifest(destination)
            primary_exists = _schema_exists(destination, SCHEMA)
            if primary_exists and current.get('owner') != OWNER_MARKER:
                raise RuntimeError('O schema analítico já existe sem manifesto FireCal; migração recusada para preservar dados.')
            if current.get('ready') == 'true' and current.get('source_sha256') == checksum and current.get('version') == VERSION:
                return {'status': 'unchanged', **planned}
            if primary_exists and not replace:
                raise RuntimeError('Já existe outra versão analítica. Revise o snapshot e use --replace para publicar a substituição.')
            if _schema_exists(destination, LOADING_SCHEMA):
                raise RuntimeError('O schema de preparação já existe; examine-o antes de repetir a migração. Nenhum dado foi removido.')
            if primary_exists and _schema_exists(destination, PREVIOUS_SCHEMA) and _manifest(destination, PREVIOUS_SCHEMA).get('owner') != OWNER_MARKER:
                raise RuntimeError('O schema de backup já existe sem manifesto FireCal; migração recusada para preservar dados.')
            destination.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(LOADING_SCHEMA)))
            with sqlite3.connect(snapshot) as origin:
                for table in TABLES:
                    _create_table(destination, table)
                    written = _copy_table(destination, origin, table, batch_size)
                    actual = destination.execute(sql.SQL('SELECT count(*) FROM {}.{}').format(
                        sql.Identifier(LOADING_SCHEMA), sql.Identifier(table),
                    )).fetchone()[0]
                    if written != counts[table] or actual != counts[table]:
                        raise RuntimeError(f'Contagem divergente após COPY em {table}; transação não publicada.')
                    for number, columns in enumerate(INDEXES.get(table, ())):
                        destination.execute(sql.SQL('CREATE INDEX {} ON {}.{} ({})').format(
                            sql.Identifier(f'{table}_query_{number}'), sql.Identifier(LOADING_SCHEMA), sql.Identifier(table),
                            sql.SQL(',').join(map(sql.Identifier, columns)),
                        ))
                    destination.execute(sql.SQL('ANALYZE {}.{}').format(sql.Identifier(LOADING_SCHEMA), sql.Identifier(table)))
                    print(f'RDS analytics: {table}: {written:,} linhas conferidas', flush=True)
            destination.execute(sql.SQL('CREATE TABLE {}.manifest (key TEXT PRIMARY KEY,value TEXT NOT NULL)').format(sql.Identifier(LOADING_SCHEMA)))
            published_at = datetime.now(timezone.utc).isoformat()
            manifest = {'owner': OWNER_MARKER, 'ready': 'true', 'version': VERSION, 'source_sha256': checksum,
                        'source_files': str(counts['sources']), 'row_counts': json.dumps(counts, sort_keys=True), 'published_at': published_at}
            with destination.cursor() as cursor:
                cursor.executemany(sql.SQL('INSERT INTO {}.manifest VALUES (%s,%s)').format(sql.Identifier(LOADING_SCHEMA)), manifest.items())
            if primary_exists:
                destination.execute(sql.SQL('DROP SCHEMA IF EXISTS {} CASCADE').format(sql.Identifier(PREVIOUS_SCHEMA)))
                destination.execute(sql.SQL('ALTER SCHEMA {} RENAME TO {}').format(sql.Identifier(SCHEMA), sql.Identifier(PREVIOUS_SCHEMA)))
            destination.execute(sql.SQL('ALTER SCHEMA {} RENAME TO {}').format(sql.Identifier(LOADING_SCHEMA), sql.Identifier(SCHEMA)))
        return {'status': 'published', **planned, 'published_at': published_at, 'elapsed_seconds': round(time.monotonic() - started, 2)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=CUBE_PATH)
    parser.add_argument('--replace', action='store_true', help='Publica nova versão e conserva o schema anterior; requer revisão prévia.')
    parser.add_argument('--dry-run', action='store_true', help='Inspeciona o snapshot local, sem conectar ao PostgreSQL.')
    parser.add_argument('--check', action='store_true', help='Consulta o manifesto PostgreSQL sem migrar.')
    parser.add_argument('--batch-size', type=int, default=10_000)
    args = parser.parse_args()
    if args.check:
        result = postgres_status(VERSION)
        print(json.dumps(result, ensure_ascii=False))
        if not result['ready']:
            raise SystemExit(1)
        return
    result = migrate(args.source, replace=args.replace, dry_run=args.dry_run, batch_size=args.batch_size)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == '__main__':
    main()
