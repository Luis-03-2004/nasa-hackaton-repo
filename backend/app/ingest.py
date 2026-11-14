import os
import re
from pathlib import Path
from typing import Iterator

import pyarrow.parquet as parquet
from pyarrow import RecordBatch
from sqlalchemy import func, select
from sqlalchemy.engine import Connection

from app.database import engine
from app.dates import observation_week_start
from app.models import FireObservation


SOURCE_COLUMNS = (
    "year",
    "month",
    "iso_week",
    "country",
    "tile_lat",
    "tile_lon",
    "lat_1km",
    "lon_1km",
    "merged_count",
    "pass_count",
    "frp_sum",
    "frp_max",
    "bright_max",
    "bright_mean",
    "bright_bg_mean",
    "bright_bg_min",
    "day_count",
    "night_count",
    "high_conf_count",
)
DESTINATION_COLUMNS = (
    "satellite",
    "year",
    "source_row_index",
    "month",
    "iso_week",
    "period_start",
    "country",
    "tile_lat",
    "tile_lon",
    "lat_1km",
    "lon_1km",
    "latitude",
    "longitude",
    "merged_count",
    "pass_count",
    "frp_sum",
    "frp_max",
    "bright_max",
    "bright_mean",
    "bright_bg_mean",
    "bright_bg_min",
    "day_count",
    "night_count",
    "high_conf_count",
)
BATCH_SIZE = 50_000
YEAR_IN_FILENAME = re.compile(r"_(\d{4})_")


def configured_years() -> tuple[int, ...]:
    raw_years = os.environ.get("FIRE_DATA_YEARS", "2025")
    try:
        years = tuple(sorted({int(year.strip()) for year in raw_years.split(",")}))
    except ValueError as error:
        raise ValueError(
            "FIRE_DATA_YEARS must be a comma-separated list of years, e.g. 2025,2024"
        ) from error
    if not years or any(year < 1 or year > 9998 for year in years):
        raise ValueError("FIRE_DATA_YEARS must contain years from 0001 to 9998")
    return years


def records_from_batch(
    batch: RecordBatch,
    satellite: str,
    expected_year: int,
    first_row_index: int = 0,
) -> Iterator[tuple]:
    columns = [batch.column(index).to_pylist() for index in range(len(SOURCE_COLUMNS))]
    for source_row_index, row in enumerate(
        zip(*columns, strict=True),
        start=first_row_index,
    ):
        year, month, iso_week = row[:3]
        if year != expected_year:
            raise ValueError(f"Unexpected year {year} in {expected_year} data")
        lat_1km, lon_1km = row[6:8]
        yield (
            satellite,
            year,
            source_row_index,
            month,
            iso_week,
            observation_week_start(year, month, iso_week),
            *row[3:8],
            lat_1km / 100,
            lon_1km / 100,
            *row[8:],
        )


def ingest_file(
    path: Path,
    year: int,
    connection: Connection,
) -> tuple[int, int]:
    year_match = YEAR_IN_FILENAME.search(path.name)
    if year_match is None or int(year_match.group(1)) != year:
        raise ValueError(f"Filename does not identify year {year}: {path}")
    satellite = path.name[: year_match.start()]
    if not satellite:
        raise ValueError(f"Filename does not identify a satellite: {path}")

    reader = parquet.ParquetFile(path)
    if reader.schema_arrow.names != list(SOURCE_COLUMNS):
        raise ValueError(f"Unexpected Parquet schema in {path}")

    existing_rows = connection.scalar(
        select(func.count(FireObservation.id)).where(
            FireObservation.satellite == satellite,
            FireObservation.year == year,
        )
    )
    if existing_rows == reader.metadata.num_rows:
        print(f"Skipping {path}: all {existing_rows:,} rows are already loaded.")
        return existing_rows, 0

    driver_connection = connection.connection.driver_connection
    with driver_connection.cursor() as cursor:
        cursor.execute(
            "CREATE TEMP TABLE IF NOT EXISTS fire_observations_staging "
            "ON COMMIT PRESERVE ROWS AS "
            "SELECT "
            + ", ".join(DESTINATION_COLUMNS)
            + " FROM fire_observations WITH NO DATA"
        )
        driver_connection.commit()
        processed = 0
        inserted = 0
        for batch in reader.iter_batches(
            batch_size=BATCH_SIZE,
            columns=list(SOURCE_COLUMNS),
        ):
            with cursor.copy(
                "COPY fire_observations_staging ("
                + ", ".join(DESTINATION_COLUMNS)
                + ") FROM STDIN"
            ) as copy:
                for record in records_from_batch(
                    batch,
                    satellite,
                    year,
                    processed,
                ):
                    copy.write_row(record)
            cursor.execute(
                "INSERT INTO fire_observations ("
                + ", ".join(DESTINATION_COLUMNS)
                + ") SELECT "
                + ", ".join(DESTINATION_COLUMNS)
                + " FROM fire_observations_staging "
                "ON CONFLICT (satellite, year, source_row_index) "
                "DO NOTHING"
            )
            processed += batch.num_rows
            inserted += cursor.rowcount
            cursor.execute("TRUNCATE fire_observations_staging")
            driver_connection.commit()

    return processed, inserted


def main() -> None:
    configured_directory = os.environ.get("PARQUET_DATA_DIR")
    data_directory = Path(
        configured_directory or Path(__file__).resolve().parents[1] / "data"
    )
    if not data_directory.is_dir():
        raise FileNotFoundError(f"Parquet data directory does not exist: {data_directory}")

    years = configured_years()
    files_by_year: dict[int, list[Path]] = {year: [] for year in years}
    for path in sorted(data_directory.rglob("*.parquet")):
        match = YEAR_IN_FILENAME.search(path.name)
        if match is not None:
            year = int(match.group(1))
            if year in files_by_year:
                files_by_year[year].append(path)

    missing_years = [year for year, paths in files_by_year.items() if not paths]
    if missing_years:
        missing = ", ".join(str(year) for year in missing_years)
        raise FileNotFoundError(
            f"No Parquet files found for configured year(s) {missing} in {data_directory}"
        )

    files = [
        (year, path)
        for year, paths in files_by_year.items()
        for path in paths
    ]
    if not files:
        raise FileNotFoundError(f"No Parquet files found in {data_directory}")

    FireObservation.__table__.create(bind=engine, checkfirst=True)
    total_processed = 0
    total_inserted = 0
    with engine.connect() as connection:
        for year, path in files:
            print(f"Importing {path}...")
            processed, inserted = ingest_file(path, year, connection)
            total_processed += processed
            total_inserted += inserted
            print(f"  rows read: {processed:,}; rows inserted: {inserted:,}")
    print(
        f"Done: {total_inserted:,} new observations inserted "
        f"from {total_processed:,} source rows."
    )


if __name__ == "__main__":
    main()
