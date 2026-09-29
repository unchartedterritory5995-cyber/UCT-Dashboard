// app/src/components/chart/engine/ast/insideBarVarReadOrder.vendor.test.js
//
// ─── ⭐⭐ A `var` READ BEFORE A LATER `:=` IN THE SAME BAR — held against a live capture ──
//
// `inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat`
// (TradingView, NYSE:RDDT 1D, 632 bars from the listing day, captured
// 2026-09-28) latches each breakout once per mother candle:
//
//     var bool breakoutOccurred = false        // (and breakdownOccurred)
//     if isInsideBar()
//         breakoutOccurred := false            // reset, ABOVE the reads
//     breakout  = … and not breakdownOccurred  // read BEFORE the set below
//     breakdown = … and not breakoutOccurred
//     plotshape(breakout and not breakoutOccurred, …)
//     if (breakout)
//         breakoutOccurred := true             // set, BELOW the reads
//
// ⭐ THE RULE, DERIVED FROM THE CAPTURE'S OWN BARS: Pine runs the script top to
// bottom once per bar, so a `var` read at a line holds the value it ENDED the
// previous bar with, carried through only the reassignments written ABOVE that
// line. A replay of the script text in that order reproduces BOTH vendor
// plotshape columns on all 632 bars (42 breakout marks, 34 breakdown marks).
//
// ⛔ THE CONTROLS ARE WHAT MAKE THAT A MEASUREMENT. Read the latch at the END
// of the bar instead and the breakout column never fires; let the reset-only
// half of the latch stand for the whole of it and it fires on far more bars.
// Both disagree with the vendor, so the capture discriminates the ordering.
//
// ⭐⭐ THE RUNTIME LANE ALREADY HAS IT RIGHT, bar for bar, from bar 0. The
// per-bar VM executes statements in order, which is the rule by construction.
//
// ⚠️⚠️ KNOWN DIVERGENCE — THE COLUMNAR DOOR (what the member pane attaches
// today). It diverges twice, and the second makes this script unreachable for
// it without a new capability, which is why it is pinned here rather than
// fixed in the vendor-na lane (2026-09-28):
//   1. every output is resolved against the END-of-program env, so
//      `plotshape(breakout and not breakoutOccurred)` reads the latch already
//      set by this bar's own `breakout` → it can never fire;
//   2. a `var` read between two of its reassignments is folded into an
//      accumulator of the reassignments ABOVE the read only — here a latch that
//      is reset and never set — instead of those reassignments applied to the
//      previous bar's FINAL value.
// Correcting both is a Pine-semantics change (prototype and census on branch
// `pine/var-read-position-proto`), and for THIS script it still cannot produce a
// column: the two latches each read the other before setting their own, so
// their previous bars are coupled, and `accum` carries one `self`. The honest
// columnar answer would be a refusal; the right answer is the runtime lane.
// This case goes red the day the door changes, which is the point of it.
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
const SOURCE = cap.source.text
const bars = cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const vendorCol = (id) => {
  const k = cap.plotValues.fields.indexOf(id)
  expect(k, `the capture carries no ${id}`).toBeGreaterThan(0)
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r[k]]))
  return bars.map((b) => byTime.get(b.t))
}
// The capture's plot order: plot_0 barcolor, plot_1 the breakout shape,
// plot_2 the breakdown shape, plot_3 barcolor (`cap.study.plots`).
const VENDOR_UP = vendorCol('plot_1')
const VENDOR_DOWN = vendorCol('plot_2')

/** The script's own text, replayed top to bottom once per bar.
 *  `order: 'pine'` reads each latch where the script reads it; `'end'` reads it
 *  after the bar's own sets (the control); `'resetOnly'` lets the reset stand
 *  for the whole latch at the `breakout`/`breakdown` lines (the other control). */
function replay(order) {
  let mhigh = NaN
  let mlow = NaN
  let bo = false
  let bd = false
  const up = []
  const down = []
  let boResetOnly = false
  let bdResetOnly = false
  for (let i = 0; i < bars.length; i++) {
    // `high[1] > high and low[1] < low` — `na` on bar 0, so false.
    const inside = i > 0 && bars[i - 1].h > bars[i].h && bars[i - 1].l < bars[i].l
    if (inside) {
      mhigh = bars[i - 1].h
      mlow = bars[i - 1].l
      bo = false
      bd = false
      boResetOnly = false
      bdResetOnly = false
    }
    // `showVolumeThreshold` defaults false → `volumeThreshold` is na → `true`.
    const bdAtRead = order === 'resetOnly' ? bdResetOnly : bd
    const boAtRead = order === 'resetOnly' ? boResetOnly : bo
    const breakout = !Number.isNaN(mhigh) && bars[i].c > mhigh && !bdAtRead
    const breakdown = !Number.isNaN(mlow) && bars[i].c < mlow && !boAtRead
    const boAtPlot = order === 'end' ? (bo || breakout) : boAtRead
    const bdAtPlot = order === 'end' ? (bd || breakdown) : bdAtRead
    up.push(breakout && !boAtPlot ? 1 : 0)
    down.push(breakdown && !bdAtPlot ? 1 : 0)
    if (breakout) bo = true
    if (breakdown) bd = true
  }
  return { up, down }
}

const disagreements = (ours, vendor) => ours.reduce((n, v, i) => n + (v === vendor[i] ? 0 : 1), 0)
const marks = (col) => col.filter((v) => v === 1).length

describe('⭐⭐ a `var` read before a later `:=` holds the previous bar\'s FINAL value — RDDT 1D', () => {
  it('the capture is what this file says it is', () => {
    expect(cap.symbol.pro_name).toBe('NYSE:RDDT')
    expect(bars.length).toBe(632)
    expect(cap.history.startsAtBar0).toBe(true)
    expect(marks(VENDOR_UP)).toBe(42)
    expect(marks(VENDOR_DOWN)).toBe(34)
  })

  it('⭐ the script replayed in Pine order reproduces both vendor columns on every bar', () => {
    const { up, down } = replay('pine')
    expect(disagreements(up, VENDOR_UP)).toBe(0)
    expect(disagreements(down, VENDOR_DOWN)).toBe(0)
  })

  it('⛔ CONTROL: reading the latch at the END of the bar never draws a breakout', () => {
    const { up, down } = replay('end')
    expect(marks(up)).toBe(0)
    expect(disagreements(up, VENDOR_UP)).toBe(42)
    expect(disagreements(down, VENDOR_DOWN)).toBe(34)
  })

  it('⛔ CONTROL: a latch that is only ever reset fires on bars the vendor does not', () => {
    const { up, down } = replay('resetOnly')
    expect(disagreements(up, VENDOR_UP)).toBeGreaterThan(0)
    expect(disagreements(down, VENDOR_DOWN)).toBeGreaterThan(0)
    expect(marks(up)).toBeGreaterThan(marks(VENDOR_UP))
  })

  it('⭐⭐ the runtime lane executes it in order and agrees on all 632 bars from bar 0', () => {
    // `objectTrees: []` says the object program owns the drawing (`line.new`,
    // `line.delete`), exactly as `buildObjectLane` does — the VALUE runtime
    // skips those statements rather than refusing them.
    const built = buildRuntimeIr(SOURCE, { bars, inputs: {}, objectTrees: [] })
    expect(built.ok, built.ok ? '' : JSON.stringify(built.refusal)).toBe(true)
    const program = lowerIrProgram(built.ir)
    const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
    const res = execute(program, {
      bars: bars.length, series, columns: program.columns, confirmed: true,
      barTimes: bars.map((b) => b.t),
    })
    const shapes = program.outputs
      .map((o, k) => ({ call: o.call, col: Array.from(res.outputs[k]) }))
      .filter((o) => o.call === 'plotshape')
    expect(shapes.length).toBe(2)
    // A false shape is "no mark" on both sides: 0 in the capture, 0 or na here.
    const asMarks = (col) => col.map((v) => (v === 1 ? 1 : 0))
    expect(disagreements(asMarks(shapes[0].col), VENDOR_UP)).toBe(0)
    expect(disagreements(asMarks(shapes[1].col), VENDOR_DOWN)).toBe(0)
    expect(marks(asMarks(shapes[0].col))).toBe(42)
  })

  it('⚠️ KNOWN DIVERGENCE: the columnar door never draws a breakout or a breakdown mark', () => {
    // ⛔ THIS PINS THE WRONG ANSWER ON PURPOSE, labelled as one (see the header):
    // it goes red the day the door stops reading the latch at the end of the bar.
    const t = translatePine(SOURCE, { strict: true, basePeriod: 'D' })
    const shapes = t.outputs.filter((o) => o.formula && /accum\(/.test(o.formula))
    expect(shapes.length).toBe(2)
    for (const o of shapes) {
      const got = Array.from(interpret(parseFormula(o.formula).ast, bars, {}, undefined, undefined,
        { tf: 'D', newestBarIsForming: false }))
      expect(got.filter((v) => v === 1)).toEqual([])
    }
    // …where the vendor draws 42 and 34 (the first case above), so the door's
    // silence is a divergence and not an agreement on a quiet chart.
    expect(marks(VENDOR_UP) + marks(VENDOR_DOWN)).toBe(76)
  })
})
