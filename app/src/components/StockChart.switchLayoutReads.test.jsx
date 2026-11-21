// (harness from StockChart.switchRenders.test.jsx)
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

const S = vi.hoisted(() => ({ range: null, log: [], n: 0, rec: false, scRenders: 0, renderAt: [], ops: [], fetches: [], inCommit: false, t0: 0 }))
// ⭐ THE RENDER COUNTER: StockChart calls this hook once per render of its body, and nothing else calls it
// (grep `useLegacyDailyTickE`). A `ReadoutIsland`'s render does not.
vi.mock('./chart/legacyLiveWriters', async (orig) => {
  const m = await orig()
  return { ...m, useLegacyDailyTickE: (...a) => { S.scRenders++; if (S.rec) S.renderAt.push(Math.round(performance.now() - S.t0)); return m.useLegacyDailyTickE(...a) } }
})
vi.mock('../lib/realtimeBarsGate', () => ({ realtimeBarsEnabled: () => false }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const make = (type) => {
    const id = ++S.n
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
    addSeries: (type) => make(type),
    addCandlestickSeries: () => make(real.CandlestickSeries), addHistogramSeries: () => make(real.HistogramSeries),
    addLineSeries: () => make(real.LineSeries), addAreaSeries: () => make(null), addBarSeries: () => make(null),
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => S.range,
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

// ── layout-read spy: which code reads layout inside the switch commit, and inside animation-frame callbacks ──
const LAYOUT = { on: false, reads: [], inRaf: false, rafReads: 0, all: 0 }
const _site = () => {
  const st = String(new Error().stack).split('\n').slice(3, 9).map((l) => (/(StockChart|ChartPane|ChartDrawingOverlay|components\/chart\/[A-Za-z]+|lib\/[A-Za-z]+|hooks\/[A-Za-z]+)\.[jt]sx?:(\d+)/.exec(l) || [])[0]).filter(Boolean)
  return st[0] || 'other'
}
for (const [proto, props] of [[HTMLElement.prototype, ['offsetWidth', 'offsetHeight']], [Element.prototype, ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight']]]) {
  for (const p of props) {
    const d = Object.getOwnPropertyDescriptor(proto, p)
    if (!d || !d.get) continue
    Object.defineProperty(proto, p, { configurable: true, get() { if (LAYOUT.on) LAYOUT.reads.push(p + '@' + _site()); if (LAYOUT.inRaf) LAYOUT.rafReads++; LAYOUT.all++; return d.get.call(this) } })
  }
}
{
  const g = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function () { if (LAYOUT.on) LAYOUT.reads.push('gBCR@' + _site()); if (LAYOUT.inRaf) LAYOUT.rafReads++; LAYOUT.all++; return g.call(this) }
}

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



{
  const raf0 = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = (cb) => raf0((t) => { const was = LAYOUT.inRaf; LAYOUT.inRaf = true; try { cb(t) } finally { LAYOUT.inRaf = was } })
}

async function mountAndSwitch({ range = null } = {}) {
  vi.stubGlobal('requestIdleCallback', (cb) => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 5))
  vi.stubGlobal('cancelIdleCallback', (h) => clearTimeout(h))
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    const m = /\/api\/bars\/([A-Z]+)/.exec(u)
    if (!m || !BARS[m[1]]) return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => ({}) })
    const body = { ticker: m[1], tf: 'D', bars: BARS[m[1]], newest_bar_is_forming: false }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
  }))
  S.range = range
  const M = await loadWithBarStore(true, async () => ({
    StockChart: (await import('./StockChart')).default,
    store: (await import('../data/barStore/index')).getBarStore(),
    chartKeyFor: (await import('./chart/useBarSnapshotBars')).chartKeyFor,
  }))
  const key = M.chartKeyFor({ sym: 'BBB', resolvedTf: 'D', showExtended: false, replayCutoff: null, hasOverride: false })
  const el = (sym) => <M.StockChart sym={sym} tf="D" backgroundWarm={false} settingsOverride={SETTINGS} onSettingsPersist={noop} alwaysShowLegend />
  const view = render(el('AAA'))
  await wait(1200)
  M.store.registry.acquire(key)
  await act(async () => { await M.store.ensure(key, { priority: 'urgent' }) })
  await wait(300)
  LAYOUT.reads.length = 0
  LAYOUT.on = true
  view.rerender(el('BBB'))
  LAYOUT.on = false
  const commitReads = LAYOUT.reads.slice()
  return { view, M, key, commitReads }
}

describe('a switch asks for no layout it does not need (2026-11-21, the switch-task trace)', () => {
  it('the switch commit reads no layout (the volume-profile overlay is off: it measures nothing)', async () => {
    const { M, key, commitReads } = await mountAndSwitch()
    await wait(300)
    cleanup()
    M.store.registry.release(key)
    expect(commitReads, `layout reads inside the switch commit: ${JSON.stringify(commitReads)}`).toEqual([])
  }, 60000)

  it('with the newest bar off-screen, the "scroll to present" button is placed after paint: no layout read in a frame callback', async () => {
    // a visible range that ends far left of the newest bar: the chart shows the button
    const { view, M, key } = await mountAndSwitch({ range: { from: 0, to: 100 } })
    await wait(200)
    LAYOUT.rafReads = 0
    LAYOUT.all = 0
    await wait(1200)
    const rafReads = LAYOUT.rafReads
    const all = LAYOUT.all
    const btn = view.container.querySelector('[aria-label*="present" i], [title*="present" i]')
    cleanup()
    M.store.registry.release(key)
    expect(btn, 'NON-VACUITY: the present button is shown').toBeTruthy()
    expect(all, 'NON-VACUITY: the button was placed (layout was read somewhere)').toBeGreaterThan(0)
    expect(rafReads, 'layout reads inside animation-frame callbacks over 1.2 s').toBe(0)
  }, 60000)
})
