import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useTickerMeta, { fetcher, prefetchTickerMeta } from './useTickerMeta'
import fs from 'node:fs'
import path from 'node:path'

/** ⛔ THE SHAPE BEFORE ANY DATA, IN ONE PLACE. It gained `exchange` on 2026-09-13
 *  (T5b) and six cases asserted it field-for-field; naming it once is what makes
 *  the next field a one-line change instead of a six-line one. */
const NULL_META = { name: null, sector: null, industry: null, theme: null, exchange: null }

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
    expect(result.current).toEqual(NULL_META)
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
    await waitFor(() => expect(result.current).toEqual(NULL_META))
  })

  it('null-safe when JSON parsing throws', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('bad json') } })
    const { result } = renderHook(() => useTickerMeta('TSLA'), { wrapper })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(result.current).toEqual(NULL_META)
  })

  // ─── ⭐⭐ T5b — THE PROJECTION MUST NOT DROP WHAT THE SERVER SENDS ──────────
  //
  // ⚰️ MEASURED IN A REAL BROWSER, 2026-09-13. `fetcher` named four fields and
  // the endpoint answers five: `exchange` was dropped on its way through this
  // hook, so `tickerMeta.exchange` was `undefined` on EVERY chart in the app,
  // `StockChart`'s `symbolMeta` built `{ticker, exchange: null}`, and three of
  // `uncharted-volume-v2`'s four columns refused on a witnessed symbol. Every
  // rail on the fold below it passed, because they all hand it the object this
  // layer failed to build. `lesson_a_projection_drops_what_it_does_not_name`.
  //
  // ⛔ THE CONTRACT IS READ, NEVER TYPED. `get_ticker_meta`'s own docstring is
  // where the shape is declared; a hand-copied list here would go stale in
  // exactly the way the defect did.
  describe('⛔⛔ every field the endpoint declares survives the hook', () => {
    /** The server's declared response keys, parsed out of
     *  `api/services/ticker_meta.py::get_ticker_meta`'s docstring. */
    const serverKeys = (() => {
      const src = fs.readFileSync(
        path.resolve(process.cwd(), '..', 'api/services/ticker_meta.py'), 'utf8')
      const at = src.indexOf('def get_ticker_meta')
      const m = /\{([a-z_,\s]+)\}/.exec(src.slice(at, at + 400))
      return m ? m[1].split(',').map((k) => k.trim()).filter(Boolean) : []
    })()

    it('the contract is readable, and this test can see it', () => {
      // ⛔ THE NON-VACUITY CONTROL. A parse that found nothing would make every
      // assertion below pass over an empty list — the shape of "an absence is
      // only evidence if the instrument could have seen a presence".
      expect(serverKeys.length).toBeGreaterThanOrEqual(4)
      expect(serverKeys).toContain('name')
    })

    it('⛔ fetcher surfaces every declared field, by value', async () => {
      const body = Object.fromEntries(serverKeys.map((k, i) => [k, `v${i}`]))
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body })
      const got = await fetcher('/api/ticker-meta/SPY')
      for (const k of serverKeys) {
        expect(got, `the hook drops \`${k}\`, which the endpoint declares`).toHaveProperty(k, body[k])
      }
    })

    it('⛔ …and the pre-data shape answers every one of them too', () => {
      global.fetch = vi.fn(() => new Promise(() => {}))
      const { result } = renderHook(() => useTickerMeta('SPY'), { wrapper })
      for (const k of serverKeys) {
        expect(result.current, `NULLS has no \`${k}\``).toHaveProperty(k, null)
      }
    })

    it('⭐ an exchange-only answer is a REAL hit and gets seeded', async () => {
      // SPY has no sector and no industry. Before this, the one field the
      // bind-time fold needs was the one field `lsPut` refused to persist, so a
      // reload bound unwitnessed on the first paint every time.
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ name: null, sector: null, industry: null, theme: null, exchange: 'NYSE Arca' }),
      })
      const { result } = renderHook(() => useTickerMeta('SPY'), { wrapper })
      await waitFor(() => expect(result.current.exchange).toBe('NYSE Arca'))
      expect(JSON.parse(localStorage.getItem('tmeta:SPY')).d.exchange).toBe('NYSE Arca')
    })
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
      expect(stored.d).toEqual({ name: 'Tesla Inc', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers', theme: 'EV', exchange: null })
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
      expect(result.current).toEqual(NULL_META)
    })

    it('does not persist an all-null transient miss', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => (NULL_META),
      })
      const { result } = renderHook(() => useTickerMeta('TSLA'), { wrapper })
      await waitFor(() => expect(global.fetch).toHaveBeenCalled())
      expect(result.current).toEqual(NULL_META)
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
        exchange: null,
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
    expect(first.result.current).toEqual(NULL_META)
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
