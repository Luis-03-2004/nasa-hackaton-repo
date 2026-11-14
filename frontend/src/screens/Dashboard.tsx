import { useEffect, useMemo, useState } from 'react'
import { ForecastChart } from '../components/charts/ForecastChart'
import { Heatmap } from '../components/charts/Heatmap'
import { SeriesChart } from '../components/charts/SeriesChart'
import { ObservationQuery } from '../components/data/ObservationQuery'
import { Header, type MapView, type SeriesMetric } from '../components/layout/Header'
import { Panel } from '../components/layout/Panel'
import { EarthGlobe, type GlobePick } from '../components/webgl/EarthGlobe'
import { FlatMap } from '../components/webgl/FlatMap'
import { useFireData } from '../hooks/useFireData'
import { useGlobeHotspots } from '../hooks/useGlobeHotspots'
import { fetchLocationForecast, fetchSensorSeries } from '../services/fireApi'
import type { FireDataResponse, HarmonizedDataPoint } from '../types/api'
import { loadCountries, type CountryShape } from '../utils/countries'
import { downloadSeriesCsv } from '../utils/csv'

function ChartStatus({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-[#9bb0d1]">
    <p role="status">{message}</p>{onRetry && <button type="button" onClick={onRetry} className="rounded-full border border-white/20 px-3 py-1 text-white">Tentar novamente</button>}
  </div>
}

export function Dashboard() {
  const { catalog, status, error, reload } = useFireData()
  const { hotspots, error: pointsError, reload: reloadPoints } = useGlobeHotspots()
  const [regionId, setRegionId] = useState('global')
  const [view, setView] = useState<MapView>('3d')
  const [month, setMonth] = useState('2025-09')
  const [metric, setMetric] = useState<SeriesMetric>('harmonized')
  const [countries, setCountries] = useState<CountryShape[]>([])
  const [pick, setPick] = useState<GlobePick>({ lat: -12, lon: -52 })
  const [location, setLocation] = useState<FireDataResponse | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [locationLoading, setLocationLoading] = useState(true)
  const [locationAttempt, setLocationAttempt] = useState(0)
  const [sensorSeries, setSensorSeries] = useState<HarmonizedDataPoint[] | null>(null)
  const [sensorError, setSensorError] = useState('')
  const [sensorSource, setSensorSource] = useState('')
  const sensorYear = Number(month.slice(0, 4)) || 2025
  const region = catalog?.regions.find((item) => item.id === regionId) ?? null
  const series = region?.historical_series ?? []
  const forecast = location?.forecast

  useEffect(() => { loadCountries().then(setCountries).catch(() => setCountries([])) }, [])
  useEffect(() => {
    const controller = new AbortController()
    fetchLocationForecast(pick.lat, pick.lon, controller.signal).then((data) => {
      setLocation(data); setLocationError(null); setLocationLoading(false)
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) { setLocation(null); setLocationLoading(false); setLocationError(reason instanceof Error ? reason.message : 'Erro ao carregar previsão') }
    })
    return () => controller.abort()
  }, [pick, locationAttempt])

  useEffect(() => {
    if (metric !== 'sensors' || !region || !['global', 'brazil'].includes(regionId)) return
    const controller = new AbortController()
    fetchSensorSeries(regionId, sensorYear, controller.signal).then((data) => {
      setSensorSeries(region.historical_series.filter((row) => row.iso_year === sensorYear).map((row) => ({ ...row, ...data.series.find((s) => s.month === row.month) })))
      setSensorSource(data.provenance)
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setSensorError(reason instanceof Error ? reason.message : 'Erro ao carregar sensores') })
    return () => controller.abort()
  }, [metric, region, regionId, sensorYear])

  const currentPointId = location?.nearest_point?.point_id ?? null
  const currentHotspot = useMemo(() => hotspots.find((row) => row.id === currentPointId), [hotspots, currentPointId])
  function selectPlace(next: GlobePick) { setLocation(null); setLocationLoading(true); setLocationError(null); setPick(next) }
  function selectHotspot(id: string) {
    const next = hotspots.find((row) => row.id === id)
    if (next) selectPlace({ lat: next.lat, lon: next.lon })
  }
  function changeRegion(id: string) { setRegionId(id); setSensorSeries(null); setSensorError(''); setMetric('harmonized') }
  function changeMonth(value: string) { setMonth(value.slice(0, 7)); setSensorSeries(null); setSensorError('') }
  function changeMetric(value: SeriesMetric) { setMetric(value); setSensorSeries(null); setSensorError('') }

  return <main className="mx-auto max-w-[1800px] p-3 md:p-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0F1623] px-4 py-3 text-xs">
      <p><span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-400" />Dados locais · MODIS C6.1 / VIIRS 375 m · <span className="font-mono">2000–2025</span></p>
      <p className="text-[#9bb0d1]">Histórico mensal · F₂ experimental: referência em 2025 · {hotspots.length.toLocaleString('pt-BR')} pontos</p>
    </div>
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(380px,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <section className="relative h-[54vh] min-h-[380px] overflow-hidden rounded-2xl border border-white/10 bg-[#04122b]" aria-label="Mapa mundial F2">
          {view === '2d' ? <FlatMap hotspots={hotspots} countries={countries} selectedId={currentPointId} onPick={selectPlace} onHotspotSelect={selectHotspot} /> : <EarthGlobe hotspots={hotspots} focus={pick} onSelect={selectPlace} onHotspotSelect={selectHotspot} />}
          <div className="pointer-events-none absolute top-3 left-3 max-w-[85%] rounded-xl bg-[#070B12]/90 px-3 py-2 text-xs">
            <p className="font-semibold">Catálogo global F₂ · grade de 1°</p><p className="mt-1 text-[#9bb0d1]">Clique para consultar o ponto mais próximo. Referências variam por ponto em 2025.</p>
          </div>
          <div className="pointer-events-none absolute right-3 bottom-3 rounded-lg bg-[#070B12]/90 p-2 text-[10px] text-[#9bb0d1]">Risco projetado no snapshot: <span className="text-emerald-400">normal</span> · <span className="text-amber-400">atenção</span> · <span className="text-red-400">crítico</span></div>
        </section>
        {pointsError && <p role="alert" className="text-sm text-amber-300">Catálogo de pontos: {pointsError} <button className="underline" type="button" onClick={reloadPoints}>Tentar novamente</button></p>}
        <Panel eyebrow="Observações reais por área" title={`Células de 1 km · ${month || 'selecione um mês'}`} className="min-h-[180px]">
          <ObservationQuery pick={pick} month={month} />
        </Panel>
      <div id="calendar" className="min-w-0 scroll-mt-4"><Panel eyebrow="Calendário de atividade observada" title={`${region?.region_name ?? 'Histórico'} · mensal 2000–2025`} className="min-h-[650px]">
        {status !== 'ready' ? <ChartStatus message={error ?? 'Carregando calendário…'} onRetry={status === 'error' ? reload : undefined} /> : <Heatmap series={series} calendar={region?.monthly_calendar} selectedMonth={month} onSelectMonth={changeMonth} />}
      </Panel></div>
      </div>
      <aside className="flex min-w-0 flex-col gap-4">
        <div className="rounded-2xl border border-white/10 bg-[#0F1623] p-4"><Header coordinates={pick} view={view} date={month} regionId={regionId} regions={catalog?.regions ?? []} onViewChange={(value) => { setView(value); if (value === 'heat') document.getElementById('calendar')?.scrollIntoView({ behavior: 'smooth' }) }} onDateChange={changeMonth} onRegionChange={changeRegion} onSelectPlace={selectPlace} canExport={series.length > 0} onExport={() => downloadSeriesCsv(`firecal_${regionId}_mensal_2000_2025.csv`, series)} /></div>
        <Panel eyebrow="Projeção experimental de 1–4 semanas" title={location?.region_name ?? 'Modelo multivariado F₂'} className="min-h-[420px]">
          {locationLoading ? <ChartStatus message="Carregando previsão do catálogo…" /> : locationError ? <ChartStatus message={locationError} onRetry={() => { setLocationLoading(true); setLocationAttempt((v) => v + 1) }} /> : forecast ? <ForecastChart series={[]} forecast={forecast} regionName={currentHotspot?.label ?? location?.region_name ?? 'Ponto selecionado'} /> : <ChartStatus message="Sem previsão disponível." />}
          {location?.nearest_point && <p className="px-4 pb-3 font-mono text-[10px] text-[#9bb0d1]">Pedido: {pick.lat.toFixed(3)}, {pick.lon.toFixed(3)} → centro {location.coordinates.lat_center}, {location.coordinates.lon_center} · distância {location.nearest_point.distance_km.toLocaleString('pt-BR')} km. Histórico local não exportado; os painéis abaixo usam {region?.region_name ?? 'o escopo selecionado'}.</p>}
        </Panel>
      <Panel eyebrow="Série harmonizada e comparação por sensor" title={`${region?.region_name ?? 'Histórico'} · ${metric === 'sensors' ? sensorYear : '2000–2025'}`} className="min-h-[440px]">
        <div className="mb-3 flex gap-2 px-4 text-xs">{(['harmonized', 'sensors'] as const).map((m) => <button key={m} type="button" aria-pressed={metric === m} onClick={() => changeMetric(m)} className={`rounded-full border border-white/10 px-3 py-1 ${metric === m ? 'bg-white/15' : 'text-[#9bb0d1]'}`}>{m === 'harmonized' ? 'Histórico harmonizado' : 'Sensores (ano selecionado)'}</button>)}</div>
        {status !== 'ready' ? <ChartStatus message={error ?? 'Carregando histórico…'} onRetry={status === 'error' ? reload : undefined} /> : metric === 'sensors' && !['global', 'brazil'].includes(regionId) ? <ChartStatus message="A comparação por sensor está disponível para Mundo e Brasil. Selecione um desses escopos." /> : metric === 'sensors' && !sensorSeries ? <ChartStatus message={sensorError || `Consultando sensores em ${sensorYear}…`} /> : <div className="h-[370px]"><SeriesChart series={metric === 'sensors' ? sensorSeries ?? [] : series} mode={metric} selectedMonth={month} /></div>}
        <p className="px-4 pb-4 text-[11px] text-[#9bb0d1]">{metric === 'sensors' ? sensorSource : region?.provenance}</p>
      </Panel>
      </aside>
    </div>

    <footer className="mt-5 max-w-5xl pb-3 text-[11px] leading-relaxed text-[#9bb0d1]">Dados: NASA FIRMS / EOSDIS. 0 = sem detecção registrada nos arquivos; não comprova ausência de fogo ou céu sem nuvens. Uma célula não representa um incêndio único. F₂ é uma projeção estatística experimental da equipe sobre dados históricos, sem caráter oficial da NASA. O catálogo legado contém imputações físicas sem máscara por ponto; os drivers exibidos não são medições verificadas.</footer>
  </main>
}
