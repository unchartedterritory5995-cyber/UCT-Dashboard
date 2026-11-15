// app/src/components/chart/engine/runtime/__tests__/l4cArmDrawing.test.js
//
// ─── L4c — A DRAWING MADE IN THE THEN ARM OF `?:`, IN THE DRAWING BUILD ──────
//
// Pine evaluates only the arm a `?:` picks, so `t = c ? label.new(…) : na` makes a
// label only on the bars where `c` is true, and `t` is `na` on the rest. The
// drawing build (RT5, `objectsInRun`) lowered both arms on every bar, so it refused
// every drawing call in an arm (`runtime:object-op`). It now lowers exactly the
// WITNESSED shape as a jump (`lowerIr.js`, `EXPR.TERNARY` `lazy`), so the arm runs
// only when it is taken:
//
//   · a root declaration `t = <test> ? label.new(…) | line.new(…) : na`
//     (not in a function body, a loop, a block, another arm, a request's value);
//   · whose drawing call's arguments keep no state and have no effect of their own.
//
// The witnesses:
//   · Q-RT5a `vw-rt5-arm-draw-block-history-rddt-1d-2026-10-03` (v6) rows T01/T02:
//     a `label.new` in the THEN arm is made on the 308 UP bars only, and the handle
//     is present exactly on those bars. Graded HERE against the capture's own bars.
//   · Q-O1a `vw-ternary-draw-helper-rddt-1d-2026-10-02` (v5): a drawing helper in the
//     THEN arm draws on exactly the bars its test is true (T01 243 labels), and its
//     `line.delete(ln)` of an `na` `var` deletes nothing (T02: ONE line). TradingView's
//     to-v5 guide: "the ternary operator is evaluated lazily".
//   · `vw-object-gc-c` O1: `label.delete(cl[1])` deletes the PREVIOUS bar's label.
// Every other drawing-in-an-arm shape keeps `runtime:object-op` by name; each admitted
// rail has a control that must come out the other way.
//
// RS Rating (Fred6724, MPL-2.0) draws its rating so:
//     label1 = (hideRSRat == false) and barstate.islast ? label.new(bar_index, rs, …) : na
//     label.delete(label1[1])
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { N, BARS, SERIES, C, O, RS_RATING_MATH, rsByHand } from '../__fixtures__/rsRatingSynthetic.js'

const T = 60000

/** Build in the drawing build, run over `bars`, and answer the plots and the store. */
function runDrawing(src, bars = BARS, inputs = {}) {
  const built = buildRuntimeIr(src, {
    bars, inputs, objectsInRun: true, tf: 'D', basePeriod: 'D', ...runtimeClockOpts(false, { tf: 'D' }),
  })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const res = execute(program, {
    bars: bars.length, series, columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t),
  })
  return { outputs: res.outputs.map((o) => Array.from(o)), fin: res.objects.finish() }
}
const refusalOf = (src) => {
  const built = buildRuntimeIr(src, {
    bars: BARS, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D', ...runtimeClockOpts(false, { tf: 'D' }),
  })
  return built.ok ? null : built.refusal.guard
}
const labels = (fin) => fin.live.filter((o) => o.family === 'label')
const pine = (v, decl, ...lines) => [`//@version=${v}`, `indicator("t"${decl})`, ...lines].join('\n') + '\n'

// ─── the vendor witness, graded against the capture's own bars ──────────────
// (the harness's own root: the repo is the parent of `app/`, `vendorHarness/harness.js` REPO)
const CAP = JSON.parse(readFileSync(path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/vw-rt5-arm-draw-block-history-rddt-1d-2026-10-03.json'), 'utf8'))
const capCol = (title) => {
  const plot = CAP.study.plots.find((p) => p.title === title)
  const at = CAP.plotValues.fields.indexOf(plot.id)
  return CAP.plotValues.rows.map((r) => r[at])
}
const CAP_BARS = CAP.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
// The probe's T01/T02 lines, as captured (its B01 block-local rows are another lane).
const PROBE_T = (v) => pine(v, ', overlay = true, max_labels_count = 500',
  't = close > open ? label.new(bar_index, high, "T01|" + str.tostring(bar_index)) : na',
  'plot(na(t) ? 0 : 1, "T02_arm_handle_present")')

describe('Q-RT5a T01/T02 — a label.new in the THEN arm is made only on the bars that arm runs', () => {
  const up = CAP_BARS.map((b) => b.c > b.o)
  it('the witness is what this rail says it is: 636 bars from the listing, 308 UP bars, 308 labels', () => {
    expect(CAP.history.startsAtBar0).toBe(true)
    expect(CAP_BARS).toHaveLength(636)
    expect(up.filter(Boolean)).toHaveLength(308)
    expect(CAP.objects.counts.labels).toBe(308)
  })
  it.each([6, 5])('v%i: our labels are the vendor\'s — text multiset, y = the bar\'s high; T02 equals the vendor column', (v) => {
    const { outputs, fin } = runDrawing(PROBE_T(v), CAP_BARS)
    const ours = labels(fin)
    expect(ours).toHaveLength(308)
    expect(ours.map((l) => l.props.text).sort()).toEqual([...CAP.objects.texts.labels].sort())
    for (const l of ours) expect(l.props.y).toBe(CAP_BARS[l.props.x].h)
    const vendorY = CAP.objects.records.labels.map((r) => r.y)
    expect(ours.map((l) => l.props.y)).toEqual(vendorY)
    expect(outputs[0]).toEqual(capCol('T02_arm_handle_present'))
    expect(fin.stats.created).toBe(308)
  }, T)
})

// ─── RS Rating's label shape, over synthetic bars, against the hand computation ───
const RS_LABELS = [
  'hideRSRat   = input(false, title=\'Hide Rating\', group = \'RS Line\')',
  'ratingOnly  = input(false, title=\'Rating Only\', group = \'RS Line\')',
  'colorRS     = input(color.rgb(0, 0, 255,0), title = \'Color\', group = \'RS Line\', inline = \'a\')',
  'SpxValue    = input(4200, title=\'Approximate Value of Comparative Symbol\', group = \'Shape & Offset\')',
  'offset      = input.int(80, minval = 0, maxval = 2000, title=\'Offset (%)\', group = \'Shape & Offset\')',
  ...RS_RATING_MATH,
  'var float comparativeSymbol = na',
  'comparativeSymbol := open * 0.5 + 60',
  'rsCurve             = (close/comparativeSymbol)',
  'rsRatio             = timeframe.isweekly ? SpxValue*(offset-10)/100:SpxValue*offset/100',
  'rs                  = rsCurve*rsRatio',
  'isDaily = timeframe.isdaily',
  'labelText1 = \'                RS Rating\'',
  'labelText2 = \'\'',
  'if (isDaily and totalRsRating != -1)',
  '    labelText2 := \'\\n\\n       \'+str.tostring(totalRsRating,\'#0\')',
  'if (ratingOnly)',
  '    labelText1 := \'\'',
  '    labelText2 := \'\\n    \'+str.tostring(totalRsRating,\'#0\')',
  'label1 = (hideRSRat == false) and barstate.islast ? label.new(bar_index, rs, text=labelText1 , color = color.rgb(0,0,0,100), size=size.normal, textcolor=colorRS, style=label.style_label_center, textalign=text.align_left, yloc=yloc.price) : na',
  'label2 = (hideRSRat == false) and barstate.islast ? label.new(bar_index, rs, text=labelText2 , color = color.rgb(0,0,0,100), size=size.large,  textcolor=colorRS, style=label.style_label_center, textalign=text.align_left, yloc=yloc.price) : na',
  'label.delete(label1[1])',
  'label.delete(label2[1])',
  'plot(totalRsRating, title=\'RS Rating value\')',
]
const RS = pine(5, ', overlay = true, max_bars_back = 253', ...RS_LABELS)

describe('RS Rating\'s rating labels build in the drawing build and equal the hand computation', () => {
  const hand = rsByHand()
  const last = N - 1
  const rating = hand.rating[last]
  // `'#0'`: a whole number, rounded (`formatPlainNumber`; the `#` integer pattern is
  // witnessed on `barstate-full` N13/N14). A tie would be unwitnessed, so the data has none.
  const rounded = String(Math.round(rating))
  const rsLast = C[last] / (O[last] * 0.5 + 60) * (4200 * 80 / 100)

  it('the hand rating at the last bar is a percentile branch, not a tie, so the text is not vacuous', () => {
    expect(rating).toBeGreaterThan(1)
    expect(rating).toBeLessThan(99)
    expect(rating).not.toBe(Math.round(rating))
    expect(Math.abs(rating - Math.trunc(rating))).not.toBe(0.5)
  })
  it('exactly one label of each site is alive at the end, on the last bar, with the hand text and y; each site made ONE label', () => {
    const { outputs, fin } = runDrawing(RS)
    expect(fin.status).toBe('ok')
    expect(outputs[0][last]).toBeCloseTo(rating, 9)
    const ls = labels(fin)
    expect(ls).toHaveLength(2)
    for (const l of ls) {
      expect(l.props.x).toBe(last)
      expect(l.props.y).toBeCloseTo(rsLast, 9)
    }
    const texts = ls.map((l) => l.props.text)
    expect(texts).toContain('                RS Rating')
    expect(texts).toContain(`\n\n       ${rounded}`)
    expect(ls.map((l) => l.props.size).sort()).toEqual(['large', 'normal'])
    // Pine makes them on the last bar only: two creates, and `label.delete(na)` deletes nothing.
    expect(fin.stats.created).toBe(2)
    expect(fin.stats.deleted).toBe(0)
  }, T)
  it('`ratingOnly` on: label 1 is empty, label 2 the rating with its own spacing', () => {
    const { fin } = runDrawing(RS, BARS, { ratingOnly: 1 })
    expect(labels(fin).map((l) => l.props.text).sort()).toEqual(['', `\n    ${rounded}`].sort())
  }, T)
  it('CONTROL: `hideRSRat` on — the arm is never taken, nothing is made', () => {
    const { fin } = runDrawing(RS, BARS, { hideRSRat: 1 })
    expect(labels(fin)).toHaveLength(0)
    expect(fin.stats.created).toBe(0)
  }, T)
})

// ─── the shapes no witness covers keep the refusal, by name ──────────────────
describe('controls — every other drawing in an arm still refuses runtime:object-op', () => {
  const W = (...lines) => pine(6, ', overlay = true, max_labels_count = 500', ...lines)
  it('CONTROL (admitted): the witnessed shape builds', () => {
    expect(refusalOf(W('t = close > open ? label.new(bar_index, high) : na'))).toBe(null)
  })
  // ⭐ L4d: a label in the ELSE arm and a box in the THEN arm are now witnessed (Q-RS5 E01 / X01,
  // `l4dArmShapes.test.js`); the pairs no capture shows keep the refusal.
  it.each([
    ['a line in the ELSE arm', 't = close > open ? na : line.new(bar_index, high, bar_index + 1, high)'],
    ['a box in the ELSE arm', 't = close > open ? na : box.new(bar_index, high, bar_index + 1, low)'],
    ['a drawing in both arms', 't = close > open ? label.new(bar_index, high) : label.new(bar_index, low)'],
    ['an ELSE arm that is not `na`', 'var label k = na\nt = close > open ? label.new(bar_index, high) : k'],
    ['a THEN arm that is not `na` around an ELSE label', 'var label k = na\nt = close > open ? k : label.new(bar_index, high)'],
    ['a family no witness covers (table)', 't = barstate.islast ? table.new(position.top_right, 1, 1) : na'],
    ['a `?:` inside another arm', 't = close > open ? (high > low ? label.new(bar_index, high) : na) : na'],
    ['a `?:` that is not the whole value', 'label.delete(close > open ? label.new(bar_index, high) : na)'],
    ['inside an `if` block', 'if bar_index % 2 == 0\n    t = close > open ? label.new(bar_index, high) : na'],
    ['inside a function body', 'f() =>\n    close > open ? label.new(bar_index, high) : na\nt = f()'],
    ['an argument that calls a user function (its body would run only on the taken bars)', 'f(x) =>\n    x * 2\nt = close > open ? label.new(bar_index, f(high)) : na'],
  ])('%s', (_, body) => {
    expect(refusalOf(W(body))).toBe('runtime:object-op')
  })
  it('an argument that keeps state (`ta.sma` would step only on the taken bars): history in an arm, by name', () => {
    expect(refusalOf(W('t = close > open ? label.new(bar_index, ta.sma(close, 5)) : na'))).toBe('runtime:conditional-history')
  })
  it('CONTROL (admitted): the same `ta.sma` bound on its own line runs every bar and builds', () => {
    expect(refusalOf(W('m = ta.sma(close, 5)', 't = close > open ? label.new(bar_index, m) : na'))).toBe(null)
  })
})
