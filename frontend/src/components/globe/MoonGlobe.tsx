import { Line, OrbitControls } from '@react-three/drei'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { DatasetInfo, GlobeData, Region } from '../../api/types'
import { latLonToThree, threeToLatLon } from '../../lib/geo'
import { buildGlobeGeometry } from '../../lib/globeMesh'

function graticule(stepDeg: number): THREE.Vector3[][] {
  const lines: THREE.Vector3[][] = []
  for (let lat = -60; lat <= 60; lat += stepDeg) lines.push(Array.from({ length: 181 }, (_, i) => latLonToThree(lat, -180 + i * 2, 1.002)))
  for (let lon = -180; lon < 180; lon += stepDeg) lines.push(Array.from({ length: 91 }, (_, i) => latLonToThree(-90 + i * 2, lon, 1.002)))
  return lines
}

function coverageOutline(d: DatasetInfo): THREE.Vector3[] | null {
  const lat = d.coverage.lat_range_deg, lon = d.coverage.lon_range_deg
  if (!lat || !lon) return null
  const [a, b] = lat
  if (d.coverage.includes_pole) {
    const edge = a <= -89 ? b : a
    return Array.from({ length: 121 }, (_, i) => latLonToThree(edge, -180 + i * 3, 1.004))
  }
  const [c, e] = lon
  const pts: THREE.Vector3[] = []
  const n = 24
  for (let i = 0; i <= n; i++) pts.push(latLonToThree(a, c + ((e - c) * i) / n, 1.004))
  for (let i = 0; i <= n; i++) pts.push(latLonToThree(a + ((b - a) * i) / n, e, 1.004))
  for (let i = 0; i <= n; i++) pts.push(latLonToThree(b, e - ((e - c) * i) / n, 1.004))
  for (let i = 0; i <= n; i++) pts.push(latLonToThree(b - ((b - a) * i) / n, c, 1.004))
  return pts
}

function Marker({ lat, lon, color, size = 0.018, ring = false }: { lat: number; lon: number; color: string; size?: number; ring?: boolean }) {
  const p = useMemo(() => latLonToThree(lat, lon, 1.006), [lat, lon])
  const q = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.clone().normalize()), [p])
  return (
    <group position={p} quaternion={q}>
      <mesh><sphereGeometry args={[size, 16, 16]} /><meshBasicMaterial color={color} /></mesh>
      {ring && <mesh><ringGeometry args={[size * 2.2, size * 2.8, 32]} /><meshBasicMaterial color={color} side={THREE.DoubleSide} transparent opacity={0.8} /></mesh>}
    </group>
  )
}

function FocusRig({ lat, lon, signal }: { lat: number; lon: number; signal: number }) {
  const { camera } = useThree()
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  useEffect(() => {
    if (signal === 0) return
    const dir = latLonToThree(lat, lon, 1).normalize()
    camera.position.copy(dir.multiplyScalar(2.6))
    camera.lookAt(0, 0, 0)
    controls?.update()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal])
  return null
}

export interface GlobeProps {
  selected: { lat: number; lon: number }
  onSelect: (lat: number, lon: number) => void
  onHover?: (p: { lat: number; lon: number } | null) => void
  showGrid: boolean
  datasets: DatasetInfo[]
  regions: Region[]
  candidates?: { lat: number; lon: number }[]
  focusSignal: number
  /** real (or flagged-synthetic) global elevation grid from the core; null => plain reference sphere */
  globe?: GlobeData | null
  exaggeration?: number
}

/**
 * Reference sphere with graticule, dataset coverage outlines, regions and the selected point.
 * IMPORTANT: no global DEM is displaced onto this sphere (none is installed). Real relief is shown in the Regional relief view.
 */
export function MoonGlobe({ selected, onSelect, onHover, showGrid, datasets, regions, candidates, focusSignal, globe = null, exaggeration = 10 }: GlobeProps) {
  const surface = useMemo(() => {
    if (!globe) return null
    const d = buildGlobeGeometry(globe, exaggeration)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(d.colors, 3))
    g.setIndex(new THREE.BufferAttribute(d.indices, 1))
    g.computeVertexNormals(); g.computeBoundingSphere()
    return g
  }, [globe, exaggeration])
  useEffect(() => () => surface?.dispose(), [surface])
  const grid = useMemo(() => graticule(30), [])
  const outlines = useMemo(() => datasets.map((d) => ({ d, pts: coverageOutline(d) })).filter((x) => x.pts), [datasets])
  const down = useRef<{ x: number; y: number } | null>(null)
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (down.current && Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) > 5) return
    e.stopPropagation()
    const { lat, lon } = threeToLatLon(e.point)
    onSelect(lat, lon)
  }
  return (
    <Canvas camera={{ position: [0, 0.9, 3.6], fov: 40, near: 0.01, far: 100 }} dpr={[1, 2]} gl={{ antialias: true, preserveDrawingBuffer: true }}>
      <color attach="background" args={['#04070d']} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 3, 4]} intensity={2.2} />
      <mesh onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY } }} onClick={handleClick}
        onPointerMove={(e) => { if (onHover) { const p = threeToLatLon(e.point); onHover(p) } }} onPointerOut={() => onHover?.(null)}>
        {/* distinct keys force a fresh material: toggling vertexColors/colour on a live material would reset it to black */}
        {surface ? <primitive key="relief-geo" object={surface} attach="geometry" /> : <sphereGeometry key="plain-geo" args={[1, 96, 96]} />}
        {surface ? <meshStandardMaterial key="relief-mat" vertexColors roughness={0.95} metalness={0} /> : <meshStandardMaterial key="plain-mat" color="#8a8d94" roughness={1} metalness={0} />}
      </mesh>
      {showGrid && grid.map((pts, i) => <Line key={i} points={pts} color="#3b82f6" lineWidth={0.6} transparent opacity={0.45} />)}
      {outlines.map(({ d, pts }) => <Line key={d.id} points={pts!} color={d.synthetic ? '#eab308' : '#22d3ee'} lineWidth={1.6} />)}
      {regions.map((r) => <Marker key={r.id} lat={r.latitude_deg} lon={r.longitude_deg} color="#60a5fa" size={0.012} />)}
      {candidates?.map((c, i) => <Marker key={i} lat={c.lat} lon={c.lon} color="#22c55e" size={0.01} />)}
      <Marker lat={selected.lat} lon={selected.lon} color="#ef4444" ring />
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} minDistance={1.15} maxDistance={8} rotateSpeed={0.6} zoomSpeed={0.7} />
      <FocusRig lat={selected.lat} lon={selected.lon} signal={focusSignal} />
    </Canvas>
  )
}
