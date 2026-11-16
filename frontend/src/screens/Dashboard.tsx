import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, TrendingUp, X } from 'lucide-react'
import { CalendarChart, HistoryChart, SelectionForecast } from '../components/charts/ExplorationCharts'
import { ChatAssistant } from '../components/layout/ChatAssistant'
import { ExplorerControls } from '../components/layout/ExplorerControls'
import { InfoToggle, MetricInfo } from '../components/layout/InfoToggle'
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

const DEFAULT: Omit<Query, 'locale'> = {
  country: null,
  point_ids: [],
  start_date: '2000-01-01',
  end_date: '2025-12-31',
  months: [],
  sensors: ['modis', 'viirs-snpp', 'viirs-jpss1'],
  metric: 'records',
  resolution: 'monthly',
}
const key = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '')
const aliases: Record<string, string> = { unitedstatesofamerica: 'unitedstates', russianfederation: 'russia', republicofserbia: 'serbia', democraticrepublicofthecongo: 'demrepcongo', congodemocraticrepublic: 'demrepcongo', unitedrepublicoftanzania: 'tanzania', czechrepublic: 'czechia', eswatini: 'swaziland', ivorycoast: 'cotedivoire', republicofkorea: 'southkorea', democraticpeoplesrepublicofkorea: 'northkorea' }
const countryKey = (value: string) => aliases[key(value)] ?? key(value)

function initialState(): Omit<Query, 'locale'> {
  try {
    const saved = new URLSearchParams(window.location.hash.slice(1)).get('explore') ?? new URLSearchParams(window.location.search).get('explore')
    if (!saved) return DEFAULT
    const parsed: unknown = JSON.parse(saved)
    if (!parsed || typeof parsed !== 'object') return DEFAULT
    const q = parsed as Record<string, unknown>
    const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    return {
      country: typeof q.country === 'string' ? q.country : null,
      point_ids: Array.isArray(q.point_ids) ? [...new Set(q.point_ids.filter((id): id is string => typeof id === 'string' && /^pt_[+-]\d{2}_[+-]\d{3}$/.test(id)))].slice(0, 64800) : [],
      start_date: validDate(q.start_date) ? q.start_date : DEFAULT.start_date,
      end_date: validDate(q.end_date) ? q.end_date : DEFAULT.end_date,
      months: Array.isArray(q.months) ? q.months.filter((v): v is number => Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 12) : [],
      sensors: Array.isArray(q.sensors) && q.sensors.length ? q.sensors.filter((v): v is string => typeof v === 'string' && DEFAULT.sensors.includes(v)) : DEFAULT.sensors,
      metric: ['records', 'detections', 'frp'].includes(String(q.metric)) ? q.metric as Query['metric'] : DEFAULT.metric,
      resolution: ['monthly', 'yearly', 'weekly', 'daily'].includes(String(q.resolution)) ? q.resolution as Query['resolution'] : DEFAULT.resolution,
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
  const [gpsPoint, setGpsPoint] = useState<GlobePick | null>(null)
  const [opacity, setOpacity] = useState(0.9)
  const [mapLimit, setMapLimit] = useState(5000)
  const [selectedMonth, setSelectedMonth] = useState('')
  const [mapMonth, setMapMonth] = useState(0)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [analysisError, setAnalysisError] = useState('')
  const [analysisLoading, setAnalysisLoading] = useState(true)
  const [pendingExport, setPendingExport] = useState(false)
  const [mapA, setMapA] = useState<MapData | null>(null)
  const [mapB, setMapB] = useState<MapData | null>(null)
  const [mapError, setMapError] = useState('')
  const [mapLoading, setMapLoading] = useState(true)
  const [reference, setReference] = useState('2025-12-22')
  const [forecast, setForecast] = useState<ForecastSelection | null>(null)
  const [forecastError, setForecastError] = useState('')
  const [forecastLoading, setForecastLoading] = useState(true)
  const [forecastMapHorizon, setForecastMapHorizon] = useState<number | null>(null)
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
    }, 220)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [query, attempt])

  // Requirement 9: Map uses the active filters (date range, country, months, sensors, metric, resolution)
  const mapResolution = useMemo<Query['resolution']>(() => {
    if (mapMonth) return 'monthly'
    if (query.resolution === 'daily') {
      return query.country && query.start_date.slice(0, 4) === query.end_date.slice(0, 4) ? 'daily' : 'monthly'
    }
    if (query.resolution === 'weekly') {
      return Number(query.end_date.slice(0, 4)) - Number(query.start_date.slice(0, 4)) <= 1 ? 'weekly' : 'monthly'
    }
    return query.resolution
  }, [query.resolution, query.country, query.start_date, query.end_date, mapMonth])

  const mapQuery = useMemo(
    () => ({
      ...query,
      point_ids: [],
      months: mapMonth ? [mapMonth] : query.months,
      resolution: mapResolution,
    }),
    [query.country, query.start_date, query.end_date, query.sensors, query.months, query.metric, mapResolution, mapMonth, locale],
  )

  useEffect(() => {
    const controller = new AbortController()
    setMapLoading(true)
    const timer = window.setTimeout(() => {
      setMapError('')
      const makeYearRange = (selectedYear: number) => ({
        ...mapQuery,
        resolution: mapMonth ? ('monthly' as const) : ('yearly' as const),
        start_date: `${selectedYear}-${String(mapMonth || 1).padStart(2, '0')}-01`,
        end_date: mapMonth ? `${selectedYear}-${String(mapMonth).padStart(2, '0')}-${new Date(Date.UTC(selectedYear, mapMonth, 0)).getUTCDate()}` : `${selectedYear}-12-31`,
      })
      const primaryPayload = compare || mapMonth
        ? makeYearRange(year)
        : mapQuery
      Promise.all([
        postApi<MapData>('/explore/map', primaryPayload, controller.signal),
        compare ? postApi<MapData>('/explore/map', makeYearRange(yearB), controller.signal) : Promise.resolve(null),
      ])
        .then(([a, b]) => { if (!controller.signal.aborted) { setMapA(a); setMapB(b) } })
        .catch((error: unknown) => { if (!controller.signal.aborted) { setMapA(null); setMapB(null); setMapError(error instanceof Error ? error.message : t('Falha no mapa.', 'Map failed.')) } })
        .finally(() => { if (!controller.signal.aborted) setMapLoading(false) })
    }, 220)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [mapQuery, year, yearB, mapMonth, compare, attempt])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setForecastLoading(true); setForecastError('')
      postApi<ForecastSelection>('/forecast/selection', { country: filters.country, point_ids: filters.point_ids, reference_date: reference, locale }, controller.signal).then((response) => { if (!controller.signal.aborted) setForecast(response) }).catch((error: unknown) => { if (!controller.signal.aborted) { setForecast(null); setForecastError(error instanceof Error ? error.message : t('Falha na previsão.', 'Forecast failed.')) } }).finally(() => { if (!controller.signal.aborted) setForecastLoading(false) })
    }, 350)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [filters.country, filters.point_ids, reference, locale, attempt])

  const max = Math.max(mapA?.domain?.[1] ?? 0, mapB?.domain?.[1] ?? 0, (mapA as (MapData & { scale_max?: number }) | null)?.scale_max ?? 0, (mapB as (MapData & { scale_max?: number }) | null)?.scale_max ?? 0, 1)
  const makeHotspots = useCallback((data: MapData | null): Hotspot[] => {
    const raw = data?.points ?? []
    let filtered = raw
    if (mapLimit > 0 && raw.length > mapLimit) {
      const selectedSet = new Set(filters.point_ids)
      const selectedPts = raw.filter((p) => selectedSet.has(p.point_id))
      const remainingPts = raw.filter((p) => !selectedSet.has(p.point_id)).sort((a, b) => b.value - a.value).slice(0, Math.max(0, mapLimit - selectedPts.length))
      filtered = [...selectedPts, ...remainingPts]
    }
    return filtered.map((p) => ({
      id: p.point_id,
      lat: p.lat_center,
      lon: p.lon_center,
      label: `${p.point_id} · ${number(p.value)}`,
      value: p.value,
      country: p.country,
      color: mode.startsWith('heat') ? fireIntensityColor(p.value, max) : '#fb923c',
      alertLevel: 'NORMAL',
    }))
  }, [mapLimit, filters.point_ids, mode, max, number])

  const hotspotsA = useMemo(() => makeHotspots(mapA), [mapA, makeHotspots, opacity, locale])
  const hotspotsB = useMemo(() => makeHotspots(mapB), [mapB, makeHotspots, opacity, locale])

  const forecastHotspots = useMemo<Hotspot[] | null>(() => {
    if (!forecastMapHorizon || !forecast?.available || !forecast.map_points?.length) return null
    const hKey = (`h${forecastMapHorizon}` as 'h1' | 'h2' | 'h3' | 'h4')
    const pts = forecast.map_points
    const maxForecastVal = Math.max(1, ...pts.map((p) => p[hKey] ?? 0))
    return pts.map((p) => {
      const val = p[hKey] ?? 0
      return {
        id: p.point_id,
        lat: p.lat_center,
        lon: p.lon_center,
        label: `${p.point_id} · F₂ t+${forecastMapHorizon}: ${number(val)} (${p.mode})`,
        value: val,
        country: p.country,
        color: fireIntensityColor(val, maxForecastVal),
        alertLevel: p.anomaly_pct_h1 > 25 ? 'CRITICAL' : p.anomaly_pct_h1 > 5 ? 'WATCH' : 'NORMAL',
      }
    })
  }, [forecastMapHorizon, forecast, number])

  function changeQuery(next: Query) {
    undo.current.push(filters); if (undo.current.length > 20) undo.current.shift()
    const { locale: _locale, ...values } = next
    setAnalysisLoading(true); setFilters(values)
  }
  function changeSelection(ids: string[], operation: 'replace' | 'add' | 'toggle') {
    if (subtractSelection) { const removed = new Set(ids); changeQuery({ ...query, point_ids: filters.point_ids.filter((id) => !removed.has(id)) }); return }
    const next = new Set(operation === 'replace' ? [] : filters.point_ids)
    for (const id of ids) { if (operation === 'toggle' && next.has(id)) next.delete(id); else next.add(id) }
    changeQuery({ ...query, point_ids: [...next].sort() })
  }
  function coordinate(lat: number, lon: number, isGps = false) {
    const pick: GlobePick = { lat, lon, seq: Date.now() }
    setFocus(pick)
    if (isGps) setGpsPoint(pick)
    changeSelection([cellId(lat, lon)], 'replace')
  }
  function pickCountry(name: string) {
    const match = countries.find((c) => c.id === name || countryKey(c.name) === countryKey(name) || resolveCountryShape(c.name, shapes)?.name === name)
    if (match) changeQuery({ ...query, country: match.id, point_ids: [] })
  }
  function resetWorld() {
    setFocus(null)
    if (filters.country || filters.point_ids.length) {
      changeQuery({ ...query, country: null, point_ids: [] })
    }
  }
  function handleYearChange(nextYear: number) {
    setYear(nextYear)
    if (!compare) {
      changeQuery({ ...query, start_date: `${nextYear}-01-01`, end_date: `${nextYear}-12-31` })
    }
  }
  function selectMonth(value: string) {
    setSelectedMonth(value)
    const y = Number(value.slice(0, 4))
    const m = Number(value.slice(5, 7))
    setYear(y)
    setMapMonth(m)
  }

  const performExportCsv = useCallback((data: Analysis) => {
    const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const metadata = JSON.stringify({ ...data.filters, unit: data.unit, method: data.method, coverage: data.coverage })
    const rows = [['record_type', 'period', 'value', 'modis', 'viirs_snpp', 'viirs_noaa20', 'context'], ['metadata', '', '', '', '', '', metadata], ...data.timeseries.map((row) => ['observation', row.period, row.value, row.sensors.modis, row.sensors['viirs-snpp'], row.sensors['viirs-jpss1'], ''])]
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.map(quote).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `bat_${filters.country ?? 'world'}_${filters.resolution}.csv`; anchor.click(); URL.revokeObjectURL(url)
  }, [filters.country, filters.resolution])

  useEffect(() => {
    if (pendingExport && analysis && !analysisLoading) {
      setPendingExport(false)
      performExportCsv(analysis)
    }
  }, [pendingExport, analysis, analysisLoading, performExportCsv])

  function exportCsv() {
    if (analysisLoading) {
      setPendingExport((prev) => !prev)
      return
    }
    if (!analysis) return
    performExportCsv(analysis)
  }

  async function share() {
    const params = new URLSearchParams(); params.set('explore', JSON.stringify(filters))
    const url = `${window.location.origin}${window.location.pathname}#${params}`
    window.history.replaceState(null, '', url)
    try { await navigator.clipboard.writeText(url); setShareStatus(t('Link copiado.', 'Link copied.')) } catch { setShareStatus(t('Filtros salvos na URL do navegador.', 'Filters saved in the browser URL.')) }
  }

  function mapView(hotspots: Hotspot[]) {
    const useSharedCamera = compare && syncCamera
    const common = {
      hotspots,
      countries: shapes,
      selectedIds: filters.point_ids,
      focus,
      gpsPoint,
      onSelectionChange: changeSelection,
      onCountrySelect: pickCountry,
      onResetWorld: resetWorld,
      selectionMode,
      heatmap: mode.startsWith('heat'),
      pointOpacity: opacity,
      locale,
    }
    return mode.endsWith('2d') || mode === '2d'
      ? <FlatMap {...common} selectedId={filters.point_ids[0] ?? null} onPick={(p) => coordinate(p.lat, p.lon, false)} onHotspotSelect={(id) => changeSelection([id], 'replace')} viewState={useSharedCamera ? camera2d : undefined} onViewStateChange={useSharedCamera ? setCamera2d : undefined} />
      : <EarthGlobe {...common} globeViewState={useSharedCamera ? camera3d : undefined} onGlobeViewStateChange={useSharedCamera ? setCamera3d : undefined} onSelect={(p) => coordinate(p.lat, p.lon, false)} onHotspotSelect={(id) => changeSelection([id], 'replace')} />
  }

  const mapSubtitle = compare
    ? `${year} / ${yearB}`
    : mapMonth
      ? `${year}-${String(mapMonth).padStart(2, '0')}`
      : `${filters.start_date} → ${filters.end_date}`

  return <main className="mx-auto max-w-[1800px] space-y-4 p-3 md:p-5">
    <ExplorerControls
      query={query}
      countries={countries}
      onChange={(next) => { setMapMonth(0); changeQuery(next) }}
      mode={mode}
      onMode={setMode}
      year={year}
      yearB={yearB}
      onYear={handleYearChange}
      onYearB={setYearB}
      compare={compare}
      onCompare={setCompare}
      selectionMode={selectionMode}
      onSelectionMode={setSelectionMode}
      selectedCount={filters.point_ids.length}
      onClear={() => { setGpsPoint(null); setFocus(null); changeQuery({ ...query, point_ids: [] }) }}
      onUndo={() => { const previous = undo.current.pop(); if (previous) { setAnalysisLoading(true); setFilters(previous) } }}
      onCoordinate={coordinate}
      onExport={exportCsv}
      canExport={!!analysis && !analysisLoading}
      exportLoading={analysisLoading}
      pendingExport={pendingExport}
      countryLabel={countryLabel}
      gpsActive={!!gpsPoint}
    />
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
      <p>{selectionLabel} · {filters.start_date} → {filters.end_date} · {filters.sensors.length} {t('sensores', 'sensors')}</p>
      {gpsPoint && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-500/15 px-2.5 py-0.5 font-mono text-[11px] text-cyan-200">
          <MapPin size={12} aria-hidden="true" />GPS: {gpsPoint.lat.toFixed(3)}°, {gpsPoint.lon.toFixed(3)}°
        </span>
      )}
      <button type="button" onClick={() => void share()} className="control-button">{t('Compartilhar filtros', 'Share filters')}</button>
      {shareStatus && <span role="status">{shareStatus}</span>}
      <button type="button" className="control-button" onClick={() => { setMapLoading(true); setAnalysisLoading(true); setAttempt((v) => v + 1) }}>{t('Atualizar', 'Refresh')}</button>
    </div>
    <Panel
      eyebrow={t('Exploração espacial e temporal', 'Spatial and temporal exploration')}
      title={`${selectionLabel} · ${t('mapa', 'map')} (${mapSubtitle})`}
      info={t(
        'Clique em cima de um ponto para selecionar sua célula de 1°. Use Ctrl+Clique sobre um ponto para selecionar o país daquele ponto. Shift+clique alterna pontos e Shift+arraste seleciona áreas. Clicar no botão Mundo remove a seleção de país e exibe todos os países do mundo. Todos os filtros de data, país, sensores e métrica são aplicados ao mapa e ao CSV.',
        'Click on a point to select its 1° cell. Use Ctrl+Click on a point to select the country of that point. Shift+Click toggles points and Shift+Drag selects areas. Clicking the World button clears the country selection and shows all countries in the world. All date, country, sensor, and metric filters apply to both the map and CSV.',
      )}
    >
      <div className="flex flex-wrap items-center gap-3 px-4 pb-2 text-xs text-slate-300">
        <div className="flex items-center gap-1">
          <label className="flex items-center gap-2">{t('Mês do mapa', 'Map month')}
            <select aria-label={t('Mês do mapa', 'Map month')} value={mapMonth} onChange={(e) => setMapMonth(Number(e.target.value))} className="rounded border border-white/15 bg-[#070b12] px-2 py-1">
              <option value={0}>{t('Usar período filtrado', 'Use filtered date range')}</option>
              {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2025, i, 1)))}</option>)}
            </select>
          </label>
          <MetricInfo term={t('Mês do Mapa', 'Map Month')}>
            {t(
              'Permite focar o mapa em um único mês do ano selecionado (ou clicar em uma célula no Calendário abaixo) sem perder a Série Temporal completa.',
              'Focuses the map on a single month of the selected year (or when clicking a cell in the Calendar below) while keeping the full Historical Time Series intact.',
            )}
          </MetricInfo>
        </div>
        <div className="flex items-center gap-1">
          <label className="flex items-center gap-2">{t('Limite de pontos no mapa', 'Map point limit')}
            <select aria-label={t('Limite de pontos no mapa', 'Map point limit')} value={mapLimit} onChange={(e) => setMapLimit(Number(e.target.value))} className="rounded border border-white/15 bg-[#070b12] px-2 py-1 font-mono">
              <option value={2500}>{t('Top 2.500 (Rápido)', 'Top 2,500 (Fast)')}</option>
              <option value={5000}>{t('Top 5.000 (Padrão)', 'Top 5,000 (Default)')}</option>
              <option value={10000}>{t('Top 10.000', 'Top 10,000')}</option>
              <option value={0}>{t('Todos os pontos', 'All points')}</option>
            </select>
          </label>
          <MetricInfo term={t('Limite de Renderização WebGL (LOD)', 'WebGL Point Limit (LOD)')}>
            {t(
              'Prioriza na placa de vídeo as células de 1° com maior intensidade térmica para manter 60 FPS no Globo 3D / Mapa 2D. Os cálculos estatísticos e o CSV sempre processam 100% das células.',
              'Prioritizes the highest-intensity 1° cells on the GPU to maintain 60 FPS on the 3D Globe / 2D Map. All statistical calculations and CSV exports always process 100% of cells.',
            )}
          </MetricInfo>
        </div>
        {compare && <label className="flex items-center gap-2"><input type="checkbox" checked={syncCamera} onChange={(e) => setSyncCamera(e.target.checked)} />{t('Sincronizar câmeras', 'Sync cameras')}</label>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={subtractSelection} onChange={(e) => setSubtractSelection(e.target.checked)} />{t('Subtrair da seleção', 'Subtract from selection')}</label>
        <span className="inline-flex items-center">
          <span>{t('Escala comum', 'Shared scale')}: 0 → {number(max)} · {mapA?.unit ?? ''}</span>
          <MetricInfo term={t('Escala Comum do Mapa', 'Shared Map Scale')}>
            {t(
              'Indica o valor máximo do domínio de cores entre o Mapa A e o Mapa B, garantindo que a mesma cor represente a mesma magnitude física em ambos os mapas.',
              'Shows the maximum color domain value shared across Map A and Map B so the same color represents the exact same physical magnitude on both viewports.',
            )}
          </MetricInfo>
        </span>
        {mode.startsWith('heat') && <>
          <span role="img" aria-label={t('Branco → amarelo → laranja → vermelho', 'White → yellow → orange → red')} className="h-2 w-24 rounded" style={{ backgroundImage: FIRE_COLOR_GRADIENT }} />
          <label className="flex items-center gap-2">{t('Opacidade', 'Opacity')}<input aria-label={t('Opacidade', 'Opacity')} type="range" min="0.2" max="1" step="0.1" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} /></label>
        </>}
      </div>
      {forecastMapHorizon && forecast?.available && (
        <div className="mx-4 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-orange-400/50 bg-orange-500/15 px-3 py-2 text-xs text-orange-100">
          <div className="flex flex-wrap items-center gap-2 font-mono">
            <span className="inline-flex items-center gap-1.5">
              <TrendingUp size={14} aria-hidden="true" />{t('MODO PREVISÃO F₂ NO MAPA:', 'F₂ FORECAST MODE ON MAP:')} t+{forecastMapHorizon}{' '}
              ({forecast.forecasts.find((f) => f.horizon === forecastMapHorizon)?.target_date ?? reference})
            </span>
            <div className="inline-flex gap-1">
              {[1, 2, 3, 4].map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setForecastMapHorizon(h)}
                  className={`rounded border px-2 py-0.5 text-[10px] font-bold ${
                    forecastMapHorizon === h
                      ? 'border-orange-300 bg-orange-500 text-black'
                      : 'border-white/20 bg-black/40 text-orange-200 hover:border-orange-300'
                  }`}
                >
                  t+{h}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setForecastMapHorizon(null)}
            className="inline-flex items-center gap-1.5 rounded border border-white/25 bg-black/50 px-2.5 py-1 font-mono text-[11px] text-white hover:bg-black/80"
          >
            <X size={12} aria-hidden="true" />{t('Voltar às observações históricas', 'Return to historical observations')}
          </button>
        </div>
      )}
      {mapError && <p role="alert" className="px-4 py-3 text-sm text-amber-200">{mapError}</p>}
      {mapLoading && <p role="status" className="px-4 pb-2 text-xs text-purple-200">{t('Carregando o período histórico…', 'Loading the historical period…')}</p>}
      <div className={`grid gap-px bg-slate-700 ${compare ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
        {(['A', ...(compare ? ['B'] : [])] as Array<'A' | 'B'>).map((side) => {
          const sideMap = side === 'A' ? mapA : mapB
          const activeForecastPts = side === 'A' && forecastHotspots ? forecastHotspots : null
          const sideHotspots = activeForecastPts ?? (side === 'A' ? hotspotsA : hotspotsB)
          return (
            <div key={side} className="relative h-[52vh] min-h-[350px] bg-[#070b12]">
              <p className="pointer-events-none absolute top-3 left-3 z-10 rounded-lg bg-[#070b12]/90 px-3 py-2 font-mono text-xs">
                {activeForecastPts
                  ? `F₂ t+${forecastMapHorizon} (${forecast?.forecasts.find((f) => f.horizon === forecastMapHorizon)?.target_date ?? reference}) · ${number(sideHotspots.length)} ${t('células previstas', 'predicted cells')}`
                  : `${side}: ${side === 'A' ? (compare ? year : mapSubtitle) : yearB} · ${number(sideHotspots.length)} / ${number(sideMap?.points.length ?? 0)} ${t('células', 'cells')}`}
              </p>
              <div className={`h-full ${mapLoading && !activeForecastPts ? 'opacity-40' : ''}`}>{mapView(sideHotspots)}</div>
            </div>
          )
        })}
      </div>
      {(mapA?.coverage.partial || mapB?.coverage.partial) && <p className="px-4 py-2 text-xs text-amber-200">{t('Período com disponibilidade parcial de arquivos/sensores. Confira as informações de cobertura.', 'Period with partial file/sensor availability. Check coverage information.')}</p>}
    </Panel>
    {analysisLoading && <p role="status" className="px-2 text-sm text-purple-200">{t('Calculando todos os elementos do recorte…', 'Calculating all elements in the selection…')}</p>}
    {analysisError && <p role="alert" className="rounded-xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm text-amber-100">{analysisError}</p>}
    {analysis && !analysisLoading && <>
      <Panel eyebrow={t('Resumo do recorte completo', 'Full selection summary')} title={`${selectionLabel}${filters.point_ids.length ? ` · ${number(filters.point_ids.length)} ${t('pontos', 'points')}` : ''}`} info={<div className="space-y-2">{analysis.notices.map((notice) => <p key={notice}>{notice}</p>)}<p>{t('Os totais incluem todos os elementos selecionados. Uma célula de 1° pode conter dados de mais de um país. Valores de sensores distintos não são incêndios independentes.', 'Totals include every selected element. A 1° cell can contain records from more than one country. Values from different sensors are not independent fires.')}</p></div>}>
        <dl className="grid grid-cols-2 gap-3 px-4 pb-4 md:grid-cols-4 lg:grid-cols-6">
          <div>
            <dt className="flex items-center text-xs text-slate-400">
              <span>{t('Valor do recorte', 'Selection value')}</span>
              <MetricInfo term={t('Valor do Recorte (Métrica Ativa)', 'Selection Value (Active Metric)')}>
                {t(
                  'Soma total da métrica principal atualmente selecionada no filtro superior para todo o período, país/células e sensores ativos.',
                  'Total sum of the currently selected primary metric across the entire active date range, country/cells, and sensors.',
                )}
              </MetricInfo>
            </dt>
            <dd className="mt-1 font-mono text-xl">{analysis.totals.value == null ? '—' : number(analysis.totals.value)}</dd>
            <p className="mt-1 text-[10px] text-slate-400">{analysis.unit}</p>
          </div>
          <div>
            <dt className="flex items-center text-xs text-slate-400">
              <span>{t('Detecções agrupadas', 'Merged detections')}</span>
              <MetricInfo term={t('Total de Detecções Sub-pixel', 'Total Sub-pixel Detections')}>
                {t(
                  'Quantidade total de passagens orbitais de fogo ativo (375 m no VIIRS e 1 km no MODIS) registradas dentro das células de 1 km deste recorte.',
                  'Total count of active-fire orbital satellite passes (375 m VIIRS / 1 km MODIS) merged inside the 1 km cells of this selection.',
                )}
              </MetricInfo>
            </dt>
            <dd className="mt-1 font-mono text-xl">{number(analysis.totals.detections)}</dd>
          </div>
          <div>
            <dt className="flex items-center text-xs text-slate-400">
              <span>{t('Soma de FRP (MW)', 'FRP Sum (MW)')}</span>
              <MetricInfo term={t('Soma de Potência Radiativa do Fogo (MW)', 'Total Fire Radiative Power (MW)')}>
                {t(
                  'Soma acumulada de FRP (em Megawatts) medida pelos radiômetros orbitais no recorte. Indica a magnitude da energia radiante liberada pela combustão.',
                  'Cumulative Fire Radiative Power (in Megawatts) measured by orbital radiometers in this selection. Reflects total radiant heat intensity.',
                )}
              </MetricInfo>
            </dt>
            <dd className="mt-1 font-mono text-xl">{number(analysis.totals.frp)}</dd>
          </div>
          <div>
            <dt className="flex items-center text-xs text-slate-400">
              <span>{t('Células analisadas', 'Analyzed cells')}</span>
              <MetricInfo term={t('Células de 1° com Fogo Registrado', '1° Cells with Recorded Fire')}>
                {t(
                  'Quantidade de células terrestres de 1°×1° do recorte que apresentaram pelo menos um registro de anomalia térmica no período filtrado.',
                  'Count of 1°×1° land cells in the selection that recorded at least one thermal anomaly during the filtered period.',
                )}
              </MetricInfo>
            </dt>
            <dd className="mt-1 font-mono text-xl">{number(analysis.processed_count)}</dd>
          </div>
          <div>
            <dt className="flex items-center text-xs text-slate-400">
              <span>{t('Sem registros no recorte', 'No records in selection')}</span>
              <MetricInfo term={t('Células de 1° sem Registros no Período', '1° Cells with Zero Records')}>
                {t(
                  'Células terrestres de 1°×1° pertencentes ao país ou seleção que tiveram zero detecções no período filtrado.',
                  '1°×1° land cells belonging to the country or selection that had zero recorded detections during the filtered period.',
                )}
              </MetricInfo>
            </dt>
            <dd className="mt-1 font-mono text-xl">{number(analysis.missing_count)}</dd>
          </div>
          <div>
            <dt className="flex items-center text-xs text-slate-400">
              <span>{t('Períodos retornados', 'Returned periods')}</span>
              <MetricInfo align="right" term={t('Passos Temporais na Série', 'Returned Time Steps')}>
                {t(
                  'Quantidade de pontos no tempo (anos, meses, semanas ou dias, conforme o agrupamento escolhido) retornados para construir o gráfico da Série Temporal.',
                  'Number of time steps (years, months, weeks, or days, depending on chosen aggregation) returned to plot the Historical Time Series.',
                )}
              </MetricInfo>
            </dt>
            <dd className="mt-1 font-mono text-xl">{number(analysis.timeseries.length)}</dd>
          </div>
        </dl>
        {analysis.coverage.partial && <p className="px-4 pb-3 text-xs text-amber-200">{t('Disponibilidade parcial. Zero registrado e ausência de dados têm interpretações diferentes.', 'Partial availability. Recorded zero and missing data have different meanings.')}</p>}
      </Panel>
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
        <CalendarChart
          data={analysis}
          selectedMonth={selectedMonth}
          onMonth={selectMonth}
          onSelectYear={(nextYear) => {
            setYear(nextYear)
            setMapMonth(0)
            setSelectedMonth('')
            changeQuery({ ...query, start_date: `${nextYear}-01-01`, end_date: `${nextYear}-12-31`, resolution: 'monthly' })
          }}
          onSelectDayRange={(dateStr) => {
            if (dateStr >= '2024-01-01') setReference(dateStr)
          }}
        />
        <div className="min-w-0 space-y-4">
          <HistoryChart data={analysis} selectedMonth={selectedMonth} onMonth={selectMonth} />
          <SelectionForecast
            data={forecast}
            loading={forecastLoading}
            error={forecastError}
            reference={reference}
            onReference={setReference}
            filterEndDate={filters.end_date}
            forecastMapHorizon={forecastMapHorizon}
            onForecastMapHorizonChange={setForecastMapHorizon}
          />
        </div>
      </div>
    </>}
    {(!analysis || analysisLoading) && (
      <SelectionForecast
        data={forecast}
        loading={forecastLoading}
        error={forecastError}
        reference={reference}
        onReference={setReference}
        filterEndDate={filters.end_date}
        forecastMapHorizon={forecastMapHorizon}
        onForecastMapHorizonChange={setForecastMapHorizon}
      />
    )}
    <footer className="rounded-xl border border-white/10 p-3 text-[11px] text-slate-400"><div className="flex flex-wrap items-center justify-between gap-2"><p>BAT (Brightness Anomaly Tracker) · NASA FIRMS / EOSDIS · MODIS C6.1 · VIIRS 375 m</p><InfoToggle label={t('Informações: fontes e limitações', 'Information: sources and limitations')}>{t('0 significa sem detecção registrada nos arquivos disponíveis; não comprova ausência de fogo ou céu limpo. Um registro não é um incêndio único. F₂ é uma projeção estatística experimental da equipe, não uma previsão oficial da NASA. Métricas, disponibilidade e métodos são identificados em cada painel.', '0 means no registered detection in the available files; it does not prove absence of fire or clear skies. One record is not one unique fire. F₂ is the team’s experimental statistical projection, not an official NASA forecast. Metrics, availability and methods are identified in each panel.')}</InfoToggle></div></footer>
    <ChatAssistant query={query} referenceDate={reference} focus={focus} onCoordinate={coordinate} />
  </main>
}
