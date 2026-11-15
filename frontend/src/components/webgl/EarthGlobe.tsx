import { OrbitControls, useTexture } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { CanvasTexture, Color, DoubleSide, LinearFilter, Quaternion, Raycaster, Sphere, SRGBColorSpace, Vector2, Vector3, type Group } from 'three'
import earthMap from '../../assets/earth-map.jpg'
import { countryDisplayName, findCountryAt, preparedCountry, type CountryShape } from '../../utils/countries'
import { latLonToVector3, vector3ToLatLon } from '../../utils/geo'
import { insideRectangle, screenRectangle, type GlobeViewState, type ScreenRectangle, type SelectionOperation } from '../../utils/mapSelection'
import type { Hotspot } from './HotspotMarker'

export interface GlobePick { lat: number; lon: number }
interface Props {
  hotspots: Hotspot[]
  countries?: CountryShape[]
  onSelect?: (pick: GlobePick) => void
  onHotspotSelect?: (id: string) => void
  focus?: GlobePick | null
  selectedIds?: string[]
  onSelectionChange?: (ids: string[], mode: SelectionOperation) => void
  onCountrySelect?: (name: string) => void
  selectionMode?: boolean
  heatmap?: boolean
  locale?: 'pt-BR' | 'en'
  pointOpacity?: number
  globeViewState?: GlobeViewState
  onGlobeViewStateChange?: (view: GlobeViewState) => void
}
interface SceneActions { selectBox: (rect: ScreenRectangle) => string[]; pick: (x: number, y: number) => GlobePick | null; zoom: (factor: number) => void; reset: () => void }

function CatalogPoints({ hotspots, heatmap, pointOpacity }: { hotspots: Hotspot[]; heatmap: boolean; pointOpacity: number }) {
  const { positions, colors } = useMemo(() => {
    const coordinates: number[] = [], rgb: number[] = []
    for (const point of hotspots) {
      const color = new Color(point.color)
      const p = latLonToVector3(point.lat, point.lon, 1.005)
      if (!heatmap) { coordinates.push(...p.toArray()); rgb.push(color.r, color.g, color.b); continue }
      const corners = [
        latLonToVector3(Math.max(-90, point.lat - .5), point.lon - .5, 1.006),
        latLonToVector3(Math.max(-90, point.lat - .5), point.lon + .5, 1.006),
        latLonToVector3(Math.min(90, point.lat + .5), point.lon + .5, 1.006),
        latLonToVector3(Math.min(90, point.lat + .5), point.lon - .5, 1.006),
      ]
      for (const corner of [0, 1, 2, 0, 2, 3]) { coordinates.push(...corners[corner].toArray()); rgb.push(color.r, color.g, color.b) }
    }
    return { positions: new Float32Array(coordinates), colors: new Float32Array(rgb) }
  }, [hotspots, heatmap])
  const geometry = <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /><bufferAttribute attach="attributes-color" args={[colors, 3]} /></bufferGeometry>
  return <>
    {heatmap ? <mesh raycast={() => undefined}>{geometry}<meshBasicMaterial vertexColors side={DoubleSide} transparent opacity={pointOpacity} depthWrite={false} /></mesh>
      : <points raycast={() => undefined}>{geometry}<pointsMaterial vertexColors size={.009} sizeAttenuation transparent opacity={.95} depthWrite={false} /></points>}
  </>
}

function borderPositions(countries: CountryShape[]) {
  const points: number[] = []
  for (const country of countries) for (const polygon of country.polygons) for (const ring of polygon) {
    for (let i = 1; i < ring.length; i += 1) {
      const [lon, lat] = ring[i - 1]
      let nextLon = ring[i][0]
      const nextLat = ring[i][1]
      while (nextLon - lon > 180) nextLon -= 360
      while (nextLon - lon < -180) nextLon += 360
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(nextLon - lon), Math.abs(nextLat - lat))))
      for (let s = 0; s < steps; s += 1) {
        const start = s / steps, end = (s + 1) / steps
        points.push(...latLonToVector3(lat + (nextLat - lat) * start, lon + (nextLon - lon) * start, 1.009).toArray(), ...latLonToVector3(lat + (nextLat - lat) * end, lon + (nextLon - lon) * end, 1.009).toArray())
      }
    }
  }
  return new Float32Array(points)
}

function CountryBorders({ countries, highlighted }: { countries: CountryShape[]; highlighted: CountryShape | null }) {
  const positions = useMemo(() => borderPositions(countries), [countries])
  const highlight = useMemo(() => borderPositions(highlighted ? [highlighted] : []), [highlighted])
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 1024
    const image = new CanvasTexture(canvas); image.colorSpace = SRGBColorSpace
    return image
  }, [])
  useEffect(() => () => texture.dispose(), [texture])
  useEffect(() => {
    const canvas = texture.image as HTMLCanvasElement, ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (highlighted) {
      ctx.fillStyle = 'rgba(56,189,248,.22)'
      for (const offset of [-360, 0, 360]) {
        ctx.beginPath()
        for (const polygon of preparedCountry(highlighted)) for (const ring of polygon.rings) {
          ring.forEach(([lon, lat], i) => { const x = (lon + offset + 180) / 360 * canvas.width, y = (90 - lat) / 180 * canvas.height; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y) }); ctx.closePath()
        }
        ctx.fill('evenodd')
      }
    }
    texture.needsUpdate = true
  }, [highlighted, texture])
  return <>
    <lineSegments raycast={() => undefined}><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><lineBasicMaterial color="#cbd5e1" transparent opacity={.48} depthWrite={false} /></lineSegments>
    <lineSegments raycast={() => undefined}><bufferGeometry><bufferAttribute attach="attributes-position" args={[highlight, 3]} /></bufferGeometry><lineBasicMaterial color="#7dd3fc" depthWrite={false} /></lineSegments>
    <mesh raycast={() => undefined}><sphereGeometry args={[1.01, 96, 96]} /><meshBasicMaterial map={texture} transparent depthWrite={false} /></mesh>
  </>
}

function EarthSphere({ heatmap, onPick, onHover }: { heatmap: boolean; onPick: (point: Vector3) => void; onHover: (point: Vector3 | null) => void }) {
  const texture = useTexture(earthMap)
  const gl = useThree((state) => state.gl)
  useLayoutEffect(() => { texture.colorSpace = SRGBColorSpace; texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy()); texture.magFilter = LinearFilter; texture.needsUpdate = true }, [texture, gl])
  return <mesh
    onClick={(event) => { event.stopPropagation(); onPick(event.object.worldToLocal(event.point.clone())) }}
    onPointerMove={(event) => onHover(event.object.worldToLocal(event.point.clone()))}
    onPointerOut={() => onHover(null)}
  ><sphereGeometry args={[1, 128, 128]} /><meshStandardMaterial map={texture} color={heatmap ? '#657184' : '#ffffff'} roughness={1} metalness={0} /></mesh>
}

function nearestHotspot(hotspots: Hotspot[], lat: number, lon: number) {
  let point: Hotspot | null = null, best = 1.25 ** 2
  for (const item of hotspots) {
    let dlon = item.lon - lon
    if (dlon > 180) dlon -= 360
    if (dlon < -180) dlon += 360
    const distance = (item.lat - lat) ** 2 + (dlon * Math.cos(lat * Math.PI / 180)) ** 2
    if (distance < best) { point = item; best = distance }
  }
  return point
}

function Scene({ hotspots, countries, focus, selectedIds, heatmap, pointOpacity, selecting, highlighted, setHover, choose, actions, globeViewState, onGlobeViewStateChange }: {
  hotspots: Hotspot[]; countries: CountryShape[]; focus: GlobePick | null; selectedIds: string[]; heatmap: boolean; pointOpacity: number; selecting: boolean; highlighted: CountryShape | null
  setHover: (point: Hotspot | null, country: CountryShape | null) => void
  choose: (pick: GlobePick) => void
  actions: MutableRefObject<SceneActions | null>
  globeViewState?: GlobeViewState
  onGlobeViewStateChange?: (view: GlobeViewState) => void
}) {
  const group = useRef<Group>(null)
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null)
  const { camera, size } = useThree()
  const target = useMemo(() => new Quaternion(), [])
  const settling = useRef(false)
  const lastPublished = useRef('')
  const lastTime = useRef(0)
  const externalKey = globeViewState ? JSON.stringify(globeViewState) : ''
  const focusKey = focus ? `${focus.lat},${focus.lon}` : ''
  useEffect(() => { settling.current = !!focusKey }, [focusKey])
  useEffect(() => {
    if (!globeViewState || !group.current) return
    camera.position.fromArray(globeViewState.position)
    group.current.quaternion.fromArray(globeViewState.quaternion)
    camera.lookAt(0, 0, 0); controls.current?.update()
    lastPublished.current = externalKey
  }, [externalKey, globeViewState, camera])
  useFrame(({ clock }) => {
    if (!group.current) return
    if (settling.current && focus && !selecting) {
      target.setFromUnitVectors(latLonToVector3(focus.lat, focus.lon).normalize(), camera.position.clone().normalize())
      group.current.quaternion.slerp(target, .15)
      if (group.current.quaternion.angleTo(target) < .006) settling.current = false
    }
    if (onGlobeViewStateChange && clock.elapsedTime - lastTime.current > .08) {
      const view: GlobeViewState = { position: camera.position.toArray() as [number, number, number], quaternion: group.current.quaternion.toArray() as [number, number, number, number] }
      const key = JSON.stringify(view)
      if (key !== lastPublished.current) { lastPublished.current = key; lastTime.current = clock.elapsedTime; onGlobeViewStateChange(view) }
    }
  })
  useEffect(() => {
    actions.current = {
      selectBox(rect) {
        if (!group.current) return []
        group.current.updateWorldMatrix(true, false)
        const result = new Set<string>()
        for (const point of hotspots) {
          const world = group.current.localToWorld(latLonToVector3(point.lat, point.lon, 1.005))
          if (world.dot(camera.position.clone().sub(world)) <= 0) continue
          const projected = world.clone().project(camera)
          if (projected.z < -1 || projected.z > 1) continue
          const x = (projected.x + 1) / 2 * size.width, y = (1 - projected.y) / 2 * size.height
          if (insideRectangle(x, y, rect)) result.add(point.id)
        }
        return [...result]
      },
      pick(x, y) {
        if (!group.current) return null
        const raycaster = new Raycaster(); raycaster.setFromCamera(new Vector2(x / size.width * 2 - 1, 1 - y / size.height * 2), camera)
        const hit = raycaster.ray.intersectSphere(new Sphere(new Vector3(), 1), new Vector3())
        return hit ? vector3ToLatLon(group.current.worldToLocal(hit)) : null
      },
      zoom(factor) {
        settling.current = false
        const next = Math.max(1.12, Math.min(8, camera.position.length() * factor))
        camera.position.setLength(next); camera.lookAt(0, 0, 0); controls.current?.update()
      },
      reset() {
        settling.current = false
        camera.position.set(0, .35, 2.8); group.current?.quaternion.identity(); camera.lookAt(0, 0, 0); controls.current?.update()
      },
    }
    return () => { actions.current = null }
  }, [actions, camera, hotspots, size])
  const selectionPositions = useMemo(() => { const ids = new Set(selectedIds); return new Float32Array(hotspots.filter((point) => ids.has(point.id)).flatMap((point) => latLonToVector3(point.lat, point.lon, 1.015).toArray())) }, [selectedIds, hotspots])
  return <>
    <color attach="background" args={['#04122b']} /><ambientLight intensity={1.1} /><directionalLight position={[4, 2, 3]} intensity={1.2} />
    <group ref={group}>
      <Suspense fallback={null}><EarthSphere heatmap={heatmap} onPick={(p) => choose(vector3ToLatLon(p))} onHover={(p) => {
        if (!p) { setHover(null, null); return }
        const pick = vector3ToLatLon(p)
        setHover(nearestHotspot(hotspots, pick.lat, pick.lon), findCountryAt(countries, pick.lat, pick.lon))
      }} /></Suspense>
      <CatalogPoints hotspots={hotspots} heatmap={heatmap} pointOpacity={pointOpacity} />
      <CountryBorders countries={countries} highlighted={highlighted} />
      <points raycast={() => undefined}><bufferGeometry><bufferAttribute attach="attributes-position" args={[selectionPositions, 3]} /></bufferGeometry><pointsMaterial color="#fbbf24" size={.017} sizeAttenuation depthWrite={false} /></points>
    </group>
    <OrbitControls ref={controls} enabled={!selecting} enablePan={false} enableDamping rotateSpeed={.32} zoomSpeed={.45} minDistance={1.12} maxDistance={8} />
  </>
}

export function EarthGlobe({ hotspots, countries = [], onSelect, onHotspotSelect, focus = null, selectedIds = [], onSelectionChange, onCountrySelect, selectionMode = false, heatmap = false, locale = 'pt-BR', pointOpacity = .94, globeViewState, onGlobeViewStateChange }: Props) {
  const wrapper = useRef<HTMLDivElement>(null)
  const actions = useRef<SceneActions | null>(null)
  const [hovered, setHovered] = useState<Hotspot | null>(null)
  const [hoverCountry, setHoverCountry] = useState<CountryShape | null>(null)
  const [box, setBox] = useState<ScreenRectangle | null>(null)
  const drag = useRef<{ x: number; y: number; shift: boolean } | null>(null)
  const t = (pt: string, en: string) => locale === 'pt-BR' ? pt : en
  useEffect(() => {
    const escape=(event: KeyboardEvent) => { if (event.key==='Escape') { drag.current=null; setBox(null) } }
    window.addEventListener('keydown',escape)
    return () => window.removeEventListener('keydown',escape)
  },[])
  function local(event: { clientX: number; clientY: number }) { const bounds = wrapper.current!.getBoundingClientRect(); return { x: event.clientX - bounds.left, y: event.clientY - bounds.top } }
  function choose(pick: GlobePick, shift = false) {
    const point = nearestHotspot(hotspots, pick.lat, pick.lon)
    if (point) { if (onSelectionChange) onSelectionChange([point.id], shift ? 'toggle' : 'replace'); else onHotspotSelect?.(point.id); return }
    const country = findCountryAt(countries, pick.lat, pick.lon)
    if (!shift && country && onCountrySelect) onCountrySelect(country.name)
    else onSelect?.(pick)
  }
  return <div ref={wrapper} className="relative h-full min-h-64 w-full overflow-hidden" style={{ cursor: selectionMode || box ? 'crosshair' : hovered || hoverCountry ? 'pointer' : 'grab' }}
    onPointerDownCapture={(event) => {
      if (event.button !== 0 || (!event.shiftKey && !selectionMode) || (event.target as Element).closest('button')) return
      event.stopPropagation(); event.preventDefault()
      const p = local(event); drag.current = { ...p, shift: event.shiftKey }; setBox(screenRectangle(p.x, p.y, p.x, p.y)); event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMoveCapture={(event) => { const active = drag.current; if (!active) return; event.stopPropagation(); const p = local(event); setBox(screenRectangle(active.x, active.y, p.x, p.y)) }}
    onPointerUpCapture={(event) => {
      const active = drag.current; if (!active) return
      event.stopPropagation(); event.preventDefault(); const p = local(event); drag.current = null; setBox(null)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      if (Math.hypot(active.x - p.x, active.y - p.y) > 5) onSelectionChange?.(actions.current?.selectBox(screenRectangle(active.x, active.y, p.x, p.y)) ?? [], active.shift ? 'add' : 'replace')
      else { const pick = actions.current?.pick(p.x, p.y); if (pick) choose(pick, active.shift) }
    }}
    onPointerCancel={() => { drag.current = null; setBox(null) }}
  >
    <Canvas camera={{ position: [0, .35, 2.8], fov: 42, near: .01, far: 30 }} dpr={[1, 1.5]} fallback={<p className="p-6 text-sm">{t('WebGL indisponível. Selecione o mapa 2D.', 'WebGL is unavailable. Select the 2D map.')}</p>}>
      <Scene hotspots={hotspots} countries={countries} focus={focus} selectedIds={selectedIds} heatmap={heatmap} pointOpacity={pointOpacity} selecting={!!box || selectionMode} highlighted={hoverCountry} setHover={(point, country) => { setHovered((old) => old?.id === point?.id ? old : point); setHoverCountry((old) => old === country ? old : country) }} choose={choose} actions={actions} globeViewState={globeViewState} onGlobeViewStateChange={onGlobeViewStateChange} />
    </Canvas>
    {box && <div className="pointer-events-none absolute border border-amber-300 bg-amber-300/15" style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }} />}
    <div className="absolute top-3 right-3 flex flex-col gap-1 rounded-lg border border-white/15 bg-[#070B12]/95 p-1 text-xs">
      <button type="button" aria-label={t('Aproximar globo', 'Zoom in globe')} className="rounded px-3 py-1 hover:bg-white/15" onClick={() => actions.current?.zoom(.8)}>+</button>
      <button type="button" aria-label={t('Afastar globo', 'Zoom out globe')} className="rounded px-3 py-1 hover:bg-white/15" onClick={() => actions.current?.zoom(1.25)}>−</button>
      <button type="button" className="rounded px-2 py-1 hover:bg-white/15" onClick={() => actions.current?.reset()}>{t('Mundo', 'World')}</button>
    </div>
    {(hovered || hoverCountry) && <div className="pointer-events-none absolute bottom-7 left-3 max-w-[75%] rounded-lg border border-white/15 bg-[#071a3d]/95 px-3 py-2 text-xs">
      {hoverCountry && <p className="font-semibold">{countryDisplayName(hoverCountry, locale)}</p>}
      {hovered && <><p className="mt-1">{hovered.label}</p><p className="font-mono text-[#9bb0d1]">{hovered.lat.toFixed(2)}°, {hovered.lon.toFixed(2)}°</p></>}
    </div>}
    <p className="pointer-events-none absolute bottom-1 left-3 font-mono text-[9px] text-slate-400">Natural Earth</p>
  </div>
}
