import type { Hotspot } from '../components/webgl/HotspotMarker'

export const GLOBE_HOTSPOTS: Hotspot[] = [
  { id: 'cerrado', lat: -12, lon: -46, color: '#fc3d21', label: 'Central Cerrado', alertLevel: 'HIGH_ALERT' },
  { id: 'pantanal', lat: -17.5, lon: -57.2, color: '#ffffff', label: 'Pantanal', alertLevel: 'CRITICAL' },
  { id: 'california', lat: 37.5, lon: -120.5, color: '#ff8f7a', label: 'California', alertLevel: 'WATCH' },
  { id: 'angola', lat: -12.5, lon: 18.5, color: '#fc3d21', label: 'Angola', alertLevel: 'WATCH' },
  { id: 'australia', lat: -25.5, lon: 134, color: '#d6e4ff', label: 'Australia', alertLevel: 'NORMAL' },
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
