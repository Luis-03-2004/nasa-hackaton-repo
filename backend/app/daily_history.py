"""Índice diário por país/ano a partir dos arquivos originais existentes.

A unidade diária é ocupação da grade 0,01° por dia/sensor; não reconstruímos
um dia a partir da semana. Cache por sensor/país/ano em derivados separados.
"""
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
import hashlib
import json
import threading
import zipfile

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as pacsv
import pyarrow.parquet as pq
from fastapi import HTTPException

from app.forecast import DATA_DIR

_LOCKS = defaultdict(threading.Lock)


def _source(country,year,sensor):
    root=DATA_DIR.parent
    zip_candidates=[root/sensor/f'{sensor}_{year}_all_countries.zip',root/str(year)/sensor/f'{sensor}_{year}_all_countries.zip']
    for candidate in zip_candidates:
        if candidate.is_file():
            expected=f'{sensor}_{year}_{country}.csv'
            with zipfile.ZipFile(candidate) as archive:
                member=next((m for m in archive.namelist() if Path(m).name==expected),None)
                if member:return candidate,member
    csv_candidates=[root/sensor/str(year)/f'{sensor}_{year}_{country}.csv',root/str(year)/sensor/f'{sensor}_{year}_{country}.csv']
    for candidate in csv_candidates:
        if candidate.is_file():return candidate,None
    return None,None


def _cache(country,year,sensor):
    from app.exploration import CUBE_DIR
    path,member=_source(country,year,sensor)
    if path is None:return None
    stat=path.stat()
    signature=f'{path}:{member}:{stat.st_size}:{stat.st_mtime_ns}:daily-v2.1'
    filename=hashlib.sha256(signature.encode()).hexdigest()+'.parquet'
    target=CUBE_DIR/'daily'/filename
    if target.is_file():return target
    with _LOCKS[filename]:
        if target.is_file():return target
        columns=['latitude','longitude','acq_date','confidence','frp','type']
        options=pacsv.ConvertOptions(include_columns=columns,include_missing_columns=True,column_types={'latitude':pa.float64(),'longitude':pa.float64(),'acq_date':pa.date32(),'confidence':pa.string(),'frp':pa.float64(),'type':pa.int16()})
        if member:
            with zipfile.ZipFile(path) as archive:
                with archive.open(member) as stream:
                    tab=pacsv.read_csv(stream,convert_options=options)
        else:tab=pacsv.read_csv(path,convert_options=options)
        conf=pc.fill_null(tab['confidence'],'')
        if sensor=='modis':
            # Numeric confidence is already verified by source parser; null -> 0.
            mask=pc.greater_equal(pc.cast(pc.if_else(pc.equal(conf,''),'0',conf),pa.float64()),30)
        else:mask=pc.is_in(conf,value_set=pa.array(['n','h','N','H','nominal','high']))
        mask=pc.and_kleene(mask,pc.or_kleene(pc.is_null(tab['type']),pc.equal(tab['type'],0)))
        for col,lo,hi in [('latitude',-90,90),('longitude',-180,180)]:
            mask=pc.and_kleene(mask,pc.and_kleene(pc.greater_equal(tab[col],lo),pc.less_equal(tab[col],hi)))
        mask=pc.and_kleene(mask,pc.is_valid(tab['acq_date']))
        tab=tab.filter(mask)
        lat=pc.cast(pc.floor(pc.multiply(tab['latitude'],100)),pa.int32())
        lon=pc.cast(pc.floor(pc.multiply(tab['longitude'],100)),pa.int32())
        raw=pa.table({'date':tab['acq_date'],'lat1':lat,'lon1':lon,'frp':pc.fill_null(tab['frp'],0.)})
        cells=raw.group_by(['date','lat1','lon1']).aggregate([('frp','count'),('frp','sum')])
        cells=cells.append_column('lat',pc.cast(pc.floor(pc.divide(pc.cast(cells['lat1'],pa.float64()),100)),pa.int16()))
        cells=cells.append_column('lon',pc.cast(pc.floor(pc.divide(pc.cast(cells['lon1'],pa.float64()),100)),pa.int16()))
        cells=cells.append_column('one',pa.repeat(pa.scalar(1,pa.int32()),cells.num_rows))
        aggregated=cells.group_by(['date','lat','lon']).aggregate([('one','sum'),('frp_count','sum'),('frp_sum','sum')])
        aggregated=aggregated.rename_columns(['date','lat','lon','records','detections','frp'])
        metadata={b'source':str(path).encode(),b'country':country.encode(),b'sensor':sensor.encode(),b'unit':b'0.01-degree cell-day occupancy per sensor'}
        aggregated=aggregated.replace_schema_metadata(metadata)
        target.parent.mkdir(parents=True,exist_ok=True)
        temporary=target.with_suffix('.part')
        pq.write_table(aggregated,temporary,compression='zstd')
        temporary.replace(target)
        return target


def daily_analysis(q,map_mode=False):
    from app import exploration as ex
    ex.ensure_cube(q['locale'])
    start=date.fromisoformat(q['start_date']);end=date.fromisoformat(q['end_date'])
    if not q['country'] or start.year!=end.year:
        raise HTTPException(422,ex.message('daily_country',q['locale']))
    if q['metric']=='harmonized':
        raise HTTPException(422,'O índice harmonizado diário não foi validado; selecione records/detections/frp.' if q['locale']=='pt-BR' else 'The daily harmonized index has not been validated; select records/detections/frp.')
    codes=pa.array([lat*360+lon for lat,lon in map(ex.parse_point,q['point_ids'])],type=pa.int32()) if q['point_ids'] else None
    bydate=defaultdict(lambda:{'value':0.,'sensors':{s:None for s in ex.SENSORS}})
    bycell=defaultdict(float);seen=set(); available=[]
    totals={'value':0.,'records':0.,'detections':0.,'frp':0.}
    for sensor in q['sensors']:
        cache=_cache(q['country'],start.year,sensor)
        if cache is None:continue
        available.append({'sensor':sensor,'year':start.year,'months_with_records':list(range(1,13))})
        tab=pq.read_table(cache,filters=[('date','>=',start),('date','<=',end)])
        if q['months']:
            tab=tab.filter(pc.is_in(pc.month(tab['date']),value_set=pa.array(q['months'],type=pa.int64())))
        if codes is not None:
            actual=pc.add(pc.multiply(pc.cast(tab['lat'],pa.int32()),360),pc.cast(tab['lon'],pa.int32()))
            tab=tab.filter(pc.is_in(actual,value_set=codes))
        for row in tab.to_pylist():
            key=row['date'].isoformat();cell=(row['lat'],row['lon']);seen.add(cell)
            value=float(row[q['metric']] or 0)
            bydate[key]['value']+=value
            bydate[key]['sensors'][sensor]=(bydate[key]['sensors'][sensor] or 0)+value
            bycell[cell]+=value
            totals['value']+=value
            for metric in ['records','detections','frp']:totals[metric]+=float(row[metric] or 0)
    with ex._connect() as db:selected=ex._selected_count(db,q)
    meta=ex._metadata(q,selected,len(seen),available,start.isoformat(),end.isoformat())
    if q['metric']=='records':
        meta['unit']='ocupações diárias da grade 0,01° por sensor (não células únicas no intervalo)' if q['locale']=='pt-BR' else 'daily 0.01° grid occupancy per sensor (not unique cells over the interval)'
    meta['method']='raw-country-daily-v2'
    # Source contains actual dated records; exact partial archive coverage beyond
    # first/last recorded day cannot be inferred from active-fire rows alone.
    meta['notices']=[ex.message('zero',q['locale']), 'Dados diários lidos dos CSV/ZIP originais; disponibilidade de arquivo não comprova observação em cada dia.' if q['locale']=='pt-BR' else 'Daily records were read from original CSV/ZIP files; file availability does not prove observation on every day.']
    if map_mode:
        points=[{'point_id':ex.point_id(lat,lon),'lat_center':lat+.5,'lon_center':lon+.5,'value':v,'country':q['country'],'source':'observations'} for (lat,lon),v in sorted(bycell.items())]
        return {'points':points,'domain':[0,max(bycell.values(),default=0)],'total':totals['value'],**meta}
    day=start
    while day<=end:
        if not q['months'] or day.month in q['months']:
            key=day.isoformat()
            if key not in bydate:bydate[key]={'value':0. if available else None,'sensors':{s:(0. if any(a['sensor']==s for a in available) else None) for s in ex.SENSORS}}
            else:
                for source in available:
                    if bydate[key]['sensors'][source['sensor']] is None:bydate[key]['sensors'][source['sensor']]=0.
        day+=timedelta(days=1)
    if not available:totals['value']=None
    return {'timeseries':[{'period':p,**v} for p,v in sorted(bydate.items())],'calendar':[],'totals':totals,**meta}
