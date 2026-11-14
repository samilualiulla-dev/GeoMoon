import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/http'

export interface FetchState<T> { data: T | null; error: ApiError | null; loading: boolean; reload: () => void }

/** Minimal data-loading hook: AbortController, error object, manual reload. */
export function useFetch<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[] = [], enabled = true): FetchState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    if (!enabled) { setLoading(false); return }
    const ctrl = new AbortController()
    setLoading(true)
    fnRef.current(ctrl.signal)
      .then((d) => { if (!ctrl.signal.aborted) { setData(d); setError(null) } })
      .catch((e) => { if (!ctrl.signal.aborted && !(e instanceof ApiError && e.kind === 'aborted')) setError(e instanceof ApiError ? e : new ApiError('network', String(e))) })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false) })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}

export function asApiError(e: unknown): ApiError { return e instanceof ApiError ? e : new ApiError('network', e instanceof Error ? e.message : String(e)) }
