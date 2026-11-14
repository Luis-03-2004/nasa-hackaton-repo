from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class AreaQuery(BaseModel):
    top_left_lat: float = Field(ge=-90, le=90, description="Latitude of the rectangle's top edge.")
    top_left_lon: float = Field(ge=-180, le=180, description="Longitude of the rectangle's left edge.")
    bottom_right_lat: float = Field(
        ge=-90,
        le=90,
        description="Latitude of the rectangle's bottom edge.",
    )
    bottom_right_lon: float = Field(
        ge=-180,
        le=180,
        description="Longitude of the rectangle's right edge.",
    )
    start_date: date | None = Field(
        default=None,
        description="Inclusive start date; defaults to five years before today.",
    )
    end_date: date | None = Field(
        default=None,
        description="Inclusive end date; defaults to today.",
    )

class FirePointRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    satellite: str
    year: int
    source_row_index: int
    month: int
    iso_week: int
    period_start: date = Field(
        description="Monday of the ISO week; an approximate date for this aggregated record."
    )
    country: str | None
    tile_lat: int
    tile_lon: int
    lat_1km: int
    lon_1km: int
    latitude: float = Field(description="Latitude derived from lat_1km divided by 100.")
    longitude: float = Field(description="Longitude derived from lon_1km divided by 100.")
    merged_count: int
    pass_count: int
    frp_sum: float | None
    frp_max: float | None
    bright_max: float | None
    bright_mean: float | None
    bright_bg_mean: float | None
    bright_bg_min: float | None
    day_count: int
    night_count: int
    high_conf_count: int


class YearlyFireCount(BaseModel):
    year: int
    observations: int = Field(description="Number of satellite/cell/week records.")
    detections: int = Field(
        description="Sum of merged_count; counts detections represented by the records."
    )


class SatelliteFireCount(BaseModel):
    satellite: str
    observations: int
    detections: int


class AreaFeatures(BaseModel):
    last_fire: date | None = Field(
        description="Most recent observed ISO-week start date; not an exact detection date."
    )
    observations_total: int
    detections_total: int
    fires_per_year: list[YearlyFireCount]
    by_satellite: list[SatelliteFireCount]


class AreaResponse(BaseModel):
    features: AreaFeatures
    points: list[FirePointRead]
