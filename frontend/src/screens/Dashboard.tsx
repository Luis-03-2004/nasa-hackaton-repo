import { useState } from 'react'
import { ForecastChart } from '../components/charts/ForecastChart'
import { Heatmap } from '../components/charts/Heatmap'
import { SeriesChart } from '../components/charts/SeriesChart'
import { Header, type SeriesMetric } from '../components/layout/Header'
import { Panel } from '../components/layout/Panel'
import { EarthGlobe } from '../components/webgl/EarthGlobe'
import { useFireData } from '../hooks/useFireData'
import { nearestHotspot, useGlobeHotspots } from '../hooks/useGlobeHotspots'
import { downloadSeriesCsv } from '../utils/csv'

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
  const [latDraft, setLatDraft] = useState<string | null>(null)
  const [lonDraft, setLonDraft] = useState<string | null>(null)
  const [metric, setMetric] = useState<SeriesMetric>('harmonized')
  const [gpsMessage, setGpsMessage] = useState<string | null>(null)

  const region = catalog?.regions.find((item) => item.id === regionId) ?? null
  const lat = latDraft ?? (region ? region.coordinates.lat_center.toFixed(2) : '-12.00')
  const lon = lonDraft ?? (region ? region.coordinates.lon_center.toFixed(2) : '-46.00')

  function selectRegion(id: string) {
    setRegionId(id)
    setLatDraft(null)
    setLonDraft(null)
    setGpsMessage(null)
  }

  function applyCoordinates() {
    const latValue = Number(lat)
    const lonValue = Number(lon)
    const valid =
      Number.isFinite(latValue) &&
      Number.isFinite(lonValue) &&
      latValue >= -90 &&
      latValue <= 90 &&
      lonValue >= -180 &&
      lonValue <= 180

    if (!valid) {
      setGpsMessage('Use a latitude between -90 and 90 and a longitude between -180 and 180.')
      return
    }

    setGpsMessage(null)
    setLatDraft(null)
    setLonDraft(null)
    setRegionId(nearestHotspot(latValue, lonValue).id)
  }

  function locateUser() {
    if (!navigator.geolocation) {
      setGpsMessage('Geolocation is not available in this browser.')
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        selectRegion(nearestHotspot(position.coords.latitude, position.coords.longitude).id)
      },
      () => setGpsMessage('Could not read your location.'),
    )
  }

  function downloadCsv() {
    if (!region) return
    downloadSeriesCsv(`firecal-${regionId}.csv`, region.historical_series)
  }

  const waiting = status !== 'ready' || !region
  const focus = region
    ? { lat: region.coordinates.lat_center, lon: region.coordinates.lon_center }
    : null

  return (
    <div className="flex h-full min-h-screen flex-col">
      <Header
        regionId={regionId}
        lat={lat}
        lon={lon}
        metric={metric}
        calibrated={region?.calibration_status === 'calibrated_local'}
        gpsMessage={gpsMessage}
        downloadEnabled={Boolean(region)}
        onRegionChange={selectRegion}
        onLatChange={setLatDraft}
        onLonChange={setLonDraft}
        onApplyCoordinates={applyCoordinates}
        onLocate={locateUser}
        onMetricChange={setMetric}
        onDownload={downloadCsv}
      />
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-2 lg:grid-rows-2">
        <Panel eyebrow="01 · Globe" title={region?.region_name ?? 'Burning activity across the planet'}>
          <EarthGlobe
            hotspots={hotspots}
            focus={focus}
            onSelect={({ lat: pickedLat, lon: pickedLon }) => {
              selectRegion(nearestHotspot(pickedLat, pickedLon).id)
            }}
            onHotspotSelect={selectRegion}
          />
        </Panel>
        <Panel eyebrow="02 · Forecast" title="Local 4-week outlook">
          {waiting || !region ? (
            <ChartStatus
              message={status === 'error' ? (error ?? 'Failed to load.') : 'Loading the harmonized series…'}
              onRetry={status === 'error' ? reload : undefined}
            />
          ) : (
            <ForecastChart
              series={region.historical_series}
              forecast={region.forecast}
              regionName={region.region_name}
            />
          )}
        </Panel>
        <Panel eyebrow="03 · Calendar" title={region ? `${region.region_name} · 2020–2025` : '2020–2025'}>
          {waiting || !region ? (
            <ChartStatus message={status === 'error' ? 'Series unavailable.' : 'Loading the calendar…'} />
          ) : (
            <Heatmap series={region.historical_series} />
          )}
        </Panel>
        <Panel eyebrow="04 · Series" title="Harmonized history and sensors">
          {waiting || !region ? (
            <ChartStatus message={status === 'error' ? 'Series unavailable.' : 'Loading the history…'} />
          ) : (
            <SeriesChart series={region.historical_series} mode={metric} />
          )}
        </Panel>
      </main>
    </div>
  )
}
