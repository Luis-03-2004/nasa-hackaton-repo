import { Heatmap } from '../components/charts/Heatmap'
import { SeriesChart } from '../components/charts/SeriesChart'
import { Header } from '../components/layout/Header'
import { Panel } from '../components/layout/Panel'
import { EarthGlobe } from '../components/webgl/EarthGlobe'
import { regionById } from '../mocks/regions'

function PendingNote({ children }: { children: string }) {
  return (
    <p className="flex h-full min-h-40 items-center justify-center px-6 text-center text-sm text-[#93a4bd]">
      {children}
    </p>
  )
}

export function Dashboard() {
  const region = regionById('cerrado')

  return (
    <div className="flex h-full min-h-screen flex-col">
      <Header />
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-2 lg:grid-rows-2">
        <Panel eyebrow="01 · Globo" title="Atividade de queima no planeta">
          <EarthGlobe />
        </Panel>
        <Panel eyebrow="02 · Previsão" title="Horizonte local de 4 semanas">
          <PendingNote>
            Projeção da localidade selecionada, com a faixa de incerteza P10–P90.
          </PendingNote>
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
