import { useEffect, useState } from 'react'
import { api } from '../api/endpoints'
import type { ApiError } from '../api/http'
import type { Health } from '../api/types'
import { asApiError } from './useFetch'

export type CoreStatus = { state: 'checking' } | { state: 'online'; health: Health } | { state: 'offline'; error: ApiError }

/** Polls GET /api/health. */
export function useHealth(intervalMs = 10_000): CoreStatus {
  const [s, setS] = useState<CoreStatus>({ state: 'checking' })
  useEffect(() => {
    let alive = true
    const ctrl = new AbortController()
    const tick = () => api.health(ctrl.signal).then((h) => alive && setS({ state: 'online', health: h })).catch((e) => alive && setS({ state: 'offline', error: asApiError(e) }))
    tick()
    const id = setInterval(tick, intervalMs)
    return () => { alive = false; ctrl.abort(); clearInterval(id) }
  }, [intervalMs])
  return s
}
