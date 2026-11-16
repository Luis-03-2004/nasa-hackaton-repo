"""Consultas globais aditivas com cubo mensal versionado, sem alterar fontes.

records = registros legados célula x mês x semana x sensor. Não são células
únicas do mês/ano. A camada semanal preserva a mesma unidade declarada.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
import calendar
import fcntl
import json
import math
import os
import re
import sqlite3
import threading
import time

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
from fastapi import HTTPException

from app.dates import observation_week_start
from app.forecast import DATA_DIR, artifacts
from app import analytics_database

VERSION = 'exploration-v2.1'
SENSORS = ('modis', 'viirs-snpp', 'viirs-jpss1')
CUBE_DIR = Path(os.getenv('FIRE_EXPLORATION_DIR', DATA_DIR / 'web_v2'))
CUBE_PATH = CUBE_DIR / 'exploration.sqlite'
_BUILD_LOCK = threading.Lock()
_BUILD_STATE = {'status': 'idle', 'completed_files': 0, 'total_files': 48}
POINT_PATTERN = re.compile(r'^pt_([+-]\d{2})_([+-]\d{3})$')
MESSAGES = {
 'pt-BR': {
  'building':'O índice histórico está sendo preparado. Tente novamente em instantes.',
  'unit_records':'registros de célula × mês × semana × sensor',
  'unit_detections':'detecções representadas nos registros',
  'unit_frp':'soma de FRP registrada (MW; não é energia nem potência simultânea)',
  'unit_harmonized':'índice linear experimental M2-V2 (contribuições de células-registro)',
  'records':'As contagens preservam a unidade legada célula × mês × semana × sensor; não representam incêndios ou células únicas no período.',
  'zero':'Zero significa nenhum registro na fonte disponível; não comprova ausência de fogo. Sensor/arquivo indisponível é nulo.',
  'partial':'2000 tem registros globais somente em novembro e dezembro neste arquivo; o período inicial é parcial.',
  'snapped':'A consulta foi ampliada aos períodos completos da resolução escolhida; as datas efetivas são informadas.',
  'harmonized':'M2-V2 usa pesos lineares fixos por zona/mês/era, independentes de contagens positivas. É uma extensão experimental aditiva; não herda as métricas de validação do método legado.',
  'weekly':'O início semanal é aproximado e derivado do mês/semana ISO. Uma célula pode contribuir em dois meses da mesma semana; esta rota não declara células-semana únicas.',
  'daily_country':'A consulta diária precisa de um país/território e no máximo um ano. Use a busca de país; para o Mundo, escolha resolução mensal ou anual.',
 },
 'en': {
  'building':'The historical index is being prepared. Please retry shortly.',
  'unit_records':'cell × month × week × sensor records',
  'unit_detections':'detections represented by the records',
  'unit_frp':'sum of recorded FRP (MW; neither energy nor simultaneous power)',
  'unit_harmonized':'experimental linear M2-V2 index (cell-record contributions)',
  'records':'Counts preserve the legacy cell × month × week × sensor unit; they are not individual fires or unique cells in the period.',
  'zero':'Zero means no record in an available source; it does not prove absence of fire. Unavailable sensor/files are null.',
  'partial':'The 2000 source has global records only in November and December; the initial period is partial.',
  'snapped':'The query was expanded to complete periods at the selected resolution; effective dates are reported.',
  'harmonized':'M2-V2 uses fixed linear zone/month/era weights, independent of positive counts. This is an experimental additive extension and does not inherit the legacy validation metrics.',
  'weekly':'Weekly start is approximate, derived from source month/ISO week. A cell can contribute in two months of one week; this endpoint does not claim unique cell-weeks.',
  'daily_country':'Daily queries require a country/territory and at most one year. Select a country; for the World, use monthly or yearly resolution.',
 },
}


def message(code, locale='pt-BR'):
    return MESSAGES.get(locale, MESSAGES['pt-BR']).get(code, code)


def point_id(lat, lon):
    return f'pt_{lat:+03d}_{lon:+04d}'


def parse_point(value):
    match = POINT_PATTERN.fullmatch(value)
    if not match:
        raise HTTPException(422, 'Invalid point_id: expected pt_±LL_±LLL')
    lat, lon = map(int, match.groups())
    if not -90 <= lat < 90 or not -180 <= lon < 180:
        raise HTTPException(422, 'point_id outside the global grid')
    return lat, lon


def _sources():
    return sorted((DATA_DIR / 'parquet_025deg').glob('*/*_025deg.parquet'))


def status():
    if analytics_database.storage_mode() == 'postgres':
        return analytics_database.postgres_status(VERSION)
    state = dict(_BUILD_STATE)
    if CUBE_PATH.is_file():
        try:
            with sqlite3.connect(CUBE_PATH) as db:
                state['completed_files'] = db.execute('SELECT count(*) FROM sources').fetchone()[0]
                state['total_files'] = len(_sources())
                tables={row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                state['ready'] = state['completed_files'] == state['total_files'] > 0 and {'country_monthly','annual','cell_inventory'} <= tables
                if state['ready'] and state['status'] != 'building':
                    state['status'] = 'ready'
        except sqlite3.Error:
            state['ready'] = False
    else:
        state['ready'] = False
    return {**state, 'version': VERSION}


def _schema(db):
    db.executescript('''
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS sources(name TEXT PRIMARY KEY, size INTEGER, mtime INTEGER, rows INTEGER);
        CREATE TABLE IF NOT EXISTS monthly(
          year INTEGER, sensor TEXT, country TEXT, month INTEGER, lat INTEGER, lon INTEGER,
          records INTEGER NOT NULL, detections INTEGER NOT NULL, frp REAL NOT NULL, harmonized REAL NOT NULL,
          PRIMARY KEY(year,sensor,country,month,lat,lon)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS availability(sensor TEXT,year INTEGER,month INTEGER,
          PRIMARY KEY(sensor,year,month)) WITHOUT ROWID;
    ''')


def zone_for_lat(lat):
    if lat >= 55: return 'boreal'
    if lat >= 23.5: return 'temp_norte'
    if lat >= 0: return 'trop_norte'
    if lat >= -23.5: return 'trop_sul'
    return 'temp_sul'


@lru_cache(maxsize=1)
def _factors():
    return artifacts()[0]['harmonization']


def coefficient(year, month, lat, sensor):
    """Linearidade permite soma exatamente igual em país, células e mapa."""
    if year < 2012:
        return 1.0 if sensor == 'modis' else 0.0
    if sensor == 'modis':
        return .5
    zone = zone_for_lat(lat + .5)
    era = 'factors_era2_2012_2017' if year < 2018 else 'factors_era3_2018_2025'
    alpha = float(_factors()[zone][era]['alpha_monthly'][str(month)])
    return alpha * (.5 if year < 2018 else .25)


def build_cube():
    """Retomável por arquivo; cada substituição completa é uma transação."""
    if not _BUILD_LOCK.acquire(blocking=False):
        return status()
    started = time.monotonic()
    process_lock = None
    try:
        CUBE_DIR.mkdir(parents=True, exist_ok=True)
        process_lock=(CUBE_DIR/'.build.lock').open('a+')
        try:
            fcntl.flock(process_lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            _BUILD_STATE['status']='building'
            return status()
        paths = _sources()
        if not paths:
            raise FileNotFoundError('Parquet 0.25° source directory is empty')
        _BUILD_STATE.update(status='building', total_files=len(paths), error=None)
        with sqlite3.connect(CUBE_PATH, timeout=60) as db:
            _schema(db)
            done = 0
            changed = False
            for path in paths:
                stat = path.stat()
                signature = (stat.st_size, stat.st_mtime_ns)
                name = str(path.relative_to(DATA_DIR))
                previous = db.execute('SELECT size,mtime FROM sources WHERE name=?', (name,)).fetchone()
                if previous == signature:
                    done += 1; _BUILD_STATE['completed_files'] = done
                    continue
                changed = True
                year = int(path.name.split('_')[-2])
                sensor = path.parent.name
                tab = pq.read_table(path, columns=['country', 'month', 'lat_025', 'lon_025', 'active_1km_cells', 'merged_count', 'frp_sum'])
                for source, dest in [('lat_025', 'lat'), ('lon_025', 'lon')]:
                    tab = tab.append_column(dest, pc.cast(pc.floor(pc.divide(pc.cast(tab[source], pa.float64()), 4)), pa.int16()))
                grouped = tab.group_by(['country', 'month', 'lat', 'lon']).aggregate([('active_1km_cells','sum'), ('merged_count','sum'), ('frp_sum','sum')])
                # Build tuples directly from Arrow columns; no raw-record dictionaries.
                arrays = [grouped[c].to_pylist() for c in ['country','month','lat','lon','active_1km_cells_sum','merged_count_sum','frp_sum_sum']]
                rows = [(year, sensor, country, month, lat, lon, records, detections, float(frp or 0), records * coefficient(year,month,lat,sensor)) for country,month,lat,lon,records,detections,frp in zip(*arrays, strict=True)]
                with db:
                    db.execute('DELETE FROM monthly WHERE year=? AND sensor=?', (year,sensor))
                    db.executemany('INSERT INTO monthly VALUES(?,?,?,?,?,?,?,?,?,?)', rows)
                    db.execute('DELETE FROM availability WHERE year=? AND sensor=?', (year,sensor))
                    db.executemany('INSERT INTO availability VALUES(?,?,?)', [(sensor,year,int(m)) for m in pc.unique(tab['month']).to_pylist()])
                    db.execute('INSERT OR REPLACE INTO sources VALUES(?,?,?,?)', (name,*signature,tab.num_rows))
                done += 1
                _BUILD_STATE['completed_files'] = done
                print(f'Exploration cube: {done}/{len(paths)} {sensor}/{year}: {len(rows):,} monthly cells', flush=True)
            db.execute('CREATE INDEX IF NOT EXISTS monthly_country ON monthly(country,year,month)')
            db.execute('CREATE INDEX IF NOT EXISTS monthly_cell ON monthly(lat,lon,year,month)')
            if changed:
                db.execute('DROP TABLE IF EXISTS cell_inventory')
            db.execute('CREATE TABLE IF NOT EXISTS cell_inventory AS SELECT DISTINCT country,lat,lon FROM monthly')
            db.execute('CREATE INDEX IF NOT EXISTS inventory_country ON cell_inventory(country)')
            db.execute('CREATE INDEX IF NOT EXISTS inventory_cell ON cell_inventory(lat,lon)')
            existing={row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if changed:
                db.execute('DROP TABLE IF EXISTS country_monthly')
                db.execute('DROP TABLE IF EXISTS annual')
            if changed or 'country_monthly' not in existing:
                print('Exploration cube: creating country monthly summaries',flush=True)
                db.execute('CREATE TABLE country_monthly AS SELECT year,sensor,country,month,sum(records) records,sum(detections) detections,sum(frp) frp,sum(harmonized) harmonized FROM monthly GROUP BY year,sensor,country,month')
                db.execute('CREATE INDEX country_monthly_scope ON country_monthly(country,year,month)')
                db.execute('CREATE INDEX country_monthly_period ON country_monthly(year,month)')
            if changed or 'annual' not in existing:
                print('Exploration cube: creating annual cell summaries',flush=True)
                db.execute('CREATE TABLE annual AS SELECT year,sensor,country,0 AS month,lat,lon,sum(records) records,sum(detections) detections,sum(frp) frp,sum(harmonized) harmonized FROM monthly GROUP BY year,sensor,country,lat,lon')
                db.execute('CREATE INDEX annual_scope ON annual(country,year)')
                db.execute('CREATE INDEX annual_cell ON annual(lat,lon,year)')
                db.execute('CREATE INDEX annual_year ON annual(year)')
            db.commit()
            db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        _map_scale.cache_clear()
        _BUILD_STATE.update(status='ready', elapsed_seconds=round(time.monotonic()-started,2))
        return status()
    except Exception as error:
        _BUILD_STATE.update(status='error',error=type(error).__name__)
        raise
    finally:
        if process_lock is not None:
            fcntl.flock(process_lock.fileno(),fcntl.LOCK_UN)
            process_lock.close()
        _BUILD_LOCK.release()


def ensure_cube(locale='pt-BR'):
    info = status()
    if analytics_database.storage_mode() == 'postgres':
        if not info['ready']:
            text = 'O banco analítico PostgreSQL não está pronto; execute a migração ou confira sua conexão e versão.' if locale == 'pt-BR' else 'The PostgreSQL analytics database is not ready; run the migration or check its connection and version.'
            raise HTTPException(503, text, headers={'Retry-After': '5'})
        return
    if not info['ready']:
        if os.getenv('FIRE_REQUIRE_PREPARED_CACHE') == '1':
            raise HTTPException(503, message('building',locale), headers={'Retry-After':'5'})
        if info['status'] != 'building':
            threading.Thread(target=build_cube, daemon=True).start()
        raise HTTPException(503, message('building',locale), headers={'Retry-After':'5'})


def _connect():
    if analytics_database.storage_mode() == 'postgres':
        return analytics_database.connect_postgres()
    db = sqlite3.connect(CUBE_PATH,timeout=30)
    db.execute('PRAGMA temp_store=MEMORY')
    return db


def countries():
    ensure_cube()
    with _connect() as db:
        rows = db.execute('SELECT country,min(year),max(year) FROM monthly GROUP BY country ORDER BY country').fetchall()
    return {'countries':[{'id':country,'name':country.replace('_',' '),'first_year':first,'last_year':last} for country,first,last in rows], 'version':VERSION}


def normalise(query):
    q = dict(query)
    q.setdefault('locale','pt-BR')
    q['country'] = q.get('country') or None
    if q['country'] in ('global','World','Mundo'): q['country'] = None
    q['point_ids'] = sorted(set(q.get('point_ids') or []))
    for value in q['point_ids']: parse_point(value)
    q['sensors'] = sorted(set(q.get('sensors', SENSORS)))
    if not q['sensors'] or any(s not in SENSORS for s in q['sensors']):
        raise HTTPException(422,'Selecione pelo menos um sensor compatível.' if q['locale']=='pt-BR' else 'Select at least one supported sensor.')
    q['months'] = sorted(set(q.get('months') or []))
    if any(m < 1 or m > 12 for m in q['months']): raise HTTPException(422,'Mês inválido.' if q['locale']=='pt-BR' else 'Invalid month.')
    q.setdefault('metric','records'); q.setdefault('resolution','monthly'); q.setdefault('locale','pt-BR')
    q['start_date'] = str(q.get('start_date') or '2000-01-01')
    q['end_date'] = str(q.get('end_date') or '2025-12-31')
    start,end = date.fromisoformat(q['start_date']),date.fromisoformat(q['end_date'])
    if start > end or start < date(2000,1,1) or end > date(2025,12,31):
        raise HTTPException(422,'O intervalo deve estar em ordem e entre 2000 e 2025.' if q['locale']=='pt-BR' else 'Date interval must be ordered and within 2000–2025.')
    return q


def _scope(db,q,populate=True):
    clauses=[]; params=[]
    if q['country']:
        clauses.append('m.country=?'); params.append(q['country'])
    if q['point_ids']:
        if populate:
            db.execute('CREATE TEMP TABLE IF NOT EXISTS chosen(lat INTEGER,lon INTEGER,PRIMARY KEY(lat,lon)) WITHOUT ROWID')
            db.executemany('INSERT OR IGNORE INTO chosen VALUES(?,?)',[parse_point(p) for p in q['point_ids']])
        clauses.append('EXISTS(SELECT 1 FROM chosen c WHERE c.lat=m.lat AND c.lon=m.lon)')
    return clauses,params


def _monthly_where(db,q,climatology=False,annual=False,populate=True):
    clauses,params = _scope(db,q,populate=populate)
    clauses.append('sensor IN ('+','.join('?' for _ in q['sensors'])+')');params.extend(q['sensors'])
    if climatology:
        clauses.append('year BETWEEN 2003 AND 2023')
    else:
        a=date.fromisoformat(q['start_date']);b=date.fromisoformat(q['end_date'])
        clauses.append('year BETWEEN ? AND ?');params.extend((a.year,b.year))
        if not annual and (a.month != 1 or b.month != 12):
            clauses.append('(year*100+month) BETWEEN ? AND ?');params.extend((a.year*100+a.month,b.year*100+b.month))
    if q['months']:
        clauses.append('month IN ('+','.join('?' for _ in q['months'])+')');params.extend(q['months'])
    return ' AND '.join(clauses),params


def _column(metric):
    return {'records':'records','detections':'detections','frp':'frp','harmonized':'harmonized'}[metric]


def _selected_count(db,q):
    if q['point_ids']: return len(q['point_ids'])
    if q['country']:
        return db.execute('SELECT count(*) FROM (SELECT DISTINCT lat,lon FROM cell_inventory WHERE country=?)',(q['country'],)).fetchone()[0]
    return db.execute('SELECT count(*) FROM (SELECT DISTINCT lat,lon FROM cell_inventory)').fetchone()[0]


def _metadata(q,selected,processed,available,effective_start,effective_end):
    locale=q['locale']; start=date.fromisoformat(q['start_date']);end=date.fromisoformat(q['end_date'])
    notices=[message('records',locale),message('zero',locale)]
    partial=start.year<=2000<=end.year
    if partial: notices.append(message('partial',locale))
    if effective_start != q['start_date'] or effective_end != q['end_date']: notices.append(message('snapped',locale))
    if q['metric']=='harmonized': notices.append(message('harmonized',locale))
    if q['resolution']=='weekly': notices.append(message('weekly',locale))
    return {'selected_count':selected,'processed_count':processed,'missing_count':max(0,selected-processed),'coverage':{'partial':partial,'available_sensor_years':available,'effective_start':effective_start,'effective_end':effective_end,'has_available_source':bool(available)},'metric':q['metric'],'resolution':q['resolution'],'unit':message('unit_'+q['metric'],locale),'method':'M2-linear-additive-v2-experimental' if q['metric']=='harmonized' else 'source-025deg-additive-v2','version':VERSION,'notices':notices,'filters':q}


def _availability(db,q):
    start=date.fromisoformat(q['start_date']);end=date.fromisoformat(q['end_date'])
    result=[]
    for sensor,year,raw in db.execute('SELECT sensor,year,group_concat(month) FROM availability WHERE year BETWEEN ? AND ? GROUP BY sensor,year ORDER BY year,sensor',(start.year,end.year)):
        if sensor not in q['sensors']:continue
        months=sorted(m for m in map(int,raw.split(',')) if start.year*100+start.month<=year*100+m<=end.year*100+end.month and (not q['months'] or m in q['months']))
        if months:result.append({'sensor':sensor,'year':year,'months_with_records':months})
    return result


def _calendar(rows,q,availability):
    # rows: (year,month,sensor,value). Use no synthetic zero before source availability.
    values=defaultdict(float)
    for year,month,sensor,value in rows: values[(year,month)] += float(value)
    baseline={};std={}
    known={(row['year'],m) for row in availability for m in row['months_with_records']}
    for month in range(1,13):
        seq=[values.get((y,month),0.) for y in range(2003,2024) if (y,month) in known]
        mu=sum(seq)/len(seq) if seq else None;baseline[month]=mu
        std[month]=math.sqrt(sum((x-mu)**2 for x in seq)/len(seq)) if seq else None
    start=date.fromisoformat(q['start_date']);end=date.fromisoformat(q['end_date'])
    cells=[]
    for year in range(start.year,end.year+1):
        for month in range(1,13):
            if not (start.year*100+start.month <= year*100+month <= end.year*100+end.month): continue
            if q['months'] and month not in q['months']: continue
            value=values.get((year,month),0.)
            # Global source has no records at all before Nov/2000; keep unavailable null.
            if (year,month) not in known: value=None
            mu=baseline[month]
            cells.append({'year':year,'month':month,'value':value,'baseline_mean':mu,'anomaly_pct':None if value is None or mu is None or mu==0 else (value-mu)/mu*100,'anomaly_zscore':None if value is None or std[month] is None or std[month]==0 else (value-mu)/std[month]})
    return cells


def query_analysis(query):
    q=normalise(query)
    if q['resolution']=='daily':
        from app.daily_history import daily_analysis
        return daily_analysis(q)
    ensure_cube(q['locale'])
    if q['resolution']=='weekly': return _weekly(q,map_mode=False)
    column=_column(q['metric'])
    col_idx={'records':3,'detections':4,'frp':5,'harmonized':6}[column]
    with _connect() as db:
        where,params=_monthly_where(db,q,populate=True)
        table='monthly' if q['point_ids'] else 'country_monthly'
        raw_rows=db.execute(f'SELECT year,month,sensor,sum(records),sum(detections),sum(frp),sum(harmonized) FROM {table} m WHERE {where} GROUP BY year,month,sensor ORDER BY year,month',params).fetchall()
        rows=[(r[0],r[1],r[2],r[col_idx]) for r in raw_rows]
        totals=(
            sum(float(r[col_idx] or 0) for r in raw_rows),
            sum(int(r[3] or 0) for r in raw_rows),
            sum(int(r[4] or 0) for r in raw_rows),
            sum(float(r[5] or 0) for r in raw_rows),
        )
        # Climatology uses the same spatial/sensor/month selection but baseline years.
        a_dt=date.fromisoformat(q['start_date']); b_dt=date.fromisoformat(q['end_date'])
        if a_dt <= date(2003,1,1) and b_dt >= date(2023,12,31):
            climrows=rows
        else:
            needed_months=q['months'] or (list(range(a_dt.month,b_dt.month+1)) if a_dt.year==b_dt.year else [])
            clim_q={**q,'months':needed_months} if needed_months else q
            cwhere,cparams=_monthly_where(db,clim_q,True,populate=False)
            climrows=db.execute(f'SELECT year,month,sensor,sum({column}) FROM {table} m WHERE {cwhere} GROUP BY year,month,sensor',cparams).fetchall()
        allrows={(y,m,s):(y,m,s,v) for y,m,s,v in climrows}
        allrows.update({(y,m,s):(y,m,s,v) for y,m,s,v in rows})
        all_available=_availability(db,{**q,'start_date':'2000-01-01','end_date':'2025-12-31'})
        cells=_calendar(list(allrows.values()),q,all_available)
        if q['point_ids'] and analytics_database.storage_mode() != 'postgres':
            p_clauses=['m.lat=c.lat','m.lon=c.lon']
            p_params=[]
            if q['country']:
                p_clauses.append('m.country=?'); p_params.append(q['country'])
            p_clauses.append('m.sensor IN ('+','.join('?' for _ in q['sensors'])+')'); p_params.extend(q['sensors'])
            p_clauses.append('m.year BETWEEN ? AND ?'); p_params.extend((a_dt.year,b_dt.year))
            if a_dt.month != 1 or b_dt.month != 12:
                p_clauses.append('(m.year*100+m.month) BETWEEN ? AND ?'); p_params.extend((a_dt.year*100+a_dt.month,b_dt.year*100+b_dt.month))
            if q['months']:
                p_clauses.append('m.month IN ('+','.join('?' for _ in q['months'])+')'); p_params.extend(q['months'])
            processed=db.execute(f"SELECT count(*) FROM chosen c WHERE EXISTS(SELECT 1 FROM monthly m WHERE {' AND '.join(p_clauses)})",p_params).fetchone()[0]
        else:
            processed=db.execute(f'SELECT count(*) FROM (SELECT DISTINCT lat,lon FROM monthly m WHERE {where})',params).fetchone()[0]
        selected=_selected_count(db,q); available=_availability(db,q)
    values=defaultdict(lambda:{'value':0.,'sensors':{s:None for s in SENSORS}})
    a=date.fromisoformat(q['start_date']);b=date.fromisoformat(q['end_date'])
    for y,m,s,v in rows:
        period=f'{y:04}-01-01' if q['resolution']=='yearly' else f'{y:04}-{m:02}-01'
        item=values[period];item['value']+=float(v);item['sensors'][s]=(item['sensors'][s] or 0)+float(v)
    known={(item['sensor'],item['year'],m) for item in available for m in item['months_with_records']}
    for period,item in values.items():
        year,month=int(period[:4]),int(period[5:7])
        for sensor in q['sensors']:
            if item['sensors'][sensor] is None and any((sensor,year,m) in known for m in ([month] if q['resolution']=='monthly' else range(1,13))):
                item['sensors'][sensor]=0.
    series=[]
    if q['resolution']=='monthly':
        for cell in cells:
            period=f"{cell['year']:04}-{cell['month']:02}-01"
            record=values.get(period,{'value':cell['value'],'sensors':{s:(0. if s in q['sensors'] and (s,cell['year'],cell['month']) in known else None) for s in SENSORS}})
            series.append({'period':period,**record,'baseline_mean':cell['baseline_mean'],'anomaly_pct':cell['anomaly_pct'],'anomaly_zscore':cell['anomaly_zscore']})
    else:
        series=[{'period':p,**v} for p,v in sorted(values.items())]
    effective_start=f'{a.year:04}-{a.month:02}-01';effective_end=f'{b.year:04}-{b.month:02}-{calendar.monthrange(b.year,b.month)[1]}'
    total_values=dict(zip(('value','records','detections','frp'),totals))
    if not available:total_values['value']=None
    return {'timeseries':series,'calendar':cells,'totals':total_values,**_metadata(q,selected,processed,available,effective_start,effective_end)}


def query_map(query):
    q=normalise(query)
    if q['resolution']=='daily':
        from app.daily_history import daily_analysis
        return daily_analysis(q,map_mode=True)
    ensure_cube(q['locale'])
    if q['resolution']=='weekly': return _weekly(q,map_mode=True)
    column=_column(q['metric'])
    a=date.fromisoformat(q['start_date']);b=date.fromisoformat(q['end_date'])
    annual=not q['months'] and a.month==1 and b.month==12
    table='annual' if annual else 'monthly'
    with _connect() as db:
        where,params=_monthly_where(db,q,annual=annual)
        rows=db.execute(f'SELECT lat,lon,sum({column}),min(country) FROM {table} m WHERE {where} GROUP BY lat,lon ORDER BY lat,lon',params).fetchall()
        selected=_selected_count(db,q);available=_availability(db,q)
    points=[{'point_id':point_id(lat,lon),'lat_center':lat+.5,'lon_center':lon+.5,'value':float(value),'country':country,'source':'observations'} for lat,lon,value,country in rows]
    a=date.fromisoformat(q['start_date']);b=date.fromisoformat(q['end_date'])
    return {'points':points,'domain':[0,max((p['value'] for p in points),default=0)],'scale_max':_map_scale(q['country'],tuple(q['sensors']),q['metric'],tuple(q['months']),a.month==b.month and a.year==b.year),'total':sum(p['value'] for p in points),**_metadata(q,selected,len(points),available,f'{a.year:04}-{a.month:02}-01',f'{b.year:04}-{b.month:02}-{calendar.monthrange(b.year,b.month)[1]}')}


def _weekly(q,map_mode=False):
    start=date.fromisoformat(q['start_date']);end=date.fromisoformat(q['end_date'])
    selected_codes=pa.array([lat*360+lon for lat,lon in map(parse_point,q['point_ids'])],type=pa.int32()) if q['point_ids'] else None
    data=defaultdict(float); sensor_values=defaultdict(lambda:{s:None for s in SENSORS});seen=set();countries_by_cell={}
    totals={'records':0.,'detections':0.,'frp':0.}
    files=[p for p in _sources() if p.parent.name in q['sensors'] and start.year-1<=int(p.name.split('_')[-2])<=end.year+1]
    first=None;last=None
    for path in files:
        year=int(path.name.split('_')[-2]);sensor=path.parent.name
        filters=[('country','=',q['country'])] if q['country'] else None
        tab=pq.read_table(path,columns=['month','iso_week','country','lat_025','lon_025','active_1km_cells','merged_count','frp_sum'],filters=filters)
        if not tab.num_rows:continue
        for src,dst in [('lat_025','lat'),('lon_025','lon')]:
            tab=tab.append_column(dst,pc.cast(pc.floor(pc.divide(pc.cast(tab[src],pa.float64()),4)),pa.int16()))
        if selected_codes is not None:
            codes=pc.add(pc.multiply(pc.cast(tab['lat'],pa.int32()),360),pc.cast(tab['lon'],pa.int32()))
            tab=tab.filter(pc.is_in(codes,value_set=selected_codes))
        keys=set(zip(tab['month'].to_pylist(),tab['iso_week'].to_pylist()))
        valid={}
        for month,week in keys:
            if q['months'] and month not in q['months']:continue
            period=observation_week_start(year,month,week)
            if period<=end and period+timedelta(days=6)>=start:
                valid[month*100+week]=period
                first=min(first,period) if first else period;last=max(last,period+timedelta(days=6)) if last else period+timedelta(days=6)
        if not valid:continue
        codes=pc.add(pc.multiply(pc.cast(tab['month'],pa.int32()),100),pc.cast(tab['iso_week'],pa.int32()))
        tab=tab.filter(pc.is_in(codes,value_set=pa.array(list(valid),type=pa.int32())))
        group=['month','iso_week','lat','lon']+(['country'] if map_mode else [])
        rows=tab.group_by(group).aggregate([('active_1km_cells','sum'),('merged_count','sum'),('frp_sum','sum')]).to_pylist()
        for row in rows:
            lat,lon=row['lat'],row['lon'];seen.add((lat,lon))
            metrics={'records':float(row['active_1km_cells_sum']),'detections':float(row['merged_count_sum']),'frp':float(row['frp_sum_sum'] or 0)}
            metrics['harmonized']=metrics['records']*coefficient(year,row['month'],lat,sensor)
            value=metrics[q['metric']]
            for field in totals:totals[field]+=metrics[field]
            key=(lat,lon) if map_mode else valid[row['month']*100+row['iso_week']].isoformat()
            data[key]+=value
            sensor_values[key][sensor]=(sensor_values[key][sensor] or 0)+value
            countries_by_cell[(lat,lon)]=row.get('country','')
    with _connect() as db:selected=_selected_count(db,q);available=_availability(db,q)
    expanded_start=start-timedelta(days=start.weekday())
    expanded_end=end+timedelta(days=6-end.weekday())
    meta=_metadata(q,selected,len(seen),available,expanded_start.isoformat(),expanded_end.isoformat())
    if map_mode:
        points=[{'point_id':point_id(lat,lon),'lat_center':lat+.5,'lon_center':lon+.5,'value':v,'country':countries_by_cell[(lat,lon)],'source':'observations'} for (lat,lon),v in sorted(data.items())]
        return {'points':points,'domain':[0,max(data.values(),default=0)],'total':sum(data.values()),**meta}
    # Preserve the requested weekly bins. Zero denotes no record in an
    # available archive, while unavailable sensor/month combinations stay null.
    with _connect() as db:
        expanded_available=_availability(db,{**q,'start_date':expanded_start.isoformat(),'end_date':expanded_end.isoformat(),'months':[]})
    known={(entry['sensor'],entry['year'],month) for entry in expanded_available for month in entry['months_with_records']}
    period=expanded_start
    while period<=expanded_end:
        days=[period+timedelta(days=i) for i in range(7)]
        if not q['months'] or any(day.month in q['months'] for day in days):
            label=period.isoformat()
            allowed=[sensor for sensor in q['sensors'] if any((sensor,day.year,day.month) in known and (not q['months'] or day.month in q['months']) for day in days)]
            if label not in data:data[label]=0. if allowed else None
            for sensor in allowed:
                if sensor_values[label][sensor] is None:sensor_values[label][sensor]=0.
        period+=timedelta(days=7)
    return {'timeseries':[{'period':p,'value':v,'sensors':sensor_values[p]} for p,v in sorted(data.items())],'calendar':[],'totals':{'value':sum(v for v in data.values() if v is not None) if available else None,**totals},**meta}


@lru_cache(maxsize=128)
def _map_scale(country,sensors,metric,months,single_month):
    clauses=['sensor IN ('+','.join('?' for _ in sensors)+')']
    params=list(sensors)
    if country:
        clauses.append('country=?');params.append(country)
    if months:
        clauses.append('month IN ('+','.join('?' for _ in months)+')');params.extend(months)
    groups='year,month,lat,lon' if single_month else 'year,lat,lon'
    table='annual' if not single_month and not months else 'monthly'
    with _connect() as db:
        value=db.execute('SELECT max(value) FROM (SELECT sum('+_column(metric)+') value FROM '+table+' WHERE '+' AND '.join(clauses)+' GROUP BY '+groups+')',params).fetchone()[0]
    return float(value or 0.)


def query_calendar_month(query):
    """Retorna os valores dia a dia (1..31) de um mês específico para o drill-down Ano -> Mês -> Dia."""
    year = max(2000, min(2025, int(query.get('year', 2025))))
    month = max(1, min(12, int(query.get('month', 12))))
    last_day = calendar.monthrange(year, month)[1]
    start_str = f'{year:04d}-{month:02d}-01'
    end_str = f'{year:04d}-{month:02d}-{last_day:02d}'

    q = normalise({
        'country': query.get('country'),
        'point_ids': query.get('point_ids') or [],
        'start_date': start_str,
        'end_date': end_str,
        'months': [month],
        'sensors': query.get('sensors') or list(SENSORS),
        'metric': query.get('metric') or 'records',
        'resolution': 'monthly',
        'locale': query.get('locale') or 'pt-BR',
    })

    # Primeiro obtém o resumo mensal oficial e a climatologia 2003-2023 daquele mês
    monthly_res = query_analysis(q)
    cal_cell = next((c for c in monthly_res.get('calendar', []) if c['year'] == year and c['month'] == month), None)
    month_total = cal_cell['value'] if cal_cell else None
    baseline_month = cal_cell['baseline_mean'] if cal_cell else None
    daily_baseline = (baseline_month / last_day) if (baseline_month is not None and last_day > 0) else None

    # 1. Tenta dados diários exatos quando um país está selecionado e métrica != harmonized
    if q['country'] and q['metric'] != 'harmonized':
        try:
            from app.daily_history import daily_analysis
            daily_q = {**q, 'resolution': 'daily'}
            d_res = daily_analysis(daily_q, map_mode=False)
            ts = d_res.get('timeseries', [])
            if ts and any(r.get('value') is not None for r in ts):
                vals = [float(r['value'] or 0.0) for r in ts if r.get('value') is not None]
                std_d = math.sqrt(sum((x - (daily_baseline or 0.0)) ** 2 for x in vals) / len(vals)) if (vals and daily_baseline is not None) else None
                days_out = []
                for idx, row in enumerate(ts, 1):
                    dt = date.fromisoformat(row['period'][:10])
                    val = row.get('value')
                    anom_pct = ((val - daily_baseline) / daily_baseline * 100.0) if (val is not None and daily_baseline and daily_baseline > 0) else None
                    anom_z = ((val - daily_baseline) / std_d) if (val is not None and daily_baseline is not None and std_d and std_d > 0) else None
                    days_out.append({
                        'date': row['period'][:10],
                        'day': dt.day,
                        'weekday': dt.weekday(),
                        'iso_week': dt.isocalendar().week,
                        'value': round(float(val), 2) if val is not None else None,
                        'baseline_mean': round(float(daily_baseline), 2) if daily_baseline is not None else None,
                        'anomaly_pct': round(float(anom_pct), 2) if anom_pct is not None else None,
                        'anomaly_zscore': round(float(anom_z), 2) if anom_z is not None else None,
                    })
                return {
                    'year': year,
                    'month': month,
                    'days_in_month': last_day,
                    'first_weekday': date(year, month, 1).weekday(),
                    'source': 'exact_daily',
                    'is_estimated': False,
                    'unit': d_res.get('unit') or monthly_res.get('unit'),
                    'resolution_source': 'exact_daily',
                    'month_total': round(sum(d['value'] or 0 for d in days_out), 2) if any(d['value'] is not None for d in days_out) else None,
                    'baseline_mean': round(float(baseline_month), 2) if baseline_month is not None else None,
                    'days': days_out,
                }
        except Exception:
            pass

    # 2. Para Global (Mundo) ou quando não há CSV diário por país, usa o banco semanal indexado (2012-2025)
    from app.forecast_selection import cache_path as f2_cache_path
    w_path = f2_cache_path()
    week_map: dict[tuple[int, int], float] = defaultdict(float)
    used_weekly = False
    if 2012 <= year <= 2025 and w_path.is_file():
        try:
            with sqlite3.connect(w_path, timeout=15) as wdb:
                clauses = ['iso_year IN (?, ?, ?)', 'sensor IN (' + ','.join('?' for _ in q['sensors']) + ')']
                params: list = [year - 1, year, year + 1, *q['sensors']]
                if q['country']:
                    clauses.append('country = ?')
                    params.append(q['country'])
                if q['point_ids']:
                    wdb.execute('CREATE TEMP TABLE IF NOT EXISTS cal_pts(point_id TEXT PRIMARY KEY)')
                    wdb.executemany('INSERT OR IGNORE INTO cal_pts VALUES (?)', [(pid,) for pid in q['point_ids']])
                    clauses.append('point_id IN (SELECT point_id FROM cal_pts)')
                col_expr = {
                    'records': 'SUM(cells)',
                    'detections': 'SUM(merged)',
                    'frp': 'SUM(frp)',
                    'harmonized': 'SUM(cells)',
                }[q['metric']]
                for wy, ww, val in wdb.execute(
                    f"SELECT iso_year, iso_week, {col_expr} FROM weekly WHERE {' AND '.join(clauses)} GROUP BY iso_year, iso_week",
                    params,
                ):
                    if wy is not None and ww is not None and val is not None:
                        week_map[(int(wy), int(ww))] = float(val)
                        used_weekly = True
        except Exception:
            used_weekly = False

    days_raw: list[tuple[date, float | None]] = []
    for d_num in range(1, last_day + 1):
        dt = date(year, month, d_num)
        iso_y, iso_w, _ = dt.isocalendar()
        if month_total is None:
            days_raw.append((dt, None))
        elif used_weekly:
            w_val = week_map.get((iso_y, iso_w), week_map.get((year, iso_w), 0.0))
            days_raw.append((dt, w_val / 7.0))
        else:
            days_raw.append((dt, month_total / last_day))

    raw_sum = sum(v for _, v in days_raw if v is not None)
    scale = (month_total / raw_sum) if (month_total is not None and raw_sum > 0) else 1.0
    scaled_vals = [(v * scale) for _, v in days_raw if v is not None]
    std_d = math.sqrt(sum((x - (daily_baseline or 0.0)) ** 2 for x in scaled_vals) / len(scaled_vals)) if (scaled_vals and daily_baseline is not None) else None

    days_out = []
    for dt, raw_v in days_raw:
        val = (raw_v * scale) if raw_v is not None else None
        anom_pct = ((val - daily_baseline) / daily_baseline * 100.0) if (val is not None and daily_baseline and daily_baseline > 0) else None
        anom_z = ((val - daily_baseline) / std_d) if (val is not None and daily_baseline is not None and std_d and std_d > 0) else None
        days_out.append({
            'date': dt.isoformat(),
            'day': dt.day,
            'weekday': dt.weekday(),
            'iso_week': dt.isocalendar().week,
            'value': round(float(val), 2) if val is not None else None,
            'baseline_mean': round(float(daily_baseline), 2) if daily_baseline is not None else None,
            'anomaly_pct': round(float(anom_pct), 2) if anom_pct is not None else None,
            'anomaly_zscore': round(float(anom_z), 2) if anom_z is not None else None,
        })

    return {
        'year': year,
        'month': month,
        'days_in_month': last_day,
        'first_weekday': date(year, month, 1).weekday(),
        'source': 'weekly_distributed' if used_weekly else 'monthly_distributed',
        'is_estimated': True,
        'unit': monthly_res.get('unit'),
        'resolution_source': 'iso_weekly_distributed' if used_weekly else 'monthly_distributed',
        'month_total': round(float(month_total), 2) if month_total is not None else None,
        'baseline_mean': round(float(baseline_month), 2) if baseline_month is not None else None,
        'days': days_out,
    }
