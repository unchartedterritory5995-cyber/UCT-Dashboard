// app/src/components/chart/engine/runtime/__tests__/runtimeRsiHma.test.js
//
// ─── ⭐⭐ P3 WS-B — `ta.rsi` AND `ta.hma` OVER A VALUE THE RUN COMPUTES ────────
//
// Both refused `runtime:call-windowed-state` when their source was a mutable
// variable — "this one needs the series bridge" — while the same call over a
// pure series was a column. Now:
//   · `ta.rsi(x, n)` is ONE carried step, `interpret.js::CARRIED.rsiPine`, held
//     here to the SHIPPED `indicators.js::computeRSI` (the function the columnar
//     `rsi` binds) over clean, gappy and flat series — never to a copy of itself;
//   · `ta.hma(x, n)` is Alan Hull's three `wma` windows (`runtimeRespelling`),
//     sized by `interpret.js::hullWindows`, the one place the columnar `hma`
//     sizes them too.
// The graph-vs-runtime differential: the SAME values reach the columnar door as a
// pure expression and the runtime as a mutable variable, and the two series must
// agree bar for bar.

import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { translatePine } from '../../ast/pine.js'
import { parseFormula } from '../../ast/parse.js'
import { interpret, CARRIED, hullWindows } from '../../ast/interpret.js'
import { computeRSI } from '../../../indicators.js'

const N = 120
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + Math.sin(i * 0.7) * 3,
  h: 106 + i * 0.3,
  l: 94 - i * 0.1,
  c: 100 + i * 0.4 + Math.cos(i * 1.3) * 4,
  v: 1000 + ((i * 7919) % 613),
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const STATE = 'var float x = 0.0\nx := close * 2 - open\n'
const PURE = '(close * 2 - open)'

function run(version, body) {
  const head = `//@version=${version}\n${version >= 5 ? 'indicator' : 'study'}("t")\n`
  const built = buildRuntimeIr(`${head}${STATE}${body}`, { bars: BARS, inputs: {} })
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return { out: Array.from(r.outputs[0]), program }
}
function pureLane(version, expr) {
  const head = `//@version=${version}\n${version >= 5 ? 'indicator' : 'study'}("t")\n`
  const t = translatePine(`${head}plot(${expr})\n`)
  expect(t.ok, JSON.stringify(t.refusal || {})).toBe(true)
  const parsed = parseFormula(t.outputs[0].formula)
  expect(parsed.ok).toBe(true)
  const col = interpret(parsed.ast, BARS, {})
  return Array.from({ length: N }, (_, i) => (typeof col === 'number' ? col : col[i]))
}
const same = (got, want, label) => {
  let finite = 0
  for (let i = 0; i < N; i += 1) {
    if (Number.isNaN(want[i])) { expect(Number.isNaN(got[i]), `${label} bar ${i}: ours ${got[i]}, want na`).toBe(true); continue }
    expect(Math.abs(got[i] - want[i]), `${label} bar ${i}: ours ${got[i]}, want ${want[i]}`)
      .toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want[i])))
    finite += 1
  }
  expect(finite, `${label}: non-vacuity`).toBeGreaterThan(N / 2)
}
/** Drive `CARRIED.rsiPine` over a plain array, as the VM does. */
const stepRsi = (xs, n) => {
  const spec = CARRIED.rsiPine
  const st = new Float64Array(spec.cells)
  spec.init(st, 0)
  return xs.map((v) => spec.step(st, 0, v, n))
}
/** The shipped `computeRSI` over the same array, UNTRIMMED, bar-aligned. */
const shippedRsi = (xs, n) => {
  const pts = computeRSI(xs.map((c, i) => ({ t: i, c })), n)
  return xs.map((_, i) => (pts.length && pts[i] && typeof pts[i].value === 'number' ? pts[i].value : NaN))
}

describe('`CARRIED.rsiPine` IS the shipped `computeRSI`, step for step', () => {
  const clean = BARS.map((b) => b.c * 2 - b.o)
  it('over a clean series', () => { same(stepRsi(clean, 14), shippedRsi(clean, 14), 'clean') })
  it('over a GAPPY series — the hold rule (state unchanged, `na` on the hole and the bar after)', () => {
    const gappy = clean.map((v, i) => (i % 17 === 9 ? NaN : v))
    const ours = stepRsi(gappy, 14)
    same(ours, shippedRsi(gappy, 14), 'gappy')
    // ⛔ non-vacuity: a hole really is `na` both on itself and on the next bar
    expect(Number.isNaN(ours[60]) && Number.isNaN(ours[61])).toBe(true)
  })
  it('over a FLAT series — Pine\'s `down == 0 → 100` comes first', () => {
    const flat = clean.map(() => 50)
    const ours = stepRsi(flat, 5)
    same(ours, shippedRsi(flat, 5), 'flat')
    expect(ours[10]).toBe(100)
  })
  it('a falling series reads 0 (`up == 0`, `down` not 0)', () => {
    const down = clean.map((_, i) => 500 - i)
    expect(stepRsi(down, 5)[20]).toBe(0)
  })
})

describe('⭐⭐ `ta.rsi` over a mutable value equals the columnar lane over the same values', () => {
  it('v5 `ta.rsi`', () => { same(run(5, 'plot(ta.rsi(x, 14))').out, pureLane(5, `ta.rsi(${PURE}, 14)`), 'ta.rsi') })
  it('v4 bare `rsi`', () => { same(run(4, 'plot(rsi(x, 9))').out, pureLane(4, `rsi(${PURE}, 9)`), 'rsi') })
  it('two call sites of one function keep two states', () => {
    const { out } = run(5, 'f(v) => ta.rsi(v, 7)\nplot(f(x) - f(x * 3))')
    // ⭐ RSI is scale-free, so the two sites over x and 3x must agree EXACTLY —
    // shared state would step one rsi twice per bar and break that.
    const finite = out.filter(Number.isFinite)
    expect(finite.length).toBeGreaterThan(N / 2)
    for (const v of finite) expect(Math.abs(v)).toBeLessThan(1e-9)
  })
  it('⛔ a length only known while the bar runs still refuses by name', () => {
    const b = buildRuntimeIr(`//@version=5\nindicator("t")\n${STATE}plot(ta.rsi(x, int(x) % 5 + 2))\n`, { bars: BARS, inputs: {} })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:history-dynamic-offset')
  })
  it('⛔ the script\'s own `rsi` is never replaced', () => {
    const { out } = run(4, 'rsi(a, b) => a + b\nplot(rsi(x, 2))')
    expect(out[5]).toBeCloseTo(BARS[5].c * 2 - BARS[5].o + 2, 9)
  })
})

describe('⭐⭐ `ta.hma` over a mutable value equals the columnar lane over the same values', () => {
  it('`hullWindows` is the columnar `hma`\'s own sizing (one place)', () => {
    expect(hullWindows(9)).toEqual({ half: 4, root: 3 })
    expect(hullWindows(1)).toEqual({ half: 1, root: 1 })
  })
  for (const n of [9, 16, 21]) {
    it(`v5 \`ta.hma(x, ${n})\``, () => { same(run(5, `plot(ta.hma(x, ${n}))`).out, pureLane(5, `ta.hma(${PURE}, ${n})`), `hma ${n}`) })
  }
  it('v4 bare `hma`', () => { same(run(4, 'plot(hma(x, 9))').out, pureLane(4, `hma(${PURE}, 9)`), 'hma v4') })
  it('a pure source with a length a call site fixes is a column', () => {
    const { out, program } = run(5, 'f(len) => ta.hma(close, len)\nplot(f(9))')
    same(out, pureLane(5, 'ta.hma(close, 9)'), 'hma(close, len)')
    expect(program.windows.length, 'the pure call is one column, no runtime window').toBe(0)
  })
  it('⛔ the script\'s own `wma` is never called in Pine\'s place — the respelling declines', () => {
    const b = buildRuntimeIr(`//@version=4\nstudy("t")\n${STATE}wma(a, b) => a\nplot(hma(x, 9))\n`, { bars: BARS, inputs: {} })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:call-windowed-state')
  })
})
