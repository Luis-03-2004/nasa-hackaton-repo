"""Fixtures sintéticas testam contrato; benchmark real é separado."""
from datetime import date
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from app import forecast_selection as f2


class CommonReferenceTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.path=Path(self.temp.name)/'fixture.sqlite'
        with sqlite3.connect(self.path) as db:
            db.executescript('''CREATE TABLE weekly(point_id TEXT,lat INTEGER,lon INTEGER,country TEXT,iso_year INTEGER,iso_week INTEGER,sensor TEXT,cells REAL,merged REAL,frp REAL,bright REAL,bg_sum REAL,bg_weight REAL,night REAL);
                CREATE TABLE source_weeks(iso_year INTEGER,iso_week INTEGER,sensor TEXT,PRIMARY KEY(iso_year,iso_week,sensor));''')
            for year in range(2012,2026):
                for week in range(1,53):
                    for sensor in f2.SENSORS[:2 if year<2018 else 3]:
                        db.execute('INSERT INTO source_weeks VALUES (?,?,?)',(year,week,sensor))
            for point,lat,lon,country in [('pt_-12_-046',-12,-46,'Brazil'),('pt_-13_+018',-13,18,'Angola')]:
                for year in range(2012,2024):
                    for week in [38,39,40,41,42,43,44]:
                        db.execute('INSERT INTO weekly VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(point,lat,lon,country,year,week,'modis',10.,20.,30.,350.,3000.,10.,3.))
                for week in (38,39,40):
                    # Angola deliberately lacks thermal telemetry -> explicit F0.
                    bright=350. if country=='Brazil' else None
                    bg_weight=10. if country=='Brazil' else 0.
                    db.execute('INSERT INTO weekly VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(point,lat,lon,country,2025,week,'modis',20.,40.,60.,bright,3000.,bg_weight,5.))
        factors={'factors_era2_2012_2017':{'alpha_monthly':{str(m):1. for m in range(1,13)}},'factors_era3_2018_2025':{'alpha_monthly':{str(m):1. for m in range(1,13)}}}
        model={'evaluation':{f'h{h}':{'weights_f2':{name:.1 for name in f2.FEATURE_NAMES}} for h in range(1,5)}}
        self.patches=[patch.object(f2,'CACHE_DIR',Path(self.temp.name)/'cache'),patch.object(f2,'build_cache',return_value=self.path),patch.object(f2,'source_signature',return_value='fixture'),patch.object(f2,'model_metadata',return_value=({'trop_sul':factors},{'trop_sul':model}))]
        for item in self.patches:item.start()
        f2._cached_forecast.cache_clear()

    def tearDown(self):
        for item in reversed(self.patches):item.stop()
        f2._cached_forecast.cache_clear()
        self.temp.cleanup()

    def test_reference_normalized_and_training_leakage_guard(self):
        forecast=f2.forecast_selection(point_ids=['pt_-12_-046'],reference_date='2025-09-24')
        self.assertEqual(forecast['reference_date'],'2025-09-22')
        self.assertEqual(forecast['period_end'],'2025-09-28')
        self.assertEqual(forecast['forecasts'][0]['target_date'],'2025-09-29')
        self.assertEqual(forecast['coverage']['imputed_count'],0)
        old=f2.forecast_selection(reference_date='2010-01-01')
        self.assertFalse(old['available'])
        self.assertEqual(old['forecasts'],[])

    def test_sum_uses_all_ids_and_union_without_duplicates(self):
        a=f2.forecast_selection(point_ids=['pt_-12_-046'],reference_date='2025-09-22')
        b=f2.forecast_selection(point_ids=['pt_-13_+018'],reference_date='2025-09-22')
        union=f2.forecast_selection(point_ids=['pt_-12_-046','pt_-13_+018','pt_-12_-046'],reference_date='2025-09-22')
        self.assertEqual(union['coverage']['selected_count'],2)
        self.assertEqual(union['coverage']['processed_count'],2)
        for av,bv,total in zip(a['forecasts'],b['forecasts'],union['forecasts'],strict=True):
            self.assertAlmostEqual(total['value'],av['value']+bv['value'],places=3)
            self.assertAlmostEqual(total['baseline'],av['baseline']+bv['baseline'],places=3)
            self.assertAlmostEqual(total['anomaly_pct'],(total['value']/total['baseline']-1)*100,places=2)

    def test_fallback_is_explicit_without_synthetic_drivers(self):
        response=f2.forecast_selection(country='Angola',reference_date='2025-09-22')
        self.assertEqual(response['coverage']['f2_count'],0)
        self.assertEqual(response['coverage']['fallback_count'],1)
        self.assertEqual(response['coverage']['imputed_count'],0)
        for value in response['forecasts']:self.assertEqual(value['value'],value['baseline'])
        self.assertIsNone(response['risk_level'])
        self.assertFalse(response['validation']['legacy_metrics_inherited'])

    def test_country_filter_and_missing_ids(self):
        response=f2.forecast_selection(country='Brazil',point_ids=['pt_-12_-046','pt_-13_+018','pt_+00_+000'],reference_date='2025-09-22')
        self.assertEqual(response['coverage']['selected_count'],3)
        self.assertEqual(response['coverage']['processed_count'],1)
        self.assertEqual(response['coverage']['missing_count'],2)
        with self.assertRaises(ValueError):f2.forecast_selection(point_ids=['bad'])

    def test_features_and_prediction_match_training_math(self):
        script=Path(__file__).resolve().parents[3]/'scripts/treinar_previsao_multivariada_global.py'
        spec=importlib.util.spec_from_file_location('f2_training',script)
        reference=importlib.util.module_from_spec(spec);spec.loader.exec_module(reference)
        obs={'h_cells':20.,'merged_count':30.,'frp_sum':50.,'bright_max':350.,'bright_bg_mean':290.,'night_count':10.}
        features=f2.extract_physical_features(obs,{'h_cells':15.},10.,12.)
        self.assertEqual(features,reference.extract_physical_features(obs,{'h_cells':15.},10.,12.))
        self.assertEqual(f2.predict_multivariate_row(15.,features,[.1]*6),reference.predict_multivariate_row(15.,features,[.1]*6))

    def test_seasonal_window_matches_full_history_and_keeps_zero_cells(self):
        from itertools import groupby
        with sqlite3.connect(self.path) as db:
            db.execute('INSERT INTO weekly VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',('pt_-20_+010',-20,10,'Test',2020,1,'modis',50.,80.,120.,350.,15000.,50.,5.))
        reference=date(2025,9,22)
        def compute(window):
            db,rows,available=f2.load_selection(None,(),window)
            results={}
            for point,items in groupby(rows,key=lambda row:row['point_id']):
                series,zone=f2.point_series(items)
                results[point]=f2.forecast_point(series,zone,reference,available)['forecasts']
            db.close()
            return results
        full=compute(None);window=compute(reference)
        self.assertEqual(full,window)
        self.assertIn('pt_-20_+010',window)
        self.assertEqual(window['pt_-20_+010'][0]['value'],0)

    def test_english_response_and_no_historical_metrics_reuse(self):
        response=f2.forecast_selection(country='Brazil',reference_date='2025-09-22',locale='en')
        self.assertIn('Experimental team projection',response['provenance'])
        self.assertNotIn('mae',response['validation'])
        self.assertEqual(response['coverage']['selected_count'],1)


class SignatureTest(unittest.TestCase):
    def test_model_changes_invalidate_responses_without_rebuilding_raw_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder)
            weights=base/'previsao_mapa_mundi/modelo_multivariado_global_f2.json'
            history=base/'experimento_2000_2025/resultado_global_2000_2025.json'
            weights.parent.mkdir();history.parent.mkdir()
            weights.write_text('{"weights":1}');history.write_text('{}')
            with patch.object(f2,'DATA_DIR',base):
                raw=f2.raw_source_signature();before=f2.source_signature()
                weights.write_text('{"weights":200}')
                self.assertNotEqual(f2.source_signature(),before)
                self.assertEqual(f2.raw_source_signature(),raw)


if __name__=='__main__':unittest.main()
