// ⭐ WHAT A SYMBOL SWITCH HANDS THE CHART LIBRARY, AND WHAT THE LIBRARY DOES WITH IT (2026-11-24, next-row drawing).
//
// The REAL StockChart, on the chart's default board (candles, volume, the four default moving averages, the hidden
// future-axis line), through the render window, switching the way a member steps through a list: the next name's bars
// already in memory. The chart runs on the REAL library as members run it: the production build through the build's
// own edits (src/testing/chartLibraryBuilds.js; a test's normal import is the development build, which no member runs),
// so everything the chart asks the library (its visible range, coordinates, data) is answered truthfully. A thin layer
// under the render window records every series the chart creates and every row it hands each one. The recording is
// then REPLAYED on the production build as published and as patched, and the library's work is counted per step:
//   calls    `setData` calls (each one ends in the library's `recalculateAllPanes`: an autoscale pass over every pane)
//   updates  `update` calls (the same, one row at a time)
//   sorts    time-scale rebuilds, measured on each build
//   full     FULL updates: calls after which the library's set of time points changed (every series re-set in the
//            library's model, the time scale's points and tick marks redone); on the patched build, sorts == full.
// Each step also says why the chart painted (every updateChart pass: its bars plan, its paint, which part of its render
// signature moved). The table is written to remote-out/library-work.json on the remote lane. Counts, not milliseconds.
//
// What it found (2026-11-24), on the build members run: a daily switch hands the library 6 `setData` (candles, volume,
// the four averages; the future-axis line keeps its slots); the time scale is rebuilt only by the call that changes its
// points (the build's edit 6, scripts/chartLibraryPatch.mjs). As published, the library would rebuild on every one of
// the 6. Two things it found are fixed (#2707) and the pins below are the counts after them: a daily window now starts
// on the first session of a calendar month, so names of different depths keep the library's time points (the
// index-stepped start moved them: 1 FULL update per switch); and a metadata answer no longer settles the incoming
// name's frame on the outgoing board (the 30-minute switch handed the library 13 `setData`, 7 of them the outgoing
// board extended and re-set; now 6).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, act, cleanup } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'
import { loadChartLibraryBuilds, stubCanvasForChartLibrary, libraryWorkCounter } from '../testing/chartLibraryBuilds'

const S = vi.hoisted(() => ({ calls: [], n: 0, ids: new Map() }))
vi.mock('../lib/realtimeBarsGate', () => ({ realtimeBarsEnabled: () => false }))
vi.mock('lightweight-charts', async () => {
  const builds = await import('../testing/chartLibraryBuilds')
  builds.stubCanvasForChartLibrary()
  const lib = (await builds.loadChartLibraryBuilds()).patched
  const kindOf = (def) => (def === lib.CandlestickSeries ? 'candle' : def === lib.HistogramSeries ? 'histogram'
    : def === lib.LineSeries ? 'line' : def === lib.AreaSeries ? 'area' : def === lib.BarSeries ? 'bar'
      : def === lib.BaselineSeries ? 'baseline' : 'other')
  // what each row is to the library: its time, and whether it is a bar ('c'), a value ('v') or whitespace ('w')
  const slim = (rows) => (Array.isArray(rows) ? rows.map((r) => [r?.time,
    r && (r.open !== undefined || r.close !== undefined) ? 'c' : r && r.value !== undefined ? 'v' : 'w']) : [])
  const recorded = (s, kind, options, pane) => {
    const id = ++S.n
    S.ids.set(s, id)
    S.calls.push({ m: 'add', id, kind, pane: Number.isInteger(pane) ? pane : 0, scale: options?.priceScaleId ?? null })
    const setData = s.setData.bind(s)
    const update = s.update.bind(s)
    s.setData = (d) => {
      // which code handed the candles their rows (function names on the stack, outside the library and this file)
      const from = kind === 'candle' ? String(new Error().stack).split('\n').slice(2)
        .map((l) => /at (?:Object\.|Proxy\.)?([\w$.]+)/.exec(l)?.[1]).filter((n) => n && !/^(?:s\.setData|counted|Array|Map|new)$/.test(n)).slice(0, 7).join('<') : null
      S.calls.push({ m: 'setData', id, rows: slim(d), from })
      return setData(d)
    }
    s.update = (p, hist) => { S.calls.push({ m: 'update', id, rows: slim([p]), hist: !!hist }); return update(p, hist) }
    return s
  }
  const createChart = (el, options) => {
    // jsdom has no ResizeObserver: a chart created with `autoSize` stays 0 wide and has no visible range, and every
    // geometry the chart reads (the view's span, the outgoing frame) degenerates. Sized as a 900 x 500 chart instead.
    const chart = lib.createChart(el, { ...(options || {}), autoSize: false, width: 900, height: 500 })
    const addSeries = chart.addSeries.bind(chart)
    const addCustomSeries = chart.addCustomSeries.bind(chart)
    const removeSeries = chart.removeSeries.bind(chart)
    chart.addSeries = (def, options, pane) => recorded(addSeries(def, options, pane), kindOf(def), options, pane)
    chart.addCustomSeries = (view, options, pane) => recorded(addCustomSeries(view, options, pane), 'custom', options, pane)
    chart.removeSeries = (s) => { S.calls.push({ m: 'remove', id: S.ids.get(s) }); return removeSeries(s) }
    // every frame the chart sets (library logical indices) and the code that set it
    const ts = chart.timeScale()
    const setRange = ts.setVisibleLogicalRange.bind(ts)
    ts.setVisibleLogicalRange = (r) => {
      const from = String(new Error().stack).split('\n').slice(2)
        .map((l) => /at (?:Object\.|Proxy\.)?([\w$.]+)/.exec(l)?.[1]).filter(Boolean).slice(0, 4).join('<')
      S.calls.push({ m: 'frame', what: `${r ? `${Math.round(r.from)}..${Math.round(r.to)}` : r} from ${from}` })
      return setRange(r)
    }
    return chart
  }
  return { ...lib, createChart }
})
// the render window's decisions: every setWindow (rows asked for) and every move of its start
vi.mock('./chart/windowedChart', async (orig) => {
  const real = await orig()
  return { ...real, createWindowedChart: (chart, o) => {
    const f = real.createWindowedChart(chart, o)
    const ctl = f.window
    if (ctl && typeof ctl.setWindow === 'function') {
      const setWindow = ctl.setWindow
      ctl.setWindow = (rows, opts) => { S.calls.push({ m: 'window', what: `setWindow ${rows} span ${opts?.span ?? '-'}` }); return setWindow(rows, opts) }
      ctl.onChange?.(() => S.calls.push({ m: 'window', what: `start moved to ${ctl.windowStart()} (${ctl.windowStartTime()})` }))
    }
    return f
  } }
})
// every updateChart pass: its bars plan and the paint it recorded (chart/paintLog.js), to say WHY a switch paints
vi.mock('./chart/renderPlan', async (orig) => {
  const real = await orig()
  return { ...real, barsRenderPlan: (prev, next) => {
    const p = real.barsRenderPlan(prev, next)
    S.calls.push({ m: 'plan', mode: p.mode, prevN: prev ? prev.length : null, nextN: next ? next.length : null, sameRows: prev === next })
    return p
  } }
})
vi.mock('./chart/paintLog', async (orig) => {
  const real = await orig()
  return { ...real, recordPaint: (sym, tf, bars, mode) => { S.calls.push({ m: 'paint', sym, tf, bars, mode }); return real.recordPaint(sym, tf, bars, mode) } }
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

// a Saturday: the newest bars are settled and nothing forms
const clock = pinWallClock('2026-11-14T16:00:00Z')
afterAll(() => clock.restore())
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

// ⭐ NO FIXED SLEEPS (review of #2706): a step waits for its own landmarks, a slice (SLICE_MS) at a time, and every slice
// flushes React's effects and the timers due in it. First until the step's name is PAINTED (chart/paintLog's record names
// its symbol and timeframe), then until the library has been handed nothing (no series added, set, updated or removed)
// for QUIET_SLICES slices in a row. A late answer on a loaded runner moves the wait; it can no longer land in the next
// step's counts. A wait that never ends throws, naming the step.
const SLICE_MS = 25
const QUIET_SLICES = 8          // 200 ms in which the library is handed nothing
const LIBRARY_WORK = new Set(['add', 'setData', 'update', 'remove'])
const libraryCalls = () => S.calls.reduce((n, c) => n + (LIBRARY_WORK.has(c.m) ? 1 : 0), 0)
async function untilQuiet(what, deadlineMs = 20_000) {
  const t0 = performance.now()
  let n = libraryCalls()
  let quiet = 0
  while (quiet < QUIET_SLICES) {
    await wait(SLICE_MS)
    const now = libraryCalls()
    if (now === n) quiet += 1
    else { n = now; quiet = 0 }
    if (performance.now() - t0 > deadlineMs) throw new Error(`${what}: the library was still being handed calls after ${deadlineMs} ms`)
  }
}
async function untilPainted(sym, tf, from, deadlineMs = 20_000) {
  const t0 = performance.now()
  while (!S.calls.slice(from).some((c) => c.m === 'paint' && c.sym === sym && String(c.tf) === tf)) {
    if (performance.now() - t0 > deadlineMs) throw new Error(`${sym} ${tf} was never painted`)
    await wait(SLICE_MS)
  }
}

// ── the names on the list: the same recent sessions, different history depths ──────────────────────────────────────
const DAY = 86_400_000
function dailyRows(n, k) {
  const out = []
  for (let ms = Date.UTC(2026, 10, 13); out.length < n; ms -= DAY) {
    const wd = new Date(ms).getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(new Date(ms).toISOString().slice(0, 10))
  }
  return out.reverse().map((t, i) => bar(t, i, k))
}
function rth30Rows(n, k) {
  const out = []
  for (let t = Date.UTC(2026, 10, 13, 20, 30) / 1000; out.length < n; t -= 1800) {
    const d = new Date(t * 1000)
    const m = d.getUTCHours() * 60 + d.getUTCMinutes()
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && m >= 14 * 60 + 30 && m <= 20 * 60 + 30) out.push(t)
  }
  return out.reverse().map((t, i) => bar(t, i, k))
}
function bar(t, i, k) {
  const c = 40 * k + Math.sin(i / 11) * 6 * k + i * 0.001
  return { t, o: c - 0.5, h: c + 1.5, l: c - 1.7, c, v: 1e6 + ((i * 7919 * k) % 500000) }
}
const BARS = {
  'AAA|D': dailyRows(8003, 1), 'BBB|D': dailyRows(6512, 2), 'CCC|D': dailyRows(6512, 3), 'DDD|D': dailyRows(1200, 4),
  'AAA|30': rth30Rows(5200, 1), 'BBB|30': rth30Rows(3900, 2),
}
// each step: what the member does, the name and timeframe it lands on
const STEPS = [
  ['AAA daily -> BBB daily (another history depth: 6,512 bars)', 'BBB', 'D'],
  ['BBB daily -> CCC daily (the same depth: the windows coincide)', 'CCC', 'D'],
  ['CCC daily -> DDD daily (1,200 bars: fewer than a window leaves out)', 'DDD', 'D'],
  ['DDD daily -> AAA daily', 'AAA', 'D'],
  ['AAA daily -> AAA 30 minutes (a timeframe change: 5,200 bars)', 'AAA', '30'],
  ['AAA 30 minutes -> BBB 30 minutes (3,900 bars)', 'BBB', '30'],
]

/** Mount AAA daily, then take every step with the next name's bars already in memory. The recorded calls. */
async function recordSwitches() {
  S.calls.length = 0
  S.n = 0
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    const m = /\/api\/bars\/([A-Z]+)\?tf=([A-Z0-9]+)/.exec(u)
    const rows = m ? BARS[`${m[1]}|${m[2]}`] : null
    if (!rows) return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => ({}) })
    const body = { ticker: m[1], tf: m[2], bars: rows, newest_bar_is_forming: false }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
  }))
  const M = await loadWithBarStore(true, async () => ({
    StockChart: (await import('./StockChart')).default,
    store: (await import('../data/barStore/index')).getBarStore(),
    chartKeyFor: (await import('./chart/useBarSnapshotBars')).chartKeyFor,
  }))
  const held = []
  const hold = async (sym, tf) => {
    const key = M.chartKeyFor({ sym, resolvedTf: tf, showExtended: false, replayCutoff: null, hasOverride: false })
    M.store.registry.acquire(key)
    held.push(key)
    await act(async () => { await M.store.ensure(key, { priority: 'urgent' }) })
  }
  const chartOf = (sym, tf) => <M.StockChart sym={sym} tf={tf} backgroundWarm={false} />
  // the render signature of each updateChart pass (the object it stringifies to decide noop / full)
  const realStringify = JSON.stringify
  JSON.stringify = function sigSpy(v, ...rest) {
    const out = realStringify.call(JSON, v, ...rest)
    if (v && typeof v === 'object' && !Array.isArray(v) && 'plotWin' in v && 'defsGen' in v) S.calls.push({ m: 'sig', sig: out })
    return out
  }
  try {
    S.calls.push({ m: 'mark', label: 'first load: AAA daily (8,003 bars)' })
    const view = render(chartOf('AAA', 'D'))
    await untilPainted('AAA', 'D', 0)
    await untilQuiet('first load')
    for (const [label, sym, tf] of STEPS) {
      await hold(sym, tf)
      await untilQuiet(`holding ${sym} ${tf}`)
      S.calls.push({ m: 'mark', label })
      const from = S.calls.length
      view.rerender(chartOf(sym, tf))
      await untilPainted(sym, tf, from)
      await untilQuiet(label)
    }
  } finally { JSON.stringify = realStringify }
  S.calls.push({ m: 'mark', label: 'unmount' })
  cleanup()
  for (const key of held) M.store.registry.release(key)
  vi.unstubAllGlobals()
  return S.calls.slice()
}

/** Replay the recorded calls on a real chart of `lib`; per step: the calls, the sorts measured, the full updates. */
function replay(lib, calls) {
  stubCanvasForChartLibrary()
  const el = document.createElement('div')
  document.body.appendChild(el)
  const chart = lib.createChart(el, { width: 900, height: 500 })
  const DEF = { candle: lib.CandlestickSeries, bar: lib.BarSeries, line: lib.LineSeries, area: lib.AreaSeries,
    baseline: lib.BaselineSeries, histogram: lib.HistogramSeries, custom: lib.HistogramSeries, other: lib.LineSeries }
  const series = new Map()
  const kinds = new Map()
  const counter = libraryWorkCounter()
  const steps = []
  let step = null
  const rowFor = (kind, [time, flag]) => {
    if (flag === 'w') return { time }
    return kind === 'candle' || kind === 'bar' ? { time, open: 10, high: 11, low: 9, close: 10.5 } : { time, value: 1 }
  }
  let lastSig = null
  counter.counted(() => {
    for (const c of calls) {
      if (c.m === 'mark') { step = { label: c.label, calls: 0, updates: 0, full: 0, fullByUpdate: 0, sorts0: counter.sorts, set: [], passes: [], threw: 0 }; steps.push(step); continue }
      if (c.m === 'plan') { step?.passes.push(`plan ${c.mode} ${c.prevN}->${c.nextN}${c.sameRows ? ' same rows' : ''}`); continue }
      if (c.m === 'paint') { step?.passes.push(`paint ${c.mode} ${c.sym} ${c.tf} ${c.bars}`); continue }
      if (c.m === 'window') { step?.passes.push(`window: ${c.what}`); step?.set.push(`window: ${c.what}`); continue }
      if (c.m === 'frame') { step?.set.push(`frame: ${c.what}`); continue }
      if (c.m === 'sig') {
        const now = JSON.parse(c.sig)
        const moved = lastSig ? Object.keys({ ...lastSig, ...now }).filter((k) => JSON.stringify(lastSig[k]) !== JSON.stringify(now[k])) : ['(first)']
        step?.passes.push(`sig changed: ${moved.join(',') || '(none)'}`)
        lastSig = now
        continue
      }
      if (c.m === 'add') {
        const opts = c.scale != null ? { priceScaleId: c.scale } : {}
        series.set(c.id, chart.addSeries(DEF[c.kind] || lib.LineSeries, opts, c.pane))
        kinds.set(c.id, c.kind)
        step?.set.push(`add ${c.kind}#${c.id} pane ${c.pane}`)
        continue
      }
      const s = series.get(c.id)
      if (!s) continue
      const before = counter.sorts
      try {
        if (c.m === 'setData') {
          s.setData(c.rows.map((r) => rowFor(kinds.get(c.id), r)))
          const changed = counter.setData(c.id, c.rows.map((r) => r[0]))
          if (step) { step.calls += 1; step.set.push(`${kinds.get(c.id)}#${c.id}:${c.rows.length}${changed ? ' FULL' : ''} s${counter.sorts - before}${c.from ? ` from ${c.from}` : ''}`); if (changed) step.full += 1 }
        } else if (c.m === 'update') {
          s.update(rowFor(kinds.get(c.id), c.rows[0]), c.hist)
          const changed = counter.update(c.id, c.rows[0][0])
          if (step) { step.updates += 1; if (changed) step.fullByUpdate += 1 }
        } else if (c.m === 'remove') {
          chart.removeSeries(s)
          series.delete(c.id)
          const changed = counter.remove(c.id)
          if (changed && step) step.full += 1
          step?.set.push(`remove ${kinds.get(c.id)}#${c.id}${changed ? ' FULL' : ''} s${counter.sorts - before}`)
        }
      } catch { if (step) step.threw += 1 }
      if (step) step.sorts = counter.sorts - step.sorts0
    }
  })
  chart.remove()
  el.remove()
  return steps.map(({ sorts0, ...rest }) => ({ ...rest, sorts: rest.sorts ?? 0 }))
}

describe('what a list switch hands the chart library, and what each build of the library does with it', () => {
  let calls
  let shipped
  let patched
  beforeAll(async () => {
    calls = await recordSwitches()
    const libs = await loadChartLibraryBuilds()
    shipped = replay(libs.shipped, calls)
    patched = replay(libs.patched, calls)
    const table = patched.map((p, i) => ({
      step: p.label, setData: p.calls, update: p.updates, full: p.full, fullByUpdate: p.fullByUpdate,
      sortsShipped: shipped[i].sorts, sortsPatched: p.sorts, threw: p.threw, passes: p.passes,
      callsPatched: p.set, callsShipped: shipped[i].set,
    }))
    // eslint-disable-next-line no-console
    console.log('[library work per switch]\n' + table.map((r) => JSON.stringify(r)).join('\n'))
    if (process.env.GITHUB_WORKFLOW === 'remote tests') {
      const dir = path.resolve(process.cwd(), '..', 'remote-out')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'library-work.json'), JSON.stringify(table, null, 1))
    }
  }, 180_000)

  it('every step drew the name it landed on (the recording is not vacuous) and the library took every call', () => {
    expect(patched.map((s) => s.label)).toEqual(['first load: AAA daily (8,003 bars)', ...STEPS.map((s) => s[0]), 'unmount'])
    for (const s of patched.filter((x) => x.label !== 'unmount')) {
      expect(s.set.some((x) => x.startsWith('candle')), s.label).toBe(true)
      expect(s.threw, s.label).toBe(0)
    }
    for (const s of shipped) expect(s.threw, s.label).toBe(0)
  })

  it('on the build members run, the time scale is rebuilt exactly on the calls that change its points', () => {
    for (const s of patched) expect(s.sorts, s.label).toBe(s.full)
  })

  it('the counts per step (pinned: a change to the switch path shows here)', () => {
    // per step: setData calls, update calls, FULL updates, rebuild sorts as published, rebuild sorts as members run it
    const got = Object.fromEntries(patched.filter((p) => p.label !== 'unmount').map((p, i) => [p.label, [p.calls, p.updates, p.full, shipped[i].sorts, p.sorts]]))
    // measured 2026-11-24 on master before #2707 (runs 45462654674 and after): AAA -> BBB [7, 0, 2, 7, 2] (the window's
    // first date moved with the depth) and the 30-minute switch [13, 0, 2, 13, 2] (the outgoing board re-set first).
    // After #2707:
    expect(got).toEqual({
      // candles, volume, the four averages; the future-axis line is not set yet (its effect ran before the chart existed)
      'first load: AAA daily (8,003 bars)': [6, 0, 1, 1, 1],
      // the future-axis line's first set (40 slots past the newest day: a FULL update), then the board, whose window
      // starts on the same date for both depths: no second FULL update
      [STEPS[0][0]]: [7, 0, 1, 7, 1],
      // the same window: the library's time points do not change, nothing is rebuilt
      [STEPS[1][0]]: [6, 0, 0, 6, 0],
      // 1,200 bars: no window, every bar (older points); and back to a window
      [STEPS[2][0]]: [6, 0, 1, 6, 1],
      [STEPS[3][0]]: [6, 0, 1, 6, 1],
      // a timeframe change: the candles add the 30-minute points, the last average drops the daily ones, the
      // future-axis line trades daily slots for 30-minute ones
      [STEPS[4][0]]: [7, 0, 3, 7, 3],
      // only the incoming board (the next test); the 30-minute windows keep the index step: one FULL update
      [STEPS[5][0]]: [6, 0, 1, 6, 1],
    })
  })

  // ⛔ FIXED (#2707), PINNED SO IT STAYS FIXED. On the 30-minute switch, before the switch's own pass handed the library the
  // new name's board, a metadata answer landed (the feed publishes in its layout effect, ahead of the switch's) and
  // `_onMetaLanded` -> `settleOnMetaLanded` re-asserted the settling frame with THIS render's bars (the new name's: its
  // newest bar is index 3,899) on the chart that still held the OLD board (index 3,899 there is 1,300 bars back): the
  // render window reached left for it and the old board was extended and re-set (2,200 rows on every series) only to be
  // replaced a moment later. The settle now runs only on the board its bars are painted on (chart/metaSettleGuard.js).
  it('FIXED: on the 30-minute switch the first candles the library is handed are the incoming name\'s, from the switch', () => {
    const step = patched.find((p) => p.label === STEPS[5][0])
    const firstCandle = calls.slice(calls.findIndex((c) => c.m === 'mark' && c.label === STEPS[5][0]))
      .find((c) => c.m === 'setData' && c.from != null)
    expect(firstCandle.rows.length).toBe(650)
    expect(firstCandle.from).not.toMatch(/settleOnMetaLanded|extendTo/)
    expect(step.set.filter((x) => /:2200 /.test(x))).toEqual([])
  })
})
