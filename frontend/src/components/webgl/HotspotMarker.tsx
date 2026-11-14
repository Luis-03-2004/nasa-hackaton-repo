import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import { DoubleSide, Quaternion, Vector3, type Mesh } from 'three'
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

export function HotspotMarker({
  id,
  lat,
  lon,
  color,
  label,
  alertLevel,
  onSelect,
}: Hotspot & { onSelect?: (id: string) => void }) {
  const ring = useRef<Mesh>(null)
  const [hovered, setHovered] = useState(false)
  const placement = useMemo(() => {
    const position = latLonToVector3(lat, lon, 1.012)
    const quaternion = new Quaternion().setFromUnitVectors(
      new Vector3(0, 0, 1),
      position.clone().normalize(),
    )
    return { position, quaternion }
  }, [lat, lon])

  useFrame(({ clock }) => {
    const scale = 1 + Math.sin(clock.elapsedTime * 2.2) * 0.15
    ring.current?.scale.setScalar(scale)
  })

  return (
    <group
      position={placement.position}
      quaternion={placement.quaternion}
      onPointerOver={(event) => {
        event.stopPropagation()
        setHovered(true)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        setHovered(false)
        document.body.style.cursor = 'auto'
      }}
      onClick={(event) => {
        event.stopPropagation()
        onSelect?.(id)
      }}
    >
      <mesh>
        <sphereGeometry args={[0.012, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh ref={ring}>
        <ringGeometry args={[0.02, 0.03, 32]} />
        <meshBasicMaterial color={color} side={DoubleSide} transparent opacity={0.9} />
      </mesh>
      {hovered ? (
        <Html position={[0, 0, 0.08]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
          <div className="w-44 rounded-lg border border-white/10 bg-[#071a3d]/95 p-2 text-left shadow-xl">
            <p className="text-sm font-semibold text-white">{label}</p>
            <p className="mt-1 font-mono text-[10px] text-[#9bb0d1]">
              {lat.toFixed(1)}°, {lon.toFixed(1)}°
            </p>
            <div className="mt-2">
              <AlertBadge level={alertLevel} />
            </div>
          </div>
        </Html>
      ) : null}
    </group>
  )
}
