"""Leitura dos artefatos auditáveis e inferência F2 sem alterar fontes."""
from functools import lru_cache
from pathlib import Path
import csv
import json
import math
import os

import pyarrow.parquet as pq

from app.dates import observation_week_start

DATA_DIR = Path(os.getenv("FIRE_DATA_DIR", Path(__file__).resolve().parents[3] / "data/global_1km_2000_2025"))
FEATURE_NAMES = ("anom_t", "anom_tm1", "frp_intensity_anom", "thermal_contrast_anom", "night_ratio_anom", "subpixel_density_anom")
PROVENANCE = "NASA FIRMS / EOSDIS; derivados da equipe 2000–2025. 0 = sem detecção registrada nos arquivos; não comprova ausência de fogo. Uma célula não é um incêndio único."
SNAPSHOT_PROVENANCE = "Projeção experimental F2 pré-calculada, ancorada na última semana ativa de 2025 de cada ponto; não é previsão atual nem oficial NASA. O gerador inclui imputações físicas quando faltam semanas e não registra a máscara de imputação; os drivers do catálogo não devem ser tratados como medições verificadas."
NAMES = {"global": "Mundo", "brazil": "Brasil", "trop_sul": "Trópicos sul", "trop_norte": "Trópicos norte", "temp_sul": "Temperado sul", "temp_norte": "Temperado norte", "boreal": "Boreal"}
COORDS = {"global": (0, 0), "brazil": (-12, -52), "trop_sul": (-12, 20), "trop_norte": (12, 20), "temp_sul": (-35, 20), "temp_norte": (35, 20), "boreal": (65, 20)}


def extract_physical_features(obs_t, obs_tm1, mu_t, mu_tm1):
    h_t = float(obs_t.get("h_cells", 0))
    anomaly = h_t - mu_t
    merged = max(1., float(obs_t.get("merged_count", 0)))
    cells = max(1., h_t)
    frp = math.log1p(max(0., float(obs_t.get("frp_sum", 0))) / cells) / 5
    delta = max(0., min(150., float(obs_t.get("bright_max", 300) or 300) - float(obs_t.get("bright_bg_mean", 295) or 295))) / 50
    night = min(1., max(0., float(obs_t.get("night_count", 0)) / merged))
    density = math.log1p(max(1., merged / cells)) / 2.5
    return [anomaly, float(obs_tm1.get("h_cells", 0)) - mu_tm1, frp * anomaly, delta * anomaly, night * anomaly, density * anomaly]


def predict_multivariate_row(mu_target, features, weights):
    if len(features) != 6 or len(weights) != 6:
        raise ValueError("F2 exige seis variáveis e seis pesos")
    value = max(0., mu_target + sum(f * w for f, w in zip(features, weights, strict=True)))
    anomaly = (value - mu_target) / mu_target * 100 if mu_target > 1 else (0. if value <= 1 else 100.)
    return round(value, 2), round(anomaly, 2)


def classify_risk_level(value, p75, p90, anomaly):
    if value > max(1., p90) and anomaly >= 15:
        return "CRITICO"
    if value > max(.5, p75) or anomaly >= 10:
        return "ATENCAO"
    return "NORMAL"


@lru_cache(maxsize=1)
def artifacts():
    history = json.loads((DATA_DIR / "experimento_2000_2025/resultado_global_2000_2025.json").read_text())
    model = json.loads((DATA_DIR / "previsao_mapa_mundi/modelo_multivariado_global_f2.json").read_text())
    points = pq.read_table(DATA_DIR / "previsao_mapa_mundi/catalogo_pontos_globais_previsao.parquet").to_pylist()
    with (DATA_DIR / "entrega_drive_equipe/02_calendario_harmonizado_mensal_2000_2025.csv").open() as stream:
        monthly = list(csv.DictReader(stream))
    return history, model, points, monthly


@lru_cache(maxsize=1)
def catalog():
    history, model, _, monthly = artifacts()
    regions = []
    for scope, cal in history["calendar_2000_2025"].items():
        series = []
        cells = []
        for row in monthly:
            if row["scope"] != scope:
                continue
            item = {k: (int(v) if k in ("year", "month") else float(v)) for k, v in row.items() if k != "scope"}
            cells.append(item)
            series.append({"iso_year": item["year"], "iso_week": 0, "week_start": f'{item["year"]:04}-{item["month"]:02}-01', "month": item["month"], "harmonized_index": item["harmonized_1km_cells"], "n_modis": None, "n_viirs_snpp": None, "n_viirs_jpss1": None, "baseline_mean": item["clim_mean_2003_2023"], "anomaly_pct": item["anomaly_pct"], "anomaly_zscore": item["anomaly_zscore"]})
        lat, lon = COORDS[scope]
        regions.append({"id": scope, "region_name": NAMES[scope], "coordinates": {"lat_center": lat, "lon_center": lon}, "calibration_status": "calibrated_local" if scope == "brazil" else "global_standard", "historical_series": series, "temporal_resolution": "monthly", "monthly_calendar": cells, "forecast": None, "validation": model["models_by_scope"][scope]["evaluation"]["h1"], "provenance": PROVENANCE + " Série mensal harmonizada, sem discriminação por sensor neste artefato. Cobertura inicial parcial; zeros da origem preservados."})
    return {"regions": regions, "provenance": PROVENANCE}


def distance_km(lat, lon, point):
    a, b = math.radians(lat), math.radians(point["lat_center"])
    dlat = b - a
    dlon = math.radians(point["lon_center"] - lon)
    chord = math.sin(dlat / 2) ** 2 + math.cos(a) * math.cos(b) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(min(1., chord)))


def location_forecast(lat, lon):
    _, model, points, _ = artifacts()
    point = min(points, key=lambda row: distance_km(lat, lon, row))
    validation = model["models_by_scope"][point["zone"]]["evaluation"]["h1"]
    forecast = {"cell_id": point["point_id"], "alert_level": {"NORMAL": "NORMAL", "ATENCAO": "WATCH", "CRITICO": "CRITICAL"}[point["risk_level"]], "recent_anomaly_pct": point["pred_h1_anom_pct"], **{f"forecast_w{h}": point[f"pred_h{h}_1km_cells"] for h in range(1, 5)}, "anomaly_pct": [point[f"pred_h{h}_anom_pct"] for h in range(1, 5)], "band_p10_p90": None, "reference_year": point["ref_year"], "reference_iso_week": point["ref_iso_week"], "reference_date": observation_week_start(point["ref_year"], 12 if point["ref_iso_week"] > 48 else 6, point["ref_iso_week"]).isoformat(), "drivers": {"frp_sum_mw": point["obs_t_frp_sum_mw"], "delta_t_k": point["obs_t_delta_t_k"], "merged_count": point["obs_t_merged_count"], "observed_1km_cells": point["obs_t_1km_cells"]}, "validation_scope": point["zone"], "validation": {**validation["multivariate_f2"], "skill_f2_vs_f0_pct": validation["skill_f2_vs_f0_pct"]}, "provenance": SNAPSHOT_PROVENANCE}
    return {"region_name": f'{point["country"].replace("_", " ")} · {point["point_id"]}', "coordinates": {"lat_center": point["lat_center"], "lon_center": point["lon_center"]}, "calibration_status": "global_standard", "historical_series": [], "monthly_calendar": [], "temporal_resolution": "monthly", "forecast": forecast, "nearest_point": {**point, "distance_km": round(distance_km(lat, lon, point), 2)}, "provenance": SNAPSHOT_PROVENANCE + " O catálogo não contém a série histórica local. A distância ao ponto selecionado é informada; pontos oceânicos não representam uma observação no local pedido."}


def infer(scope, horizon, mu_target, obs_t, obs_tm1, mu_t, mu_tm1):
    """Inferência explícita com observações fornecidas; não gera séries ausentes."""
    weights = artifacts()[1]["models_by_scope"][scope]["evaluation"][f"h{horizon}"]["weights_f2"]
    features = extract_physical_features(obs_t, obs_tm1, mu_t, mu_tm1)
    value, anomaly = predict_multivariate_row(mu_target, features, [weights[name] for name in FEATURE_NAMES])
    return {"predicted_1km_cells": value, "anomaly_pct": anomaly, "features": dict(zip(FEATURE_NAMES, features)), "weights": weights, "scope": scope, "horizon_weeks": horizon, "provenance": "Inferência experimental F2 com entradas explícitas fornecidas pelo chamador; os valores fornecidos não são verificados pela API."}
