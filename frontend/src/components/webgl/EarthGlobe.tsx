import { OrbitControls, useTexture } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense, useLayoutEffect, useState } from 'react'
import { SRGBColorSpace, type Vector3 } from 'three'
import earthMap from '../../assets/earth-map.webp'
import { latLonToVector3, vector3ToLatLon } from '../../utils/geo'
import { HotspotMarker, type Hotspot } from './HotspotMarker'

export interface GlobePick {
  lat: number
  lon: number
}

const MOCK_HOTSPOTS: Hotspot[] = [
  { id: 'cerrado', lat: -12, lon: -46, color: '#ff4d2e', label: 'Cerrado Central', alertLevel: 'ALERTA_ALTO' },
  { id: 'amazonia', lat: -5.2, lon: -60.5, color: '#ff8a3d', label: 'Arco Amazônico', alertLevel: 'ATENCAO' },
  { id: 'pantanal', lat: -17.5, lon: -57.2, color: '#ffb020', label: 'Pantanal', alertLevel: 'CRITICO' },
  { id: 'california', lat: 37.5, lon: -120.5, color: '#ffd166', label: 'Califórnia', alertLevel: 'ATENCAO' },
  { id: 'angola', lat: -12.5, lon: 18.5, color: '#ff5a36', label: 'Angola', alertLevel: 'ATENCAO' },
  { id: 'australia', lat: -25.5, lon: 134, color: '#ff7a45', label: 'Austrália', alertLevel: 'NORMAL' },
]

function EarthSphere({ onPick }: { onPick: (point: Vector3) => void }) {
  const texture = useTexture(earthMap)

  useLayoutEffect(() => {
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 8
    texture.needsUpdate = true
  }, [texture])

  return (
    <mesh
      onClick={(event) => {
        event.stopPropagation()
        onPick(event.object.worldToLocal(event.point.clone()))
      }}
    >
      <sphereGeometry args={[1, 96, 96]} />
      <meshStandardMaterial map={texture} roughness={1} metalness={0} />
    </mesh>
  )
}

function SelectionPin({ lat, lon }: GlobePick) {
  return (
    <mesh position={latLonToVector3(lat, lon, 1.02)}>
      <sphereGeometry args={[0.016, 16, 16]} />
      <meshBasicMaterial color="#f4f7fb" />
    </mesh>
  )
}

export function EarthGlobe({ onSelect }: { onSelect?: (pick: GlobePick) => void }) {
  const [picked, setPicked] = useState<GlobePick | null>(null)

  function handlePick(point: Vector3) {
    const next = vector3ToLatLon(point)
    setPicked(next)
    onSelect?.(next)
  }

  return (
    <div className="relative h-full w-full">
      <Canvas camera={{ position: [0, 0.35, 2.8], fov: 42 }} dpr={[1, 2]}>
        <color attach="background" args={['#0b0f17']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[4, 2, 3]} intensity={1.8} />
        <Suspense fallback={null}>
          <EarthSphere onPick={handlePick} />
        </Suspense>
        {MOCK_HOTSPOTS.map((hotspot) => (
          <HotspotMarker key={hotspot.id} {...hotspot} />
        ))}
        {picked ? <SelectionPin lat={picked.lat} lon={picked.lon} /> : null}
        <OrbitControls
          enablePan={false}
          enableDamping
          minDistance={1.5}
          maxDistance={6}
        />
      </Canvas>
      {picked ? (
        <p className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/10 bg-[#0e1420]/80 px-2 py-1 font-mono text-[11px] text-[#f4f7fb]">
          {picked.lat.toFixed(2)}°, {picked.lon.toFixed(2)}°
        </p>
      ) : null}
    </div>
  )
}
