"""Contrato de armazenamento; fixtures sintéticas, sem consultar dados AWS.

FIRE_TEST_ANALYTICS_URL habilita também integração PostgreSQL: os testes criam
e removem exclusivamente um banco temporário próprio com nome aleatório.
"""
from contextlib import contextmanager
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi import HTTPException
import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo

from app import analytics_database as a
from app import exploration as e
from app import migrate_analytics as migration


def create_cube(path: Path) -> None:
    """Dados fictícios explícitos, incluindo país com aspas e célula compartilhada."""
    with sqlite3.connect(path) as db:
        for table, fields in migration.TABLES.items():
            columns = ','.join(f'"{name}" {kind}' for name, kind in fields)
            db.execute(f'CREATE TABLE "{table}" ({columns})')
        db.executemany('INSERT INTO monthly VALUES(?,?,?,?,?,?,?,?,?,?)', [
            (2024, 'modis', "Test'Land", 1, -12, -46, 10, 20, 30., 10.),
            (2024, 'modis', "Test'Land", 2, -12, -46, 5, 8, 9., 5.),
            (2025, 'modis', "Test'Land", 1, -12, -46, 7, 11, 13., 7.),
            (2025, 'modis', 'Other', 1, -12, -46, 3, 3, 6., 3.),
            (2025, 'modis', 'Other', 2, -11, -45, 4, 5, 8., 4.),
        ])
        db.execute('INSERT INTO country_monthly SELECT year,sensor,country,month,sum(records),sum(detections),sum(frp),sum(harmonized) FROM monthly GROUP BY year,sensor,country,month')
        db.execute('INSERT INTO annual SELECT year,sensor,country,0,lat,lon,sum(records),sum(detections),sum(frp),sum(harmonized) FROM monthly GROUP BY year,sensor,country,lat,lon')
        db.execute('INSERT INTO cell_inventory SELECT DISTINCT country,lat,lon FROM monthly')
        db.execute('INSERT INTO availability SELECT DISTINCT sensor,year,month FROM monthly')
        db.execute('INSERT INTO sources VALUES(?,?,?,?)', ('synthetic_fixture_2024_2025.parquet', 1234, 1_700_000_000_000_000_000, 5))


class AnalyticsAdapterTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_storage_requires_explicit_supported_mode_and_dsn(self):
        self.assertEqual(a.storage_mode(), 'sqlite')
        with patch.dict(os.environ, FIRE_ANALYTICS_STORAGE='unexpected'):
            with self.assertRaises(a.AnalyticsConfigurationError):
                a.storage_mode()
        with self.assertRaises(a.AnalyticsConfigurationError):
            a.postgres_url()
        with patch.dict(os.environ, DATABASE_URL='sqlite:///local.sqlite'):
            with self.assertRaises(a.AnalyticsConfigurationError):
                a.postgres_url()
        with patch.dict(os.environ, DATABASE_URL='postgresql+psycopg://test:fake@localhost/firecal'):
            self.assertEqual(a.postgres_url(), 'postgresql://test:fake@localhost/firecal')
        with patch.dict(os.environ, DATABASE_URL='postgresql://fallback', ANALYTICS_DATABASE_URL='postgresql://explicit'):
            self.assertEqual(a.postgres_url(), 'postgresql://explicit')

    def test_translation_preserves_values_comments_and_literal_question_marks(self):
        query = "SELECT '?', 'it''s 100%', \"a?b\" FROM monthly WHERE country=? /* ? */ -- ?\n"
        self.assertEqual(a.translate_query(query), "SELECT '?', 'it''s 100%%', \"a?b\" FROM monthly WHERE country=%s /* ? */ -- ?")
        self.assertEqual(a.translate_query('INSERT OR IGNORE INTO chosen VALUES(?,?);'), 'INSERT INTO chosen VALUES(%s,%s) ON CONFLICT DO NOTHING')
        self.assertEqual(a.translate_query('CREATE TEMP TABLE chosen(lat INTEGER PRIMARY KEY) WITHOUT ROWID'), 'CREATE TEMP TABLE chosen(lat INTEGER PRIMARY KEY)')
        self.assertEqual(a.translate_query('SELECT group_concat(month) FROM availability WHERE year=?'), "SELECT string_agg(month::text, ',') FROM availability WHERE year=%s")
        self.assertEqual(a.translate_query('SELECT count(*) FROM (SELECT DISTINCT lat,lon FROM cell_inventory WHERE country=?)'), 'SELECT count(*) FROM (SELECT DISTINCT lat,lon FROM cell_inventory WHERE country=%s) AS firecal_subquery')
        connection = MagicMock()
        malicious_country = "Test'; DROP TABLE monthly;--"
        with a.PostgresConnection(connection) as db:
            db.execute('SELECT * FROM monthly WHERE country=?', [malicious_country])
            db.executemany('INSERT OR IGNORE INTO chosen VALUES(?,?)', [(-12, -46), (-12, -46)])
        connection.execute.assert_called_once_with('SELECT * FROM monthly WHERE country=%s', (malicious_country,))
        connection.cursor.return_value.executemany.assert_called_once_with('INSERT INTO chosen VALUES(%s,%s) ON CONFLICT DO NOTHING', [(-12, -46), (-12, -46)])
        connection.commit.assert_called_once()
        connection.close.assert_called_once()

    def test_failed_transaction_rolls_back_and_closes(self):
        connection = MagicMock()
        with self.assertRaisesRegex(ValueError, 'fixture failure'):
            with a.PostgresConnection(connection):
                raise ValueError('fixture failure')
        connection.rollback.assert_called_once()
        connection.commit.assert_not_called()
        connection.close.assert_called_once()

    def test_connect_failure_does_not_expose_credentials(self):
        with patch.dict(os.environ, ANALYTICS_DATABASE_URL='postgresql://test:private-value@localhost/firecal'):
            with patch.object(a.psycopg, 'connect', side_effect=psycopg.OperationalError('private-value')):
                with self.assertRaises(RuntimeError) as caught:
                    a.connect_postgres()
        self.assertNotIn('private-value', str(caught.exception))
        self.assertIsNone(caught.exception.__cause__)
        self.assertTrue(caught.exception.__suppress_context__)

    def test_status_manifest_version_and_unavailable(self):
        manifest = [('ready', 'true'), ('version', e.VERSION), ('source_files', '48'), ('source_sha256', 'fixture-hash'), ('published_at', '2026-01-01T00:00:00+00:00')]
        adapter = MagicMock()
        adapter.__enter__.return_value.execute.return_value.fetchall.return_value = manifest
        with patch.dict(os.environ, ANALYTICS_DATABASE_URL='postgresql://localhost/firecal'):
            with patch.object(a, 'connect_postgres', return_value=adapter):
                ready = a.postgres_status(e.VERSION)
                self.assertTrue(ready['ready'])
                self.assertEqual((ready['completed_files'], ready['source_sha256']), (48, 'fixture-hash'))
                self.assertFalse(a.postgres_status('future-version')['ready'])
            with patch.object(a, 'connect_postgres', side_effect=psycopg.errors.UndefinedTable()):
                self.assertEqual(a.postgres_status(e.VERSION)['status'], 'not_migrated')
            with patch.object(a, 'connect_postgres', side_effect=RuntimeError('unavailable')):
                self.assertEqual(a.postgres_status(e.VERSION)['status'], 'unavailable')

    def test_postgres_does_not_open_or_build_sqlite(self):
        with patch.dict(os.environ, FIRE_ANALYTICS_STORAGE='postgres'):
            with patch.object(e, 'build_cube') as builder, patch.object(e.threading, 'Thread') as thread, patch.object(e.sqlite3, 'connect') as sqlite:
                with self.assertRaises(a.AnalyticsConfigurationError):
                    e.status()
                with patch.object(a, 'postgres_status', return_value={'ready': False, 'status': 'not_migrated'}):
                    with self.assertRaises(HTTPException) as caught:
                        e.ensure_cube('en')
                    self.assertEqual(caught.exception.status_code, 503)
                sentinel = object()
                with patch.object(a, 'connect_postgres', return_value=sentinel):
                    self.assertIs(e._connect(), sentinel)
                builder.assert_not_called()
                thread.assert_not_called()
                sqlite.assert_not_called()


class MigrationSourceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.source = Path(self.tmp.name) / 'source.sqlite'
        create_cube(self.source)

    def test_read_only_snapshot_hash_is_stable_and_preserves_source(self):
        before = self.source.read_bytes()
        first = Path(self.tmp.name) / 'first.sqlite'
        second = Path(self.tmp.name) / 'second.sqlite'
        counts = migration.snapshot_source(self.source, first)
        migration.snapshot_source(self.source, second)
        self.assertEqual((counts['monthly'], counts['sources']), (5, 1))
        self.assertEqual(migration.file_sha256(first), migration.file_sha256(second))
        self.assertEqual(self.source.read_bytes(), before)

    def test_dry_run_has_counts_without_database_connection(self):
        with patch.object(migration, 'connect_postgres') as connect:
            result = migration.migrate(self.source, dry_run=True)
        connect.assert_not_called()
        self.assertEqual(result['status'], 'dry_run')
        self.assertEqual(result['row_counts']['monthly'], 5)
        self.assertEqual(len(result['source_sha256']), 64)
        self.assertEqual(result['source_files'], 1)

    def test_incomplete_cube_and_invalid_batch_fail_before_connect(self):
        with sqlite3.connect(self.source) as db:
            db.execute('DROP TABLE annual')
        with patch.object(migration, 'connect_postgres') as connect:
            with self.assertRaisesRegex(ValueError, 'annual'):
                migration.migrate(self.source)
            with self.assertRaises(ValueError):
                migration.migrate(self.source, batch_size=0)
        connect.assert_not_called()

    def test_copy_streams_batches(self):
        destination = MagicMock()
        copier = destination.cursor.return_value.__enter__.return_value.copy.return_value.__enter__.return_value
        with sqlite3.connect(self.source) as origin:
            self.assertEqual(migration._copy_table(destination, origin, 'monthly', batch_size=2), 5)
        self.assertEqual(copier.write_row.call_count, 5)
        self.assertEqual(copier.write_row.call_args_list[0].args[0][2], "Test'Land")


@unittest.skipUnless(os.getenv('FIRE_TEST_ANALYTICS_URL'), 'PostgreSQL de testes opcional não configurado')
class PostgresIntegrationTests(unittest.TestCase):
    """A URL deve apontar para instância de testes com permissão CREATEDB."""

    @classmethod
    def setUpClass(cls):
        cls.admin_url = os.environ['FIRE_TEST_ANALYTICS_URL']
        cls.database = 'firecal_test_' + uuid4().hex
        with psycopg.connect(cls.admin_url, autocommit=True) as db:
            db.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(cls.database)))
        cls.dsn = make_conninfo(cls.admin_url, dbname=cls.database)
        # Runtime expects a URL, not the libpq keyword syntax used above.
        from urllib.parse import urlsplit, urlunsplit
        parsed = urlsplit(cls.admin_url)
        cls.url = urlunsplit(parsed._replace(path='/' + cls.database))

    @classmethod
    def tearDownClass(cls):
        with psycopg.connect(cls.admin_url, autocommit=True) as db:
            db.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(cls.database)))

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.source = Path(self.tmp.name) / 'source.sqlite'
        create_cube(self.source)
        self.environment = patch.dict(os.environ, FIRE_ANALYTICS_STORAGE='postgres', ANALYTICS_DATABASE_URL=self.url)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        with psycopg.connect(self.dsn, autocommit=True) as db:
            for schema in (migration.SCHEMA, migration.LOADING_SCHEMA, migration.PREVIOUS_SCHEMA):
                db.execute(sql.SQL('DROP SCHEMA IF EXISTS {} CASCADE').format(sql.Identifier(schema)))
        e._map_scale.cache_clear()
        self.addCleanup(e._map_scale.cache_clear)

    @contextmanager
    def storage(self, mode):
        with patch.dict(os.environ, FIRE_ANALYTICS_STORAGE=mode), patch.object(e, 'CUBE_PATH', self.source), patch.object(e, '_sources', return_value=['synthetic_source']):
            e._map_scale.cache_clear()
            yield

    def test_real_postgres_queries_match_sqlite_aggregates_and_selection(self):
        self.assertEqual(e.status()['status'], 'not_migrated')
        migration.migrate(self.source, batch_size=2)
        self.assertTrue(e.status()['ready'])
        base = {'start_date': '2024-01-01', 'end_date': '2025-12-31', 'sensors': ['modis', 'viirs-snpp'], 'locale': 'en'}
        cases = [dict(base, metric=metric, **scope) for metric in ('records', 'detections', 'frp', 'harmonized') for scope in ({}, {'country': "Test'Land"}, {'point_ids': [e.point_id(-12,-46),e.point_id(-11,-45),e.point_id(-12,-46)]}, {'months': [1]})]
        for query in cases:
            with self.subTest(query=query):
                with self.storage('sqlite'):
                    expected = e.query_analysis(query)
                    expected_map = e.query_map(query)
                    expected_countries = e.countries()
                with self.storage('postgres'):
                    actual = e.query_analysis(query)
                    actual_map = e.query_map(query)
                    self.assertEqual(e.countries(), expected_countries)
                self.assertEqual(actual, expected)
                self.assertEqual(actual_map, expected_map)
        with self.storage('postgres'):
            # Each selected-query connection closes its own temporary chosen table.
            one = e.query_analysis(dict(base, point_ids=[e.point_id(-11,-45)]))
            absent = e.query_analysis(dict(base, point_ids=[e.point_id(50,50)]))
        self.assertEqual(one['totals']['records'], 4)
        self.assertEqual((absent['selected_count'], absent['processed_count'], absent['missing_count']), (1, 0, 1))

    def test_idempotence_replace_and_transactional_rollback(self):
        first = migration.migrate(self.source, batch_size=2)
        self.assertEqual(migration.migrate(self.source)['status'], 'unchanged')
        with sqlite3.connect(self.source) as db:
            db.execute('UPDATE monthly SET records=records+1')
        with self.assertRaisesRegex(RuntimeError, '--replace'):
            migration.migrate(self.source)
        with patch.object(migration, '_copy_table', side_effect=RuntimeError('synthetic COPY failure')):
            with self.assertRaisesRegex(RuntimeError, 'synthetic COPY failure'):
                migration.migrate(self.source, replace=True)
        self.assertEqual(e.status()['source_sha256'], first['source_sha256'])
        replacement = migration.migrate(self.source, replace=True)
        self.assertEqual(replacement['status'], 'published')
        self.assertNotEqual(replacement['source_sha256'], first['source_sha256'])
        with psycopg.connect(self.dsn) as db:
            old = db.execute(sql.SQL('SELECT value FROM {}.manifest WHERE key=%s').format(sql.Identifier(migration.PREVIOUS_SCHEMA)), ('source_sha256',)).fetchone()[0]
        self.assertEqual(old, first['source_sha256'])

    def test_unmanaged_schema_is_not_replaced(self):
        with psycopg.connect(self.dsn) as db:
            db.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(migration.SCHEMA)))
            db.execute(sql.SQL('CREATE TABLE {}.user_data (id INTEGER)').format(sql.Identifier(migration.SCHEMA)))
        with self.assertRaisesRegex(RuntimeError, 'preservar dados'):
            migration.migrate(self.source, replace=True)
        with psycopg.connect(self.dsn) as db:
            self.assertIsNotNone(db.execute('SELECT to_regclass(%s)', (migration.SCHEMA + '.user_data',)).fetchone()[0])

    def test_application_role_can_publish_and_select_without_superuser(self):
        from urllib.parse import quote, urlsplit, urlunsplit
        role = 'firecal_role_' + uuid4().hex
        password = uuid4().hex  # Senha descartável da fixture; não é um segredo real.
        with psycopg.connect(self.dsn) as db:
            db.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {} NOSUPERUSER NOCREATEDB NOCREATEROLE').format(sql.Identifier(role), sql.Literal(password)))
            db.execute(sql.SQL('GRANT CONNECT,CREATE,TEMPORARY ON DATABASE {} TO {}').format(sql.Identifier(self.database), sql.Identifier(role)))
        try:
            parsed = urlsplit(self.url)
            netloc = quote(role, safe='') + ':' + password + '@' + parsed.netloc.rsplit('@', 1)[-1]
            role_url = urlunsplit(parsed._replace(netloc=netloc))
            with patch.dict(os.environ, ANALYTICS_DATABASE_URL=role_url):
                self.assertEqual(migration.migrate(self.source)['status'], 'published')
                query = {'start_date': '2024-01-01', 'end_date': '2025-12-31', 'sensors': ['modis'], 'point_ids': [e.point_id(-12,-46)]}
                self.assertEqual(e.query_analysis(query)['totals']['records'], 25)
                self.assertEqual(migration.migrate(self.source)['status'], 'unchanged')
        finally:
            with psycopg.connect(self.dsn) as db:
                db.execute(sql.SQL('DROP OWNED BY {} CASCADE').format(sql.Identifier(role)))
                db.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))


if __name__ == '__main__':
    unittest.main()
