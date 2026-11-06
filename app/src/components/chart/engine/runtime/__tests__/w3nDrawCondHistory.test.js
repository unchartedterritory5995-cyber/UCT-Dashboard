// app/src/components/chart/engine/runtime/__tests__/w3nDrawCondHistory.test.js
//
// W3W4-D1 - THE DRAWING BUILD SERVES THE PER-CALL-SITE SET THE PLOT LANE SERVES.
//
// A drawing whose value reads `ta.sma` / `ta.ema` / `ta.rma` written inside a block
// that runs on SOME bars reads that call site's own history (Pine execution model),
// the SAME value a plot reads. ONE served set (`servedCondCall`), two builds.
//
// PINNED by: C48 `vw-call-site-history-{rddt,spy}-1d-2026-10-01` - C03 / C04 (`sma(3)`,
// `ema(3)` in `if close > open`, one plot value per run) and D02 (every other bar).
// The drawing's y is graded against those VENDOR plot values. The witnesses carry no
// drawing whose y reads the set, so the DIFFERENTIAL against the plot lane (on bars
// the block SKIPS) is the second rail. NOT served, refused by name: `ta.stdev` /
// `highest`, `ta.change` in a block, a block local's `[1]`, a loop body, a function
// body.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const load = (n) => JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'))
const CAPS = {
  rddt: load('vw-call-site-history-rddt-1d-2026-10-01.json'),
  spy: load('vw-call-site-history-spy-1d-2026-10-01.json'),
}
const R4 = 'runtime:conditional-history'
const NL = String.fromCharCode(10)
const SRC = (...lines) => ['//@version=6', 'indicator("t", overlay = true, max_labels_count = 500)', ...lines].join(NL)

const barsOf = (cap) => cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
const seriesOf = (bars) => ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
// plotValues rows are keyed by TIME and omit bars the study has no row for: align to the bars.
const col = (cap, title) => {
  const plot = cap.study.plots.find((p) => p.title === title)
  const at = cap.plotValues.fields.indexOf(plot.id)
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r[at]]))
  return cap.bars.rows.map((b) => (byTime.has(b[0]) ? byTime.get(b[0]) : null))
}
// A capture that does not start at the listing (`history.startsAtBar0` false) was seeded by runs
// before its first bar: grade a window from the bar where OUR run count fills it, an EMA once its
// seed has decayed (a relative 1e-6 after 400 bars).
const warmFrom = (cap, kind) => (cap.history.startsAtBar0 ? 0 : (kind === 'ema' ? 400 : 12))
const kept = (ys, i) => i >= ys.firstKept
const same = (a, b, tol = 1e-9) => (a == null || Number.isNaN(a)
  ? (b == null || Number.isNaN(b))
  : (b != null && !Number.isNaN(b) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))))

function drawn(bars, src) {
  const built = buildRuntimeIr(src, { bars, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D', w3nD1ServeDrawingHistory: true })
  if (!built.ok) throw new Error(`drawing build refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: bars.length, series: seriesOf(bars), columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t),
  })
  const ys = new Array(bars.length).fill(undefined)
  let firstKept = bars.length
  for (const o of res.objects.finish().live) if (o.family === 'label') { ys[o.createdBar] = o.props.y; firstKept = Math.min(firstKept, o.createdBar) }
  ys.firstKept = firstKept // older labels were collected at max_labels_count (500)
  return ys
}
function plotted(bars, src) {
  const built = buildRuntimeIr(src, { bars, inputs: {}, pane: true })
  if (!built.ok) throw new Error(`plot lane refused ${built.refusal.guard}`)
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const r = execute(program, { bars: bars.length, series: seriesOf(bars), columns: program.columns, confirmed: true })
  return Array.from(r.outputs[0])
}
// `serve` = the TEST-ONLY option that lifts the capture gate (DRAWING_HISTORY_CAPTURED = false in product)
const refusal = (bars, body, serve = true) => {
  const b = buildRuntimeIr(SRC(...body), { bars, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D',
    ...(serve ? { w3nD1ServeDrawingHistory: true } : {}) })
  return b.ok ? null : b.refusal.guard
}

describe.each(['rddt', 'spy'])('W3W4-D1 %s - a drawing reads the per-call-site set (vendor-graded)', (sym) => {
  const cap = CAPS[sym]
  const bars = barsOf(cap)
  const up = bars.map((b) => b.c > b.o)
  it('sma(3) in `if close > open`: label y equals the VENDOR C03 plot on every UP bar; no label on a skipped bar', () => {
    const ys = drawn(bars, SRC('if close > open', '    label.new(bar_index, ta.sma(close, 3), "x")'))
    const want = col(cap, 'C03_sma3_cond')
    bars.forEach((_, i) => {
      if (!up[i]) { expect(ys[i], `skipped bar ${i} drew`).toBeUndefined(); return }
      if (i >= Math.max(warmFrom(cap, 'sma'), ys.firstKept)) expect(same(ys[i], want[i]), `bar ${i}: ${ys[i]} vs ${want[i]}`).toBe(true)
    })
    // control: the every-bar sma is NOT the per-run one, so this rail can tell them apart
    const every = col(cap, 'E03_sma3_every_bar')
    expect(bars.some((_, i) => up[i] && want[i] != null && !same(want[i], every[i]))).toBe(true)
  })
  it('ema(3): label y equals the VENDOR C04 plot on every UP bar', () => {
    const ys = drawn(bars, SRC('if close > open', '    label.new(bar_index, ta.ema(close, 3), "x")'))
    const want = col(cap, 'C04_ema3_cond')
    bars.forEach((_, i) => { if (up[i] && i >= Math.max(warmFrom(cap, 'ema'), ys.firstKept)) expect(same(ys[i], want[i], 1e-6), `bar ${i}: ${ys[i]} vs ${want[i]}`).toBe(true) })
  })
  it('every other bar: sma(3) over EXECUTIONS equals the VENDOR D02 plot', () => {
    const ys = drawn(bars, SRC('if bar_index % 2 == 0', '    label.new(bar_index, ta.sma(close, 3), "x")'))
    const want = col(cap, 'D02_sma3_even')
    bars.forEach((_, i) => { if (i % 2 === 0 && i >= Math.max(warmFrom(cap, 'sma'), ys.firstKept)) expect(same(ys[i], want[i]), `bar ${i}: ${ys[i]} vs ${want[i]}`).toBe(true) })
  })
})

describe('W3W4-D1 - differential: the drawing y is the plot lane value on every bar the block runs', () => {
  const bars = barsOf(CAPS.rddt)
  const up = bars.map((b) => b.c > b.o)
  it.each([['ta.sma(close, 3)'], ['ta.ema(close, 3)'], ['ta.rma(close, 4)'], ['ta.sma(close * 2, 5) + 1']])('%s', (expr) => {
    const ys = drawn(bars, SRC('if close > open', `    label.new(bar_index, ${expr}, "x")`))
    const plot = plotted(bars, SRC('float v = na', 'if close > open', `    v := ${expr}`, 'plot(v)'))
    bars.forEach((_, i) => { if (up[i] && kept(ys, i)) expect(same(ys[i], plot[i]), `bar ${i}: ${ys[i]} vs ${plot[i]}`).toBe(true) })
  })
  it('two sites with the same text keep TWO rings (not one shared)', () => {
    const ys = drawn(bars, SRC('if close > open', '    label.new(bar_index, ta.sma(close, 3), "a")',
      'if close < open', '    label.new(bar_index, ta.sma(close, 3), "b")'))
    const upPlot = plotted(bars, SRC('float v = na', 'if close > open', '    v := ta.sma(close, 3)', 'plot(v)'))
    const dnPlot = plotted(bars, SRC('float v = na', 'if close < open', '    v := ta.sma(close, 3)', 'plot(v)'))
    bars.forEach((b, i) => {
      if (!kept(ys, i)) return
      if (b.c > b.o) expect(same(ys[i], upPlot[i]), `up ${i}`).toBe(true)
      else if (b.c < b.o) expect(same(ys[i], dnPlot[i]), `down ${i}: ${ys[i]} vs ${dnPlot[i]}`).toBe(true)
    })
  })
})

describe('W3W4-D1 - everything else keeps runtime:conditional-history by name', () => {
  const bars = barsOf(CAPS.rddt)
  it.each([
    ['ta.stdev', ['if close > open', '    label.new(bar_index, ta.stdev(close, 3), "x")']],
    ['ta.highest', ['if close > open', '    label.new(bar_index, ta.highest(high, 3), "x")']],
    ['ta.change in a block', ['if close > open', '    label.new(bar_index, ta.change(close), "x")']],
    ['a block local [1]', ['if close > open', '    bx = bar_index', '    label.new(bar_index, bx[1], "x")']],
    ['sma in a loop body', ['for i = 0 to 1', '    if close > open', '        label.new(bar_index, ta.sma(close, 3) + i, "x")']],
    ['sma in a function body', ['f(x) =>', '    ta.sma(x, 3)', 'if close > open', '    label.new(bar_index, f(close), "x")']],
    // a binding made in ONE block, read in ANOTHER: its history is the first block's runs, not the second's
    ['a series with history bound in another branch', ['if close > open', '    s = ta.sma(close, 3)', 'if bar_index % 2 == 0', '    label.new(bar_index, s, "x")']],
  ])('%s', (_n, body) => {
    expect(refusal(bars, body)).toBe(R4)
  })
  it('control: the same sma on EVERY bar builds (the refusal is the block, not the call)', () => {
    expect(refusal(bars, ['v = ta.sma(close, 3)', 'if close > open', '    label.new(bar_index, v, "x")'])).toBeNull()
  })
})

describe('W3W4-D1 - the capture gate (DRAWING_HISTORY_CAPTURED = false): no drawing capture, so refused by name', () => {
  const bars = barsOf(CAPS.rddt)
  it.each([
    ['ta.sma', 'ta.sma(close, 3)'], ['ta.ema', 'ta.ema(close, 3)'], ['ta.rma', 'ta.rma(close, 4)'],
    ['sma inside arithmetic', 'ta.sma(close, 3) + 1'],
  ])('%s is refused without the test option', (_n, expr) => {
    expect(refusal(bars, ['if close > open', `    label.new(bar_index, ${expr}, "x")`], false)).toBe(R4)
  })
  it('the same shapes build with the test option (control: the gate, not the shape, refused)', () => {
    expect(refusal(bars, ['if close > open', '    label.new(bar_index, ta.sma(close, 3), "x")'], true)).toBeNull()
    expect(refusal(bars, ['if close > open', '    label.new(bar_index, ta.rma(close, 4), "x")'], true)).toBeNull()
  })
  it('the option is read from opts only (a product caller passes none): default build refuses', () => {
    const b = buildRuntimeIr(SRC('if close > open', '    label.new(bar_index, ta.ema(close, 3), "x")'),
      { bars, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D' })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe(R4)
  })
})

describe('W3W4-D1 - gate off leaves the drawing build exactly as master (nothing member-visible moves)', () => {
  const bars = barsOf(CAPS.rddt)
  it('a block local [1] is NOT refused with the gate off (master behaviour, kept until W3N-D1 D04 MATCHes); it IS refused with the option', () => {
    const body = ['if close > open', '    bx = bar_index', '    label.new(bar_index, bx[1], "x")']
    expect(refusal(bars, body, false)).toBeNull()
    expect(refusal(bars, body, true)).toBe(R4)
  })
})

describe('W3W4-D1 - the gate-on path is the MAIN BODY only (a function body is not reopened)', () => {
  const bars = barsOf(CAPS.rddt)
  // A function whose body is an if/else around ta.sma, called at the top level, builds on master and
  // with the gate off. Opening the drawing history inside a function body (dropping `owner === null`)
  // would refuse it, so gate on must leave it exactly as it was.
  const FN = ['f() =>', '    if close > open', '        ta.sma(close, 3)', '    else', '        close',
    'label.new(bar_index, f(), "x")']
  it('builds with the gate off AND with the test option (identical)', () => {
    expect(refusal(bars, FN, false)).toBeNull()
    expect(refusal(bars, FN, true)).toBeNull()
  })
})
