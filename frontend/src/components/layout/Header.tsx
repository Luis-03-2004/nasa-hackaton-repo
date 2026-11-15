import { useEffect, useState } from 'react'
import type { GlobePick } from '../webgl/EarthGlobe'

export type SeriesMetric = 'harmonized' | 'sensors'
export type MapView = '3d' | '2d' | 'heat'
const PRESETS = [
  { name: 'Brasil', lat: -12, lon: -52 },
  { name: 'Cerrado', lat: -12, lon: -46 },
  { name: 'Amazônia', lat: -7.5, lon: -55.5 },
  { name: 'Pantanal', lat: -18.5, lon: -56.8 },
]
const field = 'min-w-0 rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white'

export function Header({ view, date, regionId, regions, onViewChange, onDateChange, onRegionChange, onSelectPlace, onExport, canExport, coordinates }: {
  view: MapView; date: string; regionId: string
  regions: Array<{ id: string; region_name: string }>
  onViewChange: (view: MapView) => void
  onDateChange: (value: string) => void
  onRegionChange: (id: string) => void
  onSelectPlace: (pick: GlobePick) => void
  onExport: () => void; canExport: boolean; coordinates: GlobePick
}) {
  const [lat, setLat] = useState('-12')
  const [lon, setLon] = useState('-52')
  const [gpsError, setGpsError] = useState('')
  const [gpsLoading, setGpsLoading] = useState(false)
  useEffect(() => { setLat(String(coordinates.lat)); setLon(String(coordinates.lon)) }, [coordinates])
  function select(pick: GlobePick) { setLat(String(pick.lat)); setLon(String(pick.lon)); onSelectPlace(pick) }
  function locate() {
    setGpsError('')
    if (!navigator.geolocation) { setGpsError('Geolocalização indisponível neste navegador.'); return }
    setGpsLoading(true)
    navigator.geolocation.getCurrentPosition((position) => {
      setGpsLoading(false); select({ lat: position.coords.latitude, lon: position.coords.longitude })
    }, () => { setGpsLoading(false); setGpsError('Não foi possível obter sua localização. Informe as coordenadas. Resultados disponíveis no catálogo de 2025.') }, { timeout: 10000 })
  }
  return <div className="flex flex-col gap-3">
    <div className="flex items-center gap-3"><span className="h-10 w-1 rounded-full bg-[#fc3d21]" /><div>
      <p className="font-mono text-[10px] tracking-[0.2em] text-[#ff8a73] uppercase">NASA FIRMS · 2000–2025</p>
      <h1 className="text-xl font-semibold tracking-tight">BAT — Brightness Anomaly Tracker</h1>
    </div></div>
    <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 p-1">
      {([{ id: '3d', label: 'Globo 3D' }, { id: '2d', label: 'Mapa 2D' }, { id: 'heat', label: 'Calendário' }] as const).map((item) =>
        <button key={item.id} type="button" aria-pressed={view === item.id} onClick={() => onViewChange(item.id)} className={`rounded-lg py-2 text-xs ${view === item.id ? 'bg-[#fc3d21] text-white' : 'text-[#9bb0d1]'}`}>{item.label}</button>)}
    </div>
    <label className="flex flex-col gap-1 text-xs text-[#9bb0d1]">Escopo do histórico mensal
      <select aria-label="Escopo do histórico" className={field} value={regionId} onChange={(e) => onRegionChange(e.target.value)}>{regions.map((r) => <option key={r.id} value={r.id}>{r.region_name}</option>)}</select>
    </label>
    <div className="flex flex-wrap gap-1.5">{PRESETS.map((preset) => <button key={preset.name} type="button" className="rounded-full border border-white/15 px-3 py-1 text-xs hover:bg-white/10" onClick={() => { onRegionChange('brazil'); select(preset) }}>{preset.name}</button>)}</div>
    <p className="text-[11px] text-[#9bb0d1]">Os atalhos selecionam um ponto para F₂; o histórico permanece no escopo indicado acima.</p>
    <form onSubmit={(e) => { e.preventDefault(); select({ lat: Number(lat), lon: Number(lon) }) }} className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1 text-xs text-[#9bb0d1]">Latitude<input aria-label="Latitude" type="number" min={-90} max={90} step="any" required className={field} value={lat} onChange={(e) => setLat(e.target.value)} /></label>
      <label className="flex flex-col gap-1 text-xs text-[#9bb0d1]">Longitude<input aria-label="Longitude" type="number" min={-180} max={180} step="any" required className={field} value={lon} onChange={(e) => setLon(e.target.value)} /></label>
      <button className="rounded-lg border border-white/15 px-2 py-2 text-xs" type="submit">Consultar ponto F₂</button>
      <button className="rounded-lg border border-white/15 px-2 py-2 text-xs" type="button" onClick={locate} disabled={gpsLoading}>{gpsLoading ? 'Localizando…' : 'Meu GPS'}</button>
    </form>
    {gpsError && <p role="alert" className="text-xs text-amber-300">{gpsError}</p>}
    <label className="flex flex-col gap-1 text-xs text-[#9bb0d1]">Mês destacado / consulta de células
      <input aria-label="Mês" type="month" value={date} min="2000-01" max="2025-12" onChange={(e) => onDateChange(e.target.value)} className={field} />
    </label>
    <div className="flex gap-2"><button type="button" onClick={() => onDateChange('')} className="rounded-lg border border-white/15 px-3 py-2 text-xs">Limpar mês</button><button type="button" disabled={!canExport} onClick={onExport} className="flex-1 rounded-lg bg-[#fc3d21] px-3 py-2 text-xs font-semibold disabled:opacity-40">Baixar CSV do histórico</button></div>
  </div>
}
