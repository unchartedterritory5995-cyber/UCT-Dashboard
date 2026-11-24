// ⭐ WHAT A SYMBOL SWITCH HANDS THE CHART LIBRARY, AND WHAT THE LIBRARY DOES WITH IT (2026-11-24, next-row drawing).
//
// The REAL StockChart, on the chart's default board (candles, volume, the four default moving averages, the hidden
// future-axis line), through the render window, switching the way a member steps through a list: the next name's bars
// already in memory. A recording stand-in for the library captures every series the chart creates and every row it
// hands each one (what the library would be handed: after the render window's cut). The recording is then REPLAYED on
// the real library, the production build as published and as the build patches it (src/testing/chartLibraryBuilds.js:
// a test's normal import is the development build, which no member runs), and the library's work is counted per step:
//   calls    `setData` calls (each one ends in the library's `recalculateAllPanes`: an autoscale pass over every pane)
//   updates  `update` calls (the same, one row at a time)
//   sorts    time-scale rebuilds, measured on each build
//   full     FULL updates: calls after which the library's set of time points changed (every series re-set in the
//            library's model, the time scale's points and tick marks redone); on the patched build, sorts == full.
// The table is written to remote-out/library-work.json on the remote lane. Counts, not milliseconds: nothing here times.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, act, cleanup } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'
import { loadChartLibraryBuilds, stubCanvasForChartLibrary, libraryWorkCounter } from '../testing/chartLibraryBuilds'

const S = vi.hoisted(() => ({ calls: [], n: 0 }))
vi.mock('../lib/realtimeBarsGate', () => ({ realtimeBarsEnabled: () => false }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const kindOf = (type) => (type === real.CandlestickSeries ? 'candle' : type === real.HistogramSeries ? 'histogram'
    : type === real.LineSeries ? 'line' : type === real.AreaSeries ? 'area' : type === real.BarSeries ? 'bar'
      : type === real.BaselineSeries ? 'baseline' : 'other')
  // what each row is to the library: its time, and whether it is a bar ('c'), a value ('v') or whitespace ('w')
  const slim = (rows) => (Array.isArray(rows) ? rows.map((r) => [r?.time,
    r && (r.open !== undefined || r.close !== undefined) ? 'c' : r && r.value !== undefined ? 'v' : 'w']) : [])
  const make = (kind, options, pane) => {
    const id = ++S.n
    S.calls.push({ m: 'add', id, kind, pane: Number.isInteger(pane) ? pane : 0, scale: options?.priceScaleId ?? null })
    return {
      __id: id,
      setData: (d) => { S.calls.push({ m: 'setData', id, rows: slim(d) }) },
      update: (p, hist) => { S.calls.push({ m: 'update', id, rows: slim([p]), hist: !!hist }) },
      data: () => [],
      applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      createPriceLine: () => ({ applyOptions: () => {} }), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
      detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
      getPane: () => ({ paneIndex: () => 0, getHeight: () => 300, getHTMLElement: () => document.createElement('div'), getSeries: () => [] }),
      priceFormatter: () => ({ format: (x) => String(x) }), moveToPane: () => {}, seriesOrder: () => 0, setSeriesOrder: () => {},
      dataByIndex: () => null, barsInLogicalRange: () => null,
      subscribeDataChanged: () => {}, unsubscribeDataChanged: () => {},
    }
  }
  const chart = {
    addSeries: (type, options, pane) => make(kindOf(type), options, pane),
    addCustomSeries: (_view, options, pane) => make('custom', options, pane),
    removeSeries: (s) => { S.calls.push({ m: 'remove', id: s?.__id }) },
    applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
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

// a Saturday: the newest bars are settled and nothing forms
const clock = pinWallClock('2026-11-14T16:00:00Z')
afterAll(() => clock.restore())
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

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
  S.calls.push({ m: 'mark', label: 'first load: AAA daily (8,003 bars)' })
  const view = render(chartOf('AAA', 'D'))
  await wait(1500)
  for (const [label, sym, tf] of STEPS) {
    await hold(sym, tf)
    await wait(200)
    S.calls.push({ m: 'mark', label })
    view.rerender(chartOf(sym, tf))
    await wait(1000)
  }
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
  counter.counted(() => {
    for (const c of calls) {
      if (c.m === 'mark') { step = { label: c.label, calls: 0, updates: 0, full: 0, fullByUpdate: 0, sorts0: counter.sorts, set: [], threw: 0 }; steps.push(step); continue }
      if (c.m === 'add') {
        const opts = c.scale != null ? { priceScaleId: c.scale } : {}
        series.set(c.id, chart.addSeries(DEF[c.kind] || lib.LineSeries, opts, c.pane))
        kinds.set(c.id, c.kind)
        continue
      }
      const s = series.get(c.id)
      if (!s) continue
      try {
        if (c.m === 'setData') {
          s.setData(c.rows.map((r) => rowFor(kinds.get(c.id), r)))
          const changed = counter.setData(c.id, c.rows.map((r) => r[0]))
          if (step) { step.calls += 1; step.set.push(`${kinds.get(c.id)}#${c.id}:${c.rows.length}`); if (changed) step.full += 1 }
        } else if (c.m === 'update') {
          s.update(rowFor(kinds.get(c.id), c.rows[0]), c.hist)
          const changed = counter.update(c.id, c.rows[0][0])
          if (step) { step.updates += 1; if (changed) step.fullByUpdate += 1 }
        } else if (c.m === 'remove') {
          chart.removeSeries(s)
          series.delete(c.id)
          counter.remove(c.id)
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
      sortsShipped: shipped[i].sorts, sortsPatched: p.sorts, threw: p.threw, series: p.set,
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
    expect(patched.map((s) => s.label)).toEqual(['first load: AAA daily (8,003 bars)', ...STEPS.map((s) => s[0])])
    for (const s of patched) {
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
    const got = Object.fromEntries(patched.map((p, i) => [p.label, [p.calls, p.updates, p.full, shipped[i].sorts, p.sorts]]))
    expect(got).toEqual({
      'first load: AAA daily (8,003 bars)': [7, 0, 2, 2, 2],
      [STEPS[0][0]]: [6, 0, 1, 6, 1],
      [STEPS[1][0]]: [6, 0, 0, 6, 0],
      [STEPS[2][0]]: [6, 0, 1, 6, 1],
      [STEPS[3][0]]: [6, 0, 1, 6, 1],
      [STEPS[4][0]]: [7, 0, 3, 7, 3],
      [STEPS[5][0]]: [6, 0, 1, 6, 1],
    })
  })
})
