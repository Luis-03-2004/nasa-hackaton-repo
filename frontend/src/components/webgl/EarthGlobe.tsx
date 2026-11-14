import { OrbitControls, useTexture } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Color, LinearFilter, LinearMipmapLinearFilter, Quaternion, SRGBColorSpace, Vector3, type Group } from 'three'
import earthMap from '../../assets/earth-map.jpg'
import { latLonToVector3, vector3ToLatLon } from '../../utils/geo'
import { HotspotTooltip, type Hotspot } from './HotspotMarker'

export interface GlobePick { lat: number; lon: number }

// One GPU call for the full catalog. The sphere owns hit testing so points on
// the far hemisphere cannot intercept selection through the earth.
function CatalogPoints({ hotspots }: { hotspots: Hotspot[] }) {
  const { positions, colors } = useMemo(() => {
    const positions = new Float32Array(hotspots.length * 3)
    const colors = new Float32Array(hotspots.length * 3)
    hotspots.forEach((hotspot, index) => {
      latLonToVector3(hotspot.lat, hotspot.lon, 1.003).toArray(positions, index * 3)
      new Color(hotspot.color).toArray(colors, index * 3)
    })
    return { positions, colors }
  }, [hotspots])
  return (
    <points raycast={() => undefined}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial vertexColors size={0.009} sizeAttenuation transparent opacity={0.88} depthWrite={false} />
    </points>
  )
}

function EarthSphere({ onPick, onHover }: { onPick: (point: Vector3) => void; onHover: (point: Vector3 | null) => void }) {
  const source = useTexture(earthMap)
  const gl = useThree((state) => state.gl)
  useLayoutEffect(() => {
    source.colorSpace = SRGBColorSpace
    source.anisotropy = gl.capabilities.getMaxAnisotropy()
    source.minFilter = LinearMipmapLinearFilter
    source.magFilter = LinearFilter
    source.generateMipmaps = true
    source.needsUpdate = true
  }, [source, gl])
  return (
    <mesh
      onClick={(event) => { event.stopPropagation(); onPick(event.object.worldToLocal(event.point.clone())) }}
      onPointerMove={(event) => onHover(event.object.worldToLocal(event.point.clone()))}
      onPointerOut={() => onHover(null)}
    >
      <sphereGeometry args={[1, 128, 128]} />
      <meshStandardMaterial map={source} roughness={1} metalness={0} />
    </mesh>
  )
}

function SelectionRing({ focus }: { focus: GlobePick }) {
  const position = useMemo(() => latLonToVector3(focus.lat, focus.lon, 1.009), [focus.lat, focus.lon])
  const quaternion = useMemo(() => new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), position.clone().normalize()), [position])
  return <mesh position={position} quaternion={quaternion} raycast={() => undefined}><ringGeometry args={[0.014, 0.02, 32]} /><meshBasicMaterial color="#ffffff" depthWrite={false} /></mesh>
}

function GlobeRig({ focus, children }: { focus: GlobePick | null; children: ReactNode }) {
  const group = useRef<Group>(null)
  const target = useMemo(() => new Quaternion(), [])
  const cameraDirection = useMemo(() => new Vector3(), [])
  const { camera } = useThree()
  const settled = useRef(true)
  const focusKey = focus ? `${focus.lat},${focus.lon}` : ''
  useEffect(() => { settled.current = focusKey === '' }, [focusKey])
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

function nearbyIndex(hotspots: Hotspot[]) {
  const buckets = new Map<string, Hotspot[]>()
  hotspots.forEach((point) => {
    const key = `${Math.floor(point.lat)},${Math.floor(point.lon)}`
    const bucket = buckets.get(key) ?? []
    bucket.push(point)
    buckets.set(key, bucket)
  })
  return (lat: number, lon: number) => {
    let nearest: Hotspot | null = null
    let distance = 1.3 ** 2
    // Nearby catalog cells only. Far away points go through the coordinate
    // callback rather than silently snapping to an unrelated region.
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const bucketLon = ((Math.floor(lon) + dx + 540) % 360) - 180
        for (const point of buckets.get(`${Math.floor(lat) + dy},${bucketLon}`) ?? []) {
          let dlon = point.lon - lon
          if (dlon > 180) dlon -= 360
          if (dlon < -180) dlon += 360
          const next = (point.lat - lat) ** 2 + (dlon * Math.cos(lat * Math.PI / 180)) ** 2
          if (next < distance) { nearest = point; distance = next }
        }
      }
    }
    return nearest
  }
}

export function EarthGlobe({ hotspots, onSelect, onHotspotSelect, focus = null }: {
  hotspots: Hotspot[]; onSelect?: (pick: GlobePick) => void; onHotspotSelect?: (id: string) => void; focus?: GlobePick | null
}) {
  const [picked, setPicked] = useState<GlobePick | null>(null)
  const [hovered, setHovered] = useState<Hotspot | null>(null)
  const nearest = useMemo(() => nearbyIndex(hotspots), [hotspots])
  const aim = focus ?? picked
  return (
    <div className="relative h-full w-full" style={{ cursor: hovered ? 'pointer' : 'grab' }}>
      <Canvas camera={{ position: [0, 0.35, 2.8], fov: 42, near: 0.0008, far: 30 }} dpr={[1, 2]} fallback={<p className="p-6 text-sm">WebGL indisponível. Selecione o mapa 2D.</p>}>
        <color attach="background" args={['#04122b']} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[4, 2, 3]} intensity={1.4} />
        <GlobeRig focus={aim}>
          <Suspense fallback={null}>
            <EarthSphere
              onPick={(point) => {
                const next = vector3ToLatLon(point)
                setPicked(next)
                const hotspot = nearest(next.lat, next.lon)
                if (hotspot) onHotspotSelect?.(hotspot.id)
                else onSelect?.(next)
              }}
              onHover={(point) => {
                if (!point) { setHovered(null); return }
                const { lat, lon } = vector3ToLatLon(point)
                setHovered(nearest(lat, lon))
              }}
            />
          </Suspense>
          <CatalogPoints hotspots={hotspots} />
          {aim ? <SelectionRing focus={aim} /> : null}
          {hovered ? <HotspotTooltip hotspot={hovered} /> : null}
        </GlobeRig>
        <OrbitControls enablePan={false} enableDamping rotateSpeed={0.28} zoomSpeed={0.4} minDistance={1.12} maxDistance={8} />
      </Canvas>
      {aim ? <p className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/10 bg-[#071a3d]/80 px-2 py-1 font-mono text-[11px] text-[#f7f9fc]">{aim.lat.toFixed(2)}°, {aim.lon.toFixed(2)}°</p> : null}
    </div>
  )
}
