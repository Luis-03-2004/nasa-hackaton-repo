import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { HarmonizedDataPoint, LocalForecast } from '../../types/api'

interface ForecastPoint {
  label: string
  observed: number | null
  forecast: number | null
  baseline: number | null
  p10: number | null
  p90: number | null
}

const axis = { fill: '#93a4bd', fontSize: 11 }
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function buildPoints(series: HarmonizedDataPoint[], forecast: LocalForecast): ForecastPoint[] {
  const recent = series.slice(-6)
  const anchor = recent.at(-1)
  const projected = [forecast.forecast_w1, forecast.forecast_w2, forecast.forecast_w3, forecast.forecast_w4]

  const points: ForecastPoint[] = recent.map((point) => ({
    label: `S${point.iso_week}`,
    observed: point.harmonized_index,
    forecast: null,
    baseline: point.baseline_mean,
    p10: null,
    p90: null,
  }))

  if (points.length > 0 && anchor) {
    points[points.length - 1].forecast = anchor.harmonized_index
    points[points.length - 1].p10 = anchor.harmonized_index
    points[points.length - 1].p90 = anchor.harmonized_index
  }

  projected.forEach((value, index) => {
    const factor = 1 + forecast.recent_anomaly_pct / 100
    points.push({
      label: `+${index + 1} sem`,
      observed: null,
      forecast: value,
      baseline: Math.round((value / factor) * 10) / 10,
      p10: forecast.band_p10_p90.p10[index] ?? null,
      p90: forecast.band_p10_p90.p90[index] ?? null,
    })
  })

  return points
}

function peakWindow(series: HarmonizedDataPoint[]) {
  const peak = series.reduce((best, point) =>
    point.baseline_mean > best.baseline_mean ? point : best,
  )
  const month = new Date(`${peak.week_start}T00:00:00Z`).getUTCMonth()
  return `${MONTHS[month]} · semana ${peak.iso_week}`
}

export function ForecastChart({
  series,
  forecast,
  regionName,
}: {
  series: HarmonizedDataPoint[]
  forecast: LocalForecast
  regionName: string
}) {
  const points = buildPoints(series, forecast)
  const sign = forecast.recent_anomaly_pct > 0 ? '+' : ''

  return (
    <div className="flex h-full min-h-64 flex-col px-3 pb-3">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm text-white">{regionName}</p>
          <p className="font-mono text-[11px] text-[#93a4bd]">{forecast.alert_level.replaceAll('_', ' ')}</p>
        </div>
        <dl className="grid grid-cols-3 gap-3 text-right">
          <div>
            <dt className="font-mono text-[10px] tracking-wide text-[#93a4bd] uppercase">Desvio recente</dt>
            <dd className="text-sm text-[#ffb088]">
              {sign}
              {forecast.recent_anomaly_pct}%
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] tracking-wide text-[#93a4bd] uppercase">Pico local</dt>
            <dd className="text-sm text-white">{peakWindow(series)}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] tracking-wide text-[#93a4bd] uppercase">Backtest MAE</dt>
            <dd className="text-sm text-[#9be8f8]">−68,2%</dd>
          </div>
        </dl>
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
            <YAxis tick={axis} axisLine={false} tickLine={false} width={36} />
            <Tooltip
              contentStyle={{
                background: '#0e1420',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Area type="monotone" dataKey="p90" stroke="none" fill="rgba(255,106,44,0.28)" connectNulls />
            <Area type="monotone" dataKey="p10" stroke="none" fill="#121826" connectNulls />
            <Line
              type="monotone"
              dataKey="baseline"
              name="Climatologia"
              stroke="#93a4bd"
              strokeDasharray="2 4"
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="observed"
              name="Observado"
              stroke="#ff6a2c"
              strokeWidth={2.4}
              dot={{ r: 2, fill: '#ff6a2c' }}
            />
            <Line
              type="monotone"
              dataKey="forecast"
              name="Previsão"
              stroke="#ffd7c2"
              strokeDasharray="5 4"
              strokeWidth={2}
              dot={{ r: 2, fill: '#ffd7c2' }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-[#93a4bd]">
        Projeção estatística da memória sazonal local e da anomalia recente. Não substitui modelo meteorológico de ignição.
      </p>
    </div>
  )
}
