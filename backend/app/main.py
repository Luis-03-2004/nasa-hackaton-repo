from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
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
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="Fire Observations API",
    description=(
        "Query 2025 MODIS and VIIRS observations by rectangular area. "
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
    today = datetime.now(timezone.utc).date()
    try:
        earliest = today.replace(year=today.year - 5)
    except ValueError:
        earliest = today.replace(year=today.year - 5, day=28)

    start = start_date or earliest
    end = end_date or today
    if start < earliest:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"start_date cannot be earlier than {earliest.isoformat()}",
        )
    if end > today:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"end_date cannot be later than {today.isoformat()}",
        )
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
        "The default date range is the last five years."
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
        Query(description="Inclusive start date; defaults to five years ago."),
    ] = None,
    end_date: Annotated[
        date | None,
        Query(description="Inclusive end date; defaults to today."),
    ] = None,
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
) -> AreaResponse:
    validate_area(area)
    start_date, end_date = query_date_range(area.start_date, area.end_date)
    filters = observation_filters(area, start_date, end_date)
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
    return FeatureExtractor(db).extract(area, start_date, end_date)
