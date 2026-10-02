// app/src/components/chart/engine/ast/runtimeStrategyWord.vendor.test.js
//
// ─── ⭐⭐ R1 — A VARIABLE NAMED `strategy` IS NOT A DECLARATION — RDDT 1D ────
//
// `liquidity-engulfing-candles-upslidedown` declares `indicator(...)` and keeps
// a VARIABLE named `strategy` (`strategy = 0` @L55, `strategy := …` @L57/59,
// `plot(strategy, "Strategy Signal", display = display.data_window)` @L60).
// The runtime lane refused it at L55 as "a script that is not an indicator —
// `strategy()`": a confident wrong sentence about a line the author got right.
// R1 makes only the CALL form `strategy(` a declaration; the bare word binds
// like any other name. This holds the runtime lane's three outputs against the
// vendor's on every bar of the committed capture.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'

const REPO = path.resolve(process.cwd(), '..')
const CAPTURE = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness',
  'liquidity-engulfing-candles-upslidedown-rddt-1d-2026-09-28.json')
const cap = JSON.parse(fs.readFileSync(CAPTURE, 'utf8'))
const SOURCE = cap.source.text
const bars = cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const vendorCol = (id) => {
  const k = cap.plotValues.fields.indexOf(id)
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r[k]]))
  return bars.map((b) => byTime.get(b.t))
}

/** The capture records a false plotshape as 0; this lane may answer 0 or na. */
const same = (ours, vendor) => (vendor === 0 ? (ours === 0 || Number.isNaN(ours)) : ours === vendor)
const disagreements = (ours, vendor) => ours.reduce((n, v, i) => n + (same(v, vendor[i]) ? 0 : 1), 0)

const runLane = () => {
  const built = buildRuntimeIr(SOURCE, { bars, inputs: {}, tf: 'D', ...runtimeClockOpts(false) })
  expect(built.ok, built.ok ? '' : JSON.stringify(built.refusal)).toBe(true)
  const program = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const res = execute(program, {
    bars: bars.length, series, columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t),
  })
  return program.outputs.map((o, k) => ({ call: o.call, col: Array.from(res.outputs[k]) }))
}

describe('⭐⭐ `strategy` as a variable name — liquidity-engulfing-candles-upslidedown, RDDT 1D', () => {
  it('the capture is what this file says it is', () => {
    expect(cap.symbol.pro_name).toBe('NYSE:RDDT')
    expect(bars.length).toBe(632)
    expect(cap.history.startsAtBar0).toBe(true)
    expect(SOURCE).toMatch(/^strategy = 0$/m)
    expect(SOURCE).toMatch(/^plot\(strategy, "Strategy Signal"/m)
    // ⛔ NON-VACUITY: the signal plot is not constant — it says 1 and -1.
    const signal = vendorCol('plot_2')
    expect(signal.filter((v) => v === 1).length).toBeGreaterThan(0)
    expect(signal.filter((v) => v === -1).length).toBeGreaterThan(0)
  })

  it('⭐⭐ the runtime lane compiles it and agrees with the vendor on all three plots, every bar', () => {
    const outs = runLane()
    expect(outs.map((o) => o.call)).toEqual(['plotshape', 'plotshape', 'plot'])
    expect(disagreements(outs[0].col, vendorCol('plot_0'))).toBe(0)
    expect(disagreements(outs[1].col, vendorCol('plot_1'))).toBe(0)
    expect(disagreements(outs[2].col, vendorCol('plot_2'))).toBe(0)
  })

  it('⛔ CONTROL — the comparison can fail: the signal against a bullish-only column disagrees', () => {
    const outs = runLane()
    expect(disagreements(outs[2].col, vendorCol('plot_0'))).toBeGreaterThan(0)
  })
})
