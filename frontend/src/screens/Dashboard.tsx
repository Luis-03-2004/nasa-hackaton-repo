import { ForecastChart } from '../components/charts/ForecastChart'
import { Heatmap } from '../components/charts/Heatmap'
import { SeriesChart } from '../components/charts/SeriesChart'
import { Header } from '../components/layout/Header'
import { Panel } from '../components/layout/Panel'
import { EarthGlobe } from '../components/webgl/EarthGlobe'
import { useGlobeHotspots } from '../hooks/useGlobeHotspots'
import { regionById } from '../mocks/regions'

export function Dashboard() {
  const region = regionById('cerrado')
  const { hotspots, selected, selectId, selectNearest } = useGlobeHotspots()

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
          <ForecastChart
            series={region.historical_series}
            forecast={region.forecast}
            regionName={region.region_name}
          />
        </Panel>
        <Panel eyebrow="03 · Calendário" title={`${region.region_name} · 2020–2025`}>
          <Heatmap series={region.historical_series} />
        </Panel>
        <Panel eyebrow="04 · Série" title="Histórico harmonizado e sensores">
          <SeriesChart series={region.historical_series} />
        </Panel>
      </main>
    </div>
  )
}
