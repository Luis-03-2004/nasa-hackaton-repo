import { OrbitControls, useTexture } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense, useLayoutEffect } from 'react'
import { SRGBColorSpace } from 'three'
import earthMap from '../../assets/earth-map.webp'

function EarthSphere() {
  const texture = useTexture(earthMap)

  useLayoutEffect(() => {
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 8
    texture.needsUpdate = true
  }, [texture])

  return (
    <mesh>
      <sphereGeometry args={[1, 96, 96]} />
      <meshStandardMaterial map={texture} roughness={1} metalness={0} />
    </mesh>
  )
}

export function EarthGlobe() {
  return (
    <div className="h-full w-full">
      <Canvas camera={{ position: [0, 0.35, 2.8], fov: 42 }} dpr={[1, 2]}>
        <color attach="background" args={['#0b0f17']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[4, 2, 3]} intensity={1.8} />
        <Suspense fallback={null}>
          <EarthSphere />
        </Suspense>
        <OrbitControls
          enablePan={false}
          enableDamping
          minDistance={1.5}
          maxDistance={6}
        />
      </Canvas>
    </div>
  )
}
