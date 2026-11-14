// app/src/components/chart/engine/ast/engine56Values.test.js
//
// ─── ⭐⭐ ENGINE 56 — WRONG VALUES FOUND BY FRESH TRADINGVIEW CAPTURES (2026-11-14) ──────────
//
// Every number pinned below is read off a TradingView capture of NYSE:RDDT 1D taken from the
// listing (the S3/S5 capture sessions, 2026-11-14). Those captures are licence-held and stay
// out of git; their BARS are the same 666 RDDT sessions as the committed
// `support-and-resistance-5f95e90f-rddt-1d-2026-11-13` fixture (checked bar for bar), so the
// scripts below — written here, in this file's own words, from each indicator's public
// definition — run on committed bars and are graded against the vendor's numbers.
//
//   A1  a v1/v2 self-declaration keeps `nz(x[k], S)` (and a `na(x[k]) ? S :` test) in the
//       step the accumulator runs: an update that answers `na` re-seeds, as Pine does.
//   A2  `percentrank`: an `na` PRIOR value counts as "not <=" (divisor `length`).
//   A3  Pine v1-v5: a comparison with `na` is an `na` bool; `na == true/false` is false
//       (served); the unwitnessed forms are withheld by name on the bars they meet `na`.
//   S4-1 `pivothigh` / `pivotlow` ignore an `na` on the LEFT side.
//   S4-2 `highestbars` / `lowestbars`: over a bar price the NEWEST tied bar wins; over a
//       computed source a tied window is withheld by name.
// The four doors (screen, pane strict, `buildRuntimeIr`, `memberPaneDefinition`) and both
// lanes (host, runtime) are asked of each new withholding below.
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { interpret, FN, BOOL_NA_UNWITNESSED, TIE_UNWITNESSED, CHART_CLOCK_WITHHELD, isBarPriceTree, CARRIED } from './interpret.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import * as registry from '../nativeRegistry'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtime/runtimeColumns.js'

const REPO = path.resolve(process.cwd(), '..')
const RDDT_FIXTURE = path.join(REPO, 'tests/fixtures/vendor/harness/support-and-resistance-5f95e90f-rddt-1d-2026-11-13.json')
const RDDT = JSON.parse(fs.readFileSync(RDDT_FIXTURE, 'utf8')).bars.rows
  .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const LISTING = { historyFromListing: true }
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true }

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

/** The host lane's column for output `k`, as the chart computes it from the listing. */
function hostColumn(src, k = 0, bars = RDDT) {
  const t = translatePine(src, { strict: true, basePeriod: 'D' })
  expect(t.ok, JSON.stringify(t.refusal || (t.outputs || []).map((o) => o.refusal))).toBe(true)
  const outs = t.outputs.filter((o) => o.kind !== 'alertcondition')
  const clock = new Map()
  const held = new Map()
  const col = interpret(outs[k].ast, bars, undefined, undefined, undefined,
    { ...LISTING, tf: 'D', chartClockSink: clock, withheldBarsSink: held })
  return { col: Array.from(col), clock, held, formula: outs[k].formula }
}
const runtimeDoc = (src, outputs = { a: 0 }) => ({
  id: 'e56', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:e56', outputs, source: src },
})
const runtimeRun = (src, bars = RDDT) => {
  try { return { col: Array.from(computeRuntimeColumns(runtimeDoc(src), bars, CTX).a) } } catch (e) { return { err: e } }
}
const near = (a, b, rel = 1e-9) => a !== null && Number.isFinite(a) && Math.abs(a - b) <= rel * Math.max(1, Math.abs(b))

describe('the committed bars are the captures\' bars', () => {
  it('666 RDDT sessions from the listing, the held captures\' first and tie bars', () => {
    expect(RDDT.length).toBe(666)
    expect(RDDT[0]).toEqual({ t: 1711027800, o: 47, h: 57.8, l: 45.05, c: 50.44, v: 48705533 })
    // the S4-2 witness: bars 112 and 116 hold the same high (60.41)
    expect(RDDT[112].h).toBe(60.41)
    expect(RDDT[116].h).toBe(60.41)
  })
})

describe('A1 — a v1 self-declaration keeps `nz(x[1], 0)` in its step (average-true-range trailing stop)', () => {
  // TradingView, bars 0..11 (`average-true-range-trailing-stops-strategy-by-sylvain-vervoort`)
  const VENDOR = [null, null, null, null, 16.49207, 16.49207, 16.49207, 17.547739840000006, 17.547739840000006,
    19.7652094976, 24.221167598080005, 24.581004078463998]
  const SRC = [
    'study("e56 trailing stop", overlay=true)',
    'gap = 3.5 * atr(5)',
    'stop = close > nz(stop[1], 0) and close[1] > nz(stop[1], 0) ? max(nz(stop[1]), close - gap) : close < nz(stop[1], 0) and close[1] < nz(stop[1], 0) ? min(nz(stop[1]), close + gap) : close > nz(stop[1], 0) ? close - gap : close + gap',
    'plot(stop)',
  ].join('\n')
  it('bars 4..11 are TradingView\'s (the stripped step drew 99.01 on bar 4)', () => {
    const { col } = hostColumn(SRC)
    for (let i = 4; i < VENDOR.length; i++) expect(near(col[i], VENDOR[i]), `bar ${i}: ${col[i]} vs ${VENDOR[i]}`).toBe(true)
  })
  it('the v2 spelling is the same column', () => {
    const v1 = hostColumn(SRC).col
    const v2 = hostColumn(`//@version=2\n${SRC}`).col
    for (let i = 4; i < 200; i++) expect(v2[i]).toBe(v1[i])
  })
  it('the ternary seed re-seeds after an `na` update: `x = na(x[1]) ? 0 : (close > open ? x[1] + 1 : sma(close, 20) - sma(close, 20))`', () => {
    const src = 'study("e56 ternary")\nx = na(x[1]) ? 0 : (close > open ? x[1] + 1 : sma(close, 20) - sma(close, 20))\nplot(x)'
    const { col } = hostColumn(src)
    // Pine, bar by bar: a down bar during the `sma` warm-up (bars 0..18) makes `x` `na`, and the
    // next bar's `na(x[1])` takes the seed arm (0). The stripped step carried that `na` forever:
    // the engine-55 column is `na` on every bar from the first such down bar.
    let prev = null
    let bad = 0
    for (let i = 0; i < 120; i++) {
      const b = RDDT[i]
      const sm = i >= 19 ? 0 : NaN
      const x = (prev === null || Number.isNaN(prev)) ? 0 : (b.c > b.o ? prev + 1 : sm)
      prev = i === 0 ? 0 : x
      const want = i === 0 ? 0 : x
      // bar 0 is the listing pass's (W34-I4b): drawn when both first-bar readings agree, else withheld
      if (i > 0 && !(Object.is(col[i], want) || (Number.isNaN(col[i]) && Number.isNaN(want)))) bad += 1
    }
    expect(bad).toBe(0)
    expect(col.slice(0, 40).some((v) => Number.isNaN(v))).toBe(true) // the `na` bars are real
    expect(Number.isFinite(col[60])).toBe(true)                       // ... and the series re-seeds
  })
  it('control: an update that never answers `na` is the column it was (`x = close > nz(x[1], 0) ? close : nz(x[1], 0)`)', () => {
    const { col } = hostColumn('study("e56 hold")\nx = close > nz(x[1], 0) ? close : nz(x[1], 0)\nplot(x)')
    let m = 0
    // (the first bars are the listing pass's, as above: drawn where its first-bar readings agree)
    let drawn = 0
    for (let i = 0; i < 200; i++) {
      m = Math.max(m, RDDT[i].c)
      if (Number.isFinite(col[i])) { drawn += 1; expect(col[i]).toBe(m) }
    }
    expect(drawn).toBeGreaterThan(180)
  })
})

describe('A2 — percentrank counts an `na` prior as "not <=" (connors-rsi, v6)', () => {
  // TradingView, CRSI bars 98..102 (the builtin `connors-rsi`): na until bar 100
  const VENDOR = [null, null, 68.6058732213702, 73.8326746093395, 41.05454228993245]
  // Connors RSI, from its published definition: the mean of RSI(3), RSI(2) of the up/down
  // streak, and the 100-bar percent rank of the one-bar rate of change.
  const SRC = [
    '//@version=6',
    'indicator("e56 crsi")',
    'streakOf(x) =>',
    '    float run = 0.0',
    '    run := x > x[1] ? (nz(run[1]) <= 0 ? 1 : nz(run[1]) + 1) : x < x[1] ? (nz(run[1]) >= 0 ? -1 : nz(run[1]) - 1) : 0',
    '    run',
    'plot((ta.rsi(close, 3) + ta.rsi(streakOf(close), 2) + ta.percentrank(ta.roc(close, 1), 100)) / 3)',
  ].join('\n')
  it('bar 100 is 68.6058732213702 (this engine answered `na` until bar 101, the `na` roc of bar 0 in its window)', () => {
    const { col } = hostColumn(SRC)
    for (let k = 0; k < VENDOR.length; k++) {
      const i = 98 + k
      if (VENDOR[k] === null) expect(Number.isNaN(col[i]), `bar ${i}`).toBe(true)
      else expect(near(col[i], VENDOR[k]), `bar ${i}: ${col[i]} vs ${VENDOR[k]}`).toBe(true)
    }
  })
  it('synthetic: [na x 3, values] — an na prior is skipped and the divisor stays `length`', () => {
    const s = Float64Array.from([NaN, NaN, NaN, 5, 1, 2, 9, 3])
    const out = FN.percentrank(s, 4)
    expect(Number.isNaN(out[3])).toBe(true) // bar < length
    expect(out[4]).toBe(0)                  // priors na, na, na, 5: none <= 1
    expect(out[5]).toBe(25)                 // na, na, 5, 1: one <= 2
    expect(out[6]).toBe(75)                 // na, 5, 1, 2: three <= 9
    expect(out[7]).toBe(50)                 // 5, 1, 2, 9: two <= 3
    expect(Number.isNaN(FN.percentrank(Float64Array.from([1, 2, 3, NaN, 4]), 3)[3])).toBe(true) // current na
  })
  it('the runtime lane draws the same column (its percentrank is the columnar one)', () => {
    const rt = runtimeRun(SRC)
    if (rt.err) return expect(String(rt.err.message)).toMatch(/./) // a wall of its own is not a value
    const { col } = hostColumn(SRC)
    for (let i = 100; i < 140; i++) expect(near(rt.col[i], col[i])).toBe(true)
  })
})

describe('A3 — a Pine v1-v5 `bool` can be `na`, and `== true/false` reads it as false (accumulation/distribution markers, v1)', () => {
  const SRC = [
    'study("e56 ad markers")',
    'acc = cum(((close - low) - (high - close)) / (high - low) * volume)',
    'fast = sma(acc, 9)',
    'slow = sma(acc, 15)',
    'below = fast < slow',
    'plot(fast - slow)',
    'plot(below == true and below[1] == false ? fast - slow : na)',
  ].join('\n')
  it('bar 14 is `na` (TradingView; this engine drew -11152358.65), bar 31 is -84920.78585333377', () => {
    const diff = hostColumn(SRC, 0).col
    const marker = hostColumn(SRC, 1)
    expect(near(diff[14], -11152358.647627905)).toBe(true)
    expect(Number.isNaN(marker.col[14])).toBe(true)
    expect(near(marker.col[31], -84920.78585333377)).toBe(true)
    // the witnessed form is SERVED: nothing withheld
    expect(marker.held.size).toBe(0)
    expect(marker.formula).not.toMatch(/boolNaWithheld/)
  })
  it('v6 keeps the shared rule: bar 14 draws the marker there (a v6 bool is never `na`)', () => {
    const v6 = SRC.replace('study(', '//@version=6\nindicator(').replace(/cum\(/g, 'ta.cum(').replace(/sma\(/g, 'ta.sma(')
    const marker = hostColumn(v6, 1)
    expect(near(marker.col[14], -11152358.647627905)).toBe(true)
  })
})

// ─── the synthetic forms: which bars are served, which are withheld, at every door ──────────
const N = 40
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 4 * Math.sin(i / 3) + i / 10
  return { t: 1700000000 + i * 86400, o: c - 0.4, h: c + 1, l: c - 1, c, v: 1000 + i }
})
const head = (v) => (v === null ? ['study("e56 forms")']
  : [`//@version=${v}`, v >= 5 ? 'indicator("e56 forms")' : 'study("e56 forms")'])
const sma = (v) => (v !== null && v >= 5 ? 'ta.sma' : 'sma')
const form = (v, expr) => [...head(v), `c = close > ${sma(v)}(close, 5)`, `plot(${expr} ? 1 : 2)`].join('\n')
/** guard per door: screen / pane (strict) / runtime (buildRuntimeIr over bars) / member door */
function doors(src) {
  const g = (t) => (t.ok ? 'OK' : (t.refusal || ((t.outputs || []).find((o) => o && o.refusal) || {}).refusal || { guard: '?' }).guard)
  const rt = buildRuntimeIr(src, { bars: BARS, inputs: {}, pane: true, historyFromListing: true })
  const d = memberPaneDefinition({ source: src, id: 'u_e56', name: 'e56' })
  return [g(translatePine(src)), g(translatePine(src, { strict: true })), rt.ok ? 'OK' : rt.refusal.guard, d.ok ? 'OK' : d.guard]
}
/** the member door's served column and the bars it withheld by name */
function doorColumn(src) {
  const d = memberPaneDefinition({ source: src, id: 'u_e56', name: 'e56' })
  expect(d.ok).toBe(true)
  const cols = registry.computeFor(d.definition, BARS, undefined, CTX)
  const key = Object.keys(cols)[0]
  const report = registry.withheldBarsReport(cols)
  return { col: Array.from(cols[key]), held: report && report[key] ? Object.keys(report[key]) : [],
    mask: report && report[key] ? Array.from(Object.values(report[key])[0]) : null,
    clock: (registry.chartClockReport(cols) || { withheld: [] }).withheld.map((r) => r.code) }
}
const WARM = [0, 1, 2, 3] // `sma(close, 5)` is `na` on bars 0..3

describe('A3 — the forms, version by version', () => {
  it.each([null, 1, 2, 3, 4, 5])('v%s: `c == false` is SERVED as false on the warm-up bars (witnessed)', (v) => {
    const src = form(v === 1 ? null : v, 'c == false').replace('//@version=1\n', '')
    const { col, held } = doorColumn(src)
    for (const i of WARM) expect(col[i], `bar ${i}`).toBe(2)
    expect(held).toEqual([])
    expect(doors(src)).toEqual(['OK', 'OK', 'OK', 'OK'])
  })
  it('v6: `c == false` reads the cast `false` (1 on the warm-up bars) — unchanged', () => {
    const { col, held } = doorColumn(form(6, 'c == false'))
    for (const i of WARM) expect(col[i]).toBe(1)
    expect(held).toEqual([])
  })
  const WITHHELD = [
    [5, 'c != false'], [4, 'c != true'], [2, 'c != false'],
    [5, 'c == c[1]'],
    [2, 'not c'], [null, 'not c'], [3, '(c or close > 0)'],
    [1, '(c and close > 0) == false'],
  ]
  it.each(WITHHELD)('v%s: `%s` is WITHHELD by name on the warm-up bars, drawn after', (v, expr) => {
    const src = form(v === 1 ? null : v, expr)
    const { col, held, clock, mask } = doorColumn(src)
    for (const i of WARM) expect(Number.isNaN(col[i]), `bar ${i}`).toBe(true)
    for (let i = 6; i < N; i++) expect(Number.isFinite(col[i]), `bar ${i}`).toBe(true)
    expect(held).toEqual([BOOL_NA_UNWITNESSED])
    expect(clock).toContain(BOOL_NA_UNWITNESSED)
    expect(mask.slice(0, 4)).toEqual([1, 1, 1, 1])
    // the four doors agree: the host doors translate (withholding is per bar), and the runtime
    // lane, which has no per-bar withholding, declines the run by the SAME code
    const [screen, pane, runtime, door] = doors(src)
    expect([screen, pane, door]).toEqual(['OK', 'OK', 'OK'])
    expect(runtime).toBe(BOOL_NA_UNWITNESSED)
    expect(translatePine(src).outputs[0].formula).toMatch(/boolNaWithheld/)
  })
  const SERVED = [
    [4, 'not c'], [5, '(c or close > 0)'], [5, 'not c'],
    [1, '(c and close > 0)'], [6, 'c != false'], [6, 'not c'],
  ]
  it.each(SERVED)('v%s: `%s` is served on every bar (witnessed, or a condition reads both readings alike)', (v, expr) => {
    const src = form(v === 1 ? null : v, expr)
    const { col, held } = doorColumn(src)
    for (let i = 0; i < N; i++) expect(Number.isFinite(col[i]), `bar ${i}`).toBe(true)
    expect(held).toEqual([])
    expect(doors(src)).toEqual(['OK', 'OK', 'OK', 'OK'])
    // both lanes draw the same column
    const rt = runtimeRun(src, BARS)
    expect(rt.err).toBeUndefined()
    expect(rt.col).toEqual(col)
  })
  it('the sentence the member reads names the forms and what would settle them', () => {
    const s = CHART_CLOCK_WITHHELD[BOOL_NA_UNWITNESSED]('D')
    expect(s).toMatch(/`!=`/)
    expect(s).toMatch(/withheld rather than guessed/)
  })
})

describe('S4-1 — pivots ignore an `na` on the LEFT side', () => {
  it('synthetic: a pivot whose left span holds an `na` is found; a right-side `na` still blanks', () => {
    const s = Float64Array.from([NaN, NaN, 3, 9, 2, 1, NaN, 8, 4, 5])
    const hi = FN.pivothigh(s, 3, 2)
    expect(hi[3]).toBe(9) // left = na, na, 3: the two na are skipped
    expect(hi[7]).toBe(8) // left = 2, 1, na: skipped; right = 4, 5
    const lo = FN.pivotlow(Float64Array.from([NaN, 5, 4, 1, 3, 6, NaN, 0]), 2, 2)
    expect(lo[3]).toBe(1)
    expect(Number.isNaN(FN.pivothigh(Float64Array.from([1, 2, 9, NaN, 3]), 1, 2)[2])).toBe(true) // right na
    expect(Number.isNaN(FN.pivothigh(Float64Array.from([9, 1, 1]), 1, 1)[0])).toBe(true) // bar < left
  })
  it('the runtime kernel (`pivotHighPine`) answers the same at the confirmation bar', () => {
    const k = CARRIED.pivotHighPine
    const left = 3
    const right = 2
    const n = left + right + 1
    const st = new Float64Array(k.cells(n))
    k.init(st, 0, n)
    const s = [NaN, NaN, 3, 9, 2, 1, NaN, 8, 4, 5]
    const out = s.map((v) => k.step(st, 0, v, n, 0, right))
    expect(out[5]).toBe(9) // the pivot of bar 3, confirmed 2 bars later
    expect(out[9]).toBe(8) // the pivot of bar 7
  })
  it('v4 `pivothigh(close - sma(close, 10), 10, 2)` on RDDT: the pivots of bars 10 and 14 (left spans in the warm-up)', () => {
    const { col } = hostColumn('//@version=4\nstudy("e56 piv")\nplot(pivothigh(close - sma(close, 10), 10, 2))')
    const dev = (i) => RDDT[i].c - RDDT.slice(i - 9, i + 1).reduce((a, b) => a + b.c, 0) / 10
    // answered on the confirmation bar, 2 bars after the pivot
    expect(col[12]).toBeCloseTo(dev(10), 9)
    expect(col[16]).toBeCloseTo(dev(14), 9)
    for (let i = 0; i < 12; i++) expect(Number.isNaN(col[i])).toBe(true)
  })
  it('rsi-divergence (builtin, v6, S6): a pivot whose WHOLE left window is `na` counts (bars 19 and 23)', () => {
    // TradingView (`rsi-divergence-indicator`, NYSE:RDDT 1D from the listing, S6 2026-11-14): the four
    // marker columns (Regular / Hidden Bullish, Regular / Hidden Bearish) read the pivot of the RSI, 5
    // bars each side, on its confirmation bar. Bar 19 carries the pivot HIGH of bar 14, whose left
    // window (bars 9..13) is all RSI warm-up `na`; bar 23 the pivot LOW of bar 18. Only a window that
    // reaches before bar 0 is withheld: an all-`na` left window is not.
    const src = ['//@version=6', 'indicator("e56 rsi pivots")', 'osc = ta.rsi(close, 14)',
      'plot(ta.pivothigh(osc, 5, 5))', 'plot(ta.pivotlow(osc, 5, 5))'].join('\n')
    const hi = hostColumn(src, 0).col
    const lo = hostColumn(src, 1).col
    expect(near(hi[19], 45.19746465138957)).toBe(true)
    expect(near(lo[23], 41.366625940024655)).toBe(true)
    for (let i = 0; i < 19; i++) expect(Number.isNaN(hi[i]), `bar ${i}`).toBe(true)
    for (let i = 0; i < 23; i++) expect(Number.isNaN(lo[i]), `bar ${i}`).toBe(true)
    // the rule's edge, synthetically: an all-`na` left window passes; a window before bar 0 does not
    expect(FN.pivothigh(Float64Array.from([NaN, NaN, NaN, 7, 1, 2]), 3, 2)[3]).toBe(7)
    expect(Number.isNaN(FN.pivothigh(Float64Array.from([NaN, NaN, 7, 1, 2]), 3, 2)[2])).toBe(true)
  })
})

describe('S4-2 — the arg-extreme tie: newest over a bar price, withheld over a computed source', () => {
  it('builtin aroon (v6): Aroon Up reads 100 on bar 116, the tie of bars 112 and 116 (TradingView; was 71.43)', () => {
    const src = '//@version=6\nindicator("e56 aroon")\nplot(100 * (ta.highestbars(high, 15) + 14) / 14)'
    const { col, held } = hostColumn(src)
    expect(col[115]).toBeCloseTo(78.57142857142857, 9)
    expect(col[116]).toBe(100)
    expect(col[117]).toBeCloseTo(92.85714285714286, 9)
    expect(held.size).toBe(0)
  })
  it('v4 `highestbars(11)` (pivot-high-low-points\' window) names bar 116 on bar 117: -1', () => {
    const { col } = hostColumn('//@version=4\nstudy("e56 hb")\nplot(highestbars(11))')
    expect(col[117]).toBe(-1)
    const lo = hostColumn('//@version=4\nstudy("e56 lb")\nplot(lowestbars(low, 3))').col
    expect(lo.every((x, i) => i < 2 || Number.isFinite(x))).toBe(true)
  })
  it('a computed source\'s tied window is withheld by name, every other bar drawn (v6 and v4)', () => {
    for (const [v, call] of [[6, 'ta.highestbars(vt, 4)'], [4, 'highestbars(vt, 4)']]) {
      const src = `//@version=${v}\n${v >= 5 ? 'indicator' : 'study'}("e56 tie")\nvt = close > open ? 10 : 20\nplot(${call})`
      const { col, held, clock } = hostColumn(src, 0, BARS)
      expect([...held.keys()]).toEqual([TIE_UNWITNESSED])
      expect([...clock.keys()]).toContain(TIE_UNWITNESSED)
      // every bar has a constant two-valued source: a 4-bar window of it always ties
      expect(col.slice(3).every((x) => Number.isNaN(x))).toBe(true)
      expect(buildRuntimeIr(src, { bars: BARS, inputs: {}, pane: true, historyFromListing: true }).refusal.guard).toBe(TIE_UNWITNESSED)
    }
  })
  it('a computed source with no tie is drawn', () => {
    const src = '//@version=6\nindicator("e56 notie")\nplot(ta.highestbars(close * 2, 4))'
    const { col, held } = hostColumn(src)
    // `close * 2` over RDDT: count the tied windows and check exactly those are withheld
    let tied = 0
    for (let i = 3; i < RDDT.length; i++) {
      const w = RDDT.slice(i - 3, i + 1).map((b) => b.c * 2)
      const m = Math.max(...w)
      if (w.filter((x) => x === m).length > 1) { tied += 1; expect(Number.isNaN(col[i])).toBe(true) } else expect(Number.isFinite(col[i])).toBe(true)
    }
    expect(held.size).toBe(tied ? 1 : 0)
  })
  it('the bar-price test is structural (`close`, `hl2` as derived, never `volume` or a computed mean)', () => {
    const s = (name) => ({ type: 'series', name })
    const op = (name, args) => ({ type: 'op', name, args })
    expect(isBarPriceTree(s('high'))).toBe(true)
    expect(isBarPriceTree(op('/', [op('+', [s('high'), s('low')]), { type: 'num', value: 2 }]))).toBe(true)
    expect(isBarPriceTree(s('volume'))).toBe(false)
    expect(isBarPriceTree(op('/', [op('+', [s('high'), s('close')]), { type: 'num', value: 2 }]))).toBe(false)
  })
})

describe('the runtime lane on its own path (a mutable value: no column to read)', () => {
  const rt = (src, bars = RDDT) => buildRuntimeIr(src, { bars, inputs: {}, pane: true, historyFromListing: true })
  it('A3: a v5 `!=` over a comparison of a mutable value declines by name; v6 draws it', () => {
    const body = ['float x = 0.0', 'x := close - open', 'plot((x > ta.sma(close, 5)) != false ? 1 : 2)']
    const v5 = rt(['//@version=5', 'indicator("e56 vm")', ...body].join('\n'), BARS)
    expect(v5.ok).toBe(false)
    expect(v5.refusal.guard).toBe(BOOL_NA_UNWITNESSED)
    expect(rt(['//@version=6', 'indicator("e56 vm")', ...body].join('\n'), BARS).ok).toBe(true)
  })
  it('S4-2: a window over a mutable (computed) source stops by name on its first tied window, and is served with none', () => {
    const vm = (body) => ['//@version=5', 'indicator("e56 vm tie")', 'float vt = 0.0', body, 'plot(ta.highestbars(vt, 4))'].join('\n')
    const tie = runtimeRun(vm('vt := close > open ? 10 : 20'), BARS)
    expect(tie.err && tie.err.guard).toBe(TIE_UNWITNESSED)
    const none = runtimeRun(vm('vt := close * 2'), BARS)
    expect(none.err).toBeUndefined()
    // with no tie on these bars, the columnar lane draws every bar, and both lanes agree
    const host = hostColumn('//@version=6\nindicator("e56 notie")\nplot(ta.highestbars(close * 2, 4))', 0, BARS)
    expect(host.held.size).toBe(0)
    expect(none.col).toEqual(host.col)
    // a per-bar length sends `ta.highestbars(high, …)` to this lane's own window
    const src = ['//@version=5', 'indicator("e56 vm aroon")', 'len = close > 0 ? 15 : 16',
      'plot(100 * (ta.highestbars(high, len) + 14) / 14)'].join('\n')
    const run = runtimeRun(src)
    if (run.err) throw run.err
    expect(run.col[116]).toBe(100)
    expect(run.col[115]).toBeCloseTo(78.57142857142857, 9)
  })
})
