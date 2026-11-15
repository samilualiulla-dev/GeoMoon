import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { api } from '../../api/endpoints'
import type { GlobeData, TerrainWindow } from '../../api/types'
import { orbitalClock } from '../../hooks/useOrbitalClock'
import { latLonToThree } from '../../lib/geo'
import { earthQuaternion, eciToThree, interpMatrix, interpScalar, interpV3, KM_UNIT, moonQuaternion, MOON_SOI_M, R_EARTH_M, R_MOON_M, type OrbData } from '../../lib/orbital'
import { MoonSurface, SpherePatch } from '../moon/MoonBody'

export type CamMode = 'earth' | 'moon' | 'vehicle' | 'free'
const RE = R_EARTH_M / KM_UNIT, RM = R_MOON_M / KM_UNIT

function Stars() {
  const g = useMemo(() => {
    const n = 1400, p = new Float32Array(n * 3)
    let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
    for (let i = 0; i < n; i++) { const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u); p.set([r * Math.cos(a) * 3000, u * 3000, r * Math.sin(a) * 3000], i * 3) }
    const b = new THREE.BufferGeometry(); b.setAttribute('position', new THREE.BufferAttribute(p, 3)); return b
  }, [])
  return <points geometry={g}><pointsMaterial color="#9fb3d6" size={1.6} sizeAttenuation={false} /></points>
}

function EarthGraticule() {
  const lines = useMemo(() => {
    const out: THREE.Vector3[][] = []
    for (let lat = -60; lat <= 60; lat += 30) out.push(Array.from({ length: 73 }, (_, i) => latLonToThree(lat, i * 5, 1.002)))
    for (let lon = 0; lon < 360; lon += 30) out.push(Array.from({ length: 37 }, (_, i) => latLonToThree(-90 + i * 5, lon, 1.002)))
    return out.map((pts) => new THREE.BufferGeometry().setFromPoints(pts))
  }, [])
  const objs = useMemo(() => lines.map((g) => new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#7fb2ff', transparent: true, opacity: 0.45 }))), [lines])
  return <>{objs.map((o, i) => <primitive key={i} object={o} />)}</>
}

/** Drives every moving object imperatively from the clock (no React re-render per frame). Single source of truth = core samples. */
function Dynamic({ data, camMode, relativeTrail, showTrail, exaggeration, globe, patch, onVehicleMoon }: {
  data: OrbData; camMode: CamMode; relativeTrail: boolean; showTrail: boolean; exaggeration: number; globe: GlobeData | null
  patch: { terrain: TerrainWindow; lat: number; lon: number } | null; onVehicleMoon: (lat: number | null, lon: number | null, alt_m: number) => void
}) {
  const earth = useRef<THREE.Group>(null), moon = useRef<THREE.Group>(null), veh = useRef<THREE.Group>(null), sun = useRef<THREE.DirectionalLight>(null)
  const arrow = useRef<THREE.ArrowHelper>(null)
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null
  const { camera } = useThree()
  const prevTarget = useRef(new THREE.Vector3())
  const n = data.traj.t_s.length
  const lastNotify = useRef(0)
  const { geoFull, geoDone, lineFull, lineDone } = useMemo(() => {
    const mk = () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); return g }
    const geoFull = mk(), geoDone = mk()
    return { geoFull, geoDone, lineFull: new THREE.Line(geoFull, new THREE.LineBasicMaterial({ color: '#3b82f6', transparent: true, opacity: 0.55 })), lineDone: new THREE.Line(geoDone, new THREE.LineBasicMaterial({ color: '#22d3ee' })) }
  }, [n])
  useEffect(() => () => { geoFull.dispose(); geoDone.dispose() }, [geoFull, geoDone])
  const eph = data.eph

  useFrame(() => {
    const t = orbitalClock.getSnapshot().t
    const { traj } = data
    const rv = interpV3(traj.t_s, traj.r_m, t)
    const moonR = interpV3(traj.t_s, traj.moon_r_m, t)
    const mp = eciToThree(moonR), vp = eciToThree(rv)
    // Earth + Moon + Sun from the core's ephemeris
    if (earth.current) earth.current.quaternion.copy(earthQuaternion(interpScalar(eph.t_s, eph.earth_rotation_rad, t) ?? 0))
    if (moon.current) {
      moon.current.position.set(...mp)
      moon.current.quaternion.copy(moonQuaternion(interpMatrix(eph.t_s, eph.moon_axes, t)))
    }
    if (sun.current) { const s = eciToThree(interpV3(eph.t_s, eph.sun_r_m, t), 1); const l = Math.hypot(...s); sun.current.position.set((s[0] / l) * 5000, (s[1] / l) * 5000, (s[2] / l) * 5000) }
    // trail (inertial frame, or Moon-relative around the Moon's current position)
    const pa = (geoFull.getAttribute('position') as THREE.BufferAttribute), pd = (geoDone.getAttribute('position') as THREE.BufferAttribute)
    let cut = 0; while (cut < n - 1 && traj.t_s[cut + 1] <= t) cut++
    for (let i = 0; i < n; i++) {
      const r = traj.r_m[i], m = traj.moon_r_m[i]
      const q = relativeTrail ? eciToThree([r[0] - m[0] + moonR[0], r[1] - m[1] + moonR[1], r[2] - m[2] + moonR[2]]) : eciToThree(r)
      pa.setXYZ(i, q[0], q[1], q[2])
      pd.setXYZ(i, q[0], q[1], q[2])
    }
    pa.needsUpdate = true; pd.needsUpdate = true
    geoDone.setDrawRange(0, cut + 1)
    lineFull.frustumCulled = false; lineDone.frustumCulled = false
    lineFull.visible = showTrail; lineDone.visible = showTrail
    // vehicle: keep a constant apparent size
    const vpos = relativeTrail ? (() => { const q = eciToThree(rv); return q })() : vp
    if (veh.current) {
      veh.current.position.set(...vpos)
      const d = camera.position.distanceTo(veh.current.position)
      veh.current.scale.setScalar(Math.max(d * 0.012, 1e-6))
    }
    if (arrow.current) {
      const v = interpV3(traj.t_s, traj.r_m, t + 1), v0 = interpV3(traj.t_s, traj.r_m, t - 1)
      const dir = new THREE.Vector3(...eciToThree([v[0] - v0[0], v[1] - v0[1], v[2] - v0[2]], 1))
      if (dir.lengthSq() > 0) arrow.current.setDirection(dir.normalize())
    }
    // camera target follow (keeps the user's relative offset)
    if (controls) {
      const target = camMode === 'earth' ? new THREE.Vector3(0, 0, 0) : camMode === 'moon' ? new THREE.Vector3(...mp) : camMode === 'vehicle' ? new THREE.Vector3(...vpos) : null
      if (target) { const delta = target.clone().sub(controls.target); camera.position.add(delta); controls.target.copy(target); controls.update() }
      prevTarget.current.copy(controls.target)
    }
    // distance to the Moon surface -> notify (for LOD patch fetch); throttled
    const now = performance.now()
    if (now - lastNotify.current > 400) {
      lastNotify.current = now
      const rel = [rv[0] - moonR[0], rv[1] - moonR[1], rv[2] - moonR[2]]
      const d = Math.hypot(rel[0], rel[1], rel[2])
      if (d < R_MOON_M + 150_000) {
        const ax = interpMatrix(eph.t_s, eph.moon_axes, t)
        const f = [0, 1, 2].map((k) => ax[k][0] * rel[0] + ax[k][1] * rel[1] + ax[k][2] * rel[2])
        onVehicleMoon((Math.asin(f[2] / d) * 180) / Math.PI, (Math.atan2(f[1], f[0]) * 180) / Math.PI, d - R_MOON_M)
      } else onVehicleMoon(null, null, d - R_MOON_M)
    }
  })

  return (
    <>
      <directionalLight ref={sun} intensity={2.6} />
      <ambientLight intensity={0.16} />
      <group ref={earth}>
        <mesh scale={RE}><sphereGeometry args={[1, 96, 64]} /><meshStandardMaterial color="#2b62b0" roughness={0.9} metalness={0} emissive="#0a1b3a" emissiveIntensity={0.35} /></mesh>
        <group scale={RE}><EarthGraticule /></group>
      </group>
      <mesh scale={RE * 1.025}><sphereGeometry args={[1, 48, 32]} /><meshBasicMaterial color="#5aa2ff" transparent opacity={0.13} side={THREE.BackSide} depthWrite={false} /></mesh>
      <group ref={moon}>
        <MoonSurface globe={globe} exaggeration={exaggeration} radius={RM} />
        {patch && <SpherePatch terrain={patch.terrain} exaggeration={exaggeration} radius={RM} />}
        <mesh scale={MOON_SOI_M / KM_UNIT}><sphereGeometry args={[1, 40, 24]} /><meshBasicMaterial color="#8b7bc7" wireframe transparent opacity={0.07} depthWrite={false} /></mesh>
      </group>
      <primitive object={lineFull} />
      <primitive object={lineDone} />
      <group ref={veh}>
        <mesh><octahedronGeometry args={[1, 0]} /><meshBasicMaterial color="#ffffff" /></mesh>
        <mesh scale={1.9}><octahedronGeometry args={[1, 0]} /><meshBasicMaterial color="#22d3ee" wireframe /></mesh>
        <arrowHelper ref={arrow} args={[new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 5, '#fbbf24', 1.4, 0.9]} />
      </group>
    </>
  )
}

function CamRig({ cmd, camMode, extent }: { cmd: { nonce: number; preset: string }; camMode: CamMode; extent: number }) {
  const { camera } = useThree()
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null
  const data = useRef<OrbData | null>(null); void data
  useEffect(() => {
    if (!controls) return
    const snap = orbitalClock.getSnapshot()
    void snap
    const dist = { earth: Math.max(25, extent * 2.4), moon: 8, vehicle: 0.08, free: Math.max(25, extent * 2.4) }[camMode]
    const dir = new THREE.Vector3(0.6, 0.45, 0.8).normalize()
    controls.target.set(0, 0, 0)
    camera.position.copy(dir.multiplyScalar(cmd.preset === 'fit' ? 1000 : dist))
    controls.update()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd.nonce, camMode, controls])
  return null
}

export function OrbitScene3D({ data, camMode, camCmd, relativeTrail, showTrail, exaggeration, className = '', onVehicleMoon, onFullscreenRef }: {
  data: OrbData; camMode: CamMode; camCmd: { nonce: number; preset: string }; relativeTrail: boolean; showTrail: boolean; exaggeration: number; className?: string
  onVehicleMoon?: (lat: number | null, lon: number | null, alt_m: number) => void; onFullscreenRef?: (el: HTMLDivElement | null) => void
}) {
  const extent = useMemo(() => Math.max(...data.traj.r_m.map((r) => Math.hypot(r[0], r[1], r[2]))) / KM_UNIT, [data])
  const [globe, setGlobe] = useState<GlobeData | null>(null)
  const [globeNote, setGlobeNote] = useState<string>('загрузка рельефа…')
  const [patch, setPatch] = useState<{ terrain: TerrainWindow; lat: number; lon: number } | null>(null)
  const fetching = useRef(false)
  useEffect(() => {
    const ctrl = new AbortController()
    api.globe({ rows: 180, cols: 360 }, ctrl.signal).then((g) => { setGlobe(g); setGlobeNote(`${g.provenance.name}${g.provenance.synthetic ? ' (СИНТЕТИКА)' : ''}`) })
      .catch(() => setGlobeNote('глобальный DEM не установлен — гладкая референс-сфера'))
    return () => ctrl.abort()
  }, [])
  const patchRef = useRef(patch); patchRef.current = patch
  const handleMoon = (lat: number | null, lon: number | null, alt: number) => {
    onVehicleMoon?.(lat, lon, alt)
    if (lat === null || lon === null) { if (patchRef.current) setPatch(null); return }
    const p = patchRef.current
    const far = !p || Math.hypot(p.lat - lat, (p.lon - lon) * Math.cos((lat * Math.PI) / 180)) * (Math.PI / 180) * R_MOON_M > 12_000
    if (far && !fetching.current && alt < 120_000) {
      fetching.current = true
      api.terrain({ latitude_deg: lat, longitude_deg: lon, radius_m: 30_000, max_grid: 160 })
        .then((t) => setPatch({ terrain: t, lat, lon })).catch(() => setPatch(null)).finally(() => { fetching.current = false })
    }
  }
  return (
    <div ref={onFullscreenRef} className={`relative h-full w-full overflow-hidden bg-space-950 ${className}`} data-testid="orbit-scene">
      <Canvas camera={{ position: [24, 18, 32], fov: 45, near: 1e-5, far: 20000 }} dpr={[1, 2]} gl={{ antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true }}>
        <color attach="background" args={['#02040a']} />
        <Stars />
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} minDistance={0.0003} maxDistance={4000} zoomSpeed={1.2} />
        <CamRig cmd={camCmd} camMode={camMode} extent={extent} />
        <Dynamic data={data} camMode={camMode} relativeTrail={relativeTrail} showTrail={showTrail} exaggeration={exaggeration} globe={globe} patch={patch} onVehicleMoon={handleMoon} />
      </Canvas>
      <div className="pointer-events-none absolute bottom-2 left-3 max-w-[70%] text-[10.5px] leading-snug text-dim">
        Земля — схематичная модель (без реальных снимков). Луна: {globeNote}{patch ? ' · локальная детальная сетка включена' : ''}
      </div>
    </div>
  )
}
