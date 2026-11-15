import { useMemo, useState } from 'react'
import { LanguageSelector, useI18n } from '../../i18n'
import type { Country, MapMode, Query } from '../../types/exploration'
import { InfoToggle } from './InfoToggle'

const DATE_PRESETS = [
  { id: '1m', labelPt: '1M (Dez 2025)', labelEn: '1M (Dec 2025)', start: '2025-12-01', end: '2025-12-31' },
  { id: '3m', labelPt: '3M (Out–Dez 2025)', labelEn: '3M (Q4 2025)', start: '2025-10-01', end: '2025-12-31' },
  { id: '6m', labelPt: '6M (Jul–Dez 2025)', labelEn: '6M (H2 2025)', start: '2025-07-01', end: '2025-12-31' },
  { id: '1y', labelPt: 'Ano 2025', labelEn: '1Y (2025)', start: '2025-01-01', end: '2025-12-31' },
  { id: '5y', labelPt: '5A (2021–2025)', labelEn: '5Y (2021–2025)', start: '2021-01-01', end: '2025-12-31' },
  { id: 'all', labelPt: 'Tudo (2000–2025)', labelEn: 'All (2000–2025)', start: '2000-01-01', end: '2025-12-31' },
] as const

export function ExplorerControls({
  query,
  countries,
  onChange,
  mode,
  onMode,
  year,
  yearB,
  onYear,
  onYearB,
  compare,
  onCompare,
  selectionMode,
  onSelectionMode,
  selectedCount,
  onClear,
  onUndo,
  onCoordinate,
  onExport,
  canExport,
  exportLoading = false,
  pendingExport = false,
  countryLabel,
  gpsActive = false,
}: {
  query: Query
  countries: Country[]
  onChange: (next: Query) => void
  mode: MapMode
  onMode: (mode: MapMode) => void
  year: number
  yearB: number
  onYear: (year: number) => void
  onYearB: (year: number) => void
  compare: boolean
  onCompare: (value: boolean) => void
  selectionMode: boolean
  onSelectionMode: (value: boolean) => void
  selectedCount: number
  onClear: () => void
  onUndo: () => void
  onCoordinate: (lat: number, lon: number, isGps?: boolean) => void
  onExport: () => void
  canExport: boolean
  exportLoading?: boolean
  pendingExport?: boolean
  countryLabel: (country: Country) => string
  gpsActive?: boolean
}) {
  const { t, number } = useI18n()
  const [search, setSearch] = useState('')
  const [lat, setLat] = useState('0')
  const [lon, setLon] = useState('0')
  const [gpsError, setGpsError] = useState('')
  const [gpsLoading, setGpsLoading] = useState(false)
  const choices = useMemo(() => countries.filter((c) => `${countryLabel(c)} ${c.name} ${c.id}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [countries, countryLabel, search])
  const field = 'w-full min-w-0 rounded-lg border border-white/15 bg-[#070b12] px-3 py-2 text-sm text-slate-100'
  const update = (changes: Partial<Query>) => onChange({ ...query, ...changes })
  const years = Array.from({ length: 26 }, (_, i) => 2000 + i)
  const labels = [t('Jan', 'Jan'), t('Fev', 'Feb'), t('Mar', 'Mar'), t('Abr', 'Apr'), t('Mai', 'May'), t('Jun', 'Jun'), t('Jul', 'Jul'), t('Ago', 'Aug'), t('Set', 'Sep'), t('Out', 'Oct'), t('Nov', 'Nov'), t('Dez', 'Dec')]

  function gps() {
    if (!navigator.geolocation) { setGpsError(t('GPS indisponível.', 'GPS unavailable.')); return }
    setGpsError('')
    setGpsLoading(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGpsLoading(false)
        const latitude = Number(p.coords.latitude.toFixed(4))
        const longitude = Number(p.coords.longitude.toFixed(4))
        setLat(String(latitude))
        setLon(String(longitude))
        onCoordinate(latitude, longitude, true)
      },
      () => {
        setGpsLoading(false)
        setGpsError(t('Localização não autorizada ou indisponível.', 'Location was denied or unavailable.'))
      },
      { timeout: 10000 },
    )
  }

  return <section className="rounded-2xl border border-white/10 bg-[#0f1623] p-4">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-mono text-[10px] tracking-[0.2em] text-orange-300">NASA FIRMS · 2000–2025 · BRIGHTNESS ANOMALY TRACKER</p>
        <h1 className="text-xl font-semibold tracking-tight">BAT — Brightness Anomaly Tracker</h1>
      </div>
      <LanguageSelector />
    </div>
    <div className="grid gap-4 lg:grid-cols-3 xl:grid-cols-4">
      <div className="space-y-2">
        <label className="block text-xs text-slate-400">{t('Pesquisar país / território', 'Search country / territory')}
          <input aria-label={t('Pesquisar país', 'Search country')} type="search" className={`${field} mt-1`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Nome ou alias da fonte', 'Name or source alias')} />
        </label>
        <div className="flex gap-2">
          <select aria-label={t('País / território', 'Country / territory')} className={field} value={query.country ?? ''} onChange={(e) => update({ country: e.target.value || null, point_ids: [] })}>
            <option value="">{t('Mundo', 'World')}</option>
            {choices.map((c) => <option key={c.id} value={c.id}>{countryLabel(c)}</option>)}
            {query.country && !choices.some((c) => c.id === query.country) && <option value={query.country}>{countryLabel(countries.find((c) => c.id === query.country) ?? { id: query.country, name: query.country })}</option>}
          </select>
          {query.country && (
            <button type="button" onClick={() => update({ country: null, point_ids: [] })} className="control-button shrink-0 border-cyan-400/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25" title={t('Mostrar todos os países do mundo', 'Show all countries in the world')}>
              {t('🌎 Mundo', '🌎 World')}
            </button>
          )}
        </div>
        {choices.length === 0 && <p className="text-xs text-amber-200">{t('Nenhuma correspondência.', 'No matches.')}</p>}
        <InfoToggle label={t('Informações: país e seleção', 'Information: country and selection')}>{t('Clique em um ponto para selecionar sua célula de 1°. Use Ctrl+Clique em um ponto para selecionar o país daquele ponto. Clicar em Mundo remove a seleção de país e exibe todos os países.', 'Click a point to select its 1° cell. Use Ctrl+Click on a point to select that point’s country. Clicking World clears the country selection and displays all countries.')}</InfoToggle>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-slate-400">{t('Período (Mapa, Gráficos e CSV)', 'Date range (Map, Charts & CSV)')}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {DATE_PRESETS.map((preset) => {
            const active = query.start_date === preset.start && query.end_date === preset.end
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                onClick={() => update({ start_date: preset.start, end_date: preset.end })}
                className={`rounded border px-2 py-1 font-mono text-[10px] transition ${active ? 'border-orange-400 bg-orange-500/25 text-white' : 'border-white/10 bg-[#070b12] text-slate-300 hover:border-white/25'}`}
              >
                {t(preset.labelPt, preset.labelEn)}
              </button>
            )
          })}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-400">{t('De', 'From')}
            <input className={field} aria-label={t('Data inicial', 'Start date')} type="date" min="2000-01-01" max="2025-12-31" value={query.start_date} onChange={(e) => { if (e.target.value) update({ start_date: e.target.value }) }} />
          </label>
          <label className="text-xs text-slate-400">{t('Até', 'To')}
            <input className={field} aria-label={t('Data final', 'End date')} type="date" min="2000-01-01" max="2025-12-31" value={query.end_date} onChange={(e) => { if (e.target.value) update({ end_date: e.target.value }) }} />
          </label>
        </div>
        <label className="block text-xs text-slate-400">{t('Agrupamento', 'Aggregation')}
          <select aria-label={t('Agrupamento', 'Aggregation')} className={`${field} mt-1`} value={query.resolution} onChange={(e) => update({ resolution: e.target.value as Query['resolution'] })}>
            <option value="monthly">{t('Mensal', 'Monthly')}</option>
            <option value="yearly">{t('Anual', 'Yearly')}</option>
            <option value="weekly">{t('Semanal', 'Weekly')}</option>
            <option value="daily">{t('Diário (fonte original)', 'Daily (original source)')}</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-1">{labels.map((label, i) => <button key={i} type="button" aria-pressed={query.months.includes(i + 1)} className={`rounded border px-1.5 py-1 text-[10px] ${query.months.includes(i + 1) ? 'border-purple-300 bg-purple-500/25 text-white' : 'border-white/10 text-slate-400'}`} onClick={() => update({ months: query.months.includes(i + 1) ? query.months.filter((m) => m !== i + 1) : [...query.months, i + 1].sort((a, b) => a - b) })}>{label}</button>)}</div>
        <p className="text-[10px] text-slate-400">{t('Nenhum mês marcado = todos os meses.', 'No month selected = all months.')}</p>
      </div>
      <div className="space-y-2">
        <label className="block text-xs text-slate-400">{t('Métrica', 'Metric')}
          <select aria-label={t('Métrica', 'Metric')} className={`${field} mt-1`} value={query.metric} onChange={(e) => update({ metric: e.target.value as Query['metric'] })}>
            <option value="records">{t('Registros de células por sensor', 'Cell records by sensor')}</option>
            <option value="detections">{t('Detecções agrupadas', 'Merged detections')}</option>
            <option value="frp">{t('Soma de FRP registrada', 'Recorded FRP sum')}</option>
          </select>
        </label>
        <fieldset className="space-y-1"><legend className="mb-1 text-xs text-slate-400">{t('Sensores', 'Sensors')}</legend>{[['modis', 'MODIS'], ['viirs-snpp', 'VIIRS S-NPP'], ['viirs-jpss1', 'VIIRS NOAA-20']].map(([id, label]) => <label key={id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={query.sensors.includes(id)} onChange={() => update({ sensors: query.sensors.includes(id) ? query.sensors.filter((s) => s !== id) : [...query.sensors, id] })} />{label}</label>)}</fieldset>
        <InfoToggle label={t('Informações: unidades e sensores', 'Information: units and sensors')}>{t('As contagens preservam sensores e o merge legado por mês/semana; não são incêndios únicos nem área queimada. Somar FRP ao longo do tempo não mede energia ou potência simultânea. Sensor indisponível é diferente de zero. A harmonização legada continua identificada separadamente até a reconciliação de um índice aditivo.', 'Counts preserve sensors and the legacy month/week merge; they are not unique fires or burned area. Summing FRP over time does not measure energy or simultaneous power. An unavailable sensor differs from zero. Legacy harmonization remains separate until an additive index is reconciled.')}</InfoToggle>
      </div>
      <div className="space-y-2">
        <form className="grid grid-cols-2 gap-2" onSubmit={(e) => { e.preventDefault(); onCoordinate(Number(lat), Number(lon), false) }}>
          <label className="text-xs text-slate-400">{t('Latitude', 'Latitude')}<input aria-label="Latitude" className={field} type="number" min={-90} max={90} step="any" required value={lat} onChange={(e) => setLat(e.target.value)} /></label>
          <label className="text-xs text-slate-400">{t('Longitude', 'Longitude')}<input aria-label="Longitude" className={field} type="number" min={-180} max={180} step="any" required value={lon} onChange={(e) => setLon(e.target.value)} /></label>
          <button type="submit" className="control-button">{t('Selecionar célula', 'Select cell')}</button>
          <button type="button" className={`control-button ${gpsActive ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200' : ''}`} onClick={gps} disabled={gpsLoading}>
            {gpsLoading ? t('Localizando…', 'Locating…') : `📍 ${t('Meu GPS', 'My GPS')}`}
          </button>
        </form>
        {gpsError && <p role="alert" className="text-xs text-amber-200">{gpsError}</p>}
        <p className="font-mono text-xs text-purple-200">{number(selectedCount)} {t('pontos selecionados', 'selected points')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onClear} className="control-button">{t('Limpar seleção', 'Clear selection')}</button>
          <button type="button" onClick={onUndo} className="control-button">{t('Desfazer', 'Undo')}</button>
          <button type="button" onClick={() => onSelectionMode(!selectionMode)} aria-pressed={selectionMode} className={`control-button ${selectionMode ? 'bg-purple-500/30' : ''}`}>{t('Selecionar área', 'Select area')}</button>
        </div>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
      {([['3d', t('Observações 3D', '3D observations')], ['2d', t('Observações 2D', '2D observations')], ['heat3d', t('Calor 3D', '3D heatmap')], ['heat2d', t('Calor 2D', '2D heatmap')]] as Array<[MapMode, string]>).map(([id, label]) => <button key={id} type="button" aria-pressed={mode === id} onClick={() => onMode(id)} className={`rounded-lg border px-3 py-2 text-xs ${mode === id ? 'border-purple-300 bg-purple-500/25' : 'border-white/10 text-slate-300'}`}>{label}</button>)}
      <label className="flex items-center gap-2 text-xs">{t('Ano A', 'Year A')}<select aria-label={t('Ano A', 'Year A')} className="rounded border border-white/20 bg-[#070b12] px-2 py-2 font-mono" value={year} onChange={(e) => onYear(Number(e.target.value))}>{years.map((y) => <option key={y}>{y}</option>)}</select></label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={compare} onChange={(e) => onCompare(e.target.checked)} />{t('Comparar anos', 'Compare years')}</label>
      {compare && <label className="flex items-center gap-2 text-xs">{t('Ano B', 'Year B')}<select aria-label={t('Ano B', 'Year B')} className="rounded border border-white/20 bg-[#070b12] px-2 py-2 font-mono" value={yearB} onChange={(e) => onYearB(Number(e.target.value))}>{years.map((y) => <option key={y}>{y}</option>)}</select></label>}
      <button
        type="button"
        onClick={onExport}
        disabled={!canExport && !exportLoading}
        aria-busy={exportLoading}
        className={`ml-auto flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
          exportLoading
            ? 'border border-purple-400/50 bg-purple-900/60 text-purple-100 hover:bg-purple-800/70'
            : 'bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-40'
        }`}
      >
        {exportLoading ? (
          <>
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-purple-200 border-t-transparent" />
            <span>
              {pendingExport
                ? t('Preparando CSV (baixará ao concluir)…', 'Preparing CSV (auto-downloading)…')
                : t('Carregando CSV… (Clique para agendar)', 'Loading CSV… (Click to queue)')}
            </span>
          </>
        ) : (
          <span>{t('Exportar CSV', 'Export CSV')}</span>
        )}
      </button>
    </div>
  </section>
}
