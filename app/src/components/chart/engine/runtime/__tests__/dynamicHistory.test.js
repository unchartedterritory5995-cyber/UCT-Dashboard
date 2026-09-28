// app/src/components/chart/engine/runtime/__tests__/dynamicHistory.test.js
//
// ─── `x[n]` OVER A VARIABLE, WITH `n` ONLY KNOWN WHILE THE BAR RUNS (2026-09-27) ───
//
// `runtime:history-dynamic-offset` was the widest FIRST wall of the runtime-lane door
// (12 of 48 walled scripts): `src[k]` inside a `for`, `s[i]`, `_src[i]`. The opcode
// for it (`READ_HIST_SLOT_DYN`) was reserved because a ring sized before bar 0 could
// be read past — answering `na` where Pine answers a number. It is implemented by
// making the RING the answer: a history entry read at a run-time offset is DYNAMIC and
// the VM sizes it to the bar count, so every offset a bar can ask for is inside it.
//
// The semantics, each pinned below with hand-computed numbers:
//   x[0]             → the LIVE value (never the previous bar)
//   x[n], 1 ≤ n ≤ bar → the value committed n bars ago
//   x[n], n > bar    → na (before the first bar — Pine's own answer)
//   n na             → x[0], the live value   ⎫ VENDOR-MEASURED, NYSE:RDDT 1D
//   n negative       → STOPS the script        ⎬ tests/fixtures/vendor/harness/
//                                              ⎭ rtwalls-dyn-history-*-2026-09-27
//   n fractional     → na (unmeasured; never `n | 0`)
//
// `acc` counts bars (acc = bar + 1), so every expectation is arithmetic.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { OP } from '../program.js'

const LF = String.fromCharCode(10)
const src = (...xs) => ['//@version=6', 'indicator("t")', ...xs].join(LF) + LF
const N = 8
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 102 + i, l: 98 + i, c: 100 + i * 2, v: 1000,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

function build(text) {
  const built = buildRuntimeIr(text, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  return lowerIrProgram(built.ir)
}
function run(text) {
  const program = build(text)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return res.outputs.map((o) => Array.from(o, (v) => (Number.isFinite(v) ? v : null)))
}
const ACC = ['var float acc = 0.0', 'acc := acc + 1']

describe('⭐ a loop counter as the offset — the corpus shape', () => {
  it('Σ acc[i], i = 0..3 is 4·acc − 6 once four bars exist, and counts only what exists before', () => {
    // bar b: acc = b+1. acc[i] exists for i ≤ b (nz → 0 otherwise).
    //   b0: 1            = 1      b1: 2+1        = 3     b2: 3+2+1 = 6
    //   b3..: 4·(b+1) − 6 → 10, 14, 18, 22, 26
    const [s] = run(src(...ACC, 'float s = 0.0', 'for i = 0 to 3', '    s := s + nz(acc[i])', 'plot(s)'))
    expect(s).toEqual([1, 3, 6, 10, 14, 18, 22, 26])
  })

  it('⭐ x[0] is the LIVE value — even after the variable was written this bar', () => {
    // acc was already incremented this bar, so acc[0] = b+1, not b.
    const [v] = run(src(...ACC, 'k = 0', 'float z = 0.0', 'for i = 0 to 0', '    z := acc[i]', 'plot(z)'))
    expect(v).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('reaches the FIRST bar from every bar — the whole chart is in the ring', () => {
    // acc[bar_index] is the first bar's acc = 1, on every bar; the ring is not 1 deep.
    const [v] = run(src(...ACC, 'int k = bar_index', 'float z = 0.0', 'for i = k to k', '    z := acc[i]', 'plot(z)'))
    expect(v).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
  })
})

describe('⛔ the unanswerable offsets are na — never a clamp, never a wrong bar', () => {
  it('past the first bar is na', () => {
    const [v] = run(src(...ACC, 'float z = 0.0', 'for i = 3 to 3', '    z := acc[i]', 'plot(z)'))
    // exists from bar 3: acc(b−3) = b−2
    expect(v).toEqual([null, null, null, 1, 2, 3, 4, 5])
  })

  it('⭐ an na offset reads the LIVE value — TradingView reads x[na] as x[0] (158 of 158 bars)', () => {
    const [v] = run(src(...ACC, 'float z = 0.0', 'int k = bar_index % 2 == 0 ? na : 1',
      'for i = 0 to 0', '    z := acc[k]', 'plot(z)'))
    // odd bars: acc[1] = b; even bars: acc[0] = b + 1. ⚰️ This answered na.
    expect(v).toEqual([1, 1, 3, 3, 5, 5, 7, 7])
  })

  it('⭐ a negative offset STOPS the script — TradingView errors the whole study', () => {
    // ⚰️ This answered na, drawing a line where TradingView draws nothing.
    expect(() => run(src(...ACC, 'float z = 0.0', 'int k = bar_index % 2 == 0 ? -1 : 1',
      'for i = 0 to 0', '    z := acc[k]', 'plot(z)')))
      .toThrow(/reads history at -1 bars back — .*TradingView stops the script/)
  })
})

describe('⭐ a function PARAMETER read at a run-time offset — `_src[i]` in the corpus', () => {
  it('each call site keeps its own ring', () => {
    // f(x, n) = Σ_{j=0..n} nz(x[j]).  f(acc, 2) = 3·acc − 3 from bar 2;  f(acc*10, 1) = 10·(2acc − 1)
    const [a, b] = run(src(...ACC,
      'f(x, n) =>', '    float t = 0.0', '    for j = 0 to n', '        t := t + nz(x[j])', '    t',
      'plot(f(acc, 2))', 'plot(f(acc * 10, 1))'))
    expect(a).toEqual([1, 3, 6, 9, 12, 15, 18, 21])
    expect(b).toEqual([10, 30, 50, 70, 90, 110, 130, 150])
  })
})

describe('⭐ the wiring — the dynamic ring is what the opcode reads', () => {
  it('a run-time offset lowers to READ_HIST_SLOT_DYN over a DYNAMIC history entry', () => {
    const p = build(src(...ACC, 'float s = 0.0', 'for i = 0 to 3', '    s := s + nz(acc[i])', 'plot(s)'))
    const ops = []
    for (let pc = 0; pc < p.code.length / 3; pc += 1) ops.push(p.code[pc * 3])
    expect(ops).toContain(OP.READ_HIST_SLOT_DYN)
    expect(p.history.some((h) => h.dynamic === true)).toBe(true)
  })

  it('⛔ CONTROL — a constant offset still lowers to the fixed ring', () => {
    const p = build(src(...ACC, 'plot(acc[1])'))
    const ops = []
    for (let pc = 0; pc < p.code.length / 3; pc += 1) ops.push(p.code[pc * 3])
    expect(ops).toContain(OP.READ_HIST_SLOT)
    expect(ops).not.toContain(OP.READ_HIST_SLOT_DYN)
    expect(p.history.some((h) => h.dynamic === true)).toBe(false)
  })
})
