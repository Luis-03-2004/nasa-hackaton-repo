import { ForecastChart } from '../components/charts/ForecastChart'
import { Heatmap } from '../components/charts/Heatmap'
import { SeriesChart } from '../components/charts/SeriesChart'
import { Header } from '../components/layout/Header'
import { Panel } from '../components/layout/Panel'
import { EarthGlobe } from '../components/webgl/EarthGlobe'
import { useFireData } from '../hooks/useFireData'
import { useGlobeHotspots } from '../hooks/useGlobeHotspots'

function ChartStatus({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm text-[#93a4bd]">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full border border-white/15 px-3 py-1 text-sm text-white"
        >
          Tentar de novo
        </button>
      ) : null}
    </div>
  )
}

export function Dashboard() {
  const { catalog, status, error, reload } = useFireData()
  const region = catalog?.regions.find((item) => item.id === 'cerrado')
  const { hotspots, selected, selectId, selectNearest } = useGlobeHotspots()
  const waiting = status !== 'ready' || !region

  return (
    <div className="flex h-full min-h-screen flex-col">
      <Header />
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-2 lg:grid-rows-2">
        <Panel eyebrow="01 · Globo" title={selected?.label ?? 'Atividade de queima no planeta'}>
          <EarthGlobe
            hotspots={hotspots}
            focus={selected ? { lat: selected.lat, lon: selected.lon } : null}
            onSelect={({ lat, lon }) => selectNearest(lat, lon)}
            onHotspotSelect={selectId}
          />
        </Panel>
        <Panel eyebrow="02 · Previsão" title="Horizonte local de 4 semanas">
          {waiting || !region ? (
            <ChartStatus
              message={status === 'error' ? (error ?? 'Falha ao carregar.') : 'Carregando série harmonizada…'}
              onRetry={status === 'error' ? reload : undefined}
            />
          ) : (
            <ForecastChart
              series={region.historical_series}
              forecast={region.forecast}
              regionName={region.region_name}
            />
          )}
        </Panel>
        <Panel eyebrow="03 · Calendário" title={region ? `${region.region_name} · 2020–2025` : '2020–2025'}>
          {waiting || !region ? (
            <ChartStatus message={status === 'error' ? 'Série indisponível.' : 'Carregando calendário…'} />
          ) : (
            <Heatmap series={region.historical_series} />
          )}
        </Panel>
        <Panel eyebrow="04 · Série" title="Histórico harmonizado e sensores">
          {waiting || !region ? (
            <ChartStatus message={status === 'error' ? 'Série indisponível.' : 'Carregando histórico…'} />
          ) : (
            <SeriesChart series={region.historical_series} />
          )}
        </Panel>
      </main>
    </div>
  )
}
