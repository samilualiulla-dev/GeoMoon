import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

export interface ClockSnapshot { t: number; playing: boolean; speed: number; limit: number }

/** Simulation-time clock for replaying the core's stored samples. Lives outside React state (per-frame setState would starve the UI). */
class OrbitalClock {
  private snap: ClockSnapshot = { t: 0, playing: false, speed: 1, limit: 0 }
  private listeners = new Set<() => void>()
  private raf: number | null = null
  private last = 0
  private lastEmit = 0
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  getSnapshot = () => this.snap
  private emit(n: Partial<ClockSnapshot>) { this.snap = { ...this.snap, ...n }; this.listeners.forEach((l) => l()) }
  private stopLoop() { if (this.raf !== null) cancelAnimationFrame(this.raf); this.raf = null }
  private loop = (now: number) => {
    const dt = Math.min((now - this.last) / 1000, 0.25)
    this.last = now
    const t = Math.min(this.snap.limit, this.snap.t + dt * this.snap.speed)
    if (t >= this.snap.limit) { this.emit({ t, playing: false }); this.raf = null; return }
    if (now - this.lastEmit >= 33) { this.lastEmit = now; this.emit({ t }) } else this.snap = { ...this.snap, t }
    this.raf = requestAnimationFrame(this.loop)
  }
  setLimit(limit: number) { this.emit({ limit, t: Math.min(this.snap.t, limit) }) }
  setSpeed(speed: number) { this.emit({ speed }) }
  play() {
    if (this.snap.limit <= 0) return
    if (this.snap.t >= this.snap.limit) this.emit({ t: 0 })
    this.stopLoop(); this.emit({ playing: true }); this.last = performance.now(); this.lastEmit = 0
    this.raf = requestAnimationFrame(this.loop)
  }
  pause() { this.stopLoop(); this.emit({ playing: false }) }
  reset() { this.stopLoop(); this.emit({ t: 0, playing: false }) }
  seek(t: number) { this.emit({ t: Math.max(0, Math.min(t, this.snap.limit)) }) }
  step(dt: number) { this.stopLoop(); this.emit({ playing: false, t: Math.max(0, Math.min(this.snap.limit, this.snap.t + dt)) }) }
}

export const orbitalClock = new OrbitalClock()
export const SPEEDS = [0.25, 0.5, 1, 2, 5, 10, 50, 100, 1000, 10000, 100000]
export const useClock = (): ClockSnapshot => useSyncExternalStore(orbitalClock.subscribe, orbitalClock.getSnapshot)

/** Clock time at most every `ms` ms (heavy consumers: charts, tables). */
export function useThrottledClock(ms = 250): number {
  const [t, setT] = useState(orbitalClock.getSnapshot().t)
  const last = useRef(0)
  useEffect(() => orbitalClock.subscribe(() => {
    const s = orbitalClock.getSnapshot(), now = performance.now()
    if (now - last.current >= ms || !s.playing) { last.current = now; setT(s.t) }
  }), [ms])
  return t
}
