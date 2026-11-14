import type { SeriesKey, TimeSeries } from '../api/types'

/** Linear interpolation of every column at time t (playback readout only — data come from the core). */
export function sampleAt(ts: TimeSeries, t: number): Record<SeriesKey, number> {
  const T = ts.time_s
  const n = T.length
  const tt = Math.max(T[0], Math.min(T[n - 1], t))
  let lo = 0, hi = n - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= tt) lo = mid; else hi = mid }
  const span = T[hi] - T[lo]
  const f = span > 0 ? (tt - T[lo]) / span : 0
  const out: Record<string, number> = {}
  for (const k of Object.keys(ts)) {
    const col = ts[k]
    out[k] = col[lo] + (col[hi] - col[lo]) * f
  }
  return out as Record<SeriesKey, number>
}

/** Thin an index range to at most `max` points (always keeps first and last). */
export function thinIndices(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i)
  const step = (n - 1) / (max - 1)
  const idx = Array.from({ length: max }, (_, i) => Math.round(i * step))
  return idx
}
