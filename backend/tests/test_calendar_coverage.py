"""Metadados e cobertura do calendário com fixtures explicitamente sintéticas.

Não lê dados científicos, não reconstrói índices e não acessa a API pública.
"""
from datetime import date
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from app import exploration
from app import forecast_selection
from app import daily_history


class CalendarCoverageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.weekly = Path(self.temporary.name) / 'synthetic-weekly.sqlite'
        self.cache_patch = patch.object(forecast_selection, 'cache_path', return_value=self.weekly)
        self.cache_patch.start()
        self.addCleanup(self.cache_patch.stop)

    def calendar(self, *, year=2025, month=1, value=31, baseline=62, country=None):
        fixture = {
            'calendar': [{'year': year, 'month': month, 'value': value, 'baseline_mean': baseline}],
            'unit': 'synthetic monthly cell records',
        }
        with patch.object(exploration, 'query_analysis', return_value=fixture):
            return exploration.query_calendar_month({
                'year': year, 'month': month, 'country': country,
                'sensors': ['modis'], 'metric': 'records', 'locale': 'en',
            })

    def test_monthly_fallback_declares_estimation_and_preserves_values(self):
        result = self.calendar()
        self.assertEqual(result['source'], 'monthly_distributed')
        self.assertEqual(result['resolution_source'], 'monthly_distributed')
        self.assertIs(result['is_estimated'], True)
        self.assertEqual(result['month_total'], 31)
        self.assertEqual(result['baseline_mean'], 62)
        self.assertEqual(len(result['days']), 31)
        self.assertEqual([day['value'] for day in result['days']], [1.] * 31)
        self.assertTrue(all(day['anomaly_pct'] == -50. for day in result['days']))

    def test_missing_2000_period_remains_null_instead_of_zero(self):
        result = self.calendar(year=2000, month=1, value=None)
        self.assertEqual(result['source'], 'monthly_distributed')
        self.assertIs(result['is_estimated'], True)
        self.assertIsNone(result['month_total'])
        self.assertEqual(len(result['days']), 31)
        self.assertTrue(all(day['value'] is None for day in result['days']))
        self.assertTrue(all(day['anomaly_pct'] is None and day['anomaly_zscore'] is None
                            for day in result['days']))

    def test_recorded_zero_remains_different_from_missing(self):
        result = self.calendar(year=2000, month=11, value=0, baseline=60)
        self.assertEqual(result['source'], 'monthly_distributed')
        self.assertIs(result['is_estimated'], True)
        self.assertEqual(result['month_total'], 0)
        self.assertEqual(len(result['days']), 30)
        self.assertTrue(all(day['value'] == 0. for day in result['days']))
        self.assertTrue(all(day['anomaly_pct'] == -100. for day in result['days']))

    def test_weekly_distribution_keeps_source_totals_and_day_values(self):
        with sqlite3.connect(self.weekly) as connection:
            connection.execute('''CREATE TABLE weekly(
                iso_year INTEGER, iso_week INTEGER, sensor TEXT, cells REAL,
                merged REAL, frp REAL, country TEXT, point_id TEXT
            )''')
            connection.executemany('INSERT INTO weekly VALUES(?,?,?,?,?,?,?,?)', [
                (2025, week, 'modis', cells, cells * 2, cells * 3, 'SyntheticLand', 'pt_+01_+002')
                for week, cells in ((1, 21), (2, 14), (3, 7), (4, 28), (5, 35))
            ])
        result = self.calendar(value=89)
        self.assertEqual(result['source'], 'weekly_distributed')
        self.assertEqual(result['resolution_source'], 'iso_weekly_distributed')
        self.assertIs(result['is_estimated'], True)
        self.assertEqual(result['month_total'], 89)
        self.assertEqual([day['value'] for day in result['days']],
                         [3.] * 5 + [2.] * 7 + [1.] * 7 + [4.] * 7 + [5.] * 5)
        self.assertEqual(sum(day['value'] for day in result['days']), 89)

    def test_exact_daily_declares_observation_and_preserves_null_and_zero(self):
        rows = [{'period': date(2025, 1, day).isoformat(),
                 'value': None if day == 1 else 8. if day == 3 else 0.}
                for day in range(1, 32)]
        with patch.object(daily_history, 'daily_analysis', return_value={
            'timeseries': rows, 'unit': 'synthetic daily occupancy',
        }) as reader:
            result = self.calendar(country='SyntheticLand')
        self.assertEqual(result['source'], 'exact_daily')
        self.assertEqual(result['resolution_source'], 'exact_daily')
        self.assertIs(result['is_estimated'], False)
        self.assertEqual(result['unit'], 'synthetic daily occupancy')
        self.assertIsNone(result['days'][0]['value'])
        self.assertEqual(result['days'][1]['value'], 0.)
        self.assertEqual(result['days'][2]['value'], 8.)
        self.assertEqual(result['month_total'], 8.)
        reader.assert_called_once()
        self.assertEqual(reader.call_args.args[0]['resolution'], 'daily')

    def test_unavailable_daily_country_data_remains_estimated(self):
        with patch.object(daily_history, 'daily_analysis', return_value={
            'timeseries': [{'period': '2025-01-01', 'value': None}],
            'unit': 'synthetic unavailable daily data',
        }):
            result = self.calendar(country='SyntheticLand')
        self.assertEqual(result['source'], 'monthly_distributed')
        self.assertEqual(result['resolution_source'], 'monthly_distributed')
        self.assertIs(result['is_estimated'], True)
        self.assertEqual(result['month_total'], 31)


if __name__ == '__main__':
    unittest.main()
