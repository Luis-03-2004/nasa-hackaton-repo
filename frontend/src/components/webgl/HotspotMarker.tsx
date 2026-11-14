import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { DoubleSide, Quaternion, Vector3, type Mesh } from 'three'
import { latLonToVector3 } from '../../utils/geo'

export interface Hotspot {
  id: string
  lat: number
  lon: number
  color: string
}

export function HotspotMarker({ lat, lon, color }: Hotspot) {
  const ring = useRef<Mesh>(null)
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
    <group position={placement.position} quaternion={placement.quaternion}>
      <mesh>
        <sphereGeometry args={[0.012, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh ref={ring}>
        <ringGeometry args={[0.02, 0.03, 32]} />
        <meshBasicMaterial color={color} side={DoubleSide} transparent opacity={0.9} />
      </mesh>
    </group>
  )
}
