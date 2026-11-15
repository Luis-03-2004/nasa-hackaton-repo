"""F₂ experimental com uma referência semanal comum e fallback F₀ explícito.

Cache derivado: nenhum original é alterado. A unidade legada preservada é
atividade célula × mês × semana/sensor, não células únicas ou área queimada.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date, timedelta
from functools import lru_cache
import hashlib
from itertools import groupby
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import struct
import time

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
from fastapi import HTTPException

from app.forecast import DATA_DIR, FEATURE_NAMES, artifacts, extract_physical_features, predict_multivariate_row

CACHE_DIR = DATA_DIR / 'web_v2/f2'
CACHE_VERSION = 'f2_common_week_cells_v1'
SENSORS = ('modis', 'viirs-snpp', 'viirs-jpss1')
POINT_PATTERN = re.compile(r'^pt_([+-]\d{2})_([+-]\d{3})$')


def point_id(lat, lon):
    return f'pt_{lat:+03d}_{lon:+04d}'


def zone_for(lat):
    if lat < -23.5: return 'temp_sul'
    if lat < 0: return 'trop_sul'
    if lat < 23.5: return 'trop_norte'
    if lat < 50: return 'temp_norte'
    return 'boreal'


def validate_ids(ids):
    result = set()
    for value in ids:
        match = POINT_PATTERN.fullmatch(value)
        if not match or not -90 <= int(match[1]) < 90 or not -180 <= int(match[2]) < 180:
            raise ValueError(f'Invalid point ID: {value}')
        result.add(value)
    return tuple(sorted(result))


def cache_path():
    return CACHE_DIR / 'weekly.sqlite'


def sources():
    result = []
    for sensor in SENSORS:
        for path in sorted((DATA_DIR / 'parquet_025deg' / sensor).glob('*.parquet')):
            match = re.search(r'_(\d{4})_', path.name)
            if match and 2012 <= int(match[1]) <= 2025:
                stat = path.stat()
                result.append((sensor, int(match[1]), path, stat.st_size, stat.st_mtime_ns))
    return result


def raw_source_signature():
    manifest = [(s,y,str(p.relative_to(DATA_DIR)),size,modified) for s,y,p,size,modified in sources()]
    return hashlib.sha256(json.dumps([CACHE_VERSION,manifest]).encode()).hexdigest()


@lru_cache(maxsize=8)
def _model_digest(filename, size, modified):
    return hashlib.sha256((DATA_DIR/filename).read_bytes()).hexdigest()


def source_signature():
    models=[]
    for name in ('previsao_mapa_mundi/modelo_multivariado_global_f2.json','experimento_2000_2025/resultado_global_2000_2025.json'):
        stat=(DATA_DIR/name).stat()
        models.append((name,_model_digest(name,stat.st_size,stat.st_mtime_ns)))
    return hashlib.sha256(json.dumps([raw_source_signature(),models]).encode()).hexdigest()


def cache_ready():
    if not cache_path().is_file(): return False
    try:
        with sqlite3.connect(cache_path()) as db:
            return db.execute("SELECT value FROM metadata WHERE key='signature'").fetchone() == (raw_source_signature(),)
    except sqlite3.Error:
        return False


def _ensure_inventory(db):
    exists = db.execute("SELECT 1 FROM sqlite_master WHERE name='point_inventory'").fetchone()
    if not exists:
        db.execute('CREATE TABLE point_inventory AS SELECT point_id,lat,lon,country FROM weekly GROUP BY point_id,country')
        db.execute('CREATE INDEX inventory_scope ON point_inventory(country,point_id)')
        db.execute('CREATE INDEX inventory_point ON point_inventory(point_id)')
        db.commit()
    elif not db.execute("SELECT 1 FROM sqlite_master WHERE name='inventory_point'").fetchone():
        db.execute('CREATE INDEX inventory_point ON point_inventory(point_id)')
        db.commit()
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='weekly_time'").fetchone():
        db.execute('CREATE INDEX weekly_time ON weekly(iso_year,iso_week,country)')
        db.commit()


def _ensure_fast_tables(db):
    """Pré-calcula climatologia semanal (52 semanas em float64) e observações 2024–2025 por célula."""
    has_meta = db.execute("SELECT 1 FROM sqlite_master WHERE name='metadata'").fetchone()
    if not has_meta:
        return False
    sig = raw_source_signature()
    has_fast = bool(
        db.execute("SELECT 1 FROM sqlite_master WHERE name='fast_clim_blob'").fetchone()
        and db.execute("SELECT 1 FROM sqlite_master WHERE name='fast_obs'").fetchone()
        and db.execute("SELECT 1 FROM fast_clim_blob LIMIT 1").fetchone()
    )
    if has_fast:
        return True

    t0 = time.monotonic()
    available = {(r[0], r[1], r[2]) for r in db.execute('SELECT * FROM source_weeks')}
    avail_years_by_w = {
        w: [y for y in range(2012, 2024) if source_available(y, w, available)]
        for w in range(1, 53)
    }
    neighbors_by_w = {w: ((w - 2) % 52 + 1, w, w % 52 + 1) for w in range(1, 53)}
    n_samples_by_w = {
        w: sum(len(avail_years_by_w[nw]) for nw in neighbors_by_w[w])
        for w in range(1, 53)
    }
    if any(n == 0 for n in n_samples_by_w.values()):
        return False
    sample_min_global = min(n_samples_by_w.values())

    db.executescript('''
        DROP TABLE IF EXISTS fast_clim_blob;
        DROP TABLE IF EXISTS fast_obs;
        CREATE TABLE fast_clim_blob(
            scope TEXT,
            point_id TEXT,
            lat INTEGER,
            lon INTEGER,
            country TEXT,
            sample_min INTEGER,
            mu_blob BLOB,
            PRIMARY KEY(scope, point_id)
        ) WITHOUT ROWID;
        CREATE TABLE fast_obs(
            scope TEXT,
            iso_year INTEGER,
            iso_week INTEGER,
            point_id TEXT,
            h_cells REAL,
            merged REAL,
            frp REAL,
            bright REAL,
            bg_mean REAL,
            night REAL,
            PRIMARY KEY(scope, iso_year, iso_week, point_id)
        ) WITHOUT ROWID;
    ''')

    def _build_point_records(scope_name, pid, lat, lon, c_name, series):
        w_sum = [0.0] * 53
        for (y, w), obs in series.items():
            if 2012 <= y <= 2023 and 1 <= w <= 52 and source_available(y, w, available):
                w_sum[w] += obs['h_cells']
        mu_vals = [
            (w_sum[n1] + w_sum[n2] + w_sum[n3]) / n_samples_by_w[w]
            for w, (n1, n2, n3) in neighbors_by_w.items()
        ]
        clim_row = (scope_name, pid, lat, lon, c_name, sample_min_global, struct.pack('52d', *mu_vals))
        obs_rows = [
            (scope_name, int(y), int(w), pid, obs['h_cells'], obs['merged_count'], obs['frp_sum'], obs['bright_max'], obs['bright_bg_mean'], obs['night_count'])
            for (y, w), obs in series.items()
            if y >= 2024 and 1 <= w <= 53
        ]
        return clim_row, obs_rows

    db.row_factory = sqlite3.Row
    has_idx = db.execute("SELECT 1 FROM sqlite_master WHERE name='weekly_point_time'").fetchone()
    idx_clause = 'INDEXED BY weekly_point_time' if has_idx else ''
    cur = db.execute(
        f'SELECT point_id,lat,lon,country,iso_year,iso_week,sensor,cells,merged,frp,bright,bg_sum,bg_weight,night FROM weekly {idx_clause} ORDER BY point_id'
    )

    clim_batch = []
    obs_batch = []
    for pid, pt_iter in groupby(cur, key=lambda r: r['point_id']):
        pt_rows = list(pt_iter)
        if not pt_rows:
            continue
        lat = int(pt_rows[0]['lat'])
        lon = int(pt_rows[0]['lon'])
        by_country = defaultdict(list)
        for r in pt_rows:
            by_country[r['country']].append(r)

        if len(by_country) == 1:
            c_name, c_rows = next(iter(by_country.items()))
            series, _ = point_series(c_rows)
            c_clim, c_obs = _build_point_records(c_name, pid, lat, lon, c_name, series)
            g_clim = ('', pid, lat, lon, c_name, sample_min_global, c_clim[6])
            g_obs = [('', r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9]) for r in c_obs]
            clim_batch.append(c_clim)
            clim_batch.append(g_clim)
            obs_batch.extend(c_obs)
            obs_batch.extend(g_obs)
        else:
            primary_country = max(by_country.items(), key=lambda kv: len(kv[1]))[0]
            for c_name, c_rows in by_country.items():
                series, _ = point_series(c_rows)
                c_clim, c_obs = _build_point_records(c_name, pid, lat, lon, c_name, series)
                clim_batch.append(c_clim)
                obs_batch.extend(c_obs)
            g_series, _ = point_series(pt_rows)
            g_clim, g_obs = _build_point_records('', pid, lat, lon, primary_country, g_series)
            clim_batch.append(g_clim)
            obs_batch.extend(g_obs)

        if len(clim_batch) >= 4000:
            db.executemany('INSERT OR REPLACE INTO fast_clim_blob VALUES (?,?,?,?,?,?,?)', clim_batch)
            db.executemany('INSERT OR REPLACE INTO fast_obs VALUES (?,?,?,?,?,?,?,?,?,?)', obs_batch)
            clim_batch.clear()
            obs_batch.clear()

    if clim_batch or obs_batch:
        db.executemany('INSERT OR REPLACE INTO fast_clim_blob VALUES (?,?,?,?,?,?,?)', clim_batch)
        db.executemany('INSERT OR REPLACE INTO fast_obs VALUES (?,?,?,?,?,?,?,?,?,?)', obs_batch)

    db.execute("INSERT OR REPLACE INTO metadata VALUES ('fast_signature', ?)", (sig,))
    db.commit()
    print(f'F2 fast tables prontas em {time.monotonic() - t0:.2f}s', flush=True)
    return True


def build_cache():
    """Materializa os 36 arquivos de 2012–2025; escrita atômica e lock local."""
    if cache_ready():
        if os.getenv('FIRE_REQUIRE_PREPARED_CACHE') != '1':
            with sqlite3.connect(cache_path(), timeout=60) as db:
                _ensure_inventory(db)
                _ensure_fast_tables(db)
        return cache_path()
    if os.getenv('FIRE_REQUIRE_PREPARED_CACHE') == '1':
        raise HTTPException(503, 'Histórico temporariamente indisponível. Tente novamente mais tarde.', headers={'Retry-After': '5'})
    import fcntl
    CACHE_DIR.mkdir(parents=True,exist_ok=True)
    with (CACHE_DIR/'build.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if cache_ready(): return cache_path()
        staging = CACHE_DIR/'weekly.build.sqlite'
        if staging.exists(): staging.unlink()  # somente o próprio derivado incompleto
        started = time.monotonic()
        with sqlite3.connect(staging) as db:
            db.execute('PRAGMA journal_mode=OFF')
            db.execute('PRAGMA synchronous=OFF')
            db.executescript('''
                CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
                CREATE TABLE weekly(point_id TEXT,lat INTEGER,lon INTEGER,country TEXT,iso_year INTEGER,iso_week INTEGER,sensor TEXT,cells REAL,merged REAL,frp REAL,bright REAL,bg_sum REAL,bg_weight REAL,night REAL);
                CREATE TABLE source_weeks(iso_year INTEGER,iso_week INTEGER,sensor TEXT,PRIMARY KEY(iso_year,iso_week,sensor));
            ''')
            insert = 'INSERT INTO weekly VALUES ('+','.join('?' for _ in range(14))+')'
            files = sources()
            for number,(sensor,year,path,_,_) in enumerate(files,1):
                table = pq.read_table(path,columns=['year','month','iso_week','country','lat_025','lon_025','active_1km_cells','merged_count','frp_sum','bright_max','bright_bg_mean','night_count'])
                iso_year = pc.if_else(pc.and_(pc.equal(table['month'],1),pc.greater_equal(table['iso_week'],52)),pc.subtract(table['year'],1),pc.if_else(pc.and_(pc.equal(table['month'],12),pc.equal(table['iso_week'],1)),pc.add(table['year'],1),table['year']))
                cells = pc.cast(table['active_1km_cells'],pa.float64())
                bg = pc.cast(table['bright_bg_mean'],pa.float64())
                valid_bg = pc.fill_null(pc.and_(pc.is_finite(bg),pc.greater(bg,0)),False)
                enriched = pa.table({
                    'lat':pc.cast(pc.floor(pc.divide(pc.cast(table['lat_025'],pa.float64()),4)),pa.int16()),
                    'lon':pc.cast(pc.floor(pc.divide(pc.cast(table['lon_025'],pa.float64()),4)),pa.int16()),
                    'country':table['country'],'iso_year':iso_year,'iso_week':table['iso_week'],
                    'cells':cells,'merged':pc.cast(table['merged_count'],pa.float64()),'frp':pc.cast(table['frp_sum'],pa.float64()),
                    'bright':pc.cast(table['bright_max'],pa.float64()),'bg_sum':pc.if_else(valid_bg,pc.multiply(bg,cells),0.),
                    'bg_weight':pc.if_else(valid_bg,cells,0.),'night':pc.cast(table['night_count'],pa.float64()),
                })
                grouped = enriched.group_by(['lat','lon','country','iso_year','iso_week']).aggregate([('cells','sum'),('merged','sum'),('frp','sum'),('bright','max'),('bg_sum','sum'),('bg_weight','sum'),('night','sum')])
                weeks = set()
                def records():
                    for row in grouped.to_pylist():
                        y,w = int(row['iso_year']),int(row['iso_week'])
                        weeks.add((y,w,sensor))
                        yield (point_id(row['lat'],row['lon']),row['lat'],row['lon'],row['country'],y,w,sensor,row['cells_sum'],row['merged_sum'],row['frp_sum'],row['bright_max'],row['bg_sum_sum'],row['bg_weight_sum'],row['night_sum'])
                db.executemany(insert,records())
                db.executemany('INSERT OR IGNORE INTO source_weeks VALUES (?,?,?)',weeks)
                db.commit()
                print(f'F2 cache {number}/{len(files)}: {path.name}: {grouped.num_rows:,} grupos',flush=True)
                del table,enriched,grouped
            db.execute('CREATE INDEX weekly_point_country ON weekly(point_id,country)')
            db.execute('CREATE INDEX weekly_point_time ON weekly(point_id,iso_year,iso_week,sensor)')
            db.execute('CREATE INDEX weekly_country_point ON weekly(country,point_id)')
            _ensure_inventory(db)
            db.executemany('INSERT INTO metadata VALUES (?,?)',[('signature',raw_source_signature()),('version',CACHE_VERSION),('build_seconds',str(round(time.monotonic()-started,2)))])
            db.commit()
            _ensure_fast_tables(db)
        staging.replace(cache_path())
        print(f'F2 cache pronto: {cache_path().stat().st_size:,} bytes em {time.monotonic()-started:.2f}s',flush=True)
    return cache_path()


@lru_cache(maxsize=1)
def model_metadata():
    history,model,_,_ = artifacts()
    return history['harmonization'],model['models_by_scope']


def harmonize(values,zone,year,week):
    """Transformação legada compatível, sem alegar unicidade espacial."""
    modis,snpp,jpss = (values.get(sensor,0.) for sensor in SENSORS)
    factors = model_metadata()[0][zone]
    month = min(12,max(1,math.ceil(week*12/52)))
    era = 'factors_era2_2012_2017' if year<2018 else 'factors_era3_2018_2025'
    alpha = factors[era]['alpha_monthly'][str(month)]
    viirs = snpp if year<2018 or jpss<=0 else .5*(snpp+jpss)
    adjusted = float(alpha)*viirs
    return .5*(modis+adjusted) if modis>0 else adjusted


def load_selection(country,ids,reference=None):
    db = sqlite3.connect(build_cache(), timeout=60)
    db.row_factory = sqlite3.Row
    clauses=[];parameters=[]
    if country:
        clauses.append('country=?');parameters.append(country)
    if ids:
        db.execute('CREATE TEMP TABLE selection(point_id TEXT PRIMARY KEY)')
        db.executemany('INSERT INTO selection VALUES (?)',((value,) for value in ids))
        clauses.append('point_id IN (SELECT point_id FROM selection)')
    where = ' WHERE '+' AND '.join(clauses) if clauses else ''
    available = {(r[0],r[1],r[2]) for r in db.execute('SELECT * FROM source_weeks')}
    if reference is None:
        query = """SELECT point_id,lat,lon,iso_year,iso_week,sensor,SUM(cells) cells,SUM(merged) merged,SUM(frp) frp,MAX(bright) bright,SUM(bg_sum) bg_sum,SUM(bg_weight) bg_weight,SUM(night) night FROM weekly"""+where+' GROUP BY point_id,iso_year,iso_week,sensor ORDER BY point_id,iso_year,iso_week'
        return db,db.execute(query,parameters),available
    # Keep every eligible cell, even cells with zero records in this seasonal
    # window. Only the weeks actually needed by t, t-1 and h1..h4 are loaded.
    exists=db.execute("SELECT 1 FROM sqlite_master WHERE name='point_inventory'").fetchone()
    if not exists:
        import fcntl
        CACHE_DIR.mkdir(parents=True,exist_ok=True)
        with (CACHE_DIR/'inventory.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            _ensure_inventory(db)
    needed=set()
    for offset in (-1,0,1,2,3,4):
        week=(reference+timedelta(weeks=offset)).isocalendar().week
        for target in ([52,1] if week==53 else [week]):
            needed.update(((target-2)%52+1,target,target%52+1))
    current=[]
    for offset in (-1,0,1,2,3,4):
        y,w,_=(reference+timedelta(weeks=offset)).isocalendar()
        current.append((y,w))
    joined_country=' AND w.country=?' if country else ''
    seasonal='(w.iso_year BETWEEN 2012 AND 2023 AND w.iso_week IN ('+','.join('?' for _ in needed)+'))'
    weekly=' OR '.join('(w.iso_year=? AND w.iso_week=?)' for _ in current)
    query="""WITH scoped AS (SELECT point_id,min(lat) lat,min(lon) lon FROM point_inventory"""+where+""" GROUP BY point_id)
        SELECT p.point_id,p.lat,p.lon,w.iso_year,w.iso_week,w.sensor,
        SUM(w.cells) cells,SUM(w.merged) merged,SUM(w.frp) frp,MAX(w.bright) bright,
        SUM(w.bg_sum) bg_sum,SUM(w.bg_weight) bg_weight,SUM(w.night) night
        FROM scoped p LEFT JOIN weekly w ON w.point_id=p.point_id"""+joined_country+' AND ('+seasonal+' OR '+weekly+') GROUP BY p.point_id,w.iso_year,w.iso_week,w.sensor ORDER BY p.point_id,w.iso_year,w.iso_week'
    bound=parameters+([country] if country else [])+sorted(needed)+[value for pair in current for value in pair]
    return db,db.execute(query,bound),available


def source_available(year,week,available):
    expected = SENSORS if year>=2018 else SENSORS[:2]
    return all((year,week,sensor) in available for sensor in expected)


def point_series(rows):
    lat=None
    raw=defaultdict(lambda:{'sensors':{},'merged_count':0.,'frp_sum':0.,'bright_max':None,'bg_sum':0.,'bg_weight':0.,'night_count':0.})
    for row in rows:
        lat=row['lat']
        if row['iso_year'] is None: continue
        obs=raw[(row['iso_year'],row['iso_week'])]
        obs['sensors'][row['sensor']]=row['cells']
        for dest,source in [('merged_count','merged'),('frp_sum','frp'),('bg_sum','bg_sum'),('bg_weight','bg_weight'),('night_count','night')]:
            obs[dest]+=row[source] or 0.
        if row['bright'] is not None and math.isfinite(row['bright']) and row['bright']>0:
            obs['bright_max']=max(obs['bright_max'] or 0.,row['bright'])
    zone=zone_for(lat)
    for (year,week),obs in raw.items():
        obs['h_cells']=harmonize(obs['sensors'],zone,year,week)
        obs['bright_bg_mean']=obs['bg_sum']/obs['bg_weight'] if obs['bg_weight']>0 else None
    return raw,zone


def climatology(series,week,available):
    neighbors=((week-2)%52+1,week,(week%52)+1)
    values=[series.get((year,w),{}).get('h_cells',0.) for year in range(2012,2024) for w in neighbors if source_available(year,w,available)]
    return (sum(values)/len(values),len(values)) if values else (None,0)


def forecast_point(series,zone,reference,available):
    year,week,_=reference.isocalendar();previous=reference-timedelta(days=7)
    py,pw,_=previous.isocalendar()
    mu_t,n_t=climatology(series,week,available);mu_previous,n_previous=climatology(series,pw,available)
    if mu_t is None or mu_previous is None:return None
    current=series.get((year,week));prior=series.get((py,pw),{'h_cells':0.})
    thermal_ok=current is not None and current.get('bright_max') is not None and current.get('bright_bg_mean') is not None
    physical_ok=thermal_ok and current['h_cells']>0 and current['merged_count']>0
    inputs_ok=source_available(year,week,available) and source_available(py,pw,available)
    use_f2=physical_ok and inputs_ok
    features=extract_physical_features(current,prior,mu_t,mu_previous) if use_f2 else None
    projected=[]
    for h in range(1,5):
        target=reference+timedelta(days=7*h);ty,tw,_=target.isocalendar()
        if tw==53:
            a,_=climatology(series,52,available);b,_=climatology(series,1,available)
            baseline=None if a is None or b is None else .5*(a+b)
        else:baseline,_=climatology(series,tw,available)
        if baseline is None:return None
        weights=model_metadata()[1][zone]['evaluation'][f'h{h}']['weights_f2']
        predicted=predict_multivariate_row(baseline,features,[weights[name] for name in FEATURE_NAMES])[0] if use_f2 else baseline
        actual=series.get((ty,tw),{}).get('h_cells',0.) if source_available(ty,tw,available) else None
        projected.append({'horizon':h,'target_date':target.isoformat(),'value':predicted,'baseline':baseline,'actual':actual})
    return {'forecasts':projected,'current':current,'use_f2':use_f2,'sample_count':min(n_t,n_previous),'reference_source_available':inputs_ok}


def localized(locale,pt,en):
    return pt if locale=='pt-BR' else en


def provenance_text(locale):
    return localized(locale,
        'Projeção experimental da equipe sobre NASA FIRMS / EOSDIS. Todas as células usam a mesma semana. F₂ usa pesos zonais treinados em 2012–2023; F₀ (climatologia) substitui F₂ sem detecções/telemetria úteis. Sem temperaturas ou FRP sintéticos. Ausência de registro não comprova ausência de fogo ou observação. Unidade legada: atividade célula × mês × semana/sensor harmonizada por célula; não incêndios únicos nem área queimada. Temperatura de fundo é proxy de médias 0,25°, não média bruta exata. Não é previsão atual nem oficial NASA.',
        'Experimental team projection using NASA FIRMS / EOSDIS. All cells use the same week. F₂ uses zonal weights trained on 2012–2023; F₀ (climatology) replaces F₂ without useful detections/telemetry. No synthetic temperature or FRP. No record does not prove no fire or observation. Legacy unit: cell × month × week/sensor activity harmonized per cell; not unique fires or burned area. Background temperature is a proxy from 0.25° means, not an exact raw mean. Not a current or official NASA forecast.')


def forecast_selection(country=None,point_ids=None,reference_date='2025-12-22',locale='pt-BR'):
    ids=validate_ids(point_ids or [])
    reference=date.fromisoformat(str(reference_date));reference-=timedelta(days=reference.weekday())
    empty={'selected_count':len(ids),'processed_count':0,'missing_count':len(ids),'imputed_count':0,'f2_count':0,'fallback_count':0}
    if reference<date(2024,1,1) or reference>date(2027,12,31):
        return {'available':False,'reason':localized(locale,'Use uma semana a partir de 01/01/2024 (até 2027-12-31). O treinamento usa 2012–2023.','Choose a week from 2024-01-01 (up to 2027-12-31). Training uses 2012–2023.'),'reference_date':reference.isoformat(),'period_end':(reference+timedelta(days=6)).isoformat(),'forecasts':[],'coverage':empty,'method':CACHE_VERSION}
    return _cached_forecast(country,ids,reference.isoformat(),locale,source_signature())


@lru_cache(maxsize=96)
def _cached_forecast(country,ids,reference_text,locale,signature):
    response_key=hashlib.sha256(json.dumps([country,ids,reference_text,locale,signature,'v2_map']).encode()).hexdigest()
    response_path=CACHE_DIR/'responses'/(response_key+'.json')
    if response_path.is_file():
        try:return json.loads(response_path.read_text())
        except (OSError,ValueError):pass
    alternate_key=hashlib.sha256(json.dumps([country,ids,reference_text,'en' if locale=='pt-BR' else 'pt-BR',signature,'v2_map']).encode()).hexdigest()
    alternate_path=response_path.parent/(alternate_key+'.json')
    if alternate_path.is_file():
        try:
            result=json.loads(alternate_path.read_text())
            result['provenance']=provenance_text(locale)
            if result['reason']:
                result['reason']=localized(locale,'Histórico insuficiente na seleção.','Insufficient history in the selection.')
            if result.get('notices'):
                result['notices'] = _build_notices(locale, date.fromisoformat(reference_text) > date(2025, 12, 22), result.get('telemetry_reference_date') or reference_text)
            return result
        except (OSError,ValueError):pass

    reference=date.fromisoformat(reference_text)
    is_future_cycle = reference > date(2025, 12, 22)
    if is_future_cycle:
        ref_w = min(52, reference.isocalendar().week)
        telemetry_ref = date.fromisocalendar(2025, ref_w, 1)
    else:
        telemetry_ref = reference

    totals=[{'horizon':h,'target_date':(reference+timedelta(days=7*h)).isoformat(),'value':0.,'baseline':0.,'actual':0.,'_has_actual':False} for h in range(1,5)]
    recent_totals=[{'offset':off,'period':(reference+timedelta(days=7*off)).isoformat(),'value':0.,'baseline':0.} for off in (-3,-2,-1,0)]
    observed={'value':0.,'baseline':0.,'frp_sum_mw':0.,'merged_count':0.,'night_count':0.,'delta_t_weighted':0.,'delta_t_weight':0.}
    known=processed=f2_count=fallback_count=missing=0;sample_min=None
    map_candidates=[]

    cache_file = build_cache()
    db = sqlite3.connect(cache_file, timeout=60)
    db.row_factory = sqlite3.Row
    try:
        available = {(r[0],r[1],r[2]) for r in db.execute('SELECT * FROM source_weeks')}
        use_fast = _ensure_fast_tables(db)
        if use_fast:
            scope_key = country or ''
            if ids:
                db.execute('CREATE TEMP TABLE IF NOT EXISTS sel_pts(point_id TEXT PRIMARY KEY)')
                db.execute('DELETE FROM sel_pts')
                db.executemany('INSERT OR IGNORE INTO sel_pts VALUES (?)', ((v,) for v in ids))
                clim_where = 'scope=? AND point_id IN (SELECT point_id FROM sel_pts)'
                obs_where_prefix = 'scope=? AND point_id IN (SELECT point_id FROM sel_pts) AND ('
            else:
                clim_where = 'scope=?'
                obs_where_prefix = 'scope=? AND ('

            # Weeks needed from fast_obs: t-3..t (anchored at telemetry_ref) + t+1..t+4 (if not future cycle)
            needed_yw = set()
            for off in (-3, -2, -1, 0):
                dt_off = telemetry_ref + timedelta(days=7 * off)
                y_o, w_o, _ = dt_off.isocalendar()
                needed_yw.add((int(y_o), min(52, int(w_o))))
            if not is_future_cycle:
                for h in range(1, 5):
                    dt_h = reference + timedelta(days=7 * h)
                    y_h, w_h, _ = dt_h.isocalendar()
                    needed_yw.add((int(y_h), min(52, int(w_h))))

            yw_list = sorted(needed_yw)
            yw_clause = ' OR '.join('(iso_year=? AND iso_week=?)' for _ in yw_list)
            obs_params = [scope_key, *[val for pair in yw_list for val in pair]]
            obs_map = {}
            for r in db.execute(
                f'SELECT iso_year,iso_week,point_id,h_cells,merged,frp,bright,bg_mean,night FROM fast_obs WHERE {obs_where_prefix}{yw_clause})',
                obs_params,
            ):
                obs_map[(r['point_id'], int(r['iso_year']), int(r['iso_week']))] = {
                    'h_cells': float(r['h_cells'] or 0.),
                    'merged_count': float(r['merged'] or 0.),
                    'frp_sum': float(r['frp'] or 0.),
                    'bright_max': float(r['bright']) if r['bright'] is not None else None,
                    'bright_bg_mean': float(r['bg_mean']) if r['bg_mean'] is not None else None,
                    'night_count': float(r['night'] or 0.),
                }

            ty_curr, tw_curr, _ = telemetry_ref.isocalendar()
            tw_curr = min(52, int(tw_curr))
            prev_dt = telemetry_ref - timedelta(days=7)
            ty_prev, tw_prev, _ = prev_dt.isocalendar()
            tw_prev = min(52, int(tw_prev))
            inputs_ok = source_available(ty_curr, tw_curr, available) and source_available(ty_prev, tw_prev, available)

            models_by_scope = model_metadata()[1]
            weights_by_zone_h = {
                (z, h): [models_by_scope[z]['evaluation'][f'h{h}']['weights_f2'][name] for name in FEATURE_NAMES]
                for z in ('temp_sul', 'trop_sul', 'trop_norte', 'temp_norte', 'boreal')
                for h in range(1, 5)
            }

            target_yws = []
            for h in range(1, 5):
                dt_h = reference + timedelta(days=7 * h)
                yh, wh, _ = dt_h.isocalendar()
                act_avail = (not is_future_cycle) and source_available(yh, min(52, wh), available)
                target_yws.append((int(yh), int(wh), act_avail))

            hist_yws = []
            for off in (-3, -2, -1, 0):
                dt_off = telemetry_ref + timedelta(days=7 * off)
                yo, wo, _ = dt_off.isocalendar()
                hist_yws.append((off, int(yo), min(52, int(wo))))

            for crow in db.execute(f'SELECT point_id,lat,lon,country,sample_min,mu_blob FROM fast_clim_blob WHERE {clim_where}', [scope_key]):
                known += 1
                pid = crow['point_id']
                lat = int(crow['lat'])
                lon = int(crow['lon'])
                c_name = crow['country']
                pt_smin = int(crow['sample_min'])
                mu = struct.unpack('52d', crow['mu_blob'])
                mu_t = mu[tw_curr - 1]
                mu_previous = mu[tw_prev - 1]
                if mu_t < 0 or mu_previous < 0:
                    missing += 1
                    continue
                processed += 1
                sample_min = pt_smin if sample_min is None else min(sample_min, pt_smin)

                current = obs_map.get((pid, ty_curr, tw_curr))
                prior = obs_map.get((pid, ty_prev, tw_prev), {'h_cells': 0.})
                thermal_ok = current is not None and current.get('bright_max') is not None and current.get('bright_bg_mean') is not None
                physical_ok = thermal_ok and current['h_cells'] > 0 and current['merged_count'] > 0
                use_f2 = physical_ok and inputs_ok
                if use_f2:
                    f2_count += 1
                else:
                    fallback_count += 1

                observed['baseline'] += mu_t
                obs_h = 0.0
                if current:
                    obs_h = current['h_cells']
                    observed['value'] += obs_h
                    observed['frp_sum_mw'] += current['frp_sum']
                    observed['merged_count'] += current['merged_count']
                    observed['night_count'] += current['night_count']
                    if thermal_ok and obs_h > 0:
                        dt_k = max(0., float(current['bright_max']) - float(current['bright_bg_mean']))
                        observed['delta_t_weighted'] += dt_k * obs_h
                        observed['delta_t_weight'] += obs_h

                for idx_off, (_, hy, hw) in enumerate(hist_yws):
                    h_mu = mu[hw - 1]
                    h_obs = obs_map.get((pid, hy, hw))
                    recent_totals[idx_off]['baseline'] += h_mu
                    recent_totals[idx_off]['value'] += (h_obs['h_cells'] if h_obs else 0.)

                zone = zone_for(lat)
                features = extract_physical_features(current, prior, mu_t, mu_previous) if use_f2 else None
                pt_preds = []
                pt_base_h1 = 0.0
                for h_idx, (yh, wh, act_avail) in enumerate(target_yws):
                    h_num = h_idx + 1
                    baseline = 0.5 * (mu[51] + mu[0]) if wh == 53 else mu[wh - 1]
                    if h_num == 1:
                        pt_base_h1 = baseline
                    pred_val = predict_multivariate_row(baseline, features, weights_by_zone_h[(zone, h_num)])[0] if use_f2 else baseline
                    totals[h_idx]['value'] += pred_val
                    totals[h_idx]['baseline'] += baseline
                    if act_avail:
                        act_obs = obs_map.get((pid, yh, min(52, wh)))
                        totals[h_idx]['actual'] += (act_obs['h_cells'] if act_obs else 0.)
                        totals[h_idx]['_has_actual'] = True
                    pt_preds.append(pred_val)

                if pt_preds[0] > 0.01 or pt_preds[1] > 0.01 or obs_h > 0.01 or ids:
                    anom_h1 = round((pt_preds[0] - pt_base_h1) / pt_base_h1 * 100.0, 2) if pt_base_h1 > 0.01 else 0.0
                    map_candidates.append({
                        'point_id': pid,
                        'lat_center': lat + 0.5,
                        'lon_center': lon + 0.5,
                        'country': c_name,
                        'observed': round(obs_h, 2),
                        'h1': round(pt_preds[0], 2),
                        'h2': round(pt_preds[1], 2),
                        'h3': round(pt_preds[2], 2),
                        'h4': round(pt_preds[3], 2),
                        'baseline_h1': round(pt_base_h1, 2),
                        'anomaly_pct_h1': anom_h1,
                        'mode': 'F2' if use_f2 else 'F0',
                    })
        else:
            db.close()
            db,cursor,available=load_selection(country,ids,telemetry_ref)
            for pid,rows in groupby(cursor,key=lambda row:row['point_id']):
                row_list = list(rows)
                lat = int(row_list[0]['lat']) if row_list else 0
                lon = int(row_list[0]['lon']) if row_list else 0
                series,zone=point_series(row_list);known+=1
                prediction=forecast_point(series,zone,telemetry_ref,available)
                if prediction is None:
                    missing+=1;continue
                processed+=1
                sample_min=prediction['sample_count'] if sample_min is None else min(sample_min,prediction['sample_count'])
                if prediction['use_f2']:f2_count+=1
                else:fallback_count+=1
                current=prediction['current']
                obs_h = 0.0
                if current:
                    obs_h = current['h_cells']
                    observed['value']+=obs_h
                    for target,source in [('frp_sum_mw','frp_sum'),('merged_count','merged_count'),('night_count','night_count')]:observed[target]+=current[source]
                for result_h,total in zip(prediction['forecasts'],totals,strict=True):
                    total['value']+=result_h['value'];total['baseline']+=result_h['baseline']
                    if result_h.get('actual') is not None and not is_future_cycle:
                        total['actual']+=result_h['actual']
                        total['_has_actual']=True
                fcs_pt = prediction['forecasts']
                if fcs_pt and (fcs_pt[0]['value'] > 0.01 or obs_h > 0.01 or ids):
                    b1 = fcs_pt[0]['baseline']
                    map_candidates.append({
                        'point_id': pid,
                        'lat_center': lat + 0.5,
                        'lon_center': lon + 0.5,
                        'country': country or '',
                        'observed': round(obs_h, 2),
                        'h1': round(fcs_pt[0]['value'], 2),
                        'h2': round(fcs_pt[1]['value'], 2),
                        'h3': round(fcs_pt[2]['value'], 2),
                        'h4': round(fcs_pt[3]['value'], 2),
                        'baseline_h1': round(b1, 2),
                        'anomaly_pct_h1': round((fcs_pt[0]['value'] - b1) / b1 * 100.0, 2) if b1 > 0.01 else 0.0,
                        'mode': 'F2' if prediction['use_f2'] else 'F0',
                    })
    finally:
        db.close()

    selected=len(ids) if ids else known;missing+=max(0,selected-known)
    for total in totals:
        has_act = total.pop('_has_actual', False)
        total['anomaly_pct']=round((total['value']-total['baseline'])/total['baseline']*100,4) if total['baseline']>0 else None
        total['value']=round(total['value'],4);total['baseline']=round(total['baseline'],4)
        total['actual']=round(total['actual'],4) if has_act else None

    for r_tot in recent_totals:
        r_tot['anomaly_pct'] = round((r_tot['value'] - r_tot['baseline']) / r_tot['baseline'] * 100, 2) if r_tot['baseline'] > 0 else None
        r_tot['value'] = round(r_tot['value'], 2)
        r_tot['baseline'] = round(r_tot['baseline'], 2)

    dt_weighted = observed.pop('delta_t_weighted', 0.0)
    dt_weight = observed.pop('delta_t_weight', 0.0)
    obs_base = observed.pop('baseline', 0.0)
    observed={key:round(value,4) for key,value in observed.items()}
    observed['baseline'] = round(obs_base, 4)
    observed['anomaly_pct'] = round((observed['value'] - obs_base) / obs_base * 100, 2) if obs_base > 0 else None
    observed['night_ratio']=round(observed['night_count']/observed['merged_count'],4) if observed['merged_count']>0 else None
    observed['delta_t_k']=round(dt_weighted / dt_weight, 2) if dt_weight > 0 else None

    # Risk level: None if pure F0 fallback (required by contract test), else classified from h1 projection
    risk_level = None
    if f2_count > 0 and totals:
        anom1 = totals[0].get('anomaly_pct') or 0.0
        val1 = totals[0].get('value') or 0.0
        if anom1 >= 15.0 and val1 >= 1.0:
            risk_level = 'CRITICO'
        elif anom1 >= 5.0 and val1 >= 0.5:
            risk_level = 'ATENCAO'
        else:
            risk_level = 'NORMAL'

    map_candidates.sort(key=lambda p: (p['h1'], p['observed']), reverse=True)
    map_points = map_candidates[:5000]

    provenance=provenance_text(locale)
    notices = _build_notices(locale, is_future_cycle, telemetry_ref.isoformat())
    result={
        'available':processed>0,
        'reason':None if processed else localized(locale,'Histórico insuficiente na seleção.','Insufficient history in the selection.'),
        'reference_date':reference.isoformat(),
        'period_end':(reference+timedelta(days=6)).isoformat(),
        'telemetry_reference_date':telemetry_ref.isoformat(),
        'is_future_cycle':is_future_cycle,
        'forecasts':totals if processed else [],
        'recent_observed':recent_totals if processed else [],
        'map_points':map_points if processed else [],
        'observed':observed,
        'coverage':{
            'selected_count':selected,
            'processed_count':processed,
            'missing_count':missing,
            'imputed_count':0,
            'f2_count':f2_count,
            'fallback_count':fallback_count,
            'min_climatology_samples':sample_min,
            'source_reference_available':source_available(*telemetry_ref.isocalendar()[:2],available),
        },
        'method':CACHE_VERSION,
        'validation':{
            'status':'experimental_selection_not_locally_validated',
            'training_years':[2012,2023],
            'reference_years':[2024,2025],
            'legacy_metrics_inherited':False,
        },
        'provenance':provenance,
        'notices':notices,
        'unit':'harmonized_legacy_cell_month_week_activity',
        'risk_level':risk_level,
    }
    response_path.parent.mkdir(parents=True,exist_ok=True)
    import tempfile
    with tempfile.NamedTemporaryFile(mode='w',dir=response_path.parent,suffix='.tmp',delete=False) as stream:
        stream.write(json.dumps(result));temporary=Path(stream.name)
    temporary.replace(response_path)
    return result


def _build_notices(locale, is_future_cycle, telemetry_ref_str):
    items = []
    if is_future_cycle:
        items.append(localized(
            locale,
            f'Projeção para ciclo futuro (> 22/12/2025): utiliza a climatologia sazonal 2012–2023 (F₀) modulada pela telemetria física observada na mesma semana ISO do último ciclo consolidado ({telemetry_ref_str}) via regressão Ridge L₂ (F₂).',
            f'Future cycle projection (> 2025-12-22): uses 2012–2023 seasonal climatology (F₀) modulated by observed physical telemetry from the matching ISO week of the latest consolidated cycle ({telemetry_ref_str}) via Ridge L₂ regression (F₂).',
        ))
    return items


def evaluate_sample():
    """Benchmark descritivo fixo; não escolhe pesos com os erros observados."""
    ids=['pt_-12_-046','pt_-19_-057','pt_+37_-121','pt_-13_+018','pt_-26_+134','pt_+54_+101']
    references=[date(year,month,15) for year in (2024,2025) for month in (3,6,9,11)]
    references=[ref-timedelta(days=ref.weekday()) for ref in references]
    db,cursor,available=load_selection(None,tuple(ids))
    loaded=[point_series(rows) for _,rows in groupby(cursor,key=lambda row:row['point_id'])];db.close()
    rows=[]
    for ref in references:
        for h in range(1,5):
            value=baseline=actual=0.;n=0
            for series,zone in loaded:
                result=forecast_point(series,zone,ref,available)
                if result is None:continue
                horizon=result['forecasts'][h-1]
                if horizon['actual'] is None:continue
                value+=horizon['value'];baseline+=horizon['baseline'];actual+=horizon['actual'];n+=1
            if n:rows.append({'reference_date':ref.isoformat(),'horizon':h,'processed_count':n,'value':value,'baseline':baseline,'actual':actual})
    summary=[]
    for h in range(1,5):
        subset=[row for row in rows if row['horizon']==h]
        mae=sum(abs(row['value']-row['actual']) for row in subset)/len(subset) if subset else None
        mae_f0=sum(abs(row['baseline']-row['actual']) for row in subset)/len(subset) if subset else None
        summary.append({'horizon':h,'n_reference_weeks':len(subset),'mae_f2_with_f0_fallback':mae,'mae_f0':mae_f0,'skill_vs_f0_pct':100*(1-mae/mae_f0) if mae_f0 else None})
    output={'method':CACHE_VERSION,'inputs_sha256':source_signature(),'point_ids':ids,'reference_dates':[ref.isoformat() for ref in references],'sample_rule':'Six fixed coordinates across continents; four fixed reference months in 2024 and 2025. Descriptive benchmark, not global/local validation.','metrics':summary,'rows':rows}
    CACHE_DIR.mkdir(parents=True,exist_ok=True)
    (CACHE_DIR/'benchmark.json').write_text(json.dumps(output,indent=2))
    print(json.dumps({k:v for k,v in output.items() if k!='rows'},indent=2),flush=True)
    return output


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build',action='store_true');parser.add_argument('--evaluate',action='store_true')
    options=parser.parse_args()
    if options.build:build_cache()
    if options.evaluate:evaluate_sample()
