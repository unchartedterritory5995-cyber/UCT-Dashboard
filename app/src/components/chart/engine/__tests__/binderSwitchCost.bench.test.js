// ⭐ BINDER SWITCH COST (2026-11-20) — what one LIST FLIP costs inside `binder.sync`, on the real library.
//
// A member arrows down a watchlist with linked charts. Neighbour frames (`useNeighborFrames.prepareRow` ->
// `binder.prepare`) prepares the next rows in idle time, so the switch should find its indicator columns (and
// the nearest rows' points) ready. This file measures, per switch, on lightweight-charts itself (jsdom, the
// same canvas stub as `fillRealChart.test.js`) behind the chart's render-window facade (`windowedChart.js`):
//
//   * what the switch COMPUTED and what it TOOK from the prepared store (per definition), and
//   * how long `binder.sync` took, prepared vs not prepared ("cold"), daily (12,000 rows) and 60m (30,000 rows),
//     with a CPU profile of the syncs alone (self time by file and by function).
//
// The rows are prepared the way the chart prepares them: the store's base snapshot, read with `legacyBars`,
// derived through the chart's own recipes (`deriveSession`), handed to `binder.prepare` by `prepareRow`. The
// switch then hands `sync` what StockChart hands it: `deriveSession(legacyBars(snapshot))`, the plot window
// (`plotWindowRows` / `plotWindowStart`) and the render window (`renderWindowRows`).
//
// ⛔ A MEASUREMENT, NOT A RAIL. The asserts are on what was computed (counts), never on milliseconds; the
// numbers are printed, and written to remote-out/ when this runs on the `remote tests` lane.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import inspector from 'node:inspector'

const snaps = new Map()
const fakeStore = {
  registry: { has: (k) => snaps.has(k) },
  getBaseSnapshot: (k) => snaps.get(k) ?? null,
}
vi.mock('../../../../data/barStore/index', () => ({ getBarStore: () => fakeStore }))
vi.mock('../../barStoreSwitch', () => ({ BARSTORE: true }))

const LWC = await import('lightweight-charts')
const { prepareRow, deriveSession, deriveOhlcBase } = await import('../../useNeighborFrames')
const { chartKeyFor } = await import('../../useBarSnapshotBars')
const { legacyBars, newestBarIsFormingOf } = await import('../../../../data/barStore/adapter')
const nf = await import('../../neighborFrames')
const { toChartTime } = await import('../../barTime')
const { createBinder } = await import('../binder')
const nativeRegistry = await import('../nativeRegistry')
const sc = await import('../serverCompute')
const { createWindowedChart, renderWindowRows } = await import('../../windowedChart')
const { plotWindowRows, plotWindowStart } = await import('../plotWindow')
const { eligibleInstances } = await import('../eligibility')

const ENGINE_LWC = {
  LineSeries: LWC.LineSeries, HistogramSeries: LWC.HistogramSeries, AreaSeries: LWC.AreaSeries,
  BaselineSeries: LWC.BaselineSeries, LineStyle: LWC.LineStyle, LineType: LWC.LineType,
  CandlestickSeries: LWC.CandlestickSeries, BarSeries: LWC.BarSeries,
}

beforeAll(() => {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'canvas') return { width: 1200, height: 700 }
      if (k === 'measureText') return () => ({ width: 30, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
      return () => {}
    },
    set: () => true,
  })
  HTMLCanvasElement.prototype.getContext = () => ctx
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { return 1200 }, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get() { return 700 }, configurable: true })
  // a server-lane column set that has not landed asks; nothing here answers it
  vi.stubGlobal('fetch', () => new Promise(() => {}))
  nf.__setNeighborFramesForTests(true)
})
afterAll(() => { nf.__setNeighborFramesForTests(null); sc.clearServerColumns(); vi.unstubAllGlobals() })

// ─── the chart's mixed set: the four averages a member starts with, and the proof's `mixed` indicators ────────────
const MA = (i, period, maType) => ({ instanceId: `ovl:${i}`, defId: 'movingAverage', inputs: { source: 'close', period, maType }, hidden: false })
const inst = (defId) => ({ instanceId: `t:${defId}`, defId, inputs: {}, hidden: false })
const MIXED_DEFS = ['bb', 'vwap', 'rsi', 'macd', 'relativeVolume', 'rsLine', 'rsRating', 'rsPhases', 'rsVsEma', 'rsExit']
/** What the chart hands the binder at `tf`: the list, narrowed by eligibility (VWAP is a session indicator). */
const MIXED = (tf) => eligibleInstances([MA(0, 10, 'ema'), MA(1, 21, 'ema'), MA(2, 50, 'sma'), MA(3, 200, 'sma'), ...MIXED_DEFS.map(inst)],
  nativeRegistry, { tf }).kept
const OVERLAY = new Set(['movingAverage', 'bb', 'vwap'])
const SERVER = MIXED_DEFS.filter((d) => nativeRegistry.getDefinition(d)?.compute?.kind === 'server')

/** Placement as the chart's panes mode lays it out: overlays on the candles' pane, each oscillator its own pane. */
function placementFor(instances) {
  const panes = new Map()
  for (const i of instances) if (!OVERLAY.has(i.defId) && !panes.has(i.instanceId)) panes.set(i.instanceId, panes.size + 1)
  return (instance) => (OVERLAY.has(instance.defId)
    ? { paneIndex: 0, scaleId: 'right', scaleOptions: null }
    : { paneIndex: panes.get(instance.instanceId) || 1, scaleId: 'right', scaleOptions: { scaleMargins: { top: 0.1, bottom: 0.1 } } })
}

// ─── rows: the store's snapshots, as the bar store holds them (unix seconds) ──────────────────────────────────────
const ET_OPEN = (() => {
  // 09:30 ET as UTC seconds for a UTC midnight `day0` (EST or EDT, read off the platform's own zone data)
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return (day0) => (fmt.format(new Date((day0 + 14 * 3600 + 1800) * 1000)) === '09:30' ? day0 + 14 * 3600 + 1800 : day0 + 13 * 3600 + 1800)
})()

function rowBars(tf, n, seed) {
  const out = []
  const price = (i) => 40 + seed * 3 + Math.sin(i / (17 + seed)) * 6 + Math.cos(i / 91) * 9 + i * 0.002
  const push = (t, i) => {
    const c = price(i)
    out.push({ t, o: c - 0.3, h: c + 0.9 + (i % 5) * 0.1, l: c - 0.9 - (i % 3) * 0.1, c, v: 100_000 + ((i * 7919 + seed * 31) % 50_000) })
  }
  let day = Math.floor(Date.UTC(1990, 0, 1) / 1000)
  let i = 0
  while (out.length < n) {
    const wd = new Date(day * 1000).getUTCDay()
    if (wd !== 0 && wd !== 6) {
      if (tf === 'D') push(day, i++)
      else { const o = ET_OPEN(day); for (let h = 0; h < 7 && out.length < n; h++) push(o + h * 3600, i++) }
    }
    day += 86400
  }
  return out
}

const keyOf = (sym, tf) => chartKeyFor({ sym, resolvedTf: tf, showExtended: false, replayCutoff: null, hasOverride: false })

function recipesFor(tf, adjustTime) {
  const at = nf.identitySig(adjustTime)
  const intraday = tf !== 'D'
  const sessionP = { intradayLike: intraday, isIntraday: intraday, showExtended: false, tf }
  const closeP = { plain: true, mode: 'netchange', up: '#0f0', down: '#f00' }
  const volP = { blank: false, upC: '#1a1', downC: '#a11', netChange: true, dwm: !intraday, liveVol: NaN, bold: false }
  return {
    adjustTime,
    session: { p: sessionP, sig: nf.stableSig(sessionP) },
    heikinAshi: false, hvcOn: true,
    ohlc: { sunrise: false, sig: `plain|at${at}` },
    close: { p: closeP, sig: `${nf.stableSig(closeP)}|at${at}` },
    vol: { on: true, p: volP, sig: `${nf.stableSig(volP)}|at${at}` },
    volMa: { on: true, period: 20, sig: `p${nf.stableSig(20)}|at${at}` },
    plain: true,
  }
}

/** The server's envelope for one definition over one row (what `serverWarm` lands ahead of the scan). */
function primeServer(sym, tf, bars) {
  const times = bars.map((b) => sc.barTimeKey(b.t))
  for (const id of SERVER) {
    const def = nativeRegistry.getDefinition(id)
    const keys = new Set((def.plots || []).map((p) => p && p.key).filter(Boolean))
    for (const p of def.plots || []) {
      for (const v of Object.values(p || {})) if (typeof v === 'string' && v.startsWith('column:')) keys.add(v.slice(7))
    }
    // the production RS line envelope carries 24 columns (`alignColumns`' own note); the others a handful
    const want = id === 'rsLine' ? 24 : Math.max(keys.size, 6)
    for (let k = 0; keys.size < want; k++) keys.add(`extra${k}`)
    const columns = {}
    let j = 0
    for (const key of keys) { j += 1; columns[key] = bars.map((b, i) => 50 + Math.sin(i / (11 + j)) * 20) }
    sc.primeServerColumns(id, sym, tf, sc.pickServerInputs(def, nativeRegistry.resolveInputs(def, {})), {
      columns, times, rev: def.compute.rev,
    })
  }
}

// ─── a CPU profile of the syncs alone ─────────────────────────────────────────────────────────────────────────────
const session = new inspector.Session()
session.connect()
const post = (m, p = {}) => new Promise((res, rej) => session.post(m, p, (e, r) => (e ? rej(e) : res(r))))
const profAgg = () => ({ byFile: new Map(), bySelf: new Map(), total: 0 })
function addProfile(agg, profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  const self = new Map()
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i]
    self.set(id, (self.get(id) || 0) + (profile.timeDeltas[i] || 0) / 1000)
  }
  for (const [id, ms] of self) {
    const n = byId.get(id)
    const cf = n.callFrame
    const file = cf.url ? path.basename(cf.url.split('?')[0]) : `(${cf.functionName || 'native'})`
    if (file === '(idle)' || file === '(program)') continue
    agg.total += ms
    agg.byFile.set(file, (agg.byFile.get(file) || 0) + ms)
    const fk = `${cf.functionName || '(anon)'} ${file}:${cf.lineNumber + 1}`
    agg.bySelf.set(fk, (agg.bySelf.get(fk) || 0) + ms)
  }
}
const top = (m, k, per) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([name, ms]) => [name, +(ms / per).toFixed(3)])

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN }
const p90 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] : NaN }
const drain = (g) => { for (const _ of g) { /* each idle piece */ } }

/**
 * One chart scanning `rows` rows of `tf`: each switch prepared (prepareRow rank 0, as the next row ahead) or not.
 * @returns {{ms: {prepared: number[], cold: number[]}, computed: object, stats: object, profile: object}}
 */
async function scan({ tf, n, rows = 14, warmup = 4, profile = false, prepare = 'alternate' }) {
  snaps.clear()
  nf.__resetDerivedForTests()
  nf.__resetNeighborFramesStatsForTests()
  sc.clearServerColumns()
  const adjustTime = tf === 'D' ? (t) => t : (t) => (typeof t === 'number' ? toChartTime(t) : t)
  const R = recipesFor(tf, adjustTime)
  const syms = Array.from({ length: rows + warmup + 1 }, (_, i) => `S${String(i).padStart(3, '0')}`)
  syms.forEach((s, i) => {
    const key = keyOf(s, tf)
    const snap = Object.freeze({ key, tf, bars: rowBars(tf, n, i + 1), developing: null, baseRev: 1, status: 'current', restSeen: true })
    snaps.set(key, snap)
    primeServer(s, tf, legacyBars(snap))
  })

  const calls = []
  const registry = { ...nativeRegistry, computeFor: (def, ...r) => { calls.push(def.id); return nativeRegistry.computeFor(def, ...r) } }
  const el = document.createElement('div')
  document.body.appendChild(el)
  const chart = createWindowedChart(LWC.createChart(el, { width: 1200, height: 700 }), { disabled: () => false })
  const candles = chart.addSeries(LWC.CandlestickSeries, {})
  chart.window.setPrimary(candles)
  const binder = createBinder({ chart, LWC: ENGINE_LWC, scope: 'bench' })
  const engineRef = { current: { chart, binder } }
  const view = { tf, showExtended: false }
  const pctx = { recipes: () => R, view: () => view, engineRef }
  const instances = MIXED(tf)
  const resolvePlacement = placementFor(instances)
  const applyData = (series, data) => { if (series && data) series.setData(data) }

  /** The chart arriving at `sym`: candles first (the render window placed), then the binder, timed. */
  const arrive = async (sym, timed) => {
    const snap = snaps.get(keyOf(sym, tf))
    const filtered = deriveSession(legacyBars(snap), R)
    let span = 0
    try { const r0 = chart.timeScale().getVisibleLogicalRange(); if (r0 && r0.to > r0.from) span = r0.to - r0.from } catch { /* none yet */ }
    chart.window.setWindow(renderWindowRows(span, 0), { span })
    candles.setData(deriveOhlcBase(filtered, R).slice())
    const start = plotWindowStart(filtered.length, plotWindowRows(span, 0))
    const ctx = {
      enabled: true, registry, instances, bars: filtered, sym, tf, cs: null, adjustTime,
      plan: {}, applyData, resolvePlacement, deferSeriesData: true,
      newestBarIsForming: newestBarIsFormingOf(snap),
      plotWindowFrom: start > 0 ? adjustTime(filtered[start].t) : null,
      priceSeries: () => candles,
    }
    calls.length = 0
    const st0 = { ...nf.neighborFramesStats() }
    if (timed && profile) { await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 50 }); await post('Profiler.start') }
    const t0 = performance.now()
    binder.sync(ctx)
    const ms = performance.now() - t0
    let prof = null
    if (timed && profile) { prof = (await post('Profiler.stop')).profile }
    const st = nf.neighborFramesStats()
    const delta = {}
    for (const k of ['colsHit', 'colsMissed', 'pointsHit']) delta[k] = st[k] - st0[k]
    // let the library paint (rAF) and the facade's microtasks run between switches, as a member's frames do
    await new Promise((r) => setTimeout(r, 0))
    return { ms, calls: [...calls], delta, prof, filtered }
  }

  const out = { ms: { prepared: [], cold: [] }, computed: { prepared: {}, cold: {} }, stats: { prepared: [], cold: [] }, profile: { prepared: profAgg(), cold: profAgg() }, series: 0 }
  await arrive(syms[0], false)
  for (let i = 1; i < syms.length; i++) {
    const sym = syms[i]
    const prep = prepare === 'all' || (prepare === 'alternate' && i % 2 === 0)
    if (prep) drain(prepareRow(sym, 0, pctx))
    const r = await arrive(sym, i > warmup)
    if (i <= warmup) continue
    const lane = prep ? 'prepared' : 'cold'
    out.ms[lane].push(r.ms)
    out.stats[lane].push(r.delta)
    for (const id of r.calls) out.computed[lane][id] = (out.computed[lane][id] || 0) + 1
    if (r.prof) addProfile(out.profile[lane], r.prof)
  }
  out.series = binder.bindings().length
  binder.teardown()
  chart.remove()
  el.remove()
  return out
}

const RESULTS = {}
function report(label, r) {
  const lane = (k) => {
    const ms = r.ms[k]
    const runs = ms.length || 1
    return {
      switches: ms.length,
      medianMs: +median(ms).toFixed(2), p90Ms: +p90(ms).toFixed(2), allMs: ms.map((x) => +x.toFixed(2)),
      computedPerSwitch: Object.fromEntries(Object.entries(r.computed[k]).map(([id, c]) => [id, +(c / runs).toFixed(2)])),
      hits: r.stats[k],
      profileMsPerSwitch: +(r.profile[k].total / runs).toFixed(2),
      byFile: top(r.profile[k].byFile, 14, runs),
      topSelf: top(r.profile[k].bySelf, 30, runs),
    }
  }
  RESULTS[label] = { series: r.series, prepared: lane('prepared'), cold: lane('cold') }
  console.log(`[binder switch cost] ${label}: series=${r.series} prepared median ${RESULTS[label].prepared.medianMs} ms (p90 ${RESULTS[label].prepared.p90Ms}), cold median ${RESULTS[label].cold.medianMs} ms (p90 ${RESULTS[label].cold.p90Ms})`)
}

afterAll(() => {
  if (process.env.GITHUB_WORKFLOW !== 'remote tests') return
  const dir = path.resolve(process.cwd(), '..', 'remote-out')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'binder-switch-cost.json'), JSON.stringify(RESULTS, null, 1))
})

describe('a list flip on the mixed set', () => {
  it('daily, 12,000 rows: a prepared row computes nothing on the switch; an unprepared one computes every instance', async () => {
    const r = await scan({ tf: 'D', n: 12_000, profile: false })
    report('D12000', r)
    const instances = MIXED('D').length
    // every switch to a prepared row took every column set from the store
    for (const s of r.stats.prepared) expect(s.colsHit).toBe(instances)
    expect(r.computed.prepared).toEqual({})
    for (const s of r.stats.prepared) expect(s.pointsHit).toBeGreaterThan(0)
    // …and every switch to an unprepared one computed them all
    expect(Object.values(r.computed.cold).reduce((a, b) => a + b, 0)).toBe(instances * r.ms.cold.length)
  }, 240_000)

  it('daily, 12,000 rows: where a switch spends its time (CPU profile of the syncs alone)', async () => {
    report('D12000.profile', await scan({ tf: 'D', n: 12_000, profile: true, rows: 10 }))
  }, 240_000)

  it('60m, 30,000 rows: prepared and not, timed and profiled', async () => {
    const r = await scan({ tf: '60', n: 30_000, profile: false, rows: 10 })
    report('60m30000', r)
    const instances = MIXED('60').length
    for (const s of r.stats.prepared) expect(s.colsHit).toBe(instances)
    report('60m30000.profile', await scan({ tf: '60', n: 30_000, profile: true, rows: 8 }))
  }, 300_000)
})

