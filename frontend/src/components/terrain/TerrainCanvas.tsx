import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import type { ReactNode } from 'react'

/** Shared 3-D canvas for local terrain scenes (scene units = metres, +y up). */
export function TerrainCanvas({ extent_m, children, className = '', minDistance }: { extent_m: number; children: ReactNode; className?: string; minDistance?: number }) {
  const d = Math.max(extent_m, 50)
  return (
    <div className={`relative overflow-hidden rounded border border-line bg-space-950 ${className}`}>
      <Canvas camera={{ position: [d * 0.9, d * 0.7, d * 0.9], fov: 45, near: Math.max(d / 2000, 0.05), far: d * 200 }} dpr={[1, 2]} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <color attach="background" args={['#04070d']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[d, d * 1.2, d * 0.4]} intensity={1.6} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} minDistance={minDistance ?? d * 0.02} maxDistance={d * 40} maxPolarAngle={Math.PI * 0.499} />
        {children}
      </Canvas>
    </div>
  )
}
