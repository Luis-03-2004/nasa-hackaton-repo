"""Contrato global: união de seleção, aditividade e dia exato (fixtures rotuladas)."""
from datetime import date
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import pyarrow as pa
import pyarrow.parquet as pq

from app import exploration as e
from app import daily_history as daily


class ExplorationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.base=Path(self.tmp.name)/'global'
        self.base.mkdir()
        self.patches=[patch.object(e,'DATA_DIR',self.base),patch.object(e,'CUBE_DIR',self.base/'web_v2'),patch.object(e,'CUBE_PATH',self.base/'web_v2/test.sqlite'),patch.object(daily,'DATA_DIR',self.base)]
        for p in self.patches:p.start()
        e._BUILD_STATE.update(status='idle',completed_files=0,total_files=0)
        for year in (2024,2025):
            folder=self.base/'parquet_025deg/modis';folder.mkdir(parents=True,exist_ok=True)
            rows=[dict(country='Test',month=1,iso_week=2,lat_025=-48,lon_025=-184,active_1km_cells=10,merged_count=20,frp_sum=30.),dict(country='Test',month=2,iso_week=6,lat_025=-48,lon_025=-184,active_1km_cells=5,merged_count=8,frp_sum=9.),dict(country='Test',month=1,iso_week=2,lat_025=-44,lon_025=-180,active_1km_cells=7,merged_count=11,frp_sum=13.),dict(country='Other',month=1,iso_week=2,lat_025=-48,lon_025=-184,active_1km_cells=3,merged_count=3,frp_sum=6.)]
            pq.write_table(pa.Table.from_pylist(rows),folder/f'modis_{year}_025deg.parquet')
        e.build_cube()
        self.query=dict(start_date='2025-01-01',end_date='2025-12-31',metric='records',resolution='monthly',sensors=['modis'],locale='en')

    def tearDown(self):
        e._map_scale.cache_clear()
        for p in reversed(self.patches):p.stop()
        self.tmp.cleanup()

    def test_union_overlaps_and_country_partition(self):
        all_data=e.query_analysis(self.query)
        a=e.point_id(-12,-46);b=e.point_id(-11,-45)
        selected=e.query_analysis({**self.query,'point_ids':[a,b,a]})
        self.assertEqual(selected['totals'],all_data['totals'])
        self.assertEqual(selected['selected_count'],2)
        self.assertEqual(selected['processed_count'],2)
        country=e.query_analysis({**self.query,'point_ids':[a,b,a],'country':'Test'})
        self.assertEqual(country['totals']['records'],22)
        self.assertEqual(all_data['totals']['records'],25)
        # Unknown selected cells remain explicitly counted, not silently dropped.
        absent=e.query_analysis({**self.query,'point_ids':[a,e.point_id(50,50)]})
        self.assertEqual((absent['selected_count'],absent['processed_count'],absent['missing_count']),(2,1,1))

    def test_map_series_and_harmonized_are_additive(self):
        for metric in ('records','detections','frp','harmonized'):
            q={**self.query,'metric':metric}
            analysis=e.query_analysis(q);world=e.query_map(q)
            self.assertAlmostEqual(sum(p['value'] for p in world['points']),analysis['totals']['value'])
            self.assertAlmostEqual(sum(p['value'] for p in analysis['timeseries'] if p['value'] is not None),analysis['totals']['value'])
            parts=[e.query_analysis({**q,'point_ids':[p['point_id']]})['totals']['value'] for p in world['points']]
            self.assertAlmostEqual(sum(parts),analysis['totals']['value'])
            self.assertGreaterEqual(world['scale_max'],max(p['value'] for p in world['points']))

    def test_temporal_resolution_and_missing_sensor(self):
        data=e.query_analysis({**self.query,'sensors':['modis','viirs-snpp'],'start_date':'2025-02-10','end_date':'2025-02-15'})
        self.assertEqual(data['coverage']['effective_start'],'2025-02-01')
        self.assertEqual(data['coverage']['effective_end'],'2025-02-28')
        self.assertEqual(data['totals']['value'],5)
        self.assertIsNone(data['timeseries'][0]['sensors']['viirs-snpp'])
        self.assertTrue(any('expanded' in n for n in data['notices']))
        week=e.query_analysis({**self.query,'resolution':'weekly','start_date':'2025-01-07','end_date':'2025-01-07'})
        self.assertEqual(week['timeseries'][0]['period'],'2025-01-06')
        self.assertEqual(week['totals']['value'],20)
        self.assertEqual(week['coverage']['effective_end'],'2025-01-12')

    def test_weekly_preserves_zero_and_missing_sensor_bins(self):
        q={**self.query,'country':'Test','resolution':'weekly','start_date':'2025-01-07','end_date':'2025-01-19','sensors':['modis','viirs-snpp']}
        result=e.query_analysis(q)
        self.assertEqual([row['period'] for row in result['timeseries']],['2025-01-06','2025-01-13'])
        self.assertEqual([row['value'] for row in result['timeseries']],[17.,0.])
        self.assertIsNone(result['timeseries'][1]['sensors']['viirs-snpp'])
        self.assertEqual(result['coverage']['effective_start'],'2025-01-06')
        self.assertEqual(result['coverage']['effective_end'],'2025-01-19')

    def test_exact_daily_reads_original_csv_and_merges_passes(self):
        archive=self.base.parent/'modis/modis_2025_all_countries.zip'
        archive.parent.mkdir()
        content='latitude,longitude,acq_date,confidence,frp,type\n-12.001,-46.001,2025-01-06,90,10,0\n-12.001,-46.001,2025-01-06,90,20,0\n-12.001,-46.001,2025-01-07,90,5,0\n-12.001,-46.001,2025-01-07,10,999,0\n'
        with zipfile.ZipFile(archive,'w') as out:out.writestr('modis/2025/modis_2025_Test.csv',content)
        q={**self.query,'country':'Test','resolution':'daily','start_date':'2025-01-06','end_date':'2025-01-07'}
        result=e.query_analysis(q)
        self.assertEqual([r['value'] for r in result['timeseries']],[1,1])
        self.assertEqual(result['totals']['detections'],3)
        self.assertEqual(result['totals']['frp'],35)
        one=e.query_analysis({**q,'start_date':'2025-01-07'})
        self.assertEqual(one['totals']['frp'],5)
        self.assertEqual(e.query_map(q)['total'],result['totals']['value'])
        self.assertEqual(result['method'],'raw-country-daily-v2')

    def test_builder_resumes_without_double_counting(self):
        before=e.query_analysis(self.query)['totals']
        e.build_cube()
        self.assertEqual(e.query_analysis(self.query)['totals'],before)
        self.assertEqual(e.status()['completed_files'],2)
        self.assertTrue(e.status()['ready'])


if __name__=='__main__':unittest.main()
