import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import useSessionExtBars from './useSessionExtBars'
import { idbGet } from '../utils/barsIDB'

// Warm 5m IDB cache is the fast path; default it to a miss (null) so the existing
// network-path tests behave exactly as before, and override per-test where needed.
vi.mock('../utils/barsIDB', () => ({ idbGet: vi.fn(async () => null) }))

// `ready` is the whole point of this hook's return shape: it separates "this symbol's
// fetch hasn't landed" from "it landed and there are no extended-hours prints" — both
// of which are agg == null. StockChart refuses to paint a session candle until ready,
// because the live ext price arrives from a warm cache ~1s before this aggregate does,
// and a price with no aggregate draws a flat doji that then morphs (2026-07-17 bug).

const ANCHOR = '2026-07-17'
// 5-min bars at 08:00 and 08:05 ET on the anchor day (EDT = UTC-4).
const etSec = (h, m) => Math.floor(Date.UTC(2026, 6, 17, h + 4, m, 0) / 1000)
const PRE_BARS = [
  { t: etSec(8, 0), o: 10, h: 10.5, l: 9.8, c: 10.2, v: 100 },
  { t: etSec(8, 5), o: 10.2, h: 11.0, l: 10.1, c: 10.9, v: 200 },
]

const okOnce = (bars) => vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bars }) })

describe('useSessionExtBars — ready semantics', () => {
  beforeEach(() => { vi.restoreAllMocks(); idbGet.mockResolvedValue(null) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('FAST PATH: paints instantly from a warm 5m IDB cache, no network wait', async () => {
    idbGet.mockResolvedValueOnce({ bars: PRE_BARS })
    // Network hangs forever — so if `ready` flips, it can ONLY be the IDB fast path.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { result } = renderHook(() => useSessionExtBars('MU', 'pre', true, ANCHOR))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.agg).toEqual({ open: 10, high: 11.0, low: 9.8, close: 10.9, volume: 300 })
  })

  it('a stale/cold IDB (no TODAY prints) does NOT settle from cache — network drives ready', async () => {
    // Prior-day bars: aggregateExtBars finds nothing for the anchor day → null agg,
    // so the fast path must NOT settle (settling null would flash the doji). The
    // network then supplies the real aggregate.
    idbGet.mockResolvedValueOnce({ bars: [{ t: etSec(8, 0) - 3 * 86400, o: 1, h: 1, l: 1, c: 1, v: 1 }] })
    vi.stubGlobal('fetch', okOnce(PRE_BARS))
    const { result } = renderHook(() => useSessionExtBars('MU', 'pre', true, ANCHOR))
    await waitFor(() => expect(result.current.ready).toBe(true))
    // The real (network) aggregate — proving the stale cache didn't settle a wrong agg.
    expect(result.current.agg).toEqual({ open: 10, high: 11.0, low: 9.8, close: 10.9, volume: 300 })
  })

  it('starts NOT ready, then reports the aggregate once the fetch lands', async () => {
    vi.stubGlobal('fetch', okOnce(PRE_BARS))
    const { result } = renderHook(() => useSessionExtBars('MU', 'pre', true, ANCHOR))

    // First render: nothing painted yet — this is the window that used to draw a doji.
    expect(result.current.ready).toBe(false)
    expect(result.current.agg).toBeNull()

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.agg).toEqual({ open: 10, high: 11.0, low: 9.8, close: 10.9, volume: 300 })
  })

  it('a settled fetch with NO ext prints is ready with a null agg (never wedges)', async () => {
    vi.stubGlobal('fetch', okOnce([]))
    const { result } = renderHook(() => useSessionExtBars('MU', 'pre', true, ANCHOR))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.agg).toBeNull()   // resolved-empty — distinct from loading
  })

  it('a failing endpoint still settles ready, so the caller is never stuck', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const { result } = renderHook(() => useSessionExtBars('MU', 'pre', true, ANCHOR))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.agg).toBeNull()
  })

  it('inert (no fetch, never ready) when the session preview is off', () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const { result } = renderHook(() => useSessionExtBars('MU', null, false, ANCHOR))
    expect(f).not.toHaveBeenCalled()
    expect(result.current).toEqual({ agg: null, ready: false })
  })

  it('a symbol switch resets ready — the prior symbols aggregate must never paint', async () => {
    vi.stubGlobal('fetch', okOnce(PRE_BARS))
    const { result, rerender } = renderHook(
      ({ s }) => useSessionExtBars(s, 'pre', true, ANCHOR),
      { initialProps: { s: 'MU' } },
    )
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.agg).not.toBeNull()

    rerender({ s: 'AEHR' })   // new symbol → must not inherit MU's candle
    expect(result.current.ready).toBe(false)
    expect(result.current.agg).toBeNull()
  })
})
