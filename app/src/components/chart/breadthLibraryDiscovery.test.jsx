// Breadth reaches the chart through the CANONICAL discovery path, ranked the way a
// member thinks — metric first, universe second — and an unregistered colon token
// never becomes breadth.
//
// ⛔ No new surface is exercised here on purpose: this is `useSymbolDiscovery`, the
// hook `SourceField` already uses, now reading the canonical library.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import CATALOG from './__fixtures__/breadthLibraryRows.json'
import useSymbolDiscovery from './useSymbolDiscovery'
import * as breadthHook from '../../hooks/useBreadthSymbols'

const LIB = {
  rows: CATALOG.rows,
  families: CATALOG.families,
  universes: CATALOG.universes,
  metricOrder: new Map(CATALOG.metric_order.map((m, i) => [m, i])),
}

/** The hook shape `useSymbolDiscovery` consumes. */
function stubBreadth(library = LIB) {
  vi.spyOn(breadthHook, 'default').mockReturnValue({
    ready: true,
    isBreadth: () => false,
    get: () => null,
    groups: [],
    all: () => library.rows,
    library: () => library,
  })
}

/** No network: the remote half answers empty so the rails measure the LOCAL path. */
const noRemote = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) })

const run = (q) => renderHook(() => useSymbolDiscovery(q, true, { fetcher: noRemote }))

beforeEach(() => {
  vi.restoreAllMocks()
  stubBreadth()
})

describe('a member finds breadth without knowing a symbol', () => {
  it('⭐ "50 day" answers with the A50 family, metric first', async () => {
    const { result } = run('50 day')
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0))
    const top = result.current.results.slice(0, 4)
    expect(top.map((r) => r.id))
      .toEqual(['UCTA50', 'US:A50', 'NASDAQ:A50', 'NYSE:A50'])
    // the human name leads; the symbol is carried but is not the organising idea
    expect(top[0].name).toBe('% of Stocks Above 50-Day MA')
    expect(top.every((r) => r.kind === 'breadth')).toBe(true)
  })

  it('"above 50" and "A50" reach the same family', async () => {
    for (const q of ['above 50', 'A50']) {
      const { result } = run(q)
      await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0))
      expect(result.current.results[0].id, q).toBe('UCTA50')
    }
  })

  it('"new lows" leads with New Lows, "new highs" with New Highs', async () => {
    const lo = run('new lows')
    await waitFor(() => expect(lo.result.current.results.length).toBeGreaterThan(0))
    expect(lo.result.current.results[0].name).toBe('New 52-Week Lows')
    const hi = run('new highs')
    await waitFor(() => expect(hi.result.current.results.length).toBeGreaterThan(0))
    expect(hi.result.current.results[0].name).toBe('New 52-Week Highs')
  })

  it('"high low" surfaces New Highs, New Lows AND Net New High-Low', async () => {
    const { result } = run('high low')
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0))
    const names = result.current.results.map((r) => r.name)
    expect(names).toContain('Net New 52-Week Highs-Lows')
    expect(names).toContain('New 52-Week Highs')
    expect(names).toContain('New 52-Week Lows')
  })

  it('"NASDAQ breadth" lists Nasdaq and only Nasdaq', async () => {
    const { result } = run('NASDAQ breadth')
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0))
    expect(result.current.results.every((r) => r.id.startsWith('NASDAQ:'))).toBe(true)
  })
})

describe('identity', () => {
  it('an exact canonical symbol resolves to exactly that series', async () => {
    for (const sym of ['NASDAQ:A50', 'US:NETHL', 'UCTA50']) {
      const { result } = run(sym)
      await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0))
      expect(result.current.results[0].id, sym).toBe(sym)
      expect(result.current.results[0].create.source).toBe(`sym:${sym}:close`)
    }
  })

  it('⛔ a colon does not make something breadth', async () => {
    for (const bad of ['NASDAQ:AAPL', 'FOO:BAR']) {
      const { result } = run(bad)
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.results.filter((r) => r.kind === 'breadth'), bad).toEqual([])
    }
  })

  it('⭐ a legacy UCT row keeps its SYMBOL as the chip; a namespaced row wears its universe', async () => {
    const { result } = run('50 day')
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0))
    const byId = Object.fromEntries(result.current.results.map((r) => [r.id, r]))
    // `UCTA50` is what a member types and reads on the axis — replacing it with
    // "UCT" would be a regression dressed as consistency.
    expect(byId['UCTA50'].shortName).toBe('UCTA50')
    expect(byId['NASDAQ:A50'].shortName).toBe('NASDAQ')
    expect(byId['NYSE:A50'].shortName).toBe('NYSE')
  })
})

describe('presentation travels with the result', () => {
  it('NETHL is a signed histogram; A50 is a plain line', async () => {
    const { result } = run('US:NETHL')
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0))
    expect(result.current.results[0].create.presentation)
      .toEqual({ plotStyle: 'histogram', signColors: true })

    const a = run('US:A50')
    await waitFor(() => expect(a.result.current.results.length).toBeGreaterThan(0))
    expect(a.result.current.results[0].create.presentation).toBeUndefined()
  })
})

describe('the pre-library fallback', () => {
  it('a payload with no `library` block still matches by substring', async () => {
    stubBreadth({ rows: [], families: [], universes: [], metricOrder: new Map() })
    vi.spyOn(breadthHook, 'default').mockReturnValue({
      ready: true, isBreadth: () => false, get: () => null, groups: [],
      all: () => [{ symbol: 'UCTA50', name: '% of Stocks Above 50-Day MA',
                    group_label: 'MA Breadth' }],
      library: () => ({ rows: [], families: [], universes: [], metricOrder: new Map() }),
    })
    const { result } = run('UCTA')
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0))
    expect(result.current.results[0].id).toBe('UCTA50')
  })
})
