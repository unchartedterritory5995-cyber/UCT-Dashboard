// app/src/components/chart/engine/ast/varReadOrderLanes.test.js
//
// ─── ⭐⭐ THE VAR-READ-ORDER RULE, HELD AGAINST THE RUNTIME LANE ON REAL BARS ──
//
// `pine.js` (2026-09-28) resolves a `var` by WHERE it is read:
//   (a) an output reads each reassigned name as it stands at the output's own
//       line, never against the end-of-program value;
//   (b) a read between two of a `var`'s reassignments is the reassignments
//       ABOVE the read applied to the previous bar's FINAL value (`E[1]`).
// Derived from a TradingView capture (`insideBarVarReadOrder.vendor.test.js`).
//
// ⭐ THE REFERENCE HERE IS THE RUNTIME LANE — the per-bar VM, which runs the
// statements in source order and is therefore the rule by construction. Each
// case is an idiom lifted VERBATIM from a corpus script whose columns this rule
// moved, reduced only to what the lifted lines need (the rest of each script
// stops the runtime lane for unrelated reasons, so the whole script cannot be
// compared). Compared on the RDDT 1D capture's 632 real bars, from bar 251 —
// before that the columnar `accum` is still in its declared warm-up.
//
// ⛔ AND THE TWO SHAPES THE COLUMNAR LANE CANNOT HOLD ARE NAMED REFUSALS, one of
// which the product routes elsewhere:
//   - two latches that each read the other before setting their own — one
//     accumulator carries one `self` — refuse `pine:state` carrying
//     `route: 'runtime'`, the marker `paneGate.runtimeRouteOf` reads;
//   - a latch that fires only while it is unset (`if na(first)`) holds the
//     window's FIRST bar for ever, so a 250-bar `accum` would draw
//     `bar_index - 249` where Pine draws 0 — it refuses, unrouted.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { parseFormula } from './parse.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'

const REPO = path.resolve(process.cwd(), '..')
const CAPTURE = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness',
  'inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat-rddt-1d-2026-09-28.json')
const cap = JSON.parse(fs.readFileSync(CAPTURE, 'utf8'))
const bars = cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const FROM = 251

function columnar(source) {
  const t = translatePine(source, { strict: true, basePeriod: 'D' })
  return {
    t,
    cols: t.outputs.map((o) => (o.formula
      ? Array.from(interpret(parseFormula(o.formula).ast, bars, {}, undefined, undefined,
        { tf: 'D', newestBarIsForming: false }))
      : null)),
  }
}

function runtime(source) {
  const built = buildRuntimeIr(source, { bars, inputs: {}, objectTrees: [] })
  expect(built.ok, built.ok ? '' : JSON.stringify(built.refusal)).toBe(true)
  const program = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const res = execute(program, {
    bars: bars.length, series, columns: program.columns, confirmed: true,
    barTimes: bars.map((b) => b.t),
  })
  return program.outputs.map((o, k) => Array.from(res.outputs[k]))
}

/** A mark is a mark: 0 and `na` both draw nothing on either lane. */
const mark = (v) => (Number.isFinite(v) && v !== 0 ? 1 : 0)
function disagreements(a, b) {
  let n = 0
  for (let i = FROM; i < bars.length; i++) if (mark(a[i]) !== mark(b[i])) n += 1
  return n
}
const marks = (col) => col.slice(FROM).filter((v) => mark(v) === 1).length

// `multicator-table__486858895c.pine` lines 555–596, defaults folded in (preset
// 'Manual': RSI 14, divLook 5, showDiv true). `lastPh` is read by
// `if not na(lastPh)` ABOVE its own `lastPh := phDiv` in the same block.
// ⚠️ The one substitution: the script's MACD line is spelled as its definition,
// `ta.ema(close, 12) - ta.ema(close, 26)`, because the host table's `macd` takes
// three arguments and the four-argument tuple form refuses `pine:arity` in a
// script this short. The line under test is the `var` reads, not the MACD.
const MULTICATOR = `//@version=6
indicator("multicator divergence (reduced)", overlay = true)
divLook = 5
rsi = ta.rsi(close, 14)
macdLine = ta.ema(close, 12) - ta.ema(close, 26)
phDiv = ta.pivothigh(divLook, divLook)
plDiv = ta.pivotlow(divLook, divLook)
var float lastPh = na
var float lastPhRsi = na
var float lastPhMacd = na
var float lastPl = na
var float lastPlRsi = na
var float lastPlMacd = na
bearRsiDiv = false
bullRsiDiv = false
bearMacdDiv = false
bullMacdDiv = false
if not na(phDiv)
    float pr = rsi[divLook]
    float pm = macdLine[divLook]
    if not na(lastPh)
        if phDiv > lastPh and pr < lastPhRsi
            bearRsiDiv := true
        if phDiv > lastPh and pm < lastPhMacd
            bearMacdDiv := true
    lastPh := phDiv
    lastPhRsi := pr
    lastPhMacd := pm
if not na(plDiv)
    float lr = rsi[divLook]
    float lm = macdLine[divLook]
    if not na(lastPl)
        if plDiv < lastPl and lr > lastPlRsi
            bullRsiDiv := true
        if plDiv < lastPl and lm > lastPlMacd
            bullMacdDiv := true
    lastPl := plDiv
    lastPlRsi := lr
    lastPlMacd := lm
plotshape(bullRsiDiv, title = 'RSI bull div')
plotshape(bearRsiDiv, title = 'RSI bear div')
plotshape(bullMacdDiv, title = 'MACD bull div')
plotshape(bearMacdDiv, title = 'MACD bear div')
`

// A plot ABOVE a reassignment (rule a): `x` at the plot is the value before
// this bar's `:=`, i.e. last bar's — the runtime answers that by construction.
const PLOT_ABOVE = `//@version=5
indicator("plot above a reassignment")
var float x = 0.0
plot(x, "before")
if close > open
    x := close
plot(x, "after")
`

// The two latches of `inside-bar-range-mother-candle-…` (lines as captured).
const COUPLED = `//@version=5
indicator("coupled latches")
var bool bo = false
var bool bd = false
if high[1] > high and low[1] < low
    bo := false
    bd := false
up = close > high[1] and not bd
dn = close < low[1] and not bo
plotshape(up and not bo)
plotshape(dn and not bd)
if up
    bo := true
if dn
    bd := true
`

// `long_tail__04-warm-up-curtain.pine`'s first-valid-bar latch.
const LATCH_ONCE = `//@version=5
indicator("latch once")
var int firstA = na
if na(firstA) and not na(close)
    firstA := bar_index
plot(firstA)
`

// `institutional-smc-order-flow-matrix-pro`'s structure break, reduced: the level
// is read inside `ta.crossover` in the very `if` that resets it, so the read sits
// inside the level's OWN update, under a window call the step loop cannot run.
const UNSTEPPABLE = `//@version=5
indicator("a level read under crossover inside its own update")
var float lvl = na
ph = ta.pivothigh(high, 3, 3)
if not na(ph)
    lvl := ph
brk = not na(lvl) and ta.crossover(close, lvl)
if brk
    lvl := na
plotshape(brk)
`

describe('⭐⭐ a `var` read by position — columnar lane vs runtime lane, RDDT 1D', () => {
  it('⭐ multicator\'s divergence marks agree bar for bar, and are not a quiet chart', () => {
    const { t, cols } = columnar(MULTICATOR)
    expect(t.ok, JSON.stringify(t.refusals)).toBe(true)
    const ref = runtime(MULTICATOR)
    expect(cols.length).toBe(4)
    for (let k = 0; k < 4; k++) expect(disagreements(cols[k], ref[k]), `plotshape ${k}`).toBe(0)
    // ⛔ NON-VACUITY: agreement on four empty columns would prove nothing.
    expect(cols.reduce((n, c) => n + marks(c), 0)).toBeGreaterThan(0)
  })

  it('⭐ a plot above a reassignment reads last bar\'s value; the one below reads this bar\'s', () => {
    const { t, cols } = columnar(PLOT_ABOVE)
    expect(t.ok, JSON.stringify(t.refusals)).toBe(true)
    const ref = runtime(PLOT_ABOVE)
    let before = 0; let after = 0; let differ = 0
    for (let i = FROM; i < bars.length; i++) {
      if (cols[0][i] === ref[0][i]) before += 1
      if (cols[1][i] === ref[1][i]) after += 1
      if (ref[0][i] !== ref[1][i]) differ += 1
    }
    expect(before).toBe(bars.length - FROM)
    expect(after).toBe(bars.length - FROM)
    // ⛔ …and the two lines really are different, or (a) was not exercised.
    expect(differ).toBeGreaterThan(0)
  })

  it('⛔ two latches that read each other refuse pine:state, routed to the runtime lane', () => {
    const { t } = columnar(COUPLED)
    expect(t.ok).toBe(false)
    const shapes = t.outputs.filter((o) => o.kind === 'plotshape')
    expect(shapes.length).toBe(2)
    for (const o of shapes) {
      expect(o.refusal && o.refusal.guard).toBe('pine:state')
      expect(o.refusal.route).toBe('runtime')
    }
    // …and the lane it is routed to builds it.
    expect(runtime(COUPLED).length).toBe(2)
  })

  it('⛔ a read under a window call inside its own update refuses at TRANSLATION, routed', () => {
    // ⚰️ It used to translate and then refuse at EVALUATION (`interpret:recurrence`),
    // which silently dropped whatever it gated — 0 structure lines on the
    // institutional-smc capture where TradingView holds 18, with no disclosure.
    const { t } = columnar(UNSTEPPABLE)
    const r = t.outputs[0].refusal
    expect(r && r.guard).toBe('pine:state')
    expect(r.route).toBe('runtime')
    expect(r.message).toMatch(/crossOver/)
    // …and the lane it names runs it, with marks to draw.
    const ref = runtime(UNSTEPPABLE)
    expect(ref[0].filter((v) => mark(v) === 1).length).toBeGreaterThan(0)
  })

  it('⛔ a latch that fires only while unset refuses — the window would draw bar_index - 249', () => {
    const { t } = columnar(LATCH_ONCE)
    expect(t.ok).toBe(false)
    const r = t.outputs[0].refusal
    expect(r && r.guard).toBe('pine:state')
    expect(r.route).toBeUndefined()
    // The runtime lane's answer, which the refused fold would have missed: 0 on
    // every bar (the capture starts at the listing bar).
    const ref = runtime(LATCH_ONCE)
    expect(ref[0].slice(FROM).every((v) => v === 0)).toBe(true)
  })
})
