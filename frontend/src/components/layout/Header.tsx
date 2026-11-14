import { Download, LocateFixed } from 'lucide-react'

const CHIPS = [
  { id: 'world', label: '🌎 Entire world' },
  { id: 'brasil', label: '🇧🇷 Brazil' },
  { id: 'cerrado', label: '🔥 Cerrado' },
  { id: 'pantanal', label: '🐊 Pantanal' },
] as const

export type SeriesMetric = 'harmonized' | 'sensors'

export function Header({
  regionId,
  lat,
  lon,
  metric,
  calibrated,
  gpsMessage,
  downloadEnabled,
  onRegionChange,
  onLatChange,
  onLonChange,
  onApplyCoordinates,
  onLocate,
  onMetricChange,
  onDownload,
}: {
  regionId: string
  lat: string
  lon: string
  metric: SeriesMetric
  calibrated: boolean
  gpsMessage: string | null
  downloadEnabled: boolean
  onRegionChange: (id: string) => void
  onLatChange: (value: string) => void
  onLonChange: (value: string) => void
  onApplyCoordinates: () => void
  onLocate: () => void
  onMetricChange: (metric: SeriesMetric) => void
  onDownload: () => void
}) {
  return (
    <header className="border-b border-white/10 bg-[#071a3d]/90 px-4 py-3 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="mr-2 flex items-center gap-3">
          <span className="h-9 w-1 rounded-full bg-[#fc3d21]" />
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-[#ff8a73] uppercase">
              NASA Space Apps
            </p>
            <h1 className="text-lg leading-none font-semibold tracking-tight">FireCal Global</h1>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {CHIPS.map((chip) => {
            const active = chip.id === regionId
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => onRegionChange(chip.id)}
                className={`rounded-full border px-3 py-1 text-sm transition ${
                  active
                    ? 'border-[#fc3d21] bg-[#fc3d21]/15 text-white'
                    : 'border-white/10 bg-white/5 text-[#d6e2f5] hover:border-white/25'
                }`}
              >
                {chip.label}
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-sm">
            <span className="font-mono text-[10px] text-[#9bb0d1]">LAT</span>
            <input
              value={lat}
              onChange={(event) => onLatChange(event.target.value)}
              onBlur={onApplyCoordinates}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onApplyCoordinates()
              }}
              className="w-16 bg-transparent font-mono text-[#f7f9fc] outline-none"
              inputMode="decimal"
              aria-label="Latitude"
            />
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-sm">
            <span className="font-mono text-[10px] text-[#9bb0d1]">LON</span>
            <input
              value={lon}
              onChange={(event) => onLonChange(event.target.value)}
              onBlur={onApplyCoordinates}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onApplyCoordinates()
              }}
              className="w-16 bg-transparent font-mono text-[#f7f9fc] outline-none"
              inputMode="decimal"
              aria-label="Longitude"
            />
          </label>
          <button
            type="button"
            onClick={onLocate}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-[#d6e2f5] hover:border-[#6ea2ff]/50"
          >
            <LocateFixed size={15} />
            My location
          </button>
          <button
            type="button"
            disabled={!downloadEnabled}
            onClick={onDownload}
            className="inline-flex items-center gap-2 rounded-lg bg-[#fc3d21] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Download size={15} />
            Download CSV
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <p className="font-mono text-xs text-[#9bb0d1]">Period 2020–2025</p>
        <div className="flex rounded-full border border-white/10 p-0.5">
          <button
            type="button"
            onClick={() => onMetricChange('harmonized')}
            className={`rounded-full px-3 py-1 ${metric === 'harmonized' ? 'bg-white/10 text-white' : 'text-[#9bb0d1]'}`}
          >
            Harmonized index
          </button>
          <button
            type="button"
            onClick={() => onMetricChange('sensors')}
            className={`rounded-full px-3 py-1 ${metric === 'sensors' ? 'bg-white/10 text-white' : 'text-[#9bb0d1]'}`}
          >
            Compare sensors
          </button>
        </div>
        <p
          className={`rounded-full border px-3 py-1 font-mono text-[11px] ${
            calibrated
              ? 'border-[#6ea2ff]/40 text-[#c5d9ff]'
              : 'border-white/10 text-[#9bb0d1]'
          }`}
        >
          {calibrated ? 'Regional calibration · 0.25° / 10 km grid' : 'Global standard · 0.5° grid'}
        </p>
        {gpsMessage ? <p className="text-[#ffb0a1]">{gpsMessage}</p> : null}
      </div>
    </header>
  )
}
