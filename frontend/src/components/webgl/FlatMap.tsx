import { useEffect, useRef, useState } from 'react'
import earthMap from '../../assets/earth-map.jpg'
import type { CountryShape } from '../../utils/countries'
import type { Hotspot } from './HotspotMarker'
import type { GlobePick } from './EarthGlobe'

function drawBorders(canvas: HTMLCanvasElement, countries: CountryShape[]) {
  const context = canvas.getContext('2d')
  if (!context) return
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = 'rgba(247,249,252,0.35)'
  context.lineWidth = 0.7
  for (const country of countries) {
    for (const polygon of country.polygons) {
      const ring = polygon[0]
      if (!ring) continue
      context.beginPath()
      ring.forEach(([lon, lat], index) => {
        const x = ((lon + 180) / 360) * canvas.width
        const y = ((90 - lat) / 180) * canvas.height
        if (index === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      })
      context.closePath()
      context.stroke()
    }
  }
}

export function FlatMap({ hotspots, countries, selectedId, onPick, onHotspotSelect }: {
  hotspots: Hotspot[]; countries: CountryShape[]; selectedId: string | null; onPick: (pick: GlobePick) => void; onHotspotSelect: (id: string) => void
}) {
  const borders = useRef<HTMLCanvasElement>(null)
  const points = useRef<HTMLCanvasElement>(null)
  const [hovered, setHovered] = useState<Hotspot | null>(null)
  useEffect(() => { if (borders.current) drawBorders(borders.current, countries) }, [countries])
  useEffect(() => {
    const canvas = points.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    // Rasterize all catalog points once per data/selection change; no per-point
    // DOM nodes, event listeners, or React component trees.
    for (const point of hotspots) {
      context.fillStyle = point.color
      context.fillRect((point.lon + 180) / 360 * canvas.width - 1.8, (90 - point.lat) / 180 * canvas.height - 1.8, 3.6, 3.6)
    }
    const selected = hotspots.find((point) => point.id === selectedId)
    if (selected) {
      context.beginPath()
      context.arc((selected.lon + 180) / 360 * canvas.width, (90 - selected.lat) / 180 * canvas.height, 8, 0, 2 * Math.PI)
      context.strokeStyle = '#fff'
      context.lineWidth = 2
      context.stroke()
    }
  }, [hotspots, selectedId])

  function hitTest(clientX: number, clientY: number, canvas: HTMLCanvasElement) {
    const bounds = canvas.getBoundingClientRect()
    const x = clientX - bounds.left
    const y = clientY - bounds.top
    let nearest: Hotspot | null = null
    let distance = 7 ** 2
    for (const point of hotspots) {
      const px = (point.lon + 180) / 360 * bounds.width
      const py = (90 - point.lat) / 180 * bounds.height
      const next = (px - x) ** 2 + (py - y) ** 2
      if (next < distance) { nearest = point; distance = next }
    }
    return { nearest, coordinates: { lat: 90 - y / bounds.height * 180, lon: x / bounds.width * 360 - 180 } }
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-[#04122b]">
      <div className="relative w-full" style={{ aspectRatio: '2 / 1', maxHeight: '100%' }}>
        <img src={earthMap} alt="Mapa-múndi com catálogo de projeções F2 de referência 2025" className="block h-full w-full" draggable={false} />
        <canvas ref={borders} width={2048} height={1024} className="pointer-events-none absolute inset-0 h-full w-full" />
        <canvas
          ref={points} width={2048} height={1024}
          role="img" aria-label={`${hotspots.length} pontos do catálogo F2. Clique para selecionar; coordenadas também disponíveis no formulário.`}
          className="absolute inset-0 h-full w-full" style={{ cursor: hovered ? 'pointer' : 'crosshair' }}
          onClick={(event) => {
            const { nearest, coordinates } = hitTest(event.clientX, event.clientY, event.currentTarget)
            if (nearest) onHotspotSelect(nearest.id)
            else onPick(coordinates)
          }}
          onPointerMove={(event) => setHovered(hitTest(event.clientX, event.clientY, event.currentTarget).nearest)}
          onPointerLeave={() => setHovered(null)}
        />
      </div>
      {hovered ? <div className="pointer-events-none absolute bottom-3 left-3 max-w-72 rounded-lg border border-white/10 bg-[#071a3d]/95 px-3 py-2 text-xs"><p className="font-semibold">{hovered.label}</p><p className="mt-1 font-mono text-[#9bb0d1]">{hovered.lat.toFixed(2)}°, {hovered.lon.toFixed(2)}°</p><p className="mt-1 text-[#9bb0d1]">Catálogo F2 · referência 2025</p></div> : null}
    </div>
  )
}
