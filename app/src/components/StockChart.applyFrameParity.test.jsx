// ⭐⭐ THE CALL-LOG PARITY RAIL (imperative switch, stage 1; docs/charts/imperative-switch-design.md §6).
//
// The REAL StockChart is mounted on AAA and switched to BBB under six set-ups (daily, 60-minute, a custom
// timeframe, replay, Heikin-Ashi, a comparison). Everything the renderer is handed on the way is logged, in
// order: every series `setData` / `update` / `applyOptions` / price line, every `chart.applyOptions`, series
// added and removed, the framing calls on the time scale, the price-scale options, and each `binder.sync`
// (what it was asked to draw, over which bars). The log is compared with the one RECORDED ON THE COMMIT
// BEFORE `applyFrame` was extracted (`__fixtures__/applyFrameParity.golden.json`, base 32f26da0c4).
//
// So "no behaviour change" is a test, and it stays one: with the imperative switch OFF (the default) this is
// the same log as before any of that work. ⛔ Re-record (`UCT_UPDATE_GOLDEN=1`) only for a change that MEANS
// to change what the chart is handed, and say so in the PR.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'

const HERE = dirname(fileURLToPath(import.meta.url))
const GOLDEN = join(HERE, '__fixtures__', 'applyFrameParity.golden.json')

const S = vi.hoisted(() => ({ log: [], n: 0, rec: false, controllers: 0 }))
/** A stable, short name for one argument: functions and DOM nodes by kind, data by a hash of its JSON. */
const digest = (v) => {
  const seen = new WeakSet()
  const json = JSON.stringify(v, (k, x) => {
    if (typeof x === 'function') return 'ƒ'
    if (x && typeof x === 'object') {
      if (typeof x.nodeType === 'number') return '‹node›'
      if (seen.has(x)) return '‹cycle›'
      seen.add(x)
      if (x instanceof Set) return { set: [...x] }
      if (x instanceof Map) return { map: [...x] }
    }
    return x
  })
  if (json === undefined) return 'undefined'
  const n = Array.isArray(v) ? `[${v.length}]` : ''
  return json.length <= 96 ? json : `${n}sha:${createHash('sha1').update(json).digest('hex').slice(0, 16)}`
}
const put = (who, what, ...args) => { if (S.rec) S.log.push(`${who} ${what} ${args.map(digest).join(' ')}`.trimEnd()) }

vi.mock('../lib/realtimeBarsGate', () => ({ realtimeBarsEnabled: () => false }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const pane = (i) => ({
    paneIndex: () => i, getHeight: () => 300, getHTMLElement: () => document.createElement('div'), getSeries: () => [],
    setHeight: () => {}, setStretchFactor: (f) => put(`pane${i}`, 'setStretchFactor', f), getStretchFactor: () => 1,
    attachPrimitive: () => put(`pane${i}`, 'attachPrimitive'), detachPrimitive: () => {},
  })
  const scale = (who) => ({ applyOptions: (o) => put(who, 'scale.applyOptions', o), width: () => 0, options: () => ({}) })
  const make = (type, opts, paneIdx) => {
    const id = ++S.n
    const kind = type === real.CandlestickSeries ? 'candle' : type === real.HistogramSeries ? 'histogram' : type === real.LineSeries ? 'line'
      : type === real.BarSeries ? 'bar' : type === real.AreaSeries ? 'area' : 'other'
    const who = `${kind}#${id}`
    put('chart', 'addSeries', who, opts, paneIdx)
    let held = []
    const s = {
      __who: who,
      setData: (d) => { held = Array.isArray(d) ? d : []; put(who, 'setData', d) },
      update: (p) => put(who, 'update', p),
      data: () => held,
      applyOptions: (o) => put(who, 'applyOptions', o),
      priceScale: () => scale(who),
      createPriceLine: (o) => { put(who, 'createPriceLine', o); return { applyOptions: (x) => put(who, 'priceLine.applyOptions', x), options: () => o } },
      removePriceLine: () => put(who, 'removePriceLine'),
      setMarkers: (m) => put(who, 'setMarkers', m), attachPrimitive: () => put(who, 'attachPrimitive'),
      detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
      getPane: () => pane(0),
      priceFormatter: () => ({ format: (x) => String(x) }), moveToPane: (i) => put(who, 'moveToPane', i),
      seriesOrder: () => 0, setSeriesOrder: (o) => put(who, 'setSeriesOrder', o),
      dataByIndex: () => null, barsInLogicalRange: () => null,
      subscribeDataChanged: () => {}, unsubscribeDataChanged: () => {},
    }
    return s
  }
  const ts = {
    applyOptions: (o) => put('timeScale', 'applyOptions', o), fitContent: () => put('timeScale', 'fitContent'),
    setVisibleLogicalRange: (r) => put('timeScale', 'setVisibleLogicalRange', r), getVisibleLogicalRange: () => null,
    setVisibleRange: (r) => put('timeScale', 'setVisibleRange', r), scrollToPosition: (p, a) => put('timeScale', 'scrollToPosition', p, a),
    subscribeVisibleLogicalRangeChange: () => {}, unsubscribeVisibleLogicalRangeChange: () => {},
    timeToCoordinate: () => 0, coordinateToTime: () => null, resetTimeScale: () => {}, options: () => ({}), width: () => 600,
    logicalToCoordinate: () => 0, subscribeSizeChange: () => {}, unsubscribeSizeChange: () => {},
    subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {}, scrollPosition: () => 0,
    timeToIndex: () => null,
  }
  const chart = {
    addSeries: (type, opts, i) => make(type, opts, i),
    addCustomSeries: (view, opts, i) => make(null, opts, i),
    removeSeries: (s) => put('chart', 'removeSeries', s && s.__who),
    applyOptions: (o) => put('chart', 'applyOptions', o),
    priceScale: (id) => scale(`scale:${id}`),
    timeScale: () => ts,
    paneSize: () => ({ width: 600, height: 300 }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    subscribeDblClick: () => {}, unsubscribeDblClick: () => {},
    panes: () => [pane(0)],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
    chartElement: () => document.createElement('div'),
    options: () => ({}),
  }
  return {
    ...real,
    createChart: (el, o) => { put('chart', 'create', o); return chart },
    createSeriesMarkers: () => ({ setMarkers: (m) => put('markers', 'setMarkers', m), detach: () => {} }),
  }
})
// every `binder.sync`: what the engine was asked to draw, and over which bars
vi.mock('./chart/engine/binder', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    createBinder: (o) => {
      const b = real.createBinder(o)
      const sync = b.sync.bind(b)
      b.sync = (a) => {
        const bars = Array.isArray(a.bars) ? a.bars : []
        put('binder', 'sync', {
          enabled: a.enabled, sym: a.sym, tf: a.tf, n: bars.length, first: bars[0] ? bars[0].t : null, last: bars.length ? bars[bars.length - 1].t : null,
          instances: (a.instances || []).map((i) => `${i.instanceId}:${i.defId}:${i.hidden ? 'h' : 'v'}`),
          plan: a.plan, plotWindowFrom: a.plotWindowFrom, defer: a.deferSeriesData, forming: a.newestBarIsForming,
          hidden: !!a.indicatorsHidden, volPane: a.volSeparatePane, volIdx: a.VOL_PANE_INDEX, rth: a.frameRthOnly,
        })
        return sync(a)
      }
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

// a Saturday: the newest bar is settled and nothing forms
const clock = pinWallClock('2026-11-14T16:00:00Z')
afterAll(() => clock.restore())
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

const dailyRows = (k, from = '2025-06-02') => {
  const out = []
  const d = new Date(`${from}T00:00:00Z`)
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
/** Regular-session bars every `stepMin` minutes (09:30-16:00 ET, EST in November) for the last sessions. */
const intradayRows = (k, stepMin, sessions = 30) => {
  const days = dailyRows(1, '2026-08-03').slice(-sessions).map((b) => b.t)
  const out = []
  let i = 0
  for (const day of days) {
    const open = Date.parse(`${day}T14:30:00Z`) / 1000
    for (let m = 0; m < 390; m += stepMin) {
      const c = 40 * k + Math.sin(i / 13) * 3 * k + i * 0.002
      out.push({ t: open + m * 60, o: c - 0.2, h: c + 0.6, l: c - 0.7, c, v: 20000 + ((i * 7919 * k) % 9000) })
      i++
    }
  }
  return out
}
const K = { AAA: 1, BBB: 2, CCC: 3 }
const barsFor = (sym, tf) => {
  const k = K[sym]
  if (!k) return null
  if (/^\d+$/.test(tf)) return intradayRows(k, Number(tf))
  return dailyRows(k)
}

const INSTANCES = [
  { instanceId: 'pf-rsi', defId: 'rsi', inputs: {}, hidden: false },
  { instanceId: 'pf-ma', defId: 'movingAverage', inputs: { source: 'close', period: 20 }, hidden: false },
]
const noop = () => {}
const SCENARIOS = [
  { name: 'D', tf: 'D', settings: { indicatorInstances: INSTANCES } },
  { name: '60', tf: '60', settings: { indicatorInstances: INSTANCES } },
  { name: 'custom timeframe (2D)', tf: '2D', settings: { indicatorInstances: INSTANCES } },
  { name: 'replay', tf: 'D', settings: { indicatorInstances: INSTANCES }, props: { replayCutoff: '2026-09-15' } },
  { name: 'Heikin-Ashi', tf: 'D', settings: { indicatorInstances: INSTANCES, heikinAshi: true } },
  { name: 'comparison', tf: 'D', settings: { indicatorInstances: INSTANCES, comparisonSymbols: [{ sym: 'CCC', enabled: true }] } },
]

/** Mount AAA, hold BBB in the store, switch to BBB: the mount's log and the switch's. */
async function run(sc) {
  S.log.length = 0
  S.n = 0
  S.rec = false
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    const m = /\/api\/bars\/([A-Z]+)/.exec(u)
    const tf = (/[?&]tf=([^&]+)/.exec(u) || [])[1] || 'D'
    const bars = m ? barsFor(m[1], decodeURIComponent(tf)) : null
    const body = bars ? { ticker: m[1], tf, bars, newest_bar_is_forming: false } : {}
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
  }))
  const M = await loadWithBarStore(true, async () => ({
    StockChart: (await import('./StockChart')).default,
    nf: await import('./chart/neighborFrames'),
    store: (await import('../data/barStore/index')).getBarStore(),
    chartKeyFor: (await import('./chart/useBarSnapshotBars')).chartKeyFor,
  }))
  M.nf.__setNeighborFramesForTests(false)
  const props = { tf: sc.tf, backgroundWarm: false, settingsOverride: sc.settings, onSettingsPersist: noop, ...(sc.props || {}) }
  S.rec = true
  const view = render(<M.StockChart sym="AAA" {...props} />)
  await wait(900)
  S.rec = false
  const mount = S.log.slice()
  S.log.length = 0
  // the list's hold: BBB is in memory, answered, before the member reaches it
  const key = M.chartKeyFor({ sym: 'BBB', resolvedTf: sc.tf, showExtended: false, replayCutoff: sc.props?.replayCutoff ?? null, hasOverride: false })
  if (key) {
    M.store.registry.acquire(key)
    await act(async () => { try { await M.store.ensure(key, { priority: 'urgent' }) } catch { /* the chart asks for itself */ } })
  }
  await wait(200)
  S.rec = true
  view.rerender(<M.StockChart sym="BBB" {...props} />)
  await wait(700)
  S.rec = false
  const sw = S.log.slice()
  cleanup()
  if (key) M.store.registry.release(key)
  M.nf.__setNeighborFramesForTests(null)
  return { mount, switch: sw }
}

describe('StockChart: what the renderer is handed is what it was handed before applyFrame was extracted', () => {
  const got = {}
  beforeAll(async () => {
    for (const sc of SCENARIOS) got[sc.name] = await run(sc)
    if (process.env.UCT_UPDATE_GOLDEN === '1') {
      mkdirSync(dirname(GOLDEN), { recursive: true })
      writeFileSync(GOLDEN, `${JSON.stringify(got, null, 1)}\n`)
    }
  }, 240_000)
  const golden = () => JSON.parse(readFileSync(GOLDEN, 'utf8'))

  it('the recorded log exists and covers every set-up', () => {
    expect(existsSync(GOLDEN)).toBe(true)
    expect(Object.keys(golden()).sort()).toEqual(SCENARIOS.map((s) => s.name).sort())
  })

  it.each(SCENARIOS.map((s) => s.name))('%s: the run is not vacuous (candles, a binder pass and a frame were handed over)', (name) => {
    const { mount, switch: sw } = got[name]
    expect(mount.some((l) => /^chart create/.test(l))).toBe(true)
    for (const log of [mount, sw]) {
      expect(log.some((l) => /^(candle|bar)#\d+ setData \[\d+\]sha:/.test(l)), 'candles').toBe(true)
      expect(log.some((l) => /^binder sync /.test(l)), 'binder.sync').toBe(true)
      expect(log.some((l) => / applyOptions /.test(l)), 'applyOptions').toBe(true)
    }
    expect(sw.some((l) => /^timeScale setVisibleLogicalRange/.test(l)), 'the switch frames').toBe(true)
    expect(sw.length).toBeGreaterThan(12)
  })

  it.each(SCENARIOS.map((s) => s.name))('%s: the mount hands the renderer the recorded calls, in order', (name) => {
    const want = golden()[name].mount
    const have = got[name].mount
    for (let i = 0; i < Math.max(want.length, have.length); i++) expect(have[i], `mount call ${i}`).toBe(want[i])
  })

  it.each(SCENARIOS.map((s) => s.name))('%s: the switch hands the renderer the recorded calls, in order', (name) => {
    const want = golden()[name].switch
    const have = got[name].switch
    for (let i = 0; i < Math.max(want.length, have.length); i++) expect(have[i], `switch call ${i}`).toBe(want[i])
  })
})
