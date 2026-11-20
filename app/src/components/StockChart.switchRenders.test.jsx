// app/src/components/StockChart.switchRenders.test.jsx
//
// ─── A SYMBOL SWITCH RENDERS STOCKCHART ONCE BEFORE IT PAINTS (switch render cuts, 2026-11-20) ──────
//
// The production path (the bar store on, the neighbour-frames switch on and off), the REAL StockChart,
// lightweight-charts stubbed (the neighbour-frames harness). A switch used to render StockChart TWICE
// before the browser painted: the switch's own render, then a second full pass that every one of these
// caused on its own, each scheduled while the switch committed:
//   · the readout written in the switch applier's layout effect (StockChart state; now a store printed by
//     `ReadoutIsland`s, `chart/ReadoutIsland.jsx`);
//   · `useSessionExtBars` resetting to a fresh `{sym, agg: null, ready: false}` while idle;
//   · `comparisonFramed` reset to a fresh `[]` with no comparisons;
//   · the drawings store's new entry for a symbol with no drawings, a fresh-but-equal snapshot that
//     `useSyncExternalStore` compared with the frozen empty one right after the commit.
// Each of those reverted alone turns this red (mutation-proved). What the switch PRINTS is pinned too: the
// readout commit is a NESTED update (scheduled during the commit, so before paint) and shows the new
// symbol's close.
import React, { Profiler } from 'react'
import { describe, it, expect, vi, afterAll } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'

const S = vi.hoisted(() => ({ log: [], n: 0, rec: false, scRenders: 0 }))
// ⭐ THE RENDER COUNTER: StockChart calls this hook once per render of its body, and nothing else calls it
// (grep `useLegacyDailyTickE`). A `ReadoutIsland`'s render does not.
vi.mock('./chart/legacyLiveWriters', async (orig) => {
  const m = await orig()
  return { ...m, useLegacyDailyTickE: (...a) => { S.scRenders++; return m.useLegacyDailyTickE(...a) } }
})
vi.mock('../lib/realtimeBarsGate', () => ({ realtimeBarsEnabled: () => false }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const make = (type) => {
    const id = ++S.n
    const kind = type === real.CandlestickSeries ? 'candle' : type === real.HistogramSeries ? 'histogram' : type === real.LineSeries ? 'line' : 'other'
    const s = {
      setData: (d) => { if (S.rec) S.log.push([`${kind}#${id}`, 'setData', JSON.stringify(d)]) },
      update: (p) => { if (S.rec) S.log.push([`${kind}#${id}`, 'update', JSON.stringify(p)]) },
      data: () => [],
      applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      createPriceLine: () => ({ applyOptions: () => {} }), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
      detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
      getPane: () => ({ paneIndex: () => 0, getHeight: () => 300, getHTMLElement: () => document.createElement('div'), getSeries: () => [] }),
      priceFormatter: () => ({ format: (x) => String(x) }), moveToPane: () => {}, seriesOrder: () => 0, setSeriesOrder: () => {},
      dataByIndex: () => null, barsInLogicalRange: () => null,
      subscribeDataChanged: () => {}, unsubscribeDataChanged: () => {},
    }
    return s
  }
  const chart = {
    addSeries: (type) => make(type),
    addCandlestickSeries: () => make(real.CandlestickSeries), addHistogramSeries: () => make(real.HistogramSeries),
    addLineSeries: () => make(real.LineSeries), addAreaSeries: () => make(null), addBarSeries: () => make(null),
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
      setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => 600, logicalToCoordinate: () => 0,
      subscribeSizeChange: () => {}, unsubscribeSizeChange: () => {},
      subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    }),
    paneSize: () => ({ width: 600, height: 300 }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    subscribeDblClick: () => {}, unsubscribeDblClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div'), getSeries: () => [], setHeight: () => {}, setStretchFactor: () => {}, getStretchFactor: () => 1, paneIndex: () => 0 }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
    chartElement: () => document.createElement('div'),
  }
  return { ...real, createChart: () => chart, createSeriesMarkers: () => ({ setMarkers: () => {} }) }
})
vi.mock('../utils/barsIDB', async (orig) => ({ ...(await orig()), idbGet: async () => null, idbPut: async () => {}, idbPutMonotonic: async () => {} }))
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

// a Saturday: the newest daily bar is settled and nothing forms
const clock = pinWallClock('2026-11-14T16:00:00Z')
afterAll(() => clock.restore())
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

const rowsFor = (k) => {
  const out = []
  const d = new Date(Date.UTC(2021, 0, 4))
  let i = 0
  while (d.toISOString().slice(0, 10) <= '2026-11-13') {
    const iso = d.toISOString().slice(0, 10)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      const c = 40 * k + Math.sin(i / 11) * 6 * k + i * 0.01
      out.push({ t: iso, o: c - 0.5, h: c + 1.5, l: c - 1.7, c, v: 1e6 + ((i * 7919 * k) % 500000) })
      i++
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const BARS = { AAA: rowsFor(1), BBB: rowsFor(2) }

// the chart's own blob: three natives, an average of close, an average OF the RSI
const SETTINGS = {
  indicatorInstances: [
    { instanceId: 'nf-rsi', defId: 'rsi', inputs: {}, hidden: false },
    { instanceId: 'nf-macd', defId: 'macd', inputs: {}, hidden: false },
    { instanceId: 'nf-bb', defId: 'bb', inputs: {}, hidden: false },
    { instanceId: 'nf-ma', defId: 'movingAverage', inputs: { source: 'close', period: 50 }, hidden: false },
    { instanceId: 'nf-ma-rsi', defId: 'movingAverage', inputs: { source: '@nf-rsi::rsi', period: 9 }, hidden: false },
  ],
}
const noop = () => {}


// BBB's band (68-105) and AAA's (34-59) are disjoint: a candle payload in BBB's band is BBB's
const isBBBCandles = (entry) => {
  if (!entry || !String(entry[0]).startsWith('candle#') || entry[1] !== 'setData') return false
  const d = JSON.parse(entry[2])
  return Array.isArray(d) && d.some((p) => p && typeof p.close === 'number' && p.close > 65)
}
const closeOf = (sym) => BARS[sym][BARS[sym].length - 1].c.toFixed(2)
/** The chart's DOM with what a render cannot be asked to reproduce (React's generated ids) normalised. */
const domOf = (c) => c.innerHTML.replace(/:r[0-9a-z]+:|«r[0-9a-z]+»/g, ':id:')

/** Mount AAA, hold BBB in the store (ON: let it be prepared), switch to BBB, and read every commit. */
async function switchOnce(on) {
  vi.stubGlobal('requestIdleCallback', (cb) => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 5))
  vi.stubGlobal('cancelIdleCallback', (h) => clearTimeout(h))
  S.log.length = 0
  S.n = 0
  S.rec = false
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    const m = /\/api\/bars\/([A-Z]+)/.exec(u)
    if (!m || !BARS[m[1]]) return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => ({}) })
    const body = { ticker: m[1], tf: 'D', bars: BARS[m[1]], newest_bar_is_forming: false }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
  }))
  const M = await loadWithBarStore(true, async () => ({
    StockChart: (await import('./StockChart')).default,
    nf: await import('./chart/neighborFrames'),
    store: (await import('../data/barStore/index')).getBarStore(),
    chartKeyFor: (await import('./chart/useBarSnapshotBars')).chartKeyFor,
  }))
  M.nf.__setNeighborFramesForTests(on)
  const key = M.chartKeyFor({ sym: 'BBB', resolvedTf: 'D', showExtended: false, replayCutoff: null, hasOverride: false })
  const commits = []
  let view = null
  // Profiler's onRender runs in each commit's layout phase, after its subtree's layout effects
  const onRender = (_id, phase) => {
    commits.push({ phase, scRenders: S.scRenders, bbb: S.log.some(isBBBCandles), text: view ? view.container.textContent : '' })
  }
  const el = (sym) => (
    <Profiler id="chart" onRender={onRender}>
      <M.StockChart sym={sym} tf="D" backgroundWarm={false} settingsOverride={SETTINGS} onSettingsPersist={noop} alwaysShowLegend />
    </Profiler>
  )
  view = render(el('AAA'))
  await wait(800)
  M.store.registry.acquire(key)
  await act(async () => { await M.store.ensure(key, { priority: 'urgent' }) })
  if (on) M.nf.publishScanNeighbors('AAA', ['BBB'], [])
  await wait(on ? 2500 : 300)
  const textBefore = view.container.textContent
  commits.length = 0
  S.rec = true
  // ⭐ OUTSIDE act(): the switch runs exactly as a store update does in the browser, and what runs before
  // the rerender returns (and its microtasks) is everything that happens before the frame can paint
  const sc0 = S.scRenders
  view.rerender(el('BBB'))
  await Promise.resolve()
  const sync = commits.slice()
  const syncRenders = S.scRenders - sc0
  // ⭐ THE FIXED POINT, before anything else runs: a full StockChart render now changes nothing on the chart
  const domAfterSwitch = domOf(view.container)
  const sc1 = S.scRenders
  view.rerender(el('BBB'))
  const forced = S.scRenders - sc1
  const domAfterFull = domOf(view.container)
  await wait(600)
  S.rec = false
  cleanup()
  M.store.registry.release(key)
  M.nf.__setNeighborFramesForTests(null)
  return { sync, syncRenders, textBefore, domAfterSwitch, domAfterFull, forced }
}

describe.each([['neighbour frames ON', true], ['neighbour frames OFF', false]])('%s', (_label, on) => {
  it('one StockChart render before paint; the readout lands in a nested commit of islands, printing the new symbol', async () => {
    const { sync, syncRenders, textBefore } = await switchOnce(on)
    expect(textBefore, 'AAA was on screen').toContain(closeOf('AAA'))
    const sw = sync.findIndex((c) => c.bbb)
    expect(sw, 'the switch commit stamped BBB').toBeGreaterThanOrEqual(0)
    const ro = sync[sw + 1]
    expect(ro, 'a readout commit follows the switch commit before paint').toBeTruthy()
    expect(ro.phase).toBe('nested-update')
    expect(ro.text).toContain(closeOf('BBB'))
    expect(ro.text).not.toContain(closeOf('AAA'))
    // ⛔ the islands rendered it, not StockChart
    expect(ro.scRenders - sync[sw].scRenders, 'StockChart renders in the readout commit').toBe(0)
    // ⛔ and nothing else rendered StockChart again before the frame could paint
    expect(syncRenders, `StockChart renders before paint (commits: ${JSON.stringify(sync.map((c) => [c.phase, c.scRenders]))})`).toBe(1)
  }, 30000)

  it('⭐ the fixed point: right after the switch, a full StockChart render changes nothing on the chart', async () => {
    const { domAfterSwitch, domAfterFull, forced } = await switchOnce(on)
    expect(forced, 'the forced render ran').toBeGreaterThan(0)
    expect(domAfterSwitch).toContain(closeOf('BBB'))
    expect(domAfterFull).toBe(domAfterSwitch)
  }, 30000)
})
