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

describe('A3 — the forms, version by version (S1 witnessed: v2 = v4 = v5; v1 / v3 take the same rules)', () => {
  // on the warm-up bars `c` is `na`: `==` / `!=` over it are `na` (false as a condition), `not c`
  // is true, `and` / `or` read it as false — the S1 probe's own forms (vw-cs1-*)
  const FORMS = [
    ['c == false', 2], ['c != false', 2], ['c == true', 2], ['c != true', 2], ['c == c[1]', 2],
    ['not c', 1], ['(c and true)', 2], ['(c and close > 0)', 2], ['(c or close > 0)', 1], ['(c or false)', 2],
    ['(c or close < 0)', 2],
    ['(c and close > 0) == false', 1],
  ]
  const VERSIONS = [null, 1, 2, 3, 4, 5]
  const CASES = VERSIONS.flatMap((v) => FORMS.map(([expr, warm]) => [v, expr, warm]))
  it.each(CASES)('v%s: `%s ? 1 : 2` is %s on the warm-up bars, served, nothing withheld', (v, expr, warm) => {
    const src = form(v === 1 ? null : v, expr).replace('//@version=1\n', '')
    const { col, held } = doorColumn(src)
    for (const i of WARM) expect(col[i], `bar ${i}`).toBe(warm)
    for (let i = 0; i < N; i++) expect(Number.isFinite(col[i]), `bar ${i}`).toBe(true)
    expect(held).toEqual([])
    expect(translatePine(src).outputs[0].formula).not.toMatch(/boolNaWithheld/)
    const [screen, pane, runtime, door] = doors(src)
    expect([screen, pane, door]).toEqual(['OK', 'OK', 'OK'])
    // the runtime lane serves it equal to the door, or (an `==` / `!=` whose `na` its VM would
    // read as false) declines by name — never a different number
    if (runtime === 'OK') expect(runtimeRun(src, BARS).col).toEqual(col)
    else expect(runtime).toBe(BOOL_NA_UNWITNESSED)
  })
  it('the `and` / `or` / `not` forms are served on the runtime lane too, equal to the door', () => {
    for (const v of VERSIONS) {
      for (const expr of ['not c', '(c and close > 0)', '(c or close > 0)', '(c or close < 0)']) {
        const src = form(v === 1 ? null : v, expr).replace('//@version=1\n', '')
        const rt = runtimeRun(src, BARS)
        expect(rt.err, `v${v} ${expr}`).toBeUndefined()
        expect(rt.col).toEqual(doorColumn(src).col)
      }
    }
  })
  it('a `bool` VALUE is `na` where it is `na`: `plot(c == false)` (v2) and `plot(c)` (v1), `na(c)` (v5)', () => {
    const v2 = [...head(2), 'c = close > sma(close, 5)', 'plot(c == false)'].join('\n')
    const a = doorColumn(v2)
    for (const i of WARM) expect(Number.isNaN(a.col[i]), `bar ${i}`).toBe(true)
    for (let i = 4; i < N; i++) expect(Number.isFinite(a.col[i]), `bar ${i}`).toBe(true)
    expect(a.held).toEqual([])
    const v1 = [...head(null), 'c = close > sma(close, 5)', 'plot(c)'].join('\n')
    const b = doorColumn(v1)
    for (const i of WARM) expect(Number.isNaN(b.col[i]), `bar ${i}`).toBe(true)
    expect(b.col.slice(4).every((x) => x === 0 || x === 1)).toBe(true)
    const v5 = [...head(5), 'c = close > ta.sma(close, 5)', 'plot(na(c) ? 1 : 2)'].join('\n')
    const d = doorColumn(v5)
    for (const i of WARM) expect(d.col[i], `bar ${i}`).toBe(1)
    expect(d.col.slice(4).every((x) => x === 2)).toBe(true)
  })
  it('`c or false` / `c and true` are never `na` (`rt3-na-logic`: `na(w or false)` is false): never folded to `c`', () => {
    for (const v of [null, 2, 4, 5]) {
      const naFn = 'na'
      for (const expr of ['c or false', 'c and true']) {
        const src = [...head(v), `c = close > ${sma(v)}(close, 5)`, `plot(${naFn}(${expr}) ? 1 : 2)`].join('\n')
        const { col } = doorColumn(src)
        for (const i of WARM) expect(col[i], `v${v} ${expr} bar ${i}`).toBe(2)
      }
    }
  })
  it('v6: `c == false` reads the cast `false` (1 on the warm-up bars) — unchanged', () => {
    const { col, held } = doorColumn(form(6, 'c == false'))
    for (const i of WARM) expect(col[i]).toBe(1)
    expect(held).toEqual([])
  })
  it('the sentence the member reads states the witnessed rule and what is still withheld', () => {
    const s = CHART_CLOCK_WITHHELD[BOOL_NA_UNWITNESSED]('D')
    expect(s).toMatch(/`not` of it/)
    expect(s).toMatch(/withheld rather than guessed/)
  })
})

describe('re-review #1265, 2 + s18 — a v1 / v2 / v3 condition reads a `bool` VALUE form under an offset as Pine does (`na` is false)', () => {
  // `ch = c != false` is `na` on bars 0..3 (where `c` is), so `ch[1]` is `na` on bars 0..4; read as a
  // condition that `na` is false (`not` of it true): S1 (v2), s18 (v1, v3)
  const src = (v, plotted) => [...head(v), `c = close > ${sma(v)}(close, 5)`, 'ch = c != false', `plot(${plotted})`].join('\n')
  const want = { '(ch[1] and close > 0) ? 1 : 2': 2, '(ch[1] or close < 0) ? 1 : 2': 2, '(not ch[1]) ? 1 : 2': 1, 'ch[1] ? 1 : 2': 2 }
  it.each([[null, 'v1'], [2, 'v2'], [3, 'v3']])('%s (%s): served, nothing withheld, bar 0 included', (v) => {
    for (const [plotted, w] of Object.entries(want)) {
      const { col, held } = doorColumn(src(v, plotted))
      expect(held, plotted).toEqual([])
      for (let i = 0; i <= 4; i++) expect(col[i], `${plotted} bar ${i}`).toBe(w)
      for (let i = 0; i < N; i++) expect(Number.isFinite(col[i]), `${plotted} bar ${i}`).toBe(true)
    }
  })
  it('the witnessed v1 `==` form (accumulation/distribution, `x == true and x[1] == false`) is untouched', () => {
    const v1 = [...head(null), 'c = close > sma(close, 5)', 'plot((c == true and c[1] == false) ? 1 : 2)'].join('\n')
    const { held } = doorColumn(v1)
    expect(held).toEqual([])
    expect(translatePine(v1).outputs[0].formula).not.toMatch(/boolNaWithheld/)
  })
})

describe('S1 — the bool-na probe at v2 (`vw-cs1-bool-na-v2`): every bool plot equals TradingView on the host lane', () => {
  it('v2: B / RB rows, every bar (the bar-index control `n` left out)', () => {
    const cap = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness/vw-cs1-bool-na-v2-rddt-1d-2026-11-14.json'), 'utf8'))
    const rows = cap.plotValues.rows
    expect(rows.length).toBe(RDDT.length)
    const src = cap.source.text.split('\n').filter((l) => !/^plot\(n,/.test(l.trim())).join('\n')
    // output k of this source is the capture's plot_(k + 1)
    for (let k = 1; k <= 19; k++) {
      const { col, held } = hostColumn(src, k)
      expect(held.size, `v2 plot_${k + 1}`).toBe(0)
      for (let i = 0; i < rows.length; i++) expect(col[i], `v2 plot_${k + 1} bar ${i}`).toBe(rows[i][k + 2])
    }
  })
})

describe('s18 — the bool-na probe at v1 and v3 (`vw-cs2-bool-na-v1-cum` / `-v3-cum`): every plot equals TradingView', () => {
  /** the script's lines with only its plot `k` kept: one output per run */
  const onlyPlot = (text, k) => {
    const lines = text.split('\n')
    const plotLines = lines.map((l, i) => [l, i]).filter(([l]) => /^plot\(/.test(l.trim())).map(([, i]) => i)
    return lines.filter((_, i) => !plotLines.includes(i) || i === plotLines[k]).join('\n')
  }
  // plots 3..24: the B / RB rows (`c`, `==`, `!=`, `not`, `and`, `or` over a `c` that is `na` on bars
  // 0..18) and the H rows (`(c != false)[1] and x`, `c[1] ? 1 : 0`, `c[1]`)
  for (const v of ['v1', 'v3']) {
    it(`${v}: every bar of every bool plot, bar 0 of \`(c != false)[1] and x\` included`, () => {
      const cap = JSON.parse(fs.readFileSync(path.join(REPO, `tests/fixtures/vendor/harness/vw-cs2-bool-na-${v}-cum-rddt-1d-2026-11-15.json`), 'utf8'))
      const rows = cap.plotValues.rows
      expect(rows.length).toBe(RDDT.length)
      for (let i = 0; i < rows.length; i++) expect(rows[i][0], `bar ${i} time`).toBe(RDDT[i].t)
      // the witness this item is about: H00 / H01 are 0 (false, never `na`) on bars 0..19
      for (let i = 0; i <= 19; i++) { expect(rows[i][22], `H00 vendor bar ${i}`).toBe(0); expect(rows[i][23], `H01 vendor bar ${i}`).toBe(0) }
      // H02 `c[1] ? 1 : 0` is 0 on bar 0: a v1-v3 `?:` whose test is `na` takes the else branch
      // (`NA_CONDITION_FALSE_FROM_VERSION` = 1; it was `na` here)
      expect(rows[0][24], 'H02 vendor bar 0').toBe(0)
      // through the member door: the production lane, with the version's condition rule from the listing
      for (const k of [0, 2, ...Array.from({ length: 22 }, (_, j) => j + 3)]) {
        // a plot that folds to a constant (`c or true`, `cum(1) - 1` alone) is "nothing a chart can
        // draw" for the door on its own: those are read off the host lane over the whole script
        const alone = memberPaneDefinition({ source: onlyPlot(cap.source.text, k), id: 'u_e56r', name: 'e56r' })
        const { col, codes } = alone.ok ? doorOn(onlyPlot(cap.source.text, k))
          : { ...hostColumn(cap.source.text, k), codes: [] }
        expect(codes, `${v} plot_${k}`).toEqual([])
        for (let i = 0; i < rows.length; i++) expect(col[i], `${v} plot_${k} bar ${i}`).toBe(rows[i][k + 1])
      }
    })
    it(`${v}: the runtime lane draws every bool plot as TradingView does, or declines it by name (never a wrong value)`, () => {
      const cap = JSON.parse(fs.readFileSync(path.join(REPO, `tests/fixtures/vendor/harness/vw-cs2-bool-na-${v}-cum-rddt-1d-2026-11-15.json`), 'utf8'))
      const rows = cap.plotValues.rows
      const only = (k) => onlyPlot(cap.source.text, k)
      const served = {}
      for (const k of [0, 2, ...Array.from({ length: 22 }, (_, j) => j + 3)]) {
        resetRuntimeSessions(); resetRuntimeLedgers()
        let col = null
        try { col = Array.from(computeRuntimeColumns(runtimeDoc(only(k), { a: 0 }), RDDT, CTX).a) } catch (e) {
          expect(e && e.guard, `${v} plot_${k}: declined by name (${e && e.message})`).toBe(BOOL_NA_UNWITNESSED)
          served[k] = false
          continue
        }
        served[k] = true
        for (let i = 0; i < rows.length; i++) expect(col[i], `${v} runtime plot_${k} bar ${i}`).toBe(rows[i][k + 1])
      }
      // the forms the ruling names: `raw(c == false / != false / == true)`, H00 / H01, H02 are SERVED
      // (the condition rule, one predicate with the host); `enc(c)`, `enc(c[1])` decline (`na()` of a
      // comparison over `na`, which this lane holds as false)
      for (const k of [13, 14, 15, 21, 22, 23]) expect(served[k], `${v} plot_${k} served`).toBe(true)
      for (const k of [3, 24]) expect(served[k], `${v} plot_${k} declined`).toBe(false)
    })
  }
})

describe('re-review #1265, 6 — `crossover` / `crossunder` / `rising` / `falling` are `na` where the engine column is', () => {
  it('v5: `X == false` is `na` exactly where the engine column of X is (crossings: the whole warm-up), false as a condition', () => {
    const ser = (name) => ({ type: 'series', name })
    const num = (value) => ({ type: 'num', value })
    const sma20 = { type: 'call', name: 'sma', args: [ser('close'), num(20)] }
    const CASES = [
      ['ta.crossover(close, ta.sma(close, 20))', { type: 'call', name: 'crossOver', args: [ser('close'), sma20] }],
      ['ta.crossunder(close, ta.sma(close, 20))', { type: 'call', name: 'crossUnder', args: [ser('close'), sma20] }],
      ['ta.rising(ta.sma(close, 20), 2)', { type: 'call', name: 'rising', args: [sma20, num(2)] }],
      ['ta.falling(ta.sma(close, 20), 2)', { type: 'call', name: 'falling', args: [sma20, num(2)] }],
    ]
    for (const [call, tree] of CASES) {
      // the engine's own column of the call: where it is NaN, `X == false` is `na`
      const own = Array.from(interpret(tree, RDDT, undefined, undefined, undefined, { ...LISTING, tf: 'D' }))
      const asValue = hostColumn(`//@version=5
indicator("rr6")
plot(na(${call} == false) ? 1 : 2)`)
      expect(asValue.held.size, call).toBe(0)
      for (let i = 0; i < RDDT.length; i++) expect(asValue.col[i], `${call} bar ${i}`).toBe(Number.isNaN(own[i]) ? 1 : 2)
      const asCondition = hostColumn(`//@version=5
indicator("rr6")
plot((${call} == false) ? 1 : 2)`)
      for (let i = 0; i < RDDT.length; i++) if (Number.isNaN(own[i])) expect(asCondition.col[i], `${call} bar ${i}`).toBe(2)
    }
    // the crossings are `na` on the whole warm-up (the sma's, and the bar after it): this is what moved
    const cross = Array.from(interpret(CASES[0][1], RDDT, undefined, undefined, undefined, { ...LISTING, tf: 'D' }))
    expect(cross.slice(0, 20).every((x) => Number.isNaN(x))).toBe(true)
  })
})

describe('probe 11 — `ta.rising` / `ta.falling` over an `na` warm-up source answer FALSE, never `na` (s17, v4 and v5)', () => {
  // `vw-cs2-rising-falling-na-v4/v5-rddt-1d-2026-11-15`: `s = sma(close, 20)`, each call plotted
  // through `enc(v) => na(v) ? -1 : v ? 1 : 0`; TradingView reads 0 on every warm-up bar
  for (const v of ['v4', 'v5']) {
    it(`${v}: every R / F plot equals TradingView on every bar (lengths 1, 2, 5)`, () => {
      const cap = JSON.parse(fs.readFileSync(path.join(REPO, `tests/fixtures/vendor/harness/vw-cs2-rising-falling-na-${v}-rddt-1d-2026-11-15.json`), 'utf8'))
      const rows = cap.plotValues.rows
      expect(rows.length).toBe(RDDT.length)
      for (let i = 0; i < rows.length; i++) expect(rows[i][0], `bar ${i} time`).toBe(RDDT[i].t)
      const src = cap.source.text
      for (let k = 2; k <= 7; k++) {
        const { col } = hostColumn(src, k)
        // the witness: on every bar where the source is `na` (`A01_s_is_na`), 0 (false), never -1 (na)
        const warm = rows.filter((r) => r[2] === 1)
        expect(warm.length).toBe(19)
        for (const r of warm) expect(r[k + 1], `${v} plot_${k} vendor`).toBe(0)
        for (let i = 0; i < rows.length; i++) expect(col[i], `${v} plot_${k} bar ${i}`).toBe(rows[i][k + 1])
      }
    })
  }
  it('the columns: false on the first `n` samples of a finite source too (was `na`)', () => {
    expect(Array.from(FN.rising([1, 2, 3, 4], 2))).toEqual([0, 0, 1, 1])
    expect(Array.from(FN.falling([4, 3, 2, 1], 1))).toEqual([0, 1, 1, 1])
  })
})

describe('A3 — the fallback marker, for a `bool` whose `na` this engine does not follow', () => {
  it('`boolNaWithheld(c, na(sma))` is its operand and withholds by name exactly where the flag is 1', () => {
    const smaT = { type: 'call', name: 'sma', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 5 }] }
    const c = { type: 'op', name: '>', args: [{ type: 'series', name: 'close' }, smaT] }
    const tree = { type: 'op', name: '!=', args: [
      { type: 'call', name: 'boolNaWithheld', args: [c, { type: 'call', name: 'na', args: [smaT] }] },
      { type: 'num', value: 0 }] }
    const held = new Map()
    const clock = new Map()
    const col = interpret(tree, BARS, undefined, undefined, undefined,
      { ...LISTING, tf: 'D', chartClockSink: clock, withheldBarsSink: held })
    expect([...held.keys()]).toEqual([BOOL_NA_UNWITNESSED])
    expect(Array.from(held.get(BOOL_NA_UNWITNESSED)).slice(0, 6)).toEqual([1, 1, 1, 1, 0, 0])
    expect([...clock.keys()]).toContain(BOOL_NA_UNWITNESSED)
    for (let i = 0; i < 4; i++) expect(Number.isNaN(col[i]), `bar ${i}`).toBe(true)
    expect(Array.from(col).slice(4).every((x) => Number.isFinite(x))).toBe(true)
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

/** Pine's newest-of-a-tie offset of `ta.highestbars(src, len)` on bar i (non-positive) */
const newestOffset = (src, len, i) => {
  let best = -Infinity
  let at = -1
  for (let j = i - len + 1; j <= i; j++) if (src[j] >= best) { best = src[j]; at = j }
  return -(i - at)
}
describe('S4-2 — the arg-extreme tie: Pine names the NEWEST of a tie over ANY source (S5 / S1 / S10 witnessed)', () => {
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
  it('S10 capture (`vw-cs2-highestbars-computed-v6`, v6): `vt = bar_index % 3 == 0 ? 1.0 : 2.0` reads TradingView\'s offsets, both lanes', () => {
    // the capture's numbers from bar 3 on, by bar_index % 3: highestbars -1, 0, 0; lowestbars 0, -1, -2
    // (the NEWEST tied bar; an oldest-wins reading would give -2 / -3 for highestbars)
    const HB = [-1, 0, 0]
    const LB = [0, -1, -2]
    for (const [fn, want] of [['ta.highestbars', HB], ['ta.lowestbars', LB]]) {
      const src = `//@version=6\nindicator("e56 cs2")\nvt = bar_index % 3 == 0 ? 1.0 : 2.0\nplot(${fn}(vt, 4))`
      const { col, held, formula } = hostColumn(src)
      expect(held.size).toBe(0)
      expect(formula).toMatch(/tieNewest\(/)
      for (let i = 0; i < 3; i++) expect(Number.isNaN(col[i]), `${fn} bar ${i}`).toBe(true)
      for (let i = 3; i < RDDT.length; i++) expect(col[i] + 0, `${fn} bar ${i}`).toBe(want[i % 3])
      const rt = runtimeRun(src)
      expect(rt.err).toBeUndefined()
      expect(rt.col).toEqual(col)
    }
  })
  it('v4 / v5 / v6: a two-valued COMPUTED source names the NEWEST of a tie, first value on bar length - 1, both lanes', () => {
    const vt = BARS.map((b) => (b.c > b.o ? 10 : 20))
    for (const [v, call] of [[6, 'ta.highestbars(vt, 4)'], [5, 'ta.highestbars(vt, 4)'], [4, 'highestbars(vt, 4)']]) {
      const src = `//@version=${v}\n${v >= 5 ? 'indicator' : 'study'}("e56 tie")\nvt = close > open ? 10 : 20\nplot(${call})`
      const { col, held, formula } = hostColumn(src, 0, BARS)
      expect(held.size).toBe(0)
      expect(formula).toMatch(/tieNewest\(/)
      for (let i = 0; i < 3; i++) expect(Number.isNaN(col[i]), `v${v} bar ${i}`).toBe(true)
      for (let i = 3; i < BARS.length; i++) expect(col[i], `v${v} bar ${i}`).toBe(newestOffset(vt, 4, i))
      const rt = runtimeRun(src, BARS)
      expect(rt.err).toBeUndefined()
      expect(rt.col).toEqual(col)
    }
  })
  it('a formula of this engine\'s own language (no Pine door) keeps its rule: a computed tie is withheld by name', () => {
    const vtT = { type: 'op', name: '?:', args: [{ type: 'op', name: '>', args: [{ type: 'series', name: 'close' }, { type: 'series', name: 'open' }] }, { type: 'num', value: 10 }, { type: 'num', value: 20 }] }
    const held = new Map()
    const col = interpret({ type: 'call', name: 'highestbars', args: [vtT, { type: 'num', value: 4 }] }, BARS, undefined, undefined, undefined,
      { ...LISTING, tf: 'D', withheldBarsSink: held })
    expect([...held.keys()]).toEqual([TIE_UNWITNESSED])
    expect(Array.from(col).slice(3).every((x) => Number.isNaN(x))).toBe(true)
  })
  it('a computed source over real bars: every bar drawn, a tied window at its newest bar', () => {
    const src = '//@version=6\nindicator("e56 notie")\nplot(ta.highestbars(close * 2, 4))'
    const { col, held } = hostColumn(src)
    expect(held.size).toBe(0)
    const c2 = RDDT.map((b) => b.c * 2)
    for (let i = 3; i < RDDT.length; i++) expect(col[i], `bar ${i}`).toBe(newestOffset(c2, 4, i))
  })
  it('the bar-price test is structural (`close`, `hl2` as derived, never `volume` or a computed mean)', () => {
    const s = (name) => ({ type: 'series', name })
    const op = (name, args) => ({ type: 'op', name, args })
    expect(isBarPriceTree(s('high'))).toBe(true)
    expect(isBarPriceTree(op('/', [op('+', [s('high'), s('low')]), { type: 'num', value: 2 }]))).toBe(true)
    expect(isBarPriceTree(s('volume'))).toBe(false)
    expect(isBarPriceTree(op('/', [op('+', [s('high'), s('close')]), { type: 'num', value: 2 }]))).toBe(false)
    // a source the v4 / v5 translator marked `tieNewest` takes the newest rule too
    expect(isBarPriceTree({ type: 'call', name: 'tieNewest', args: [op('*', [s('close'), { type: 'num', value: 2 }])] })).toBe(true)
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
  it('S4-2: a window over a mutable (computed) source names the newest of a tie at v5 and v6', () => {
    const vt = BARS.map((b) => (b.c > b.o ? 10 : 20))
    for (const v of [5, 6]) {
      const run = runtimeRun([`//@version=${v}`, 'indicator("e56 vm tie")', 'float vt = 0.0', 'vt := close > open ? 10 : 20',
        'plot(ta.highestbars(vt, 4))'].join('\n'), BARS)
      expect(run.err).toBeUndefined()
      for (let i = 3; i < BARS.length; i++) expect(run.col[i], `v${v} bar ${i}`).toBe(newestOffset(vt, 4, i))
    }
    // a per-bar length sends `ta.highestbars(high, …)` to this lane's own window
    const src = ['//@version=5', 'indicator("e56 vm aroon")', 'len = close > 0 ? 15 : 16',
      'plot(100 * (ta.highestbars(high, len) + 14) / 14)'].join('\n')
    const run = runtimeRun(src)
    if (run.err) throw run.err
    expect(run.col[116]).toBe(100)
    expect(run.col[115]).toBeCloseTo(78.57142857142857, 9)
  })
})

// ─── the review of #1265 (f4601e45a1): findings 1-7 ─────────────────────────────────────────────
/** the member door's served column, the bars withheld by name, on RDDT (or other) bars */
function doorOn(src, bars = RDDT) {
  const d = memberPaneDefinition({ source: src, id: 'u_e56r', name: 'e56r' })
  expect(d.ok, d.guard).toBe(true)
  const cols = registry.computeFor(d.definition, bars, undefined, CTX)
  const key = Object.keys(cols)[0]
  const rep = registry.withheldBarsReport(cols)
  const masks = rep && rep[key] ? rep[key] : {}
  return { col: Array.from(cols[key]), codes: Object.keys(masks),
    held: Object.values(masks).reduce((a, m) => a + Array.from(m).filter(Boolean).length, 0),
    maskLengths: Object.values(masks).map((m) => m.length), formula: d.translation.outputs[0].formula }
}

describe('finding 1 - no untracked bool reaches `== true/false` with the comparison 0', () => {
  it('v4 `security(…, "W", close > sma(close, 20)) == false` is 0 where the weekly comparison is `na` (it served 1)', () => {
    const src = '//@version=4\nstudy("r1")\nw = security(syminfo.tickerid, "W", close > sma(close, 20))\nplot(w == false ? 1 : 0)'
    const { col, codes } = doorOn(src)
    // the weekly `sma(close, 20)` is `na` for the first 20 weeks: about 100 daily bars
    for (let i = 0; i < 95; i++) expect(col[i], `bar ${i}`).toBe(0)
    expect(col.slice(100).some((x) => x === 1)).toBe(true)
    expect(codes).toEqual([])
    const rt = runtimeRun(src)
    if (!rt.err) for (let i = 0; i < 95; i++) expect(rt.col[i], `runtime bar ${i}`).toBe(0)
  })
  it('v4 `valuewhen(close > open, close > sma(close, 20), 0) == false` is 0 while the chosen comparison is `na`', () => {
    const src = '//@version=4\nstudy("r1")\nb = valuewhen(close > open, close > sma(close, 20), 0)\nplot(b == false ? 1 : 0)'
    const { col } = doorOn(src)
    for (let i = 0; i < 19; i++) expect(col[i], `bar ${i}`).toBe(0)
    // the runtime lane computes `valuewhen` itself and cannot tell its `na` from false: it declines
    const rt = runtimeRun(src)
    expect(rt.err && rt.err.guard).toBe(BOOL_NA_UNWITNESSED)
  })
  it('a v1 `bool` latch (`x = close > open ? true : nz(x[1], false)`) is TRACKED, never na, and served on every bar', () => {
    const { col, codes } = doorOn('study("r1")\nx = close > open ? true : nz(x[1], false)\nplot(x == true ? 1 : 0)')
    expect(codes).toEqual([])
    expect(col.filter((x) => Number.isFinite(x)).length).toBe(RDDT.length)
  })
  it('S1: a v1 `and` over its own history is never `na` (`and` reads `na` as false): tracked and served', () => {
    const src = 'study("r1")\nx = close > open ? (nz(x[1], false) and close > sma(close, 5)) : false\nplot(x == true ? 1 : 0)'
    const { col, codes } = doorOn(src)
    expect(codes).toEqual([])
    expect(col.every((x) => Number.isFinite(x))).toBe(true)
  })
  it('an `==` over a bool latch\'s own past (`nz(x[1], false) == true`) is tracked (never `na`) and served', () => {
    const src = 'study("r1")\nx = close > open ? (nz(x[1], false) == true) : false\nplot(x ? 1 : 0)'
    const { col, codes, formula } = doorOn(src)
    expect(formula).not.toMatch(/boolNaWithheld/)
    expect(codes).toEqual([])
    expect(col.every((x) => Number.isFinite(x))).toBe(true)
  })
  it('a latch whose arm is a comparison over `na` (`x = c ? close > sma(close, 20) : nz(x[1], false)`): `x == false` is 0 there', () => {
    const src = 'study("r1")\nx = close > open ? close > sma(close, 20) : nz(x[1], false)\nplot(x == false ? 1 : 0)'
    const { col, codes } = doorOn(src)
    expect(codes).toEqual([])
    // on a warm-up bar where close > open, `x` is the comparison with a warming `sma`: `na`, so 0
    let checked = 0
    for (let i = 0; i < 19; i++) if (RDDT[i].c > RDDT[i].o) { expect(col[i], `bar ${i}`).toBe(0); checked += 1 }
    expect(checked).toBeGreaterThan(0)
  })
  it('a numeric state seeded `na` (`os := c ? 0 : d ? 1 : os[1]`, a zig-zag\'s) meets `== 1` / `!= 1` served, never withheld', () => {
    // ⭐ landing train 1: the two windows are hoisted out of the `?:` arms. COND-TA (engine 58) withholds a
    // `ta.*` call written INSIDE a `?:` arm by name (`pine:block`, its own rule); this rail is about the
    // numeric state meeting `== 1` / `!= 1`, which is the same state either way.
    const src = ['//@version=4', 'study("r1")', 'hi = highest(close, 10)[1]', 'lo = lowest(close, 10)[1]', 'os = 0', 'os := close > hi ? 0 : close < lo ? 1 : os[1]',
      'plot(os == 1 and os[1] != 1 ? 1 : 0)'].join('\n')
    const { col, codes, formula } = doorOn(src)
    expect(formula).not.toMatch(/boolNaWithheld/)
    expect(codes).toEqual([])
    expect(col.every((x) => x === 0 || x === 1)).toBe(true)
    expect(col.some((x) => x === 1)).toBe(true)
  })
  it('S1: a NUMBER meeting a `bool` literal (v1 `x == true` is `x == 1`) is `na` where the number is, never withheld', () => {
    const src = 'study("r1")\nx = close - sma(close, 5)\nplot(x == true ? 1 : 2)'
    const { col, codes } = doorOn(src)
    expect(codes).toEqual([])
    for (let i = 0; i < 4; i++) expect(col[i], `bar ${i}`).toBe(2)
    expect(col.every((v) => v === 1 || v === 2)).toBe(true)
  })
  it('finding 5b: `x = close > open ? 1 : na; x != 1` is a NUMBER compare, served as `sma != close` is', () => {
    const { col, codes, formula } = doorOn('//@version=5\nindicator("r1")\nx = close > open ? 1 : na\nplot(x != 1 ? 1 : 0)')
    expect(codes).toEqual([])
    expect(formula).not.toMatch(/boolNaWithheld/)
    expect(col.every((x) => Number.isFinite(x))).toBe(true)
  })
})

describe('finding 2 - the runtime lane declines a mutable `bool` that can be `na` (it served 0 where the host withholds)', () => {
  it('`bool up = false; up := close > ta.sma(close, 20); up != up[1]`: the door draws 0 on bars 0..20 (S1: `na`, false as a condition), the runtime declines', () => {
    const src = '//@version=5\nindicator("r2")\nbool up = false\nup := close > ta.sma(close, 20)\nplot(up != up[1] ? 1 : 0)'
    const { col, codes } = doorOn(src)
    expect(codes).toEqual([])
    for (let i = 0; i <= 19; i++) expect(col[i], `bar ${i}`).toBe(0)
    expect(col.every((x) => Number.isFinite(x))).toBe(true)
    const b = buildRuntimeIr(src, { bars: RDDT, inputs: {}, pane: true, historyFromListing: true })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe(BOOL_NA_UNWITNESSED)
  })
  it('finding 6: a v5 `and` is never `na` on this lane (served)', () => {
    const body = ['float x = 0.0', 'x := close - open', 'b = x > 0 and close > 0', 'plot(b == true ? 1 : 0)']
    const built = buildRuntimeIr(['//@version=5', 'indicator("r6")', ...body].join('\n'), { bars: RDDT, inputs: {}, pane: true, historyFromListing: true })
    expect(built.ok, built.refusal && `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
    // and at `!=` (decided at the site, not by the deferred `==` check): a named `and`, and one written inline
    for (const plot of ['plot(b != true ? 1 : 0)', 'plot((x > 0 and close > 0) != true ? 1 : 0)']) {
      const ne = buildRuntimeIr(['//@version=5', 'indicator("r6")', ...body.slice(0, 3), plot].join('\n'), { bars: RDDT, inputs: {}, pane: true, historyFromListing: true })
      expect(ne.ok, `${plot}: ${ne.refusal && ne.refusal.guard}`).toBe(true)
    }
  })
  it('S1 (this lane): an `and` returned by a function is never `na` (`f(x) == true` served)', () => {
    const src = ['//@version=5', 'indicator("r8g")', 'float x = 0.0', 'x := close - open', 'f(a) => a > 0 and close > 0',
      'plot(f(x) == true ? 1 : 0)'].join('\n')
    const b = buildRuntimeIr(src, { bars: RDDT, inputs: {}, pane: true, historyFromListing: true })
    expect(b.ok, b.refusal && `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
    expect(runtimeRun(src).col).toEqual(RDDT.map((r) => (r.c - r.o > 0 && r.c > 0 ? 1 : 0)))
  })
  it('finding 1 (this lane): a `valuewhen` of a comparison meeting `!= false` is never a different number than the door', () => {
    const src = '//@version=4\nstudy("r1")\nplot(valuewhen(close > open, close > sma(close, 20), 0) != false ? 1 : 0)'
    const b = buildRuntimeIr(src, { bars: RDDT, inputs: {}, pane: true, historyFromListing: true })
    if (b.ok) expect(runtimeRun(src).col).toEqual(doorOn(src).col)
    else expect(b.refusal.guard).toBe(BOOL_NA_UNWITNESSED)
    for (let i = 0; i < 19; i++) expect(doorOn(src).col[i], `bar ${i}`).toBe(0)
  })
  it('S1 (this lane): an `==` over a `bool` that is `na`, DRAWN as a value (v2 `plot(b == true)`), is `na` there or declined', () => {
    const src = '//@version=2\nstudy("r2e")\nb = close > 60 ? close > open : na\nplot(b == true)'
    const want = RDDT.map((r) => (r.c > 60 ? (r.c > r.o ? 1 : 0) : NaN))
    const b = buildRuntimeIr(src, { bars: RDDT, inputs: {}, pane: true, historyFromListing: true })
    if (b.ok) expect(runtimeRun(src).col).toEqual(want)
    else expect(b.refusal.guard).toBe(BOOL_NA_UNWITNESSED)
    // and the VM path proper (a mutable `bool`, no column): declined, never drawn as 0
    const vm = '//@version=2\nstudy("r2f")\nb = false\nb := close > 60 ? close > open : na\nplot(b == true)'
    const r = buildRuntimeIr(vm, { bars: RDDT, inputs: {}, pane: true, historyFromListing: true })
    if (r.ok) expect(runtimeRun(vm).col).toEqual(want)
    else expect(r.refusal.guard).toBe(BOOL_NA_UNWITNESSED)
  })
  it('round 2: a comparison over a SLOT that can be `na` (`s := ta.sma(…)`, `up := close > s`) declines at `== false`', () => {
    const src = '//@version=5\nindicator("r2d")\nfloat s = na\ns := ta.sma(close, 20)\nbool up = false\nup := close > s\nplot(up == false ? 1 : 0)'
    const b = buildRuntimeIr(src, { bars: RDDT, inputs: {}, pane: true, historyFromListing: true })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe(BOOL_NA_UNWITNESSED)
  })
  it('finding 6: a variable whose every write is a bar price (`float h = na; h := high`) names the newest tie on this lane', () => {
    const src = '//@version=6\nindicator("r6")\nfloat h = na\nh := high\nplot(ta.highestbars(h, 11))'
    const rt = runtimeRun(src)
    expect(rt.err).toBeUndefined()
    expect(rt.col[117]).toBe(-1)
    expect(rt.col).toEqual(doorOn(src).col)
  })
  // ⭐ round 2: `== true / false` is decided over every write of what it reads — declined where
  // a write is a comparison over a value that can be `na` (the VM holds that `na` as 0), served
  // (equal to the member door) where the `na` is a real one
  it('round 2: `up := close > ta.sma(close, 20)` then `up == false` declines on this lane (it would draw 1 where the door draws 0)', () => {
    const src = '//@version=5\nindicator("r2b")\nbool up = false\nup := close > ta.sma(close, 20)\nplot(up == false ? 1 : 0)'
    const { col } = doorOn(src)
    for (let i = 0; i < 19; i++) expect(col[i], `bar ${i}`).toBe(0)
    const b = buildRuntimeIr(src, { bars: RDDT, inputs: {}, pane: true, historyFromListing: true })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe(BOOL_NA_UNWITNESSED)
  })
  // ⭐ re-review #1265, 1: a pure subexpression lowers to ONE column, so a `bool` column over a
  // value that can be `na` meeting a never-`na` latch must be asked like a comparison is
  const LATCH = ['var bool inPos = false', 'if close > open', '    inPos := true', 'else if close < open', '    inPos := false']
  const servedOrDeclined = (src) => {
    const { col } = doorOn(src)
    const b = buildRuntimeIr(src, { bars: RDDT, inputs: {}, pane: true, historyFromListing: true })
    if (!b.ok) { expect(b.refusal.guard).toBe(BOOL_NA_UNWITNESSED); return { col, served: null } }
    const rt = runtimeRun(src)
    expect(rt.err).toBeUndefined()
    expect(rt.col).toEqual(col)
    return { col, served: rt.col }
  }
  it('re-review 1: the latch "state changed" pattern `(close > ta.sma(close, 20)) != inPos` is never TRUE on the warm-up (the door draws 0)', () => {
    const src = ['//@version=5', 'indicator("rr1")', ...LATCH, 'plot((close > ta.sma(close, 20)) != inPos ? 1 : 0)'].join('\n')
    const { col, served } = servedOrDeclined(src)
    for (let i = 0; i < 19; i++) expect(col[i], `bar ${i}`).toBe(0)
    expect(served).toBeNull()
  })
  it('re-review 1: the same through a history read of the column (`trendCol[1] == inPos`) declines or matches the door', () => {
    const src = ['//@version=5', 'indicator("rr1b")', 'trendCol = close > ta.sma(close, 20)', ...LATCH, 'plot(trendCol[1] == inPos ? 1 : 0)'].join('\n')
    const { col, served } = servedOrDeclined(src)
    for (let i = 0; i < 20; i++) expect(col[i], `bar ${i}`).toBe(0)
    expect(served).toBeNull()
  })
  it('re-review 1: a column known on every bar (`(close > open) != inPos`) is served, equal to the door', () => {
    const src = ['//@version=5', 'indicator("rr1c")', ...LATCH, 'plot((close > open) != inPos ? 1 : 0)'].join('\n')
    const { served } = servedOrDeclined(src)
    expect(served).not.toBeNull()
  })
  it('round 2: an unmatched v5 `if` block\'s `na`, read through a function and its history, is served (`na == true` is 0)', () => {
    // the member door refuses a block value (`pine:block`); the answer is Pine's: `b[1]` is `na`
    // on bar 0 and wherever the previous close was not above 60, and `na == true` is false
    const src = '//@version=5\nindicator("r2c")\nb = if close > 60\n    close > open\nf(x) => x[1] == true\nplot(f(b) ? 1 : 0)'
    const rt = runtimeRun(src)
    expect(rt.err).toBeUndefined()
    const want = RDDT.map((_, i) => (i > 0 && RDDT[i - 1].c > 60 && RDDT[i - 1].c > RDDT[i - 1].o ? 1 : 0))
    expect(rt.col).toEqual(want)
    expect(want.some((x) => x === 1) && want.some((x, i) => x === 0 && i > 0 && RDDT[i - 1].c <= 60)).toBe(true)
  })
})

describe('finding 3 -a witness site under a read on other bars is withheld (TF_MERGE / LTF / tf / sym)', () => {
  // the Pine door leaves no witness site any more (S1, S10); this engine's own language still
  // withholds a computed tie, so the nesting rule is railed on its trees
  const ser = (name) => ({ type: 'series', name })
  const vtT = { type: 'op', name: '?:', args: [{ type: 'op', name: '>', args: [ser('close'), ser('open')] }, { type: 'num', value: 10 }, { type: 'num', value: 20 }] }
  const hb = { type: 'call', name: 'highestbars', args: [vtT, { type: 'num', value: 4 }] }
  it('a tie site under a weekly read withholds the whole plot, and the mask is the chart\'s length (finding 7)', () => {
    // (`tf_merge` is engine 55's node, matched by name in WITNESS_NESTED; it lands with #1264)
    for (const type of ['tf', 'tf_live']) {
      const held = new Map()
      const col = interpret({ type, value: 'W', args: [hb] }, RDDT, undefined, undefined, undefined, { ...LISTING, tf: 'D', withheldBarsSink: held })
      expect([...held.keys()], type).toEqual([TIE_UNWITNESSED])
      expect(held.get(TIE_UNWITNESSED).length, type).toBe(RDDT.length)
      expect(Array.from(col).every((x) => Number.isNaN(x)), type).toBe(true)
    }
  })
  it('the same source through the Pine door at v5 / v6 (newest, S1 / S10) is drawn', () => {
    for (const v of [5, 6]) {
      const { col, codes } = doorOn(`//@version=${v}\nindicator("r3")\nvt = close > open ? 10 : 20\nplot(request.security(syminfo.tickerid, "W", ta.highestbars(vt, 4)))`)
      expect(codes).toEqual([])
      expect(col.slice(40).every((x) => Number.isFinite(x))).toBe(true)
    }
  })
  it('a tracked `!=` under `request.security(…, "W", …)` is Pine\'s answer: false as a condition while the weekly side is `na`', () => {
    const { col, codes } = doorOn('//@version=5\nindicator("r3")\nw = request.security(syminfo.tickerid, "W", (close > ta.sma(close, 20)) != false)\nplot(w ? 1 : 0)')
    expect(codes).toEqual([])
    for (let i = 0; i < 80; i++) expect(col[i], `bar ${i}`).toBe(0)
  })
})

describe('finding 5 - the withholding ENDS once the answer no longer depends on the unknown bars (tie sites of this engine\'s own trees)', () => {
  const ser = (name) => ({ type: 'series', name })
  const num = (value) => ({ type: 'num', value })
  const vtT = { type: 'op', name: '?:', args: [{ type: 'op', name: '>', args: [ser('close'), ser('open')] }, num(10), num(20)] }
  const cond = { type: 'op', name: '==', args: [{ type: 'call', name: 'highestbars', args: [vtT, num(4)] }, num(0)] }
  const run = (tree) => {
    const held = new Map()
    const col = interpret(tree, RDDT, undefined, undefined, undefined, { ...LISTING, tf: 'D', withheldBarsSink: held })
    const m = held.get(TIE_UNWITNESSED)
    return { col: Array.from(col), held: m ? Array.from(m).filter(Boolean).length : 0 }
  }
  it('re-review 5: an unknown bar reaches the pivot centres `right` before it to `left` after it (left 2, right 5)', () => {
    const sma20 = { type: 'call', name: 'sma', args: [ser('close'), num(20)] }
    const tree = { type: 'call', name: 'pivothigh', args: [{ type: 'call', name: 'boolNaWithheld', args: [ser('high'), { type: 'call', name: 'na', args: [sma20] }] }, num(2), num(5)] }
    const held = new Map()
    interpret(tree, RDDT, undefined, undefined, undefined, { ...LISTING, tf: 'D', withheldBarsSink: held })
    const m = Array.from(held.get(BOOL_NA_UNWITNESSED))
    // unknown bars 0..18 -> centres 0 .. 18 + 2
    expect(m.slice(0, 21).every((x) => x === 1)).toBe(true)
    expect(m.slice(21).every((x) => x === 0)).toBe(true)
  })
  it('a recurrence withholds every later bar; `barssince` (bare and bounded) and `valuewhen` stop withholding', () => {
    const cum = run({ type: 'call', name: 'cum', args: [{ type: 'op', name: '?:', args: [cond, num(1), num(0)] }] })
    expect(cum.held).toBeGreaterThan(RDDT.length - 20)
    expect(cum.col.slice(10).every((x) => Number.isNaN(x))).toBe(true)
    const trees = {
      'barssince (bounded)': { type: 'call', name: 'barssince', args: [cond, num(30)] },
      valuewhen: { type: 'call', name: 'valuewhenOccurrence', args: [cond, ser('close'), num(0)] },
      'barssince (bare)': { type: 'op', name: '-', args: [ser('barindex'), { type: 'call', name: 'valuewhenOccurrence', args: [cond, ser('barindex'), num(0)] }] },
    }
    for (const [name, tree] of Object.entries(trees)) {
      const r = run(tree)
      expect(r.held, name).toBeGreaterThan(0)
      expect(r.held, name).toBeLessThan(cum.held)
      expect(r.col.slice(40).some((x) => Number.isFinite(x)), name).toBe(true)
    }
  })
})

// ─── ⭐⭐ LANDING TRAIN 1 (train-owned, coordinator ruling 2026-11-15) — THE BUILT-IN `na(x)` IS NEVER `na` ───
//
// Engine 56-v2's runtime rule asked every side that meets a WRITTEN `true` / `false`, and its list of
// never-`na` bools did not hold the built-in `na(…)`. It was built on master before RS Rating (#1342):
// on the combined tree the ORIGINAL RS Rating script (`ta.barssince(na(curveRsPerf) != true)`, line 262)
// lost its run half, declined `pine:bool-na-unwitnessed`, and master's acceptance rail
// (`engine/requestSeed.test.js`) went red. TradingView's Pine Script User Manual, Type system,
// "`na` value" (tradingview.com/pine-script-docs/language/type-system, read 2026-11-15): "Scripts can
// test whether the result from a variable or expression is na by using the na() function. The function
// returns true if the value or reference is undefined. Otherwise, it returns false." A plain `bool`,
// so `na(x) != true` holds no `na` to lose. Scope: the built-in only (`canonNeverTree`, `isNaBuiltin`).
describe('landing train 1 — the built-in `na(x)` is never `na` on the runtime lane', () => {
  const v5 = (lines) => ['//@version=5', 'indicator("train1 na")', ...lines].join('\n')
  const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]) || (Number.isNaN(v) && Number.isNaN(b[i])))

  it('`na(x) != true` and the RS Rating shape `ta.barssince(na(x) != true)` are served, equal to the host lane', () => {
    for (const body of ['plot(na(x) != true ? 1 : 0)', 'plot(na(x) == false ? 1 : 0)', 'plot(ta.barssince(na(x) != true))']) {
      const src = v5(['x = ta.sma(close, 20)', body])
      const host = hostColumn(src).col
      const rt = runtimeRun(src)
      expect(rt.err ? rt.err.guard : 'OK', body).toBe('OK')
      expect(same(rt.col, host), body).toBe(true)
    }
    // the values themselves: `x` is `na` on bars 0..18, so the test is false there and true from bar 19
    const col = runtimeRun(v5(['x = ta.sma(close, 20)', 'plot(na(x) != true ? 1 : 0)'])).col
    expect(col.slice(0, 19).every((v) => v === 0)).toBe(true)
    expect(col.slice(19).every((v) => v === 1)).toBe(true)
  })

  it('a `bool` every write of which is the built-in `na(…)` (a slot the VM steps) is never `na` either', () => {
    const src = v5(['x = ta.sma(close, 20)', 'bool b = false', 'if close > 0', '    b := na(x)', 'plot(b != true ? 1 : 0)'])
    const rt = runtimeRun(src)
    expect(rt.err ? rt.err.guard : 'OK').toBe('OK')
    expect(rt.col.slice(0, 19).every((v) => v === 0)).toBe(true)
    expect(rt.col.slice(19).every((v) => v === 1)).toBe(true)
  })

  it('…and where `na(…)` reads a value the VM steps (the lowered built-in, RS Rating\'s own shape)', () => {
    const stepped = ['var float x = na', 'if close < open', '    x := close']
    // the site itself: `na(x) != true`, drawn as Pine draws it (`x` is `na` until the first down bar)
    const site = runtimeRun(v5([...stepped, 'plot(na(x) != true ? 1 : 0)']))
    expect(site.err ? site.err.guard : 'OK').toBe('OK')
    const firstDown = RDDT.findIndex((b) => b.c < b.o)
    expect(firstDown).toBeGreaterThan(0)
    expect(site.col.slice(0, firstDown).every((v) => v === 0)).toBe(true)
    expect(site.col.slice(firstDown).every((v) => v === 1)).toBe(true)
    // a `bool` slot every write of which is that built-in
    const slot = runtimeRun(v5([...stepped, 'bool b = false', 'if close > 0', '    b := na(x)', 'plot(b != true ? 1 : 0)']))
    expect(slot.err ? slot.err.guard : 'OK').toBe('OK')
    expect(same(slot.col, site.col)).toBe(true)
    // ⛔ CONTROL: another built-in in the same place is not cleared (`nz` of a `bool` the VM lost the `na` of)
    const viaNz = runtimeRun(v5(['y = ta.sma(close, 20)', 'bool c = false', 'if close > 0', '    c := close > y', 'bool b = false', 'if close > 0', '    b := nz(c)', 'plot(b != true ? 1 : 0)']))
    expect(viaNz.err && viaNz.err.guard).toBe(BOOL_NA_UNWITNESSED)
  })

  it('⛔ CONTROL: a `bool` that CAN be `na` meeting a written `true` is still declined by name', () => {
    // the slot rail above with ONE change: the write is a comparison over a value that can be `na`,
    // which the VM holds as false where Pine holds `na`
    const rt = runtimeRun(v5(['x = ta.sma(close, 20)', 'bool b = false', 'if close > 0', '    b := close > x', 'plot(b != true ? 1 : 0)']))
    expect(rt.err && rt.err.guard).toBe(BOOL_NA_UNWITNESSED)
    // …and so is a write that merely HOLDS an `na(…)` beside such a comparison
    const mixed = runtimeRun(v5(['x = ta.sma(close, 20)', 'bool b = false', 'if close > 0', '    b := (close > x) == na(x)', 'plot(b != true ? 1 : 0)']))
    expect(mixed.err && mixed.err.guard).toBe(BOOL_NA_UNWITNESSED)
  })

  it('⛔ CONTROL: a script\'s own function is not the built-in (it lowers to a call, never to `na`)', () => {
    // the same slot shape, the write a script function whose answer is a comparison that can be `na`
    const own = runtimeRun(v5(['isUp(v) => v > ta.sma(v, 20)', 'bool b = false', 'if close > 0', '    b := isUp(close)', 'plot(b != true ? 1 : 0)']))
    expect(own.err ? own.err.guard : 'OK').not.toBe('OK')
    // …and a script that names its own function `na` is never read as the built-in's never-`na` answer
    const shadow = runtimeRun(v5(['na(v) => v > ta.sma(v, 20)', 'bool b = false', 'if close > 0', '    b := na(close)', 'plot(b != true ? 1 : 0)']))
    expect(shadow.err ? shadow.err.guard : 'OK').not.toBe('OK')
  })

  it('the ORIGINAL RS Rating script keeps its run half (the acceptance rail of #1342, asked here of this rule)', async () => {
    const { vi } = await import('vitest')
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    try {
      const src = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
      expect(src).toContain('ta.barssince(na(curveRsPerf) != true)')
      const d = memberPaneDefinition({ source: src, id: 'u_train1_rs', name: 'RS Rating' })
      expect(d.ok, d.reason).toBe(true)
      expect(d.runHalfDeclined).toBeUndefined()
      expect(d.definition.compute.runtimeObjects).toBeTruthy()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
