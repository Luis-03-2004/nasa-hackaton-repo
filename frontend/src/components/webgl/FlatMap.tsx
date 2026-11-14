import { useEffect, useRef } from 'react'
import earthMap from '../../assets/earth-map.jpg'
import type { CountryShape } from '../../utils/countries'
import type { Hotspot } from './HotspotMarker'
import type { GlobePick } from './EarthGlobe'

function drawBorders(canvas: HTMLCanvasElement, countries: CountryShape[]) {
  const context = canvas.getContext('2d')
  if (!context) return
  const width = canvas.width
  const height = canvas.height
  context.clearRect(0, 0, width, height)
  context.strokeStyle = 'rgba(247, 249, 252, 0.55)'
  context.lineWidth = 1
  for (const country of countries) {
    for (const polygon of country.polygons) {
      const ring = polygon[0]
      if (!ring) continue
      context.beginPath()
      ring.forEach(([lon, lat], index) => {
        const x = ((lon + 180) / 360) * width
        const y = ((90 - lat) / 180) * height
        if (index === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      })
      context.closePath()
      context.stroke()
    }
  }
}

export function FlatMap({
  hotspots,
  countries,
  selectedId,
  onPick,
  onHotspotSelect,
}: {
  hotspots: Hotspot[]
  countries: CountryShape[]
  selectedId: string | null
  onPick: (pick: GlobePick) => void
  onHotspotSelect: (id: string) => void
}) {
  const borders = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (borders.current) drawBorders(borders.current, countries)
  }, [countries])

  return (
    <div className="flex h-full w-full items-center justify-center bg-[#04122b]">
      <div className="relative aspect-[2/1] max-h-full max-w-full">
        <img
          src={earthMap}
          alt="World map"
          className="block h-full w-full"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect()
            const x = (event.clientX - bounds.left) / bounds.width
            const y = (event.clientY - bounds.top) / bounds.height
            onPick({ lat: 90 - y * 180, lon: x * 360 - 180 })
          }}
        />
        <canvas
          ref={borders}
          width={2048}
          height={1024}
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
        {hotspots.map((hotspot) => {
          const selected = hotspot.id === selectedId
          return (
            <button
              key={hotspot.id}
              type="button"
              aria-label={hotspot.label}
              onClick={(event) => {
                event.stopPropagation()
                onHotspotSelect(hotspot.id)
              }}
              className={`absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_6px_rgba(252,61,33,0.35)] ${
                selected ? 'scale-125' : ''
              }`}
              style={{
                left: `${((hotspot.lon + 180) / 360) * 100}%`,
                top: `${((90 - hotspot.lat) / 180) * 100}%`,
                background: hotspot.color,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
