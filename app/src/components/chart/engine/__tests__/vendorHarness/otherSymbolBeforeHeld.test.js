// ─── ⭐⭐ (engine 94, coordinator ruling 2026-11-22) — A CHART BAR BEFORE ANOTHER SERIES' FIRST HELD ROW IS WITHHELD
//     BY NAME ON BOTH LANES, NEVER READ AS PINE'S `na` ────────────────────────────────────────────────────────────────
//
// Fred RS on an intraday chart reads SP:SPX at the chart's timeframe, laid out on the chart's grid
// (`otherSymbols.js::atOrBeforeGridOf`), whose first row is where OUR store's intraday history of the index begins (60 days
// of 5m), not the index's first bar: the series is marked `SERIES_UNKNOWN_BEFORE_FIRST`, and a chart bar before that row
// is UNKNOWN. ⚰️ MEASURED ON THE WIRE (the 2026-11-21 capture `rs-rating-fred6724-intra-spy-5-2026-11-21`, the harness's
// real host door, a probe at `symAlignmentMask`'s entry): the series reached the mask WITH its mark on every call, and the
// mask blanked all 9,203 bars before our first SPX 5m row; but the host lane named none of them on the per-bar channel
// (`__withheldBars`), so the vendor harness graded each one `na` against TradingView's value (9,203 `na` mismatches, 0
// withheld). Nothing copied the series and dropped the mark: the withholding was simply never named.
// Now `withSymAlignment` names them per bar (`other-symbol:before-held`, with the bars within the tree's reach of one),
// through the host worker's `postMessage` too, and the member reads why on the strip. The runtime lane already withheld
// them (the supply's DEPTH, `knownFrom`, folded into the run's warm-up record) and is held to it here.
// ⛔ CONTROLS: a series WITHOUT the mark reads the bars before its first row as `na` (its history had not begun), named
// nothing; a seed whose gaps read `na` (`SERIES_GAPS_READ_NA`) still reads `na`, named nothing; a hole AFTER the first
// row stays an unnamed withholding (the broad unit, later), never this code.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as registry from '../../nativeRegistry'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { atOrBeforeGridOf } from '../../otherSymbols'
import { interpret, symAlignmentMask, OTHER_SYMBOL_BEFORE_HELD_CODE, SERIES_UNKNOWN_BEFORE_FIRST, SERIES_GAPS_READ_NA }
  from '../../ast/interpret'
import { setHostLaneWorkerFactory, resetHostLaneAsync, __routeEveryHostDocumentForTests, isHostLanePending }
  from '../../hostLaneAsync'
import { standInWorkers } from '../hostLaneStandIn'
import { computeHeadless } from '../../headlessCompute'
import { runtimeColumnsFor, computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, RUNTIME_KNOWN_FROM_KEY }
  from '../../runtime/runtimeColumns'
import { runtimeWarmupOf } from '../../runtime/runtimeObjects'
import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from '../../runtimeKill'
import { setRequestWitnessRows } from '../../otherSymbols'
import { clearSecondaryBars } from '../../secondaryBars'
import { comparePlot, plotVerdict, tolerancePolicy } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { withheldBarsOf } from './ourSide'
import CODES from '../../../supportLoop/refusalCodes.json'

vi.setConfig({ testTimeout: 120000 })

// EST (UTC-5): 09:30 ET = 14:30Z. Day 1 Monday 2026-11-16, day 2 Tuesday 2026-11-17 (`rsIntradayWitness.test.js`'s shape).
const ET = (day, hh, mm) => {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000
}
const D1 = '2026-11-16'
const D2 = '2026-11-17'
const FIVE = 300
const spxClose = (i) => Math.round((7300 + 10 * Math.sin(i / 7)) * 100) / 100
const rthTimes = (day, step) => Array.from({ length: 390 / step }, (_, k) => ET(day, 9, 30) + k * step * 60)
// our store holds only DAY 2's 5m bars of the index (its depth); the chart holds day 1 too
const SPX_5 = rthTimes(D2, 5).map((t, i) => ({ t, o: spxClose(i) - 1, h: spxClose(i) + 2, l: spxClose(i) - 2, c: spxClose(i), v: 1e6 }))
const utcMid = (day) => Date.parse(`${day}T00:00:00Z`) / 1000
const SPX_D = [{ t: utcMid('2026-11-13'), o: 1, h: 1, l: 1, c: 7561.67, v: 1 }, { t: utcMid(D1), o: 1, h: 1, l: 1, c: 7416.59, v: 1 },
  { t: utcMid(D2), o: 1, h: 1, l: 1, c: 7340.53, v: 1 }]
const PRE = Array.from({ length: 18 }, (_, k) => ET(D2, 8, 0) + k * FIVE)
const POST = Array.from({ length: 12 }, (_, k) => ET(D2, 16, 0) + k * FIVE)
const CHART_T = [...rthTimes(D1, 5), ...PRE, ...rthTimes(D2, 5), ...POST]
const CHART = CHART_T.map((t, i) => ({ t, o: 50 + i * 0.01, h: 50.5 + i * 0.01, l: 49.5 + i * 0.01, c: 50 + i * 0.01, v: 1000 }))
const BEFORE = rthTimes(D1, 5).length        // the chart bars before our first SPX row: day 1's 78
const FIRST_ROW_DAY = D2                     // the grid's first row: day 2's pre-market (the previous close)

const secondaryOf = (intraday = SPX_5) => new Map([
  ['SPX', { bars: intraday, status: 'available' }],
  ['SPX@D', { bars: SPX_D, status: 'available', newestBarIsForming: false }]])
const ctx5 = (over = {}) => ({
  tf: '5', newestBarIsForming: false, historyFromListing: false,
  symbol: { ticker: 'AGL', exchange: 'NYSE', securityType: 'stock' },
  secondary: secondaryOf(), exchangeOf: (t) => (t === 'SPX' ? 'SP' : null), ...over,
})
const pine = (lines) => ['//@version=5', 'indicator("before-held", overlay = false)', ...lines].join('\n')
const READ = 'request.security("SP:SPX", timeframe.period, close)'
const runDef = (source, keys) => ({
  id: 'u_bh-run', compute: { kind: 'runtime', fn: 'runtime:u_bh-run', rev: 1, source, objects: true,
    outputs: Object.fromEntries(keys.map((k, i) => [k, i])) },
  inputs: [], meta: { runtimeHistory: 'listing' },
})
const symTree = { type: 'sym', value: 'SPX', args: [{ type: 'series', name: 'close' }] }
const TOL = tolerancePolicy({ symbol: { pricescale: 100 } })
const verdictOf = (r) => plotVerdict(r, { colorMeasured: false, colorResolvable: false })
const named = (mask) => (mask ? [...mask].map((x, i) => (x ? i : -1)).filter((i) => i >= 0) : [])
const upTo = (k) => Array.from({ length: k }, (_, i) => i)

let installed = []
function hostDoc(source, id) {
  const d = memberPaneDefinition({ source, id, name: id })
  expect(d.ok, d.reason).toBe(true)
  expect(d.definition.compute.kind, 'a host document').toBe('ast')
  const { installed: got, errors } = registry.installUserDefinitions([d.definition])
  expect(got.length, errors.join(' | ')).toBe(1)
  installed.push(got[0].id)
  return got[0]
}
const onlyKey = (cols) => Object.keys(cols)[0]
const beforeHeldOf = (cols) => {
  const report = registry.withheldBarsReport(cols)
  return report && report[onlyKey(cols)] ? report[onlyKey(cols)][OTHER_SYMBOL_BEFORE_HELD_CODE] : undefined
}

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
  resetHostLaneAsync()
})
afterEach(() => {
  for (const id of installed) registry.uninstallUserDefinition(id)
  installed = []
  __routeEveryHostDocumentForTests(false)
  setHostLaneWorkerFactory(null)
  resetHostLaneAsync()
  setRequestWitnessRows(null)
  resetRuntimeSessions()
  resetRuntimeLedgers()
  clearSecondaryBars()
  vi.unstubAllEnvs()
})

describe('⭐⭐ the host lane names the bars before another series\' first held row, per bar', () => {
  it('main thread: exactly the bars before our first SPX row are named, each blank, and graded "not compared"', () => {
    const def = hostDoc(pine([`plot(${READ}, "spx")`]), 'u_bh-main')
    const cols = registry.computeFor(def, CHART, {}, ctx5())
    const col = Array.from(cols[onlyKey(cols)])
    const mask = beforeHeldOf(cols)
    expect(mask, `${OTHER_SYMBOL_BEFORE_HELD_CODE} on the per-bar channel`).toBeTruthy()
    expect(named(mask)).toEqual(upTo(BEFORE))
    // the channel never names a drawn bar
    for (const i of named(mask)) expect(Number.isFinite(col[i]), `bar ${i}`).toBe(false)
    expect(Number.isFinite(col[BEFORE]), 'the first bar our rows answer is drawn').toBe(true)
    // TradingView holds those bars and draws a value there (its history of the index is older than ours)
    const vendor = col.map((v, i) => (i < BEFORE ? 7400 + i / 100 : v))
    const times = CHART.map((b) => b.t)
    const held = withheldBarsOf(registry.withheldBarsReport(cols), onlyKey(cols), 0)
    expect(held.codes).toEqual([OTHER_SYMBOL_BEFORE_HELD_CODE])
    const r = comparePlot({ times, vendor, ours: col, tol: TOL, withheldBars: held.bars })
    expect(r.steady.divergent, verdictOf(r).reason).toBe(0)
    expect(r.withheldVendorValued).toBe(BEFORE)
    expect(verdictOf(r).verdict).not.toBe('DIVERGE')
    // ...and without the channel the same column grades DIVERGE (`na` against a value): what changes is the grade
    expect(verdictOf(comparePlot({ times, vendor, ours: col, tol: TOL })).verdict).toBe('DIVERGE')
  })

  it('a read inside a window: the bars within the tree\'s reach of one are named too', () => {
    const def = hostDoc(pine([`plot(ta.sma(${READ}, 3), "avg")`]), 'u_bh-reach')
    const cols = registry.computeFor(def, CHART, {}, ctx5())
    const col = Array.from(cols[onlyKey(cols)])
    const got = named(beforeHeldOf(cols))
    // past the first row by the tree's reach (`maxLookback`, as the mask spreads it), and nothing else
    expect(got.length).toBeGreaterThan(BEFORE)
    expect(got.length).toBeLessThanOrEqual(BEFORE + 3)
    expect(got).toEqual(upTo(got.length))
    for (const i of got) expect(Number.isFinite(col[i]), `bar ${i} is withheld`).toBe(false)
    expect(Number.isFinite(col[got.length]), 'the first bar whose window our rows answer is drawn').toBe(true)
  })

  it('the member reads why on the strip, once, in plain words with the date our history starts', () => {
    const def = hostDoc(pine([`plot(${READ}, "spx")`]), 'u_bh-words')
    const cols = registry.computeFor(def, CHART, {}, ctx5())
    const notes = registry.externalReadNotices(def, cols).filter((n) => n.code === OTHER_SYMBOL_BEFORE_HELD_CODE)
    expect(notes).toHaveLength(1)
    expect(notes[0].reason).toContain(`Not drawn before ${FIRST_ROW_DAY}`)
    expect(notes[0].reason).toContain('UCT\'s intraday history of `SPX` starts there')
    expect(CODES.codes, 'a registered refusal code').toContain(OTHER_SYMBOL_BEFORE_HELD_CODE)
  })

  it('through the host worker (`postMessage`, both ways): the same bars named, and the same words', () => {
    const def = hostDoc(pine([`plot(${READ}, "spx")`]), 'u_bh-wire')
    const main = registry.computeFor(def, CHART, {}, ctx5())
    resetHostLaneAsync()
    const workers = standInWorkers()
    setHostLaneWorkerFactory(workers.factory)
    __routeEveryHostDocumentForTests(true)
    const ctx = ctx5({ hostPane: 'before-held\u0001wire' })
    const first = registry.computeFor(def, CHART, {}, ctx)
    expect(isHostLanePending(first), 'the document went to the worker').toBe(true)
    expect(workers.drain()).toBeGreaterThan(0)
    const viaWorker = registry.computeFor(def, CHART, {}, ctx)
    expect(isHostLanePending(viaWorker)).toBe(false)
    expect(named(beforeHeldOf(viaWorker))).toEqual(named(beforeHeldOf(main)))
    expect(named(beforeHeldOf(viaWorker))).toEqual(upTo(BEFORE))
    expect(registry.externalReadNotices(def, viaWorker)).toEqual(registry.externalReadNotices(def, main))
    expect(registry.externalReadNotices(def, viaWorker).map((n) => n.code)).toContain(OTHER_SYMBOL_BEFORE_HELD_CODE)
  })

  it('the headless lane reports them per output, by the code, and computes every other bar', () => {
    const def = hostDoc(pine([`plot(${READ}, "spx")`]), 'u_bh-headless')
    // the headless door's own supply: the rows by the keys the chart fetches (`headlessCompute.supplyOf`)
    const r = computeHeadless(def, CHART, { tf: '5', symbol: ctx5().symbol, historyFromListing: false,
      newestBarIsForming: false, otherBars: { SPX: SPX_5, 'SPX@D': SPX_D } })
    expect(r.refusal, JSON.stringify(r.refusal)).toBeUndefined()
    const out = r.outputs[0]
    expect(out.withheld).toContainEqual({ code: OTHER_SYMBOL_BEFORE_HELD_CODE, bars: BEFORE })
    expect(Number.isFinite(out.values[BEFORE])).toBe(true)
  })
})

describe('the runtime lane withholds the same bars (the supply\'s depth, in the run\'s warm-up record)', () => {
  it('the run starts at our first row; every bar before it is blank and counted withheld', () => {
    const cols = computeRuntimeColumns(runDef(pine([`plot(${READ})`]), ['x']), CHART, ctx5(), { now: () => 0 })
    expect(cols[RUNTIME_KNOWN_FROM_KEY]).toMatchObject({ knownFrom: BEFORE })
    const warm = runtimeWarmupOf(cols)
    expect(warm && warm.withheldBars).toBeGreaterThanOrEqual(BEFORE)
    for (let i = 0; i < BEFORE; i += 1) expect(Number.isNaN(cols.x[i]), `bar ${i}`).toBe(true)
  })
})

describe('⛔ CONTROLS: only a series marked as our depth is named, and only before its first row', () => {
  const grid = () => atOrBeforeGridOf(SPX_5, SPX_D, '5')
  const run = (series) => {
    const sink = new Map()
    const col = interpret(symTree, CHART, {}, undefined, undefined, { symbols: { SPX: series }, withheldBarsSink: sink })
    return { col: Array.from(col), named: named(sink.get(OTHER_SYMBOL_BEFORE_HELD_CODE)) }
  }

  it('the marked grid: named before its first row (the rule the controls are read against)', () => {
    expect(grid()[SERIES_UNKNOWN_BEFORE_FIRST]).toBe(true)
    expect(run(grid()).named).toEqual(upTo(BEFORE))
  })

  it('the same rows WITHOUT the mark: the bars before them read `na` (history not begun), withheld and named nothing', () => {
    const plain = grid().slice()
    expect(plain[SERIES_UNKNOWN_BEFORE_FIRST]).toBeUndefined()
    const { col, named: got } = run(plain)
    expect(got).toEqual([])
    expect(symAlignmentMask(symTree, CHART, { symbols: { SPX: plain } })).toBe(null)
    for (let i = 0; i < BEFORE; i += 1) expect(Number.isNaN(col[i])).toBe(true)
  })

  it('a seed whose gaps read `na` (SERIES_GAPS_READ_NA) still reads `na`: nothing withheld, nothing named', () => {
    const seed = grid().slice()
    Object.defineProperty(seed, SERIES_GAPS_READ_NA, { value: true, enumerable: false })
    Object.defineProperty(seed, SERIES_UNKNOWN_BEFORE_FIRST, { value: true, enumerable: false })
    expect(run(seed).named).toEqual([])
    expect(symAlignmentMask(symTree, CHART, { symbols: { SPX: seed } })).toBe(null)
  })

  it('a hole AFTER the first row is withheld but never named by this code (the broad unit is later)', () => {
    // (the grid carries an index bar forward inside its session, so the hole is cut from the grid itself)
    const holeAt = CHART_T.indexOf(rthTimes(D2, 5)[10])
    const g = grid().filter((b) => b.t !== CHART_T[holeAt])
    Object.defineProperty(g, SERIES_UNKNOWN_BEFORE_FIRST, { value: true, enumerable: false })
    const mask = symAlignmentMask(symTree, CHART, { symbols: { SPX: g } })
    expect(mask[holeAt], 'the hole is withheld').toBe(1)
    expect(run(g).named).toEqual(upTo(BEFORE))
  })
})
