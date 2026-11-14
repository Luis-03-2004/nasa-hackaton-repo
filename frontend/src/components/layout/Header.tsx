import { Download, LocateFixed } from 'lucide-react'

const CHIPS = [
  { id: 'world', label: '🌎 Mundo inteiro' },
  { id: 'brasil', label: '🇧🇷 Brasil' },
  { id: 'cerrado', label: '🔥 Cerrado' },
  { id: 'amazonia', label: '🌲 Amazônia' },
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
    <header className="border-b border-white/10 bg-[#0e1420]/90 px-4 py-3 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="mr-2 flex items-center gap-3">
          <span className="h-9 w-1 rounded-full bg-[#ff6a2c]" />
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-[#ff8a55] uppercase">
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
                    ? 'border-[#ff6a2c] bg-[#ff6a2c]/15 text-white'
                    : 'border-white/10 bg-white/5 text-[#c5d0e0] hover:border-white/25'
                }`}
              >
                {chip.label}
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-sm">
            <span className="font-mono text-[10px] text-[#93a4bd]">LAT</span>
            <input
              value={lat}
              onChange={(event) => onLatChange(event.target.value)}
              onBlur={onApplyCoordinates}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onApplyCoordinates()
              }}
              className="w-16 bg-transparent font-mono text-[#f4f7fb] outline-none"
              inputMode="decimal"
              aria-label="Latitude"
            />
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-sm">
            <span className="font-mono text-[10px] text-[#93a4bd]">LON</span>
            <input
              value={lon}
              onChange={(event) => onLonChange(event.target.value)}
              onBlur={onApplyCoordinates}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onApplyCoordinates()
              }}
              className="w-16 bg-transparent font-mono text-[#f4f7fb] outline-none"
              inputMode="decimal"
              aria-label="Longitude"
            />
          </label>
          <button
            type="button"
            onClick={onLocate}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-[#d5deea] hover:border-[#3dd6f5]/50"
          >
            <LocateFixed size={15} />
            Meu GPS
          </button>
          <button
            type="button"
            disabled={!downloadEnabled}
            onClick={onDownload}
            className="inline-flex items-center gap-2 rounded-lg bg-[#ff6a2c] px-3 py-1.5 text-sm font-semibold text-[#1a0d07] disabled:opacity-50"
          >
            <Download size={15} />
            Baixar CSV
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <p className="font-mono text-xs text-[#93a4bd]">Período 2020–2025</p>
        <div className="flex rounded-full border border-white/10 p-0.5">
          <button
            type="button"
            onClick={() => onMetricChange('harmonized')}
            className={`rounded-full px-3 py-1 ${metric === 'harmonized' ? 'bg-white/10 text-white' : 'text-[#93a4bd]'}`}
          >
            Índice harmonizado
          </button>
          <button
            type="button"
            onClick={() => onMetricChange('sensors')}
            className={`rounded-full px-3 py-1 ${metric === 'sensors' ? 'bg-white/10 text-white' : 'text-[#93a4bd]'}`}
          >
            Comparar sensores
          </button>
        </div>
        <p
          className={`rounded-full border px-3 py-1 font-mono text-[11px] ${
            calibrated
              ? 'border-[#3dd6f5]/40 text-[#9be8f8]'
              : 'border-white/10 text-[#93a4bd]'
          }`}
        >
          {calibrated ? 'Calibração regional · grade 0,25° / 10 km' : 'Padrão global · grade 0,5°'}
        </p>
        {gpsMessage ? <p className="text-[#f5b942]">{gpsMessage}</p> : null}
      </div>
    </header>
  )
}
