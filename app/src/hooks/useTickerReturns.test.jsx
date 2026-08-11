import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { useTickerReturns, fetcher } from './useTickerReturns'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

beforeEach(() => { vi.restoreAllMocks() })

describe('useTickerReturns', () => {
  it('null videoId fetches nothing and returns empties', () => {
    const spy = vi.spyOn(global, 'fetch')
    const { result } = renderHook(() => useTickerReturns(null), { wrapper })
    expect(result.current).toEqual({ anchorDate: null, returns: {} })
    expect(spy).not.toHaveBeenCalled()
  })
  it('maps the payload and hits the right URL', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({
      anchor_date: '2026-02-11', as_of: 'x',
      returns: { NVDA: { since_pct: 14.2, d5_pct: 3.1, d21_pct: 8.0 } } }) })
    const { result } = renderHook(() => useTickerReturns(42), { wrapper })
    await waitFor(() => expect(result.current.anchorDate).toBe('2026-02-11'))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/education/videos/42/ticker-returns', { credentials: 'include' })
    expect(result.current.returns.NVDA.since_pct).toBe(14.2)
  })

  // ── Regression: a transient failure must NOT become sticky cached data ──
  // (same defect class fixed in useTickerMeta.js — see its comment). A !ok
  // response has to surface to SWR as an ERROR so it retries, not as a
  // "successful" null that gets pinned for the full 5-minute dedupingInterval.
  describe('fetcher throws on failure (so SWR retries instead of caching null)', () => {
    it('throws on non-ok response (not resolved as null)', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503 })
      await expect(fetcher('/api/education/videos/42/ticker-returns'))
        .rejects.toThrow(/ticker-returns 503/)
    })
    it('resolves the parsed payload on a successful response', async () => {
      const payload = { anchor_date: '2026-02-11', as_of: 'x', returns: {} }
      vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => payload })
      await expect(fetcher('/api/education/videos/42/ticker-returns')).resolves.toEqual(payload)
    })
  })

  it('error → empties (never throws into render), with no unhandled rejection noise', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    // errorRetryCount: 0 — this test asserts the SETTLED state after the one
    // rejected fetcher call; it isn't exercising SWR's retry/backoff timing,
    // so scheduled retries would just be stray timers still firing after the
    // test (and the hook) has moved on.
    const errWrapper = ({ children }) => (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
        {children}
      </SWRConfig>
    )
    const { result, unmount } = renderHook(() => useTickerReturns(42), { wrapper: errWrapper })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(result.current).toEqual({ anchorDate: null, returns: {} })
    unmount()
    // Let any stray microtask/rejection surface before asserting silence —
    // SWR catches the fetcher's throw internally, so nothing should log here.
    await new Promise((r) => setTimeout(r, 0))
    expect(consoleError).not.toHaveBeenCalled()
  })
})
