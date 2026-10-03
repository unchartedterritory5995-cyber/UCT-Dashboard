// app/src/components/chart/engine/ast/runtimeDiscardedValue.vendor.test.js
//
// ─── ⭐⭐ R1 — A LONE VALUE CLOSING AN `if` BODY IS DISCARDED — RDDT 1D ──────
//
// `btc-charlie-trader-xo-macro-trend-scanner` writes Pine's v4→v5 converter
// idiom (@L36–38):
//
//     if buy
//         countBuy += 1
//         countBuy
//
// The last line is the `if`'s value, and an `if` used as a statement gives its
// value to nobody. The runtime lane refused it as "a statement shape this front
// end does not recognise"; R1 lowers such an ATOM (to keep its own refusals)
// and discards it. This holds the script's numeric plots and both signal
// shapes against the vendor's capture on every bar.
//
// ⛔ The `barcolor` / `bgcolor` rows are colours and are not compared here (a
// packed colour is not a plot value); `alertcondition` rows are not plots.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'

const REPO = path.resolve(process.cwd(), '..')
const CAPTURE = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness',
  'btc-charlie-trader-xo-macro-trend-scanner-rddt-1d-2026-09-30.json')
const cap = JSON.parse(fs.readFileSync(CAPTURE, 'utf8'))
const SOURCE = cap.source.text
const bars = cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const vendorCol = (id) => {
  const k = cap.plotValues.fields.indexOf(id)
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r[k]]))
  return bars.map((b) => byTime.get(b.t))
}

/** `na` agrees with `na`; a false shape is 0 in the capture and 0 or `na` here. */
const same = (ours, vendor) => {
  if (vendor === null || vendor === undefined) return ours === null || Number.isNaN(ours)
  if (vendor === 0 && Number.isNaN(ours)) return true
  return Math.abs(ours - vendor) <= 1e-9 * Math.max(1, Math.abs(vendor))
}
const disagreements = (ours, vendor) => ours.reduce((n, v, i) => n + (same(v, vendor[i]) ? 0 : 1), 0)

const runLane = () => {
  const built = buildRuntimeIr(SOURCE, { bars, inputs: {}, tf: 'D', ...runtimeClockOpts(false) })
  expect(built.ok, built.ok ? '' : JSON.stringify(built.refusal)).toBe(true)
  const program = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const res = execute(program, {
    bars: bars.length, series, columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t),
  })
  return { outs: program.outputs.map((o, k) => ({ call: o.call, col: Array.from(res.outputs[k]) })), built }
}

// output index in the runtime lane → the vendor's plot field (measured)
const PAIRS = [[0, 'plot_0'], [1, 'plot_2'], [2, 'plot_4'], [5, 'plot_8'], [6, 'plot_9']]

describe('⭐⭐ a discarded `countBuy` — btc-charlie-trader-xo-macro-trend-scanner, RDDT 1D', () => {
  it('the capture is what this file says it is', () => {
    expect(cap.symbol.pro_name).toBe('NYSE:RDDT')
    expect(SOURCE).toMatch(/^ {4}countBuy \+= 1\n {4}countBuy$/m)
  })

  it('⭐⭐ compiles, discards the lone values, and agrees with the vendor on every bar', () => {
    const { outs, built } = runLane()
    expect(built.diagnostics.families['runtime:discarded-value']).toBeGreaterThan(0)
    expect(outs.map((o) => o.call).slice(0, 7))
      .toEqual(['plot', 'plot', 'plot', 'barcolor', 'barcolor', 'plotshape', 'plotshape'])
    for (const [k, field] of PAIRS) {
      expect(disagreements(outs[k].col, vendorCol(field)), `${k} vs ${field}`).toBe(0)
    }
    // ⛔ NON-VACUITY: both signal shapes fire on some bars.
    expect(vendorCol('plot_8').filter((v) => v === 1).length).toBeGreaterThan(0)
    expect(vendorCol('plot_9').filter((v) => v === 1).length).toBeGreaterThan(0)
  })

  it('⛔ CONTROL — swapped signal columns disagree', () => {
    const { outs } = runLane()
    expect(disagreements(outs[5].col, vendorCol('plot_9'))).toBeGreaterThan(0)
  })
})
