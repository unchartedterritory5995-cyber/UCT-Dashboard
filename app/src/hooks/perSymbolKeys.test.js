// The key and the fetcher of each small per-symbol read, in one place per read
// (`hooks/*Key.js`). A hook asks under them; a chart header has the rows ahead asked for under
// the same two. These pin what each one is, including what a failed read answers: that is what
// lands in the cache a header reads, whichever of the two asked.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { watchlistPerformanceKey, watchlistPerformanceFetcher } from './watchlistPerformanceKey'
import { watchlistThemesKey, watchlistThemesFetcher } from './watchlistThemesKey'
import { snapshotBatchKey, watchlistMetaFetcher } from './watchlistMetaKey'
import { volumeCurveKey, volumeCurveFetcher } from './volumeCurveKey'
import { delistedKey, delistedFetcher } from './delistedKey'
import { singleStockEtfsKey, singleStockEtfsFetcher } from './singleStockEtfsKey'
import * as volumeCurveHook from './useVolumeCurve'

const answer = (status, body) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })))
const sent = () => { const [url, init] = fetch.mock.calls.at(-1); return { url, method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : undefined, credentials: init && init.credentials } }
afterEach(() => vi.unstubAllGlobals())

describe('the keys', () => {
  it('a ticker set is de-duplicated and sorted, so its order never refetches; no tickers is no key', () => {
    for (const [keyOf, url] of [[watchlistPerformanceKey, '/api/watchlist-performance'], [watchlistThemesKey, '/api/watchlists/themes-batch']]) {
      expect(keyOf(['NVDA', 'AAPL', 'NVDA'])).toEqual([url, ['AAPL', 'NVDA']])
      expect(keyOf(['AAPL', 'NVDA'])).toEqual(keyOf(['NVDA', 'AAPL']))
      expect(keyOf(['NVDA'])).toEqual([url, ['NVDA']])
      expect(keyOf([])).toBeNull()
      expect(keyOf()).toBeNull()
    }
  })

  it('the per-symbol meta key takes the list as the hook prepared it', () => {
    expect(snapshotBatchKey(['AAPL', 'NVDA'])).toEqual(['/api/research/snapshot-batch', ['AAPL', 'NVDA']])
    expect(snapshotBatchKey(['NVDA'])).toEqual(['/api/research/snapshot-batch', ['NVDA']])
    expect(snapshotBatchKey([])).toBeNull()
    expect(snapshotBatchKey()).toBeNull()
  })

  it('the volume curve key is the one the hook module has always exported', () => {
    expect(volumeCurveHook.volumeCurveKey).toBe(volumeCurveKey)
    expect(volumeCurveKey(['nvda', 'AAPL', 'NVDA'])).toBe('/api/screener/volume-curve?tickers=AAPL%2CNVDA')
    expect(volumeCurveKey(['NVDA'])).toBe('/api/screener/volume-curve?tickers=NVDA')
    expect(volumeCurveKey([])).toBe('/api/screener/volume-curve')
  })

  it('a symbol key is for a real symbol: none for an empty one or a synthetic index', () => {
    expect(delistedKey('YHOO')).toBe('/api/delisted/YHOO')
    expect(delistedKey('BRK.B')).toBe('/api/delisted/BRK.B')
    expect(delistedKey('A/B')).toBe('/api/delisted/A%2FB')
    expect(delistedKey('')).toBeNull()
    expect(delistedKey(null)).toBeNull()
    expect(delistedKey('$IDX:ai-chips')).toBeNull()
    expect(singleStockEtfsKey('nvda')).toBe('/api/single-stock-etfs/NVDA')
    expect(singleStockEtfsKey('')).toBeNull()
    expect(singleStockEtfsKey('$IDX:ai-chips')).toBeNull()
  })
})

describe('the fetchers', () => {
  it('the three batch reads POST the tickers as JSON and answer the body', async () => {
    for (const [fetcher, url] of [[watchlistPerformanceFetcher, '/api/watchlist-performance'], [watchlistThemesFetcher, '/api/watchlists/themes-batch'], [watchlistMetaFetcher, '/api/research/snapshot-batch']]) {
      answer(200, { ok: url })
      expect(await fetcher([url, ['AAPL', 'NVDA']])).toEqual({ ok: url })
      expect(sent()).toMatchObject({ url, method: 'POST', body: { tickers: ['AAPL', 'NVDA'] } })
      expect(fetch.mock.calls.at(-1)[1].headers).toEqual({ 'Content-Type': 'application/json' })
    }
  })

  it('a batch read that fails answers its own empty shape, never a throw', async () => {
    answer(500, { detail: 'down' })
    expect(await watchlistPerformanceFetcher(['/api/watchlist-performance', ['NVDA']])).toEqual({})
    expect(await watchlistMetaFetcher(['/api/research/snapshot-batch', ['NVDA']])).toEqual({})
    expect(await watchlistThemesFetcher(['/api/watchlists/themes-batch', ['NVDA']])).toEqual({ results: {} })
  })

  it('the volume curve and the leverage lookup THROW on a failed read (the last good answer is kept)', async () => {
    answer(200, { knots: [] })
    expect(await volumeCurveFetcher('/api/screener/volume-curve?tickers=NVDA')).toEqual({ knots: [] })
    answer(200, { long: [], short: [] })
    expect(await singleStockEtfsFetcher('/api/single-stock-etfs/NVDA')).toEqual({ long: [], short: [] })
    expect(sent().credentials).toBe('include')
    answer(503, {})
    await expect(volumeCurveFetcher('/api/screener/volume-curve')).rejects.toThrow('volume curve 503')
    await expect(singleStockEtfsFetcher('/api/single-stock-etfs/NVDA')).rejects.toThrow('single-stock-etfs 503')
  })

  it('the delisted check answers the record for a dead ticker and null for a live one or a failed read', async () => {
    answer(200, { delisted: true, ticker: 'YHOO', delisted_date: '2017-06-13' })
    expect(await delistedFetcher('/api/delisted/YHOO')).toEqual({ delisted: true, ticker: 'YHOO', delisted_date: '2017-06-13' })
    answer(200, { delisted: false, ticker: 'NVDA' })
    expect(await delistedFetcher('/api/delisted/NVDA')).toBeNull()
    answer(200, null)
    expect(await delistedFetcher('/api/delisted/NVDA')).toBeNull()
    answer(500, { delisted: true })
    expect(await delistedFetcher('/api/delisted/NVDA')).toBeNull()
  })
})
