import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useTickerMeta, { fetcher, prefetchTickerMeta } from './useTickerMeta'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

describe('useTickerMeta', () => {
  let origFetch
  // Clear localStorage between tests — the hook now persists hits there, and a
  // stale entry would otherwise seed fallbackData and pollute other cases.
  beforeEach(() => { origFetch = global.fetch; localStorage.clear() })
  afterEach(() => { global.fetch = origFetch; vi.restoreAllMocks(); localStorage.clear() })

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

  // ── localStorage seed: the fix for the ~½s watermark "pop-in" lag ──
  describe('localStorage instant first paint', () => {
    it('persists a successful hit to localStorage', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ name: 'Tesla Inc', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers', theme: 'EV' }),
      })
      const { result } = renderHook(() => useTickerMeta('TSLA'), { wrapper })
      await waitFor(() => expect(result.current.name).toBe('Tesla Inc'))
      const stored = JSON.parse(localStorage.getItem('tmeta:TSLA'))
      expect(stored.d).toEqual({ name: 'Tesla Inc', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers', theme: 'EV' })
      expect(typeof stored.t).toBe('number')
    })

    it('paints full meta synchronously from localStorage before any fetch resolves', () => {
      localStorage.setItem('tmeta:TSLA', JSON.stringify({
        t: Date.now(),
        d: { name: 'Tesla Inc', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers', theme: 'EV' },
      }))
      global.fetch = vi.fn(() => new Promise(() => {})) // never resolves
      const { result } = renderHook(() => useTickerMeta('TSLA'), { wrapper })
      // First render already has the data — no pop-in.
      expect(result.current).toEqual({ name: 'Tesla Inc', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers', theme: 'EV' })
    })

    it('ignores an expired localStorage entry (falls back to NULLS + fetch)', () => {
      localStorage.setItem('tmeta:TSLA', JSON.stringify({
        t: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days old, TTL is 7
        d: { name: 'Stale Inc', sector: null, industry: null, theme: null },
      }))
      global.fetch = vi.fn(() => new Promise(() => {}))
      const { result } = renderHook(() => useTickerMeta('TSLA'), { wrapper })
      expect(result.current).toEqual({ name: null, sector: null, industry: null, theme: null })
    })

    it('does not persist an all-null transient miss', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ name: null, sector: null, industry: null, theme: null }),
      })
      const { result } = renderHook(() => useTickerMeta('TSLA'), { wrapper })
      await waitFor(() => expect(global.fetch).toHaveBeenCalled())
      expect(result.current).toEqual({ name: null, sector: null, industry: null, theme: null })
      expect(localStorage.getItem('tmeta:TSLA')).toBeNull()
    })
  })

  describe('prefetchTickerMeta', () => {
    it('fetches and writes localStorage when not already warm', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ name: 'Nvidia Corp', sector: 'Technology', industry: 'Semiconductors', theme: 'AI' }),
      })
      prefetchTickerMeta('NVDA')
      await waitFor(() => expect(localStorage.getItem('tmeta:NVDA')).not.toBeNull())
      expect(global.fetch).toHaveBeenCalledWith('/api/ticker-meta/NVDA', expect.objectContaining({ credentials: 'include' }))
      expect(JSON.parse(localStorage.getItem('tmeta:NVDA')).d.name).toBe('Nvidia Corp')
    })

    it('skips the network when the ticker is already warm in localStorage', () => {
      localStorage.setItem('tmeta:NVDA', JSON.stringify({
        t: Date.now(),
        d: { name: 'Nvidia Corp', sector: 'Technology', industry: 'Semiconductors', theme: 'AI' },
      }))
      global.fetch = vi.fn()
      prefetchTickerMeta('NVDA')
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('no-ops on a falsy symbol', () => {
      global.fetch = vi.fn()
      prefetchTickerMeta(null)
      expect(global.fetch).not.toHaveBeenCalled()
    })
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
