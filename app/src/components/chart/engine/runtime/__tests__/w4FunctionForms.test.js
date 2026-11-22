// app/src/components/chart/engine/runtime/__tests__/w4FunctionForms.test.js
//
// W4-T15 (and T16, folded in): function and statement forms the runtime front end
// refused, each proven against Pine's published behaviour:
//   - user-defined functions: parameter defaults, named arguments at the call
//     https://www.tradingview.com/pine-script-docs/language/user-defined-functions/
//   - a loop returns the value of its last evaluated expression (na when it runs
//     no pass) https://www.tradingview.com/pine-script-docs/language/loops/
//   - a one-line function body that is a binding or comma statements
//   - log.info / log.warning / log.error as statements: no chart effect, no stop
//     https://www.tradingview.com/pine-script-docs/writing/debugging/#pine-logs
//
// ONE RULE FOR THE OBJECT DOOR: every form below keeps master's refusal there
// (`opts.objectDoor === true`), so the door builds exactly what master builds.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 8
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100, h: 102 + i, l: 98, c: 100 + i, v: 1000,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

const build = (src, extra = {}) => buildRuntimeIr(head + src, { bars: BARS, inputs: {}, ...extra })
function run(src) {
  const built = build(src)
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return r
}
const out0 = (src) => Array.from(run(src).outputs[0]).map((v) => (Number.isNaN(v) ? 'na' : v))
const all = (v) => Array(N).fill(v)
const refusalOf = (src, extra) => {
  const b = build(src, extra)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

describe('W4-T15 parameter defaults and named arguments', () => {
  it('a default fills an omitted trailing argument', () => {
    expect(out0('f(x, len = 2) =>\n    x * len\nplot(f(close))\n')).toEqual(BARS.map((b) => b.c * 2))
  })
  it('a named argument is bound to its parameter', () => {
    expect(out0('f(x, len = 2) =>\n    x * len\nplot(f(close, len = 3))\n')).toEqual(BARS.map((b) => b.c * 3))
  })
  it('named arguments may come in any order, and a skipped parameter takes its default', () => {
    // x = close, len defaults to 2, k = 5  =>  close * 2 + 5
    expect(out0('f(x, len = 2, k = 1) =>\n    x * len + k\nplot(f(k = 5, x = close))\n'))
      .toEqual(BARS.map((b) => b.c * 2 + 5))
  })
  it('a one-line header with defaults takes a named argument', () => {
    expect(out0('f(x, len = 2) => x * len\nplot(f(close, len = 4))\n')).toEqual(BARS.map((b) => b.c * 4))
  })
  it('a named argument on a function with no defaults is bound by name', () => {
    expect(out0('f(a, b) =>\n    a - b\nplot(f(b = 1, a = close))\n')).toEqual(BARS.map((b) => b.c - 1))
  })
  it('refused by name: unknown parameter, given twice, positional after named, no default to skip to', () => {
    expect(refusalOf('f(x, len = 2) =>\n    x * len\nplot(f(close, wrong = 3))\n').message)
      .toMatch(/no parameter named `wrong`/)
    expect(refusalOf('f(x, len = 2) =>\n    x * len\nplot(f(close, x = 3))\n').message)
      .toMatch(/given its parameter `x` twice/)
    expect(refusalOf('f(x, len = 2) =>\n    x * len\nplot(f(len = 3, close))\n').message)
      .toMatch(/positional argument after a named one/)
    expect(refusalOf('f(x, y, len = 2) =>\n    x * len + y\nplot(f(close, len = 3))\n').message)
      .toMatch(/without its parameter `y`, which declares no default/)
  })
})

describe('W4-T15 a function ending in a loop returns the loop\'s last value', () => {
  it('for: the last pass\'s last expression (a bare expression)', () => {
    expect(out0('f(n) =>\n    for i = 1 to n\n        i * 2\nplot(f(3))\n')).toEqual(all(6))
  })
  it('for: the last pass\'s last statement is an assignment, its value is the assigned one', () => {
    expect(out0('f(n) =>\n    s = 0.0\n    for i = 1 to n\n        s += i\nplot(f(3))\n')).toEqual(all(6))
  })
  it('for counting down (from > to) still ends on its last pass', () => {
    expect(out0('f(n) =>\n    for i = 5 to n\n        i * 2\nplot(f(3))\n')).toEqual(all(6))
  })
  it('while: the last pass\'s value', () => {
    expect(out0('f(n) =>\n    i = 0\n    while i < n\n        i += 1\n        i * 10\nplot(f(3))\n')).toEqual(all(30))
  })
  it('an inner loop that runs no pass on the last outer pass yields na, not the pass before', () => {
    // i = 1: the inner loop runs one pass (10); i = 2: it runs none, so the outer value is na
    const src = 'f(n) =>\n    for i = 1 to n\n        c = 0.0\n        while c < 2 - i\n            c += 1\n            c * 10\nplot(f(2))\n'
    expect(out0(src)).toEqual(all('na'))
    expect(out0(src.replace('f(2)', 'f(1)'))).toEqual(all(10))
  })
  it('a loop that never runs returns na', () => {
    expect(out0('f(n) =>\n    i = 0\n    while i < 0\n        i += 1\n        i * 10\nplot(f(3))\n')).toEqual(all('na'))
  })
  it('a value-position block (a function arm) ending in a loop is the same rule', () => {
    expect(out0('f(n) =>\n    x = n * 2\n    for i = 1 to n\n        x + i\nplot(f(3))\n')).toEqual(all(9))
  })
  it('a loop with `break` keeps the by-name refusal when its value is read', () => {
    const r = refusalOf('f(n) =>\n    for i = 1 to n\n        if i > 1\n            break\n        i\nplot(f(3))\n')
    expect(r.guard).toBe('runtime:function')
    expect(r.message).toMatch(/ends in a loop/)
  })
  it('an inner loop ending in a void call keeps the whole function valueless and runnable for effect', () => {
    const src = 'var a = array.new<float>()\nload(n) =>\n    for i = 1 to n\n        for j = 1 to 2\n            array.push(a, j)\n'
      + 'load(2)\nplot(array.size(a))\n'
    expect(out0(src)).toEqual([4, 8, 12, 16, 20, 24, 28, 32])
  })
  it('a loop body ending in an if chain keeps the by-name refusal (not given a value here)', () => {
    const r = refusalOf('f(n) =>\n    s = 0.0\n    for i = 1 to n\n        if i > 1\n            s += i\nplot(f(3))\n')
    expect(r.guard).toBe('runtime:function')
    expect(r.message).toMatch(/ends in a loop/)
  })
  it('a loop body ending in a tuple destructuring keeps the by-name refusal', () => {
    const r = refusalOf('g(i) =>\n    [i, i + 1]\nf(n) =>\n    for i = 1 to n\n        [a, b] = g(i)\nplot(f(3))\n')
    expect(r.message).toMatch(/ends in a loop|tuple|values/)
  })
  it('a loop whose body ends in a void call is still valueless, and runs for its effect', () => {
    const src = 'var a = array.new<float>()\nload(n) =>\n    for i = 1 to n\n        array.push(a, i)\n'
      + 'load(3)\nplot(array.size(a))\n'
    expect(out0(src)).toEqual([3, 6, 9, 12, 15, 18, 21, 24])
    const r = refusalOf('var a = array.new<float>()\nload(n) =>\n    for i = 1 to n\n        array.push(a, i)\nplot(load(3))\n')
    expect(r.message).toMatch(/ends in a loop/)
  })
})

describe('W4-T15 a one-line body that is a binding or comma statements', () => {
  it('a binding yields the value it bound', () => {
    expect(out0('f(x) => a = x * 2\nplot(f(close))\n')).toEqual(BARS.map((b) => b.c * 2))
  })
  it('comma statements run in order, the last is the value', () => {
    expect(out0('f(x) => a = x * 2, a + 1\nplot(f(close))\n')).toEqual(BARS.map((b) => b.c * 2 + 1))
  })
  it('a reassignment inside the comma list (`ma(x)=>a=0.,a:=...`)', () => {
    expect(out0('ma(x) => a = 0., a := x + 1, a * 2\nplot(ma(close))\n')).toEqual(BARS.map((b) => (b.c + 1) * 2))
  })
  it('comma statements without any binding: a call for its effect, then the value', () => {
    expect(out0('f(x) => log.info("v={0}", x), x + 1\nplot(f(close))\n')).toEqual(BARS.map((b) => b.c + 1))
  })
  it('a plain expression body is read as before', () => {
    expect(out0('f(x) => x == 100 ? 1 : 2\nplot(f(close))\n')).toEqual([1, 2, 2, 2, 2, 2, 2, 2])
  })
})

describe('W4-T15 log.* statements', () => {
  it('log.info / log.warning / log.error draw nothing and change nothing', () => {
    for (const fn of ['info', 'warning', 'error']) {
      expect(out0(`log.${fn}("hi {0}", close)\nplot(close)\n`)).toEqual(BARS.map((b) => b.c))
    }
  })
  it('log.error does not stop the run: runtime.error stays the only stop', () => {
    const r = run('if close > 103\n    log.error("bad")\nplot(close)\n')
    expect(r.error == null).toBe(true)
    expect(Array.from(r.outputs[0])).toEqual(BARS.map((b) => b.c))
  })
  it('an argument that DOES something is still evaluated (a stateful user function)', () => {
    const src = 'var a = array.new<float>()\ng(x) =>\n    array.push(a, x)\n    array.size(a)\n'
      + 'log.info("n={0}", g(close))\nplot(array.size(a))\n'
    expect(out0(src)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
  it('a function may end in log.*, called on a line of its own; reading its value is refused', () => {
    expect(out0('f(x) =>\n    log.info("x={0}", x)\nf(close)\nplot(close)\n')).toEqual(BARS.map((b) => b.c))
    expect(refusalOf('f(x) =>\n    log.info("x={0}", x)\nplot(f(close))\n').message).toMatch(/log\.info/)
  })
  it('log.* used as a value is still refused', () => {
    expect(build('x = log.info("a")\nplot(x)\n').ok).toBe(false)
  })
})

describe('W4-T15 the object door keeps master\'s answer', () => {
  const door = { objectDoor: true }
  it('each new form is refused at the door, as on master', () => {
    const forms = [
      'f(x, len = 2) =>\n    x * len\nplot(f(close, len = 3))\n',
      'f(n) =>\n    s = 0.0\n    for i = 1 to n\n        s += i\nplot(f(3))\n',
      'f(x) => a = x * 2\nplot(f(close))\n',
      'log.info("hi")\nplot(close)\n',
    ]
    for (const src of forms) {
      expect(build(src).ok, src).toBe(true)
      expect(build(src, door).ok, src).toBe(false)
    }
    // the door's refusal is master's own sentence, not a different one reached by a new route
    expect(refusalOf(forms[1], door).message).toMatch(/ends in a loop/)
    expect(refusalOf(forms[0], door).message).toMatch(/named argument `len`/)
  })
})
