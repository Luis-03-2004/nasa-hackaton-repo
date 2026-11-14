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
import type { SeriesMetric } from '../layout/Header'
import { ChartTooltip } from './ChartTooltip'
import type { HarmonizedDataPoint } from '../../types/api'

const axis = { fill: '#9bb0d1', fontSize: 11 }

export function SeriesChart({
  series,
  mode,
}: {
  series: HarmonizedDataPoint[]
  mode: SeriesMetric
}) {
  return (
    <div className="flex h-full min-h-64 flex-col px-3 pb-3">
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
              tickFormatter={(value: string) => {
                const [year, month] = value.split('-').map(Number)
                return String(month === 12 ? year + 1 : year)
              }}
            />
            <YAxis tick={axis} axisLine={false} tickLine={false} width={40} />
            <Tooltip content={ChartTooltip} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {mode === 'harmonized' ? (
              <>
                <Line
                  type="monotone"
                  dataKey="harmonized_index"
                  name="Harmonized index"
                  stroke="#fc3d21"
                  dot={false}
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="baseline_mean"
                  name="Seasonal mean"
                  stroke="#6ea2ff"
                  dot={false}
                  strokeDasharray="4 4"
                />
              </>
            ) : (
              <>
                <Line type="monotone" dataKey="n_modis" name="MODIS" stroke="#fc3d21" dot={false} />
                <Line
                  type="monotone"
                  dataKey="n_viirs_snpp"
                  name="VIIRS S-NPP"
                  stroke="#6ea2ff"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="n_viirs_jpss1"
                  name="VIIRS JPSS-1"
                  stroke="#f7f9fc"
                  dot={false}
                />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-[#9bb0d1]">
        A pixel is not a single fire. FRP is instantaneous power, in MW. Credit: NASA FIRMS / CONAE.
      </p>
    </div>
  )
}
