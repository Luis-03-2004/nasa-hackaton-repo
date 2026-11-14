import { useEffect, useState } from 'react'
import { Heatmap } from '../components/charts/Heatmap'
import { SeriesChart } from '../components/charts/SeriesChart'
import { AlertBadge } from '../components/layout/AlertBadge'
import { Header, type MapView, type SeriesMetric } from '../components/layout/Header'
import { Panel } from '../components/layout/Panel'
import { EarthGlobe, type GlobePick } from '../components/webgl/EarthGlobe'
import { FlatMap } from '../components/webgl/FlatMap'
import { useFireData } from '../hooks/useFireData'
import { GLOBE_HOTSPOTS, useGlobeHotspots } from '../hooks/useGlobeHotspots'
import { countryAt, loadCountries, type CountryShape } from '../utils/countries'

function ChartStatus({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm text-[#9bb0d1]">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full border border-white/15 px-3 py-1 text-sm text-white"
        >
          Try again
        </button>
      ) : null}
    </div>
  )
}

export function Dashboard() {
  const { catalog, status, error, reload } = useFireData()
  const { hotspots } = useGlobeHotspots()
  const [regionId, setRegionId] = useState('cerrado')
  const [view, setView] = useState<MapView>('3d')
  const [date, setDate] = useState('')
  const [forecastText, setForecastText] = useState('')
  const [metric, setMetric] = useState<SeriesMetric>('harmonized')
  const [countries, setCountries] = useState<CountryShape[]>([])
  const [country, setCountry] = useState<string | null>(null)
  const [picked, setPicked] = useState<GlobePick | null>(null)

  useEffect(() => {
    let active = true
    loadCountries()
      .then((loaded) => {
        if (active) setCountries(loaded)
      })
      .catch(() => {
        if (active) setCountries([])
      })
    return () => {
      active = false
    }
  }, [])

  const region = catalog?.regions.find((item) => item.id === regionId) ?? null
  const hotspot = GLOBE_HOTSPOTS.find((item) => item.id === regionId) ?? null
  const monthKey = date.slice(0, 7)
  const series =
    region == null
      ? []
      : monthKey
        ? region.historical_series.filter((point) => point.week_start.startsWith(monthKey))
        : region.historical_series
  const waiting = status !== 'ready' || !region
  const focus = picked ?? (hotspot ? { lat: hotspot.lat, lon: hotspot.lon } : null)

  function selectHotspot(id: string) {
    const next = GLOBE_HOTSPOTS.find((item) => item.id === id)
    setRegionId(id)
    if (!next) return
    setPicked({ lat: next.lat, lon: next.lon })
    setCountry(countryAt(countries, next.lat, next.lon))
  }

  function selectPlace(pick: GlobePick) {
    setPicked(pick)
    setCountry(countryAt(countries, pick.lat, pick.lon))
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-3">
      <section className="relative h-[68vh] min-h-0 lg:col-span-2 lg:h-full">
        {view === '3d' ? (
          <EarthGlobe
            hotspots={hotspots}
            focus={focus}
            onSelect={selectPlace}
            onHotspotSelect={selectHotspot}
          />
        ) : null}
        {view === '2d' ? (
          <FlatMap
            hotspots={hotspots}
            countries={countries}
            selectedId={regionId}
            onPick={selectPlace}
            onHotspotSelect={selectHotspot}
          />
        ) : null}
        {view === 'heat' ? (
          <div className="h-full bg-[#071a3a] p-4">
            {waiting || !region ? (
              <ChartStatus
                message={status === 'error' ? (error ?? 'Failed to load.') : 'Loading the heat map…'}
                onRetry={status === 'error' ? reload : undefined}
              />
            ) : series.length === 0 ? (
              <ChartStatus message="No records for this date." />
            ) : (
              <Heatmap series={series} />
            )}
          </div>
        ) : null}

        {country ? (
          <div className="pointer-events-none absolute top-4 left-4 rounded-xl border border-white/10 bg-[#071a3d]/90 px-4 py-3">
            <p className="font-mono text-[10px] tracking-[0.16em] text-[#9bb0d1] uppercase">Country</p>
            <p className="text-2xl font-semibold text-white">{country}</p>
          </div>
        ) : null}

        {hotspot ? (
          <button
            type="button"
            onClick={() => selectHotspot(hotspot.id)}
            className="absolute bottom-4 left-4 w-64 rounded-xl border border-white/10 bg-[#071a3d]/95 p-3 text-left shadow-xl"
          >
            <p className="text-sm font-semibold text-white">{hotspot.label}</p>
            <p className="mt-1 font-mono text-[10px] text-[#9bb0d1]">
              {hotspot.lat.toFixed(1)}°, {hotspot.lon.toFixed(1)}°
            </p>
            <div className="mt-2">
              <AlertBadge level={hotspot.alertLevel} />
            </div>
            {region ? (
              <p className="mt-2 text-xs text-[#d6e2f5]">
                Recent departure {region.forecast.recent_anomaly_pct > 0 ? '+' : ''}
                {region.forecast.recent_anomaly_pct.toFixed(0)}%
              </p>
            ) : null}
          </button>
        ) : null}
      </section>

      <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-white/10 bg-[#04122b] p-3 lg:border-l">
        <Header
          view={view}
          date={date}
          forecastText={forecastText}
          onViewChange={setView}
          onDateChange={setDate}
          onForecastTextChange={setForecastText}
          onForecastSubmit={() => undefined}
        />
        <Panel
          className="min-h-[280px] flex-1"
          eyebrow="Historical series"
          title={region ? region.region_name : 'Harmonized history'}
          action={
            <div className="flex rounded-full border border-white/10 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setMetric('harmonized')}
                className={`rounded-full px-2 py-1 ${metric === 'harmonized' ? 'bg-white/10 text-white' : 'text-[#9bb0d1]'}`}
              >
                Index
              </button>
              <button
                type="button"
                onClick={() => setMetric('sensors')}
                className={`rounded-full px-2 py-1 ${metric === 'sensors' ? 'bg-white/10 text-white' : 'text-[#9bb0d1]'}`}
              >
                Sensors
              </button>
            </div>
          }
        >
          {waiting || !region ? (
            <ChartStatus
              message={status === 'error' ? (error ?? 'Failed to load.') : 'Loading the history…'}
              onRetry={status === 'error' ? reload : undefined}
            />
          ) : series.length === 0 ? (
            <ChartStatus message="No records for this date." />
          ) : (
            <SeriesChart series={series} mode={metric} />
          )}
        </Panel>
      </aside>
    </div>
  )
}
