// app/src/components/chart/engine/runtime/__tests__/historySeriesWalls.test.js
//
// ─── ⭐⭐ WS-C (Phase 3) — THE HISTORY AND SERIES WALLS BESIDE P3 ────────────────
//
//   1. `max_bars_back`: a read past Pine's history buffer STOPS the script on
//      TradingView. A constant offset past it refuses the build by name; an
//      offset over runtime state stops the run by name in the VM. The buffer is
//      5,000 bars, or the `max_bars_back = N` the declaration names.
//   2. Infinity: `x[1]` of a slot that held `1/0` reads `na`, as the columnar
//      lane's shifted column does — the two lanes now agree on `x[1] > y`.
//   (The v6 `for` bound re-read is WS-A's: plan section 5, handed off.)
//   3. `int()`: the plan recorded the host lane REFUSING a non-whole `int()`. It
//      no longer does — both lanes truncate toward zero through the one resolver
//      (`idiv(x, 1)`, vendor-measured I01–I09), and the runtime lane's `int()`
//      over mutable state is the same truncation. Pinned here so the claim
//      cannot drift back.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 103 + i, l: 97 + i, c: 101.5 + i * 1.25, v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

const built = (src) => buildRuntimeIr(src, { bars: BARS, inputs: {} })
function run(src) {
  const b = built(src)
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const program = lowerIrProgram(b.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return r.outputs.map((o) => Array.from(o))
}
const refusal = (src) => { const b = built(src); return b.ok ? null : b.refusal }

describe('1 — max_bars_back: a read past the buffer is an error, never an answer', () => {
  const v5 = (decl, body) => `//@version=5\nindicator("t"${decl})\n${body}`
  it('a constant offset past 5,000 refuses by name (it used to read the chart)', () => {
    const r = refusal(v5('', 'plot(close[6000])\n'))
    expect(r && r.guard).toBe('runtime:directive')
    expect(r.message).toMatch(/history buffer of 5000 bars/)
  })
  it('a constant offset past a DECLARED buffer refuses; within it builds and reads the chart', () => {
    expect(refusal(v5(', max_bars_back = 20', 'plot(close[30])\n')).guard).toBe('runtime:directive')
    const [y] = run(v5(', max_bars_back = 20', 'plot(close[10])\n'))
    expect(y.slice(10)).toEqual(BARS.slice(0, N - 10).map((b) => b.c))
    expect(y.slice(0, 10).every(Number.isNaN)).toBe(true)   // before bar 0, inside the buffer: na
  })
  it('a variable\'s constant offset past the declared buffer refuses too', () => {
    const r = refusal(v5(', max_bars_back = 20', 'var float x = 0.0\nx := x + close\nplot(x[25])\n'))
    expect(r && r.guard).toBe('runtime:directive')
  })
  it('an offset over runtime state past 5,000 STOPS the run (it used to answer `na`)', () => {
    expect(() => run(v5('', 'var int n = 0\nn := bar_index >= 30 ? 6000 : 1\nplot(close[n])\n')))
      .toThrow(/past Pine's history buffer of 5000 bars/)
  })
  it('… past a DECLARED buffer stops it too; within it the run is untouched', () => {
    expect(() => run(v5(', max_bars_back = 20', 'var int n = 0\nn := bar_index >= 30 ? 25 : 1\nplot(close[n])\n')))
      .toThrow(/history buffer of 20 bars/)
    const [y] = run(v5(', max_bars_back = 20', 'var int n = 0\nn := bar_index >= 30 ? 15 : 1\nplot(close[n])\n'))
    expect(y[35]).toBe(BARS[20].c)
    expect(y[5]).toBe(BARS[4].c)
  })
  it('a variable\'s own dynamic offset past the declared buffer stops the run', () => {
    const src = v5(', max_bars_back = 20', 'var float x = 0.0\nx := x + close\nvar int n = 0\n'
      + 'n := bar_index >= 30 ? 25 : 1\nplot(x[math.min(n, 30)])\n')
    const b = built(src)
    if (b.ok) expect(() => run(src)).toThrow(/history buffer of 20 bars/)
    else expect(b.refusal.guard).toMatch(/^runtime:/)    // or refused by name at build
  })
  it('CONTROL: no declaration and every read inside 5,000 — byte-identical to before', () => {
    const [y] = run(v5('', 'var int n = 0\nn := bar_index % 3\nplot(close[n])\n'))
    BARS.forEach((b, i) => { const k = i % 3; expect(y[i]).toBe(i - k >= 0 ? BARS[i - k].c : NaN) })
  })
})

describe('2 — an infinity is not history: `x[1]` agrees with the columnar lane', () => {
  it('a slot that held `close / 0` reads `na` one bar back, as the shifted column does', () => {
    const [rt] = run('//@version=5\nindicator("t")\nvar float x = 0.0\nx := close / (close - close)\nplot(x[1] > 1 ? 1 : 0)\n')
    const [col] = run('//@version=5\nindicator("t")\nplot((close / (close - close))[1] > 1 ? 1 : 0)\n')
    expect(rt).toEqual(col)
    expect(rt.slice(1).every((v) => v === 0)).toBe(true)
  })
  it('the live value is unchanged (laundered at EMIT, as before)', () => {
    const [y] = run('//@version=5\nindicator("t")\nvar float x = 0.0\nx := close / (close - close)\nplot(x)\n')
    expect(y.every(Number.isNaN)).toBe(true)
  })
})

describe('3 — `int()` of a non-whole value: the two lanes cannot disagree', () => {
  it('the runtime lane truncates toward zero, negatives included (the host lane\'s `idiv(x, 1)`)', () => {
    const [p, n] = run('//@version=5\nindicator("t")\nplot(int(close / 7))\nplot(int(-close / 7))\n')
    BARS.forEach((b, i) => {
      expect(p[i]).toBe(Math.trunc(b.c / 7))
      expect(n[i]).toBe(Math.trunc(-b.c / 7) + 0)
    })
  })
  it('over mutable state it is the SAME truncation, negatives included — never a second rounding rule', () => {
    const [p, n] = run('//@version=5\nindicator("t")\nvar float v = 0.0\nv := close / 7\nplot(int(v))\nplot(int(-v))\n')
    BARS.forEach((b, i) => {
      expect(p[i]).toBe(Math.trunc(b.c / 7))
      expect(n[i]).toBe(Math.trunc(-b.c / 7) + 0)
    })
  })
})
