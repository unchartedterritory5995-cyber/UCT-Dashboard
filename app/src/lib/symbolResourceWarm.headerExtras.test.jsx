// THE WIRES for the chart header's optional reads and the leverage control.
//
// Measured on production 2026-11-13: an optional info-row field (N-day change, theme, relative
// volume, IPO date) read "—" for 0.3 to 0.85 s after the candles on every flip, because the
// request behind it started only once the chart was on the symbol. The reads are now held for
// the rows ahead while a header shows them (`components/chart/pane/useHeaderExtrasWarm.js`).
//
// ⛔ A warm under a key the hook does not ask for warms nothing and nobody notices. So this
// file runs the REAL hooks, the real fetchers and real SWR, with only `fetch` stood in, and
// asserts the only thing that matters: after the rows ahead are asked for, a header that
// arrives on one has its values without another request.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup, waitFor } from '@testing-library/react'
import { warmSymbolResources, symbolResourceWarmStats, useSymbolResource, __resetSymbolResourceWarm } from './symbolResourceWarm'
import useHeaderExtrasWarm from '../components/chart/pane/useHeaderExtrasWarm'
import useWatchlistPerformance from '../hooks/useWatchlistPerformance'
import useWatchlistThemes from '../hooks/useWatchlistThemes'
import useWatchlistMeta from '../hooks/useWatchlistMeta'
import useVolumeCurve from '../hooks/useVolumeCurve'
import useDelisted from '../hooks/useDelisted'
import useSingleStockEtfs from '../hooks/useSingleStockEtfs'
import { singleStockEtfsKey, singleStockEtfsFetcher } from '../hooks/singleStockEtfsKey'

const NEAR = { priority: true }
const ALL = { perf: true, theme: true, meta: true, curve: true, delisted: true }
let asked
/** every request the page made: [method, url, tickers-in-body] */
const requests = (sym) => asked.filter((r) => r.join(' ').includes(sym))

// One server for every read, answering per symbol so a wrong-symbol answer is visible.
function server(url, init) {
  const u = String(url)
  const tickers = init && init.body ? JSON.parse(init.body).tickers : null
  asked.push([init && init.method ? init.method : 'GET', u, tickers ? tickers.join(',') : ''])
  const one = (make) => Object.fromEntries((tickers || []).map((t) => [t, make(t)]))
  let body
  if (u === '/api/watchlist-performance') body = one((t) => ({ '5d': t.length, '30d': t.charCodeAt(0) }))
  else if (u === '/api/watchlists/themes-batch') body = { results: one((t) => `Theme of ${t}`) }
  else if (u === '/api/research/snapshot-batch') body = one((t) => ({ avg_volume_30d: 1000 + t.length, ipo_date: `2004-08-${t.length}9` }))
  else if (u.startsWith('/api/screener/volume-curve')) body = { knots: [[0, 0], [390, 1]], for: new URL(u, 'http://x').searchParams.get('tickers') }
  else if (u.startsWith('/api/delisted/')) body = { delisted: true, ticker: u.split('/').pop(), delisted_date: '2017-06-13' }
  else if (u.startsWith('/api/single-stock-etfs/')) body = { long: [{ ticker: `${u.split('/').pop()}L` }], short: [] }
  else return Promise.resolve({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) })
  return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: async () => body })
}

// What a chart header does: holds the reads it shows, and reads them for its own symbol.
function useHeader({ sym, shows }) {
  useHeaderExtrasWarm(shows)
  return {
    perf: useWatchlistPerformance(shows.perf ? [sym] : []).perfData[sym],
    theme: useWatchlistThemes(shows.theme ? [sym] : []).themeData[sym],
    meta: useWatchlistMeta(shows.meta ? [sym] : []).metaData[sym],
    curve: useVolumeCurve(!!shows.curve, shows.curve ? [sym] : []),
    delisted: useDelisted(shows.delisted ? sym : null),
  }
}

beforeEach(() => {
  __resetSymbolResourceWarm({ painted: true })
  asked = []
  vi.stubGlobal('fetch', vi.fn(server))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the chart header\'s optional reads (useHeaderExtrasWarm)', () => {
  it('⭐ the row ahead is asked for under each hook\'s own key, and arriving has every value with no further request', async () => {
    // (symbols no other test in this file uses: SWR's cache is the app's one cache)
    const seen = []
    const view = renderHook((p) => { const r = useHeader(p); seen.push([p.sym, r]); return r }, { initialProps: { sym: 'NVDA', shows: ALL } })
    await waitFor(() => expect(view.result.current.meta).toBeTruthy())
    expect(symbolResourceWarmStats().resources).toBe(5)

    expect(warmSymbolResources(['AAPL'], 'D', NEAR), 'five reads, one row').toBe(5)
    await waitFor(() => expect(requests('AAPL').length).toBe(5))
    expect(requests('AAPL').sort()).toEqual([
      ['GET', '/api/delisted/AAPL', ''],
      ['GET', '/api/screener/volume-curve?tickers=AAPL', ''],
      ['POST', '/api/research/snapshot-batch', 'AAPL'],
      ['POST', '/api/watchlist-performance', 'AAPL'],
      ['POST', '/api/watchlists/themes-batch', 'AAPL'],
    ].sort())
    await waitFor(() => expect(symbolResourceWarmStats()).toMatchObject({ active: 0, queued: 0 }))
    await new Promise((r) => setTimeout(r, 20))

    view.rerender({ sym: 'AAPL', shows: ALL })
    const first = seen.find(([sym]) => sym === 'AAPL')[1]
    expect(first.perf, 'N-day change on the first render').toEqual({ '5d': 4, '30d': 65 })
    expect(first.theme, 'theme on the first render').toBe('Theme of AAPL')
    expect(first.curve, 'the volume curve on the first render').toMatchObject({ for: 'AAPL' })
    expect(first.delisted, 'the delisted check on the first render').toMatchObject({ ticker: 'AAPL' })
    // the meta hook copies its answer into its own map in an effect: one commit later, no request
    await waitFor(() => expect(view.result.current.meta).toEqual({ avg_volume_30d: 1004, ipo_date: '2004-08-49' }))
    await new Promise((r) => setTimeout(r, 80))
    expect(requests('AAPL').length, 'and arriving cost no request at all').toBe(5)
  })

  it('⛔ a read the header does not show is not held, and no row is asked for on its behalf', async () => {
    const view = renderHook((p) => useHeader(p), { initialProps: { sym: 'TSLA', shows: { perf: true } } })
    await waitFor(() => expect(view.result.current.perf).toBeTruthy())
    expect(symbolResourceWarmStats().resources).toBe(1)
    expect(warmSymbolResources(['AMD'], 'D', NEAR)).toBe(1)
    await waitFor(() => expect(requests('AMD')).toEqual([['POST', '/api/watchlist-performance', 'AMD']]))
    // the member adds Theme to the header: now two; removes both: none
    view.rerender({ sym: 'TSLA', shows: { perf: true, theme: true } })
    expect(symbolResourceWarmStats().resources).toBe(2)
    view.rerender({ sym: 'TSLA', shows: {} })
    expect(symbolResourceWarmStats().resources).toBe(0)
    expect(warmSymbolResources(['INTC'], 'D', NEAR)).toBe(0)
    view.rerender({ sym: 'TSLA', shows: ALL })
    view.unmount()
    expect(symbolResourceWarmStats().resources, 'released with the header').toBe(0)
  })

  it('each flag holds its own read and no other', () => {
    for (const [flag, url] of [['perf', '/api/watchlist-performance'], ['theme', '/api/watchlists/themes-batch'],
      ['meta', '/api/research/snapshot-batch'], ['curve', '/api/screener/volume-curve?tickers=QCOM'], ['delisted', '/api/delisted/QCOM']]) {
      __resetSymbolResourceWarm({ painted: true })
      asked.length = 0
      const view = renderHook(() => useHeaderExtrasWarm({ [flag]: true }))
      expect(warmSymbolResources(['QCOM'], 'D', NEAR), flag).toBe(1)
      expect(asked.map((r) => r[1]), flag).toEqual([url])
      view.unmount()
    }
    // no argument at all is "shows nothing"
    const none = renderHook(() => useHeaderExtrasWarm())
    expect(symbolResourceWarmStats().resources).toBe(0)
    none.unmount()
  })
})

describe('the leverage control\'s lookup (useSingleStockEtfs, held by the chart widget)', () => {
  it('⭐ asked for ahead under the hook\'s own key: arriving has the family on the first render, no request', async () => {
    const seen = []
    const view = renderHook(({ sym }) => {
      useSymbolResource(singleStockEtfsKey, singleStockEtfsFetcher)       // what ChartWidget does
      const r = useSingleStockEtfs(sym); seen.push([sym, r]); return r
    }, { initialProps: { sym: 'MSFT' } })
    await waitFor(() => expect(view.result.current.hasFamily).toBe(true))
    expect(warmSymbolResources(['ibm'], 'D', NEAR)).toBe(1)
    await waitFor(() => expect(requests('IBM')).toEqual([['GET', '/api/single-stock-etfs/IBM', '']]))
    await waitFor(() => expect(symbolResourceWarmStats()).toMatchObject({ active: 0 }))
    await new Promise((r) => setTimeout(r, 20))
    view.rerender({ sym: 'IBM' })
    const first = seen.find(([sym]) => sym === 'IBM')[1]
    expect(first.hasFamily).toBe(true)
    expect(first.family.long[0].ticker).toBe('IBML')
    await new Promise((r) => setTimeout(r, 80))
    expect(requests('IBM').length).toBe(1)
  })

  it('a synthetic index has no family and is never asked for', () => {
    expect(singleStockEtfsKey('$IDX:ai-chips')).toBeNull()
    expect(singleStockEtfsKey('')).toBeNull()
    expect(singleStockEtfsKey('nvda')).toBe('/api/single-stock-etfs/NVDA')
  })
})
