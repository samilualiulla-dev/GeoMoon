import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, type ReactNode } from 'react'
import * as THREE from 'three'

export type CamPreset = 'frame' | 'iso' | 'top' | 'side'
export interface CamCmd { preset: CamPreset; nonce: number }

interface RigProps { cmd: CamCmd; focus: [number, number, number]; ref_m: number; extent_m: number; fov: number; follow: boolean; followPos: [number, number, number] }

function Rig({ cmd, focus, ref_m, extent_m, fov, follow, followPos }: RigProps) {
  const { camera } = useThree()
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null
  const tmp = useRef(new THREE.Vector3())
  useEffect(() => { const c = camera as THREE.PerspectiveCamera; c.fov = fov; c.updateProjectionMatrix() }, [fov, camera])
  useEffect(() => {
    if (!controls) return
    const f = new THREE.Vector3(...focus)
    const d = ref_m * 2.6
    const pos = {
      frame: [d * 0.75, d * 0.55 + f.y, d * 0.85],
      iso: [extent_m * 0.85, extent_m * 0.6 + f.y, extent_m * 0.85],
      top: [0.001, extent_m * 1.35 + f.y, 0.001],
      side: [0, f.y + extent_m * 0.06, extent_m * 1.45],
    }[cmd.preset]
    camera.position.set(pos[0] + f.x, pos[1], pos[2] + f.z)
    controls.target.copy(f); controls.update()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd.nonce, controls])
  useFrame(() => {
    if (follow && controls) { controls.target.lerp(tmp.current.set(...followPos), 0.18); controls.update() }
  })
  return null
}

/** 3-D canvas for the landing scene. Scene units = metres, +y up. */
export function SceneCanvas({ children, cmd, focus, ref_m, extent_m, fov, follow, followPos, className = '' }: {
  children: ReactNode; cmd: CamCmd; focus: [number, number, number]; ref_m: number; extent_m: number; fov: number; follow: boolean; followPos: [number, number, number]; className?: string
}) {
  const d = Math.max(extent_m, ref_m * 2, 50)
  return (
    <div className={`${className || "relative h-full w-full"} overflow-hidden bg-space-950`} data-testid="scene">
      <Canvas camera={{ position: [ref_m * 2, ref_m * 1.4, ref_m * 2], fov, near: Math.max(ref_m / 600, 0.02), far: d * 120 }} dpr={[1, 2]} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <color attach="background" args={['#03060b']} />
        <ambientLight intensity={0.42} />
        <hemisphereLight args={['#bcd0ee', '#1a1510', 0.4]} />
        <directionalLight position={[d, d * 0.9, d * 0.35]} intensity={2.1} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} minDistance={Math.max(ref_m * 0.04, 0.5)} maxDistance={d * 30} maxPolarAngle={Math.PI * 0.499} />
        <Rig cmd={cmd} focus={focus} ref_m={ref_m} extent_m={extent_m} fov={fov} follow={follow} followPos={followPos} />
        {children}
      </Canvas>
    </div>
  )
}
