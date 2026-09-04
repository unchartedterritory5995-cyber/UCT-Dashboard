// app/src/hooks/useUserTickerSet.test.jsx
//
// ─── ⚰️ `|| []` DOES NOT MAKE A VALUE ITERABLE ───────────────────────────────
//
// This hook read `for (const wl of (watchlists || []))`. That guard replaces
// null and undefined and NOTHING else, so an object passes straight through it
// and `for...of` throws "is not iterable".
//
// ⛔ WHY THAT WAS SEVERE RATHER THAN UNTIDY: `LogoPrewarm` calls this hook at
// APP ROOT, outside any error boundary. One unexpected shape from
// /api/watchlists therefore took down the ENTIRE app — every route, every
// member — to warm a logo cache. It surfaced as five route tests failing with
// "unable to find the text …", naming the pages instead of the cause.
//
// ⭐ THE ENDPOINT RETURNS A LIST TODAY and this is not doubt about that. It is
// that a proxy error page served with 200, or a future shape change, must cost
// a warmed cache and nothing else.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'

import useUserTickerSet from './useUserTickerSet'

vi.mock('./useFlagged', () => ({ useFlagged: () => ({ flagged: MOCK.flagged }) }))
vi.mock('swr', () => ({ default: () => ({ data: MOCK.watchlists }) }))

const MOCK = { flagged: [], watchlists: [] }
afterEach(() => { cleanup(); MOCK.flagged = []; MOCK.watchlists = [] })

describe('useUserTickerSet survives a shape it did not expect', () => {
  it('⭐ the ordinary case still works', () => {
    MOCK.flagged = ['nvda']
    MOCK.watchlists = [{ items: [{ sym: 'aapl' }, { ticker: 'msft' }] }]
    const { result } = renderHook(() => useUserTickerSet())
    expect([...result.current].sort()).toEqual(['AAPL', 'MSFT', 'NVDA'])
  })

  it.each([
    ['an object where a list was expected', {}],
    ['an error envelope served with 200', { detail: 'nope' }],
    ['a string', 'not a list'],
    ['a number', 7],
  ])('⛔ %s does not throw — it yields an empty set', (_label, shape) => {
    MOCK.watchlists = shape
    // ⚠️ `renderHook` RETHROWS, so this failing is exactly the app-root crash.
    const { result } = renderHook(() => useUserTickerSet())
    expect(result.current instanceof Set).toBe(true)
    expect(result.current.size).toBe(0)
  })

  it('⛔ …and a non-iterable FLAGGED list is guarded too', () => {
    MOCK.flagged = { a: 1 }
    MOCK.watchlists = [{ items: [{ sym: 'tsla' }] }]
    const { result } = renderHook(() => useUserTickerSet())
    // The watchlist half still works — one bad source does not cost the other.
    expect([...result.current]).toEqual(['TSLA'])
  })
})
