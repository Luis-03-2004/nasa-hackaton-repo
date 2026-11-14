import type { Hotspot } from '../components/webgl/HotspotMarker'

export const GLOBE_HOTSPOTS: Hotspot[] = [
  { id: 'cerrado', lat: -12, lon: -46, color: '#ff4d2e', label: 'Cerrado Central', alertLevel: 'ALERTA_ALTO' },
  { id: 'pantanal', lat: -17.5, lon: -57.2, color: '#ffb020', label: 'Pantanal', alertLevel: 'CRITICO' },
  { id: 'california', lat: 37.5, lon: -120.5, color: '#ffd166', label: 'Califórnia', alertLevel: 'ATENCAO' },
  { id: 'angola', lat: -12.5, lon: 18.5, color: '#ff5a36', label: 'Angola', alertLevel: 'ATENCAO' },
  { id: 'australia', lat: -25.5, lon: 134, color: '#ff7a45', label: 'Austrália', alertLevel: 'NORMAL' },
]

export function nearestHotspot(lat: number, lon: number) {
  return GLOBE_HOTSPOTS.reduce((best, hotspot) => {
    const distance = (hotspot.lat - lat) ** 2 + (hotspot.lon - lon) ** 2
    const bestDistance = (best.lat - lat) ** 2 + (best.lon - lon) ** 2
    return distance < bestDistance ? hotspot : best
  })
}

export function useGlobeHotspots() {
  return { hotspots: GLOBE_HOTSPOTS, nearestHotspot }
}
