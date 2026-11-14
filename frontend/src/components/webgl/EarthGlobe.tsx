import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'

function GlobePlaceholder() {
  return (
    <mesh>
      <sphereGeometry args={[1, 64, 64]} />
      <meshStandardMaterial color="#16324f" roughness={0.85} metalness={0.05} />
    </mesh>
  )
}

export function EarthGlobe() {
  return (
    <div className="h-full w-full">
      <Canvas camera={{ position: [0, 0.35, 2.8], fov: 42 }} dpr={[1, 2]}>
        <color attach="background" args={['#0b0f17']} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[4, 2, 3]} intensity={1.6} />
        <GlobePlaceholder />
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
