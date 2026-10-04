// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.rt7Walls.test.js
//
// ─── RT7 — the runtime lane's next walls, graded against TradingView captures ──
//
// 1. `array.max` / `array.min` of an EMPTY array answer `na` (`vw-array-na` N05 measures
//    an all-na array; an empty one has the same zero real elements). wyckoff's
//    `myhigh(len)` / `mylow(len)` loop `for i = 0 to len - 1` with `len` na before its
//    first sideways phase, so they reduce an EMPTY array on its early bars — which used
//    to stop the whole run (`array.max of an empty array`). TradingView ran through those
//    bars and drew 12 boxes on RDDT; the run now draws the same 12, every coordinate equal.
import { describe, it, expect } from 'vitest'
import path from 'node:path'

import { HARNESS_DIR, loadCapture } from './harness'
import { toProductBars, tfCodeOf } from './ourSide'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock'
import { lowerIrProgram } from '../../runtime/lowerIr'
import { execute } from '../../runtime/vm'

const T = 300000

/** The script built WITH its drawings and run on the capture's own bars (RT5's direct run). */
export function directRun(capture, source = capture.source.text) {
  const bars = toProductBars(capture)
  const tf = tfCodeOf(capture.timeframe)
  const built = buildRuntimeIr(source, {
    bars, inputs: {}, objectsInRun: true, pane: true, basePeriod: tf, tf,
    ...runtimeClockOpts(capture.newestBarIsForming ?? null, { tf }),
  })
  if (!built.ok) return { built }
  const program = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const res = execute(program, {
    bars: bars.length, series, columns: program.columns, confirmed: capture.newestBarIsForming === false,
    barTimes: bars.map((b) => b.t),
  })
  return { built, res, fin: res.objects ? res.objects.finish() : null }
}

describe('RT7 — wyckoff RDDT: an empty array\'s max / min is na, and the run draws TradingView\'s boxes', () => {
  const cap = loadCapture(path.join(HARNESS_DIR, 'wyckoff-accumulation-distribution-rddt-1d-2026-10-02.json')).capture

  it('the 12 boxes equal the capture: top, bottom and text, in order; left/right in the same order', () => {
    const { built, fin } = directRun(cap)
    expect(built.ok, built.refusal && built.refusal.message).toBe(true)
    const ours = fin.live.filter((o) => o.family === 'box')
    const vendor = cap.objects.records.boxes
    expect(vendor.length).toBe(12)
    expect(ours.map((o) => [o.props.top, o.props.bottom, o.props.text]))
      .toEqual(vendor.map((b) => [b.y1, b.y2, b.t]))
    // the capture numbers x by rank of distinct coordinate; ours carry bar indices —
    // the RANKS must agree (box 11 has left == right on both sides)
    const rank = (xs) => { const u = [...new Set(xs)].sort((a, b) => a - b); return xs.map((x) => u.indexOf(x)) }
    const ox = ours.flatMap((o) => [o.props.left, o.props.right])
    const vx = vendor.flatMap((b) => [b.x1, b.x2])
    expect(rank(ox)).toEqual(rank(vx))
  }, T)

  it('control: the early bars really do reduce an EMPTY array (the fact the run used to stop on)', () => {
    // `for i = 0 to len - 1` with `len` na pushes nothing: count the bars where myhigh's
    // array is empty by running the helper alone and reading its na.
    const src = [
      '//@version=5', 'indicator("t")',
      'rsi = ta.rsi(close, 14)',
      'side = (rsi < 70 and rsi > 30) or (rsi[1] < 70 and rsi[1] > 30)',
      'boxlen = ta.barssince(side and not side[1])',
      'myhigh(len) =>', '    x = array.new_float()', '    for i = 0 to len - 1', '        array.push(x, high[i])', '    array.size(x)',
      'plot(myhigh(math.max(1, boxlen + 1)))', '',
    ].join('\n')
    const { built, res } = directRun(cap, src)
    expect(built.ok, built.refusal && built.refusal.message).toBe(true)
    const sizes = Array.from(res.outputs[0])
    expect(sizes[0]).toBe(0)                      // bar 0: boxlen is na -> the loop runs no pass
    expect(sizes.some((s) => s > 0)).toBe(true)   // and later bars push
  }, T)
})
