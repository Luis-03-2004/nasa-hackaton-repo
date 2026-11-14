import { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import type { HarmonizedDataPoint } from '../../types/api'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const RAMP: Array<[number, number, number]> = [
  [11, 61, 145],
  [46, 107, 181],
  [143, 180, 232],
  [252, 61, 33],
  [255, 122, 102],
]

interface HeatCell {
  year: string
  month: string
  value: number
  fill: string
}

function rampColor(amount: number) {
  const scaled = Math.min(1, Math.max(0, amount)) * (RAMP.length - 1)
  const index = Math.min(RAMP.length - 2, Math.floor(scaled))
  const blend = scaled - index
  const start = RAMP[index]
  const end = RAMP[index + 1]
  const channels = start.map((channel, channelIndex) =>
    Math.round(channel + (end[channelIndex] - channel) * blend),
  )
  return `rgb(${channels.join(',')})`
}

function monthlyCells(series: HarmonizedDataPoint[], mode: 'harmonized' | 'anomaly'): HeatCell[] {
  const buckets = new Map<string, number[]>()

  for (const point of series) {
    const month = new Date(`${point.week_start}T00:00:00Z`).getUTCMonth()
    const key = `${point.iso_year}-${month}`
    const value = mode === 'harmonized' ? point.harmonized_index : point.anomaly_pct
    buckets.set(key, [...(buckets.get(key) ?? []), value])
  }

  const years = [...new Set(series.map((point) => point.iso_year))].sort()
  const cells: Array<Omit<HeatCell, 'fill'>> = []

  for (const year of years) {
    for (let month = 0; month < 12; month += 1) {
      const values = buckets.get(`${year}-${month}`) ?? [0]
      const value = values.reduce((sum, item) => sum + item, 0) / values.length
      cells.push({ year: String(year), month: MONTHS[month], value })
    }
  }

  for (let month = 0; month < 12; month += 1) {
    const column = cells.filter((cell) => cell.month === MONTHS[month])
    const value = column.reduce((sum, cell) => sum + cell.value, 0) / column.length
    cells.push({ year: 'Mean', month: MONTHS[month], value })
  }

  const values = cells.map((cell) => cell.value)
  const min = Math.min(...values)
  const max = Math.max(...values)

  return cells.map((cell) => ({
    ...cell,
    value: Math.round(cell.value * 10) / 10,
    fill: rampColor(max === min ? 0.5 : (cell.value - min) / (max - min)),
  }))
}

function HeatShape({ cx, cy, payload }: { cx?: number; cy?: number; payload?: HeatCell }) {
  if (cx == null || cy == null || !payload) return null
  return <rect x={cx - 11} y={cy - 9} width={22} height={16} rx={3} fill={payload.fill} />
}

function HeatTooltip({ active, payload }: TooltipContentProps) {
  const cell = payload?.[0]?.payload as HeatCell | undefined
  if (!active || !cell) return null

  return (
    <div className="rounded-lg border border-white/10 bg-[#071a3d] px-3 py-2 text-xs">
      <p className="font-mono text-[#9bb0d1]">
        {cell.year} · {cell.month}
      </p>
      <p className="mt-1 text-sm text-white">{cell.value}</p>
      <p className="mt-2 text-[10px] leading-snug text-[#9bb0d1]">
        Monthly mean of FIRMS pixels. Zero does not prove the absence of fire.
      </p>
    </div>
  )
}

export function Heatmap({ series }: { series: HarmonizedDataPoint[] }) {
  const [mode, setMode] = useState<'harmonized' | 'anomaly'>('harmonized')
  const cells = useMemo(() => monthlyCells(series, mode), [series, mode])

  return (
    <div className="flex h-full min-h-64 flex-col px-3 pb-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-full border border-white/10 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode('harmonized')}
            className={`rounded-full px-2.5 py-1 ${mode === 'harmonized' ? 'bg-white/10 text-white' : 'text-[#9bb0d1]'}`}
          >
            Intensity
          </button>
          <button
            type="button"
            onClick={() => setMode('anomaly')}
            className={`rounded-full px-2.5 py-1 ${mode === 'anomaly' ? 'bg-white/10 text-white' : 'text-[#9bb0d1]'}`}
          >
            Anomaly %
          </button>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-[#9bb0d1]">
          <span>Low</span>
          <span className="h-2 w-24 rounded-full bg-linear-to-r from-[#0b3d91] via-[#8fb4e8] to-[#fc3d21]" />
          <span>Extreme</span>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
            <XAxis
              dataKey="month"
              type="category"
              allowDuplicatedCategory={false}
              tick={{ fill: '#9bb0d1', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              dataKey="year"
              type="category"
              reversed
              allowDuplicatedCategory={false}
              tick={{ fill: '#9bb0d1', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip cursor={false} content={HeatTooltip} />
            <Scatter data={cells} shape={HeatShape} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-[#9bb0d1]">
        A cell equal to 0 means no detection was recorded in the files. It does not prove the absence of fire.
      </p>
    </div>
  )
}
