import { useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { HarmonizedDataPoint } from '../../types/api'

const axis = { fill: '#93a4bd', fontSize: 11 }

export function SeriesChart({ series }: { series: HarmonizedDataPoint[] }) {
  const [mode, setMode] = useState<'harmonized' | 'sensors'>('harmonized')

  return (
    <div className="flex h-full min-h-64 flex-col px-3 pb-3">
      <div className="mb-2 flex rounded-full border border-white/10 p-0.5 text-xs self-start">
        <button
          type="button"
          onClick={() => setMode('harmonized')}
          className={`rounded-full px-2.5 py-1 ${mode === 'harmonized' ? 'bg-white/10 text-white' : 'text-[#93a4bd]'}`}
        >
          Curva unificada
        </button>
        <button
          type="button"
          onClick={() => setMode('sensors')}
          className={`rounded-full px-2.5 py-1 ${mode === 'sensors' ? 'bg-white/10 text-white' : 'text-[#93a4bd]'}`}
        >
          MODIS vs VIIRS
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="week_start"
              tick={axis}
              axisLine={false}
              tickLine={false}
              interval={51}
              tickFormatter={(value: string) => value.slice(0, 4)}
            />
            <YAxis tick={axis} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              contentStyle={{
                background: '#0e1420',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {mode === 'harmonized' ? (
              <>
                <Line
                  type="monotone"
                  dataKey="harmonized_index"
                  name="Índice harmonizado"
                  stroke="#ff6a2c"
                  dot={false}
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="baseline_mean"
                  name="Média da época"
                  stroke="#3dd6f5"
                  dot={false}
                  strokeDasharray="4 4"
                />
              </>
            ) : (
              <>
                <Line type="monotone" dataKey="n_modis" name="MODIS" stroke="#f5b942" dot={false} />
                <Line
                  type="monotone"
                  dataKey="n_viirs_snpp"
                  name="VIIRS S-NPP"
                  stroke="#3dd6f5"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="n_viirs_jpss1"
                  name="VIIRS JPSS-1"
                  stroke="#d6d6ff"
                  dot={false}
                />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-[#93a4bd]">
        Pixel não é um incêndio único. FRP é potência instantânea, em MW. Crédito: NASA FIRMS / CONAE.
      </p>
    </div>
  )
}
