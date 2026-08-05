/**
 * The provisional row must never be mistaken for a settled one — and must
 * disappear the moment the authoritative row exists.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { createElement } from 'react'
import { useLiveBreadth } from './useLiveBreadth'

const wrapper = ({ children }) =>
  createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } },
    children)

function payload(over = {}) {
  return {
    ok: true,
    superseded: false,
    as_of: '2026-08-05T14:47:00-04:00',
    session_date: '2026-08-05',
    market_open: true,
    universe_size: 2720,
    carried_from: '2026-08-04',
    carried: { naaim: 84.02, cboe_putcall: 0.81 },
    accuracy: { pct_above_50sma: 'point', new_52w_highs: 'approximate' },
    partial_session: ['hvc_52w', 'up_vol_ratio'],
    degraded: false,
    row: { date: '2026-08-05', pct_above_50sma: 66.3, breadth_score: 71.2 },
    ...over,
  }
}

function mockFetch(body, ok = true) {
  global.fetch = vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) }))
}

describe('useLiveBreadth', () => {
  beforeEach(() => { vi.useRealTimers() })
  afterEach(() => { vi.restoreAllMocks() })

  it('returns a row flagged live so the table can style it as provisional', async () => {
    mockFetch(payload())
    const { result } = renderHook(() => useLiveBreadth(), { wrapper })
    await waitFor(() => expect(result.current.row).toBeTruthy())
    expect(result.current.row._live).toBe(true)
    expect(result.current.row.pct_above_50sma).toBe(66.3)
    expect(result.current.asOf).toBe('2026-08-05T14:47:00-04:00')
  })

  it('withholds the row once the collector has written the day', async () => {
    // The estimate must not sit beside the number it was estimating.
    mockFetch(payload({ superseded: true }))
    const { result } = renderHook(() => useLiveBreadth(), { wrapper })
    await waitFor(() => expect(result.current.meta).toBeTruthy())
    expect(result.current.row).toBeNull()
  })

  it('withholds the row when the backend reports it could not compute', async () => {
    mockFetch({ ok: false, reason: 'reference levels unavailable' })
    const { result } = renderHook(() => useLiveBreadth(), { wrapper })
    await waitFor(() => expect(result.current.meta).toBeTruthy())
    expect(result.current.row).toBeNull()
  })

  it('withholds a row that arrives WITH ok:false', async () => {
    // The router 503s rather than returning this shape, so the `ok` check is
    // defence in depth — which is worth pinning, or it reads as dead code and
    // gets deleted by the next person tidying up.
    mockFetch(payload({ ok: false }))
    const { result } = renderHook(() => useLiveBreadth(), { wrapper })
    await waitFor(() => expect(result.current.meta).toBeTruthy())
    expect(result.current.row).toBeNull()
  })

  it('surfaces which fields were carried from last night, not measured today', async () => {
    mockFetch(payload())
    const { result } = renderHook(() => useLiveBreadth(), { wrapper })
    await waitFor(() => expect(result.current.row).toBeTruthy())
    expect(result.current.carried.has('naaim')).toBe(true)
    expect(result.current.carried.has('pct_above_50sma')).toBe(false)
    expect(result.current.carriedFrom).toBe('2026-08-04')
  })

  it('surfaces per-metric accuracy so a 10% number cannot look like a 1% one', async () => {
    mockFetch(payload())
    const { result } = renderHook(() => useLiveBreadth(), { wrapper })
    await waitFor(() => expect(result.current.row).toBeTruthy())
    expect(result.current.accuracy.pct_above_50sma).toBe('point')
    expect(result.current.accuracy.new_52w_highs).toBe('approximate')
    expect(result.current.partial.has('hvc_52w')).toBe(true)
  })

  it('does not fetch at all when disabled', async () => {
    mockFetch(payload())
    const { result } = renderHook(() => useLiveBreadth({ enabled: false }), { wrapper })
    await waitFor(() => expect(result.current.row).toBeNull())
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('survives a dead endpoint without taking the page down', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network')))
    const { result } = renderHook(() => useLiveBreadth(), { wrapper })
    await waitFor(() => expect(result.current.row).toBeNull())
  })
})

describe('useLiveBreadth polling cadence', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('backs off once the collector has written the day', async () => {
    // The hook is mounted on the Dashboard — the busiest page. Polling a
    // payload that cannot change until tomorrow's open is pure cost.
    const { refreshIntervalFor } = await import('./useLiveBreadth')
    expect(refreshIntervalFor(payload())).toBe(60_000)
    expect(refreshIntervalFor(payload({ superseded: true }))).toBe(15 * 60_000)
    expect(refreshIntervalFor(null)).toBe(15 * 60_000)
  })
})

describe('useLiveBreadth degraded coverage', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('shows nothing when bars measured a different population', async () => {
    // Seen for real against a thin local bars.db: 2,720 names priced but only
    // ~100 carrying enough history, so pct_above_50sma described a different
    // market. A fresher view of the same metric is useful; a different metric
    // wearing the same name is not.
    mockFetch(payload({ degraded: true }))
    const { result } = renderHook(() => useLiveBreadth(), { wrapper })
    await waitFor(() => expect(result.current.meta).toBeTruthy())
    expect(result.current.row).toBeNull()
    expect(result.current.degraded).toBe(true)
  })

  it('still shows the row at normal coverage', async () => {
    mockFetch(payload({ degraded: false, measured: 2701 }))
    const { result } = renderHook(() => useLiveBreadth(), { wrapper })
    await waitFor(() => expect(result.current.row).toBeTruthy())
    expect(result.current.measured).toBe(2701)
  })
})
