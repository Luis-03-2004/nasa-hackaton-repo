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


def build_cache():
    """Materializa os 36 arquivos de 2012–2025; escrita atômica e lock local."""
    if cache_ready():
        if os.getenv('FIRE_REQUIRE_PREPARED_CACHE') != '1':
            with sqlite3.connect(cache_path(), timeout=60) as db:
                _ensure_inventory(db)
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
    if reference<date(2024,1,1) or reference>date(2025,12,22) or reference.isocalendar().week==53:
        return {'available':False,'reason':localized(locale,'Use uma semana entre 01/01/2024 e 22/12/2025. O treinamento usa 2012–2023; este arquivo não fornece entradas atuais.','Choose a week from 2024-01-01 to 2025-12-22. Training uses 2012–2023; this archive does not provide current inputs.'),'reference_date':reference.isoformat(),'period_end':(reference+timedelta(days=6)).isoformat(),'forecasts':[],'coverage':empty,'method':CACHE_VERSION}
    return _cached_forecast(country,ids,reference.isoformat(),locale,source_signature())


@lru_cache(maxsize=96)
def _cached_forecast(country,ids,reference_text,locale,signature):
    response_key=hashlib.sha256(json.dumps([country,ids,reference_text,locale,signature]).encode()).hexdigest()
    response_path=CACHE_DIR/'responses'/(response_key+'.json')
    if response_path.is_file():
        try:return json.loads(response_path.read_text())
        except (OSError,ValueError):pass
    alternate_key=hashlib.sha256(json.dumps([country,ids,reference_text,'en' if locale=='pt-BR' else 'pt-BR',signature]).encode()).hexdigest()
    alternate_path=response_path.parent/(alternate_key+'.json')
    if alternate_path.is_file():
        try:
            result=json.loads(alternate_path.read_text())
            result['provenance']=provenance_text(locale)
            if result['reason']:
                result['reason']=localized(locale,'Histórico insuficiente na seleção.','Insufficient history in the selection.')
            return result
        except (OSError,ValueError):pass
    reference=date.fromisoformat(reference_text)
    db,cursor,available=load_selection(country,ids,reference)
    totals=[{'horizon':h,'target_date':(reference+timedelta(days=7*h)).isoformat(),'value':0.,'baseline':0.} for h in range(1,5)]
    observed={'value':0.,'frp_sum_mw':0.,'merged_count':0.,'night_count':0.}
    known=processed=f2_count=fallback_count=missing=0;sample_min=None
    try:
        for _,rows in groupby(cursor,key=lambda row:row['point_id']):
            series,zone=point_series(rows);known+=1
            prediction=forecast_point(series,zone,reference,available)
            if prediction is None:
                missing+=1;continue
            processed+=1
            sample_min=prediction['sample_count'] if sample_min is None else min(sample_min,prediction['sample_count'])
            if prediction['use_f2']:f2_count+=1
            else:fallback_count+=1
            current=prediction['current']
            if current:
                observed['value']+=current['h_cells']
                for target,source in [('frp_sum_mw','frp_sum'),('merged_count','merged_count'),('night_count','night_count')]:observed[target]+=current[source]
            for result,total in zip(prediction['forecasts'],totals,strict=True):
                total['value']+=result['value'];total['baseline']+=result['baseline']
    finally:db.close()
    selected=len(ids) if ids else known;missing+=max(0,selected-known)
    for total in totals:
        total['anomaly_pct']=round((total['value']-total['baseline'])/total['baseline']*100,4) if total['baseline']>0 else None
        total['value']=round(total['value'],4);total['baseline']=round(total['baseline'],4)
    observed={key:round(value,4) for key,value in observed.items()}
    observed['night_ratio']=round(observed['night_count']/observed['merged_count'],4) if observed['merged_count']>0 else None
    provenance=provenance_text(locale)
    result={'available':processed>0,'reason':None if processed else localized(locale,'Histórico insuficiente na seleção.','Insufficient history in the selection.'),'reference_date':reference.isoformat(),'period_end':(reference+timedelta(days=6)).isoformat(),'forecasts':totals if processed else [],'observed':observed,'coverage':{'selected_count':selected,'processed_count':processed,'missing_count':missing,'imputed_count':0,'f2_count':f2_count,'fallback_count':fallback_count,'min_climatology_samples':sample_min,'source_reference_available':source_available(*reference.isocalendar()[:2],available)},'method':CACHE_VERSION,'validation':{'status':'experimental_selection_not_locally_validated','training_years':[2012,2023],'reference_years':[2024,2025],'legacy_metrics_inherited':False},'provenance':provenance,'unit':'harmonized_legacy_cell_month_week_activity','risk_level':None}
    response_path.parent.mkdir(parents=True,exist_ok=True)
    import tempfile
    with tempfile.NamedTemporaryFile(mode='w',dir=response_path.parent,suffix='.tmp',delete=False) as stream:
        stream.write(json.dumps(result));temporary=Path(stream.name)
    temporary.replace(response_path)
    return result


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
