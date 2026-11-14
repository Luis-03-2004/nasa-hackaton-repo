import { OrbitControls, useTexture } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Group,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import earthMap from '../../assets/earth-map.jpg'
import { latLonToVector3, vector3ToLatLon } from '../../utils/geo'
import { HotspotTooltip, type Hotspot } from './HotspotMarker'

export interface GlobePick {
  lat: number
  lon: number
}

const EARTH_RADIUS_KM = 6371
const KM_PER_DEG = (Math.PI / 180) * EARTH_RADIUS_KM
const HOTSPOT_DIAMETER_KM = 4
const HOTSPOT_RADIUS_KM = HOTSPOT_DIAMETER_KM / 2
const HOTSPOT_SLOTS = 8
const FOV_DEG = 42
const MIN_CAMERA_DISTANCE =
  1 +
  (HOTSPOT_DIAMETER_KM / EARTH_RADIUS_KM) *
    (500 / (4 * ((FOV_DEG * Math.PI) / 180)))

const HOTSPOT_UNIFORMS = /* glsl */ `
uniform int hotspotCount;
uniform float hotspotLat[8];
uniform float hotspotLon[8];
uniform vec3 hotspotColor[8];
uniform float hotspotRadiusKm;
uniform float hotspotDiameterKm;
`

const HOTSPOT_PAINT = /* glsl */ `
{
  float lat = vMapUv.y * 180.0 - 90.0;
  float lon = vMapUv.x * 360.0 - 180.0;
  float cosLat = cos(radians(lat));
  for (int i = 0; i < 8; i++) {
    if (i >= hotspotCount) continue;
    float dLat = lat - hotspotLat[i];
    float dLon = mod(lon - hotspotLon[i] + 540.0, 360.0) - 180.0;
    float northKm = dLat * ${KM_PER_DEG.toFixed(5)};
    float eastKm = dLon * cosLat * ${KM_PER_DEG.toFixed(5)};
    float distKm = length(vec2(eastKm, northKm));
    if (fwidth(distKm) < hotspotDiameterKm && distKm <= hotspotRadiusKm) {
      diffuseColor.rgb = hotspotColor[i];
    }
  }
}
`

function distanceKm(lat: number, lon: number, hotspot: Hotspot) {
  let dLon = hotspot.lon - lon
  if (dLon > 180) dLon -= 360
  if (dLon < -180) dLon += 360
  const north = (hotspot.lat - lat) * KM_PER_DEG
  const east = dLon * Math.cos((lat * Math.PI) / 180) * KM_PER_DEG
  return Math.hypot(north, east)
}

function hotspotNear(hotspots: Hotspot[], lat: number, lon: number) {
  let best: Hotspot | null = null
  let bestDistance = HOTSPOT_RADIUS_KM

  for (const hotspot of hotspots) {
    const distance = distanceKm(lat, lon, hotspot)
    if (distance <= bestDistance) {
      best = hotspot
      bestDistance = distance
    }
  }

  return best
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
  const hotspotUniforms = useMemo(
    () => ({
      hotspotCount: { value: 0 },
      hotspotLat: { value: new Float32Array(HOTSPOT_SLOTS) },
      hotspotLon: { value: new Float32Array(HOTSPOT_SLOTS) },
      hotspotColor: { value: Array.from({ length: HOTSPOT_SLOTS }, () => new Vector3()) },
      hotspotRadiusKm: { value: HOTSPOT_RADIUS_KM },
      hotspotDiameterKm: { value: HOTSPOT_DIAMETER_KM },
    }),
    [],
  )

  useLayoutEffect(() => {
    source.colorSpace = SRGBColorSpace
    source.anisotropy = gl.capabilities.getMaxAnisotropy()
    source.minFilter = LinearMipmapLinearFilter
    source.magFilter = LinearFilter
    source.generateMipmaps = true
    source.needsUpdate = true
  }, [source, gl])

  useLayoutEffect(() => {
    const count = Math.min(hotspots.length, HOTSPOT_SLOTS)
    hotspotUniforms.hotspotCount.value = count
    for (let index = 0; index < count; index += 1) {
      const hotspot = hotspots[index]
      hotspotUniforms.hotspotLat.value[index] = hotspot.lat
      hotspotUniforms.hotspotLon.value[index] = hotspot.lon
      const color = new Color(hotspot.color)
      hotspotUniforms.hotspotColor.value[index].set(color.r, color.g, color.b)
    }
  }, [hotspots, hotspotUniforms])

  const onBeforeCompile = useCallback(
    (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.hotspotCount = hotspotUniforms.hotspotCount
      shader.uniforms.hotspotLat = hotspotUniforms.hotspotLat
      shader.uniforms.hotspotLon = hotspotUniforms.hotspotLon
      shader.uniforms.hotspotColor = hotspotUniforms.hotspotColor
      shader.uniforms.hotspotRadiusKm = hotspotUniforms.hotspotRadiusKm
      shader.uniforms.hotspotDiameterKm = hotspotUniforms.hotspotDiameterKm
      const withUniforms = shader.fragmentShader.replace(
        'void main() {',
        `${HOTSPOT_UNIFORMS}\nvoid main() {`,
      )
      const withPaint = withUniforms.replace(
        '#include <map_fragment>',
        `#include <map_fragment>\n${HOTSPOT_PAINT}`,
      )
      if (withPaint === shader.fragmentShader) {
        console.error('Hotspot paint was not injected into the earth shader.')
      }
      shader.fragmentShader = withPaint
    },
    [hotspotUniforms],
  )

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
      <sphereGeometry args={[1, 256, 256]} />
      <meshStandardMaterial
        map={source}
        roughness={1}
        metalness={0}
        onBeforeCompile={onBeforeCompile}
        customProgramCacheKey={() => 'earth-hotspot-1km'}
      />
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
      <Canvas camera={{ position: [0, 0.35, 2.8], fov: FOV_DEG, near: 0.0008, far: 30 }} dpr={[1, 2]}>
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
          minDistance={MIN_CAMERA_DISTANCE}
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
