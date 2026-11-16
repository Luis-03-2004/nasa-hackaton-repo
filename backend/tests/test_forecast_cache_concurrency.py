"""Concorrência e modo preparado com SQLite e observações inteiramente sintéticos."""
from concurrent.futures import ThreadPoolExecutor
import multiprocessing
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app import forecast_selection as f2


SIGNATURE = 'synthetic-cache-concurrency'


def _synthetic_harmonize(values, zone, year, week):
    return sum(values.values())


def _process_prepare(path, barrier, builds, results):
    """Cada processo abre sua própria conexão e lê o estado inicial antes do lock."""
    original_ready = f2._fast_tables_ready
    original_build = f2._build_fast_tables
    first_read = True

    def synchronized_ready(db):
        nonlocal first_read
        ready = original_ready(db)
        if first_read:
            first_read = False
            barrier.wait(timeout=15)
        return ready

    def counted_build(db):
        with builds.get_lock():
            builds.value += 1
        return original_build(db)

    try:
        with patch.dict(os.environ, {'FIRE_REQUIRE_PREPARED_CACHE': '0'}), \
             patch.object(f2, 'raw_source_signature', return_value=SIGNATURE), \
             patch.object(f2, 'harmonize', side_effect=_synthetic_harmonize), \
             patch.object(f2, '_fast_tables_ready', side_effect=synchronized_ready), \
             patch.object(f2, '_build_fast_tables', side_effect=counted_build), \
             sqlite3.connect(path, timeout=20) as db:
            results.put(('ok', f2._ensure_fast_tables(db)))
    except Exception as error:
        results.put(('error', type(error).__name__, str(error)))


class ForecastCacheConcurrencyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / 'synthetic-weekly.sqlite'
        with sqlite3.connect(self.path) as db:
            db.executescript('''
                CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT);
                CREATE TABLE weekly(point_id TEXT,lat INTEGER,lon INTEGER,country TEXT,
                    iso_year INTEGER,iso_week INTEGER,sensor TEXT,cells REAL,merged REAL,
                    frp REAL,bright REAL,bg_sum REAL,bg_weight REAL,night REAL);
                CREATE TABLE source_weeks(iso_year INTEGER,iso_week INTEGER,sensor TEXT,
                    PRIMARY KEY(iso_year,iso_week,sensor));
            ''')
            db.execute('INSERT INTO metadata VALUES (?,?)', ('signature', SIGNATURE))
            db.executemany('INSERT INTO source_weeks VALUES (?,?,?)',
                           [(2012, week, sensor) for week in range(1, 53)
                            for sensor in f2.SENSORS[:2]])
            db.executemany('INSERT INTO weekly VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
                ('pt_+01_+002', 1, 2, 'SyntheticLand', year, 1, 'modis',
                 cells, cells * 2, cells * 3, 350., cells * 300, cells, 2.)
                for year, cells in ((2012, 10.), (2025, 20.))
            ])
            db.execute('CREATE TABLE point_inventory AS SELECT point_id,lat,lon,country FROM weekly GROUP BY point_id,country')
        for item in (
            patch.dict(os.environ, {'FIRE_REQUIRE_PREPARED_CACHE': '0'}),
            patch.object(f2, 'cache_path', return_value=self.path),
            patch.object(f2, 'raw_source_signature', return_value=SIGNATURE),
            patch.object(f2, 'harmonize', side_effect=_synthetic_harmonize),
        ):
            item.start()
            self.addCleanup(item.stop)

    def assert_complete(self):
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone(), ('ok',))
            self.assertEqual(db.execute('SELECT count(*) FROM fast_clim_blob').fetchone(), (2,))
            self.assertEqual(db.execute('SELECT count(*) FROM fast_obs').fetchone(), (2,))
            self.assertEqual(db.execute('SELECT sum(h_cells) FROM fast_obs').fetchone(), (40.,))
            self.assertEqual(db.execute("SELECT value FROM metadata WHERE key='fast_signature'").fetchone(), (SIGNATURE,))

    def test_threads_double_check_and_build_only_once(self):
        workers = 6
        barrier = threading.Barrier(workers)
        seen = threading.local()
        original_ready = f2._fast_tables_ready
        original_build = f2._build_fast_tables

        def synchronized_ready(db):
            ready = original_ready(db)
            if not getattr(seen, 'initial_read', False):
                seen.initial_read = True
                barrier.wait(timeout=10)
            return ready

        def prepare(_):
            with sqlite3.connect(self.path, timeout=20) as db:
                return f2._ensure_fast_tables(db)

        with patch.object(f2, '_fast_tables_ready', side_effect=synchronized_ready), \
             patch.object(f2, '_build_fast_tables', wraps=original_build) as builder, \
             ThreadPoolExecutor(max_workers=workers) as pool:
            self.assertEqual(list(pool.map(prepare, range(workers))), [True] * workers)
            self.assertEqual(builder.call_count, 1)
        self.assert_complete()

    def test_processes_double_check_and_build_only_once(self):
        context = multiprocessing.get_context('spawn')
        workers = 3
        barrier = context.Barrier(workers)
        builds = context.Value('i', 0)
        results = context.Queue()
        processes = [context.Process(target=_process_prepare,
                                    args=(self.path, barrier, builds, results))
                     for _ in range(workers)]
        try:
            for process in processes:
                process.start()
            replies = [results.get(timeout=25) for _ in processes]
            for process in processes:
                process.join(timeout=5)
                self.assertEqual(process.exitcode, 0)
            self.assertEqual(replies, [('ok', True)] * workers)
            self.assertEqual(builds.value, 1)
        finally:
            for process in processes:
                if process.is_alive():
                    process.terminate()
                    process.join(timeout=5)
            results.close()
            results.join_thread()
        self.assert_complete()

    def test_completed_tables_are_reused_without_writes(self):
        with sqlite3.connect(self.path) as db:
            self.assertTrue(f2._ensure_fast_tables(db))
        before = self.path.read_bytes()
        with patch.object(f2, '_build_fast_tables', side_effect=AssertionError('unexpected rebuild')), \
             patch.object(f2.fcntl, 'flock', side_effect=AssertionError('ready cache needs no lock')), \
             sqlite3.connect(self.path) as db:
            self.assertTrue(f2._ensure_fast_tables(db))
        self.assertEqual(self.path.read_bytes(), before)
        self.assert_complete()

    def test_prepared_mode_rejects_missing_or_empty_fast_tables_without_writes(self):
        for empty_tables in (False, True):
            with self.subTest(empty_tables=empty_tables):
                if empty_tables:
                    with sqlite3.connect(self.path) as db:
                        db.executescript('CREATE TABLE fast_clim_blob(point_id TEXT); CREATE TABLE fast_obs(point_id TEXT);')
                before = self.path.read_bytes()
                filenames = sorted(p.name for p in self.path.parent.iterdir())
                with patch.dict(os.environ, {'FIRE_REQUIRE_PREPARED_CACHE': '1'}), \
                     patch.object(f2, '_build_fast_tables', side_effect=AssertionError('server must not build')), \
                     patch.object(f2, '_ensure_inventory', side_effect=AssertionError('server must not build')):
                    with self.assertRaises(HTTPException) as error:
                        f2.build_cache()
                self.assertEqual(error.exception.status_code, 503)
                self.assertEqual(error.exception.headers['Retry-After'], '5')
                self.assertEqual(self.path.read_bytes(), before)
                self.assertEqual(sorted(p.name for p in self.path.parent.iterdir()), filenames)

    def test_prepared_mode_reuses_completed_cache_without_writes(self):
        with sqlite3.connect(self.path) as db:
            self.assertTrue(f2._ensure_fast_tables(db))
        before = self.path.read_bytes()
        with patch.dict(os.environ, {'FIRE_REQUIRE_PREPARED_CACHE': '1'}), \
             patch.object(f2, '_build_fast_tables', side_effect=AssertionError('server must not build')), \
             patch.object(f2, '_ensure_inventory', side_effect=AssertionError('server must not build')):
            self.assertEqual(f2.build_cache(), self.path)
        self.assertEqual(self.path.read_bytes(), before)
        self.assert_complete()

    def test_prepared_mode_rejects_missing_inventory_without_writes(self):
        with sqlite3.connect(self.path) as db:
            self.assertTrue(f2._ensure_fast_tables(db))
            db.execute('DROP TABLE point_inventory')
        before = self.path.read_bytes()
        with patch.dict(os.environ, {'FIRE_REQUIRE_PREPARED_CACHE': '1'}), \
             patch.object(f2, '_ensure_inventory', side_effect=AssertionError('server must not build')):
            with self.assertRaises(HTTPException) as error:
                f2.build_cache()
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(self.path.read_bytes(), before)

    def test_prepared_mode_rejects_missing_cache_without_creating_files(self):
        missing = self.path.parent / 'missing.sqlite'
        with patch.dict(os.environ, {'FIRE_REQUIRE_PREPARED_CACHE': '1'}), \
             patch.object(f2, 'cache_path', return_value=missing):
            with self.assertRaises(HTTPException) as error:
                f2.build_cache()
        self.assertEqual(error.exception.status_code, 503)
        self.assertFalse(missing.exists())


if __name__ == '__main__':
    unittest.main()
