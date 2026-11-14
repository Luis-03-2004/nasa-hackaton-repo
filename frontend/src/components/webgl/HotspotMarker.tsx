import { Html } from '@react-three/drei'
import { useMemo } from 'react'
import { AlertBadge } from '../layout/AlertBadge'
import type { LocalForecast } from '../../types/api'
import { latLonToVector3 } from '../../utils/geo'

export interface Hotspot {
  id: string
  lat: number
  lon: number
  color: string
  label: string
  alertLevel: LocalForecast['alert_level']
}

export function HotspotTooltip({ hotspot }: { hotspot: Hotspot }) {
  const position = useMemo(
    () => latLonToVector3(hotspot.lat, hotspot.lon, 1.01),
    [hotspot.lat, hotspot.lon],
  )

  return (
    <Html position={position} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
      <div className="w-44 rounded-lg border border-white/10 bg-[#071a3d]/95 p-2 text-left shadow-xl">
        <p className="text-sm font-semibold text-white">{hotspot.label}</p>
        <p className="mt-1 font-mono text-[10px] text-[#9bb0d1]">
          {hotspot.lat.toFixed(1)}°, {hotspot.lon.toFixed(1)}°
        </p>
        <div className="mt-2">
          <AlertBadge level={hotspot.alertLevel} />
        </div>
      </div>
    </Html>
  )
}
