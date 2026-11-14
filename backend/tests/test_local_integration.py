"""Testes de contrato, dados locais e virada ISO (fixtures são sintéticas)."""
import importlib.util
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

import pyarrow as pa
import pyarrow.parquet as pq
from fastapi.testclient import TestClient

from app import forecast, local_observations
from app.dates import observation_week_start
from app.ingest import records_from_batch, SOURCE_COLUMNS
from app.main import app
from app.schemas import AreaQuery
from datetime import date


class LocalIntegrationTest(unittest.TestCase):
    def test_calendar_year_iso_week_boundaries(self):
        self.assertEqual(observation_week_start(2021, 1, 53), date(2020, 12, 28))
        self.assertEqual(observation_week_start(2020, 12, 53), date(2020, 12, 28))
        self.assertEqual(observation_week_start(2025, 12, 1), date(2025, 12, 29))
        self.assertEqual(observation_week_start(2022, 1, 52), date(2021, 12, 27))
        with self.assertRaises(ValueError):
            observation_week_start(2025, 8, 53)

    def test_inference_matches_training_implementation(self):
        script = Path(__file__).resolve().parents[3] / "scripts/treinar_previsao_multivariada_global.py"
        spec = importlib.util.spec_from_file_location("training_reference", script)
        reference = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(reference)
        obs = {"h_cells": 27, "merged_count": 50, "frp_sum": 80, "bright_max": 370, "bright_bg_mean": 295, "night_count": 12}
        previous = {"h_cells": 15}
        features = forecast.extract_physical_features(obs, previous, 20, 10)
        self.assertEqual(features, reference.extract_physical_features(obs, previous, 20, 10))
        weights = [.2, .1, .3, .4, .05, .02]
        self.assertEqual(forecast.predict_multivariate_row(50, features, weights), reference.predict_multivariate_row(50, features, weights))
        for value, p75, p90, anomaly in [(4, 2, 3, 20), (3, 2, 5, 5), (0, 1, 2, 0)]:
            self.assertEqual(forecast.classify_risk_level(value, p75, p90, anomaly), reference.classify_risk_level(value, p75, p90, anomaly))

    def test_parquet_filter_preserves_source_index(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / "modis"
            folder.mkdir()
            rows = []
            for lon in [-50, -45, -46]:
                rows.append(dict(year=2025, month=8, iso_week=32, country="Brazil", tile_lat=-12, tile_lon=lon, lat_1km=-1200, lon_1km=lon * 100, merged_count=3, pass_count=1, frp_sum=2., frp_max=2., bright_max=330., bright_mean=325., bright_bg_mean=295., bright_bg_min=290., day_count=2, night_count=1, high_conf_count=2))
            table = pa.Table.from_pylist(rows)
            pq.write_table(table, folder / "modis_2025_1km.parquet")
            area = AreaQuery(top_left_lat=-11, top_left_lon=-46, bottom_right_lat=-13, bottom_right_lon=-44)
            with patch.object(local_observations, "PARQUET_DIR", Path(temp)):
                selected = list(local_observations.iter_observations(area, date(2025, 1, 1), date(2025, 12, 31)))
                self.assertEqual([row["source_row_index"] for row in selected], [1, 2])
                features = local_observations.area_features(area, date(2025, 1, 1), date(2025, 12, 31))
                self.assertEqual(features["observations_total"], 2)
                self.assertEqual(features["detections_total"], 6)
            batch = table.select(SOURCE_COLUMNS).to_batches()[0]
            self.assertEqual(list(records_from_batch(batch, "modis", 2025))[1][2], 1)

    def test_real_artifact_contract_and_location(self):
        with TestClient(app) as client:
            self.assertEqual(client.get("/health").json()["world_points"], 16525)
            data = client.get("/catalog").json()
            self.assertEqual(len(data["regions"]), 7)
            for region in data["regions"]:
                self.assertEqual(len(region["historical_series"]), 312)
                self.assertEqual(region["temporal_resolution"], "monthly")
                self.assertIsNone(region["forecast"])
            points = client.get("/world-points").json()["points"]
            source = next(point for point in points if point["country"] == "Brazil")
            response = client.get("/forecast/location", params={"lat": source["lat_center"], "lon": source["lon_center"]}).json()
            self.assertEqual(response["nearest_point"]["distance_km"], 0)
            self.assertEqual(response["forecast"]["forecast_w1"], source["pred_h1_1km_cells"])
            self.assertIsNone(response["forecast"]["band_p10_p90"])
            self.assertEqual(response["historical_series"], [])
            self.assertEqual(client.get("/forecast/location?lat=nan&lon=10").status_code, 422)
            self.assertEqual(client.get("/forecast/location?lat=91&lon=0").status_code, 422)
            self.assertEqual(client.get("/hotspots?start_date=1999-01-01").status_code, 422)
            self.assertEqual(client.get("/hotspots?top_left_lat=1").status_code, 422)
            cors = client.options("/catalog", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
            self.assertEqual(cors.headers["access-control-allow-origin"], "http://localhost:5173")

    def test_all_source_schemas(self):
        paths = list((forecast.DATA_DIR / "parquet_1km").glob("*/*.parquet"))
        self.assertEqual(len(paths), 48)
        count = 0
        for path in paths:
            reader = pq.ParquetFile(path)
            self.assertEqual(reader.schema_arrow.names, list(SOURCE_COLUMNS), str(path))
            count += reader.metadata.num_rows
        self.assertEqual(count, 295748529)

    def test_real_area_and_sensor_series(self):
        path = forecast.DATA_DIR / "parquet_1km/modis/modis_2025_1km.parquet"
        sample = pq.read_table(path, columns=["lat_1km", "lon_1km"], filters=[("country", "=", "Brazil"), ("month", "=", 8)]).slice(0, 1).to_pylist()[0]
        lat, lon = sample["lat_1km"] / 100, sample["lon_1km"] / 100
        params = {"top_left_lat": lat + .001, "top_left_lon": lon - .001, "bottom_right_lat": lat - .001, "bottom_right_lon": lon + .001, "limit": 1}
        with TestClient(app) as client:
            before = time.monotonic()
            response = client.get("/observations/area", params=params)
            elapsed = time.monotonic() - before
            self.assertEqual(response.status_code, 200, response.text)
            data = response.json()
            self.assertGreaterEqual(data["features"]["observations_total"], 1)
            self.assertEqual(len(data["points"]), 1)
            self.assertEqual(data["points"][0]["latitude"], lat)
            self.assertEqual(data["truncated"], data["features"]["observations_total"] > 1)
            self.assertLess(elapsed, 15)
            print(f"\nBBox real {lat},{lon}: {data['features']['observations_total']} registros em {elapsed:.2f}s")
            sensors = client.get("/observations/region-series?region=brazil&year=2025").json()
            self.assertEqual(sensors["series"][0]["n_modis"], 4250)
            old = client.get("/observations/region-series?region=brazil&year=2000").json()
            self.assertTrue(all(row["n_viirs_snpp"] is None for row in old["series"]))
            self.assertEqual(client.get("/observations/region-series?region=cerrado").status_code, 422)
            obs = dict(h_cells=20, merged_count=25, frp_sum=50, bright_max=350, bright_bg_mean=295, night_count=5)
            inferred = client.post("/forecast/infer", json={"mu_target": 50, "mu_t": 20, "mu_tm1": 20, "obs_t": obs, "obs_tm1": obs}).json()
            self.assertEqual(inferred["predicted_1km_cells"], 50)
            self.assertEqual(inferred["anomaly_pct"], 0)


if __name__ == "__main__":
    unittest.main()
