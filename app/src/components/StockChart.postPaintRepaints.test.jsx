// app/src/components/StockChart.postPaintRepaints.test.jsx  (harness from StockChart.switchRenders.test.jsx)
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

const S = vi.hoisted(() => ({ log: [], n: 0, rec: false, scRenders: 0, renderAt: [], ops: [], fetches: [], inCommit: false, t0: 0, futureIds: new Set() }))
// ⭐ THE RENDER COUNTER: StockChart calls this hook once per render of its body, and nothing else calls it
// (grep `useLegacyDailyTickE`). A `ReadoutIsland`'s render does not.
vi.mock('./chart/legacyLiveWriters', async (orig) => {
  const m = await orig()
  return { ...m, useLegacyDailyTickE: (...a) => { S.scRenders++; if (S.rec) S.renderAt.push(Math.round(performance.now() - S.t0)); return m.useLegacyDailyTickE(...a) } }
})
vi.mock('../lib/realtimeBarsGate', () => ({ realtimeBarsEnabled: () => false }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const make = (type, opts) => {
    const id = ++S.n
    if (opts && opts.color === 'rgba(0,0,0,0)' && opts.priceScaleId === '') S.futureIds.add(id)
    const kind = type === real.CandlestickSeries ? 'candle' : type === real.HistogramSeries ? 'histogram' : type === real.LineSeries ? 'line' : 'other'
    const s = {
      setData: (d) => { if (S.rec) { S.log.push([`${kind}#${id}`, 'setData', JSON.stringify(d)]); S.ops.push([Math.round(performance.now() - S.t0), `${kind}#${id}`, 'setData', (d || []).length]) } },
      update: (p) => { if (S.rec) { S.log.push([`${kind}#${id}`, 'update', JSON.stringify(p)]); S.ops.push([Math.round(performance.now() - S.t0), `${kind}#${id}`, 'update', 1]) } },
      applyOptions: () => { if (S.rec) S.ops.push([Math.round(performance.now() - S.t0), `${kind}#${id}`, 'applyOptions', 0]) },
      data: () => [],
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
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
    addSeries: (type, opts) => make(type, opts),
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



// ─── AFTER A SWITCH PAINTS, NO SERIES IS HANDED ITS DATA AGAIN (2026-11-21, the post-paint backlog) ──────
//
// The independent review traced the owner's board (D + 30m, four averages + volume): in the 800 ms after a
// switch first painted, the charts repainted 15 times and the main thread was busy 75% of it. Every `setData` is
// a repaint of the whole chart. This file pins, on the production path (the bar store on, the REAL StockChart,
// lightweight-charts stubbed), that a switch hands each series its data ONCE and nothing repaints it in the
// 1.5 s after:
//   · the hidden future-axis series (`_applyFutureWs`) re-ran on every render with identical points (2-3
//     `setData` per switch); now only when its slots change (and they are still handed over when they do).
// Mutation-proved (restored from a saved copy): the future-axis guard removed.

/** Rows ending on `lastIso`, scaled by k (k picks a price band). */
const rowsTo = (k, lastIso) => {
  const out = []
  const d = new Date(Date.UTC(2021, 0, 4))
  let i = 0
  while (d.toISOString().slice(0, 10) <= lastIso) {
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

async function switchAndWatch({ to, bars, nf }) {
  S.log.length = 0; S.ops.length = 0; S.renderAt.length = 0; S.fetches.length = 0; S.futureIds.clear(); S.n = 0; S.rec = false
  vi.stubGlobal('requestIdleCallback', (cb) => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 5))
  vi.stubGlobal('cancelIdleCallback', (h) => clearTimeout(h))
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    const m = /\/api\/bars\/([A-Z]+)/.exec(u)
    if (!m || !bars[m[1]]) return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => ({}) })
    const body = { ticker: m[1], tf: 'D', bars: bars[m[1]], newest_bar_is_forming: false }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
  }))
  const M = await loadWithBarStore(true, async () => ({
    StockChart: (await import('./StockChart')).default,
    nf: await import('./chart/neighborFrames'),
    store: (await import('../data/barStore/index')).getBarStore(),
    chartKeyFor: (await import('./chart/useBarSnapshotBars')).chartKeyFor,
  }))
  M.nf.__setNeighborFramesForTests(nf)
  const key = M.chartKeyFor({ sym: to, resolvedTf: 'D', showExtended: false, replayCutoff: null, hasOverride: false })
  const el = (sym) => <M.StockChart sym={sym} tf="D" backgroundWarm={false} settingsOverride={SETTINGS} onSettingsPersist={noop} alwaysShowLegend />
  const view = render(el('AAA'))
  await wait(1200)
  M.store.registry.acquire(key)
  await act(async () => { await M.store.ensure(key, { priority: 'urgent' }) })
  if (nf) M.nf.publishScanNeighbors('AAA', [to], [])
  await wait(nf ? 2500 : 300)
  S.rec = true
  S.t0 = performance.now()
  view.rerender(el(to))
  await wait(1500)
  S.rec = false
  const perSeries = {}
  for (const [, id, op] of S.ops) if (op === 'setData') perSeries[id] = (perSeries[id] || 0) + 1
  const future = [...S.futureIds].map((id) => Object.entries(perSeries).filter(([k]) => k.endsWith(`#${id}`)).reduce((a, [, v]) => a + v, 0))
  cleanup()
  M.store.registry.release(key)
  M.nf.__setNeighborFramesForTests(null)
  return { perSeries, future, candlesDrawn: S.log.some((e) => String(e[0]).startsWith('candle#') && e[1] === 'setData') }
}

describe.each([['neighbour frames ON', true], ['neighbour frames OFF', false]])('after a switch paints (%s)', (_l, nf) => {
  it('every series, the future axis included, is handed its data at most once', async () => {
    const r = await switchAndWatch({ to: 'BBB', bars: { AAA: rowsTo(1, '2026-11-13'), BBB: rowsTo(2, '2026-11-13') }, nf })
    expect(r.candlesDrawn, 'NON-VACUITY: the switch drew the new candles').toBe(true)
    expect(r.future.length, 'NON-VACUITY: the future-axis series was identified').toBe(1)
    for (const [id, n] of Object.entries(r.perSeries)) expect(n, `setData on ${id} after the switch (all: ${JSON.stringify(r.perSeries)})`).toBeLessThanOrEqual(1)
  }, 60000)

  it('the future axis is handed its new slots exactly once when they move', async () => {
    // CCC ends a trading day later: its future slots start a day later
    const r = await switchAndWatch({ to: 'CCC', bars: { AAA: rowsTo(1, '2026-11-12'), CCC: rowsTo(2, '2026-11-13') }, nf })
    expect(r.candlesDrawn).toBe(true)
    expect(r.future.reduce((a, b) => a + b, 0), `future-axis setData, slots moved (all: ${JSON.stringify(r.perSeries)})`).toBe(1)
  }, 60000)
})
