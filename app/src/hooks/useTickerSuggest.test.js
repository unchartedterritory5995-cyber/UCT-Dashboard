import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useTickerSuggest, { POPULAR_TICKERS } from './useTickerSuggest'

// Seam 14 (Ticker Search Surface Convergence, 2026-09-06): useTickerSuggest
// previously had ZERO direct test coverage despite being real, shipped,
// production code (TickerCombobox.jsx / Watchlists add-bar) and now the
// shared primitive two more consumers (ChartExampleKit.jsx / SetupsView.jsx
// TickerSearchInput) were converged onto. Writing direct coverage here is
// what caught a real, previously-undiscovered gap: the hook relied SOLELY on
// AbortController for stale-response protection, with no independent
// sequence guard -- harmless in real browsers (which honor AbortSignal
// correctly) but a genuine robustness gap, and the reason
// ChartExampleKit.tickerSearch.test.jsx's own stale-response test initially
// failed against a hand-rolled fetch mock that ignores the signal. Fixed by
// adding a reqIdRef guard (mirrors CommandPalette.jsx/SecuritySymbolInput.jsx).
const DEBOUNCE_WAIT_MS = 220 // hook debounce is 150ms

async function waitDebounce(ms = DEBOUNCE_WAIT_MS) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)) })
}

afterEach(() => {
  delete global.fetch
})

describe('useTickerSuggest -- empty query', () => {
  it('returns the curated POPULAR_TICKERS list and never fetches for an empty query', async () => {
    global.fetch = vi.fn()
    const { result } = renderHook(() => useTickerSuggest(''))
    expect(result.current.results).toEqual(POPULAR_TICKERS)
    await waitDebounce()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('useTickerSuggest -- debounce + request shape', () => {
  it('issues a single debounced request for the final value after rapid typing', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ ticker: 'NVDA', name: 'NVIDIA Corp' }] }),
    }))
    const { rerender } = renderHook(({ q }) => useTickerSuggest(q), { initialProps: { q: 'N' } })
    rerender({ q: 'NV' })
    rerender({ q: 'NVDA' })
    await waitDebounce()
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch.mock.calls[0][0]).toContain('q=NVDA')
  })

  it('does not fetch when enabled is false', async () => {
    global.fetch = vi.fn()
    renderHook(() => useTickerSuggest('NVDA', { enabled: false }))
    await waitDebounce()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('useTickerSuggest -- stale-response protection (Seam 14 fix)', () => {
  it('a stale response never overwrites a newer query\'s results, even when the fetch mock ignores AbortSignal', async () => {
    const resolvers = {}
    global.fetch = vi.fn((url) => {
      const q = new URL(String(url), 'http://x').searchParams.get('q')
      return new Promise((resolve) => { resolvers[q] = resolve })
    })
    const { result, rerender } = renderHook(({ q }) => useTickerSuggest(q), { initialProps: { q: 'AA' } })
    await waitDebounce()
    rerender({ q: 'AAPL' })
    await waitDebounce()

    // The stale 'AA' request resolves AFTER 'AAPL' is already in flight.
    await act(async () => {
      resolvers['AA']?.({ ok: true, json: () => Promise.resolve({ results: [{ ticker: 'AAA', name: 'Stale Corp' }] }) })
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(result.current.results.some((r) => r.ticker === 'AAA')).toBe(false)

    await act(async () => {
      resolvers['AAPL']?.({ ok: true, json: () => Promise.resolve({ results: [{ ticker: 'AAPL', name: 'Apple Inc.' }] }) })
    })
    await waitFor(() => expect(result.current.results.some((r) => r.ticker === 'AAPL')).toBe(true))
  })
})

describe('useTickerSuggest -- typed-value fallback + error degradation', () => {
  it('appends a synthetic typed-value row when the exact ticker is not in server results', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) }))
    const { result } = renderHook(() => useTickerSuggest('ZZZZ'))
    await waitDebounce()
    await waitFor(() => expect(result.current.results).toEqual([{ ticker: 'ZZZZ', name: null, _typed: true }]))
  })

  it('keeps real results AND appends the typed row when none of them is an exact match', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ ticker: 'AAPL', name: 'Apple Inc.' }] }),
    }))
    const { result } = renderHook(() => useTickerSuggest('ZZZZ'))
    await waitDebounce()
    await waitFor(() => expect(result.current.results).toEqual([
      { ticker: 'AAPL', name: 'Apple Inc.' },
      { ticker: 'ZZZZ', name: null, _typed: true },
    ]))
  })

  it('does not duplicate the typed row when the server already returned an exact match', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ ticker: 'AAPL', name: 'Apple Inc.' }] }),
    }))
    const { result } = renderHook(() => useTickerSuggest('AAPL'))
    await waitDebounce()
    await waitFor(() => expect(result.current.results).toEqual([{ ticker: 'AAPL', name: 'Apple Inc.' }]))
  })

  it('degrades to the typed value on a failed request -- never blocks, never throws', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }))
    const { result } = renderHook(() => useTickerSuggest('NVDA'))
    await waitDebounce()
    await waitFor(() => expect(result.current.results).toEqual([{ ticker: 'NVDA', name: null, _typed: true }]))
    expect(result.current.loading).toBe(false)
  })

  it('degrades to the typed value on a network-level rejection', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network down')))
    const { result } = renderHook(() => useTickerSuggest('NVDA'))
    await waitDebounce()
    await waitFor(() => expect(result.current.results).toEqual([{ ticker: 'NVDA', name: null, _typed: true }]))
  })
})
