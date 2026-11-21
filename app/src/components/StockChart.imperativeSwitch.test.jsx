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
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Profiler } from 'react'
import { render, act, cleanup } from '@testing-library/react'
import { createHash } from 'node:crypto'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'

const FLAG = 'uct.imperativeSwitch'
const S = vi.hoisted(() => ({ log: [], n: 0, commits: 0, range: null, stateful: false }))
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
      createPriceLine: (o) => { put(who, 'createPriceLine', o.price); return { applyOptions: () => {}, options: () => o } },
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
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
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
  const k = m ? K[m[1]] : 0
  const body = !k ? {} : /^\d+$/.test(tf) ? { ticker: m[1], tf, bars: fiveRows(k) } : { ticker: m[1], tf, bars: dailyRows(k), newest_bar_is_forming: false }
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

/** A fresh module graph with the switch as asked (it is read once, at StockChart's module load). */
async function loadGraph(on) {
  localStorage.setItem(FLAG, on ? '1' : '0')
  try {
    return await loadWithBarStore(true, async () => ({
      StockChart: (await import('./StockChart')).default,
      nf: await import('./chart/neighborFrames'),
      store: (await import('../data/barStore/index')).getBarStore(),
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
  S.log.length = 0; S.n = 0; S.commits = 0; S.range = null
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
  }, 120_000)

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
