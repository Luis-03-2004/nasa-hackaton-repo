import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarChart, HistoryChart, SelectionForecast } from '../components/charts/ExplorationCharts'
import { ExplorerControls } from '../components/layout/ExplorerControls'
import { InfoToggle } from '../components/layout/InfoToggle'
import { Panel } from '../components/layout/Panel'
import { EarthGlobe, type GlobePick } from '../components/webgl/EarthGlobe'
import { FlatMap } from '../components/webgl/FlatMap'
import type { Hotspot } from '../components/webgl/HotspotMarker'
import { useI18n } from '../i18n'
import { FIRE_COLOR_GRADIENT, fireIntensityColor } from '../utils/fireColors'
import { getApi, postApi } from '../services/fireApi'
import type { Analysis, Country, ForecastSelection, MapData, MapMode, Query } from '../types/exploration'
import type { GlobeViewState } from '../utils/mapSelection'
import { loadCountries, resolveCountryShape, countryDisplayName, type CountryShape } from '../utils/countries'

const DEFAULT: Omit<Query, 'locale'> = { country: null, point_ids: [], start_date: '2000-01-01', end_date: '2025-12-31', months: [], sensors: ['modis', 'viirs-snpp', 'viirs-jpss1'], metric: 'records', resolution: 'monthly' }
const key = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '')
const aliases: Record<string, string> = { unitedstatesofamerica: 'unitedstates', russianfederation: 'russia', republicofserbia: 'serbia', democraticrepublicofthecongo: 'demrepcongo', congodemocraticrepublic: 'demrepcongo', unitedrepublicoftanzania: 'tanzania', czechrepublic: 'czechia', eswatini: 'swaziland', ivorycoast: 'cotedivoire', republicofkorea: 'southkorea', democraticpeoplesrepublicofkorea: 'northkorea' }
const countryKey = (value: string) => aliases[key(value)] ?? key(value)
function initialState(): Omit<Query, 'locale'> {
  try {
    const saved = new URLSearchParams(window.location.hash.slice(1)).get('explore') ?? new URLSearchParams(window.location.search).get('explore')
    if (!saved) return DEFAULT
    const parsed: unknown=JSON.parse(saved)
    if (!parsed || typeof parsed!=='object') return DEFAULT
    const q=parsed as Record<string,unknown>
    const validDate=(value: unknown): value is string => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    return {
      country: typeof q.country==='string' ? q.country : null,
      point_ids: Array.isArray(q.point_ids) ? [...new Set(q.point_ids.filter((id): id is string => typeof id==='string' && /^pt_[+-]\d{2}_[+-]\d{3}$/.test(id)))].slice(0,64800) : [],
      start_date: validDate(q.start_date) ? q.start_date : DEFAULT.start_date,
      end_date: validDate(q.end_date) ? q.end_date : DEFAULT.end_date,
      months: Array.isArray(q.months) ? q.months.filter((v): v is number => Number.isInteger(v) && Number(v)>=1 && Number(v)<=12) : [],
      sensors: Array.isArray(q.sensors) && q.sensors.length ? q.sensors.filter((v): v is string => typeof v==='string' && DEFAULT.sensors.includes(v)) : DEFAULT.sensors,
      metric: ['records','detections','frp'].includes(String(q.metric)) ? q.metric as Query['metric'] : DEFAULT.metric,
      resolution: ['monthly','yearly','weekly','daily'].includes(String(q.resolution)) ? q.resolution as Query['resolution'] : DEFAULT.resolution,
    }
  } catch { return DEFAULT }
}

function cellId(lat: number, lon: number) {
  const signed = (value: number, digits: number) => `${value < 0 ? '-' : '+'}${String(Math.abs(value)).padStart(digits, '0')}`
  return `pt_${signed(Math.min(89, Math.floor(lat)), 2)}_${signed(Math.min(179, Math.floor(lon)), 3)}`
}


export function Dashboard() {
  const { locale, t, number } = useI18n()
  const [filters, setFilters] = useState<Omit<Query, 'locale'>>(initialState)
  const query = useMemo<Query>(() => ({ ...filters, locale }), [filters, locale])
  const [countries, setCountries] = useState<Country[]>([])
  const [shapes, setShapes] = useState<CountryShape[]>([])
  const [mode, setMode] = useState<MapMode>('3d')
  const [year, setYear] = useState(2025)
  const [yearB, setYearB] = useState(2024)
  const [compare, setCompare] = useState(false)
  const [syncCamera, setSyncCamera] = useState(true)
  const [camera2d, setCamera2d] = useState<{ x: number; y: number; k: number } | undefined>()
  const [camera3d, setCamera3d] = useState<GlobeViewState | undefined>()
  const [selectionMode, setSelectionMode] = useState(false)
  const [subtractSelection, setSubtractSelection] = useState(false)
  const [focus, setFocus] = useState<GlobePick | null>(null)
  const [opacity, setOpacity] = useState(0.9)
  const [selectedMonth, setSelectedMonth] = useState('')
  const [mapMonth, setMapMonth] = useState(0)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [analysisError, setAnalysisError] = useState('')
  const [analysisLoading, setAnalysisLoading] = useState(true)
  const [mapA, setMapA] = useState<MapData | null>(null)
  const [mapB, setMapB] = useState<MapData | null>(null)
  const [mapError, setMapError] = useState('')
  const [mapLoading, setMapLoading] = useState(true)
  const [reference, setReference] = useState('2025-12-22')
  const [forecast, setForecast] = useState<ForecastSelection | null>(null)
  const [forecastError, setForecastError] = useState('')
  const [forecastLoading, setForecastLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [shareStatus, setShareStatus] = useState('')
  const undo = useRef<Array<Omit<Query, 'locale'>>>([])

  useEffect(() => { loadCountries().then(setShapes).catch(() => setShapes([])) }, [])
  useEffect(() => {
    const controller = new AbortController()
    getApi<{ countries: Country[] }>('/explore/countries', controller.signal).then((response) => setCountries(response.countries)).catch(() => { if (!controller.signal.aborted) setCountries([]) })
    return () => controller.abort()
  }, [attempt])

  const countryLabel = useCallback((country: Country) => {
    const shape = resolveCountryShape(country.name, shapes)
    if (shape?.iso2 && /^[A-Z]{2}$/.test(shape.iso2)) {
      try { return new Intl.DisplayNames([locale], { type: 'region' }).of(shape.iso2) ?? country.name } catch { /* Preserve source names if a code is missing. */ }
    }
    return shape ? countryDisplayName(shape, locale) : country.name.replaceAll('_', ' ')
  }, [shapes, locale])
  const selectionLabel = filters.country ? countryLabel(countries.find((c) => c.id === filters.country) ?? { id: filters.country, name: filters.country }) : t('Mundo', 'World')

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setAnalysisLoading(true); setAnalysisError('')
      postApi<Analysis>('/explore/query', query, controller.signal).then((response) => { if (!controller.signal.aborted) setAnalysis(response) }).catch((error: unknown) => { if (!controller.signal.aborted) { setAnalysis(null); setAnalysisError(error instanceof Error ? error.message : t('Falha na consulta.', 'Query failed.')) } }).finally(() => { if (!controller.signal.aborted) setAnalysisLoading(false) })
    }, 300)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [query, attempt])

  const mapQuery = useMemo(() => ({ ...query, point_ids: [], months: mapMonth ? [mapMonth] : query.months, resolution: mapMonth ? 'monthly' as const : 'yearly' as const }), [query.country, query.sensors, query.months, query.metric, mapMonth, locale])
  useEffect(() => {
    const controller = new AbortController()
    setMapLoading(true); setMapA(null); setMapB(null)
    const timer = window.setTimeout(() => {
      setMapError('')
      const make = (selectedYear: number) => ({ ...mapQuery, start_date: `${selectedYear}-${String(mapMonth || 1).padStart(2, '0')}-01`, end_date: mapMonth ? `${selectedYear}-${String(mapMonth).padStart(2, '0')}-${new Date(Date.UTC(selectedYear, mapMonth, 0)).getUTCDate()}` : `${selectedYear}-12-31` })
      Promise.all([postApi<MapData>('/explore/map', make(year), controller.signal), compare ? postApi<MapData>('/explore/map', make(yearB), controller.signal) : Promise.resolve(null)]).then(([a, b]) => { if (!controller.signal.aborted) { setMapA(a); setMapB(b) } }).catch((error: unknown) => { if (!controller.signal.aborted) { setMapA(null); setMapB(null); setMapError(error instanceof Error ? error.message : t('Falha no mapa.', 'Map failed.')) } }).finally(() => { if (!controller.signal.aborted) setMapLoading(false) })
    }, 300)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [mapQuery, year, yearB, mapMonth, compare, attempt])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setForecastLoading(true); setForecastError('')
      postApi<ForecastSelection>('/forecast/selection', { country: filters.country, point_ids: filters.point_ids, reference_date: reference, locale }, controller.signal).then((response) => { if (!controller.signal.aborted) setForecast(response) }).catch((error: unknown) => { if (!controller.signal.aborted) { setForecast(null); setForecastError(error instanceof Error ? error.message : t('Falha na previsão.', 'Forecast failed.')) } }).finally(() => { if (!controller.signal.aborted) setForecastLoading(false) })
    }, 400)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [filters.country, filters.point_ids, reference, locale, attempt])

  const max = Math.max(mapA?.domain?.[1] ?? 0, mapB?.domain?.[1] ?? 0, (mapA as (MapData & { scale_max?: number }) | null)?.scale_max ?? 0, (mapB as (MapData & { scale_max?: number }) | null)?.scale_max ?? 0, 1)
  const makeHotspots = (data: MapData | null): Hotspot[] => (data?.points ?? []).map((p) => ({ id: p.point_id, lat: p.lat_center, lon: p.lon_center, label: `${p.point_id} · ${number(p.value)}`, value: p.value, color: mode.startsWith('heat') ? fireIntensityColor(p.value, max) : '#fb923c', alertLevel: 'NORMAL' }))
  const hotspotsA = useMemo(() => makeHotspots(mapA), [mapA, mode, max, opacity, locale])
  const hotspotsB = useMemo(() => makeHotspots(mapB), [mapB, mode, max, opacity, locale])

  function changeQuery(next: Query) {
    undo.current.push(filters); if (undo.current.length > 20) undo.current.shift()
    const { locale: _locale, ...values } = next
    setAnalysisLoading(true); setFilters(values)
  }
  function changeSelection(ids: string[], operation: 'replace' | 'add' | 'toggle') {
    if (subtractSelection) { const removed=new Set(ids); changeQuery({ ...query, point_ids: filters.point_ids.filter((id) => !removed.has(id)) }); return }
    const next = new Set(operation === 'replace' ? [] : filters.point_ids)
    for (const id of ids) { if (operation === 'toggle' && next.has(id)) next.delete(id); else next.add(id) }
    changeQuery({ ...query, point_ids: [...next].sort() })
  }
  function coordinate(lat: number, lon: number) { setFocus({ lat, lon }); changeSelection([cellId(lat, lon)], 'replace') }
  function pickCountry(name: string) { const match = countries.find((c) => countryKey(c.name) === countryKey(name) || resolveCountryShape(c.name, shapes)?.name === name); if (match) changeQuery({ ...query, country: match.id, point_ids: [] }) }
  function selectMonth(value: string) { setSelectedMonth(value); setYear(Number(value.slice(0, 4))); setMapMonth(Number(value.slice(5, 7))) }
  function exportCsv() {
    if (!analysis || analysisLoading) return
    const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const metadata = JSON.stringify({ ...analysis.filters, unit: analysis.unit, method: analysis.method, coverage: analysis.coverage })
    const rows = [['record_type', 'period', 'value', 'modis', 'viirs_snpp', 'viirs_noaa20', 'context'], ['metadata', '', '', '', '', '', metadata], ...analysis.timeseries.map((row) => ['observation', row.period, row.value, row.sensors.modis, row.sensors['viirs-snpp'], row.sensors['viirs-jpss1'], ''])]
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.map(quote).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `firecal_${filters.country ?? 'world'}_${filters.resolution}.csv`; anchor.click(); URL.revokeObjectURL(url)
  }
  async function share() {
    const params = new URLSearchParams(); params.set('explore', JSON.stringify(filters))
    const url = `${window.location.origin}${window.location.pathname}#${params}`
    window.history.replaceState(null, '', url)
    try { await navigator.clipboard.writeText(url); setShareStatus(t('Link copiado.', 'Link copied.')) } catch { setShareStatus(t('Filtros salvos na URL do navegador.', 'Filters saved in the browser URL.')) }
  }
  function mapView(hotspots: Hotspot[]) {
    const common = { hotspots, countries: shapes, selectedIds: filters.point_ids, onSelectionChange: changeSelection, onCountrySelect: pickCountry, selectionMode, heatmap: mode.startsWith('heat'), pointOpacity: opacity, locale }
    return mode.endsWith('2d') || mode === '2d' ? <FlatMap {...common} selectedId={filters.point_ids[0] ?? null} onPick={(p) => coordinate(p.lat, p.lon)} onHotspotSelect={(id) => changeSelection([id], 'replace')} viewState={syncCamera ? camera2d : undefined} onViewStateChange={syncCamera ? setCamera2d : undefined} /> : <EarthGlobe {...common} globeViewState={syncCamera ? camera3d : undefined} onGlobeViewStateChange={syncCamera ? setCamera3d : undefined} focus={focus} onSelect={(p) => coordinate(p.lat, p.lon)} onHotspotSelect={(id) => changeSelection([id], 'replace')} />
  }

  return <main className="mx-auto max-w-[1800px] space-y-4 p-3 md:p-5">
    <ExplorerControls query={query} countries={countries} onChange={changeQuery} mode={mode} onMode={setMode} year={year} yearB={yearB} onYear={setYear} onYearB={setYearB} compare={compare} onCompare={setCompare} selectionMode={selectionMode} onSelectionMode={setSelectionMode} selectedCount={filters.point_ids.length} onClear={() => changeQuery({ ...query, point_ids: [] })} onUndo={() => { const previous = undo.current.pop(); if (previous) { setAnalysisLoading(true); setFilters(previous) } }} onCoordinate={coordinate} onExport={exportCsv} canExport={!!analysis && !analysisLoading} countryLabel={countryLabel} />
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400"><p>{selectionLabel} · {filters.start_date} → {filters.end_date} · {filters.sensors.length} {t('sensores', 'sensors')}</p><button type="button" onClick={() => void share()} className="control-button">{t('Compartilhar filtros', 'Share filters')}</button>{shareStatus && <span role="status">{shareStatus}</span>}<button type="button" className="control-button" onClick={() => { setMapLoading(true); setAnalysisLoading(true); setAttempt((v) => v + 1) }}>{t('Atualizar', 'Refresh')}</button></div>
    <Panel eyebrow={t('Exploração espacial e temporal', 'Spatial and temporal exploration')} title={`${selectionLabel} · ${t('mapa', 'map')} ${year}${compare ? ` / ${yearB}` : ''}`} info={t('Passe o mouse para destacar um país. Clique em um ponto para consultar sua célula de 1°. Shift+clique alterna pontos e Shift+arraste seleciona conjuntos; no celular use Selecionar área. Todos os IDs selecionados são processados, mesmo quando a visualização reduz detalhes. O mapa usa o ano A/B e os meses selecionados; o gráfico usa o intervalo de datas indicado no cabeçalho. Contornos territoriais são estáticos. Sem registros não comprova ausência de fogo.', 'Hover to highlight a country. Click a point to query its 1° cell. Shift+click toggles points and Shift+drag selects a group; on touch use Select area. All selected IDs are processed even when visual detail is reduced. The map uses year A/B and selected months; the chart uses the date range in the header. Territorial boundaries are static. No registered detections do not prove absence of fire.')}>
      <div className="flex flex-wrap items-center gap-3 px-4 pb-2 text-xs text-slate-300"><label className="flex items-center gap-2">{t('Mês do mapa', 'Map month')}<select aria-label={t('Mês do mapa', 'Map month')} value={mapMonth} onChange={(e) => setMapMonth(Number(e.target.value))} className="rounded border border-white/15 bg-[#070b12] px-2 py-1"><option value={0}>{t('Ano completo', 'Whole year')}</option>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2025, i, 1)))}</option>)}</select></label>{compare && <label className="flex items-center gap-2"><input type="checkbox" checked={syncCamera} onChange={(e) => setSyncCamera(e.target.checked)} />{t('Sincronizar câmeras', 'Sync cameras')}</label>}<label className="flex items-center gap-2"><input type="checkbox" checked={subtractSelection} onChange={(e) => setSubtractSelection(e.target.checked)} />{t('Subtrair da seleção', 'Subtract from selection')}</label><span>{t('Escala comum', 'Shared scale')}: 0 → {number(max)} · {mapA?.unit ?? ''}</span>{mode.startsWith('heat') && <><span role="img" aria-label={t('Branco → amarelo → laranja → vermelho', 'White → yellow → orange → red')} className="h-2 w-24 rounded" style={{ backgroundImage: FIRE_COLOR_GRADIENT }} /><label className="flex items-center gap-2">{t('Opacidade', 'Opacity')}<input aria-label={t('Opacidade', 'Opacity')} type="range" min="0.2" max="1" step="0.1" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} /></label></>}</div>
      {mapError && <p role="alert" className="px-4 py-3 text-sm text-amber-200">{mapError}</p>}
      {mapLoading && <p role="status" className="px-4 pb-2 text-xs text-purple-200">{t('Carregando o período histórico…', 'Loading the historical period…')}</p>}
      <div className={`grid gap-px bg-slate-700 ${compare ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>{(['A', ...(compare ? ['B'] : [])] as Array<'A' | 'B'>).map((side) => <div key={side} className="relative h-[52vh] min-h-[350px] bg-[#070b12]"><p className="pointer-events-none absolute top-3 left-3 z-10 rounded-lg bg-[#070b12]/90 px-3 py-2 font-mono text-xs">{side}: {side === 'A' ? year : yearB} · {number((side === 'A' ? mapA : mapB)?.points.length ?? 0)} {t('células', 'cells')}</p><div className={`h-full ${mapLoading ? 'opacity-40' : ''}`}>{mapView(side === 'A' ? hotspotsA : hotspotsB)}</div></div>)}</div>
      {(mapA?.coverage.partial || mapB?.coverage.partial) && <p className="px-4 py-2 text-xs text-amber-200">{t('Período com disponibilidade parcial de arquivos/sensores. Confira as informações de cobertura.', 'Period with partial file/sensor availability. Check coverage information.')}</p>}
    </Panel>
    {analysisLoading && <p role="status" className="px-2 text-sm text-purple-200">{t('Calculando todos os elementos do recorte…', 'Calculating all elements in the selection…')}</p>}
    {analysisError && <p role="alert" className="rounded-xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm text-amber-100">{analysisError}</p>}
    {analysis && !analysisLoading && <>
      <Panel eyebrow={t('Resumo do recorte completo', 'Full selection summary')} title={`${selectionLabel}${filters.point_ids.length ? ` · ${number(filters.point_ids.length)} ${t('pontos', 'points')}` : ''}`} info={<div className="space-y-2">{analysis.notices.map((notice) => <p key={notice}>{notice}</p>)}<p>{t('Os totais incluem todos os elementos selecionados. Uma célula de 1° pode conter dados de mais de um país. Valores de sensores distintos não são incêndios independentes.', 'Totals include every selected element. A 1° cell can contain records from more than one country. Values from different sensors are not independent fires.')}</p></div>}>
        <dl className="grid grid-cols-2 gap-3 px-4 pb-4 md:grid-cols-4"><div><dt className="text-xs text-slate-400">{t('Valor do recorte', 'Selection value')}</dt><dd className="mt-1 font-mono text-xl">{analysis.totals.value == null ? '—' : number(analysis.totals.value)}</dd><p className="mt-1 text-[10px] text-slate-400">{analysis.unit}</p></div><div><dt className="text-xs text-slate-400">{t('Células analisadas', 'Analyzed cells')}</dt><dd className="mt-1 font-mono text-xl">{number(analysis.processed_count)}</dd></div><div><dt className="text-xs text-slate-400">{t('Sem registros no recorte', 'No records in selection')}</dt><dd className="mt-1 font-mono text-xl">{number(analysis.missing_count)}</dd></div><div><dt className="text-xs text-slate-400">{t('Períodos retornados', 'Returned periods')}</dt><dd className="mt-1 font-mono text-xl">{number(analysis.timeseries.length)}</dd></div></dl>
        {analysis.coverage.partial && <p className="px-4 pb-3 text-xs text-amber-200">{t('Disponibilidade parcial. Zero registrado e ausência de dados têm interpretações diferentes.', 'Partial availability. Recorded zero and missing data have different meanings.')}</p>}
      </Panel>
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2"><CalendarChart data={analysis} selectedMonth={selectedMonth} onMonth={selectMonth} /><div className="min-w-0 space-y-4"><HistoryChart data={analysis} selectedMonth={selectedMonth} onMonth={selectMonth} /><SelectionForecast data={forecast} loading={forecastLoading} error={forecastError} reference={reference} onReference={setReference} /></div></div>
    </>}
    {(!analysis || analysisLoading) && <SelectionForecast data={forecast} loading={forecastLoading} error={forecastError} reference={reference} onReference={setReference} />}
    <footer className="rounded-xl border border-white/10 p-3 text-[11px] text-slate-400"><div className="flex flex-wrap items-center justify-between gap-2"><p>NASA FIRMS / EOSDIS · MODIS C6.1 · VIIRS 375 m</p><InfoToggle label={t('Informações: fontes e limitações', 'Information: sources and limitations')}>{t('0 significa sem detecção registrada nos arquivos disponíveis; não comprova ausência de fogo ou céu limpo. Um registro não é um incêndio único. F₂ é uma projeção estatística experimental da equipe, não uma previsão oficial da NASA. Métricas, disponibilidade e métodos são identificados em cada painel.', '0 means no registered detection in the available files; it does not prove absence of fire or clear skies. One record is not one unique fire. F₂ is the team’s experimental statistical projection, not an official NASA forecast. Metrics, availability and methods are identified in each panel.')}</InfoToggle></div></footer>
  </main>
}
