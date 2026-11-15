"""Assistente contextual com Guardrails em 3 camadas, Tool Calling e integração Groq."""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
import json
import os
import re
import sqlite3
import time
import unicodedata
import urllib.error
import urllib.request
from typing import Any

from app import exploration, forecast
from app.forecast_selection import cache_path as f2_cache_path, forecast_selection

GROQ_API_URL = os.getenv("GROQ_API_URL", "https://api.groq.com/openai/v1/chat/completions")
GROQ_PRIMARY_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
GROQ_FALLBACK_MODEL = os.getenv("GROQ_FALLBACK_MODEL", "openai/gpt-oss-20b")
GROQ_THIRD_MODEL = "qwen/qwen3.8-27b"


def resolve_groq_api_key() -> str:
    for var_name in ("GROQ_API_KEY", "GROK_API_KEY"):
        env_val = (os.getenv(var_name) or "").strip()
        if env_val:
            return env_val
    for parent in Path(__file__).resolve().parents:
        for filename in (".env", "backend.env"):
            env_file = parent / filename
            if env_file.is_file():
                try:
                    for line in env_file.read_text(encoding="utf-8").splitlines():
                        line = line.strip()
                        if line.startswith(("GROQ_API_KEY=", "GROK_API_KEY=")):
                            val = line.split("=", 1)[1].strip().strip("'\"")
                            if val:
                                return val
                except OSError:
                    pass
    return ""

SYSTEM_KNOWLEDGE_MD = """
# Official System Guide — BAT (Brightness Anomaly Tracker, 2000–2025)

## 1. Scientific Scope
- **Official temporal coverage:** `2000-01-01` to `2025-12-31` (26 years across 203 countries/territories).
- **Sensors:** `MODIS` (2000–2025; Nov–Dec only in 2000), `VIIRS S-NPP` (2012–2025, 375m merged to 1km), `VIIRS NOAA-20 / JPSS-1` (2018–2025).
- **Metrics:**
  - `records`: legacy `cell (1 km) × month × ISO week × sensor` records.
  - `detections`: sum of sub-pixel passes (`merged_count`) in 1 km cells.
  - `frp`: sum of Fire Radiative Power (MW).
  - `harmonized`: linear `M2-V2` index calibrating VIIRS and MODIS across climate zones, months, and eras.
- **Zero (`0`):** `0` means no registered detection in available files (clouds/orbital geometry); it does not prove absence of fire.

## 2. Panels & Actions
1. **2D Map / 3D Globe:** Click a point to select its `1° × 1°` cell; `Ctrl + Click` selects the country of that point; `Shift + Click` / `Shift + Drag` selects multiple points/areas; clicking `World` clears country selection and shows the full world; `My GPS` highlights and focuses your location.
2. **Calendar Chart (`CalendarChart`):** Monthly activity matrix (`2000–2025`) vs `2003–2023` climatological baseline (`anomaly_pct` and `anomaly_zscore`).
3. **Time Series (`HistoryChart`):** Temporal evolution and sensor comparison (`MODIS`, `VIIRS S-NPP`, `VIIRS NOAA-20`).
4. **Experimental Forecast (`SelectionForecast` — Model F₂):** Projects 1–4 weeks ahead (`t+1..t+4`) using physically constrained Ridge L₂ regression over 6 physical drivers (recent anomalies, FRP, thermal contrast ΔT, night fraction, subpixel density), with explicit `F₀` climatological fallback.
""".strip()

# Camada 1: Padrões de Prompt Injection e Assuntos Fora de Escopo óbvios
INJECTION_PATTERNS = re.compile(
    r"(ignore\s+(all\s+)?(previous|prior|above)\s+instructions|"
    r"esque[cç]a\s+(todas\s+as\s+)?instru[cç][oõ]es|"
    r"system\s*prompt|jailbreak|dan\s+mode|"
    r"finja\s+que\s+voc[eê]\s+[eé]|act\s+as\s+a\s+(?!nasa|bat|brightness))",
    re.IGNORECASE,
)

OFF_TOPIC_PATTERNS = re.compile(
    r"\b(receita\s+de\s+bolo|piada|hor[oó]scopo|futebol|campeonato\s+brasileiro|"
    r"bitcoin|criptomoeda|namoro|poema|poesia|filme\s+da\s+netflix)\b",
    re.IGNORECASE,
)

COORD_REGEX = re.compile(
    r"(?:lat(?:itude)?\s*[:=]?\s*)?([+-]?\d{1,2}(?:[.,]\d+)?)\s*(?:°|\s|,|;|\s+e\s+|\s+lon(?:gitude)?\s*[:=]?\s*)\s*([+-]?\d{1,3}(?:[.,]\d+)?)"
)

COUNTRY_ALIASES: dict[str, str] = {
    "brasil": "Brazil",
    "brazil": "Brazil",
    "estadosunidos": "United_States",
    "eua": "United_States",
    "usa": "United_States",
    "unitedstates": "United_States",
    "canada": "Canada",
    "argentina": "Argentina",
    "bolivia": "Bolivia",
    "paraguai": "Paraguay",
    "paraguay": "Paraguay",
    "chile": "Chile",
    "peru": "Peru",
    "colombia": "Colombia",
    "venezuela": "Venezuela",
    "mexico": "Mexico",
    "portugal": "Portugal",
    "espanha": "Spain",
    "spain": "Spain",
    "franca": "France",
    "france": "France",
    "italia": "Italy",
    "italy": "Italy",
    "grecia": "Greece",
    "greece": "Greece",
    "australia": "Australia",
    "indonesia": "Indonesia",
    "india": "India",
    "china": "China",
    "russia": "Russia",
    "angola": "Angola",
    "mocambique": "Mozambique",
    "mozambique": "Mozambique",
    "congo": "Democratic_Republic_of_the_Congo",
    "rdc": "Democratic_Republic_of_the_Congo",
    "republicademocraticadocongo": "Democratic_Republic_of_the_Congo",
}

MONTH_NAMES_PT = {
    "janeiro": 1, "fevereiro": 2, "marco": 3, "abril": 4,
    "maio": 5, "junho": 6, "julho": 7, "agosto": 8,
    "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12,
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}


def _norm(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", text.lower())
        if unicodedata.category(c) != "Mn"
    )


def _clean_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", _norm(text))


def resolve_country_from_text(text: str, fallback_country: str | None = None) -> str | None:
    norm_text = _norm(text)
    if re.search(r"\b(mundo|global|world|planeta)\b", norm_text):
        return None
    words = re.findall(r"[a-z]+", norm_text)
    # Check aliases first (1 to 4 word combinations)
    for size in (4, 3, 2, 1):
        for i in range(len(words) - size + 1):
            candidate = "".join(words[i : i + size])
            if candidate in COUNTRY_ALIASES:
                return COUNTRY_ALIASES[candidate]
    # Check against database countries
    try:
        catalog_countries = exploration.countries().get("countries", [])
        for item in catalog_countries:
            cid = item["id"]
            cname = _clean_key(item["name"])
            if cname and len(cname) >= 4 and cname in _clean_key(norm_text):
                return cid
    except Exception:
        pass
    return fallback_country


def extract_coordinates_from_text(text: str) -> tuple[float, float] | None:
    pt_match = re.search(r"\bpt_([+-]\d{2})_([+-]\d{3})\b", text)
    if pt_match:
        return float(pt_match.group(1)) + 0.5, float(pt_match.group(2)) + 0.5
    # Remove year patterns like 2000-2025 or dates 2025-12-31 before matching coords
    cleaned = re.sub(r"\b(19|20)\d{2}[-/]\d{1,2}([-/]\d{1,2})?\b", " ", text)
    cleaned = re.sub(r"\b(19|20)\d{2}\s*(?:a|ate|to|-|–)\s*(19|20)\d{2}\b", " ", cleaned, flags=re.IGNORECASE)
    for match in COORD_REGEX.finditer(cleaned):
        try:
            lat = float(match.group(1).replace(",", "."))
            lon = float(match.group(2).replace(",", "."))
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                # Avoid mistaking simple integers like "1 a 4 semanas" for coords unless explicit negative/decimal/coord word
                raw_pair = match.group(0)
                if "," in raw_pair or "." in raw_pair or "-" in raw_pair or "lat" in text.lower() or "coord" in text.lower():
                    return lat, lon
        except ValueError:
            continue
    return None


def guardrails_precheck(message: str, locale: str = "en") -> dict[str, Any] | None:
    """Camada 1 do Guardrail: bloqueio rápido em Python sem custo de LLM."""
    text = message.strip()
    if not text:
        return {
            "blocked": True,
            "reply": (
                "Envie uma pergunta sobre o BAT (Brightness Anomaly Tracker)."
                if locale == "pt-BR"
                else "Please send a question about BAT (Brightness Anomaly Tracker)."
            ),
        }
    if INJECTION_PATTERNS.search(text) or OFF_TOPIC_PATTERNS.search(text):
        return {
            "blocked": True,
            "reply": (
                "Sou o assistente exclusivo do **BAT (Brightness Anomaly Tracker)**. "
                "Respondo apenas dúvidas sobre a plataforma, gráficos e consultas de anomalias térmicas/queimadas."
                if locale == "pt-BR"
                else "I am the dedicated **BAT (Brightness Anomaly Tracker)** assistant. "
                "I only answer questions about the platform, charts, and fire/brightness anomaly data."
            ),
        }
    return None


# ============================================================================
# FERRAMENTAS INTERNAS DE DADOS (GROUNDING NO SQLITE / PARQUET)
# ============================================================================

def tool_get_recent_or_weekly_summary(
    country: str | None = None,
    days_or_weeks: int = 7,
    end_date_str: str = "2025-12-31",
) -> dict[str, Any]:
    """
    Consulta os últimos N dias/semanas na base oficial (até 2025-12-31).
    Tenta primeiro a série diária se for de um país em 1 ano e o cache existir;
    caso contrário usa o banco semanal indexado (`weekly.sqlite`) que é instantâneo na t3.micro.
    """
    try:
        ref_end = date.fromisoformat(end_date_str[:10])
    except ValueError:
        ref_end = date(2025, 12, 31)
    if ref_end > date(2025, 12, 31):
        ref_end = date(2025, 12, 31)
    if ref_end < date(2000, 1, 1):
        ref_end = date(2025, 12, 31)

    window_days = max(7, min(90, int(days_or_weeks)))
    ref_start = max(date(ref_end.year, 1, 1), ref_end - timedelta(days=window_days - 1))

    # 1. Tenta o banco semanal indexado F2 (2012-2025) que já está pronto em SQLite e responde em <5ms
    w_path = f2_cache_path()
    if w_path.is_file() and ref_end.year >= 2012:
        try:
            with sqlite3.connect(w_path, timeout=15) as db:
                where = ["iso_year = ?"]
                params: list[Any] = [ref_end.year]
                if country:
                    where.append("country = ?")
                    params.append(country)
                rows = db.execute(
                    f"""
                    SELECT iso_year, iso_week, sensor,
                           SUM(cells) AS cells, SUM(merged) AS detections,
                           SUM(frp) AS frp_mw, COUNT(DISTINCT point_id) AS active_1deg_cells
                    FROM weekly
                    WHERE {' AND '.join(where)}
                    GROUP BY iso_year, iso_week, sensor
                    ORDER BY iso_year DESC, iso_week DESC
                    """,
                    params,
                ).fetchall()
            if rows:
                by_week: dict[tuple[int, int], dict[str, Any]] = {}
                for y, w, sensor, cells, detections, frp_mw, active_1deg in rows:
                    item = by_week.setdefault(
                        (int(y), int(w)),
                        {
                            "iso_year": int(y),
                            "iso_week": int(w),
                            "approx_week_start": date.fromisocalendar(int(y), min(52, int(w)), 1).isoformat(),
                            "approx_week_end": (date.fromisocalendar(int(y), min(52, int(w)), 1) + timedelta(days=6)).isoformat(),
                            "records_1km_cells": 0.0,
                            "detections_merged": 0.0,
                            "frp_sum_mw": 0.0,
                            "sensors": {},
                        },
                    )
                    item["records_1km_cells"] = round(item["records_1km_cells"] + float(cells or 0), 1)
                    item["detections_merged"] = round(item["detections_merged"] + float(detections or 0), 1)
                    item["frp_sum_mw"] = round(item["frp_sum_mw"] + float(frp_mw or 0), 2)
                    item["sensors"][sensor] = round(float(cells or 0), 1)

                sorted_weeks = sorted(by_week.values(), key=lambda x: (x["iso_year"], x["iso_week"]), reverse=True)
                n_weeks = max(1, round(window_days / 7))
                recent_weeks = sorted_weeks[: max(4, n_weeks)]
                latest_week = recent_weeks[0]
                return {
                    "tool": "recent_weekly_summary",
                    "scope": country or "World (Global)",
                    "archive_notice": "The consolidated BAT archive covers 2000-01-01 to 2025-12-31. Recent days/weeks refer to the latest recorded weeks in 2025.",
                    "latest_7_days_week": latest_week,
                    "recent_weeks_breakdown": recent_weeks,
                    "total_in_recent_window": {
                        "weeks_included": len(recent_weeks[:n_weeks]),
                        "records_1km_cells": round(sum(w["records_1km_cells"] for w in recent_weeks[:n_weeks]), 1),
                        "detections_merged": round(sum(w["detections_merged"] for w in recent_weeks[:n_weeks]), 1),
                        "frp_sum_mw": round(sum(w["frp_sum_mw"] for w in recent_weeks[:n_weeks]), 2),
                    },
                }
        except Exception:
            pass

    # Fallback para o cubo mensal SQLite
    return tool_query_historical_summary(
        country=country,
        start_date=f"{ref_end.year}-01-01",
        end_date=f"{ref_end.year}-12-31",
        resolution="monthly",
        metric="records",
    )


def tool_query_historical_summary(
    country: str | None = None,
    point_ids: list[str] | None = None,
    start_date: str = "2000-01-01",
    end_date: str = "2025-12-31",
    resolution: str = "monthly",
    metric: str = "records",
    locale: str = "pt-BR",
) -> dict[str, Any]:
    """Consulta o cubo histórico SQLite (2000–2025) e retorna um resumo enxuto para a LLM."""
    if resolution not in ("monthly", "yearly"):
        resolution = "monthly"
    if metric not in ("records", "detections", "frp", "harmonized"):
        metric = "records"
    try:
        res = exploration.query_analysis(
            {
                "country": country,
                "point_ids": point_ids or [],
                "start_date": start_date,
                "end_date": end_date,
                "months": [],
                "sensors": list(exploration.SENSORS),
                "metric": metric,
                "resolution": resolution,
                "locale": locale,
            }
        )
    except Exception as exc:
        return {"tool": "historical_summary", "error": str(exc)}

    series = [row for row in res.get("timeseries", []) if row.get("value") is not None]
    peak = max(series, key=lambda r: r.get("value") or 0) if series else None
    recent_slice = series[-6:] if len(series) > 6 else series

    return {
        "tool": "historical_summary",
        "scope": country or ("Seleção de pontos" if point_ids else "World (Global)"),
        "point_ids_count": len(point_ids or []),
        "period": f"{res.get('coverage', {}).get('effective_start', start_date)} a {res.get('coverage', {}).get('effective_end', end_date)}",
        "resolution": resolution,
        "metric": metric,
        "unit": res.get("unit"),
        "totals": {
            "selected_metric_value": round(float(res["totals"].get("value") or 0), 2),
            "records_cell_week_sensor": round(float(res["totals"].get("records") or 0), 1),
            "detections_merged": round(float(res["totals"].get("detections") or 0), 1),
            "frp_sum_mw": round(float(res["totals"].get("frp") or 0), 2),
        },
        "spatial_coverage": {
            "selected_1deg_cells": res.get("selected_count"),
            "active_1deg_cells": res.get("processed_count"),
            "zero_record_cells": res.get("missing_count"),
        },
        "peak_period": {
            "period": peak["period"],
            "value": round(float(peak["value"]), 2),
            "anomaly_pct": round(float(peak["anomaly_pct"]), 2) if peak.get("anomaly_pct") is not None else None,
        }
        if peak
        else None,
        "latest_periods": [
            {
                "period": r["period"],
                "value": round(float(r["value"] or 0), 2),
                "anomaly_pct": round(float(r["anomaly_pct"]), 1) if r.get("anomaly_pct") is not None else None,
                "sensors": {k: round(float(v), 1) if v is not None else None for k, v in (r.get("sensors") or {}).items()},
            }
            for r in recent_slice
        ],
    }


def tool_query_coordinate_or_region(lat: float, lon: float, locale: str = "pt-BR") -> dict[str, Any]:
    """Consulta o ponto terrestre mais próximo no catálogo F₂ + histórico da célula de 1° no cubo."""
    lat = max(-90.0, min(90.0, float(lat)))
    lon = max(-180.0, min(180.0, float(lon)))
    loc_data = forecast.location_forecast(lat, lon)
    nearest = loc_data.get("nearest_point", {})
    fc = loc_data.get("forecast", {})
    cell_lat = max(-90, min(89, int(lat // 1)))
    cell_lon = max(-180, min(179, int(lon // 1)))
    pid = exploration.point_id(cell_lat, cell_lon)

    cell_history = tool_query_historical_summary(
        country=None,
        point_ids=[pid],
        start_date="2025-01-01",
        end_date="2025-12-31",
        resolution="monthly",
        metric="records",
        locale=locale,
    )

    return {
        "tool": "coordinate_and_region_analysis",
        "queried_coordinates": {"lat": round(lat, 4), "lon": round(lon, 4)},
        "grid_cell_1deg": pid,
        "nearest_catalog_land_point": {
            "point_id": nearest.get("point_id"),
            "country": str(nearest.get("country", "")).replace("_", " "),
            "climatic_zone": nearest.get("zone"),
            "lat_center": nearest.get("lat_center"),
            "lon_center": nearest.get("lon_center"),
            "distance_km": nearest.get("distance_km"),
        },
        "f2_snapshot_at_nearest_point": {
            "reference_date": fc.get("reference_date"),
            "reference_year": fc.get("reference_year"),
            "reference_iso_week": fc.get("reference_iso_week"),
            "alert_level": fc.get("alert_level"),
            "observed_1km_cells_in_ref_week": fc.get("drivers", {}).get("observed_1km_cells"),
            "observed_frp_mw_in_ref_week": fc.get("drivers", {}).get("frp_sum_mw"),
            "thermal_contrast_delta_t_k": fc.get("drivers", {}).get("delta_t_k"),
            "forecast_1_to_4_weeks_cells": {
                "h1_week": fc.get("forecast_w1"),
                "h2_weeks": fc.get("forecast_w2"),
                "h3_weeks": fc.get("forecast_w3"),
                "h4_weeks": fc.get("forecast_w4"),
            },
            "forecast_anomaly_pct": fc.get("anomaly_pct"),
            "skill_f2_vs_f0_pct": fc.get("validation", {}).get("skill_f2_vs_f0_pct"),
        },
        "year_2025_cell_history": cell_history,
    }


def tool_query_f2_selection(
    country: str | None = None,
    point_ids: list[str] | None = None,
    reference_date: str = "2025-12-22",
    locale: str = "pt-BR",
) -> dict[str, Any]:
    """Consulta a projeção experimental F₂ para um país ou seleção de pontos."""
    try:
        res = forecast_selection(country, point_ids or [], reference_date, locale)
        return {
            "tool": "f2_selection_forecast",
            "scope": country or ("Seleção de pontos" if point_ids else "World (Global)"),
            "available": res.get("available"),
            "reference_date": res.get("reference_date"),
            "period_end": res.get("period_end"),
            "observed_in_reference_week": res.get("observed"),
            "forecasts_h1_to_h4": res.get("forecasts"),
            "coverage": res.get("coverage"),
            "reason": res.get("reason"),
        }
    except Exception as exc:
        return {"tool": "f2_selection_forecast", "error": str(exc)}


# ============================================================================
# COLETOR AUTOMÁTICO DE CONTEXTO BASEADO NA PERGUNTA + TELA ATUAL
# ============================================================================

def gather_grounding_context(
    message: str,
    ui_context: dict[str, Any] | None = None,
    locale: str = "pt-BR",
) -> tuple[str, list[dict[str, Any]]]:
    """
    Analisa a pergunta do usuário e o estado da UI para executar em milissegundos
    as ferramentas de dados pertinentes antes de redigir a resposta.
    """
    ui = ui_context or {}
    norm_msg = _norm(message)
    executed_tools: list[dict[str, Any]] = []

    ui_country = ui.get("country") or None
    ui_points = ui.get("point_ids") or []
    ui_start = ui.get("start_date") or "2000-01-01"
    ui_end = ui.get("end_date") or "2025-12-31"
    ui_ref = ui.get("reference_date") or "2025-12-22"

    # 1. Coordenada explícita no texto ou pergunta sobre "minha região / minha localização / onde estou"
    coords = extract_coordinates_from_text(message)
    asks_my_region = bool(
        re.search(r"\b(minha\s+regi[aã]o|minha\s+localiza[cç][aã]o|onde\s+estou|perto\s+de\s+mim|my\s+region|my\s+location|near\s+me|aqui)\b", norm_msg)
    )
    if not coords and asks_my_region:
        if ui.get("user_lat") is not None and ui.get("user_lon") is not None:
            coords = (float(ui["user_lat"]), float(ui["user_lon"]))
        elif ui.get("focus_lat") is not None and ui.get("focus_lon") is not None:
            coords = (float(ui["focus_lat"]), float(ui["focus_lon"]))

    if coords:
        executed_tools.append(tool_query_coordinate_or_region(coords[0], coords[1], locale))

    # 2. País mencionado no texto (ou país selecionado na tela)
    target_country = resolve_country_from_text(message, fallback_country=ui_country)

    # 3. Pergunta sobre "últimos X dias / última semana / resumo recente"
    days_match = re.search(r"\b(?:ultimos|ultimas|last|recent)\s*(\d{1,2})?\s*(dias|day|days|semanas|week|weeks)\b", norm_msg)
    if days_match or re.search(r"\b(resumo\s+de\s+queimada|semana\s+passada|ultima\s+semana|ultimos\s+dias)\b", norm_msg):
        num = int(days_match.group(1)) if (days_match and days_match.group(1)) else 7
        unit_word = days_match.group(2) if days_match else "dias"
        days_count = num * 7 if "sem" in unit_word or "week" in unit_word else num
        executed_tools.append(tool_get_recent_or_weekly_summary(country=target_country, days_or_weeks=days_count, end_date_str=ui_end))

    # 4. Pergunta sobre histórico, ano específico, comparativo ou resumo de país/região
    years_found = [int(m.group(0)) for m in re.finditer(r"\b(200\d|201\d|202[0-5])\b", message)]
    asks_data = bool(
        re.search(
            r"\b(resumo|quantos|quantas|total|historico|serie|queimada|foco|frp|anomalia|pico|pior\s+ano|pior\s+mes|dados|estatistica|status|situacao|como\s+esta)\b",
            norm_msg,
        )
    )
    if asks_data or target_country != ui_country or years_found:
        if years_found:
            y_min, y_max = min(years_found), max(years_found)
            s_date, e_date = f"{y_min}-01-01", f"{y_max}-12-31"
            res_mode = "monthly" if y_min == y_max else "yearly"
        else:
            s_date, e_date = ui_start, ui_end
            res_mode = ui.get("resolution") if ui.get("resolution") in ("monthly", "yearly") else "yearly"

        executed_tools.append(
            tool_query_historical_summary(
                country=target_country,
                point_ids=ui_points if (target_country == ui_country and not coords) else [],
                start_date=s_date,
                end_date=e_date,
                resolution=res_mode,
                metric=ui.get("metric") or "records",
                locale=locale,
            )
        )

    # 5. Pergunta sobre previsão / F2 / próximas semanas / risco futuro
    if re.search(r"\b(f2|f0|previs[aã]o|proje[cç][aã]o|proximas?\s+semanas?|futuro|risco|forecast|horizonte)\b", norm_msg):
        executed_tools.append(
            tool_query_f2_selection(
                country=target_country,
                point_ids=ui_points if target_country == ui_country else [],
                reference_date=ui_ref,
                locale=locale,
            )
        )

    # Se nenhuma tool específica disparou mas há estado na UI, inclui resumo leve do recorte atual da tela
    if not executed_tools:
        executed_tools.append(
            tool_query_historical_summary(
                country=ui_country,
                point_ids=ui_points[:50],
                start_date=ui_start,
                end_date=ui_end,
                resolution="yearly",
                metric=ui.get("metric") or "records",
                locale=locale,
            )
        )

    intent = "data_query" if len(executed_tools) > 0 else "system_guide"
    return intent, executed_tools


# ============================================================================
# INTEGRAÇÃO COM A API DA GROQ (LLAMA 3.3 70B / 3.1 8B) + FALLBACK LOCAL
# ============================================================================

def call_groq_chat(
    message: str,
    history: list[dict[str, str]],
    ui_context: dict[str, Any],
    grounding_data: list[dict[str, Any]],
    locale: str = "en",
) -> tuple[str | None, str]:
    """
    Chama a API da Groq com as 3 camadas de Guardrail e os dados reais do banco injetados.
    Retorna `(resposta, nome_do_modelo)` ou `(None, motivo)` se sem chave/offline.
    """
    api_key = resolve_groq_api_key()
    if not api_key:
        return None, "no_api_key"

    lang_instruction = (
        "Responda SEMPRE em Português (PT-BR) de forma MUITO CURTA, direta e objetiva (máximo de 3 a 4 tópicos curtos ou 80 palavras)."
        if locale == "pt-BR"
        else "ALWAYS respond in English in a VERY SHORT, direct, and concise style (maximum 3–4 short bullet points or ~80 words)."
    )

    system_prompt = f"""You are the **Official Assistant for BAT (Brightness Anomaly Tracker, 2000–2025)**.
{lang_instruction}

### STRICT GUARDRAIL & BREVITY RULES:
1. **Brevity:** Keep answers brief and factual (max 3–4 short bullets, under 90 words). Do NOT include long introductions or unrequested methodology lectures.
2. **Exclusive Scope:** Only answer questions about BAT (controls, 2D/3D map, point selection vs Ctrl+Click country selection, CSV export, Calendar/Series/F₂ charts, or fire/anomaly data by country, period, or coordinate). Refuse off-topic questions in 1 sentence.
3. **Zero Hallucination:** Use ONLY numbers from `DATABASE GROUNDING DATA` below (archive covers `2000-01-01` to `2025-12-31`).

---
### SYSTEM GUIDE:
{SYSTEM_KNOWLEDGE_MD}

---
### UI CONTEXT:
```json
{json.dumps(ui_context, ensure_ascii=False)}
```

### DATABASE GROUNDING DATA:
```json
{json.dumps(grounding_data, ensure_ascii=False)}
```
"""

    messages_payload: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    for item in (history or [])[-4:]:
        role = item.get("role")
        content = str(item.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            messages_payload.append({"role": role, "content": content[:600]})
    messages_payload.append({"role": "user", "content": message.strip()[:500]})

    for model_name in (GROQ_PRIMARY_MODEL, GROQ_FALLBACK_MODEL, GROQ_THIRD_MODEL):
        payload = json.dumps(
            {
                "model": model_name,
                "messages": messages_payload,
                "temperature": 0.05,
                "max_tokens": 900,
            }
        ).encode("utf-8")

        req = urllib.request.Request(
            GROQ_API_URL,
            data=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "BAT-BrightnessAnomalyTracker/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                raw_reply = (body["choices"][0]["message"].get("content") or "").strip()
                reply = re.sub(r"<think>.*?</think>", "", raw_reply, flags=re.DOTALL).strip()
                if reply:
                    return reply, f"groq:{model_name}"
        except urllib.error.HTTPError as http_err:
            if http_err.code in (401, 403):
                return None, "invalid_api_key"
            continue
        except Exception:
            continue

    return None, "groq_unreachable"


def build_local_grounded_reply(
    message: str,
    ui_context: dict[str, Any],
    grounding_data: list[dict[str, Any]],
    locale: str = "en",
    reason: str = "no_api_key",
) -> str:
    """
    Motor determinístico local conciso (PT-BR / EN) usando os dados reais consultados no SQLite/Catálogo.
    """
    norm_msg = _norm(message)
    is_pt = locale == "pt-BR"
    parts: list[str] = []

    asks_my_region = bool(
        re.search(r"\b(minha\s+regi[aã]o|minha\s+localiza[cç][aã]o|onde\s+estou|perto\s+de\s+mim|my\s+region|my\s+location)\b", norm_msg)
    )
    has_coord_tool = any(t.get("tool") == "coordinate_and_region_analysis" for t in grounding_data)
    if asks_my_region and not has_coord_tool:
        parts.append(
            "📍 Clique em **\"Analisar minha região (GPS)\"** no topo do chat ou informe `(lat, lon)`."
            if is_pt
            else "📍 Click **\"Analyze my region (GPS)\"** at the top of the chat or enter `(lat, lon)`."
        )

    for item in grounding_data:
        if item.get("tool") == "coordinate_and_region_analysis":
            q = item["queried_coordinates"]
            np = item["nearest_catalog_land_point"]
            f2 = item["f2_snapshot_at_nearest_point"]
            fc_cells = f2.get("forecast_1_to_4_weeks_cells", {})
            anoms = f2.get("forecast_anomaly_pct") or []
            anom_h1 = f"{anoms[0]:+.1f}%" if anoms and anoms[0] is not None else "—"
            if is_pt:
                parts.append(
                    f"### 📍 `{q['lat']}, {q['lon']}` ({np['country']} · `{np['point_id']}`)\n"
                    f"- **Ref `{f2['reference_date']}`:** `{f2['observed_1km_cells_in_ref_week']}` cél. 1km | FRP `{f2['observed_frp_mw_in_ref_week']} MW` | ΔT `{f2['thermal_contrast_delta_t_k']} K`\n"
                    f"- **Alerta $F_2$:** **{f2['alert_level']}** ({anom_h1}) · `t+1..t+4`: **{fc_cells.get('h1_week')}**, **{fc_cells.get('h2_weeks')}**, **{fc_cells.get('h3_weeks')}**, **{fc_cells.get('h4_weeks')}**"
                )
            else:
                parts.append(
                    f"### 📍 `{q['lat']}, {q['lon']}` ({np['country']} · `{np['point_id']}`)\n"
                    f"- **Ref `{f2['reference_date']}`:** `{f2['observed_1km_cells_in_ref_week']}` 1km cells | FRP `{f2['observed_frp_mw_in_ref_week']} MW` | ΔT `{f2['thermal_contrast_delta_t_k']} K`\n"
                    f"- **$F_2$ Alert:** **{f2['alert_level']}** ({anom_h1}) · `t+1..t+4`: **{fc_cells.get('h1_week')}**, **{fc_cells.get('h2_weeks')}**, **{fc_cells.get('h3_weeks')}**, **{fc_cells.get('h4_weeks')}**"
                )

        elif item.get("tool") == "recent_weekly_summary":
            w = item["latest_7_days_week"]
            tot = item["total_in_recent_window"]
            if is_pt:
                parts.append(
                    f"### 🔥 Recente — **{item['scope']}** (`{w['approx_week_start']}` → `{w['approx_week_end']}`)\n"
                    f"- **Última semana:** `{w['records_1km_cells']:,.1f}` registros | `{w['detections_merged']:,.0f}` detecções | FRP `{w['frp_sum_mw']:,.1f} MW`\n"
                    f"- **Acumulado ({tot['weeks_included']} sem.):** `{tot['records_1km_cells']:,.1f}` registros (`{tot['frp_sum_mw']:,.1f} MW`)"
                )
            else:
                parts.append(
                    f"### 🔥 Recent — **{item['scope']}** (`{w['approx_week_start']}` → `{w['approx_week_end']}`)\n"
                    f"- **Latest week:** `{w['records_1km_cells']:,.1f}` records | `{w['detections_merged']:,.0f}` detections | FRP `{w['frp_sum_mw']:,.1f} MW`\n"
                    f"- **Window total ({tot['weeks_included']} wks):** `{tot['records_1km_cells']:,.1f}` records (`{tot['frp_sum_mw']:,.1f} MW`)"
                )

        elif item.get("tool") == "f2_selection_forecast" and item.get("available"):
            fcs = item.get("forecasts_h1_to_h4") or []
            cov = item.get("coverage") or {}
            summary = " | ".join(f"`t+{f['horizon']}`: **{f['value']:,.1f}** ({f.get('anomaly_pct') or 0:+.1f}%)" for f in fcs)
            parts.append(
                f"### 📈 $F_2$ Forecast — **{item['scope']}** (Ref `{item['reference_date']}`)\n"
                f"- {summary}\n"
                f"- **Coverage:** `{cov.get('processed_count')}` cells (`{cov.get('f2_count')}` $F_2$, `{cov.get('fallback_count')}` $F_0$)."
            )

        elif item.get("tool") == "historical_summary" and not item.get("error"):
            tot = item["totals"]
            peak = item.get("peak_period")
            cov = item.get("spatial_coverage") or {}
            peak_txt = f"`{peak['period']}` ({peak['value']:,.1f})" if peak else "—"
            if is_pt:
                parts.append(
                    f"### 📊 **{item['scope']}** (`{item['period']}`)\n"
                    f"- **Registros:** `{tot['records_cell_week_sensor']:,.0f}` | **Detecções:** `{tot['detections_merged']:,.0f}` | **FRP:** `{tot['frp_sum_mw']:,.1f} MW`\n"
                    f"- **Células ativas:** `{cov.get('active_1deg_cells')}/{cov.get('selected_1deg_cells')}` | **Pico:** {peak_txt}"
                )
            else:
                parts.append(
                    f"### 📊 **{item['scope']}** (`{item['period']}`)\n"
                    f"- **Records:** `{tot['records_cell_week_sensor']:,.0f}` | **Detections:** `{tot['detections_merged']:,.0f}` | **FRP:** `{tot['frp_sum_mw']:,.1f} MW`\n"
                    f"- **Active cells:** `{cov.get('active_1deg_cells')}/{cov.get('selected_1deg_cells')}` | **Peak:** {peak_txt}"
                )

    if re.search(r"\b(grafico|calendario|interpretar|como\s+usar|como\s+faco|filtrar|selecionar|exportar|csv|harmoniza|modis|viirs|f2|f0|mapa|globo|chart|interpret|how\s+to|filter|select|export)\b", norm_msg) and len(parts) <= 1:
        if is_pt:
            parts.append(
                "- **Mapa:** Clique seleciona ponto (`1°`); `Ctrl+Clique` seleciona país; `Shift+Arraste` seleciona área.\n"
                "- **Gráficos:** Calendário mostra anomalias vs `2003–2023`; Série compara MODIS/VIIRS; $F_2$ projeta `t+1..t+4` semanas."
            )
        else:
            parts.append(
                "- **Map:** Click selects a `1°` point; `Ctrl+Click` selects its country; `Shift+Drag` selects an area.\n"
                "- **Charts:** Calendar shows anomalies vs `2003–2023`; Series compares MODIS/VIIRS; $F_2$ projects `t+1..t+4` weeks."
            )

    if not parts:
        parts.append(
            "Pergunte sobre países, períodos, coordenadas `(lat, lon)` ou gráficos do BAT."
            if is_pt
            else "Ask about countries, date ranges, coordinates `(lat, lon)`, or BAT charts."
        )

    return "\n\n".join(parts[:2])
