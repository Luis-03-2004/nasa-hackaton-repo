import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { AlertBadge } from '../layout/AlertBadge'
import type { HarmonizedDataPoint, LocalForecast } from '../../types/api'

const axis = { fill: '#9bb0d1', fontSize: 11 }
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const signed = (value: number) => `${value > 0 ? '+' : ''}${number.format(value)}%`

export function ForecastChart({ forecast, regionName }: {
  series: HarmonizedDataPoint[]
  forecast: LocalForecast
  regionName: string
}) {
  const projected = [forecast.forecast_w1, forecast.forecast_w2, forecast.forecast_w3, forecast.forecast_w4]
  const points = projected.map((value, index) => ({ label: `t+${index + 1} sem.`, value, anomaly: forecast.anomaly_pct[index] }))
  const { drivers, validation } = forecast

  return (
    <div className="flex min-h-80 flex-col gap-3 px-3 pb-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm text-white">{regionName}</p>
          <p className="mt-1 font-mono text-[11px] text-[#9bb0d1]">
            Referência: {forecast.reference_year} · semana {forecast.reference_iso_week} ({forecast.reference_date})
          </p>
        </div>
        <AlertBadge level={forecast.alert_level} />
      </div>
      <div className="h-44 min-h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
            <YAxis tick={axis} axisLine={false} tickLine={false} width={48} domain={[0, 'auto']} />
            <Tooltip content={({ active, payload }) => {
              const point = payload?.[0]?.payload as (typeof points)[number] | undefined
              if (!active || !point) return null
              return (
                <div className="rounded-lg border border-white/15 bg-[#071a3d] p-3 text-xs">
                  <p>{point.label}</p>
                  <p className="font-mono">{number.format(point.value)} células de 1 km</p>
                  <p className="font-mono">{signed(point.anomaly)} vs. climatologia</p>
                </div>
              )
            }} />
            <Line type="linear" dataKey="value" name="Projeção F₂" stroke="#fb923c" strokeWidth={2.4} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {points.map((point) => (
          <div key={point.label} className="rounded-lg border border-white/10 bg-white/5 p-2">
            <p className="text-[10px] text-[#9bb0d1]">{point.label}</p>
            <p className="font-mono text-sm">{number.format(point.value)}</p>
            <p className="font-mono text-[10px] text-[#fdba74]">{signed(point.anomaly)}</p>
          </div>
        ))}
      </div>
      <div>
        <p className="mb-1 text-[11px] text-[#9bb0d1]">Variáveis do catálogo · podem conter imputações</p>
        <dl className="grid grid-cols-2 gap-2 font-mono text-[11px]">
          <div><dt className="text-[#9bb0d1]">FRP</dt><dd>{number.format(drivers.frp_sum_mw)} MW</dd></div>
          <div><dt className="text-[#9bb0d1]">Contraste térmico ΔT</dt><dd>{number.format(drivers.delta_t_k)} K</dd></div>
          <div><dt className="text-[#9bb0d1]">Detecções agrupadas</dt><dd>{number.format(drivers.merged_count)}</dd></div>
          <div><dt className="text-[#9bb0d1]">Células de 1 km na referência</dt><dd>{number.format(drivers.observed_1km_cells)}</dd></div>
        </dl>
      </div>
      <p className="text-[11px] text-[#9bb0d1]">
        Validação agregada da zona {forecast.validation_scope} (2024–2025, t+1): skill {signed(validation.skill_f2_vs_f0_pct)} vs. climatologia F₀;
        {' '}MAE {number.format(validation.mae)} células de 1 km; r = {number.format(validation.corr)}.
        {' '}A métrica não é uma validação deste ponto.
      </p>
      <p className="text-[11px] leading-relaxed text-[#9bb0d1]">{forecast.provenance}</p>
      <p className="text-[11px] text-[#9bb0d1]">
        O artefato não fornece intervalo de incerteza. Projeção experimental da equipe sobre dados históricos NASA FIRMS (2000–2025).
      </p>
    </div>
  )
}
