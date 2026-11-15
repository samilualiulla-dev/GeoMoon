import { Line, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { api } from '../../api/endpoints'
import type { GlobeData, SimResults, TerrainWindow } from '../../api/types'
import { usePlaybackSnapshot } from '../../hooks/usePlayback'
import { latLonToThree, MOON_RADIUS_M } from '../../lib/geo'
import { sampleAt } from '../../lib/series'
import { MoonSurface, SpherePatch } from '../moon/MoonBody'
import type { CamCmd } from './SceneCanvas'

const K = 1e-3                           // scene unit = 1 km
const bf = (x: number, y: number, z: number) => new THREE.Vector3(x * K, z * K, -y * K)

function Rig({ cmd, getLander, follow, R }: { cmd: CamCmd; getLander: () => { p: THREE.Vector3; alt: number }; follow: boolean; R: number }) {
  const { camera } = useThree()
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null
  const last = useRef(new THREE.Vector3())
  useEffect(() => {
    if (!controls) return
    const { p, alt } = getLander()
    const up = p.clone().normalize()
    const east = new THREE.Vector3(0, 1, 0).cross(up); if (east.lengthSq() < 1e-8) east.set(1, 0, 0); east.normalize()
    const d = Math.min(Math.max(alt * K * 2.4, 2.5), R * 3)
    let tgt = new THREE.Vector3(), pos = new THREE.Vector3()
    if (cmd.preset === 'frame') { tgt = new THREE.Vector3(); pos = up.clone().multiplyScalar(R * 3.1).add(east.clone().multiplyScalar(R * 1.1)).add(new THREE.Vector3(0, R * 0.7, 0)) }
    else if (cmd.preset === 'top') { tgt = p.clone(); pos = p.clone().add(up.clone().multiplyScalar(d)) }
    else if (cmd.preset === 'side') { tgt = p.clone(); pos = p.clone().add(east.clone().multiplyScalar(d)).add(up.clone().multiplyScalar(d * 0.12)) }
    else { tgt = p.clone(); pos = p.clone().add(up.clone().multiplyScalar(d * 0.65)).add(east.clone().multiplyScalar(d * 0.8)) }
    camera.position.copy(pos); controls.target.copy(tgt); controls.update(); last.current.copy(tgt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd.nonce, controls])
  useFrame(() => {
    if (!follow || !controls) return
    const { p } = getLander()
    const delta = p.clone().sub(last.current)
    camera.position.add(delta); controls.target.add(delta); controls.update(); last.current.copy(p)
  })
  return null
}

function Markers({ lander, targetP }: { lander: THREE.Vector3; targetP: THREE.Vector3 }) {
  const mk = useRef<THREE.Group>(null), tg = useRef<THREE.Group>(null)
  useFrame(({ camera }) => {
    if (mk.current) { mk.current.position.copy(lander); mk.current.scale.setScalar(Math.max(camera.position.distanceTo(lander) * 0.012, 0.002)) }
    if (tg.current) { tg.current.position.copy(targetP); tg.current.scale.setScalar(Math.max(camera.position.distanceTo(targetP) * 0.012, 0.002)) }
  })
  return (
    <>
      <group ref={mk}><mesh><octahedronGeometry args={[1, 0]} /><meshBasicMaterial color="#ffffff" /></mesh><mesh scale={1.9}><octahedronGeometry args={[1, 0]} /><meshBasicMaterial color="#22d3ee" wireframe /></mesh></group>
      <group ref={tg}><mesh><sphereGeometry args={[0.8, 12, 12]} /><meshBasicMaterial color="#ef4444" /></mesh></group>
    </>
  )
}

/** Spherical view of the Moon for the landing scene: whole body (real global DEM when installed) + curved high-resolution terrain
 *  patch + trajectory in the body-fixed frame. Used at altitudes where a flat tangent plane would be meaningless. */
export function SimGlobalScene({ results, terrain, target, previewAltitude_m, exaggeration, trajectory, labelsOn, cam, follow, allowSynthetic, className = '' }: {
  results: SimResults | null; terrain: TerrainWindow | null; target: { lat: number; lon: number }; previewAltitude_m: number; exaggeration: number
  trajectory: boolean; labelsOn: boolean; cam: CamCmd; follow: boolean; allowSynthetic: boolean; className?: string
}) {
  const { t } = usePlaybackSnapshot()
  const R = (terrain?.geometry.reference_radius_m ?? MOON_RADIUS_M) * K
  const [globe, setGlobe] = useState<GlobeData | null>(null)
  const [note, setNote] = useState('загрузка рельефа…')
  useEffect(() => {
    const ctrl = new AbortController()
    api.globe({ rows: 180, cols: 360, allow_synthetic: allowSynthetic }, ctrl.signal).then((g) => { setGlobe(g); setNote(`${g.provenance.name}${g.provenance.synthetic ? ' — СИНТЕТИЧЕСКИЙ тестовый рельеф' : ''}`) })
      .catch(() => { setGlobe(null); setNote('глобальный DEM не установлен — гладкая референс-сфера (рельеф не выдумывается)') })
    return () => ctrl.abort()
  }, [allowSynthetic])
  const pts = useMemo(() => (results ? results.time_series.position_x_m.map((x, i) => bf(x, results.time_series.position_y_m[i], results.time_series.position_z_m[i])) : []), [results])
  const now = results ? sampleAt(results.time_series, t) : null
  const landerRef = useRef<{ p: THREE.Vector3; alt: number }>({ p: new THREE.Vector3(), alt: previewAltitude_m })
  const lander = now ? bf(now.position_x_m, now.position_y_m, now.position_z_m) : latLonToThree(target.lat, target.lon, R + previewAltitude_m * K)
  landerRef.current = { p: lander, alt: now ? now.distance_to_surface_m : previewAltitude_m }
  const targetP = latLonToThree(target.lat, target.lon, R)
  const done = useMemo(() => {
    if (!results) return []
    const i = results.time_series.time_s.findIndex((x) => x > t)
    return pts.slice(0, i === -1 ? pts.length : Math.max(i, 1))
  }, [pts, results, t])
  const alt = landerRef.current.alt
  return (
    <div className={`${className || 'relative h-full w-full'} overflow-hidden bg-space-950`} data-testid="scene" data-scene-mode="sphere">
      <Canvas camera={{ position: [R * 3, R, R * 3], fov: 45, near: 1e-4, far: R * 60 }} dpr={[1, 2]} gl={{ antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true }}>
        <color attach="background" args={['#03060b']} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[R * 6, R * 3, R * 4]} intensity={2.4} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} minDistance={0.0005} maxDistance={R * 40} />
        <Rig cmd={cam} getLander={() => landerRef.current} follow={follow} R={R} />
        <MoonSurface globe={globe} exaggeration={exaggeration} radius={R} />
        {terrain && <SpherePatch terrain={terrain} exaggeration={exaggeration} radius={R} />}
        {trajectory && pts.length > 1 && <Line points={pts} color="#3b82f6" lineWidth={1.2} transparent opacity={0.55} />}
        {trajectory && done.length > 1 && <Line points={done} color="#22d3ee" lineWidth={2.6} />}
        {labelsOn && <Line points={[targetP, lander]} color="#a5b4fc" lineWidth={1} dashed dashSize={R * 0.02} gapSize={R * 0.015} transparent opacity={0.6} />}
        <Markers lander={lander} targetP={targetP} />
      </Canvas>
      <div className="pointer-events-none absolute bottom-16 left-3 max-w-[60%] text-[11px] leading-snug text-muted">
        <span className="rounded bg-space-950/80 px-2 py-1">Сфера Луны · высота {alt >= 1000 ? `${(alt / 1000).toFixed(1)} км` : `${alt.toFixed(0)} м`} · {note}</span>
      </div>
    </div>
  )
}
