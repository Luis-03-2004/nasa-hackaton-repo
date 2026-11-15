import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useI18n } from '../../i18n'
import { postApi } from '../../services/fireApi'
import { fireIntensityColor } from '../../utils/fireColors'
import type { Analysis, CalendarMonthData, ForecastSelection } from '../../types/exploration'
import { MetricInfo } from '../layout/InfoToggle'
import { Panel } from '../layout/Panel'

export function HistoryChart({
  data,
  selectedMonth,
  onMonth,
}: {
  data: Analysis
  selectedMonth: string
  onMonth: (month: string) => void
}) {
  const { t, number, locale } = useI18n()
  const [bySensor, setBySensor] = useState(false)
  const points = data.timeseries.map((p) => ({ ...p, ...p.sensors }))
  return (
    <Panel
      eyebrow={t('Histórico da seleção', 'Selection history')}
      title={t('Série temporal observada', 'Observed time series')}
      info={t(
        'Cada valor usa todo o recorte, com os mesmos sensores e filtros da exportação. A comparação por sensor mantém as diferenças de observação. A linha temporal pode conter ausência de registros; isso não comprova ausência de fogo. A unidade do merge legado é célula × mês × semana × sensor, não células únicas no ano.',
        'Each value uses the entire selection with the same sensors and filters as the export. Sensor comparison preserves observation differences. No registered detections do not prove absence of fire. The legacy merge unit is cell × month × week × sensor, not unique cells in a year.',
      )}
      action={
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="control-button"
            aria-pressed={bySensor}
            onClick={() => setBySensor(!bySensor)}
          >
            {bySensor ? t('Ver total', 'Show total') : t('Comparar sensores', 'Compare sensors')}
          </button>
          <MetricInfo
            align="right"
            term={t('Comparação por Sensor vs Total', 'Sensor Comparison vs Total')}
          >
            {t(
              'Alterna entre a curva consolidada ("Total observado") e as 3 curvas individuais por satélite: MODIS (2000–2025, 1 km), VIIRS S-NPP (2012–2025, 375 m) e VIIRS NOAA-20 (2018–2025, 375 m). Clique em qualquer ponto da linha para sincronizar o mês do mapa.',
              'Toggles between the aggregated curve ("Observed total") and the 3 individual satellite curves: MODIS (2000–2025, 1 km), VIIRS S-NPP (2012–2025, 375 m), and VIIRS NOAA-20 (2018–2025, 375 m). Click any point on the curve to sync the map month.',
            )}
          </MetricInfo>
        </div>
      }
    >
      <div className="h-[310px] min-w-0 px-2">
        {!data.timeseries.length && (
          <p className="p-4 text-sm text-slate-400">
            {t('Sem registros para este recorte.', 'No records for this selection.')}
          </p>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points}
            margin={{ top: 10, right: 12, bottom: 12, left: 12 }}
            onClick={(state) => {
              const label = state.activeLabel
              if (typeof label === 'string') onMonth(label.slice(0, 7))
            }}
          >
            <CartesianGrid stroke="#ffffff0d" vertical={false} />
            <XAxis
              dataKey="period"
              minTickGap={40}
              tick={{ fill: '#94a3b8', fontSize: 10 }}
              tickFormatter={(value: string) =>
                data.resolution === 'yearly'
                  ? value.slice(0, 4)
                  : data.resolution === 'monthly'
                    ? value.slice(0, 7)
                    : value
              }
            />
            <YAxis
              width={50}
              tick={{ fill: '#94a3b8', fontSize: 10 }}
              tickFormatter={(value: number) => number(value, { notation: 'compact' })}
            />
            <Tooltip
              formatter={(value) => (typeof value === 'number' ? number(value) : value)}
              labelFormatter={(value) => String(value)}
              contentStyle={{ background: '#0f1623', border: '1px solid #334155', fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {bySensor ? (
              <>
                <Line type="linear" dataKey="modis" name="MODIS" stroke="#38bdf8" dot={false} />
                <Line
                  type="linear"
                  dataKey="viirs-snpp"
                  name="VIIRS S-NPP"
                  stroke="#f97316"
                  dot={false}
                />
                <Line
                  type="linear"
                  dataKey="viirs-jpss1"
                  name="VIIRS NOAA-20"
                  stroke="#c084fc"
                  dot={false}
                />
              </>
            ) : (
              <Line
                type="linear"
                dataKey="value"
                name={t('Total observado', 'Observed total')}
                stroke="#fb923c"
                strokeWidth={1.8}
                dot={data.timeseries.length < 20}
              />
            )}
            {selectedMonth &&
              data.timeseries.some((p) => p.period.startsWith(selectedMonth)) && (
                <ReferenceLine
                  x={data.timeseries.find((p) => p.period.startsWith(selectedMonth))?.period}
                  stroke="#fbbf24"
                  strokeDasharray="3 3"
                />
              )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-4 font-mono text-[11px] text-slate-400">
        <span className="flex items-center gap-1">
          <span>
            {data.coverage.effective_start ?? data.filters.start_date} →{' '}
            {data.coverage.effective_end ?? data.filters.end_date} · {data.unit} ·{' '}
            {locale === 'pt-BR' ? 'UTC' : 'UTC'}
          </span>
          <MetricInfo term={t('Unidade da Série Temporal', 'Time Series Unit')}>
            {t(
              'Indica o intervalo efetivamente coberto pelos dados retornados e a unidade física da curva atual (célula×mês×semana×sensor para Registros, passagens sub-pixel agrupadas para Detecções, ou Megawatts para FRP).',
              'Shows the effective date coverage returned by the database and the physical unit of the active curve (cell×month×week×sensor for Records, merged sub-pixel passes for Detections, or Megawatts for FRP).',
            )}
          </MetricInfo>
        </span>
      </div>
    </Panel>
  )
}

export function CalendarChart({
  data,
  selectedMonth,
  onMonth,
  onSelectDayRange,
}: {
  data: Analysis
  selectedMonth: string
  onMonth: (month: string) => void
  onSelectDayRange?: (dateStr: string) => void
}) {
  const { t, number, locale } = useI18n()
  const [mode, setMode] = useState<'value' | 'anomaly_pct' | 'anomaly_zscore'>('value')
  const [viewLevel, setViewLevel] = useState<'years' | 'months' | 'days'>('years')

  const years = useMemo(() => {
    const list = [...new Set(data.calendar.map((row) => row.year))].sort((a, b) => a - b)
    if (list.length > 0) return list
    const sYear = Number((data.filters.start_date || '2025-01-01').slice(0, 4)) || 2025
    const eYear = Number((data.filters.end_date || '2025-12-31').slice(0, 4)) || 2025
    const fallback: number[] = []
    for (let y = Math.min(sYear, eYear); y <= Math.max(sYear, eYear); y++) fallback.push(y)
    return fallback.length ? fallback : [2025]
  }, [data.calendar, data.filters.start_date, data.filters.end_date])

  const parsedSelectedYear = Number(selectedMonth.slice(0, 4)) || years[years.length - 1] || 2025
  const parsedSelectedMonthNum = Number(selectedMonth.slice(5, 7)) || 12

  const [activeYear, setActiveYear] = useState<number>(parsedSelectedYear)
  const [activeMonth, setActiveMonth] = useState<number>(parsedSelectedMonthNum)
  const [dayData, setDayData] = useState<CalendarMonthData | null>(null)
  const [dayLoading, setDayLoading] = useState(false)

  // Mantém activeYear e activeMonth sincronizados com selectedMonth
  useEffect(() => {
    const y = Number(selectedMonth.slice(0, 4))
    const m = Number(selectedMonth.slice(5, 7))
    if (y >= 2000 && y <= 2025) setActiveYear(y)
    if (m >= 1 && m <= 12) setActiveMonth(m)
  }, [selectedMonth])

  // Auto-adapta o nível de visualização (Ano -> Mês -> Dia) quando o período filtrado muda
  useEffect(() => {
    const s = data.filters.start_date
    const e = data.filters.end_date
    if (!s || !e) return
    const sYear = Number(s.slice(0, 4))
    const eYear = Number(e.slice(0, 4))
    const sMonth = Number(s.slice(5, 7))
    const eMonth = Number(e.slice(5, 7))
    if (sYear === eYear && sMonth === eMonth) {
      setActiveYear(sYear)
      setActiveMonth(sMonth)
      setViewLevel('days')
    } else if (sYear === eYear) {
      setActiveYear(sYear)
      setViewLevel('months')
    } else {
      setViewLevel('years')
    }
  }, [data.filters.start_date, data.filters.end_date])

  // Carrega os dias do mês quando viewLevel === 'days'
  useEffect(() => {
    if (viewLevel !== 'days') return
    const controller = new AbortController()
    setDayLoading(true)
    postApi<CalendarMonthData>(
      '/explore/calendar-month',
      {
        country: data.filters.country,
        point_ids: data.filters.point_ids,
        sensors: data.filters.sensors,
        metric: data.filters.metric,
        year: activeYear,
        month: activeMonth,
      },
      controller.signal,
    )
      .then((res) => setDayData(res))
      .catch(() => {})
      .finally(() => setDayLoading(false))
    return () => controller.abort()
  }, [
    viewLevel,
    activeYear,
    activeMonth,
    data.filters.country,
    data.filters.point_ids,
    data.filters.sensors,
    data.filters.metric,
  ])

  const byKey = useMemo(
    () => new Map(data.calendar.map((row) => [`${row.year}-${row.month}`, row])),
    [data.calendar],
  )
  const max = Math.max(1, ...data.calendar.map((row) => row.value ?? 0))
  const labels = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2025, i, 1)),
    ),
  )
  const fullMonthLabels = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2025, i, 1)),
    ),
  )
  const weekdayLabels =
    locale === 'pt-BR'
      ? ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
      : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  // Linha de Climatologia 2003-2023 por mês (1..12)
  const climatologyByMonth = useMemo(() => {
    const map = new Map<number, number | null>()
    for (let m = 1; m <= 12; m++) {
      const rowWithBase = data.calendar.find((r) => r.month === m && r.baseline_mean != null)
      map.set(m, rowWithBase?.baseline_mean ?? null)
    }
    return map
  }, [data.calendar])

  const color = (value: number, customMax?: number) => {
    if (mode === 'value') return fireIntensityColor(value, customMax ?? max)
    const neutral = mode === 'anomaly_pct' ? 2 : 0.1
    if (value < -neutral) return '#0284c7'
    if (value > (mode === 'anomaly_pct' ? 50 : 2)) return '#dc2626'
    return value > neutral ? '#fb923c' : '#64748b'
  }

  const stepMonth = (delta: number) => {
    let y = activeYear
    let m = activeMonth + delta
    if (m < 1) {
      m = 12
      y = Math.max(2000, y - 1)
    } else if (m > 12) {
      m = 1
      y = Math.min(2025, y + 1)
    }
    setActiveYear(y)
    setActiveMonth(m)
    onMonth(`${y}-${String(m).padStart(2, '0')}`)
  }

  const maxDayVal = useMemo(() => {
    if (!dayData?.days?.length) return 1
    return Math.max(1, ...dayData.days.map((d) => d.value ?? 0))
  }, [dayData])

  return (
    <Panel
      eyebrow={t('Calendário do recorte', 'Selection calendar')}
      title={t('Atividade mensal por ano', 'Monthly activity by year')}
      info={t(
        'A matriz usa a seleção e os filtros atuais. Anomalias usam a média mensal de 2003–2023 do próprio recorte, quando disponível. Sem dado é tracejado; zero registrado é branco. Use os níveis Anos → Meses → Dias para navegar mantendo tamanho fixo.',
        'The matrix uses the current selection and filters. Anomalies use the selection’s monthly 2003–2023 mean where available. Missing data is dashed; recorded zero is white. Use Years → Months → Days to drill down within a fixed-size viewport.',
      )}
    >
      {/* Barra superior de modos + nível de zoom temporal (Anos -> Meses -> Dias) */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['value', t('Intensidade', 'Intensity')],
              ['anomaly_pct', t('Anomalia %', 'Anomaly %')],
              ['anomaly_zscore', 'Z-score'],
            ] as const
          ).map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
              className={`control-button ${mode === id ? 'bg-purple-500/25' : ''}`}
            >
              {label}
            </button>
          ))}
          <MetricInfo
            term={t(
              'Modos do Calendário: Intensidade, Anomalia % e Z-score',
              'Calendar Modes: Intensity, Anomaly %, and Z-score',
            )}
          >
            {t(
              '• Intensidade: valor absoluto observado da métrica selecionada.\n• Anomalia %: desvio percentual em relação à média climatológica (2003–2023) daquele mesmo mês/dia: ((Observado − Média) / Média) × 100.\n• Z-score: quantos desvios-padrão (σ) o valor está acima (> 0) ou abaixo (< 0) do normal histórico (Z > +2σ indica anomalia extrema).',
              '• Intensity: absolute observed value of the selected metric.\n• Anomaly %: percentage deviation against the 2003–2023 climatological baseline for that same month/day: ((Observed − Mean) / Mean) × 100.\n• Z-score: number of standard deviations (σ) above (> 0) or below (< 0) the historical norm (Z > +2σ indicates an extreme anomaly).',
            )}
          </MetricInfo>
        </div>

        {/* Seletor de nível Ano -> Mês -> Dia */}
        <div className="flex flex-wrap items-center gap-1">
          <div className="inline-flex rounded-lg border border-white/15 bg-[#070b12] p-0.5 text-xs">
            <button
              type="button"
              aria-pressed={viewLevel === 'years'}
              onClick={() => setViewLevel('years')}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                viewLevel === 'years'
                  ? 'bg-orange-500/25 text-orange-200 border border-orange-400/50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('Anos', 'Years')}
            </button>
            <button
              type="button"
              aria-pressed={viewLevel === 'months'}
              onClick={() => setViewLevel('months')}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                viewLevel === 'months'
                  ? 'bg-orange-500/25 text-orange-200 border border-orange-400/50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('Meses', 'Months')} ({activeYear})
            </button>
            <button
              type="button"
              aria-pressed={viewLevel === 'days'}
              onClick={() => setViewLevel('days')}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                viewLevel === 'days'
                  ? 'bg-orange-500/25 text-orange-200 border border-orange-400/50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('Dias', 'Days')} ({activeYear}-{String(activeMonth).padStart(2, '0')})
            </button>
          </div>
          <MetricInfo
            align="right"
            term={t('Navegação Anos → Meses → Dias', 'Years → Months → Days Drill-Down')}
          >
            {t(
              'O Calendário mantém tamanho horizontal e vertical fixo:\n• Anos: visão matricial multianual (clique no número de um ano para abrir os Meses daquele ano, ou dê duplo clique em uma célula para abrir os Dias).\n• Meses: exibe os 12 cartões mensais detalhados do ano selecionado.\n• Dias: exibe o calendário diário (dias 1 a 31) do mês selecionado.',
              'The Calendar maintains a fixed horizontal and vertical size:\n• Years: multi-year matrix (click any year label to open Months for that year, or double-click a cell to open Days).\n• Months: displays the 12 detailed monthly cards for the active year.\n• Days: displays the daily calendar (days 1 to 31) for the active month.',
            )}
          </MetricInfo>
        </div>
      </div>

      {/* Container de tamanho horizontal e vertical FIXO (w-full h-[380px]) */}
      <div className="mx-3 h-[380px] max-w-full overflow-x-auto overflow-y-auto rounded-xl border border-white/10 bg-[#070b12]/90 p-2.5">
        {viewLevel === 'years' && (
          <>
            {!data.calendar.length && (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-xs text-slate-400">
                <p>
                  {t(
                    'A matriz anual/mensal usa agrupamento mensal ou anual. Você pode explorar os meses ou os dias diretamente:',
                    'The multi-year matrix uses monthly or yearly aggregation. You can explore months or days directly:',
                  )}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setViewLevel('months')}
                    className="control-button border-orange-400/40 text-orange-200"
                  >
                    {t('Ir para Meses', 'Go to Months')} ({activeYear})
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewLevel('days')}
                    className="control-button border-orange-400/40 text-orange-200"
                  >
                    {t('Ir para Dias', 'Go to Days')} ({activeYear}-
                    {String(activeMonth).padStart(2, '0')})
                  </button>
                </div>
              </div>
            )}
            <table className="w-full min-w-[420px] table-fixed border-separate border-spacing-1 font-mono text-[10px]">
              <caption className="sr-only">
                {t('Calendário da seleção', 'Selection calendar')}
              </caption>
              <thead className="sticky top-0 z-10 bg-[#070b12]">
                <tr>
                  <th className="w-14 text-left font-normal text-slate-400">
                    {t('Ano', 'Year')}
                  </th>
                  {labels.map((month, i) => (
                    <th key={i} className="font-normal text-slate-400">
                      {month}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {years.map((year) => (
                  <tr key={year} className="hover:bg-white/[0.02]">
                    <th className="text-left font-normal text-slate-300">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveYear(year)
                          setViewLevel('months')
                        }}
                        title={t(
                          `Detalhar meses de ${year}`,
                          `Drill down into months of ${year}`,
                        )}
                        className="rounded px-1 py-0.5 text-left font-mono text-[10px] text-slate-300 underline decoration-slate-600 decoration-dotted hover:bg-orange-500/20 hover:text-orange-200"
                      >
                        {year}▸
                      </button>
                    </th>
                    {labels.map((_, i) => {
                      const row = byKey.get(`${year}-${i + 1}`)
                      const value = row?.[mode] ?? null
                      const month = `${year}-${String(i + 1).padStart(2, '0')}`
                      const label = `${month}: ${value == null ? t('sem dado', 'no data') : number(value)}`
                      return (
                        <td key={i}>
                          <button
                            className={`relative block h-4 w-full rounded-sm transition-transform hover:scale-105 ${
                              selectedMonth === month ? 'outline-2 outline-orange-300' : ''
                            } ${value == null ? 'border border-dashed border-slate-500' : ''}`}
                            type="button"
                            title={`${label} (${t('Clique: selecionar mês · Duplo clique: ver dias', 'Click: select month · Double-click: view days')})`}
                            aria-label={label}
                            onClick={() => {
                              setActiveYear(year)
                              setActiveMonth(i + 1)
                              onMonth(month)
                            }}
                            onDoubleClick={() => {
                              setActiveYear(year)
                              setActiveMonth(i + 1)
                              onMonth(month)
                              setViewLevel('days')
                            }}
                            style={{ background: value == null ? '#111827' : color(value) }}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {/* Linha de Climatologia 2003-2023 fixa no rodapé da matriz */}
                {data.calendar.length > 0 && (
                  <tr className="border-t border-slate-700/80">
                    <th className="pt-1 text-left font-mono text-[9px] font-semibold text-cyan-300">
                      <span className="inline-flex items-center">
                        <span>{t('Média', 'Mean')}</span>
                        <MetricInfo
                          term={t(
                            'Média Climatológica Sazonal (2003–2023)',
                            'Seasonal Climatological Mean (2003–2023)',
                          )}
                        >
                          {t(
                            'Representa o comportamento esperado (linha de base histórica de 2003 a 2023) para cada mês do ano neste recorte espacial. Serve de referência para o cálculo de Anomalia % e Z-score.',
                            'Represents the expected seasonal behavior (2003–2023 historical baseline) for each month of the year in this spatial selection. Used as the reference for Anomaly % and Z-score.',
                          )}
                        </MetricInfo>
                      </span>
                    </th>
                    {labels.map((_, i) => {
                      const climVal = climatologyByMonth.get(i + 1) ?? null
                      return (
                        <td key={i} className="pt-1">
                          <div
                            title={`${t('Média 2003–2023', '2003–2023 Mean')} (${labels[i]}): ${climVal == null ? '—' : number(climVal)}`}
                            className="h-3.5 w-full rounded-sm border border-cyan-500/30"
                            style={{
                              background:
                                climVal == null ? '#111827' : fireIntensityColor(climVal, max),
                            }}
                          />
                        </td>
                      )
                    })}
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}

        {viewLevel === 'months' && (
          <div className="flex h-full flex-col justify-between gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setViewLevel('years')}
                  className="control-button text-[11px]"
                >
                  ← {t('Todos os anos', 'All years')}
                </button>
                <span className="font-mono text-xs font-semibold text-orange-200">
                  {t('Ano selecionado:', 'Selected year:')} {activeYear}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={activeYear <= 2000}
                  onClick={() => setActiveYear((y) => Math.max(2000, y - 1))}
                  className="control-button px-2 py-1 font-mono text-xs disabled:opacity-40"
                >
                  ◀ {activeYear - 1}
                </button>
                <select
                  aria-label={t('Ano do calendário', 'Calendar year')}
                  value={activeYear}
                  onChange={(e) => setActiveYear(Number(e.target.value))}
                  className="rounded border border-white/20 bg-[#0f1623] px-2 py-1 font-mono text-xs text-slate-100"
                >
                  {Array.from({ length: 26 }, (_, i) => 2000 + i).map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={activeYear >= 2025}
                  onClick={() => setActiveYear((y) => Math.min(2025, y + 1))}
                  className="control-button px-2 py-1 font-mono text-xs disabled:opacity-40"
                >
                  {activeYear + 1} ▶
                </button>
              </div>
            </div>

            <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {labels.map((shortMonth, i) => {
                const mNum = i + 1
                const row = byKey.get(`${activeYear}-${mNum}`)
                const val = row?.[mode] ?? null
                const absVal = row?.value ?? null
                const baseVal = row?.baseline_mean ?? null
                const anomPct = row?.anomaly_pct ?? null
                const monthKey = `${activeYear}-${String(mNum).padStart(2, '0')}`
                const isSelected = selectedMonth === monthKey
                return (
                  <div
                    key={mNum}
                    onClick={() => {
                      setActiveMonth(mNum)
                      onMonth(monthKey)
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setActiveMonth(mNum)
                        onMonth(monthKey)
                      }
                    }}
                    className={`flex cursor-pointer flex-col justify-between rounded-lg border p-2.5 transition ${
                      isSelected
                        ? 'border-orange-400 bg-orange-500/15 shadow-sm'
                        : 'border-white/10 bg-[#0f1623]/90 hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono text-xs font-semibold capitalize text-slate-200">
                        {shortMonth} {activeYear}
                      </span>
                      <span
                        className="inline-block h-3 w-5 rounded-sm border border-white/20"
                        style={{ background: val == null ? '#111827' : color(val) }}
                      />
                    </div>
                    <div className="my-1">
                      <p className="font-mono text-sm font-semibold text-white">
                        {absVal == null ? '—' : number(absVal)}
                      </p>
                      <p className="font-mono text-[10px] text-slate-400">
                        {t('Média', 'Mean')}: {baseVal == null ? '—' : number(baseVal)} ·{' '}
                        <span
                          className={
                            anomPct != null && anomPct > 10
                              ? 'text-orange-300'
                              : anomPct != null && anomPct < -10
                                ? 'text-sky-300'
                                : 'text-slate-300'
                          }
                        >
                          {anomPct == null
                            ? '—'
                            : `${anomPct > 0 ? '+' : ''}${number(anomPct)}%`}
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setActiveMonth(mNum)
                        onMonth(monthKey)
                        setViewLevel('days')
                      }}
                      className="mt-1 w-full rounded border border-orange-400/30 bg-orange-500/10 py-1 font-mono text-[10px] text-orange-200 hover:bg-orange-500/25"
                    >
                      {t('Ver dias ▸', 'View days ▸')}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {viewLevel === 'days' && (
          <div className="flex h-full flex-col justify-between gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setViewLevel('years')}
                  className="control-button px-2 py-1 text-[11px]"
                >
                  {t('Anos', 'Years')}
                </button>
                <span className="text-slate-500">/</span>
                <button
                  type="button"
                  onClick={() => setViewLevel('months')}
                  className="control-button px-2 py-1 text-[11px]"
                >
                  {activeYear}
                </button>
                <span className="text-slate-500">/</span>
                <span className="font-mono text-xs font-semibold capitalize text-orange-200">
                  {fullMonthLabels[activeMonth - 1]} {activeYear}
                </span>
                {dayData && (
                  <MetricInfo
                    term={t('Fonte Diária do Calendário', 'Daily Calendar Data Source')}
                  >
                    {dayData.source === 'exact_daily'
                      ? t(
                          'Dados diários exatos extraídos diretamente das passagens orbitais diárias (YYYY-MM-DD) do país/células selecionadas.',
                          'Exact daily values extracted directly from the daily orbital passes (YYYY-MM-DD) for the selected country/cells.',
                        )
                      : t(
                          'Estimativa diária distribuída a partir das semanas ISO do cubo global para visualização rápida em escala planetária. Selecione um país para inspecionar a contagem diária exata.',
                          'Daily values distributed from the global cube ISO weeks for fast planetary-scale browsing. Select a country to inspect exact daily counts.',
                        )}
                  </MetricInfo>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => stepMonth(-1)}
                  className="control-button px-2 py-1 font-mono text-xs"
                >
                  ◀ {t('Mês ant.', 'Prev mo.')}
                </button>
                <button
                  type="button"
                  onClick={() => stepMonth(1)}
                  className="control-button px-2 py-1 font-mono text-xs"
                >
                  {t('Próx. mês', 'Next mo.')} ▶
                </button>
              </div>
            </div>

            {dayLoading ? (
              <div className="flex flex-1 items-center justify-center font-mono text-xs text-purple-200">
                {t('Carregando calendário diário…', 'Loading daily calendar…')}
              </div>
            ) : (
              <div className="flex-1">
                <div className="mb-1 grid grid-cols-7 gap-1 text-center font-mono text-[10px] text-slate-400">
                  {weekdayLabels.map((w) => (
                    <div key={w}>{w}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: dayData?.first_weekday ?? 0 }, (_, idx) => (
                    <div
                      key={`empty-${idx}`}
                      className="h-11 rounded border border-transparent bg-transparent"
                    />
                  ))}
                  {(dayData?.days ?? []).map((d) => {
                    const cellVal =
                      mode === 'value'
                        ? d.value
                        : mode === 'anomaly_pct'
                          ? d.anomaly_pct
                          : d.anomaly_zscore
                    const bg =
                      cellVal == null ? '#111827' : color(cellVal, maxDayVal)
                    return (
                      <button
                        key={d.date}
                        type="button"
                        onClick={() => {
                          onMonth(d.date.slice(0, 7))
                          onSelectDayRange?.(d.date)
                        }}
                        title={`${d.date}: ${d.value == null ? '0' : number(d.value)} (${
                          d.anomaly_pct == null
                            ? '—'
                            : `${d.anomaly_pct > 0 ? '+' : ''}${number(d.anomaly_pct)}%`
                        })`}
                        className="flex h-11 flex-col justify-between rounded border border-white/15 p-1 text-left font-mono transition hover:scale-[1.03] hover:border-orange-300"
                        style={{ background: bg }}
                      >
                        <span className="rounded bg-black/55 px-1 text-[9px] font-bold text-white">
                          {d.day}
                        </span>
                        <span className="truncate rounded bg-black/65 px-1 text-[9px] text-slate-100">
                          {d.value == null ? '—' : number(d.value, { notation: 'compact' })}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[11px] text-slate-400">
        <span>
          {mode === 'value'
            ? `${t('Branco → amarelo → laranja → vermelho', 'White → yellow → orange → red')}: 0 → ${number(viewLevel === 'days' ? maxDayVal : max)} · ${data.unit}`
            : t(
                'Azul: abaixo · cinza: próximo da média · laranja/vermelho: acima',
                'Blue: below · gray: near average · orange/red: above',
              )}
        </span>
        <span className="font-mono text-[10px] text-slate-400">
          {viewLevel === 'years'
            ? t(
                'Dica: clique no Ano (ex: 2025▸) para ver Meses ou dê duplo clique para Dias',
                'Tip: click a Year (e.g. 2025▸) for Months or double-click for Days',
              )
            : viewLevel === 'months'
              ? t(
                  'Clique em "Ver dias ▸" em qualquer mês para abrir o calendário diário',
                  'Click "View days ▸" on any month to open the daily calendar',
                )
              : t(
                  'Clique em um dia para focar o período',
                  'Click any day to focus that period',
                )}
        </span>
      </div>
    </Panel>
  )
}

export function SelectionForecast({
  data,
  loading,
  error,
  reference,
  onReference,
  filterEndDate,
  forecastMapHorizon = null,
  onForecastMapHorizonChange,
}: {
  data: ForecastSelection | null
  loading: boolean
  error: string
  reference: string
  onReference: (value: string) => void
  filterEndDate?: string
  forecastMapHorizon?: number | null
  onForecastMapHorizonChange?: (horizon: number | null) => void
}) {
  const { t, number, date } = useI18n()

  const shiftReferenceWeek = (weeksDelta: number) => {
    const base = new Date(`${reference || '2025-12-22'}T00:00:00Z`)
    if (Number.isNaN(base.getTime())) return
    base.setUTCDate(base.getUTCDate() + weeksDelta * 7)
    const minD = new Date('2024-01-01T00:00:00Z')
    const maxD = new Date('2026-12-31T00:00:00Z')
    const clamped = base < minD ? minD : base > maxD ? maxD : base
    onReference(clamped.toISOString().slice(0, 10))
  }

  const chartSeries = useMemo(() => {
    if (!data?.available) return []
    const rows: Array<{
      label: string
      fullDate: string
      observed: number | null
      forecast: number | null
      baseline: number | null
      actualAfter?: number | null
    }> = []

    const recent = data.recent_observed ?? []
    for (const r of recent) {
      rows.push({
        label: r.offset === 0 ? `t (${r.period.slice(5)})` : `t${r.offset} (${r.period.slice(5)})`,
        fullDate: r.period,
        observed: r.value,
        forecast: r.offset === 0 ? r.value : null,
        baseline: r.baseline,
        actualAfter: null,
      })
    }

    for (const f of data.forecasts ?? []) {
      const shortTarget = f.target_date ? f.target_date.slice(5) : `+${f.horizon}w`
      rows.push({
        label: `t+${f.horizon} (${shortTarget})`,
        fullDate: f.target_date ?? `t+${f.horizon}`,
        observed: null,
        forecast: f.value,
        baseline: f.baseline,
        actualAfter: f.actual ?? null,
      })
    }
    return rows
  }, [data])

  const obsObj =
    data?.observed && typeof data.observed === 'object' ? data.observed : null

  const riskBadge = useMemo(() => {
    const risk = data?.risk_level
    if (risk === 'CRITICO') {
      return {
        label: t('🔴 ALERTA CRÍTICO (> +25% vs F₀)', '🔴 CRITICAL ALERT (> +25% vs F₀)'),
        cls: 'border-red-400/50 bg-red-500/20 text-red-200',
      }
    }
    if (risk === 'ATENCAO') {
      return {
        label: t('🟡 ATENÇÃO (Acima da Climatologia)', '🟡 WATCH (Above Climatology)'),
        cls: 'border-amber-400/50 bg-amber-500/20 text-amber-200',
      }
    }
    return {
      label: t('🟢 NORMAL (Dentro/Abaixo da Climatologia)', '🟢 NORMAL (Within/Below Climatology)'),
      cls: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200',
    }
  }, [data?.risk_level, t])

  return (
    <Panel
      eyebrow={t('Projeção experimental da seleção', 'Experimental selection forecast')}
      title={t('F₂ com referência temporal comum', 'F₂ with a shared reference date')}
      info={t(
        'Alternativa adotada: recalcular cada célula com a mesma semana t e somar previsões absolutas compatíveis. As porcentagens são recalculadas sobre os totais de previsão e climatologia. Onde a telemetria não sustenta F₂, usar climatologia F₀ explicitamente. Não são somados os snapshots legados com semanas distintas, nem fabricadas temperaturas. O modelo mantém os sensores do treinamento; os filtros observacionais de sensores não alteram suas entradas.',
        'Chosen alternative: recompute each cell at the same reference week t and add compatible absolute forecasts. Percentages are recalculated from forecast and climatology totals. Where telemetry does not support F₂, use explicitly labeled F₀ climatology. Legacy snapshots with different reference weeks are not added, and temperatures are not fabricated.',
      )}
    >
      <div className="space-y-4 px-4 pb-4">
        {/* Linha 1: Seletor de Data de Referência + Botões de avanço semanal + Presets */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#070b12]/80 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
              {t('Semana de referência', 'Reference week')}
              <input
                aria-label={t('Referência F2', 'F2 reference')}
                className="rounded-lg border border-white/20 bg-[#0f1623] px-3 py-1.5 font-mono text-xs text-white"
                type="date"
                min="2024-01-01"
                max="2026-12-31"
                value={reference}
                onChange={(e) => {
                  if (e.target.value) onReference(e.target.value)
                }}
              />
            </label>
            <MetricInfo
              term={t('Semana de Referência (t) da Previsão', 'Forecast Reference Week (t)')}
            >
              {t(
                'Define o ponto de partida (semana t) a partir do qual o modelo F₂ projeta as 4 semanas seguintes (t+1, t+2, t+3 e t+4). Você pode escolher qualquer data entre 2024 e 2026 (em 2024–2025 é possível comparar a previsão com o valor que realmente ocorreu; em 2026 o modelo projeta o ciclo sazonal futuro usando a última telemetria física consolidada).',
                'Sets the starting week (t) from which the F₂ model projects the next 4 weeks (t+1, t+2, t+3, and t+4). Pick any date between 2024 and 2026 (in 2024–2025 you can backtest predictions against actual observed values; in 2026 the model projects the upcoming seasonal cycle).',
              )}
            </MetricInfo>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => shiftReferenceWeek(-1)}
                className="control-button px-2 py-1 font-mono text-[11px]"
                title={t('Recuar 1 semana', 'Step back 1 week')}
              >
                ◀ -1 {t('sem', 'wk')}
              </button>
              <button
                type="button"
                onClick={() => shiftReferenceWeek(1)}
                className="control-button px-2 py-1 font-mono text-[11px]"
                title={t('Avançar 1 semana', 'Step forward 1 week')}
              >
                +1 {t('sem', 'wk')} ▶
              </button>
            </div>
          </div>

          {/* Presets rápidos de data para a previsão */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              {
                id: 'cur2026',
                labelPt: '📅 Ciclo 2026 (Nov/2026)',
                labelEn: '📅 2026 Cycle (Nov/2026)',
                val: '2026-11-15',
              },
              {
                id: 'peak2026',
                labelPt: '🔥 Pico Sazonal (Set/2026)',
                labelEn: '🔥 Peak Season (Sep/2026)',
                val: '2026-09-14',
              },
              {
                id: 'last2025',
                labelPt: '📊 Última Observada (Dez/2025)',
                labelEn: '📊 Last Observed (Dec/2025)',
                val: '2025-12-22',
              },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onReference(p.val)}
                className={`rounded border px-2 py-1 font-mono text-[10px] transition ${
                  reference === p.val
                    ? 'border-purple-400 bg-purple-500/25 text-white'
                    : 'border-white/10 bg-[#0f1623] text-slate-300 hover:border-white/25'
                }`}
              >
                {t(p.labelPt, p.labelEn)}
              </button>
            ))}
            {filterEndDate && filterEndDate >= '2024-01-01' && (
              <button
                type="button"
                onClick={() => onReference(filterEndDate)}
                className="rounded border border-cyan-400/40 bg-cyan-500/15 px-2 py-1 font-mono text-[10px] text-cyan-200 hover:bg-cyan-500/25"
              >
                🔗 {t('Usar data do filtro', 'Use filter end date')} ({filterEndDate})
              </button>
            )}
          </div>
        </div>

        {loading && (
          <p role="status" className="text-xs text-purple-200">
            {t(
              'Recalculando a seleção na mesma semana…',
              'Recomputing the selection at the same reference week…',
            )}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-amber-200">
            {error}
          </p>
        )}
        {!loading && data && !data.available && (
          <p className="text-sm text-amber-200">
            {data.reason ??
              t('Dados insuficientes para esta referência.', 'Insufficient data for this reference.')}
          </p>
        )}

        {!loading && data?.available && (
          <>
            {/* Linha 2: Status da Referência + Nível de Alerta + Botão de Projeção no Mapa */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-slate-300">
                <span className="inline-flex items-center">
                  <span>
                    {t('Referência efetiva', 'Effective reference')}: {date(data.reference_date)}
                    {data.period_end ? ` → ${date(data.period_end)}` : ''}
                  </span>
                  <MetricInfo
                    term={t('Referência Efetiva (Semana ISO)', 'Effective Reference (ISO Week)')}
                  >
                    {t(
                      'A previsão opera em semanas ISO completas (segunda a domingo). Qualquer data escolhida é alinhada à segunda-feira da respectiva semana ISO para garantir que todas as células de 1° sejam avaliadas exatamente no mesmo corte temporal.',
                      'The forecast operates on full ISO weeks (Monday to Sunday). Any chosen date is aligned to the Monday of its ISO week so every 1° cell is evaluated on the exact same temporal slice.',
                    )}
                  </MetricInfo>
                </span>
                <span>·</span>
                <span className="inline-flex items-center">
                  <span>
                    {t('Células processadas', 'Processed cells')}:{' '}
                    {number(data.coverage.processed_count)} / {number(data.coverage.selected_count)}
                  </span>
                  <MetricInfo
                    term={t('Células Processadas vs Selecionadas', 'Processed vs Selected Cells')}
                  >
                    {t(
                      'Mostra quantas células terrestres de 1°×1° do país ou recorte atual possuem série histórica suficiente (mínimo de 3 anos de cobertura na base 2012–2023) para gerar previsão válida.',
                      'Shows how many 1°×1° land cells in the current country or selection have sufficient historical coverage (at least 3 years in the 2012–2023 baseline) to produce a valid forecast.',
                    )}
                  </MetricInfo>
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${riskBadge.cls}`}
                >
                  <span>{riskBadge.label}</span>
                  <MetricInfo
                    term={t('Nível de Alerta da Projeção', 'Forecast Alert Level')}
                  >
                    {t(
                      'Classifica o pico de anomalia previsto nas próximas 4 semanas frente à Climatologia F₀:\n• 🟢 NORMAL: previsão dentro da média ou abaixo de +5%.\n• 🟡 ATENÇÃO: previsão entre +5% e +25% acima da climatologia.\n• 🔴 CRÍTICO: previsão supera em mais de +25% o normal sazonal.',
                      'Classifies the peak predicted anomaly over the next 4 weeks against F₀ Climatology:\n• 🟢 NORMAL: forecast within or below +5% of baseline.\n• 🟡 WATCH: forecast between +5% and +25% above baseline.\n• 🔴 CRITICAL: forecast exceeds seasonal baseline by more than +25%.',
                    )}
                  </MetricInfo>
                </span>
              </div>

              {/* Conversa direta com o Mapa 2D / Globo 3D */}
              {onForecastMapHorizonChange && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      onForecastMapHorizonChange(forecastMapHorizon ? null : 1)
                    }
                    className={`rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold transition ${
                      forecastMapHorizon
                        ? 'border-orange-400 bg-orange-500/30 text-white shadow-md'
                        : 'border-purple-400/50 bg-purple-500/20 text-purple-100 hover:bg-purple-500/30'
                    }`}
                  >
                    {forecastMapHorizon
                      ? `🗺️ ${t(`Mapa exibindo Previsão t+${forecastMapHorizon} (Sair)`, `Map showing Forecast t+${forecastMapHorizon} (Exit)`)}`
                      : `🗺️ ${t('Projetar Previsão no Mapa', 'Project Forecast on Map')}`}
                  </button>
                  <MetricInfo
                    align="right"
                    term={t(
                      'Integração Direta Previsão ↔ Mapa 2D/3D',
                      'Direct Forecast ↔ 2D/3D Map Integration',
                    )}
                  >
                    {t(
                      'Ao ativar "Projetar Previsão no Mapa" ou clicar em qualquer um dos cartões t+1 a t+4 abaixo, o Globo 3D / Mapa 2D passa a exibir espacialmente a intensidade prevista em cada célula de 1°×1° para aquela semana futura. Selecionar outro país ou área no mapa também recalcula esta previsão automaticamente.',
                      'When you toggle "Project Forecast on Map" or click any t+1 to t+4 card below, the 3D Globe / 2D Map switches to spatially render the predicted intensity of every 1°×1° cell for that future week. Selecting another country or area on the map also recalculates this forecast automatically.',
                    )}
                  </MetricInfo>
                </div>
              )}
            </div>

            {/* Linha 3: 4 Cartões de Horizonte (t+1, t+2, t+3, t+4) interativos com o Mapa */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {data.forecasts.map((point) => {
                const isMapActive = forecastMapHorizon === point.horizon
                return (
                  <div
                    key={point.horizon}
                    onClick={() =>
                      onForecastMapHorizonChange?.(
                        isMapActive ? null : point.horizon,
                      )
                    }
                    role={onForecastMapHorizonChange ? 'button' : undefined}
                    tabIndex={onForecastMapHorizonChange ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (
                        onForecastMapHorizonChange &&
                        (e.key === 'Enter' || e.key === ' ')
                      ) {
                        onForecastMapHorizonChange(isMapActive ? null : point.horizon)
                      }
                    }}
                    className={`cursor-pointer rounded-xl border p-3 transition ${
                      isMapActive
                        ? 'border-orange-400 bg-orange-500/20 ring-1 ring-orange-400/50'
                        : 'border-purple-300/20 bg-purple-500/10 hover:border-purple-300/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono text-[11px] font-semibold text-slate-300">
                        t+{point.horizon} {t('sem.', 'wk')}
                      </span>
                      <MetricInfo
                        term={`${t('Horizonte de Previsão', 'Forecast Horizon')} t+${point.horizon} (${point.target_date ?? ''})`}
                      >
                        {t(
                          `Projeção para ${point.horizon} semana(s) após a semana de referência (${point.target_date ?? ''}).\n• Valor principal: Índice de Atividade Harmonizada previsto pelo modelo multivariado Ridge L₂ (F₂).\n• %: Anomalia prevista em relação ao esperado sazonalmente ((F₂ − F₀) / F₀ × 100).\n• F₀: Média histórica sazonal (2012–2023) para essa mesma semana.\nClique no cartão para projetar esta semana no Mapa 2D/3D!`,
                          `Projection for ${point.horizon} week(s) after the reference week (${point.target_date ?? ''}).\n• Main number: Harmonized Activity Index predicted by the multivariate Ridge L₂ model (F₂).\n• %: Predicted anomaly against seasonal baseline ((F₂ − F₀) / F₀ × 100).\n• F₀: Seasonal historical baseline (2012–2023) for that exact ISO week.\nClick this card to project this week onto the 2D/3D Map!`,
                        )}
                      </MetricInfo>
                    </div>
                    <p className="mt-1 font-mono text-lg font-bold text-purple-100">
                      {number(point.value)}
                    </p>
                    <p
                      className={`mt-0.5 font-mono text-xs font-semibold ${
                        point.anomaly_pct != null && point.anomaly_pct > 10
                          ? 'text-orange-300'
                          : point.anomaly_pct != null && point.anomaly_pct < -10
                            ? 'text-sky-300'
                            : 'text-slate-300'
                      }`}
                    >
                      {point.anomaly_pct == null
                        ? '—'
                        : `${point.anomaly_pct > 0 ? '+' : ''}${number(point.anomaly_pct)}% vs F₀`}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-slate-400">
                      F₀ ({t('Climatologia', 'Climatology')}): {number(point.baseline)}
                    </p>
                    {point.actual != null && !data.is_future_cycle && (
                      <p className="mt-0.5 font-mono text-[10px] text-emerald-300">
                        {t('Real observado', 'Actual observed')}: {number(point.actual)}
                      </p>
                    )}
                    <div className="mt-1.5 flex items-center justify-between border-t border-white/10 pt-1 font-mono text-[10px] text-slate-400">
                      <span>{point.target_date ? date(point.target_date) : ''}</span>
                      <span className="text-orange-300">
                        {isMapActive
                          ? t('📍 No mapa', '📍 On map')
                          : t('Ver no mapa ▸', 'Show on map ▸')}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Linha 4: Gráfico Visual da Trajetória (Observado t-3..t -> Previsão F2 t+1..t+4 vs Climatologia F0) */}
            {chartSeries.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-[#070b12]/90 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1 font-mono text-xs font-semibold text-slate-200">
                    <span>
                      {t(
                        'Trajetória Recente (t−3..t) e Projeção F₂ (t+1..t+4) vs Climatologia F₀',
                        'Recent Trajectory (t−3..t) & F₂ Projection (t+1..t+4) vs F₀ Climatology',
                      )}
                    </span>
                    <MetricInfo
                      term={t(
                        'Curva de Transição Observado → Previsão F₂',
                        'Observed → F₂ Forecast Transition Curve',
                      )}
                    >
                      {t(
                        'Mostra as últimas 4 semanas observadas antes da referência (t−3 até t, em azul) conectadas às 4 semanas previstas pelo modelo F₂ (t+1 até t+4, em laranja), comparadas com a curva sazonal esperada F₀ (tracejada). Quando você seleciona uma data histórica em 2024–2025, a linha verde mostra o que realmente ocorreu nas semanas seguintes para validar o acerto do modelo.',
                        'Displays the last 4 observed weeks up to the reference date (t−3 to t, in cyan) connected to the 4 predicted weeks from model F₂ (t+1 to t+4, in orange), compared against the seasonal baseline F₀ (dashed). When backtesting a historical date in 2024–2025, the green curve shows what actually happened in the following weeks.',
                      )}
                    </MetricInfo>
                  </span>
                  {data.is_future_cycle && data.telemetry_reference_date && (
                    <span className="rounded border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] text-cyan-200">
                      {t(
                        `Ciclo sazonal projetado com telemetria base de ${data.telemetry_reference_date}`,
                        `Seasonal cycle projected using base telemetry from ${data.telemetry_reference_date}`,
                      )}
                    </span>
                  )}
                </div>
                <div className="h-[210px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chartSeries}
                      margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
                    >
                      <CartesianGrid stroke="#ffffff0d" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: '#94a3b8', fontSize: 10 }}
                      />
                      <YAxis
                        width={52}
                        tick={{ fill: '#94a3b8', fontSize: 10 }}
                        tickFormatter={(v: number) => number(v, { notation: 'compact' })}
                      />
                      <Tooltip
                        formatter={(val) =>
                          typeof val === 'number' ? number(val) : val
                        }
                        contentStyle={{
                          background: '#0f1623',
                          border: '1px solid #334155',
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line
                        type="monotone"
                        dataKey="baseline"
                        name={t('Climatologia F₀ (2012–2023)', 'F₀ Climatology (2012–2023)')}
                        stroke="#94a3b8"
                        strokeDasharray="4 4"
                        strokeWidth={1.5}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="observed"
                        name={t('Observado (t−3 a t)', 'Observed (t−3 to t)')}
                        stroke="#38bdf8"
                        strokeWidth={2.2}
                        dot={{ r: 3 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="forecast"
                        name={t('Previsão F₂ (t+1 a t+4)', 'F₂ Forecast (t+1 to t+4)')}
                        stroke="#f97316"
                        strokeWidth={2.5}
                        dot={{ r: 4 }}
                      />
                      {!data.is_future_cycle && (
                        <Line
                          type="monotone"
                          dataKey="actualAfter"
                          name={t(
                            'Real Observado (Backtest)',
                            'Actual Observed (Backtest)',
                          )}
                          stroke="#34d399"
                          strokeWidth={1.8}
                          strokeDasharray="2 2"
                          dot={{ r: 3 }}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Linha 5: Drivers Físicos Observados na Semana de Referência (t) */}
            {obsObj && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <div className="rounded-lg border border-white/10 bg-[#070b12]/70 p-2.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>{t('Índice Observado (t)', 'Observed Index (t)')}</span>
                    <MetricInfo
                      term={t(
                        'Índice de Atividade na Semana t',
                        'Activity Index in Week t',
                      )}
                    >
                      {t(
                        'Total do índice de atividade térmica harmonizada observado na semana de referência (t), usado como preditor autoregressivo principal do modelo F₂.',
                        'Total harmonized thermal activity index observed during reference week (t), used as the primary autoregressive predictor in model F₂.',
                      )}
                    </MetricInfo>
                  </div>
                  <p className="mt-1 font-mono text-sm font-semibold text-sky-200">
                    {number(obsObj.value)}
                  </p>
                </div>

                <div className="rounded-lg border border-white/10 bg-[#070b12]/70 p-2.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>{t('FRP na Semana t', 'FRP in Week t')}</span>
                    <MetricInfo
                      term={t(
                        'FRP Observado na Referência (MW)',
                        'Reference Week Observed FRP (MW)',
                      )}
                    >
                      {t(
                        'Soma da Potência Radiativa do Fogo (em Megawatts) medida na semana t. Incêndios com alto FRP liberam mais energia térmica e tendem a persistir nas semanas seguintes.',
                        'Sum of Fire Radiative Power (in Megawatts) measured in week t. High-FRP fires release greater radiant energy and tend to persist into subsequent weeks.',
                      )}
                    </MetricInfo>
                  </div>
                  <p className="mt-1 font-mono text-sm font-semibold text-orange-200">
                    {number(obsObj.frp_sum_mw)} MW
                  </p>
                </div>

                <div className="rounded-lg border border-white/10 bg-[#070b12]/70 p-2.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>{t('Contraste ΔT (K)', 'Thermal ΔT (K)')}</span>
                    <MetricInfo
                      term={t(
                        'Contraste Térmico Médio ΔT (Kelvin)',
                        'Mean Thermal Contrast ΔT (Kelvin)',
                      )}
                    >
                      {t(
                        'Diferença média (em Kelvin) entre a temperatura de brilho do canal infravermelho médio (~4 µm) e a janela térmica de fundo (~11 µm) nas células ativas.',
                        'Mean difference (in Kelvin) between the mid-infrared brightness temperature (~4 µm) and the thermal background window (~11 µm) across active cells.',
                      )}
                    </MetricInfo>
                  </div>
                  <p className="mt-1 font-mono text-sm font-semibold text-amber-200">
                    {obsObj.delta_t_k == null ? '—' : `${number(obsObj.delta_t_k)} K`}
                  </p>
                </div>

                <div className="rounded-lg border border-white/10 bg-[#070b12]/70 p-2.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>{t('Detecções Sub-pixel', 'Sub-pixel Detections')}</span>
                    <MetricInfo
                      term={t(
                        'Detecções Sub-pixel na Semana t',
                        'Sub-pixel Detections in Week t',
                      )}
                    >
                      {t(
                        'Total de passagens orbitais ativas registradas na semana de referência antes da consolidação por célula de 1 km.',
                        'Total active orbital satellite passes recorded during the reference week prior to 1 km cell consolidation.',
                      )}
                    </MetricInfo>
                  </div>
                  <p className="mt-1 font-mono text-sm font-semibold text-slate-200">
                    {number(obsObj.merged_count)}
                  </p>
                </div>

                <div className="rounded-lg border border-white/10 bg-[#070b12]/70 p-2.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>{t('Fração Noturna', 'Night Fraction')}</span>
                    <MetricInfo
                      align="right"
                      term={t(
                        'Fração de Detecções Noturnas (%)',
                        'Nighttime Detection Fraction (%)',
                      )}
                    >
                      {t(
                        'Proporção de focos detectados durante passagens noturnas do satélite. Queimadas que permanecem ativas à noite (quando a umidade sobe e a temperatura cai) indicam frentes de fogo mais intensas e persistentes.',
                        'Percentage of detections captured during nighttime satellite passes. Fires that remain active at night (when humidity rises and temperature drops) indicate more persistent fire fronts.',
                      )}
                    </MetricInfo>
                  </div>
                  <p className="mt-1 font-mono text-sm font-semibold text-purple-200">
                    {obsObj.night_ratio == null
                      ? '—'
                      : `${number(obsObj.night_ratio * 100)}%`}
                  </p>
                </div>
              </div>
            )}

            {/* Linha 6: Diagnóstico de Cobertura e Metadados com (i) */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
              <span className="inline-flex items-center">
                <span>
                  {t('Células sem dados', 'Cells without data')}:{' '}
                  {number(data.coverage.missing_count)}
                </span>
                <MetricInfo
                  term={t(
                    'Células sem Dados Suficientes',
                    'Cells Without Sufficient Data',
                  )}
                >
                  {t(
                    'Células terrestres de 1°×1° dentro do recorte que tiveram menos de 3 anos de atividade registrada no período base 2012–2023 (ex.: desertos hiperáridos ou geleiras sem histórico de fogo).',
                    '1°×1° land cells inside the selection that had fewer than 3 years of recorded activity during the 2012–2023 baseline (e.g., hyper-arid deserts or glaciers with no fire history).',
                  )}
                </MetricInfo>
              </span>
              <span className="inline-flex items-center">
                <span>
                  {t('Imputações físicas', 'Physical imputations')}:{' '}
                  {number(data.coverage.imputed_count)}
                </span>
                <MetricInfo
                  term={t('Imputações Físicas (Zero Imputado)', 'Physical Imputations')}
                >
                  {t(
                    'Sempre igual a 0 nesta arquitetura: o sistema jamais fabrica temperaturas de brilho ou FRP artificiais quando uma célula não teve focos na semana t.',
                    'Always 0 in this architecture: the system never fabricates synthetic brightness temperatures or FRP when a cell had no active fires in week t.',
                  )}
                </MetricInfo>
              </span>
              <span className="inline-flex items-center">
                <span>
                  F₂: {number(data.coverage.f2_count ?? 0)} ·{' '}
                  {t('Climatologia F₀ de apoio', 'F₀ climatology fallback')}:{' '}
                  {number(data.coverage.fallback_count ?? 0)}
                </span>
                <MetricInfo
                  term={t(
                    'Células com Modelo F₂ vs Climatologia F₀ de Apoio',
                    'F₂ Model Cells vs F₀ Climatology Fallback',
                  )}
                >
                  {t(
                    '• F₂: Células com fogo ativo e telemetria térmica completa na semana t, onde o modelo multivariado Ridge L₂ (6 variáveis físicas) é aplicado.\n• Climatologia F₀ de apoio: Células sem passagens ativas na semana t, onde a previsão usa explicitamente a média sazonal histórica 2012–2023 (F₀) em vez de inventar temperaturas.',
                    '• F₂: Cells with active fire and complete thermal telemetry in week t, evaluated via the 6-feature Ridge L₂ multivariate model.\n• F₀ climatology fallback: Cells with zero active passes in week t, where the forecast explicitly uses the 2012–2023 seasonal baseline (F₀) rather than fabricating temperatures.',
                  )}
                </MetricInfo>
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              {t(
                'Unidade: índice de atividade harmonizada. Resultado experimental da seleção; sem validação local herdada.',
                'Unit: harmonized activity index. Experimental selection result; no inherited local validation.',
              )}
            </p>
            {data.provenance && <InfoText text={data.provenance} />}
            {data.notices?.map((text) => <InfoText key={text} text={text} />)}
          </>
        )}
      </div>
    </Panel>
  )
}

function InfoText({ text }: { text: string }) {
  const { t } = useI18n()
  return (
    <details className="rounded-lg border border-slate-700 p-2 text-xs text-slate-300">
      <summary className="cursor-pointer">
        ⓘ {t('Método e cobertura', 'Method and coverage')}
      </summary>
      <p className="mt-2 leading-relaxed">{text}</p>
    </details>
  )
}
