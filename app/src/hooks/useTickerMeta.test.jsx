import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useTickerMeta, { fetcher } from './useTickerMeta'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

describe('useTickerMeta', () => {
  let origFetch
  beforeEach(() => { origFetch = global.fetch })
  afterEach(() => { global.fetch = origFetch; vi.restoreAllMocks() })

  it('returns null-safe defaults before/without data', () => {
    global.fetch = vi.fn(() => new Promise(() => {}))
    const { result } = renderHook(() => useTickerMeta('TSLA'), { wrapper })
    expect(result.current).toEqual({ name: null, sector: null, industry: null, theme: null })
  })

  it('returns fetched meta', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'Tesla Inc', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers' }),
    })
    const { result } = renderHook(() => useTickerMeta('TSLA'), { wrapper })
    await waitFor(() => expect(result.current.name).toBe('Tesla Inc'))
    expect(global.fetch).toHaveBeenCalledWith('/api/ticker-meta/TSLA', expect.objectContaining({ credentials: 'include' }))
  })

  it('null-safe when fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false })
    const { result } = renderHook(() => useTickerMeta('TSLA'), { wrapper })
    await waitFor(() => expect(result.current).toEqual({ name: null, sector: null, industry: null, theme: null }))
  })

  it('null-safe when JSON parsing throws', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('bad json') } })
    const { result } = renderHook(() => useTickerMeta('TSLA'), { wrapper })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(result.current).toEqual({ name: null, sector: null, industry: null, theme: null })
  })

  it('does not fetch when sym is falsy', () => {
    global.fetch = vi.fn()
    renderHook(() => useTickerMeta(null), { wrapper })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  // ── Regression: a transient failure must NOT become sticky cached data ──
  // (root cause of the "watermark only shows the ticker for an hour" bug)
  describe('fetcher throws on failure (so SWR retries instead of caching NULLS)', () => {
    it('throws on non-ok response (not cached as a successful NULLS)', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 })
      await expect(fetcher('/api/ticker-meta/ENPH')).rejects.toThrow(/ticker-meta 503/)
    })

    it('throws when the body is not valid JSON (transient HTML error page)', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('bad json') } })
      await expect(fetcher('/api/ticker-meta/ENPH')).rejects.toThrow()
    })

    it('maps fields (incl. theme) on a successful response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ name: 'Enphase Energy, Inc.', sector: 'Technology', industry: 'Solar', theme: 'Clean Energy' }),
      })
      await expect(fetcher('/api/ticker-meta/ENPH')).resolves.toEqual({
        name: 'Enphase Energy, Inc.', sector: 'Technology', industry: 'Solar', theme: 'Clean Energy',
      })
    })
  })

  it('recovers after a transient failure (failure → later success yields data, not sticky NULLS)', async () => {
    const cache = new Map()
    const sharedWrapper = ({ children }) => (
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, errorRetryCount: 0 }}>{children}</SWRConfig>
    )
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 })
    const first = renderHook(() => useTickerMeta('ENPH'), { wrapper: sharedWrapper })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(first.result.current).toEqual({ name: null, sector: null, industry: null, theme: null })
    first.unmount()

    // Backend recovered; a fresh mount (same cache) revalidates and gets data —
    // proving the failure was not pinned as authoritative.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'Enphase Energy, Inc.', sector: 'Technology', industry: 'Solar', theme: 'Clean Energy' }),
    })
    const second = renderHook(() => useTickerMeta('ENPH'), { wrapper: sharedWrapper })
    await waitFor(() => expect(second.result.current.name).toBe('Enphase Energy, Inc.'))
    expect(second.result.current.theme).toBe('Clean Energy')
  })
})
