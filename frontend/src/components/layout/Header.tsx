export type SeriesMetric = 'harmonized' | 'sensors'
export type MapView = '3d' | '2d' | 'heat'

const VIEWS: Array<{ id: MapView; label: string }> = [
  { id: '3d', label: '3D map' },
  { id: '2d', label: '2D map' },
  { id: 'heat', label: 'Heat map' },
]

export function Header({
  view,
  date,
  forecastText,
  onViewChange,
  onDateChange,
  onForecastTextChange,
  onForecastSubmit,
}: {
  view: MapView
  date: string
  forecastText: string
  onViewChange: (view: MapView) => void
  onDateChange: (value: string) => void
  onForecastTextChange: (value: string) => void
  onForecastSubmit: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="h-9 w-1 rounded-full bg-[#fc3d21]" />
        <div>
          <p className="font-mono text-[10px] tracking-[0.2em] text-[#ff8a73] uppercase">
            NASA Space Apps
          </p>
          <h1 className="text-lg leading-none font-semibold tracking-tight">FireCal Global</h1>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onViewChange(item.id)}
            className={`rounded-lg px-2 py-1.5 text-xs font-semibold ${
              view === item.id ? 'bg-[#fc3d21] text-white' : 'text-[#d6e2f5] hover:bg-white/5'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-mono text-[10px] tracking-wide text-[#9bb0d1] uppercase">Date</span>
        <input
          type="date"
          value={date}
          min="2020-01-01"
          max="2025-12-31"
          onChange={(event) => onDateChange(event.target.value)}
          className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[#f7f9fc] outline-none"
        />
      </label>

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          onForecastSubmit()
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-mono text-[10px] tracking-wide text-[#9bb0d1] uppercase">
            Future forecast
          </span>
          <input
            value={forecastText}
            onChange={(event) => onForecastTextChange(event.target.value)}
            placeholder="Ask about a future fire window"
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[#f7f9fc] outline-none placeholder:text-[#9bb0d1]"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold text-white hover:border-[#6ea2ff]/50"
        >
          Run forecast
        </button>
      </form>
    </div>
  )
}
