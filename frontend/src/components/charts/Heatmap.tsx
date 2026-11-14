import { useMemo, useState } from 'react'
import type { HarmonizedDataPoint, MonthlyCalendarCell } from '../../types/api'

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
type Mode = 'harmonized' | 'anomaly' | 'zscore'
const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'harmonized', label: 'Intensidade' }, { id: 'anomaly', label: 'Anomalia %' }, { id: 'zscore', label: 'Z-score' },
]
const RAMP: Array<[number, number, number]> = [[30, 41, 59], [254, 240, 138], [253, 186, 116], [239, 68, 68], [153, 27, 27]]

function intensityColor(amount: number) {
  const scaled = Math.min(1, Math.max(0, amount)) * (RAMP.length - 1)
  const index = Math.min(RAMP.length - 2, Math.floor(scaled))
  const blend = scaled - index
  const channels = RAMP[index].map((channel, i) => Math.round(channel + (RAMP[index + 1][i] - channel) * blend))
  return `rgb(${channels.join(',')})`
}

function anomalyColor(value: number, mode: Mode) {
  if (Math.abs(value) < (mode === 'zscore' ? 0.1 : 2)) return '#334155'
  if (value < 0) return '#0284c7'
  return value > (mode === 'zscore' ? 2 : 50) ? '#dc2626' : '#f59e0b'
}

export function Heatmap({ series, calendar, onSelectMonth, selectedMonth }: {
  series: HarmonizedDataPoint[]
  calendar?: MonthlyCalendarCell[]
  onSelectMonth?: (date: string) => void
  selectedMonth?: string
}) {
  const [mode, setMode] = useState<Mode>('harmonized')
  const cells = useMemo(() => calendar ?? series.map((point) => ({
    year: point.iso_year,
    month: point.month ?? Number(point.week_start.slice(5, 7)),
    harmonized_1km_cells: point.harmonized_index,
    clim_mean_2003_2023: point.baseline_mean,
    anomaly_pct: point.anomaly_pct,
    anomaly_zscore: point.anomaly_zscore ?? null,
  })), [calendar, series])
  const index = useMemo(() => new Map(cells.map((cell) => [`${cell.year}-${cell.month}`, cell])), [cells])
  const years = useMemo(() => [...new Set(cells.map((cell) => cell.year))].sort((a, b) => a - b), [cells])
  const max = useMemo(() => Math.max(1, ...cells.map((cell) => cell.harmonized_1km_cells)), [cells])

  function renderCell(cell: MonthlyCalendarCell | undefined, year: number | null, month: number) {
    const summary = year == null
    const value = !cell ? null : mode === 'harmonized'
      ? summary ? cell.clim_mean_2003_2023 : cell.harmonized_1km_cells
      : summary ? 0 : mode === 'anomaly' ? cell.anomaly_pct : cell.anomaly_zscore
    const available = value != null && Number.isFinite(value)
    const date = `${year}-${String(month).padStart(2, '0')}`
    const selected = !summary && selectedMonth?.slice(0, 7) === date
    const units = mode === 'harmonized' ? 'células de 1 km' : mode === 'anomaly' ? '%' : 'desvios-padrão'
    const description = `${summary ? 'Climatologia 2003–2023' : year} · ${MONTHS[month - 1]}: ${available ? `${number.format(value)} ${units}` : 'sem dado neste artefato'}`
    const color = available ? mode === 'harmonized' ? intensityColor(value / max) : anomalyColor(value, mode) : '#0f172a'
    return (
      <td key={month} className="p-[2px]">
        <button
          type="button"
          disabled={summary || !cell || !onSelectMonth}
          aria-label={description}
          aria-pressed={selected}
          title={description}
          onClick={() => onSelectMonth?.(`${date}-01`)}
          className={`relative block h-4 w-full min-w-7 rounded-sm outline-offset-2 ${selected ? 'outline-2 outline-white' : 'enabled:hover:outline-1 enabled:hover:outline-white/60'} ${!available ? 'border border-dashed border-slate-600' : ''}`}
          style={{ background: color }}
        >
          <span className="sr-only">{description}</span>
        </button>
      </td>
    )
  }

  return (
    <div className="flex h-full min-h-96 flex-col gap-2 px-3 pb-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-full border border-white/10 p-0.5 text-[11px]">
          {MODES.map((item) => (
            <button key={item.id} type="button" aria-pressed={mode === item.id} onClick={() => setMode(item.id)}
              className={`rounded-full px-2.5 py-1 ${mode === item.id ? 'bg-white/10 text-white' : 'text-[#9bb0d1]'}`}>{item.label}</button>
          ))}
        </div>
        <span className="font-mono text-[10px] text-[#9bb0d1]">{years.length} anos × 12 meses</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[460px] border-separate border-spacing-0 text-left font-mono text-[10px]">
          <caption className="sr-only">Calendário mensal harmonizado de 2000 a 2025, com climatologia de 2003 a 2023</caption>
          <thead className="sticky top-0 z-10 bg-[#071a3a] text-[#9bb0d1]">
            <tr><th scope="col" className="w-12 py-1">Ano</th>{MONTHS.map((month) => <th scope="col" key={month} className="py-1 text-center font-normal">{month}</th>)}</tr>
          </thead>
          <tbody>
            {years.map((year) => <tr key={year}><th scope="row" className="pr-2 font-normal text-[#9bb0d1]">{year}</th>{MONTHS.map((_, month) => renderCell(index.get(`${year}-${month + 1}`), year, month + 1))}</tr>)}
          </tbody>
          <tfoot className="sticky bottom-0 z-10 bg-[#071a3a]">
            <tr><th scope="row" title="Média climatológica 2003–2023" className="pr-2 pt-2 font-normal text-[#9bb0d1]">Clim.</th>{MONTHS.map((_, month) => renderCell(cells.find((cell) => cell.month === month + 1), null, month + 1))}</tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap gap-3 text-[10px] text-[#9bb0d1]">
        {mode === 'harmonized' ? <span>Escala linear: 0 → {number.format(max)} células de 1 km (escuro → amarelo → vermelho)</span>
          : <><span><i className="mr-1 inline-block h-2 w-2 bg-[#0284c7]" />Abaixo da média</span><span><i className="mr-1 inline-block h-2 w-2 bg-[#334155]" />Próximo de zero</span><span><i className="mr-1 inline-block h-2 w-2 bg-[#f59e0b]" />Acima</span><span><i className="mr-1 inline-block h-2 w-2 bg-[#dc2626]" />{mode === 'anomaly' ? '> +50%' : '> +2σ'}</span></>}
        <span>Contorno tracejado = sem dado</span>
      </div>
      <p className="text-[11px] leading-relaxed text-[#9bb0d1]">
        Clim. = média mensal 2003–2023 (anomalia de referência = 0). Selecione uma célula para destacar o mês.
        0 = sem detecção registrada nos arquivos FIRMS; não comprova ausência de fogo ou céu sem nuvens. Uma célula não é um incêndio único.
      </p>
    </div>
  )
}
