import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { playback } from './usePlayback'

let now = 0
beforeEach(() => {
  vi.useFakeTimers(); now = 0
  vi.stubGlobal('performance', { now: () => now })
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => setTimeout(() => { now += 16; cb(now) }, 16) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  playback.setDuration(10); playback.setSpeed(1)
})
afterEach(() => { playback.reset(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('playback clock', () => {
  it('advances in real time at the chosen speed', () => {
    playback.start(); vi.advanceTimersByTime(2000)
    expect(playback.getSnapshot().state).toBe('playing'); expect(playback.getSnapshot().t).toBeGreaterThan(1.8); expect(playback.getSnapshot().t).toBeLessThan(2.2)
    playback.setSpeed(5); const t0 = playback.getSnapshot().t; vi.advanceTimersByTime(1000)
    expect(playback.getSnapshot().t - t0).toBeGreaterThan(4.5)
  })
  it('pause freezes, resume continues, reset returns to zero', () => {
    playback.start(); vi.advanceTimersByTime(1000); playback.pause()
    const t = playback.getSnapshot().t; vi.advanceTimersByTime(1000)
    expect(playback.getSnapshot()).toMatchObject({ state: 'paused', t })
    playback.resume(); vi.advanceTimersByTime(500); expect(playback.getSnapshot().t).toBeGreaterThan(t)
    playback.reset(); expect(playback.getSnapshot()).toMatchObject({ state: 'idle', t: 0 })
  })
  it('finishes at the end of the series and replays from zero', () => {
    playback.setSpeed(25); playback.start(); vi.advanceTimersByTime(2000)
    expect(playback.getSnapshot()).toMatchObject({ state: 'finished', t: 10 })
    playback.replay(); vi.advanceTimersByTime(100); expect(playback.getSnapshot().state).toBe('playing'); expect(playback.getSnapshot().t).toBeLessThan(10)
    playback.reset(); playback.setSpeed(25); playback.start(); vi.advanceTimersByTime(2000); playback.resume(); expect(playback.getSnapshot().t).toBeLessThan(10)   // resume at the end restarts
  })
  it('seek works while idle/paused/playing and never plays without data', () => {
    playback.seek(4); expect(playback.getSnapshot()).toMatchObject({ t: 4, state: 'paused' })
    playback.setDuration(0); playback.start(); expect(playback.getSnapshot().state).toBe('idle')
  })
  it('a new result stops the clock and rewinds', () => {
    playback.start(); vi.advanceTimersByTime(500); playback.setDuration(20)
    expect(playback.getSnapshot()).toMatchObject({ state: 'idle', t: 0, duration: 20 })
  })
})
