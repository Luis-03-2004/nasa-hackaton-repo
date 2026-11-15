"""Acesso analítico SQLite local ou PostgreSQL/RDS explicitamente configurado.

O adaptador cobre apenas o subconjunto SQL usado por ``exploration.py``;
valores continuam parametrizados. Nunca imprime o DSN ou suas credenciais.
"""
from __future__ import annotations

import os
import re
from collections.abc import Iterable, Iterator, Sequence
from typing import Any

import psycopg

SCHEMA = 'firecal_analytics'
MANIFEST_TABLE = 'manifest'


class AnalyticsConfigurationError(RuntimeError):
    """Configuração solicitada não pode ser atendida sem fallback silencioso."""


def storage_mode() -> str:
    mode = os.getenv('FIRE_ANALYTICS_STORAGE', 'sqlite').strip().lower()
    if mode not in ('sqlite', 'postgres'):
        raise AnalyticsConfigurationError('FIRE_ANALYTICS_STORAGE deve ser sqlite ou postgres.')
    return mode


def postgres_url() -> str:
    value = os.getenv('ANALYTICS_DATABASE_URL') or os.getenv('DATABASE_URL')
    if not value:
        raise AnalyticsConfigurationError(
            'FIRE_ANALYTICS_STORAGE=postgres exige ANALYTICS_DATABASE_URL ou DATABASE_URL.'
        )
    if value.startswith('postgresql+psycopg://'):
        value = 'postgresql://' + value.removeprefix('postgresql+psycopg://')
    if not value.startswith(('postgresql://', 'postgres://')):
        raise AnalyticsConfigurationError('A conexão analítica precisa de uma URL PostgreSQL.')
    return value


def _fragments(statement: str) -> Iterator[tuple[bool, str]]:
    """Separa código, literais/identificadores e comentários para os parâmetros."""
    start = index = 0
    length = len(statement)
    while index < length:
        char = statement[index]
        quoted = char in ("'", '"')
        line_comment = statement.startswith('--', index)
        block_comment = statement.startswith('/*', index)
        if not (quoted or line_comment or block_comment):
            index += 1
            continue
        if start < index:
            yield True, statement[start:index]
        beginning = index
        if quoted:
            quote = char
            index += 1
            while index < length:
                if statement[index] == quote:
                    index += 1
                    if index < length and statement[index] == quote:
                        index += 1
                        continue
                    break
                index += 1
        elif line_comment:
            ending = statement.find('\n', index)
            index = length if ending < 0 else ending + 1
        else:
            ending = statement.find('*/', index + 2)
            index = length if ending < 0 else ending + 2
        yield False, statement[beginning:index]
        start = index
    if start < length:
        yield True, statement[start:]


def translate_query(statement: str) -> str:
    """Converte as construções SQLite efetivamente usadas nas consultas atuais."""
    parts = []
    ignore_conflict = False
    for code, fragment in _fragments(statement):
        if code:
            if re.search(r'\bINSERT\s+OR\s+IGNORE\b', fragment, re.I):
                ignore_conflict = True
                fragment = re.sub(r'\bINSERT\s+OR\s+IGNORE\b', 'INSERT', fragment, flags=re.I)
            fragment = re.sub(r'\s+WITHOUT\s+ROWID\b', '', fragment, flags=re.I)
            fragment = re.sub(
                r'\bgroup_concat\(\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\)',
                r"string_agg(\1::text, ',')", fragment, flags=re.I,
            )
        # Psycopg receives a parameter sequence even for statements without binds.
        # Escape literal percent signs before adding its %s placeholders.
        fragment = fragment.replace('%', '%%')
        parts.append(fragment.replace('?', '%s') if code else fragment)
    translated = ''.join(parts).strip().rstrip(';')
    if ignore_conflict:
        translated += ' ON CONFLICT DO NOTHING'
    # Compatible with PostgreSQL versions which require aliases for derived tables.
    if re.search(r'\bFROM\s*\(', translated, re.I) and translated.endswith(')'):
        translated += ' AS firecal_subquery'
    return translated


class PostgresConnection:
    """Pequena fachada DB-API que mantém o contrato dos leitores SQLite."""

    def __init__(self, connection: Any):
        self.connection = connection

    def execute(self, statement: str, parameters: Sequence[Any] = ()):
        return self.connection.execute(translate_query(statement), tuple(parameters))

    def executemany(self, statement: str, parameters: Iterable[Sequence[Any]]):
        cursor = self.connection.cursor()
        cursor.executemany(translate_query(statement), parameters)
        return cursor

    def __enter__(self):
        return self

    def __exit__(self, error_type, error, traceback):
        try:
            if error_type is None:
                self.connection.commit()
            else:
                self.connection.rollback()
        finally:
            self.connection.close()
        return False


def connect_postgres() -> PostgresConnection:
    dsn = postgres_url()
    try:
        connection = psycopg.connect(
            dsn,
            connect_timeout=10,
            application_name='firecal-analytics',
            options=f'-c search_path={SCHEMA}',
        )
    except psycopg.Error:
        raise RuntimeError(
            'Não foi possível conectar ao PostgreSQL analítico; verifique rede, DSN e permissões.'
        ) from None
    return PostgresConnection(connection)


def postgres_status(expected_version: str) -> dict[str, Any]:
    # Validate first so a missing DSN is an explicit configuration error.
    postgres_url()
    try:
        with connect_postgres() as db:
            rows = db.execute(f'SELECT key,value FROM {SCHEMA}.{MANIFEST_TABLE}').fetchall()
    except psycopg.errors.UndefinedTable:
        return {'storage': 'postgres', 'status': 'not_migrated', 'ready': False, 'version': expected_version}
    except (psycopg.Error, RuntimeError):
        return {'storage': 'postgres', 'status': 'unavailable', 'ready': False, 'version': expected_version}
    values = dict(rows)
    ready = values.get('ready') == 'true' and values.get('version') == expected_version
    return {
        'storage': 'postgres',
        'status': 'ready' if ready else 'version_mismatch',
        'ready': ready,
        'version': values.get('version'),
        'expected_version': expected_version,
        'completed_files': int(values.get('source_files', '0')),
        'total_files': int(values.get('source_files', '0')),
        'source_sha256': values.get('source_sha256'),
        'published_at': values.get('published_at'),
    }
