"""Consulta limitada de Parquets originais, preservando índice da linha fonte."""
from datetime import date
from pathlib import Path
from collections import defaultdict
import os

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
from fastapi import HTTPException

from app.dates import observation_week_start
from app.forecast import DATA_DIR

PARQUET_DIR = Path(os.getenv("PARQUET_DATA_DIR", DATA_DIR / "parquet_1km"))


def validate_local_window(area, start, end):
    if (end - start).days > 366:
        raise HTTPException(422, "Consulta local detalhada limitada a 366 dias; use /catalog para 2000–2025.")
    if area is not None and (area.top_left_lat - area.bottom_right_lat) * (area.bottom_right_lon - area.top_left_lon) > 25:
        raise HTTPException(422, "Consulta local detalhada limitada a 25 graus quadrados; use /world-points para o mapa global.")


def iter_observations(area, start, end):
    if not PARQUET_DIR.is_dir():
        raise FileNotFoundError(f"Diretório de Parquets ausente: {PARQUET_DIR}")
    for year in range(max(2000, start.year), min(2025, end.year + 1) + 1):
        # Janeiro do ano seguinte pode conter semanas iniciadas em dezembro.
        for path in sorted(PARQUET_DIR.glob(f"*/*_{year}_1km.parquet")):
            sensor = path.name.split(f"_{year}_")[0]
            reader = pq.ParquetFile(path)
            source_offset = 0
            for group_index in range(reader.num_row_groups):
                group = reader.metadata.row_group(group_index)
                group_start = source_offset
                source_offset += group.num_rows
                if area is not None and not _group_intersects(reader, group, area):
                    continue
                offset = group_start
                for batch in reader.iter_batches(batch_size=65_536, row_groups=[group_index]):
                    indexed = batch.append_column("source_row_index", pa.array(range(offset, offset + batch.num_rows), type=pa.int64()))
                    offset += batch.num_rows
                    if area is not None:
                        mask = pc.and_(pc.and_(pc.greater_equal(indexed.column("lat_1km"), area.bottom_right_lat * 100), pc.less_equal(indexed.column("lat_1km"), area.top_left_lat * 100)), pc.and_(pc.greater_equal(indexed.column("lon_1km"), area.top_left_lon * 100), pc.less_equal(indexed.column("lon_1km"), area.bottom_right_lon * 100)))
                        indexed = indexed.filter(mask)
                    for row in indexed.to_pylist():
                        period = observation_week_start(row["year"], row["month"], row["iso_week"])
                        if not start <= period <= end:
                            continue
                        # Stable numeric identifier across local files and row indices.
                        row["id"] = (year * 3 + {"modis": 0, "viirs-snpp": 1, "viirs-jpss1": 2}[sensor]) * 1_000_000_000 + row["source_row_index"]
                        row.update(satellite=sensor, period_start=period, latitude=row["lat_1km"] / 100, longitude=row["lon_1km"] / 100)
                        yield row


def _group_intersects(reader, group, area):
    for column, lower, upper in (("lat_1km", area.bottom_right_lat * 100, area.top_left_lat * 100), ("lon_1km", area.top_left_lon * 100, area.bottom_right_lon * 100)):
        stats = group.column(reader.schema_arrow.names.index(column)).statistics
        if stats is not None and stats.has_min_max and (stats.max < lower or stats.min > upper):
            return False
    return True


def scan_area(area, start, end, limit=0):
    validate_local_window(area, start, end)
    years = defaultdict(lambda: [0, 0])
    sensors = defaultdict(lambda: [0, 0])
    last = None
    total, detections = 0, 0
    points = []
    for row in iter_observations(area, start, end):
        last = max(last, row["period_start"]) if last else row["period_start"]
        total += 1
        if len(points) < limit:
            points.append(row)
        detections += row["merged_count"]
        for bucket in (years[row["year"]], sensors[row["satellite"]]):
            bucket[0] += 1
            bucket[1] += row["merged_count"]
    features = {"last_fire": last, "observations_total": total, "detections_total": detections, "fires_per_year": [{"year": year, "observations": vals[0], "detections": vals[1]} for year, vals in sorted(years.items())], "by_satellite": [{"satellite": sensor, "observations": vals[0], "detections": vals[1]} for sensor, vals in sorted(sensors.items())]}

    return features, points, total > limit


def area_features(area, start, end):
    return scan_area(area, start, end)[0]


from functools import lru_cache


@lru_cache(maxsize=52)
def region_series(region, year):
    """Soma células-semana por sensor, sem deduplicar entre sensores/semanas."""
    regional_dir = DATA_DIR / "parquet_025deg"
    if not regional_dir.is_dir():
        raise HTTPException(503, "Parquets regionais indisponíveis")
    fields = {"modis": "n_modis", "viirs-snpp": "n_viirs_snpp", "viirs-jpss1": "n_viirs_jpss1"}
    rows = [{"month": m, "week_start": f"{year:04}-{m:02}-01", **{field: None for field in fields.values()}} for m in range(1, 13)]
    for sensor, field in fields.items():
        path = regional_dir / sensor / f"{sensor}_{year}_025deg.parquet"
        if not path.is_file():
            continue  # Sensor não disponível naquele ano, não representa zero.
        filters = [("country", "=", "Brazil")] if region == "brazil" else None
        table = pq.read_table(path, columns=["month", "active_1km_cells"], filters=filters)
        totals = {row["month"]: row["active_1km_cells_sum"] for row in table.group_by("month").aggregate([("active_1km_cells", "sum")]).to_pylist()}
        for row in rows:
            row[field] = totals.get(row["month"], 0)
    return {"region": region, "year": year, "temporal_resolution": "monthly", "series": rows, "provenance": "NASA FIRMS / EOSDIS, Parquets 0,25° da equipe: soma mensal de células-semana ativas na grade 0,01° por sensor. São células-semana, não focos individuais, área queimada ou células únicas do mês. Não harmonizadas nem deduplicadas entre sensores. Sensor indisponível = null; 0 = sem registro no arquivo."}
