import { OrbitControls, useTexture } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Quaternion, SRGBColorSpace, Vector3, type Group } from 'three'
import earthMap from '../../assets/earth-map.webp'
import { latLonToVector3, vector3ToLatLon } from '../../utils/geo'
import { HotspotMarker, type Hotspot } from './HotspotMarker'

export interface GlobePick {
  lat: number
  lon: number
}

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

function GlobeRig({ focus, children }: { focus: GlobePick | null; children: ReactNode }) {
  const group = useRef<Group>(null)
  const target = useMemo(() => new Quaternion(), [])
  const cameraDirection = useMemo(() => new Vector3(), [])
  const { camera } = useThree()
  const settled = useRef(true)
  const focusKey = focus ? `${focus.lat},${focus.lon}` : ''

  useEffect(() => {
    settled.current = focusKey === ''
  }, [focusKey])

  useFrame(() => {
    if (!group.current || !focus || settled.current) return
    const point = latLonToVector3(focus.lat, focus.lon).normalize()
    cameraDirection.copy(camera.position).normalize()
    target.setFromUnitVectors(point, cameraDirection)
    group.current.quaternion.slerp(target, 0.12)
    if (group.current.quaternion.angleTo(target) < 0.015) settled.current = true
  })

  return <group ref={group}>{children}</group>
}

export function EarthGlobe({
  hotspots,
  onSelect,
  onHotspotSelect,
  focus = null,
}: {
  hotspots: Hotspot[]
  onSelect?: (pick: GlobePick) => void
  onHotspotSelect?: (id: string) => void
  focus?: GlobePick | null
}) {
  const [picked, setPicked] = useState<GlobePick | null>(null)
  const aim = focus ?? picked

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
        <GlobeRig focus={aim}>
          <Suspense fallback={null}>
            <EarthSphere onPick={handlePick} />
          </Suspense>
          {hotspots.map((hotspot) => (
            <HotspotMarker key={hotspot.id} {...hotspot} onSelect={onHotspotSelect} />
          ))}
          {aim ? <SelectionPin lat={aim.lat} lon={aim.lon} /> : null}
        </GlobeRig>
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
