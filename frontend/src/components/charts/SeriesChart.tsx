import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { SeriesMetric } from '../layout/Header'
import { ChartTooltip } from './ChartTooltip'
import type { HarmonizedDataPoint } from '../../types/api'

const axis = { fill: '#9bb0d1', fontSize: 11 }

export function SeriesChart({ series, mode, selectedMonth }: {
  series: HarmonizedDataPoint[]
  mode: SeriesMetric
  selectedMonth?: string
}) {
  const sensorData = series.some((point) => point.n_modis != null || point.n_viirs_snpp != null || point.n_viirs_jpss1 != null)
  if (mode === 'sensors' && !sensorData) {
    return (
      <div className="flex min-h-64 items-center px-5 text-sm leading-relaxed text-[#9bb0d1]">
        A série mensal exportada contém o índice harmonizado, sem contagens separadas por sensor.
        A comparação MODIS/VIIRS requer os agregados dos Parquet; não há valores por sensor neste gráfico.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-64 flex-col px-3 pb-3">
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="week_start" tick={axis} axisLine={false} tickLine={false} interval={series.length > 24 ? 47 : 0} tickFormatter={(value: string) => series.length > 24 ? value.slice(0, 4) : value.slice(5, 7)} />
            <YAxis tick={axis} axisLine={false} tickLine={false} width={56} tickFormatter={(value: number) => new Intl.NumberFormat('pt-BR', { notation: 'compact' }).format(value)} />
            <Tooltip content={ChartTooltip} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {mode === 'harmonized' ? (
              <>
                <Line type="linear" dataKey="harmonized_index" name="Índice harmonizado mensal" stroke="#10b981" dot={false} strokeWidth={1.7} />
                <Line type="linear" dataKey="baseline_mean" name="Climatologia 2003–2023" stroke="#94a3b8" dot={false} strokeDasharray="4 4" />
              </>
            ) : (
              <>
                <Line type="linear" dataKey="n_modis" name="MODIS" stroke="#38bdf8" dot={false} />
                <Line type="linear" dataKey="n_viirs_snpp" name="VIIRS S-NPP" stroke="#f97316" dot={false} />
                <Line type="linear" dataKey="n_viirs_jpss1" name="VIIRS JPSS-1" stroke="#a855f7" dot={false} />
              </>
            )}
            {selectedMonth && series.some((point) => point.week_start.startsWith(selectedMonth.slice(0, 7))) ? (
              <ReferenceLine x={`${selectedMonth.slice(0, 7)}-01`} stroke="#fbbf24" strokeDasharray="3 3" />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-[#9bb0d1]">
        Agregação mensal de células de 1 km · cobertura inicial parcial. Uma célula não é um incêndio único.
        0 = sem detecção registrada; não comprova ausência de fogo. Dados: NASA FIRMS / EOSDIS.
      </p>
    </div>
  )
}
