// ⭐ REVIEW OF #2753 — the extended-hours custom intraday grid (04:00 ET) per CHART, not per page, and never served
// from the other view:
//   MEDIUM-1  the benchmark tail is keyed with the session, and an ask resamples with the view it was made for (an
//             answer landing after an EXT toggle is still bucketed on the grid it was asked on)
//   MEDIUM-2  a script's other-symbol bars and the tail take the CHART's own `showExtended` (two charts of one board
//             can differ), not the page-global view
//   LOW       `&session=eth` only for a 60m base (1/5/15/30m are one grid in both views: no duplicate fetch or cache)
//   x9        the legacy source's custom series request (spec + base URL) follows the chart's session
//   (TOGGLE   chart/useBarSnapshotBars.extended4h.test.jsx: an EXT toggle replaces the 4h series wholesale)
import { describe, it, expect, afterEach } from 'vitest'
import { compareBarsRequest, customSeriesRequest } from '../components/chart/useLegacyChartBars'
import { secondaryFetchOf, clearSecondaryBars } from '../components/chart/engine/secondaryBars'
import { ensureChartSources } from '../components/chart/engine/useSecondarySources'
import {
  benchmarkTailFor, benchmarkTailUrl, _resetBenchmarkTailsForTests, _inflightBenchmarkTails,
} from '../components/chart/engine/liveTail'
import { setViewShowExtended } from './viewSession'

afterEach(() => { setViewShowExtended(false); _resetBenchmarkTailsForTests(); clearSecondaryBars() })

const T0 = 1795510800                                   // 2026-11-24 04:00 ET (EST), TradingView's first 4h bar
const clockHours = (n = 16) => Array.from({ length: n }, (_, k) => ({ t: T0 + k * 3600, o: k, h: k, l: k, c: k + 100, v: 1 }))
const sessionHours = () => Array.from({ length: 7 }, (_, k) => ({ t: T0 + 330 * 60 + k * 3600, o: k, h: k, l: k, c: k + 200, v: 1 }))   // 09:30..15:30

describe('MEDIUM-1: the benchmark tail is keyed with the session and resampled with the view it was asked for', () => {
  it('a tail landed in the regular view is never served to the extended view (its own key, its own ask)', async () => {
    const asked = []
    const fetcher = (url) => { asked.push(url); return url.includes('session=eth') ? { bars: clockHours() } : { bars: sessionHours() } }
    benchmarkTailFor('SPX', '240', { extended: false, fetcher })
    await Promise.all(_inflightBenchmarkTails())
    const rth = benchmarkTailFor('SPX', '240', { extended: false, fetcher })
    expect(rth.bars.map((b) => b.t)).toEqual([T0 + 570 * 60 - 240 * 60 + 4 * 3600])   // 13:30 (the 09:30 bucket dropped as partial)
    expect(benchmarkTailFor('SPX', '240', { extended: true, fetcher })).toBeNull()          // before: the regular view's tail
    expect(asked.at(-1)).toContain('&session=eth')
    await Promise.all(_inflightBenchmarkTails())
    const eth = benchmarkTailFor('SPX', '240', { extended: true, fetcher })
    expect(eth.bars.map((b) => b.t)).toEqual([T0 + 4 * 3600, T0 + 8 * 3600, T0 + 12 * 3600])
  })

  it('an ask in flight across an EXT toggle is resampled with the view it was made for', async () => {
    let release
    const fetcher = () => new Promise((r) => { release = () => r({ bars: sessionHours() }) })
    benchmarkTailFor('QQQ', '240', { extended: false, fetcher })   // asked in the regular view
    setViewShowExtended(true)                                          // the page toggles before the answer lands
    release()
    await Promise.all(_inflightBenchmarkTails())
    const t = benchmarkTailFor('QQQ', '240', { extended: false, fetcher })
    expect(t.bars.map((b) => b.t)).toEqual([T0 + 570 * 60 - 240 * 60 + 4 * 3600])     // 09:30-anchored, as asked
  })
})

describe('MEDIUM-2: the CHART\'s own session, whatever the page view says', () => {
  it('a script\'s other-symbol bars: an extended chart on a page whose view is regular, and the reverse', () => {
    setViewShowExtended(false)
    const ext = secondaryFetchOf('SPX', '240', 500, { extended: true })
    expect(ext.url).toContain('&session=eth')
    expect(ext.spec.anchorMin).toBe(240)
    setViewShowExtended(true)
    const reg = secondaryFetchOf('SPX', '240', 500, { extended: false })
    expect(reg.url).not.toContain('session=')
    expect(reg.spec.anchorMin).toBe(570)
  })

  it('the supply hook hands the chart\'s session to the fetch', () => {
    setViewShowExtended(false)
    const asked = []
    ensureChartSources(['SPX'], '240', 300, (url) => { asked.push(url); return new Promise(() => {}) }, null, 0, true)
    return Promise.resolve().then(() => {
      expect(asked.length).toBe(1)
      expect(asked[0]).toContain('tf=60&')
      expect(asked[0]).toContain('&session=eth')
    })
  })

  it('the tail: the chart\'s session decides its key and grid, not the page view', async () => {
    setViewShowExtended(true)
    const asked = []
    const fetcher = (url) => { asked.push(url); return { bars: sessionHours() } }
    benchmarkTailFor('IWM', '240', { extended: false, fetcher })
    expect(asked[0]).not.toContain('session=')
    await Promise.all(_inflightBenchmarkTails())
    expect(benchmarkTailFor('IWM', '240', { extended: false, fetcher }).bars.map((b) => b.t)).toEqual([T0 + 570 * 60 - 240 * 60 + 4 * 3600])
  })
})

describe('LOW: &session=eth only for a 60m base; the custom code\'s own key still names the view', () => {
  it.each([['45', '15'], ['65', '5'], ['10', '5']])('%s extended: the base %s is fetched once for both views', (tf, base) => {
    expect(compareBarsRequest('spy', tf, 900, '', true).url).not.toContain('session=')
    const w = secondaryFetchOf('SPX', tf, 500, { extended: true })
    expect(w.fetchUrl).toContain(`tf=${base}&`)
    expect(w.fetchUrl).not.toContain('session=')
    expect(w.url).toContain('&session=eth')                       // (the 45m answer itself differs by view)
    expect(benchmarkTailUrl('SPX', tf, { extended: true })).not.toContain('session=')
    expect(customSeriesRequest('SPY', tf, true).url).not.toContain('session=')
  })
  it('120 / 240 extended (base 60): the clock grid', () => {
    for (const tf of ['120', '240']) {
      expect(compareBarsRequest('spy', tf, 900, '', true).url).toContain('&session=eth')
      expect(secondaryFetchOf('SPX', tf, 500, { extended: true }).fetchUrl).toContain('&session=eth')
      expect(benchmarkTailUrl('SPX', tf, { extended: true })).toContain('&session=eth')
    }
  })
})

describe('x9: the legacy source\'s custom series request follows the chart\'s session', () => {
  it('extended: anchored at 04:00 on the clock grid; regular: 09:30, the stored grid', () => {
    const e = customSeriesRequest('SPY', '240', true)
    expect(e.spec.anchorMin).toBe(240)
    expect(e.url).toBe('/api/bars/SPY?tf=60&bars=5000&session=eth')
    const r = customSeriesRequest('SPY', '240', false)
    expect(r.spec.anchorMin).toBe(570)
    expect(r.url).toBe('/api/bars/SPY?tf=60&bars=5000')
    expect(customSeriesRequest('SPY', '60', true)).toEqual({ spec: null, url: null })
  })
})
