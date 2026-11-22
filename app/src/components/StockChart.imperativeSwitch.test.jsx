// ⭐⭐ THE IMPERATIVE SWITCH ON ONE CHART (stage 3, part 1; docs/charts/imperative-switch-design.md §6 rails).
//
// The REAL StockChart with `uct.imperativeSwitch` on. Its controller (reached through `switchPort`, the ref a
// host shares with its handoff) paints BBB over AAA, and everything the renderer is handed is logged in order.
//
//   (a) the switch paints with NO React commit in the chart; the React commit that follows hands the renderer
//       no data (it is a no-op pass), and every series ends on the data the React path ends on;
//   (c) a render of the old symbol between the paint and the commit paints nothing;
//   (d) the old symbol's per-symbol layers (its price lines, its markers) are gone in the frame of the paint;
//   (f) an old-symbol tick between the paint and the commit writes nothing, and the new symbol ticks after it;
//   (g) as far as jsdom shows framing: the paint keeps the member's zoom (the width of the view), the commit
//       after it does not move the view, and the view is the one the React path sets;
//   OFF the controller is never made (and StockChart.applyFrameParity is the log of that path).
// And, after the review of #2400 at 1aba532a17, THE SEAM: the real handoff hook, the real controller and the
// real chart (memoised as the pane memoises it) together. The body does not render before the paint; going back
// to the symbol the body is still held on ends the switch and puts that symbol's own frame back, whether the
// controller takes it or not; the new symbol's own lines and markers come back at the body's render; a hover
// between the paint and that render reports nothing; W and M are refused; the name the app holds is in the frame.
import { paneLookProps } from './chart/pane/paneLook'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Profiler } from 'react'
import { render, act, cleanup } from '@testing-library/react'
import { mutate as swrMutate } from 'swr'
import { createHash } from 'node:crypto'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'

const FLAG = 'uct.imperativeSwitch'
const S = vi.hoisted(() => ({ log: [], n: 0, commits: 0, range: null, stateful: false, crosshairs: [], prices: {}, rows: null, alerts: null }))
const digest = (v) => {
  const json = JSON.stringify(v, (k, x) => (typeof x === 'function' ? 'ƒ' : x && typeof x === 'object' && typeof x.nodeType === 'number' ? '‹node›' : x))
  if (json === undefined) return 'undefined'
  return json.length <= 80 ? json : `${Array.isArray(v) ? `[${v.length}]` : ''}sha:${createHash('sha1').update(json).digest('hex').slice(0, 16)}`
}
const put = (who, what, ...args) => { S.log.push(`${who} ${what} ${args.map(digest).join(' ')}`.trimEnd()) }

vi.mock('../lib/realtimeBarsGate', () => ({ realtimeBarsEnabled: () => false }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const pane = (i) => ({
    paneIndex: () => i, getHeight: () => 300, getHTMLElement: () => document.createElement('div'), getSeries: () => [],
    setHeight: () => {}, setStretchFactor: () => {}, getStretchFactor: () => 1, attachPrimitive: () => {}, detachPrimitive: () => {},
  })
  const scale = () => ({ applyOptions: () => {}, width: () => 0, options: () => ({}) })
  const make = (type) => {
    const id = ++S.n
    const kind = type === real.CandlestickSeries ? 'candle' : type === real.HistogramSeries ? 'histogram' : type === real.LineSeries ? 'line' : 'other'
    const who = `${kind}#${id}`
    let held = []
    return {
      __who: who,
      // a series of blank future slots (the earnings whitespace that extends the time axis: its own effect, after
      // the commit, never the pass) is logged apart: it draws nothing
      setData: (d) => {
        held = Array.isArray(d) ? d : []
        const blank = held.length > 0 && held.every((x) => x && x.value === undefined && x.close === undefined)
        if (blank) put(who, 'setWhitespace', held.length)
        else put(who, 'setData', d)
      },
      update: (p) => put(who, 'update', p && (p.close ?? p.value)),
      data: () => held,
      applyOptions: () => {}, priceScale: () => scale(),
      createPriceLine: (o) => {
        put(who, 'createPriceLine', o.price)
        let cur = o
        return { applyOptions: (x) => { cur = { ...cur, ...x }; if (x && x.price !== undefined) put(who, 'priceLine.price', x.price) }, options: () => cur }
      },
      removePriceLine: () => put(who, 'removePriceLine'),
      setMarkers: () => {}, attachPrimitive: () => {}, detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0,
      options: () => ({}), getPane: () => pane(0), priceFormatter: () => ({ format: (x) => String(x) }), moveToPane: () => {},
      seriesOrder: () => 0, setSeriesOrder: () => {}, dataByIndex: () => null, barsInLogicalRange: () => null,
      subscribeDataChanged: () => {}, unsubscribeDataChanged: () => {},
    }
  }
  const ts = {
    // (g) only: a time scale that remembers its range, so the pass's keep-the-view branches run
    applyOptions: () => {}, fitContent: () => {},
    setVisibleLogicalRange: (r) => { if (S.stateful) S.range = r; put('timeScale', 'setVisibleLogicalRange', r) },
    getVisibleLogicalRange: () => (S.stateful ? S.range : null), setVisibleRange: () => {}, scrollToPosition: () => {},
    subscribeVisibleLogicalRangeChange: () => {}, unsubscribeVisibleLogicalRangeChange: () => {},
    timeToCoordinate: () => 0, coordinateToTime: () => null, resetTimeScale: () => {}, options: () => ({}), width: () => 600,
    logicalToCoordinate: () => 0, subscribeSizeChange: () => {}, unsubscribeSizeChange: () => {},
    subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {}, scrollPosition: () => 0, timeToIndex: () => null,
  }
  const chart = {
    addSeries: (type) => make(type), addCustomSeries: () => make(null), removeSeries: () => {}, applyOptions: () => {},
    priceScale: () => scale(), timeScale: () => ts, paneSize: () => ({ width: 600, height: 300 }),
    // every subscriber of the crosshair (the legend's handler is one of several)
    subscribeCrosshairMove: (fn) => { S.crosshairs.push(fn) },
    unsubscribeCrosshairMove: (fn) => { const i = S.crosshairs.indexOf(fn); if (i >= 0) S.crosshairs.splice(i, 1) },
    subscribeClick: () => {}, unsubscribeClick: () => {},
    subscribeDblClick: () => {}, unsubscribeDblClick: () => {}, panes: () => [pane(0)],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
    chartElement: () => document.createElement('div'), options: () => ({}),
  }
  return {
    ...real,
    createChart: () => chart,
    createSeriesMarkers: (series, markers) => {
      put('markers', 'set', (markers || []).length)
      return { setMarkers: (m) => put('markers', 'set', (m || []).length), detach: () => {}, markers: () => [] }
    },
  }
})
// the watermark's lines, as the chart hands them to its primitive (the name the member reads over the candles)
vi.mock('./chart/watermarkPrimitive', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    createWatermarkPrimitive: (o) => {
      const w = real.createWatermarkPrimitive(o)
      const set = w.setOptions.bind(w)
      w.setOptions = (opts) => {
        if (opts && Array.isArray(opts.lines)) put('watermark', 'lines', opts.lines.map((l) => l.text).join(' | '))
        return set(opts)
      }
      return w
    },
  }
})
vi.mock('./chart/engine/binder', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    createBinder: (o) => {
      const b = real.createBinder(o)
      const sync = b.sync.bind(b)
      b.sync = (a) => { put('binder', 'sync', a.sym, a.tf, Array.isArray(a.bars) ? a.bars.length : 0, a.plan); return sync(a) }
      return b
    },
  }
})
// the REST poll's quote store: what the app holds of a symbol's live and extended-hours price (empty unless a
// case fills it; the chart reads it through its quiet live-price hook, and so does the switch controller)
vi.mock('../hooks/livePriceStore', () => ({
  registerTickers: () => () => {}, subscribe: () => () => {}, getSnapshot: () => S.prices,
  pollNow: () => {}, setUnauthorizedHandler: () => {}, __resetForTest: () => {},
}))
vi.mock('../utils/barsIDB', async (orig) => ({ ...(await orig()), idbGet: async () => null, idbPut: async () => {}, idbPutMonotonic: async () => {} }))
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))
const noop = () => {}
const K = { AAA: 1, BBB: 2 }
const dailyRows = (k) => {
  const out = []
  const d = new Date('2025-06-02T00:00:00Z')
  let i = 0
  while (d.toISOString().slice(0, 10) <= '2026-11-13') {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      const c = 40 * k + Math.sin(i / 11) * 6 * k + i * 0.01
      out.push({ t: d.toISOString().slice(0, 10), o: c - 0.5, h: c + 1.5, l: c - 1.7, c, v: 1e6 + ((i * 7919 * k) % 500000) })
      i++
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
// Tue 2026-09-22, 09:30 to 13:15 ET in 5-minute bars (the 13:15 bucket forms at the pinned 13:17)
const et = (h, m) => Math.floor(Date.UTC(2026, 8, 22, h + 4, m) / 1000)
const fiveRows = (k) => {
  const out = []
  for (let t = et(9, 30), i = 0; t <= et(13, 15); t += 300, i++) out.push({ t, o: 10 * k, h: 11 * k, l: 9 * k, c: 10.5 * k + (i % 3) * 0.01, v: 100 + i })
  return out
}
const stubBars = () => vi.stubGlobal('fetch', vi.fn((url) => {
  const u = String(url)
  const m = /\/api\/bars\/([A-Z]+)/.exec(u)
  const tf = decodeURIComponent((/[?&]tf=([^&]+)/.exec(u) || [])[1] || 'D')
  const meta = /\/api\/ticker-meta\/([A-Z]+)/.exec(u)
  if (meta && NAMES[meta[1]]) return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => NAMES[meta[1]] })
  // the member's alerts: ONE list for every symbol (Chart Settings -> Price alerts draws the chart symbol's)
  if (/\/api\/watchlist-alerts/.test(u)) return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => S.alerts || [] })
  const k = m ? K[m[1]] : 0
  // a case may serve its own bars (`S.rows(sym, tf)`); otherwise 5-minute bars of the pinned session, or dailies
  const own = k && S.rows ? S.rows(m[1], tf) : null
  const body = !k ? {} : own ? { ticker: m[1], tf, bars: own } : /^\d+$/.test(tf) ? { ticker: m[1], tf, bars: fiveRows(k) } : { ticker: m[1], tf, bars: dailyRows(k), newest_bar_is_forming: false }
  return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
}))

const SETTINGS = {
  indicatorInstances: [
    { instanceId: 'is-rsi', defId: 'rsi', inputs: {}, hidden: false },
    { instanceId: 'is-ma', defId: 'movingAverage', inputs: { source: 'close', period: 20 }, hidden: false },
  ],
}
const LINES_A = [{ price: 41.5, color: '#f00', title: 'a line of AAA' }]
const MARKERS_A = [{ time: '2026-10-01', position: 'aboveBar', color: '#0f0', shape: 'arrowDown', text: 'a marker of AAA' }]
const LINES_B = [{ price: 82.5, color: '#00f', title: 'a line of BBB' }]
const MARKERS_B = [{ time: '2026-10-02', position: 'belowBar', color: '#f0f', shape: 'arrowUp', text: 'a marker of BBB' }, { time: '2026-10-05', position: 'belowBar', color: '#f0f', shape: 'arrowUp', text: 'another' }]
const OF_A = { priceLines: LINES_A, markers: MARKERS_A }
const OF_B = { priceLines: LINES_B, markers: MARKERS_B }
// what /api/ticker-meta answers, and what the app's cache holds for a symbol it has met
const NAMES = {
  AAA: { name: 'Alpha Incorporated', sector: 'Industrials', industry: 'Machinery', theme: null, exchange: 'NYSE', security_type: 'CS' },
  BBB: { name: 'Bravo Corporation', sector: 'Technology', industry: 'Software', theme: null, exchange: 'NASDAQ', security_type: 'CS' },
}
const PLAIN = () => true
// the member's active alerts (GET /api/watchlist-alerts), for both symbols; then AAA's moved while BBB is painted
const ALERTS = [
  { id: 1, sym: 'AAA', is_active: true, target_price: 39.25, alert_type: 'price' },
  { id: 2, sym: 'BBB', is_active: true, target_price: 77.75, alert_type: 'price' },
]
const ALERTS_MOVED = [{ ...ALERTS[0], target_price: 38.5 }, ALERTS[1]]
const until = async (pred, ms = 3000) => { for (let t = 0; t < ms && !pred(); t += 25) await wait(25) }

/** A fresh module graph with the switch as asked (it is read once, at StockChart's module load). */
async function loadGraph(on) {
  localStorage.setItem(FLAG, on ? '1' : '0')
  try {
    return await loadWithBarStore(true, async () => ({
      StockChart: (await import('./StockChart')).default,
      nf: await import('./chart/neighborFrames'),
      store: (await import('../data/barStore/index')).getBarStore(),
      useSymbolHandoff: (await import('../hooks/useSymbolHandoff')).default,
      groups: await import('../hooks/handoffGroups'),
      Stable: (await import('./chart/pane/StableStockChart')).default,
      chartKeyFor: (await import('./chart/useBarSnapshotBars')).chartKeyFor,
      flag: (await import('./chart/imperativeSwitch')).imperativeSwitchOn(),
    }))
  } finally { localStorage.removeItem(FLAG) }
}
/** A line that hands the renderer data: a series' rows, a tick, or a frame. */
const isData = (l) => / (setData|update) /.test(l) || /^timeScale setVisibleLogicalRange/.test(l)
/** …or shows the pass ran at all (the binder is asked on every pass, a no-op one included). */
const isPass = (l) => isData(l) || /^binder sync/.test(l)
const lastSetData = (log) => { const out = {}; for (const l of log) { const m = /^(\S+) setData (.*)$/.exec(l); if (m) out[m[1]] = m[2] } return out }
const lastOf = (log, re) => log.filter((l) => re.test(l)).at(-1)

/** Mount AAA (with a price line and a marker of its own), hold BBB in the store: the chart, ready to switch. */
async function mounted(on, tf, ofAAA = {}, ofBoth = {}) {
  S.log.length = 0; S.n = 0; S.commits = 0; S.range = null; S.crosshairs.length = 0
  stubBars()
  const M = await loadGraph(on)
  M.nf.__setNeighborFramesForTests(true)
  const port = { current: null }
  const base = { tf, backgroundWarm: false, settingsOverride: SETTINGS, onSettingsPersist: noop, switchPort: port, switchHostPlain: () => true, ...ofBoth }
  const el = (sym, extra) => (
    <Profiler id="chart" onRender={() => { S.commits += 1 }}>
      <M.StockChart sym={sym} {...base} {...extra} />
    </Profiler>
  )
  const view = render(el('AAA', ofAAA))
  await wait(900)
  const keyOf = (sym) => M.chartKeyFor({ sym, resolvedTf: tf, showExtended: tf !== 'D', replayCutoff: null, hasOverride: false })
  M.store.registry.acquire(keyOf('BBB'))
  await act(async () => { await M.store.ensure(keyOf('BBB'), { priority: 'urgent' }) })
  await wait(200)
  const mountLog = S.log.slice()
  const done = () => { cleanup(); M.store.registry.release(keyOf('BBB')); M.nf.__setNeighborFramesForTests(null) }
  return { M, port, view, el, keyOf, mountLog, done }
}

describe('daily: the controller paints BBB over AAA', () => {
  let clock
  beforeAll(() => { clock = pinWallClock('2026-11-14T16:00:00Z') })   // a Saturday: nothing forms
  afterAll(() => clock.restore())
  const OF_AAA = { priceLines: LINES_A, markers: MARKERS_A }
  let on    // the imperative run: { mountLog, applyLog, commitsInApply, result, catchUpLog, commitsInCatchUp, diag }
  let off   // the React path, same switch
  let stale // a second imperative run: a render of AAA between the paint and the commit
  let own   // (review) BBB with layers and a name of its own, and a hover in between
  let weekly
  let alerts // (review 2) the member's alert lines on

  beforeAll(async () => {
    // ── the imperative switch, then the React commit ──
    {
      const t = await mounted(true, 'D', OF_AAA)
      const ctl = t.port.current
      const token = ctl ? ctl.canApply('BBB') : null
      const refusedAs = ctl ? JSON.stringify(ctl.diag.last) : 'no controller'
      S.log.length = 0; S.commits = 0
      const viewsBefore = ctl ? ctl.diag.views : -1
      let result = null
      act(() => { result = ctl && token ? ctl.apply('BBB', token) : null })
      const applyLog = S.log.slice()
      const viewsInApply = ctl ? ctl.diag.views - viewsBefore : -1
      const pendingAfter = ctl ? ctl.pendingSym() : null
      S.log.length = 0; S.commits = 0
      t.view.rerender(t.el('BBB'))
      await wait(600)
      on = {
        flag: t.M.flag, hasCtl: !!ctl, refusedAs, result, mountLog: t.mountLog, applyLog, viewsInApply, pendingAfter,
        catchUpLog: S.log.slice(), commitsInCatchUp: S.commits, diag: ctl ? JSON.parse(JSON.stringify(ctl.diag)) : null,
        pendingEnd: ctl ? ctl.pendingSym() : null,
        winDiag: typeof window.__uctSwitchDiag === 'object' ? Object.keys(window.__uctSwitchDiag) : [],
      }
      t.done()
    }
    // ── the React path (the switch off): the same mount, the same switch ──
    {
      delete window.__uctSwitchDiag
      const t = await mounted(false, 'D', OF_AAA)
      const hadPort = t.port.current
      S.log.length = 0
      t.view.rerender(t.el('BBB'))
      await wait(600)
      off = { flag: t.M.flag, hadPort, switchLog: S.log.slice(), mountLog: t.mountLog, winDiag: window.__uctSwitchDiag }
      t.done()
    }
    // ── a render of the OLD symbol between the paint and the commit ──
    {
      const t = await mounted(true, 'D', OF_AAA)
      const ctl = t.port.current
      act(() => { if (ctl) ctl.apply('BBB') })
      S.log.length = 0
      // AAA again, with a prop that re-creates `updateChart` (its passive effect would run the pass), and a
      // metadata answer landing for it (the feed publishes: its listener would redraw AAA's markers)
      t.view.rerender(t.el('AAA', { ...OF_AAA, watermarkOpacity: 0.5, nextEarningsHint: '2026-12-01' }))
      await wait(300)
      stale = { log: S.log.slice(), stale: ctl ? ctl.diag.stale : -1, pending: ctl ? ctl.pendingSym() : null }
      t.done()
    }
    // ── (review) BBB has lines and markers of its own, a name the app holds, and the member hovers in between ──
    {
      const spy = vi.fn()
      const t = await mounted(true, 'D', OF_AAA, { onCrosshairMove: spy })
      const ctl = t.port.current
      // the pointer moves over a bar, then leaves the chart (each a report to the host: a payload, then null)
      const fire = (param) => { for (const fn of [...S.crosshairs]) { try { fn(param) } catch { /* another subscriber's business */ } } }
      const hover = () => act(async () => {
        fire({ time: '2026-11-13', point: { x: 100, y: 100 }, seriesData: { get: () => ({ time: '2026-11-13', open: 1, high: 2, low: 0.5, close: 1.5 }) } })
        await new Promise((r) => setTimeout(r, 60))
        fire({})
        await new Promise((r) => setTimeout(r, 30))
      })
      await hover()
      const hoverBefore = spy.mock.calls.length
      await act(async () => { await swrMutate('/api/ticker-meta/BBB', NAMES.BBB, false) })   // the app has met BBB
      S.log.length = 0
      let result = null
      act(() => { result = ctl ? ctl.apply('BBB') : null })
      const paintLog = S.log.slice()
      spy.mockClear()
      await hover()
      const hoverBetween = spy.mock.calls.length
      S.log.length = 0
      t.view.rerender(t.el('BBB', OF_B))
      await wait(600)
      const commitLog = S.log.slice()
      spy.mockClear()
      await hover()
      own = {
        result, refusedAs: ctl ? JSON.stringify(ctl.diag.last) : null, paintLog, commitLog,
        hoverBefore, hoverBetween, hoverAfter: spy.mock.calls.length,
        lateBoxReads: ctl ? ctl.diag.lateBoxReads : null,
      }
      t.done()
    }
    // ── (review 2) the member's alert lines (Chart Settings -> Price alerts). The list is ONE for every symbol,
    // held by the chart's last render, so the new symbol's lines are readable outside a render: drawn in the paint.
    // Then the list revalidates (an alert of AAA moved) between the paint and the body's render: AAA's body
    // re-renders while BBB is painted, and must not put AAA's lines back over BBB's candles. ──
    {
      S.alerts = ALERTS
      const t = await mounted(true, 'D', {}, { settingsOverride: { ...SETTINGS, priceAlertLines: true } })
      const ctl = t.port.current
      S.log.length = 0
      let result = null
      act(() => { result = ctl ? ctl.apply('BBB') : null })
      const paintLog = S.log.slice()
      S.log.length = 0
      const views0 = ctl ? ctl.diag.views : -1
      await act(async () => { await swrMutate('/api/watchlist-alerts', ALERTS_MOVED, false) })
      await wait(150)
      const betweenLog = S.log.slice()
      const between = { views: ctl ? ctl.diag.views - views0 : -1, pending: ctl ? ctl.pendingSym() : null }
      S.log.length = 0
      t.view.rerender(t.el('BBB'))
      await wait(600)
      alerts = {
        result, refusedAs: ctl ? JSON.stringify(ctl.diag.last) : null, mountLog: t.mountLog, paintLog, betweenLog, between,
        commitLog: S.log.slice(),
      }
      t.done()
      S.alerts = null
    }
    // ── (review) a weekly chart is refused by name until its tail has a rail ──
    {
      const t = await mounted(true, 'W')
      const ctl = t.port.current
      weekly = { token: ctl ? ctl.canApply('BBB') : 'no controller', last: ctl ? ctl.diag.last : null }
      t.done()
    }
  }, 180_000)

  it('the graph under test holds the switch (non-vacuity), and the chart made its controller', () => {
    expect(on.flag).toBe(true)
    expect(off.flag).toBe(false)
    expect(on.hasCtl).toBe(true)
    expect(on.winDiag.length).toBe(1)   // the harness reads the same numbers at window.__uctSwitchDiag
  })

  it('the chart could paint BBB whole (a refusal would be named here)', () => {
    expect(on.result, `refused as ${on.refusedAs}`).toBe('applied')
  })

  it('(a) the switch painted with NO render of the chart body: candles, volume, the indicators and the frame, for BBB', () => {
    // `views` counts the body's commits (each writes its view to the controller): the paint added none. (The
    // small readout islands do commit in it: the controller empties the old symbol's numbers.)
    expect(on.viewsInApply).toBe(0)
    expect(on.applyLog.some((l) => /^candle#\d+ setData \[380\]sha:/.test(l)), 'candles').toBe(true)
    expect(on.applyLog.some((l) => /^histogram#\d+ setData \[380\]sha:/.test(l)), 'volume').toBe(true)
    expect(on.applyLog.some((l) => /^binder sync "BBB" "D" 380 /.test(l)), 'binder.sync for BBB').toBe(true)
    expect(on.applyLog.some((l) => /^timeScale setVisibleLogicalRange/.test(l)), 'the frame').toBe(true)
    expect(on.applyLog.some((l) => /^line#\d+ setData /.test(l)), 'indicator series').toBe(true)
    expect(on.pendingAfter).toBe('BBB')
  })

  it('(a) the React commit came after (at least one), and its pass handed the renderer NO data', () => {
    expect(on.commitsInCatchUp).toBeGreaterThanOrEqual(1)
    expect(on.catchUpLog.filter(isData)).toEqual([])
    expect(on.diag.catchUp).toEqual({ noop: 1, repaint: 0 })
    expect(on.pendingEnd).toBe(null)
    expect(on.diag.applied).toBe(1)
  })

  it('(a) every series ends on the data the React path ends on, and the frame is the same', () => {
    const want = lastSetData(off.switchLog)
    const have = lastSetData([...on.applyLog, ...on.catchUpLog])
    expect(Object.keys(want).length).toBeGreaterThanOrEqual(4)   // candles, volume, at least two indicator series
    expect(have).toEqual(want)
    expect(lastOf(on.applyLog, /^timeScale setVisibleLogicalRange/)).toBe(lastOf(off.switchLog, /^timeScale setVisibleLogicalRange/))
    expect(lastOf(on.applyLog, /^binder sync/)).toBe(lastOf(off.switchLog, /^binder sync/))
  })

  it('(d) AAA\'s price line and markers were on the chart, and are gone in the frame of the paint', () => {
    // non-vacuity: the mount drew them
    expect(on.mountLog.some((l) => /^candle#\d+ createPriceLine 41\.5$/.test(l)), 'the line was drawn').toBe(true)
    expect(on.mountLog.some((l) => /^markers set [1-9]/.test(l)), 'the marker was drawn').toBe(true)
    // in the paint: the line removed, none created; the markers emptied
    expect(on.applyLog.some((l) => /removePriceLine$/.test(l)), 'the line was removed').toBe(true)
    expect(on.applyLog.filter((l) => / createPriceLine /.test(l))).toEqual([])
    // (the windowed markers re-filter once when the candles change, inside the same pass; what stands is empty)
    expect(on.applyLog.filter((l) => /^markers set /.test(l)).at(-1)).toBe('markers set 0')
  })

  it('(c) a render of AAA between the paint and the commit paints nothing', () => {
    expect(stale.log.filter(isPass)).toEqual([])
    expect(stale.log.filter((l) => / createPriceLine /.test(l))).toEqual([])
    // …and a metadata answer that lands for AAA in between does not put its markers back
    expect(stale.log.filter((l) => /^markers set [1-9]/.test(l))).toEqual([])
    expect(stale.stale).toBeGreaterThanOrEqual(1)
    expect(stale.pending).toBe('BBB')
  })

  it('(review 6) the new symbol\'s OWN price line and markers come back at the body\'s render', () => {
    expect(own.result, `refused as ${own.refusedAs}`).toBe('applied')
    expect(own.paintLog.filter((l) => / createPriceLine /.test(l))).toEqual([])   // not in the paint (they are the host's, of a render)
    expect(own.commitLog.some((l) => /^candle#\d+ createPriceLine 82\.5$/.test(l)), 'the line of BBB').toBe(true)
    expect(own.commitLog.some((l) => /^markers set 2$/.test(l)), 'the two markers of BBB').toBe(true)
    expect(own.commitLog.some((l) => / createPriceLine 41\.5$/.test(l)), 'no line of AAA').toBe(false)
  })

  it('(review 2) the watermark carries the name the app already holds, in the frame of the paint', () => {
    const lines = own.paintLog.filter((l) => /^watermark lines /.test(l))
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.at(-1)).toContain('BBB')
    expect(lines.at(-1)).toContain('Bravo Corporation')
    expect(lines.some((l) => /Alpha Incorporated/.test(l))).toBe(false)
    // non-vacuity: the mount drew AAA's name the same way
    expect(on.mountLog.some((l) => /^watermark lines .*Alpha Incorporated/.test(l))).toBe(true)
  })

  it('(review 2) the member\'s alert lines are the new symbol\'s in the frame of the paint, and the body\'s render does not draw them again', () => {
    expect(alerts.result, `refused as ${alerts.refusedAs}`).toBe('applied')
    expect(alerts.mountLog.some((l) => /^candle#\d+ createPriceLine 39\.25$/.test(l)), 'non-vacuity: the mount drew AAA\'s alert line').toBe(true)
    expect(alerts.paintLog.some((l) => /^candle#\d+ createPriceLine 77\.75$/.test(l)), 'BBB\'s alert line, in the paint').toBe(true)
    expect(alerts.paintLog.some((l) => / createPriceLine 39\.25$/.test(l)), 'no line of AAA').toBe(false)
    expect(alerts.commitLog.filter((l) => / createPriceLine 77\.75$/.test(l)), 'drawn once, not again at the render').toEqual([])
  })

  it('(review 2) the alerts list revalidating between the paint and the body\'s render puts none of the old symbol\'s lines back', () => {
    expect(alerts.between.pending).toBe('BBB')
    expect(alerts.between.views, 'non-vacuity: the old symbol\'s body rendered in between').toBeGreaterThan(0)
    expect(alerts.betweenLog.filter((l) => / (createPriceLine|removePriceLine)/.test(l))).toEqual([])
  })

  it('(review 2) the watermark of the paint is the new symbol\'s even when the app holds nothing of it yet: never blank, never the old one', () => {
    const lines = on.applyLog.filter((l) => /^watermark lines /.test(l))
    expect(lines.length, 'the paint drew the watermark').toBeGreaterThan(0)
    expect(lines.at(-1)).toMatch(/^watermark lines "BBB\b/)
    expect(lines.at(-1)).not.toMatch(/AAA|Alpha/)
  })

  it('(review 3) a hover between the paint and the body\'s render reports nothing; before and after it reports', () => {
    expect(own.hoverBefore).toBeGreaterThanOrEqual(2)   // the move's payload and the leave's null
    expect(own.hoverBetween).toBe(0)
    expect(own.hoverAfter).toBeGreaterThanOrEqual(2)
  })

  it('(review 4) nothing the pass installed kept its throwaway box: no read of it after the pass', () => {
    expect(own.lateBoxReads).toBe(0)
  })

  it('(review 4) a weekly chart is refused by name', () => {
    expect(weekly.token).toBe(null)
    expect(weekly.last).toMatchObject({ ok: false, why: 'weekly-monthly' })
  })

  it('OFF: no controller is made, nothing is put in the port, and the same switch still paints BBB', () => {
    expect(off.hadPort).toBe(null)
    expect(off.winDiag).toBe(undefined)
    expect(off.switchLog.some((l) => /^candle#\d+ setData \[380\]sha:/.test(l))).toBe(true)
  })
})

describe('(g) framing, as far as jsdom shows it: the member\'s zoom is kept and the commit does not move the view', () => {
  let clock
  beforeAll(() => { clock = pinWallClock('2026-11-14T16:00:00Z') })
  afterAll(() => { clock.restore(); S.stateful = false })
  const rangeOf = (line) => (line ? JSON.parse(line.replace(/^timeScale setVisibleLogicalRange /, '')) : null)
  const ZOOM = 100   // the width of the view the member set, in bars
  let on
  let off

  /** Mount (the /charts props that keep the view across a symbol), zoom to ZOOM bars at the right edge, switch. */
  async function run(flagOn) {
    S.stateful = true
    const t = await mounted(flagOn, 'D', {}, { keepPresentOnSymbolChange: true })
    const first = S.range
    S.range = first ? { from: first.to - ZOOM, to: first.to } : null   // the member's zoom
    const ctl = t.port.current
    S.log.length = 0
    let result = null
    if (flagOn) act(() => { result = ctl ? ctl.apply('BBB') : null })
    const paintLog = S.log.slice()
    S.log.length = 0
    t.view.rerender(t.el('BBB'))
    await wait(600)
    const out = { first, result, refusedAs: ctl ? JSON.stringify(ctl.diag.last) : null, paintLog, commitLog: S.log.slice(), end: S.range }
    t.done()
    S.stateful = false
    return out
  }
  beforeAll(async () => { on = await run(true); off = await run(false) }, 120_000)

  it('the mount framed the chart, and the chart painted BBB imperatively', () => {
    expect(on.first && on.first.to > on.first.from).toBe(true)
    expect(on.result, `refused as ${on.refusedAs}`).toBe('applied')
  })

  it('ZOOM_CHANGED 0: the paint frames BBB at the width the member had', () => {
    const r = rangeOf(lastOf(on.paintLog, /^timeScale setVisibleLogicalRange/))
    expect(r).toBeTruthy()
    expect(Math.abs((r.to - r.from) - ZOOM)).toBeLessThan(1e-6)
  })

  it('VISIBLE_RANGE_DRIFT 0: the commit after the paint does not move the view', () => {
    const painted = rangeOf(lastOf(on.paintLog, /^timeScale setVisibleLogicalRange/))
    // (the settling frame may be re-asserted by a later pass: the same range again is not a move)
    const moved = on.commitLog.filter((l) => /^timeScale setVisibleLogicalRange/.test(l)).map(rangeOf)
      .filter((r) => r.from !== painted.from || r.to !== painted.to)
    expect(moved).toEqual([])
    expect(on.end).toEqual(painted)
  })

  it('the view is the one the React path sets for the same switch', () => {
    expect(off.result).toBe(null)
    const want = rangeOf(lastOf(off.commitLog, /^timeScale setVisibleLogicalRange/))
    expect(want).toBeTruthy()
    expect(Math.abs((want.to - want.from) - ZOOM)).toBeLessThan(1e-6)   // the React path keeps the zoom too (non-vacuity)
    expect(on.end).toEqual(off.end)
  })
})

// ⭐⭐ COVERAGE: A DEFAULT CHART IS PAINTED BY THE CONTROLLER, IN AND OUT OF THE SESSION.
// The browser A/B of 1aba532a17 (2026-11-21, a Saturday) painted ZERO switches: every ask on a default D + 30m
// board was refused `session-tags`, because the Pre/Post chip and the RTH close tag are on every chart outside
// regular hours. A refusal that fires on a default chart is a coverage bug, and nothing here saw it: every
// case above ran with no session view. These four are a /charts widget's chart as its hosts hand it over: the
// pane's own look (`paneLookProps`, the real function: bold candles, MARKED VOLUME EXTREMES, a 50-bar volume
// average...), the pane's and the widget's fixed props, DEFAULT settings, and the quotes the app holds (the
// REST poll's, for both symbols: a watchlist beside the chart polls its rows).
// ⛔ The chart is still mounted directly, not through ChartPane / ChartWidget: a refusal that only their state
// can cause is not seen here. The browser's `__uctSwitchDiag` is the last word.
describe('coverage: a default-settings chart is applied by the controller', () => {
  const SAT = '2026-11-14T16:00:00Z'       // Saturday: outside the session (the feed says "post")
  const TUE = '2026-09-22T17:17:00Z'       // Tuesday 13:17 ET: the regular session in progress
  const PX = { AAA: 10.5, BBB: 21 }
  /** `step`-minute bars of the regular session (ET), for the sessions up to `lastDay`; `untilMin`: the last one's length. */
  const intraday = (sym, step, lastDay, utcOpenHour, untilMin = 390) => {
    const out = []
    const days = []
    const d = new Date(`${lastDay}T12:00:00Z`)
    while (days.length < 6) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) days.unshift(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1) }
    days.forEach((day, di) => {
      const open = Date.parse(`${day}T${String(utcOpenHour).padStart(2, '0')}:30:00Z`) / 1000
      const len = di === days.length - 1 ? untilMin : 390
      for (let m = 0, i = 0; m < len; m += step, i++) out.push({ t: open + m * 60, o: PX[sym], h: PX[sym] * 1.01, l: PX[sym] * 0.99, c: PX[sym] + (i % 4) * 0.01, v: 1000 + i })
    })
    return out
  }
  const daily = (sym, lastDay) => {
    const out = []
    const d = new Date(`${lastDay}T12:00:00Z`)
    while (out.length < 300) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) out.unshift({ t: d.toISOString().slice(0, 10), o: PX[sym], h: PX[sym] * 1.02, l: PX[sym] * 0.98, c: PX[sym] + (out.length % 5) * 0.01, v: 1e6 }); d.setUTCDate(d.getUTCDate() - 1) }
    return out
  }
  // what the REST poll holds outside the session: the close, and an extended-hours print
  const EXT = {
    AAA: { price: 10.5, day_open: 10.4, day_high: 10.7, day_low: 10.3, ext_session: true, ext_price: 10.83, observed_at: Date.now() },
    BBB: { price: 21, day_open: 20.8, day_high: 21.4, day_low: 20.6, ext_session: true, ext_price: 21.47, observed_at: Date.now() },
  }
  // what it holds inside the session: the last trade and the day's range (no extended-hours print)
  const REG = {
    AAA: { price: 10.52, day_open: 10.4, day_high: 10.7, day_low: 10.3, observed_at: Date.now() },
    BBB: { price: 21.03, day_open: 20.8, day_high: 21.4, day_low: 20.6, observed_at: Date.now() },
  }
  const CASES = [
    { name: 'D, outside the session', tf: 'D', clock: SAT, prices: EXT, rows: (sym) => daily(sym, '2026-11-13'), tags: true },
    { name: '30m, outside the session', tf: '30', clock: SAT, prices: EXT, rows: (sym) => intraday(sym, 30, '2026-11-13', 14), tags: true },
    { name: 'D, inside the session', tf: 'D', clock: TUE, prices: REG, rows: (sym) => daily(sym, '2026-09-22'), tags: false },
    { name: '30m, inside the session', tf: '30', clock: TUE, prices: REG, rows: (sym) => intraday(sym, 30, '2026-09-22', 13, 210), tags: false },
  ]
  // a /charts widget's chart: ChartPane's look and fixed props, ChartWidget's `stockChartProps` at rest
  const paneProps = () => ({
    ...paneLookProps({ cs: undefined, theme: undefined, prefs: undefined }),
    settingsOverride: undefined, hideCompare: true, axisFloor: 60, sessionView: 'regular', keepPresentOnSymbolChange: true,
    viewLockKey: 'uct.charts.viewLock.cov', chartId: 'cov', hotkeysActive: true, canOpenCompare: true,
    watermarkX: null, watermarkY: null, watermarkAnchor: null, watermarkAdjusting: false,
    periodSelect: false, replayPick: false, replayCutoff: null, liveUpdates: undefined, startMarker: null,
    highlightBarTime: undefined, highlightColor: undefined, highlightBodyOnly: undefined,
  })
  const got = {}
  const back = {}
  const react = {}   // the React path (the switch off): the same chart, the same switch
  beforeAll(async () => {
    for (const c of CASES) {
      const clock = pinWallClock(c.clock)
      S.prices = c.prices
      S.rows = (sym, tf) => (tf === c.tf ? c.rows(sym) : null)
      try {
        if (c.tags) {
          // the way back inside the hold: AAA's own tags return with AAA's own frame
          const r = await mounted(true, c.tf, {}, paneProps())
          const rc = r.port.current
          act(() => { if (rc) rc.apply('BBB') })
          S.log.length = 0
          let res = null
          act(() => { res = rc ? rc.apply('AAA') : null })
          back[c.name] = { res, log: S.log.slice(), pending: rc ? rc.pendingSym() : null }
          r.done()
        }
        const t = await mounted(true, c.tf, {}, paneProps())
        const ctl = t.port.current
        const mountLog = S.log.slice()
        S.log.length = 0
        let result = null
        act(() => { result = ctl ? ctl.apply('BBB') : null })
        const paintLog = S.log.slice()
        S.log.length = 0
        t.view.rerender(t.el('BBB'))
        await wait(500)
        got[c.name] = {
          result, last: ctl ? JSON.stringify(ctl.diag.last) : 'no controller', refused: ctl ? { ...ctl.diag.refused } : null,
          mountLog, paintLog, commitLog: S.log.slice(), pending: ctl ? ctl.pendingSym() : null,
          catchUp: ctl ? { ...ctl.diag.catchUp } : null, lateBoxReads: ctl ? ctl.diag.lateBoxReads : null,
        }
        t.done()
        const o = await mounted(false, c.tf, {}, paneProps())
        S.log.length = 0
        o.view.rerender(o.el('BBB'))
        await wait(600)
        react[c.name] = lastSetData(S.log.slice())
        o.done()
      } finally { clock.restore(); S.prices = {}; S.rows = null }
    }
  }, 240_000)

  it.each(CASES.map((c) => c.name))('%s: APPLIED (a refusal here is a coverage bug, named in the message)', (name) => {
    expect(got[name].result, `refused: ${got[name].last}`).toBe('applied')
    expect(got[name].refused).toEqual({})
    expect(got[name].paintLog.some((l) => /^candle#\d+ setData /.test(l))).toBe(true)
    expect(got[name].pending).toBe(null)   // …and the body's render ended the switch
  })

  // the pane's look changes which arrays the frame carries (the marked volume bar): the body's own pass must
  // still find every one of them already on the renderer, or the applier's work is done twice per switch
  it.each(CASES.map((c) => c.name))('%s: the render of the body hands the renderer no data again, and nothing kept the built frame', (name) => {
    const data = got[name].commitLog.filter((l) => / setData /.test(l))
    expect(got[name].catchUp, `data set again at the body's render: ${data.join(' | ')}`).toEqual({ noop: 1, repaint: 0 })
    expect(got[name].lateBoxReads).toBe(0)
  })

  // ⭐ THE PAINT IS THE REACT PATH'S PICTURE. The catch-up rail above cannot see a wrong array: the body's pass sets
  // nothing again when the bars are the ones it painted, whatever the controller drew from them (a frame whose
  // volume ignored the pane's marked bar stayed on screen, unnoticed, in the mutation run 44970976659).
  it.each(CASES.map((c) => c.name))('%s: every series is handed, in the paint, the data the React path hands it', (name) => {
    expect(Object.keys(react[name]).length).toBeGreaterThanOrEqual(4)   // candles, volume, its average, the averages
    expect(lastSetData(got[name].paintLog)).toEqual(react[name])
  })

  it.each(CASES.filter((c) => c.tags).map((c) => c.name))('%s: the case is the one the browser met (AAA carries a session tag at its extended-hours price)', (name) => {
    expect(got[name].mountLog.some((l) => / (createPriceLine|priceLine\.price) 10\.83$/.test(l)), 'the Pre/Post tag of AAA').toBe(true)
  })

  it.each(CASES.filter((c) => c.tags).map((c) => c.name))('%s: the session tags are BBB\'s in the frame of the paint, and none of AAA\'s is left', (name) => {
    const tagLines = (log) => log.filter((l) => / (createPriceLine|priceLine\.price) /.test(l))
    expect(tagLines(got[name].paintLog).some((l) => / 21\.47$/.test(l)), 'the Pre/Post tag at BBB\'s extended-hours price').toBe(true)
    expect(tagLines(got[name].paintLog).some((l) => / 10\.83$/.test(l)), 'no tag at AAA\'s price').toBe(false)
    // the body's render then finds them right: it sets no tag to another price
    expect(tagLines(got[name].commitLog).filter((l) => !/ (21\.47|21(\.\d+)?)$/.test(l))).toEqual([])
  })

  it.each(CASES.filter((c) => c.tags).map((c) => c.name))('%s: going back to AAA inside the hold puts AAA\'s tag back', (name) => {
    expect(back[name].res).toBe('applied')
    expect(back[name].pending).toBe(null)
    const tagLines = back[name].log.filter((l) => / (createPriceLine|priceLine\.price) /.test(l))
    expect(tagLines.some((l) => / 10\.83$/.test(l)), `AAA's Pre/Post tag: ${tagLines.join(' | ')}`).toBe(true)
    expect(tagLines[tagLines.length - 1]).not.toMatch(/ 21\.47$/)
  })

  it('the volume pane marks its highest-volume bar on the pane (the case is the pane\'s look, which the frame builder must build)', () => {
    expect(paneProps().markVolumeExtremes).toBe(true)
  })
})

describe('(review) the seam: the real handoff drives the real controller on the real chart', () => {
  let clock
  beforeAll(() => { clock = pinWallClock('2026-11-14T16:00:00Z') })
  afterAll(() => clock.restore())
  const G = 'charts:T'
  const EXTRA = { AAA: OF_A, BBB: OF_B }
  let took     // the controller takes the way back itself
  let refused  // the controller refuses the way back (its apply answers false): React shows it

  /** AAA -> BBB (painted), then BBB -> AAA before the body's hold is released. */
  async function run(controllerRefusesTheWayBack) {
    S.log.length = 0; S.n = 0; S.range = null; S.crosshairs.length = 0
    stubBars()
    // the app's cache is one for the whole file: AAA's name as the server answers it, whatever a run before left
    await swrMutate('/api/ticker-meta/AAA', NAMES.AAA, false)
    const M = await loadGraph(true)
    M.nf.__setNeighborFramesForTests(true)
    const port = { current: null }
    const scope = { board: 1 }
    const host = []
    function Widget({ requested }) {
      const sym = M.useSymbolHandoff(requested, 'D', { group: G, scope, painter: port })
      const chartSym = port.bodySym || sym
      host.push(`${sym}:${chartSym}`)
      return <M.Stable sym={chartSym} tf="D" backgroundWarm={false} settingsOverride={SETTINGS} onSettingsPersist={noop} switchPort={port} switchHostPlain={PLAIN} {...EXTRA[chartSym]} />
    }
    const view = render(<Widget requested="AAA" />)
    await wait(900)
    const keyB = M.chartKeyFor({ sym: 'BBB', resolvedTf: 'D', showExtended: false, replayCutoff: null, hasOverride: false })
    M.store.registry.acquire(keyB)
    await act(async () => { await M.store.ensure(keyB, { priority: 'urgent' }) })
    await wait(200)
    const ctl = port.current
    const candleOfAAA = lastSetData(S.log)['candle#1']
    // from here the next frame comes only when the test says so: the hold is not released behind its back
    const realRaf = globalThis.requestAnimationFrame
    const frames = []
    globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length }
    const nextFrame = () => act(async () => { const due = frames.splice(0); for (const cb of due) cb(0); await new Promise((r) => setTimeout(r, 30)) })
    const pressTo = (sym) => act(() => { M.groups.decideGroupShow(scope, G, sym); view.rerender(<Widget requested={sym} />) })
    let out
    try {
      // ── key 1: AAA -> BBB ──
      const views0 = ctl ? ctl.diag.views : -1
      S.log.length = 0
      pressTo('BBB')
      await until(() => ctl && ctl.diag.applied >= 1)
      const first = {
        applied: ctl ? ctl.diag.applied : 0, refusedAs: ctl ? JSON.stringify(ctl.diag.last) : null,
        views: ctl ? ctl.diag.views - views0 : -1, stale: ctl ? ctl.diag.stale : -1,
        host: host.at(-1), pending: ctl ? ctl.pendingSym() : null,
        candles: S.log.some((l) => /^candle#1 setData \[380\]sha:/.test(l)),
      }
      // ── key 2: back to AAA, inside the hold ──
      if (ctl && controllerRefusesTheWayBack) {
        const apply = ctl.apply
        const canApply = ctl.canApply
        ctl.apply = (sym, token) => (sym === 'AAA' ? false : apply(sym, token))
        ctl.canApply = (sym) => (sym === 'AAA' ? null : canApply(sym))
      }
      S.log.length = 0
      pressTo('AAA')
      await until(() => host.at(-1).startsWith('AAA:'))
      await wait(100)
      const back = {
        host: host.at(-1), pending: ctl ? ctl.pendingSym() : 'no controller', log: S.log.slice(),
        candle: lastSetData(S.log)['candle#1'],
      }
      // ── the frames come; then something changes that re-creates the pass ──
      await nextFrame()
      await nextFrame()
      S.log.length = 0
      const stale0 = ctl ? ctl.diag.stale : -1
      // a tick-like change: the chart's own pass must run again (it was skipped for good before the fix)
      await act(async () => { await swrMutate('/api/ticker-meta/AAA', { ...NAMES.AAA, name: 'Alpha Renamed' }, false) })
      await wait(300)
      out = {
        first, back, candleOfAAA,
        later: { log: S.log.slice(), staleAdded: ctl ? ctl.diag.stale - stale0 : -1, pending: ctl ? ctl.pendingSym() : null },
        diag: ctl ? JSON.parse(JSON.stringify(ctl.diag)) : null,
      }
    } finally {
      globalThis.requestAnimationFrame = realRaf
      cleanup()
      M.store.registry.release(keyB)
      M.nf.__setNeighborFramesForTests(null)
    }
    return out
  }
  beforeAll(async () => { took = await run(false); refused = await run(true) }, 180_000)

  it('key 1: the real handoff had the real controller paint BBB, and the chart body did not render before the paint', () => {
    expect(took.first.applied, `refused as ${took.first.refusedAs}`).toBe(1)
    expect(took.first.candles).toBe(true)
    expect(took.first.host).toBe('BBB:AAA')        // the host shows BBB; the body is still held on AAA
    expect(took.first.views).toBe(0)               // no commit of the chart body
    expect(took.first.stale).toBe(0)               // …and no pass of it was started and skipped
    expect(took.first.pending).toBe('BBB')
  })

  describe.each([
    ['the controller takes the way back itself', () => took],
    ['the controller refuses the way back, React shows it', () => refused],
  ])('key 2, back to AAA inside the hold: %s', (_name, get) => {
    it('the switch is over: nothing is pending', () => {
      expect(get().back.host).toBe('AAA:AAA')
      expect(get().back.pending).toBe(null)
    })
    it('the canvas is AAA\'s own frame again: its candles, its price line, its markers, its name', () => {
      const r = get()
      expect(r.back.candle).toBe(r.candleOfAAA)
      expect(r.back.log.some((l) => /^candle#1 createPriceLine 41\.5$/.test(l)), 'the line of AAA').toBe(true)
      expect(r.back.log.filter((l) => /^markers set /.test(l)).at(-1)).toBe('markers set 1')
      expect(r.back.log.filter((l) => /^watermark lines /.test(l)).at(-1)).toContain('Alpha Incorporated')
    })
    it('later passes of AAA run (they were skipped for good): a change that re-draws the watermark reaches the chart', () => {
      const r = get()
      expect(r.later.pending).toBe(null)
      expect(r.later.staleAdded).toBe(0)
      expect(r.later.log.some((l) => /^watermark lines .*Alpha Renamed/.test(l))).toBe(true)
    })
    it('the numbers add up', () => {
      const d = get().diag
      expect(d.asked).toBe(d.applied + Object.values(d.refused).reduce((a, b) => a + b, 0))
      expect(d.lateBoxReads).toBe(0)
    })
  })
})

describe('5-minute, a session in progress: the developing-bar channel', () => {
  let clock
  beforeAll(() => { clock = pinWallClock('2026-09-22T17:17:00Z') })   // Tue 13:17 ET: the 13:15 bucket is forming
  afterAll(() => clock.restore())
  let r

  beforeAll(async () => {
    const t = await mounted(true, '5')
    const ctl = t.port.current
    const keyA = t.keyOf('AAA')
    const keyB = t.keyOf('BBB')
    let rev = Date.now()
    const tick = (key, sym, c) => act(async () => {
      t.M.store.registry.dispatch(key, { type: 'push-bar', key, event: { sym, bar: { t: et(13, 15) * 1000, o: 10, h: Math.max(11, c), l: 9, c, v: 500 }, rev: ++rev } })
    })
    // non-vacuity: before the switch, an AAA tick paints
    S.log.length = 0
    await tick(keyA, 'AAA', 10.71)
    await wait(60)
    const before = S.log.slice()
    const token = ctl ? ctl.canApply('BBB') : null
    const refusedAs = ctl ? JSON.stringify(ctl.diag.last) : 'no controller'
    let result = null
    act(() => { result = ctl && token ? ctl.apply('BBB', token) : null })
    // between the paint and the commit: the OLD symbol ticks
    S.log.length = 0
    await tick(keyA, 'AAA', 10.93)
    await wait(60)
    await tick(keyA, 'AAA', 10.95)
    await wait(60)
    const between = S.log.slice()
    // the commit, then the NEW symbol ticks
    t.view.rerender(t.el('BBB'))
    await wait(500)
    S.log.length = 0
    await tick(keyB, 'BBB', 21.37)
    await wait(60)
    r = { hasKeyA: t.M.store.registry.has(keyA), before, refusedAs, result, between, after: S.log.slice(), tail: ctl ? { ...ctl.diag.tail } : null }
    t.done()
  }, 120_000)

  it('non-vacuity: before the switch an AAA tick updates the candle', () => {
    expect(r.hasKeyA).toBe(true)
    expect(r.before.some((l) => /^candle#\d+ update 10\.71$/.test(l))).toBe(true)
  })

  it('the chart painted BBB imperatively (an intraday switch has no tail)', () => {
    expect(r.result, `refused as ${r.refusedAs}`).toBe('applied')
    expect(r.tail).toEqual({ none: 1 })
  })

  it('(f) an old-symbol tick between the paint and the commit writes nothing', () => {
    expect(r.between.filter((l) => / (update|setData) /.test(l))).toEqual([])
  })

  it('(f) after the commit the new symbol\'s ticks paint', () => {
    expect(r.after.some((l) => /^candle#\d+ update 21\.37$/.test(l))).toBe(true)
  })
})
