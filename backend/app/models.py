from datetime import date

from sqlalchemy import (
    BigInteger,
    Date,
    Float,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FireObservation(Base):
    __tablename__ = "fire_observations"
    __table_args__ = (
        UniqueConstraint(
            "satellite",
            "year",
            "source_row_index",
            name="uq_fire_observation_source_row",
        ),
        Index("ix_fire_observations_period_start", "period_start"),
        Index("ix_fire_observations_location", "latitude", "longitude"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    satellite: Mapped[str] = mapped_column(String(32), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    source_row_index: Mapped[int] = mapped_column(BigInteger, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    iso_week: Mapped[int] = mapped_column(Integer, nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    country: Mapped[str | None] = mapped_column(String, nullable=True)
    tile_lat: Mapped[int] = mapped_column(Integer, nullable=False)
    tile_lon: Mapped[int] = mapped_column(Integer, nullable=False)
    lat_1km: Mapped[int] = mapped_column(Integer, nullable=False)
    lon_1km: Mapped[int] = mapped_column(Integer, nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    merged_count: Mapped[int] = mapped_column(Integer, nullable=False)
    pass_count: Mapped[int] = mapped_column(Integer, nullable=False)
    frp_sum: Mapped[float | None] = mapped_column(Float, nullable=True)
    frp_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    bright_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    bright_mean: Mapped[float | None] = mapped_column(Float, nullable=True)
    bright_bg_mean: Mapped[float | None] = mapped_column(Float, nullable=True)
    bright_bg_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    day_count: Mapped[int] = mapped_column(Integer, nullable=False)
    night_count: Mapped[int] = mapped_column(Integer, nullable=False)
    high_conf_count: Mapped[int] = mapped_column(Integer, nullable=False)
