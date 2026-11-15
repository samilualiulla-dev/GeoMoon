import { useEffect, useMemo, useRef, useState } from 'react'
import type { OrbEvent } from '../../api/orbital'
import { orbitalClock } from '../../hooks/useOrbitalClock'
import { fmtDistance, interpV3, MOON_SOI_M, norm3, planeBasis, R_EARTH_M, R_MOON_M, type MapCenter, type MapPlane, type OrbData } from '../../lib/orbital'
import { Button } from '../ui/ui'

const EVENT_MARK: Record<string, { c: string; l: string }> = {
  impulse: { c: '#fb923c', l: 'ΔV' }, burn_start: { c: '#fb923c', l: 'вкл' }, burn_end: { c: '#fb923c', l: 'выкл' }, periselene: { c: '#22c55e', l: 'перилуний' },
  perigee: { c: '#60a5fa', l: 'перигей' }, apogee: { c: '#60a5fa', l: 'апогей' }, moon_soi_entry: { c: '#a78bfa', l: 'вход в СВ' }, moon_soi_exit: { c: '#a78bfa', l: 'выход из СВ' },
  moon_contact: { c: '#ef4444', l: 'контакт' }, earth_impact: { c: '#ef4444', l: 'падение' },
}

/** 2-D orbital map (canvas). Draws only samples delivered by the core (same arrays as the 3-D scene). Wheel = zoom, drag = pan, click = seek. */
export function OrbitMap2D({ data, events, center, plane, showMoonTrack, showLabels, onFrame }: {
  data: OrbData; events: OrbEvent[]; center: MapCenter; plane: MapPlane; showMoonTrack: boolean; showLabels: boolean; onFrame?: (zoom: number) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const view = useRef({ zoom: 0, panX: 0, panY: 0, auto: true })
  const [, force] = useState(0)
  const basis = useMemo(() => {
    if (plane === 'equator' || !data.traj.r_m.length) return { u: [1, 0, 0] as [number, number, number], w: [0, 1, 0] as [number, number, number] }
    const r = data.traj.r_m[0]; const dt = 30
    const r1 = interpV3(data.traj.t_s, data.traj.r_m, Math.min(data.traj.t_s[data.traj.t_s.length - 1], data.traj.t_s[0] + dt))
    return planeBasis(r, [(r1[0] - r[0]) / dt, (r1[1] - r[1]) / dt, (r1[2] - r[2]) / dt])
  }, [data, plane])

  useEffect(() => { view.current.auto = true; draw() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [data, center, plane])
  useEffect(() => { draw(); return orbitalClock.subscribe(draw) })
  useEffect(() => {
    const ro = new ResizeObserver(() => draw()); if (wrap.current) ro.observe(wrap.current)
    return () => ro.disconnect() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const proj = (p: ArrayLike<number>) => [p[0] * basis.u[0] + p[1] * basis.u[1] + p[2] * basis.u[2], p[0] * basis.w[0] + p[1] * basis.w[1] + p[2] * basis.w[2]]

  function draw() {
    const cv = ref.current, box = wrap.current
    if (!cv || !box) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const W = box.clientWidth, H = box.clientHeight
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr) }
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#03060b'; ctx.fillRect(0, 0, W, H)
    const { traj, eph } = data
    const tNow = orbitalClock.getSnapshot().t
    const n = traj.t_s.length
    if (!n) return
    const now = interpV3(traj.t_s, traj.r_m, tNow)
    const moonNow = interpV3(traj.t_s, traj.moon_r_m, tNow)
    const origin = (moon: number[], veh: number[]) => (center === 'earth' ? [0, 0, 0] : center === 'moon' ? moon : veh)
    const o = origin(moonNow, now)
    const oP = proj(o)
    // fit zoom
    if (view.current.auto || !view.current.zoom) {
      let ext = R_EARTH_M * 1.5
      for (let i = 0; i < n; i += Math.max(1, n >> 9)) {
        const p = center === 'moon' ? proj([traj.r_m[i][0] - traj.moon_r_m[i][0], traj.r_m[i][1] - traj.moon_r_m[i][1], traj.r_m[i][2] - traj.moon_r_m[i][2]]) : proj(traj.r_m[i])
        ext = Math.max(ext, Math.hypot(p[0] - (center === 'vehicle' ? oP[0] : 0), p[1] - (center === 'vehicle' ? oP[1] : 0)))
      }
      if (center === 'moon') ext = Math.max(ext, R_MOON_M * 3)
      view.current = { zoom: (Math.min(W, H) * 0.44) / ext, panX: 0, panY: 0, auto: false }
      onFrame?.(view.current.zoom)
    }
    const { zoom, panX, panY } = view.current
    const sx = (x: number) => W / 2 + panX + (x - (center === 'vehicle' ? oP[0] : 0)) * zoom
    const sy = (y: number) => H / 2 + panY - (y - (center === 'vehicle' ? oP[1] : 0)) * zoom
    const rel = (p: number[], originAt: number[]) => proj([p[0] - originAt[0], p[1] - originAt[1], p[2] - originAt[2]])
    const toS = (p: number[], t: number) => {
      // position in the chosen frame at sample time t (origin follows the Moon when Moon-centred)
      const mo = center === 'moon' ? interpV3(traj.t_s, traj.moon_r_m, t) : center === 'earth' ? [0, 0, 0] : [0, 0, 0]
      const q = rel(p, mo)
      return [sx(center === 'vehicle' ? q[0] : q[0]), sy(q[1])]
    }
    // grid rings (distance scale)
    ctx.strokeStyle = '#111b2e'; ctx.lineWidth = 1; ctx.fillStyle = '#4a5b78'; ctx.font = '10px ui-sans-serif, system-ui'
    const ringBase = center === 'earth' || center === 'vehicle' ? 1 : 1
    const cx = center === 'vehicle' ? sx(oP[0]) - 0 : sx(0), cy = center === 'vehicle' ? sy(oP[1]) : sy(0)
    const stepM = 10 ** Math.floor(Math.log10((Math.min(W, H) * 0.5) / zoom / 2))
    for (let k = 1; k <= 12; k++) {
      const rr = stepM * k * 1
      if (rr * zoom > Math.max(W, H)) break
      if (center !== 'vehicle') { ctx.beginPath(); ctx.arc(cx, cy, rr * zoom, 0, Math.PI * 2); ctx.stroke() }
    }
    void ringBase
    // Moon orbit track (from the core's ephemeris)
    if (showMoonTrack && center === 'earth') {
      ctx.strokeStyle = 'rgba(167,139,250,0.35)'; ctx.setLineDash([4, 5]); ctx.beginPath()
      eph.moon_r_m.forEach((p, i) => { const q = proj(p); i === 0 ? ctx.moveTo(sx(q[0]), sy(q[1])) : ctx.lineTo(sx(q[0]), sy(q[1])) })
      ctx.stroke(); ctx.setLineDash([])
    }
    // Earth (always drawn at its position in the chosen frame)
    const earthS = center === 'moon' ? toS([0, 0, 0], tNow) : center === 'vehicle' ? [sx(proj([0, 0, 0])[0]), sy(proj([0, 0, 0])[1])] : [sx(0), sy(0)]
    ctx.fillStyle = '#1e5fb4'; ctx.beginPath(); ctx.arc(earthS[0], earthS[1], Math.max(R_EARTH_M * zoom, 3), 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1; ctx.stroke()
    if (showLabels) { ctx.fillStyle = '#93c5fd'; ctx.font = '11px ui-sans-serif'; ctx.fillText('Земля', earthS[0] + Math.max(R_EARTH_M * zoom, 3) + 4, earthS[1] - 4) }
    // Moon + SOI
    const mp = center === 'moon' ? [sx(0), sy(0)] : (() => { const q = proj(moonNow); return [sx(q[0]), sy(q[1])] })()
    ctx.strokeStyle = 'rgba(167,139,250,0.55)'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(mp[0], mp[1], MOON_SOI_M * zoom, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([])
    ctx.fillStyle = '#9a968e'; ctx.beginPath(); ctx.arc(mp[0], mp[1], Math.max(R_MOON_M * zoom, 3), 0, Math.PI * 2); ctx.fill()
    if (showLabels) { ctx.fillStyle = '#d4d0c8'; ctx.fillText('Луна', mp[0] + Math.max(R_MOON_M * zoom, 3) + 4, mp[1] - 4); ctx.fillStyle = '#8b7bc7'; ctx.fillText('граница сферы влияния', mp[0] + 6, mp[1] - MOON_SOI_M * zoom - 4) }
    // trajectory
    const path = (i0: number, i1: number) => { ctx.beginPath(); for (let i = i0; i <= i1; i++) { const s = toS(traj.r_m[i], traj.t_s[i]); i === i0 ? ctx.moveTo(s[0], s[1]) : ctx.lineTo(s[0], s[1]) } }
    ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(59,130,246,0.5)'; path(0, n - 1); ctx.stroke()
    let cut = 0; while (cut < n - 1 && traj.t_s[cut + 1] <= tNow) cut++
    ctx.lineWidth = 2.4; ctx.strokeStyle = '#22d3ee'; path(0, cut)
    const sNow = toS(now, tNow); ctx.lineTo(sNow[0], sNow[1]); ctx.stroke()
    // burn arcs
    ctx.strokeStyle = '#fb923c'; ctx.lineWidth = 3.4
    for (let i = 1; i < n; i++) if (traj.thrust_n[i] > 0) { const a = toS(traj.r_m[i - 1], traj.t_s[i - 1]), b = toS(traj.r_m[i], traj.t_s[i]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke() }
    // events
    const seen: Record<string, number> = {}
    for (const e of events) {
      const m = EVENT_MARK[e.type]; if (!m) continue
      seen[e.type] = (seen[e.type] ?? 0) + 1
      if (seen[e.type] > 3 && !['impulse', 'moon_contact', 'earth_impact'].includes(e.type)) continue   // keep the map readable
      const p = interpV3(traj.t_s, traj.r_m, e.t_s); const s = toS(p, e.t_s)
      ctx.fillStyle = m.c; ctx.beginPath(); ctx.arc(s[0], s[1], 3.5, 0, Math.PI * 2); ctx.fill()
      if (showLabels && ['impulse', 'periselene', 'moon_contact', 'earth_impact', 'moon_soi_entry'].includes(e.type)) { ctx.fillStyle = m.c; ctx.fillText(m.l, s[0] + 6, s[1] - 5) }
    }
    // vehicle
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sNow[0], sNow[1], 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    // scale bar
    const bar = 10 ** Math.floor(Math.log10(120 / zoom)); const bw = bar * zoom
    ctx.strokeStyle = '#8b9bb6'; ctx.fillStyle = '#8b9bb6'; ctx.lineWidth = 1.5; ctx.font = '11px ui-sans-serif'
    ctx.beginPath(); ctx.moveTo(14, H - 18); ctx.lineTo(14 + bw, H - 18); ctx.moveTo(14, H - 22); ctx.lineTo(14, H - 14); ctx.moveTo(14 + bw, H - 22); ctx.lineTo(14 + bw, H - 14); ctx.stroke()
    ctx.fillText(fmtDistance(bar), 14 + bw + 8, H - 14)
    ctx.fillText(`${center === 'earth' ? 'Система: Земля (инерциальная)' : center === 'moon' ? 'Система: Луна (центр — Луна)' : 'Система: аппарат'} · ${plane === 'equator' ? 'вид сверху на север' : 'плоскость начальной орбиты'}`, 14, 16)
    const sp = norm3(traj.r_m[Math.min(cut, n - 1)]); void sp
  }

  // interaction
  const drag = useRef<{ x: number; y: number; pan: [number, number]; moved: boolean } | null>(null)
  const onDown = (e: React.PointerEvent) => { (e.target as Element).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, pan: [view.current.panX, view.current.panY], moved: false } }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (Math.hypot(dx, dy) > 3) d.moved = true
    view.current.panX = d.pan[0] + dx; view.current.panY = d.pan[1] + dy; draw()
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null
    if (!d || d.moved) return
    // click: seek to the nearest trajectory sample
    const rect = ref.current!.getBoundingClientRect(); const mx = e.clientX - rect.left, my = e.clientY - rect.top
    let best = -1, bd = 14
    const tNow = orbitalClock.getSnapshot().t
    void tNow
    const { zoom, panX, panY } = view.current
    const oP = proj(center === 'vehicle' ? interpV3(data.traj.t_s, data.traj.r_m, orbitalClock.getSnapshot().t) : [0, 0, 0])
    for (let i = 0; i < data.traj.t_s.length; i++) {
      const mo = center === 'moon' ? data.traj.moon_r_m[i] : [0, 0, 0]
      const q = proj([data.traj.r_m[i][0] - mo[0], data.traj.r_m[i][1] - mo[1], data.traj.r_m[i][2] - mo[2]])
      const x = rect.width / 2 + panX + (q[0] - (center === 'vehicle' ? oP[0] : 0)) * zoom, y = rect.height / 2 + panY - (q[1] - (center === 'vehicle' ? oP[1] : 0)) * zoom
      const dd = Math.hypot(x - mx, y - my); if (dd < bd) { bd = dd; best = i }
    }
    if (best >= 0) orbitalClock.seek(data.traj.t_s[best])
  }
  const onWheel = (e: React.WheelEvent) => {
    const f = Math.exp(-e.deltaY * 0.0015)
    view.current.zoom *= f; view.current.panX *= f; view.current.panY *= f; draw()
  }
  return (
    <div ref={wrap} className="relative h-full min-h-[320px] w-full overflow-hidden rounded-md" data-testid="orbit-map">
      <canvas ref={ref} className="absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel} aria-label="Двумерная орбитальная карта" />
      <div className="absolute bottom-3 right-3 flex gap-1.5">
        <Button size="sm" onClick={() => { view.current.zoom *= 1.4; draw() }} aria-label="Приблизить">＋</Button>
        <Button size="sm" onClick={() => { view.current.zoom /= 1.4; draw() }} aria-label="Отдалить">－</Button>
        <Button size="sm" onClick={() => { view.current.auto = true; draw(); force((x) => x + 1) }}>Вписать</Button>
      </div>
    </div>
  )
}
