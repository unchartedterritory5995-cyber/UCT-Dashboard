// app/src/components/chart/engine/runtime/__tests__/runtimeTupleCastText.test.js
//
// ─── ⭐⭐ P3 WS-B — TUPLE BUILT-INS, `int()` OVER ANY VALUE, `str.tostring` ────
//
//   · `[m, s, h] = ta.macd(…)`, `ta.bb`, `ta.kc`, `ta.supertrend` on the right of
//     a destructuring in this lane — refused `pine:arity` / `pine:function`
//     because the expression was handed whole to the columnar lane, which takes a
//     tuple apart only in its own destructure. The parts are now the host lane's
//     own (`pine.js::pineTupleBuiltinCallParts` over `PINE_TUPLE_BUILTINS`).
//   · `int(x)` over a value with a user-function call in it refused
//     `runtime:call-conversion-state` (C18's rewrite reads `x` twice); it is now
//     `idiv(x, 1) + 0`, reading `x` once.
//   · `str.tostring` was served only in a run that draws its own objects; it is
//     text in every run now, consumed by `==`, `str.length` and friends.

import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { translatePine } from '../../ast/pine.js'
import { parseFormula } from '../../ast/parse.js'
import { interpret } from '../../ast/interpret.js'

const N = 80
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + Math.sin(i * 0.7) * 3,
  h: 106 + i * 0.3 + Math.abs(Math.sin(i)) * 2,
  l: 94 - i * 0.1 - Math.abs(Math.cos(i)) * 2,
  c: 100 + i * 0.4 + Math.cos(i * 1.3) * 4,
  v: 1000 + ((i * 7919) % 613),
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const HEAD5 = '//@version=5\nindicator("t")\n'
const STATE = 'var float x = 0.0\nx := close * 2 - open\n'

function build(src) { return buildRuntimeIr(src, { bars: BARS, inputs: {} }) }
function runAll(src) {
  const built = build(src)
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return r.outputs.map((o) => Array.from(o))
}
function pureLane(expr) {
  const t = translatePine(`${HEAD5}plot(${expr})\n`)
  expect(t.ok, JSON.stringify(t.refusal || {})).toBe(true)
  const parsed = parseFormula(t.outputs[0].formula)
  const col = interpret(parsed.ast, BARS, {})
  return Array.from({ length: N }, (_, i) => (typeof col === 'number' ? col : col[i]))
}
const same = (got, want, label) => {
  let finite = 0
  for (let i = 0; i < N; i += 1) {
    if (Number.isNaN(want[i])) { expect(Number.isNaN(got[i]), `${label} bar ${i}`).toBe(true); continue }
    expect(got[i], `${label} bar ${i}`).toBeCloseTo(want[i], 9)
    finite += 1
  }
  expect(finite, `${label}: non-vacuity`).toBeGreaterThan(N / 3)
}
const refusalOf = (src) => {
  const b = build(src)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

describe('⭐⭐ a tuple built-in on the right of a destructuring, in this lane', () => {
  it('`ta.macd` — line, signal and histogram are the host lane\'s three parts', () => {
    const [m, s, h] = runAll(`${HEAD5}${STATE}[m, s, h] = ta.macd(close, 12, 26, 9)\nplot(m + x * 0)\nplot(s)\nplot(h)\n`)
    same(m, pureLane('ta.ema(close, 12) - ta.ema(close, 26)'), 'macd line')
    same(h, m.map((v, i) => v - s[i]), 'histogram is line − signal')
  })
  it('`ta.bb` — basis, upper, lower; `_` binds a name like any other', () => {
    const [u, l] = runAll(`${HEAD5}${STATE}[_, u, l] = ta.bb(close, 20, 2)\nplot(u + x * 0)\nplot(l)\n`)
    same(u, pureLane('ta.sma(close, 20) + 2 * ta.stdev(close, 20)'), 'bb upper')
    same(l, pureLane('ta.sma(close, 20) - 2 * ta.stdev(close, 20)'), 'bb lower')
  })
  it('`ta.bb` over a MUTABLE source runs as this lane\'s own windows', () => {
    const [u] = runAll(`${HEAD5}${STATE}[a, u, b] = ta.bb(x, 20, 2)\nplot(u)\n`)
    same(u, pureLane('ta.sma(close * 2 - open, 20) + 2 * ta.stdev(close * 2 - open, 20)'), 'bb(x) upper')
  })
  it('`ta.kc` and `ta.supertrend` take apart too', () => {
    const [mid] = runAll(`${HEAD5}${STATE}[mid, up, lo] = ta.kc(close, 20, 2)\nplot(mid + x * 0)\n`)
    same(mid, pureLane('ta.ema(close, 20)'), 'kc basis')
    expect(build(`${HEAD5}${STATE}[st, dir] = ta.supertrend(3, 10)\nplot(st + x * 0)\n`).ok).toBe(true)
  })
  it('⛔ a part count that does not match the names refuses by name', () => {
    const r = refusalOf(`${HEAD5}${STATE}[a, b] = ta.bb(close, 20, 2)\nplot(b + x)\n`)
    expect(r.message).toMatch(/unpacks 2 names from 3 values/)
  })
  it('⛔ the script\'s own function of that name wins', () => {
    const [a] = runAll(`//@version=4\nstudy("t")\n${STATE}macd(p, q, r, s) => [p, q, r]\n[a, b, c] = macd(x, 1, 2, 3)\nplot(a)\n`)
    expect(a[3]).toBeCloseTo(BARS[3].c * 2 - BARS[3].o, 9)
  })
  it('⛔ CONTROL — read as ONE value it is still the host lane\'s refusal', () => {
    expect(refusalOf(`${HEAD5}${STATE}v = ta.bb(close, 20, 2)\nplot(v + x)\n`).guard).toBe('pine:function')
  })
})

describe('⭐⭐ `int(x)` over ANY value the run computes reads `x` once', () => {
  it('truncates toward zero, sign-less zero, `na` in and out', () => {
    const [o] = runAll(`${HEAD5}${STATE}f(v) => v\nvar float y = 0.0\ny := bar_index == 0 ? 2.7 : bar_index == 1 ? -2.7 : bar_index == 2 ? -0.4 : bar_index == 3 ? na : 5.0\nplot(int(f(y)))\n`)
    expect(o[0]).toBe(2)
    expect(o[1]).toBe(-2)
    expect(Object.is(o[2], 0), 'a negative fraction truncates to +0, never -0').toBe(true)
    expect(Number.isNaN(o[3])).toBe(true)
    expect(o[4]).toBe(5)
  })
  it('a user function inside runs ONCE per bar (no double evaluation)', () => {
    // `f` counts its own calls at this site (`var`, per call site): once per bar
    // reads 1, 2, 3 …; a rewrite that evaluated `x` twice would read 2, 4, 6 …
    const [o] = runAll(`${HEAD5}f(v) =>\n    var int k = 0\n    k += 1\n    v * 0 + k + 0.5\nplot(int(f(close)))\n`)
    expect(o.slice(0, 5)).toEqual([1, 2, 3, 4, 5])
  })
  it('`float(x)` is `x`', () => {
    const [o] = runAll(`${HEAD5}${STATE}f(v) => v / 3\nplot(float(f(x)))\n`)
    expect(o[7]).toBeCloseTo((BARS[7].c * 2 - BARS[7].o) / 3, 12)
  })
  it('⛔ not over text — that is no number to cast', () => {
    expect(build(`${HEAD5}var string s = "a"\ns := close > 0 ? "b" : "c"\nplot(int(s))\n`).ok).toBe(false)
    // ⭐ A text with a CALL inside: the older read-twice rewrite declines it (it
    // holds a call), so only this arm's own text check can keep the refusal.
    const r = build(`${HEAD5}${STATE}f(v) => v * 2\nplot(int(str.tostring(f(x))))\n`)
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:call-conversion-state')
  })
})

describe('⭐⭐ `str.tostring` is text in a run that does NOT draw its own objects', () => {
  it('compared with `==` over a mutable value', () => {
    const [o] = runAll(`${HEAD5}var float y = 0.0\ny := bar_index\nplot(str.tostring(y) == "3" ? 1 : 0)\n`)
    expect(o.slice(0, 6)).toEqual([0, 0, 0, 1, 0, 0])
  })
  it('a name bound to a text comparison reaches the lane through its binding', () => {
    const [o] = runAll(`${HEAD5}${STATE}isD = str.tostring(timeframe.period) == "D"\nplot(isD ? 1 : x)\n`)
    expect(o.every((v) => v === 1 || Number.isFinite(v))).toBe(true)
  })
  it('v4 `tostring(x, "#.##")` with a format', () => {
    const [o] = runAll(`//@version=4\nstudy("t")\nvar float y = 0.0\ny := 1.0 / 3\nplot(tostring(y, "#.##") == "0.33" ? 1 : 0)\n`)
    expect(o[0]).toBe(1)
  })
  it('⛔ CONTROL — a format this lane does not print exactly still refuses by name', () => {
    expect(refusalOf(`${HEAD5}${STATE}plot(str.tostring(x, format.mintick) == "1" ? 1 : 0)\n`).guard)
      .toBe('runtime:call-text-state')
  })
})
