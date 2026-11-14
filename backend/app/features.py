from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.models import FireObservation
from app.schemas import AreaFeatures, AreaQuery, SatelliteFireCount, YearlyFireCount


def observation_filters(
    area: AreaQuery | None,
    start_date: date,
    end_date: date,
) -> tuple[ColumnElement[bool], ...]:
    filters: list[ColumnElement[bool]] = [
        FireObservation.period_start.between(start_date, end_date)
    ]
    if area is not None:
        filters.extend(
            (
                FireObservation.latitude.between(
                    area.bottom_right_lat,
                    area.top_left_lat,
                ),
                FireObservation.longitude.between(
                    area.top_left_lon,
                    area.bottom_right_lon,
                ),
            )
        )
    return tuple(filters)


class FeatureExtractor:
    def __init__(self, db: Session) -> None:
        self.db = db

    def extract(
        self,
        area: AreaQuery,
        start_date: date,
        end_date: date,
    ) -> AreaFeatures:
        filters = observation_filters(area, start_date, end_date)
        last_fire, observations, detections = self.db.execute(
            select(
                func.max(FireObservation.period_start),
                func.count(FireObservation.id),
                func.coalesce(func.sum(FireObservation.merged_count), 0),
            ).where(*filters)
        ).one()

        yearly_rows = self.db.execute(
            select(
                FireObservation.year,
                func.count(FireObservation.id),
                func.coalesce(func.sum(FireObservation.merged_count), 0),
            )
            .where(*filters)
            .group_by(FireObservation.year)
            .order_by(FireObservation.year)
        ).all()
        satellite_rows = self.db.execute(
            select(
                FireObservation.satellite,
                func.count(FireObservation.id),
                func.coalesce(func.sum(FireObservation.merged_count), 0),
            )
            .where(*filters)
            .group_by(FireObservation.satellite)
            .order_by(FireObservation.satellite)
        ).all()

        return AreaFeatures(
            last_fire=last_fire,
            observations_total=observations,
            detections_total=detections,
            fires_per_year=[
                YearlyFireCount(year=year, observations=count, detections=total)
                for year, count, total in yearly_rows
            ],
            by_satellite=[
                SatelliteFireCount(satellite=name, observations=count, detections=total)
                for name, count, total in satellite_rows
            ],
        )
