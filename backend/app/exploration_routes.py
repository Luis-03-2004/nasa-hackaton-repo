"""Contratos para exploração histórica global e multisseleção."""
from datetime import date
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator
from app import exploration

router=APIRouter(prefix='/explore',tags=['global exploration'])

class ExplorationQuery(BaseModel):
    country: str | None = None
    point_ids: list[str] = Field(default_factory=list,max_length=64800)
    start_date: date = date(2000,1,1)
    end_date: date = date(2025,12,31)
    months: list[int] = Field(default_factory=list)
    sensors: list[Literal['modis','viirs-snpp','viirs-jpss1']] = Field(default_factory=lambda:list(exploration.SENSORS))
    metric: Literal['records','detections','frp','harmonized'] = 'records'
    resolution: Literal['monthly','yearly','weekly','daily'] = 'monthly'
    locale: Literal['pt-BR','en'] = 'pt-BR'

@router.get('/status')
def status():
    return exploration.status()

@router.get('/countries')
def countries():
    return exploration.countries()

@router.post('/query')
def query(body:ExplorationQuery):
    return exploration.query_analysis(body.model_dump(mode='json'))

@router.post('/map')
def map_query(body:ExplorationQuery):
    return exploration.query_map(body.model_dump(mode='json'))

class CalendarMonthQuery(BaseModel):
    country: str | None = None
    point_ids: list[str] = Field(default_factory=list,max_length=64800)
    year: int = Field(default=2025,ge=2000,le=2025)
    month: int = Field(default=12,ge=1,le=12)
    sensors: list[Literal['modis','viirs-snpp','viirs-jpss1']] = Field(default_factory=lambda:list(exploration.SENSORS))
    metric: Literal['records','detections','frp','harmonized'] = 'records'
    locale: Literal['pt-BR','en'] = 'pt-BR'

@router.post('/calendar-month')
def calendar_month_query(body:CalendarMonthQuery):
    return exploration.query_calendar_month(body.model_dump(mode='json'))
