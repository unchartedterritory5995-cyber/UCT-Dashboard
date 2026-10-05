import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchFilings, filingsError } from './useFilings'

// CF -- an SEC outage (backend answers 200 {"error": ...}) must never read as
// "no filings for this ticker".

afterEach(() => { vi.restoreAllMocks() })

describe('fetchFilings', () => {
  it('keeps a non-2xx as ok:false with its status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 502, json: async () => ({}) })
    expect(await fetchFilings('/x')).toEqual({ ok: false, httpStatus: 502, body: null })
  })
  it('keeps a network failure as ok:false, status 0', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await fetchFilings('/x')).toEqual({ ok: false, httpStatus: 0, body: null })
  })
})

describe('filingsError', () => {
  it('a 200 with an SEC fetch error is unavailable, carrying the reason', () => {
    const e = filingsError({ ok: true, httpStatus: 200, body: { error: 'SEC fetch failed: 503' } })
    expect(e).toEqual({ httpStatus: 200, reason: 'SEC fetch failed: 503', kind: 'unavailable' })
  })
  it('a CIK-map miss is no_filer, not an outage', () => {
    const e = filingsError({ ok: true, httpStatus: 200, body: { error: "ticker 'XYZ' not found in SEC CIK map" } })
    expect(e.kind).toBe('no_filer')
  })
  it('a non-ok response is unavailable', () => {
    expect(filingsError({ ok: false, httpStatus: 500, body: null }).kind).toBe('unavailable')
  })
  it('a readable answer (even empty) is not an error', () => {
    expect(filingsError({ ok: true, httpStatus: 200, body: { ticker: 'A', filings: [] } })).toBeNull()
    expect(filingsError(undefined)).toBeNull()
  })
})
