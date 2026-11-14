import { OrbitControls, useTexture } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Group,
} from 'three'
import earthMap from '../../assets/earth-map.webp'
import { latLonToVector3, vector3ToLatLon } from '../../utils/geo'
import { HotspotTooltip, type Hotspot } from './HotspotMarker'

export interface GlobePick {
  lat: number
  lon: number
}

const DOT_RADIUS_PX = 3

function hotspotNear(hotspots: Hotspot[], lat: number, lon: number, maxDeg = 3) {
  const limit = maxDeg * maxDeg
  let best: Hotspot | null = null
  let bestDistance = limit

  for (const hotspot of hotspots) {
    let dLon = hotspot.lon - lon
    if (dLon > 180) dLon -= 360
    if (dLon < -180) dLon += 360
    const distance = (hotspot.lat - lat) ** 2 + dLon ** 2
    if (distance <= bestDistance) {
      best = hotspot
      bestDistance = distance
    }
  }

  return best
}

function paintEarth(image: HTMLImageElement, hotspots: Hotspot[]) {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) return canvas

  context.drawImage(image, 0, 0)

  for (const hotspot of hotspots) {
    const x = ((hotspot.lon + 180) / 360) * canvas.width
    const y = ((90 - hotspot.lat) / 180) * canvas.height
    context.beginPath()
    context.fillStyle = hotspot.color
    context.arc(x, y, DOT_RADIUS_PX, 0, Math.PI * 2)
    context.fill()
  }

  return canvas
}

function EarthSphere({
  hotspots,
  onPick,
  onHover,
}: {
  hotspots: Hotspot[]
  onPick: (point: Vector3) => void
  onHover: (hotspot: Hotspot | null) => void
}) {
  const source = useTexture(earthMap)
  const gl = useThree((state) => state.gl)
  const [painted, setPainted] = useState<CanvasTexture | null>(null)
  const paintRef = useRef(hotspots)
  const paintKey = hotspots
    .map((hotspot) => `${hotspot.id}:${hotspot.lat}:${hotspot.lon}:${hotspot.color}`)
    .join('|')

  useLayoutEffect(() => {
    paintRef.current = hotspots
  })

  useLayoutEffect(() => {
    source.colorSpace = SRGBColorSpace
    source.anisotropy = gl.capabilities.getMaxAnisotropy()
    source.minFilter = LinearMipmapLinearFilter
    source.magFilter = LinearFilter
    source.generateMipmaps = true
    source.needsUpdate = true
  }, [source, gl])

  useEffect(() => {
    const image = source.image as HTMLImageElement | undefined
    if (!image?.naturalWidth) return

    const canvas = paintEarth(image, paintRef.current)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = gl.capabilities.getMaxAnisotropy()
    texture.minFilter = LinearMipmapLinearFilter
    texture.magFilter = LinearFilter
    texture.generateMipmaps = true
    texture.needsUpdate = true
    setPainted(texture)

    return () => texture.dispose()
  }, [source, gl, paintKey])

  function hoverAt(point: Vector3) {
    const { lat, lon } = vector3ToLatLon(point)
    const hotspot = hotspotNear(hotspots, lat, lon)
    onHover(hotspot)
    document.body.style.cursor = hotspot ? 'pointer' : 'auto'
  }

  return (
    <mesh
      onClick={(event) => {
        event.stopPropagation()
        onPick(event.object.worldToLocal(event.point.clone()))
      }}
      onPointerMove={(event) => {
        hoverAt(event.object.worldToLocal(event.point.clone()))
      }}
      onPointerOut={() => {
        onHover(null)
        document.body.style.cursor = 'auto'
      }}
    >
      <sphereGeometry args={[1, 128, 128]} />
      <meshStandardMaterial map={painted ?? source} roughness={1} metalness={0} />
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
  const [hovered, setHovered] = useState<Hotspot | null>(null)
  const aim = focus ?? picked

  function handlePick(point: Vector3) {
    const next = vector3ToLatLon(point)
    setPicked(next)
    const hotspot = hotspotNear(hotspots, next.lat, next.lon)
    if (hotspot) onHotspotSelect?.(hotspot.id)
    else onSelect?.(next)
  }

  return (
    <div className="relative h-full w-full">
      <Canvas camera={{ position: [0, 0.35, 2.8], fov: 42 }} dpr={[1, 2]}>
        <color attach="background" args={['#04122b']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[4, 2, 3]} intensity={1.8} />
        <GlobeRig focus={aim}>
          <Suspense fallback={null}>
            <EarthSphere hotspots={hotspots} onPick={handlePick} onHover={setHovered} />
          </Suspense>
          {hovered ? <HotspotTooltip hotspot={hovered} /> : null}
        </GlobeRig>
        <OrbitControls
          enablePan={false}
          enableDamping
          rotateSpeed={0.28}
          zoomSpeed={0.4}
          minDistance={1.12}
          maxDistance={8}
        />
      </Canvas>
      {aim ? (
        <p className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/10 bg-[#071a3d]/80 px-2 py-1 font-mono text-[11px] text-[#f7f9fc]">
          {aim.lat.toFixed(2)}°, {aim.lon.toFixed(2)}°
        </p>
      ) : null}
    </div>
  )
}
