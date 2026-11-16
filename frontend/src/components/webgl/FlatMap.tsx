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
  focus?: GlobePick | null
  gpsPoint?: GlobePick | null
  onPick?: (pick: GlobePick) => void
  onHotspotSelect?: (id: string) => void
  onSelectionChange?: (ids: string[], mode: SelectionOperation) => void
  onCountrySelect?: (name: string) => void
  onResetWorld?: () => void
  selectionMode?: boolean
  heatmap?: boolean
  locale?: 'pt-BR' | 'en'
  pointOpacity?: number
  viewState?: FlatViewState
  onViewStateChange?: (view: FlatViewState) => void
}

export function FlatMap({ hotspots, countries = [], selectedId = null, selectedIds = [], focus = null, gpsPoint = null, onPick, onHotspotSelect, onSelectionChange, onCountrySelect, onResetWorld, selectionMode = false, heatmap = false, locale = 'en', pointOpacity = .94, viewState, onViewStateChange }: Props) {
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
  const drag = useRef<{ x: number; y: number; currentX: number; currentY: number; selecting: boolean; view: FlatViewState; shift: boolean; ctrl: boolean } | null>(null)
  const lastHoverTime = useRef(0)
  const t = (pt: string, en: string) => locale === 'pt-BR' ? pt : en
  const changeView = useCallback((next: FlatViewState) => {
    const value = { x: Math.max(-.5, Math.min(.5, next.x)), y: Math.max(-.5, Math.min(.5, next.y)), k: Math.max(1, Math.min(64, next.k)) }
    setOwnView(value); onViewStateChange?.(value)
  }, [onViewStateChange])

  const focusKey = focus ? `${focus.lat},${focus.lon},${focus.seq ?? 0}` : ''
  useEffect(() => {
    if (!focus) return
    changeView({
      x: Math.max(-0.5, Math.min(0.5, focus.lon / 360)),
      y: Math.max(-0.5, Math.min(0.5, -focus.lat / 180)),
      k: Math.max(view.k, 3.5),
    })
  }, [focusKey])

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
    const visibleWraps = wraps.filter((wrap) => {
      const corner = flatProject(90, -180, size.width, size.height, view, wrap)
      return corner.x + width >= -20 && corner.x <= size.width + 20
    })

    for (const wrap of visibleWraps) {
      const corner = flatProject(90, -180, size.width, size.height, view, wrap)
      if (imageReady && image.current) { ctx.globalAlpha = heatmap ? .28 : .85; ctx.drawImage(image.current, corner.x, corner.y, width, height); ctx.globalAlpha = 1 }
    }
    function appendCountryPath(country: CountryShape, wrap: number) {
      for (const polygon of preparedCountry(country)) for (const ring of polygon.rings) {
        ring.forEach(([lon, lat], index) => { const p = flatProject(lat, lon, size.width, size.height, view, wrap); if (!index) ctx!.moveTo(p.x, p.y); else ctx!.lineTo(p.x, p.y) }); ctx!.closePath()
      }
    }
    // Batch all country borders into a single stroke call for 60 FPS panning
    ctx.beginPath()
    for (const country of countries) for (const wrap of visibleWraps) {
      appendCountryPath(country, wrap)
    }
    ctx.strokeStyle = 'rgba(226,232,240,.42)'; ctx.lineWidth = .6; ctx.stroke()

    const selected = new Set([...selectedIds, ...(selectedId ? [selectedId] : [])])
    const cell = Math.max(1.5, width / 360)
    const dotSize = Math.min(7, Math.max(2.2, cell * .46))
    ctx.globalAlpha = heatmap ? pointOpacity : 1
    for (const point of hotspots) for (const wrap of visibleWraps) {
      const p = flatProject(point.lat, point.lon, size.width, size.height, view, wrap)
      if (p.x < -10 || p.x > size.width + 10 || p.y < -10 || p.y > size.height + 10) continue
      ctx.fillStyle = point.color
      if (heatmap) {
        ctx.fillRect(p.x - cell / 2, p.y - cell / 2, cell + .2, cell + .2)
      } else {
        ctx.fillRect(p.x - dotSize / 2, p.y - dotSize / 2, dotSize, dotSize)
      }
      if (selected.has(point.id)) {
        ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.6
        ctx.strokeRect(p.x - Math.max(3, cell / 2), p.y - Math.max(3, cell / 2), Math.max(6, cell), Math.max(6, cell))
      }
    }
    ctx.globalAlpha = 1
    if (hoverCountry) for (const wrap of visibleWraps) {
      ctx.beginPath()
      appendCountryPath(hoverCountry, wrap)
      ctx.fillStyle = 'rgba(56,189,248,.13)'; ctx.fill('evenodd')
      ctx.strokeStyle = '#7dd3fc'; ctx.lineWidth = 1.4; ctx.stroke()
    }
    // Render distinct highlighted GPS marker on top
    if (gpsPoint) {
      for (const wrap of visibleWraps) {
        const gp = flatProject(gpsPoint.lat, gpsPoint.lon, size.width, size.height, view, wrap)
        if (gp.x < -30 || gp.x > size.width + 30 || gp.y < -30 || gp.y > size.height + 30) continue
        ctx.beginPath()
        ctx.arc(gp.x, gp.y, 12, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(0, 245, 212, 0.25)'
        ctx.fill()
        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 1.8
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(gp.x, gp.y, 5, 0, Math.PI * 2)
        ctx.fillStyle = '#00f5d4'
        ctx.fill()
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5
        ctx.stroke()

        ctx.font = '600 10px "IBM Plex Mono", monospace'
        const label = 'GPS'
        const tw = ctx.measureText(label).width
        ctx.fillStyle = 'rgba(7, 26, 61, 0.92)'
        ctx.fillRect(gp.x + 8, gp.y - 10, tw + 10, 18)
        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 1
        ctx.strokeRect(gp.x + 8, gp.y - 10, tw + 10, 18)
        ctx.fillStyle = '#a5f3fc'
        ctx.fillText(label, gp.x + 13, gp.y + 2)
      }
    }
  }, [hotspots, countries, selectedId, selectedIds, hoverCountry, gpsPoint, size, view, imageReady, heatmap, pointOpacity])

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
        const p = local(event); const ctrl = event.ctrlKey || event.metaKey; const selecting = (event.shiftKey || selectionMode) && !ctrl
        drag.current = { ...p, currentX: p.x, currentY: p.y, selecting, view: { ...view }, shift: event.shiftKey, ctrl }
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
        const now = performance.now()
        if (now - lastHoverTime.current < 35) return
        lastHoverTime.current = now
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
        const pick = flatUnproject(p.x, p.y, size.width, size.height, view)
        const isCtrl = active.ctrl || event.ctrlKey || event.metaKey
        if (isCtrl) {
          const countryName = point?.country || findCountryAt(countries, point?.lat ?? pick.lat, point?.lon ?? pick.lon)?.name
          if (countryName && onCountrySelect) onCountrySelect(countryName)
          return
        }
        if (point) {
          if (onSelectionChange) onSelectionChange([point.id], active.shift ? 'toggle' : 'replace')
          else onHotspotSelect?.(point.id)
          return
        }
        if (!active.shift) onPick?.(pick)
      }}
      onPointerCancel={() => { drag.current = null; setBox(null) }}
      onPointerLeave={() => { if (!drag.current) { setHovered(null); setHoverCountry(null) } }}
    />
    {box && <div className="pointer-events-none absolute border border-amber-300 bg-amber-300/15" style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }} />}
    <div className="absolute top-3 right-3 flex flex-col gap-1 rounded-lg border border-white/15 bg-[#070B12]/95 p-1 text-xs">
      <button type="button" aria-label={t('Aproximar mapa', 'Zoom in map')} className="rounded px-3 py-1 hover:bg-white/15" onClick={() => zoom(1.5)}>+</button>
      <button type="button" aria-label={t('Afastar mapa', 'Zoom out map')} className="rounded px-3 py-1 hover:bg-white/15" onClick={() => zoom(1 / 1.5)}>−</button>
      <button type="button" className="rounded px-2 py-1 hover:bg-white/15" onClick={fit}>{t('Ajustar seleção', 'Fit selection')}</button>
      <button type="button" className="rounded px-2 py-1 hover:bg-white/15" onClick={() => { changeView(WORLD); onResetWorld?.() }}>{t('Mundo', 'World')}</button>
    </div>
    {(hovered || hoverCountry) && <div className="pointer-events-none absolute bottom-7 left-3 max-w-[75%] rounded-lg border border-white/15 bg-[#071a3d]/95 px-3 py-2 text-xs">
      {hoverCountry && <p className="font-semibold">{countryDisplayName(hoverCountry, locale)}</p>}
      {hovered && <><p className="mt-1">{hovered.label}</p><p className="font-mono text-[#9bb0d1]">{hovered.lat.toFixed(2)}°, {hovered.lon.toFixed(2)}°</p></>}
      <p className="mt-1 text-[10px] text-slate-400">{t('Clique: ponto · Ctrl+Clique: país', 'Click: point · Ctrl+Click: country')}</p>
    </div>}
    <p className="pointer-events-none absolute bottom-1 left-3 font-mono text-[9px] text-slate-400">Natural Earth · {view.k.toFixed(1)}×</p>
  </div>
}
