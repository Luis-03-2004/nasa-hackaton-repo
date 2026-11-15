import { useCallback, useEffect, useRef, useState } from 'react'
import earthMap from '../../assets/earth-map.jpg'
import { countryDisplayName, findCountryAt, preparedCountry, type CountryShape } from '../../utils/countries'
import { flatIdsInRectangle, flatProject, flatScale, flatUnproject, screenRectangle, type FlatViewState, type SelectionOperation } from '../../utils/mapSelection'
import type { Hotspot } from './HotspotMarker'
import type { GlobePick } from './EarthGlobe'

const WORLD: FlatViewState = { x: 0, y: 0, k: 1 }
const wraps = [-1, 0, 1]
interface Props {
  hotspots: Hotspot[]
  countries?: CountryShape[]
  selectedId?: string | null
  selectedIds?: string[]
  onPick?: (pick: GlobePick) => void
  onHotspotSelect?: (id: string) => void
  onSelectionChange?: (ids: string[], mode: SelectionOperation) => void
  onCountrySelect?: (name: string) => void
  selectionMode?: boolean
  heatmap?: boolean
  locale?: 'pt-BR' | 'en'
  pointOpacity?: number
  viewState?: FlatViewState
  onViewStateChange?: (view: FlatViewState) => void
}

export function FlatMap({ hotspots, countries = [], selectedId = null, selectedIds = [], onPick, onHotspotSelect, onSelectionChange, onCountrySelect, selectionMode = false, heatmap = false, locale = 'pt-BR', pointOpacity = .94, viewState, onViewStateChange }: Props) {
  const wrapper = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const image = useRef<HTMLImageElement | null>(null)
  const [imageReady, setImageReady] = useState(false)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const [ownView, setOwnView] = useState<FlatViewState>(WORLD)
  const view = viewState ?? ownView
  const [hovered, setHovered] = useState<Hotspot | null>(null)
  const [hoverCountry, setHoverCountry] = useState<CountryShape | null>(null)
  const [box, setBox] = useState<ReturnType<typeof screenRectangle> | null>(null)
  const drag = useRef<{ x: number; y: number; currentX: number; currentY: number; selecting: boolean; view: FlatViewState; shift: boolean } | null>(null)
  const t = (pt: string, en: string) => locale === 'pt-BR' ? pt : en
  const changeView = useCallback((next: FlatViewState) => {
    const value = { x: Math.max(-.5, Math.min(.5, next.x)), y: Math.max(-.5, Math.min(.5, next.y)), k: Math.max(1, Math.min(64, next.k)) }
    setOwnView(value); onViewStateChange?.(value)
  }, [onViewStateChange])

  useEffect(() => {
    const img = new Image(); img.src = earthMap
    img.onload = () => { image.current = img; setImageReady(true) }
    if (img.complete) { image.current = img; setImageReady(true) }
    return () => { img.onload = null }
  }, [])
  useEffect(() => {
    const element = wrapper.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(element); return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = canvas.current
    if (!element || size.width <= 1) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    element.width = Math.round(size.width * ratio); element.height = Math.round(size.height * ratio)
    const ctx = element.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.fillStyle = '#04122b'; ctx.fillRect(0, 0, size.width, size.height)
    const width = flatScale(size.width, size.height) * view.k
    const height = width / 2
    for (const wrap of wraps) {
      const corner = flatProject(90, -180, size.width, size.height, view, wrap)
      if (imageReady && image.current) { ctx.globalAlpha = heatmap ? .28 : .85; ctx.drawImage(image.current, corner.x, corner.y, width, height); ctx.globalAlpha = 1 }
    }
    function countryPath(country: CountryShape, wrap: number) {
      ctx!.beginPath()
      for (const polygon of preparedCountry(country)) for (const ring of polygon.rings) {
        ring.forEach(([lon, lat], index) => { const p = flatProject(lat, lon, size.width, size.height, view, wrap); if (!index) ctx!.moveTo(p.x, p.y); else ctx!.lineTo(p.x, p.y) }); ctx!.closePath()
      }
    }
    for (const country of countries) for (const wrap of wraps) {
      countryPath(country, wrap)
      ctx.strokeStyle = 'rgba(226,232,240,.45)'; ctx.lineWidth = .6; ctx.stroke()
    }
    const selected = new Set([...selectedIds, ...(selectedId ? [selectedId] : [])])
    ctx.globalAlpha = heatmap ? pointOpacity : 1
    for (const point of hotspots) for (const wrap of wraps) {
      const p = flatProject(point.lat, point.lon, size.width, size.height, view, wrap)
      if (p.x < -10 || p.x > size.width + 10 || p.y < -10 || p.y > size.height + 10) continue
      ctx.fillStyle = point.color
      const cell = Math.max(1.5, width / 360)
      if (heatmap) ctx.fillRect(p.x - cell / 2, p.y - cell / 2, cell + .2, cell + .2)
      else { ctx.beginPath(); ctx.arc(p.x, p.y, Math.min(4, Math.max(1.3, cell * .24)), 0, Math.PI * 2); ctx.fill() }
      if (selected.has(point.id)) { ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.6; ctx.strokeRect(p.x - Math.max(3, cell / 2), p.y - Math.max(3, cell / 2), Math.max(6, cell), Math.max(6, cell)) }
    }
    ctx.globalAlpha = 1
    if (hoverCountry) for (const wrap of wraps) {
      countryPath(hoverCountry, wrap)
      ctx.fillStyle = 'rgba(56,189,248,.13)'; ctx.fill('evenodd')
      ctx.strokeStyle = '#7dd3fc'; ctx.lineWidth = 1.4; ctx.stroke()
    }
  }, [hotspots, countries, selectedId, selectedIds, hoverCountry, size, view, imageReady, heatmap, pointOpacity])

  function local(event: { clientX: number; clientY: number }) { const bounds = canvas.current!.getBoundingClientRect(); return { x: event.clientX - bounds.left, y: event.clientY - bounds.top } }
  function hit(x: number, y: number) {
    let point: Hotspot | null = null; let best = 8 ** 2
    for (const item of hotspots) for (const wrap of wraps) {
      const p = flatProject(item.lat, item.lon, size.width, size.height, view, wrap)
      const distance = (p.x - x) ** 2 + (p.y - y) ** 2
      if (distance < best) { point = item; best = distance }
    }
    return point
  }
  function zoom(factor: number, x = size.width / 2, y = size.height / 2) {
    const k = Math.max(1, Math.min(64, view.k * factor))
    const width = flatScale(size.width, size.height)
    changeView({ x: view.x + (x - size.width / 2) / width * (1 / view.k - 1 / k), y: view.y + (y - size.height / 2) / (width / 2) * (1 / view.k - 1 / k), k })
  }
  useEffect(() => {
    const element=canvas.current
    if (!element) return
    const wheel=(event: WheelEvent) => {
      event.preventDefault()
      const p=local(event)
      zoom(Math.exp(-event.deltaY*.0015),p.x,p.y)
    }
    element.addEventListener('wheel',wheel,{passive:false})
    return () => element.removeEventListener('wheel',wheel)
  },[view,size,changeView])
  useEffect(() => {
    const escape=(event: KeyboardEvent) => { if (event.key==='Escape') { drag.current=null; setBox(null) } }
    window.addEventListener('keydown',escape)
    return () => window.removeEventListener('keydown',escape)
  },[])
  function fit() {
    const ids = new Set([...selectedIds, ...(selectedId ? [selectedId] : [])])
    const points = hotspots.filter((p) => ids.has(p.id))
    if (!points.length) { changeView(WORLD); return }
    const first = points[0].lon
    const longitudes = points.map((p) => { let lon = p.lon; while (lon - first > 180) lon -= 360; while (lon - first < -180) lon += 360; return lon })
    const west = Math.min(...longitudes), east = Math.max(...longitudes), south = Math.min(...points.map((p) => p.lat)), north = Math.max(...points.map((p) => p.lat))
    const k = Math.min(64, 300 / Math.max(3, east - west), 145 / Math.max(3, north - south))
    changeView({ x: ((west + east) / 2) / 360, y: -((south + north) / 2) / 180, k })
  }

  return <div ref={wrapper} className="relative h-full min-h-64 w-full overflow-hidden bg-[#04122b]">
    <canvas ref={canvas} role="img" aria-label={t('Mapa 2D interativo. Shift e arraste seleciona pontos.', 'Interactive 2D map. Shift and drag selects points.')} className="h-full w-full touch-none" style={{ cursor: box || selectionMode ? 'crosshair' : drag.current ? 'grabbing' : 'grab' }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        const p = local(event); const selecting = event.shiftKey || selectionMode
        drag.current = { ...p, currentX: p.x, currentY: p.y, selecting, view: { ...view }, shift: event.shiftKey }
        event.currentTarget.setPointerCapture(event.pointerId)
        if (selecting) setBox(screenRectangle(p.x, p.y, p.x, p.y))
      }}
      onPointerMove={(event) => {
        const p = local(event), active = drag.current
        if (active) {
          active.currentX = p.x; active.currentY = p.y
          if (active.selecting) setBox(screenRectangle(active.x, active.y, p.x, p.y))
          else { const width = flatScale(size.width, size.height); changeView({ x: active.view.x - (p.x - active.x) / (width * active.view.k), y: active.view.y - (p.y - active.y) / (width / 2 * active.view.k), k: active.view.k }) }
          return
        }
        const pick = flatUnproject(p.x, p.y, size.width, size.height, view)
        const country = findCountryAt(countries, pick.lat, pick.lon)
        setHoverCountry((old) => old === country ? old : country)
        const hotspot = hit(p.x, p.y); setHovered((old) => old?.id === hotspot?.id ? old : hotspot)
      }}
      onPointerUp={(event) => {
        const active = drag.current; if (!active) return
        drag.current = null; const p = local(event); setBox(null)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        const moved = Math.hypot(p.x - active.x, p.y - active.y) > 5
        if (active.selecting && moved) { onSelectionChange?.(flatIdsInRectangle(hotspots, screenRectangle(active.x, active.y, p.x, p.y), size.width, size.height, view), active.shift ? 'add' : 'replace'); return }
        if (moved) return
        const point = hit(p.x, p.y)
        if (point) { if (onSelectionChange) onSelectionChange([point.id], active.shift ? 'toggle' : 'replace'); else onHotspotSelect?.(point.id); return }
        const pick = flatUnproject(p.x, p.y, size.width, size.height, view)
        const country = findCountryAt(countries, pick.lat, pick.lon)
        if (!active.shift && onCountrySelect && country) onCountrySelect(country.name)
        else onPick?.(pick)
      }}
      onPointerCancel={() => { drag.current = null; setBox(null) }}
      onPointerLeave={() => { if (!drag.current) { setHovered(null); setHoverCountry(null) } }}
    />
    {box && <div className="pointer-events-none absolute border border-amber-300 bg-amber-300/15" style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }} />}
    <div className="absolute top-3 right-3 flex flex-col gap-1 rounded-lg border border-white/15 bg-[#070B12]/95 p-1 text-xs">
      <button type="button" aria-label={t('Aproximar mapa', 'Zoom in map')} className="rounded px-3 py-1 hover:bg-white/15" onClick={() => zoom(1.5)}>+</button>
      <button type="button" aria-label={t('Afastar mapa', 'Zoom out map')} className="rounded px-3 py-1 hover:bg-white/15" onClick={() => zoom(1 / 1.5)}>−</button>
      <button type="button" className="rounded px-2 py-1 hover:bg-white/15" onClick={fit}>{t('Ajustar seleção', 'Fit selection')}</button>
      <button type="button" className="rounded px-2 py-1 hover:bg-white/15" onClick={() => changeView(WORLD)}>{t('Mundo', 'World')}</button>
    </div>
    {(hovered || hoverCountry) && <div className="pointer-events-none absolute bottom-7 left-3 max-w-[75%] rounded-lg border border-white/15 bg-[#071a3d]/95 px-3 py-2 text-xs">
      {hoverCountry && <p className="font-semibold">{countryDisplayName(hoverCountry, locale)}</p>}
      {hovered && <><p className="mt-1">{hovered.label}</p><p className="font-mono text-[#9bb0d1]">{hovered.lat.toFixed(2)}°, {hovered.lon.toFixed(2)}°</p></>}
    </div>}
    <p className="pointer-events-none absolute bottom-1 left-3 font-mono text-[9px] text-slate-400">Natural Earth · {view.k.toFixed(1)}×</p>
  </div>
}
