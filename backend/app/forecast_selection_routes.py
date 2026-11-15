"""Contrato HTTP da projeção experimental por seleção e referência comum."""
from datetime import date
from copy import deepcopy
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.forecast_selection import forecast_selection

router=APIRouter(tags=['experimental common-reference forecast'])


class ForecastSelectionQuery(BaseModel):
    country: str | None = None
    point_ids: list[str] = Field(default_factory=list,max_length=100000)
    reference_date: date = date(2025,12,22)
    locale: Literal['pt-BR','en'] = 'pt-BR'


@router.post('/forecast/selection')
def selection_forecast(query: ForecastSelectionQuery):
    try:
        response=deepcopy(forecast_selection(query.country,query.point_ids,query.reference_date.isoformat(),query.locale))
        if not query.point_ids:
            from app import exploration
            exploration.ensure_cube(query.locale)
            with exploration._connect() as db:
                historical=exploration._selected_count(db,{'country':query.country,'point_ids':[]})
            coverage=response['coverage']
            coverage['historical_selection_count']=historical
            coverage['selected_count']=max(historical,coverage['selected_count'])
            coverage['missing_count']=max(0,coverage['selected_count']-coverage['processed_count'])
        return response
    except ValueError as error:
        raise HTTPException(422,str(error)) from error
