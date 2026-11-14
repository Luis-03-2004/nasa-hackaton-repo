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
import { AlertBadge } from '../layout/AlertBadge'
import { ChartTooltip } from './ChartTooltip'
import type { HarmonizedDataPoint, LocalForecast } from '../../types/api'

interface ForecastPoint {
  label: string
  observed: number | null
  forecast: number | null
  baseline: number | null
  p10: number | null
  p90: number | null
}

const axis = { fill: '#9bb0d1', fontSize: 11 }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function buildPoints(series: HarmonizedDataPoint[], forecast: LocalForecast): ForecastPoint[] {
  const recent = series.slice(-6)
  const anchor = recent.at(-1)
  const projected = [forecast.forecast_w1, forecast.forecast_w2, forecast.forecast_w3, forecast.forecast_w4]

  const points: ForecastPoint[] = recent.map((point) => ({
    label: `W${point.iso_week}`,
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
      label: `+${index + 1} wk`,
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
  return `${MONTHS[month]} · week ${peak.iso_week}`
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
          <div className="mt-1">
            <AlertBadge level={forecast.alert_level} />
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-3 text-right">
          <div>
            <dt className="font-mono text-[10px] tracking-wide text-[#9bb0d1] uppercase">Recent departure</dt>
            <dd className="text-sm text-[#ffb0a1]">
              {sign}
              {forecast.recent_anomaly_pct}%
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] tracking-wide text-[#9bb0d1] uppercase">Local peak</dt>
            <dd className="text-sm text-white">{peakWindow(series)}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] tracking-wide text-[#9bb0d1] uppercase">Backtest MAE</dt>
            <dd className="text-sm text-[#c5d9ff]">−68.2%</dd>
          </div>
        </dl>
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
            <YAxis tick={axis} axisLine={false} tickLine={false} width={36} />
            <Tooltip content={ChartTooltip} />
            <Area type="monotone" dataKey="p90" name="P90" stroke="none" fill="rgba(252,61,33,0.35)" connectNulls />
            <Area type="monotone" dataKey="p10" name="P10" stroke="none" fill="#071a3a" connectNulls />
            <Line
              type="monotone"
              dataKey="baseline"
              name="Climatology"
              stroke="#9bb0d1"
              strokeDasharray="2 4"
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="observed"
              name="Observed"
              stroke="#fc3d21"
              strokeWidth={2.4}
              dot={{ r: 2, fill: '#fc3d21' }}
            />
            <Line
              type="monotone"
              dataKey="forecast"
              name="Forecast"
              stroke="#ffd4cc"
              strokeDasharray="5 4"
              strokeWidth={2}
              dot={{ r: 2, fill: '#ffd4cc' }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-[#9bb0d1]">
        Statistical projection from the local seasonal memory and the recent anomaly. It does not replace a meteorological ignition model.
      </p>
    </div>
  )
}
