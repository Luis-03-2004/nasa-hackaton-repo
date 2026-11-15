import { Html } from '@react-three/drei'
import { useMemo } from 'react'
import type { LocalForecast } from '../../types/api'
import { latLonToVector3 } from '../../utils/geo'

export interface Hotspot {
  id: string
  lat: number
  lon: number
  color: string
  label: string
  value?: number
  unit?: string
  country?: string
  alertLevel?: LocalForecast['alert_level']
}

export function HotspotTooltip({ hotspot, locale = 'pt-BR' }: { hotspot: Hotspot; locale?: 'pt-BR' | 'en' }) {
  const position = useMemo(() => latLonToVector3(hotspot.lat, hotspot.lon, 1.02), [hotspot.lat, hotspot.lon])
  return <Html position={position} center occlude zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
    <div className="w-52 rounded-lg border border-white/15 bg-[#071a3d]/95 p-2 text-left shadow-xl">
      <p className="text-xs font-semibold text-white">{hotspot.label}</p>
      <p className="mt-1 font-mono text-[10px] text-[#9bb0d1]">{hotspot.lat.toFixed(2)}°, {hotspot.lon.toFixed(2)}°</p>
      {hotspot.value != null && <p className="mt-1 font-mono text-xs">{new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(hotspot.value)} {hotspot.unit ?? ''}</p>}
    </div>
  </Html>
}
