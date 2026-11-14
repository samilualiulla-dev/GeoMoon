import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, buildUrl, expectEqualLengthColumns, expectKeys, request } from './http'

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('http layer', () => {
  it('builds query strings skipping empty values', () => {
    expect(buildUrl('/x', { a: 1, b: undefined, c: null, d: '', e: false }, '/api')).toBe('/api/x?a=1&e=false')
  })
  it('returns parsed JSON and sends bodies', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ ok: 1 }))
    expect(await request('POST', '/p', { body: { a: 1 } })).toEqual({ ok: 1 })
    const init = f.mock.calls[0][1]!; expect(init.method).toBe('POST'); expect(init.body).toBe('{"a":1}')
  })
  it('turns core error bodies into ApiError with code/details', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ error: { code: 'data_unavailable', message: 'No real DEM', details: { x: 1 } } }, 404))
    const e = await request('GET', '/t').catch((x) => x) as ApiError
    expect(e).toBeInstanceOf(ApiError); expect(e.kind).toBe('http'); expect(e.status).toBe(404); expect(e.code).toBe('data_unavailable'); expect(e.message).toBe('No real DEM'); expect(e.details).toEqual({ x: 1 })
  })
  it('describes validation errors per field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ error: { code: 'request_validation_failed', message: 'Request validation failed', details: { errors: [{ loc: ['body', 'dry_mass_kg'], message: 'Input should be greater than 0', type: 'x' }] } } }, 422))
    const e = await request('POST', '/s', { body: {} }).catch((x) => x) as ApiError
    expect(e.describe()).toContain('dry_mass_kg — Input should be greater than 0')
  })
  it('reports unreachable core as network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const e = await request('GET', '/h').catch((x) => x) as ApiError
    expect(e.kind).toBe('network'); expect(e.describe()).toMatch(/Cannot reach the GeoMoon core/)
  })
  it('times out', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_u, init) => new Promise((_r, rej) => { (init!.signal as AbortSignal).addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))) }))
    const e = await request('GET', '/slow', { timeoutMs: 20 }).catch((x) => x) as ApiError
    expect(e.kind).toBe('timeout')
  })
  it('rejects non-JSON and malformed responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<html>oops</html>', { status: 200 }))
    expect(((await request('GET', '/a').catch((x) => x)) as ApiError).kind).toBe('schema')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonRes({ nope: 1 }))
    const e = await request('GET', '/b', { guard: expectKeys('need') }).catch((x) => x) as ApiError
    expect(e.kind).toBe('schema'); expect(e.message).toMatch(/missing field "need"/)
  })
  it('handles non-JSON error pages (proxy 502)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Bad gateway', { status: 502, statusText: 'Bad Gateway' }))
    const e = await request('GET', '/c').catch((x) => x) as ApiError
    expect(e.kind).toBe('network'); expect(e.status).toBe(502)
  })
  it('treats a gateway 502 without a core error body as an unreachable core', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 502, statusText: 'Bad Gateway' }))
    const e = await request('GET', '/h').catch((x) => x) as ApiError
    expect(e.kind).toBe('network'); expect(e.describe()).toMatch(/Cannot reach the GeoMoon core/)
  })
  it('validates time-series column lengths', () => {
    expect(() => expectEqualLengthColumns({ a: [1, 2], b: [1] }, ['a', 'b'])).toThrow(/length/)
    expect(() => expectEqualLengthColumns({ a: [] }, ['a'])).toThrow(/empty/)
    expect(() => expectEqualLengthColumns({ a: [1] }, ['a', 'b'])).toThrow(/missing/)
    expect(() => expectEqualLengthColumns({ a: [1, 2], b: [3, 4] }, ['a', 'b'])).not.toThrow()
  })
})
