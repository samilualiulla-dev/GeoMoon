import { useCallback, useEffect, useRef, useState } from 'react'

export type PlayState = 'idle' | 'playing' | 'paused' | 'finished'

/** Time controller for replaying a computed time series (core results). Does not compute physics. */
export function usePlayback(duration_s: number) {
  const [t, setT] = useState(0)
  const [state, setState] = useState<PlayState>('idle')
  const [speed, setSpeed] = useState(1)
  const raf = useRef<number | null>(null)
  const last = useRef(0)
  const tRef = useRef(0)
  const speedRef = useRef(1)
  speedRef.current = speed

  const stop = () => { if (raf.current !== null) cancelAnimationFrame(raf.current); raf.current = null }

  const loop = useCallback((now: number) => {
    const dt = (now - last.current) / 1000
    last.current = now
    tRef.current = Math.min(duration_s, tRef.current + dt * speedRef.current)
    setT(tRef.current)
    if (tRef.current >= duration_s) { setState('finished'); raf.current = null; return }
    raf.current = requestAnimationFrame(loop)
  }, [duration_s])

  const play = useCallback((from?: number) => {
    stop()
    if (from !== undefined) { tRef.current = from; setT(from) }
    last.current = performance.now()
    setState('playing')
    raf.current = requestAnimationFrame(loop)
  }, [loop])

  const start = useCallback(() => play(0), [play])
  const pause = useCallback(() => { stop(); setState((s) => (s === 'playing' ? 'paused' : s)) }, [])
  const resume = useCallback(() => { if (tRef.current >= duration_s) play(0); else play() }, [play, duration_s])
  const reset = useCallback(() => { stop(); tRef.current = 0; setT(0); setState('idle') }, [])
  const seek = useCallback((v: number) => { tRef.current = v; setT(v); setState((s) => (s === 'playing' ? s : s === 'idle' ? 'paused' : s)) }, [])

  useEffect(() => stop, [])
  useEffect(() => { reset() }, [duration_s, reset])
  return { t, state, speed, setSpeed, start, pause, resume, reset, replay: start, seek }
}
