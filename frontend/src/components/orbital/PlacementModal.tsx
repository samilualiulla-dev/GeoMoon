import { useEffect, useRef, useState } from 'react'
import { orbApi } from '../../api/orbital'
import { MOON_SOI_M, R_EARTH_M, R_MOON_M } from '../../lib/orbital'
import { useOrbital } from '../../store/orbitalStore'
import { Button, Modal } from '../ui/ui'
import { Num } from './fields'

const MU_E = 3.986004418e14, MU_M = 4.9028000661e12

/** Click on the map to put the vehicle anywhere (Earth- or Moon-centred, equatorial plane); choose speed and heading.
 *  Result = Cartesian initial state in ECI (kind "cartesian"). Positions are exact core coordinates, no snapping to orbits. */
export function PlacementModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { config, patchConfig } = useOrbital()
  const [frame, setFrame] = useState<'earth' | 'moon'>('earth')
  const [pt, setPt] = useState<[number, number] | null>(null)   // metres, relative to the frame body, in the ECI x-y plane
  const [speedFac, setSpeedFac] = useState(1)
  const [hdg, setHdg] = useState(0)                              // deg from prograde (counter-clockwise)
  const [moon, setMoon] = useState<{ r: number[]; v: number[] } | null>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  useEffect(() => { if (open) orbApi_moon(config.options.epoch_iso).then(setMoon).catch(() => setMoon(null)) }, [open, config.options.epoch_iso])
  const span = frame === 'earth' ? 9e8 : 2.2e8                   // half-width of the map, m
  const body = frame === 'earth' ? R_EARTH_M : R_MOON_M
  const mu = frame === 'earth' ? MU_E : MU_M
  const dist = pt ? Math.hypot(pt[0], pt[1]) : 0
  const vcirc = pt ? Math.sqrt(mu / Math.max(dist, 1)) : 0
  const speed = vcirc * speedFac
  useEffect(() => {
    const c = cv.current; if (!c) return
    const W = c.width, ctx = c.getContext('2d')!, k = W / (2 * span)
    ctx.fillStyle = '#03060b'; ctx.fillRect(0, 0, W, W)
    const P = (x: number, y: number): [number, number] => [W / 2 + x * k, W / 2 - y * k]
    const mpos = frame === 'earth' && moon ? [moon.r[0], moon.r[1]] : [0, 0]
    ctx.strokeStyle = '#16233a'
    for (let r = span / 4; r < span * 1.5; r += span / 4) { ctx.beginPath(); ctx.arc(W / 2, W / 2, r * k, 0, 7); ctx.stroke() }
    ctx.fillStyle = frame === 'earth' ? '#1e5fb4' : '#9a968e'; ctx.beginPath(); ctx.arc(W / 2, W / 2, Math.max(body * k, 4), 0, 7); ctx.fill()
    if (frame === 'earth' && moon) { const [mx, my] = P(mpos[0], mpos[1]); ctx.fillStyle = '#9a968e'; ctx.beginPath(); ctx.arc(mx, my, 5, 0, 7); ctx.fill(); ctx.strokeStyle = '#8b7bc7'; ctx.beginPath(); ctx.arc(mx, my, MOON_SOI_M * k, 0, 7); ctx.stroke() }
    if (frame === 'moon') { ctx.strokeStyle = '#8b7bc7'; ctx.beginPath(); ctx.arc(W / 2, W / 2, MOON_SOI_M * k, 0, 7); ctx.stroke() }
    if (pt) { const [x, y] = P(pt[0], pt[1]); ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill()
      const a = Math.atan2(pt[1], pt[0]) + Math.PI / 2 + (hdg * Math.PI) / 180; ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 40, y - Math.sin(a) * 40); ctx.stroke() }
  }, [pt, frame, moon, hdg, span, body])
  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), W = r.width
    const x = ((e.clientX - r.left) / W - 0.5) * 2 * span, y = -((e.clientY - r.top) / W - 0.5) * 2 * span
    if (Math.hypot(x, y) < body * 1.001) return                // not inside the body
    setPt([x, y])
  }
  const apply = () => {
    if (!pt || !moon) return
    const a = Math.atan2(pt[1], pt[0]) + Math.PI / 2 + (hdg * Math.PI) / 180
    const vrel = [Math.cos(a) * speed, Math.sin(a) * speed, 0]
    const r = frame === 'earth' ? [pt[0], pt[1], 0] : [pt[0] + moon.r[0], pt[1] + moon.r[1], moon.r[2]]
    const v = frame === 'earth' ? vrel : [vrel[0] + moon.v[0], vrel[1] + moon.v[1], vrel[2] + moon.v[2]]
    patchConfig((c) => ({ ...c, initial: { ...c.initial, kind: 'cartesian', r_m: r as [number, number, number], v_mps: v as [number, number, number] }, mission: { ...c.mission, kind: 'free_flight' } }))
    onClose()
  }
  return (
    <Modal open={open} title="Разместить аппарат на карте" onClose={onClose} wide footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" disabled={!pt || !moon} onClick={apply} data-testid="placement-apply">Применить как старт</Button></>}>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]" data-testid="placement">
        <canvas ref={cv} width={560} height={560} onClick={click} className="aspect-square w-full cursor-crosshair rounded-md border border-line" data-testid="placement-canvas" aria-label="Карта размещения" />
        <div className="space-y-3 text-[13px]">
          <div className="flex gap-2"><Button size="sm" variant={frame === 'earth' ? 'primary' : 'secondary'} onClick={() => { setFrame('earth'); setPt(null) }}>Вокруг Земли</Button><Button size="sm" variant={frame === 'moon' ? 'primary' : 'secondary'} onClick={() => { setFrame('moon'); setPt(null) }}>Вокруг Луны</Button></div>
          <p className="text-[12px] text-muted">Кликните по карте — там появится аппарат (вид сверху на плоскость экватора, положение Луны на эпоху {config.options.epoch_iso.slice(0, 10)}).</p>
          {pt ? <div className="num rounded-md border border-line p-2 text-[12px]" data-testid="placement-info">Расстояние до центра: {(dist / 1000).toFixed(0)} км<br />Высота над поверхностью: {((dist - body) / 1000).toFixed(0)} км<br />Круговая скорость: {(vcirc / 1000).toFixed(3)} км/с</div> : <div className="text-dim">точка не выбрана</div>}
          <label className="block text-xs text-muted"><span className="flex justify-between"><span>Скорость от круговой</span><span className="num text-ink">×{speedFac.toFixed(2)} = {(speed / 1000).toFixed(2)} км/с</span></span><input type="range" min={0} max={1.6} step={0.01} value={speedFac} onChange={(e) => setSpeedFac(Number(e.target.value))} className="w-full accent-cyan" aria-label="Скорость" /></label>
          <Num label="Направление скорости (0° = по орбите против часовой)" unit="°" value={hdg} onChange={(x) => setHdg(x ?? 0)} />
          <p className="text-[11px] text-dim">Скорость 0 — свободное падение. √2 ≈ 1,41 — параболическая (убегание). Положение и скорость передаются ядру точно, как заданы.</p>
        </div>
      </div>
    </Modal>
  )
}

async function orbApi_moon(epoch: string) {
  const p = await orbApi.ephemerides(epoch, 0, 60, 2)
  const r = p.moon_r_m[0], r1 = p.moon_r_m[1], dt = p.t_s[1] - p.t_s[0]
  return { r, v: [(r1[0] - r[0]) / dt, (r1[1] - r[1]) / dt, (r1[2] - r[2]) / dt] }
}
