import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

export type PlayState = 'idle' | 'playing' | 'paused' | 'finished'
export interface PlaybackSnapshot { t: number; state: PlayState; speed: number; duration: number }

/**
 * Playback clock for replaying a computed time series (core results). It does NOT compute physics.
 *
 * It lives OUTSIDE React state on purpose: a per-frame setState in the page re-rendered every chart and form on each animation
 * frame and starved route transitions. Components subscribe to the parts they need (`usePlaybackSnapshot`, `useThrottledT`).
 */
class PlaybackStore {
  private snap: PlaybackSnapshot = { t: 0, state: 'idle', speed: 1, duration: 0 }
  private listeners = new Set<() => void>()
  private raf: number | null = null
  private last = 0
  private lastEmit = 0

  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  getSnapshot = () => this.snap
  private emit(next: Partial<PlaybackSnapshot>) { this.snap = { ...this.snap, ...next }; this.listeners.forEach((l) => l()) }
  private stop() { if (this.raf !== null) cancelAnimationFrame(this.raf); this.raf = null }

  private loop = (now: number) => {
    const dt = (now - this.last) / 1000
    this.last = now
    const t = Math.min(this.snap.duration, this.snap.t + dt * this.snap.speed)
    const done = t >= this.snap.duration
    if (done) { this.emit({ t, state: 'finished' }); this.raf = null; return }
    if (now - this.lastEmit >= 33) { this.lastEmit = now; this.emit({ t }) }  // ≤ 30 UI updates per second
    else this.snap = { ...this.snap, t }                                       // keep the clock exact without notifying
    this.raf = requestAnimationFrame(this.loop)
  }

  setDuration(d: number) { this.stop(); this.emit({ duration: d, t: 0, state: 'idle' }) }
  setSpeed(s: number) { this.emit({ speed: s }) }
  play(from?: number) {
    if (this.snap.duration <= 0) return
    this.stop()
    this.emit({ state: 'playing', ...(from !== undefined ? { t: from } : {}) })
    this.last = performance.now(); this.lastEmit = 0
    this.raf = requestAnimationFrame(this.loop)
  }
  start = () => this.play(0)
  replay = () => this.play(0)
  pause = () => { this.stop(); if (this.snap.state === 'playing') this.emit({ state: 'paused' }) }
  resume = () => { if (this.snap.t >= this.snap.duration) this.play(0); else this.play() }
  reset = () => { this.stop(); this.emit({ t: 0, state: 'idle' }) }
  seek = (t: number) => { const s = this.snap.state; this.emit({ t, state: s === 'playing' ? s : s === 'idle' ? 'paused' : s }) }
}

export const playback = new PlaybackStore()

export function usePlaybackSnapshot(): PlaybackSnapshot { return useSyncExternalStore(playback.subscribe, playback.getSnapshot) }

/** Playback time at most every `ms` milliseconds (for heavy consumers such as charts). Final/seek values always arrive. */
export function useThrottledT(ms = 250): number {
  const [t, setT] = useState(playback.getSnapshot().t)
  const last = useRef(0)
  useEffect(() => playback.subscribe(() => {
    const s = playback.getSnapshot(), now = performance.now()
    if (now - last.current >= ms || s.state !== 'playing') { last.current = now; setT(s.t) }
  }), [ms])
  return t
}

/** Binds the clock to the length of the loaded result and stops it when the page is left. */
export function useBindPlayback(duration: number) {
  useEffect(() => { playback.setDuration(duration) }, [duration])
  useEffect(() => () => playback.reset(), [])
}
