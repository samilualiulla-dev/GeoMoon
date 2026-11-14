// Single HTTP layer for the whole UI. Every request has a timeout, structured error handling and
// (optionally) a response guard. Nothing here fabricates data: failures surface as ApiError.

export type ErrorKind = 'network' | 'timeout' | 'http' | 'schema' | 'aborted'

export class ApiError extends Error {
  readonly kind: ErrorKind
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>
  constructor(kind: ErrorKind, message: string, opts: { status?: number; code?: string; details?: Record<string, unknown> } = {}) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = opts.status ?? 0
    this.code = opts.code ?? kind
    this.details = opts.details ?? {}
  }
  /** Human-readable multi-line text for UI banners. */
  describe(): string {
    if (this.kind === 'network') return `Cannot reach the GeoMoon core. Is the backend running? (${this.message})`
    if (this.kind === 'timeout') return `The core did not answer in time. ${this.message}`
    const errs = (this.details as { errors?: { loc: string[]; message: string }[] }).errors
    if (Array.isArray(errs) && errs.length) {
      return `${this.message}: ` + errs.map((e) => `${e.loc.filter((l) => l !== 'body').join('.')} — ${e.message}`).join('; ')
    }
    return this.message
  }
}

export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api'

export interface RequestOptions<T> {
  query?: Record<string, string | number | boolean | null | undefined>
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
  guard?: (data: unknown) => T
}

export function buildUrl(path: string, query?: RequestOptions<unknown>['query'], base = API_BASE): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  const s = qs.toString()
  return `${base}${path}${s ? `?${s}` : ''}`
}

export async function request<T>(method: 'GET' | 'POST', path: string, opts: RequestOptions<T> = {}): Promise<T> {
  const { timeoutMs = 30_000, signal } = opts
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctrl.abort() }, timeoutMs)
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    let res: Response
    try {
      res = await fetch(buildUrl(path, opts.query), {
        method,
        headers: opts.body !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
      })
    } catch (e) {
      if (timedOut) throw new ApiError('timeout', `No response within ${Math.round(timeoutMs / 1000)} s for ${method} ${path}.`)
      if (signal?.aborted) throw new ApiError('aborted', 'Request cancelled')
      throw new ApiError('network', e instanceof Error ? e.message : String(e))
    }
    const text = await res.text()
    let json: unknown = undefined
    if (text) {
      try { json = JSON.parse(text) } catch { json = undefined }
    }
    if (!res.ok) {
      const body = json as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | undefined
      if (body?.error) {
        throw new ApiError('http', body.error.message ?? res.statusText, { status: res.status, code: body.error.code, details: body.error.details })
      }
      // Gateway/proxy answered instead of the core (e.g. Vite dev proxy with the backend stopped).
      if ([502, 503, 504].includes(res.status)) throw new ApiError('network', `gateway answered HTTP ${res.status}`, { status: res.status })
      throw new ApiError('http', `HTTP ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}`, { status: res.status })
    }
    if (json === undefined) throw new ApiError('schema', `Empty or non-JSON response from ${method} ${path}`, { status: res.status })
    if (opts.guard) {
      try { return opts.guard(json) } catch (e) {
        throw new ApiError('schema', `Unexpected response shape from ${path}: ${e instanceof Error ? e.message : String(e)}`, { status: res.status })
      }
    }
    return json as T
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

// ---- tiny runtime guards ----
export function isRecord(x: unknown): x is Record<string, unknown> { return typeof x === 'object' && x !== null && !Array.isArray(x) }

export function expectKeys<T>(...keys: string[]) {
  return (data: unknown): T => {
    if (!isRecord(data)) throw new Error('expected an object')
    for (const k of keys) if (!(k in data)) throw new Error(`missing field "${k}"`)
    return data as T
  }
}

export function expectArray<T>(data: unknown): T[] {
  if (!Array.isArray(data)) throw new Error('expected an array')
  return data as T[]
}

export function expectEqualLengthColumns(series: unknown, required: string[]): void {
  if (!isRecord(series)) throw new Error('time_series must be an object')
  let n = -1
  for (const k of required) {
    const col = series[k]
    if (!Array.isArray(col)) throw new Error(`time_series.${k} missing`)
    if (n === -1) n = col.length
    else if (col.length !== n) throw new Error(`time_series.${k} length ${col.length} != ${n}`)
  }
  if (n < 1) throw new Error('time_series is empty')
}
