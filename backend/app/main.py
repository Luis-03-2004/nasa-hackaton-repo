from contextlib import asynccontextmanager
import os
from itertools import islice
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from app import forecast, local_observations
from app.database import STORAGE
from app.workload import WorkloadMiddleware, configure_arrow_threads
from datetime import date
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement
from starlette.responses import StreamingResponse

from app.database import Base, SessionLocal, engine, get_db
from app.features import FeatureExtractor, observation_filters
from app.models import FireObservation
from app.schemas import (
    AreaFeatures,
    AreaQuery,
    AreaResponse,
    FirePointRead,
    InferenceQuery,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_arrow_threads()
    if STORAGE == "sql":
        Base.metadata.create_all(bind=engine)
    elif STORAGE != "parquet":
        raise ValueError("FIRE_STORAGE deve ser parquet ou sql")
    forecast.artifacts()
    yield


app = FastAPI(
    title="Fire Observations API",
    description=(
        "Query 2000–2025 MODIS and VIIRS observations by rectangular area. "
        "The source data is aggregated by 1 km cell and ISO week."
    ),
    version="1.0.0",
    lifespan=lifespan,
)
DatabaseSession = Annotated[Session, Depends(get_db)]


def query_date_range(
    start_date: date | None,
    end_date: date | None,
) -> tuple[date, date]:
    start = start_date or date(2025, 1, 1)
    end = end_date or date(2025, 12, 31)
    if start < date(2000, 1, 1) or end > date(2025, 12, 31):
        raise HTTPException(422, "O recorte disponível é 2000–2025")
    if start > end:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="start_date must be on or before end_date",
        )
    return start, end


def validate_area(area: AreaQuery) -> None:
    if area.top_left_lat < area.bottom_right_lat:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="top_left_lat must be greater than or equal to bottom_right_lat",
        )
    if area.top_left_lon > area.bottom_right_lon:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="top_left_lon must be less than or equal to bottom_right_lon",
        )


def stream_hotspots(
    filters: tuple[ColumnElement[bool], ...],
) -> Iterator[bytes]:
    yield b"["
    first = True
    with SessionLocal() as db:
        statement = (
            select(FireObservation)
            .where(*filters)
            .order_by(FireObservation.id)
            .execution_options(yield_per=1000)
        )
        for point in db.scalars(statement):
            if not first:
                yield b","
            yield FirePointRead.model_validate(point).model_dump_json().encode("utf-8")
            first = False
    yield b"]"


@app.get(
    "/hotspots",
    response_model=list[FirePointRead],
    tags=["fire observations"],
    summary="Stream all hotspots or those within an optional rectangle",
    description=(
        "Returns all matching satellite observations as a streamed JSON array. "
        "When all four rectangle coordinates are omitted, queries the whole world. "
        "The default date range is 2025; local results are limited."
    ),
)
def list_hotspots(
    top_left_lat: Annotated[
        float | None,
        Query(ge=-90, le=90, description="Top edge latitude; omit all bounds for the whole world."),
    ] = None,
    top_left_lon: Annotated[
        float | None,
        Query(ge=-180, le=180, description="Left edge longitude."),
    ] = None,
    bottom_right_lat: Annotated[
        float | None,
        Query(ge=-90, le=90, description="Bottom edge latitude."),
    ] = None,
    bottom_right_lon: Annotated[
        float | None,
        Query(ge=-180, le=180, description="Right edge longitude."),
    ] = None,
    start_date: Annotated[
        date | None,
        Query(description="Inclusive start date; defaults to 2025-01-01."),
    ] = None,
    end_date: Annotated[
        date | None,
        Query(description="Inclusive end date; defaults to 2025-12-31."),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=10000)] = 1000,
) -> StreamingResponse:
    coordinates = (top_left_lat, top_left_lon, bottom_right_lat, bottom_right_lon)
    area = None
    if any(value is not None for value in coordinates):
        if any(value is None for value in coordinates):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Provide all four rectangle coordinates or omit all of them",
            )
        area = AreaQuery(
            top_left_lat=top_left_lat,
            top_left_lon=top_left_lon,
            bottom_right_lat=bottom_right_lat,
            bottom_right_lon=bottom_right_lon,
            start_date=start_date,
            end_date=end_date,
        )
        validate_area(area)

    start, end = query_date_range(start_date, end_date)
    if STORAGE == "parquet":
        local_observations.validate_local_window(area, start, end)
        def local_stream():
            yield b"["
            for index, row in enumerate(islice(local_observations.iter_observations(area, start, end), limit)):
                if index:
                    yield b","
                yield FirePointRead.model_validate(row).model_dump_json().encode()
            yield b"]"
        return StreamingResponse(local_stream(), media_type="application/json", headers={"X-Result-Limit": str(limit)})
    filters = observation_filters(area, start, end)
    return StreamingResponse(
        stream_hotspots(filters),
        media_type="application/json",
    )


@app.get(
    "/observations/area",
    response_model=AreaResponse,
    tags=["fire observations"],
    summary="Retrieve all observations and features in a rectangle",
)
def get_area_observations(
    area: Annotated[AreaQuery, Depends()],
    db: DatabaseSession,
    limit: Annotated[int, Query(ge=1, le=10000)] = 1000,
) -> AreaResponse:
    validate_area(area)
    start_date, end_date = query_date_range(area.start_date, area.end_date)
    filters = observation_filters(area, start_date, end_date)
    if STORAGE == "parquet":
        features, points, truncated = local_observations.scan_area(area, start_date, end_date, limit)
        return AreaResponse(features=features, points=[FirePointRead.model_validate(row) for row in points], truncated=truncated, limit=limit)
    points = db.scalars(
        select(FireObservation)
        .where(*filters)
        .order_by(FireObservation.period_start, FireObservation.satellite, FireObservation.id)
    ).all()
    features = FeatureExtractor(db).extract(area, start_date, end_date)
    return AreaResponse(
        features=features,
        points=[FirePointRead.model_validate(point) for point in points],
    )


@app.get(
    "/observations/area/features",
    response_model=AreaFeatures,
    tags=["fire observations"],
    summary="Calculate fire features in a rectangle",
)
def get_area_features(
    area: Annotated[AreaQuery, Depends()],
    db: DatabaseSession,
) -> AreaFeatures:
    validate_area(area)
    start_date, end_date = query_date_range(area.start_date, area.end_date)
    if STORAGE == "parquet":
        return AreaFeatures.model_validate(local_observations.area_features(area, start_date, end_date))
    return FeatureExtractor(db).extract(area, start_date, end_date)


app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","), allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(WorkloadMiddleware)


@app.get("/health")
def health():
    _, model, points, _ = forecast.artifacts()
    return {"status": "ok", "storage": STORAGE, "world_points": len(points), "data_years": [2000, 2025], "generated_at": model["generated_at"]}


@app.get("/catalog")
def get_catalog():
    return forecast.catalog()


@app.get("/world-points")
def get_world_points():
    return {"points": forecast.artifacts()[2], "provenance": forecast.SNAPSHOT_PROVENANCE}


@app.get("/forecast/location")
def get_location_forecast(lat: Annotated[float, Query(ge=-90, le=90)], lon: Annotated[float, Query(ge=-180, le=180)]):
    return forecast.location_forecast(lat, lon)


@app.post("/forecast/infer")
def infer_forecast(query: InferenceQuery):
    if query.scope not in forecast.NAMES:
        raise HTTPException(422, "Escopo desconhecido")
    return forecast.infer(query.scope, query.horizon, query.mu_target, query.obs_t.model_dump(), query.obs_tm1.model_dump(), query.mu_t, query.mu_tm1)


@app.get("/observations/region-series")
def get_region_series(region: str = "brazil", year: Annotated[int, Query(ge=2000, le=2025)] = 2025):
    if region not in ("global", "brazil"):
        raise HTTPException(422, "A comparação por sensor está disponível para global e brazil")
    return local_observations.region_series(region, year)

# Histórico mundial versionado; rotas legadas permanecem disponíveis.
from app.exploration_routes import router as exploration_router
app.include_router(exploration_router)

from app.forecast_selection_routes import router as forecast_selection_router
app.include_router(forecast_selection_router)
