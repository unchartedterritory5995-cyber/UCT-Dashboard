// app/src/components/chart/engine/runtime/__tests__/w4FrameHoist.test.js
//
// W4-T7 - AN EXPRESSION'S OWN SERIES INSIDE A FUNCTION BODY.
//
// `(v + 1)[1]`, `ta.sma(v * w, p)` and `ta.change(v * 2)` need the expression's
// own committed series. At the root that series is hoisted into a synthetic slot
// on the line above (`hoistCommittedSeries`); inside a UDF body it used to refuse
// `runtime:history-expression`. It is now a FRAME-LOCAL slot whose ring is
// `fnHistorySlotFor`'s: allocated per function, materialised per CALL SITE off
// `historyBase`. Pine: every expression is a series, and inside a function its
// history belongs to each call site.
//
// ORACLE: the same maths written at the ROOT with the binding the member would
// have written by hand (`var t = 0.0` / `t := expr`), over 5,000 bars. The two
// are the same program minus the function, so any difference is the frame.
//
// STILL REFUSED BY NAME: a nested list inside a body (T5's H9), and a GLOBAL's
// history through a function (`runtime:function-global-state`, unwitnessed).

import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 5000
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + Math.cos(i / 7) * 5 + i * 0.01,
  h: 110 + (i % 11),
  l: 90 - (i % 5),
  c: 100 + Math.sin(i / 2.3) * 12 + (i % 97) * 0.3,
  v: 1000 + ((i * 7919) % 1013),
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

function build(src) {
  const b = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  return b
}
function run(src) {
  const built = build(src)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return { out: Array.from(r.outputs[0]), ir: built.ir }
}
const refusalOf = (src) => {
  const b = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  expect(b.ok, 'expected a refusal, got a program').toBe(false)
  return b.refusal
}
const same = (got, want, label) => {
  expect(got.length).toBe(want.length)
  let finite = 0
  for (let i = 0; i < want.length; i += 1) {
    if (Number.isNaN(want[i])) { if (!Number.isNaN(got[i])) throw new Error(`${label} bar ${i}: want na, got ${got[i]}`) } else {
      finite += 1
      if (!(Math.abs(got[i] - want[i]) <= 1e-9)) throw new Error(`${label} bar ${i}: want ${want[i]}, got ${got[i]}`)
    }
  }
  // NON-VACUITY: an oracle that is na everywhere agrees with anything.
  expect(finite, `${label}: the oracle must carry numbers`).toBeGreaterThan(N / 2)
}
/** root binding the member would write by hand */
const bind = (name, expr) => `var ${name} = 0.0\n${name} := ${expr}\n`

describe('W4-T7 an expression\'s own series inside a function body', () => {
  it('hull shape: wma over an expression of two windows == the hand-bound root', () => {
    const fn = run('hma(x) =>\n    ta.wma(2 * ta.wma(x, 8) - ta.wma(x, 16), 4)\nplot(hma(close))\n')
    const root = run(`${bind('t', '2 * ta.wma(close, 8) - ta.wma(close, 16)')}plot(ta.wma(t, 4))\n`)
    same(fn.out, root.out, 'hma')
  })

  it('windowed sum of a product of two parameters (sum(v*w, p))', () => {
    const fn = run('f(v, w) =>\n    ta.sma(v * w, 5)\nplot(f(close, volume))\n')
    const root = run(`${bind('t', 'close * volume')}plot(ta.sma(t, 5))\n`)
    same(fn.out, root.out, 'sum(v*w)')
  })

  it('ta.vwma over an expression in a function', () => {
    const fn = run('f(v) =>\n    ta.vwma(v * 2, 5)\nplot(f(close))\n')
    const root = run(`${bind('t', 'close * 2')}plot(ta.vwma(t, 5))\n`)
    same(fn.out, root.out, 'vwma')
  })

  it('an offset over an expression: (v + 1)[1]', () => {
    const fn = run('f(v) =>\n    (v + 1)[1]\nplot(f(close))\n')
    const root = run(`${bind('t', 'close + 1')}plot(t[1])\n`)
    same(fn.out.slice(1), root.out.slice(1), 'offset')
    expect(Number.isNaN(fn.out[0]), 'bar 0 has no previous bar').toBe(true)
  })

  it('ta.change over an expression', () => {
    const fn = run('f(v) =>\n    ta.change(v * 2)\nplot(f(close))\n')
    const root = run(`${bind('t', 'close * 2')}plot(ta.change(t))\n`)
    same(fn.out.slice(1), root.out.slice(1), 'change')
  })

  it('a hoist inside a body STATEMENT (not only the result) lands before its reader', () => {
    const fn = run('f(v) =>\n    a = ta.sma(v + 1, 3)\n    b = (a * 2)[1]\n    a + b\nplot(f(close))\n')
    const root = run(`${bind('u', 'close + 1')}var a = 0.0\na := ta.sma(u, 3)\n${bind('w', 'a * 2')}plot(a + w[1])\n`)
    same(fn.out.slice(1), root.out.slice(1), 'body statement')
  })

  it('TWO CALL SITES with different arguments keep SEPARATE rings', () => {
    const two = run('f(v) =>\n    ta.sma(v * 2, 5)\nplot(f(close) + f(open) * 3)\n')
    const root = run(`${bind('a', 'close * 2')}${bind('b', 'open * 2')}plot(ta.sma(a, 5) + ta.sma(b, 5) * 3)\n`)
    same(two.out, root.out, 'two sites')
  })
})

describe('W4-T7 what STILL refuses by name', () => {
  it('a nested list (an `if` body) inside the function refuses - T5 / H9', () => {
    const r = refusalOf('f(v) =>\n    r = 0.0\n    if v > 0\n        r := ta.sma(v + 1, 3)\n    r\nplot(f(close))\n')
    expect(r.guard).toBe('runtime:history-expression')
  })

  it('a GLOBAL\'s history through a function stays `runtime:function-global-state`', () => {
    const r = refusalOf('var x = 0.0\nx := close\nf() =>\n    ta.sma(x, 5)\nplot(f())\n')
    expect(r.guard).toBe('runtime:function-global-state')
  })

  it('the root list still hoists (the frame change moved nothing)', () => {
    const fn = run('var x = 0.0\nx := close\nplot(ta.sma(x + 1, 5))\n')
    const root = run(`${bind('t', 'close + 1')}plot(ta.sma(t, 5))\n`)
    same(fn.out, root.out, 'root hoist')
  })
})

describe('W4-T7 a block VALUE inside a function body is a nested list (H9)', () => {
  it('an `if` expression arm over an expression refuses - the hoist would run every bar', () => {
    const r = refusalOf('f(v) =>\n    x = if v > 0\n        ta.sma(v * 2, 5)\n    else\n        v\n    x\nplot(f(close))\n')
    expect(r.guard).toBe('runtime:history-expression')
  })
  it('a `switch` arm over an expression refuses too', () => {
    const r = refusalOf('f(v, simple string m) =>\n    switch m\n        "a" => ta.sma(v * 2, 5)\n        => v\nplot(f(close, "a"))\n')
    expect(r.guard).toBe('runtime:history-expression')
  })
})

describe('W4-T7 the LIVE object door keeps master\'s answer for a function-body hoist', () => {
  const src = head + 'f(v) =>\n    ta.sma(v * 2, 5)\nplot(f(close))\n'
  it('door (objectDoor: true) refuses runtime:history-expression, as master does', () => {
    const b = buildRuntimeIr(src, { bars: BARS, inputs: {}, objectDoor: true })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:history-expression')
  })
  it('CONTROL: the runtime pane (no objectDoor) builds the same source', () => {
    expect(buildRuntimeIr(src, { bars: BARS, inputs: {} }).ok).toBe(true)
  })
  it('CONTROL: the door still serves the root-list hoist master served', () => {
    const root = head + 'var x = 0.0\nx := close\nplot(ta.sma(x + 1, 5))\n'
    expect(buildRuntimeIr(root, { bars: BARS, inputs: {}, objectDoor: true }).ok).toBe(true)
  })
})
