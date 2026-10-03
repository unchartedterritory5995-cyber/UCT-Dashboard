// app/src/components/chart/engine/runtime/__tests__/runtimeStatementShapes.test.js
//
// ─── ⭐⭐ R1 STEP 2 — `runtime:statement`, THE SHAPES THAT WERE EXACT ────────
//
// `runtime:statement` ("a statement shape this front end does not recognise")
// was the runtime lane's largest first wall: 33 of the 266 committed scripts,
// 37 once the strategies moved off `runtime:declaration`. It is not one wall but
// a dozen. These rails hold the ones R1 took, each as Pine reads it:
//
//   A. a lone value on a line of its own (`countBuy` closing an `if` body, `100`
//      inside a function's early `if`) is discarded — never a function's return;
//   B. `[x]` as a function result is a ONE-element tuple, unpacked by `[a] = f()`,
//      and still refused as a plain value;
//   C. a function ending in a void collection call returns nothing (the loop
//      case's twin: valueless, its result refused at a reading call site);
//   D. `request.security(symbol = …, timeframe = …, expression = …)` is the
//      positional call (placement by `pine.js`'s `positionaliseSecurityArgs`);
//   E. `plot(title = …, series = …)` plots the SERIES, not the title;
//   F. the one-argument `ta.highest(n)` / `ta.lowest(n)` is the explicit
//      `high` / `low` form (`PINE_SHORT_FORM`), here as in the columnar lane;
//   G. an interpreter refusal keeps its own guard instead of `runtime:statement`.
//
// Vendor-grounded halves: `#RRGGBBAA` (`ast/runtimeColourLiteral8.vendor.test.js`)
// and the discarded value on a real script (`ast/runtimeDiscardedValue.vendor.test.js`).
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 10 + i, h: 11 + i + (i % 3), l: 9 + i - (i % 2), c: 10.5 + i + (i % 2), v: 100 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const HEAD = '//@version=5\nindicator("t")\n'

const build = (body) => buildRuntimeIr(`${HEAD}${body}\n`, { bars: BARS, inputs: {} })
const run = (body) => {
  const built = build(body)
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return { outputs: outputs.map((o) => Array.from(o)), diagnostics: built.diagnostics }
}
const refusal = (body) => {
  const built = build(body)
  expect(built.ok, 'expected a refusal').toBe(false)
  return built.refusal
}

describe('A — a lone value whose value nothing reads', () => {
  it('closing an `if` body: discarded, and the drawing is the one without it', () => {
    const withLine = run('var n = 0\nif close > open\n    n += 1\n    n\nplot(n)')
    const without = run('var n = 0\nif close > open\n    n += 1\nplot(n)')
    expect(withLine.outputs).toEqual(without.outputs)
    expect(Math.max(...without.outputs[0])).toBeGreaterThan(0)
    expect(withLine.diagnostics.families['runtime:discarded-value']).toBe(1)
  })

  it('⭐ an early `if` in a function does NOT return its value — the LAST statement does (§16)', () => {
    const { outputs } = run('f(x) =>\n    if x > 0\n        100\n    x * 2\nplot(f(close))')
    expect(outputs[0]).toEqual(BARS.map((b) => b.c * 2))
  })

  it('⛔ still lowered: an unbound name refuses by its own name', () => {
    const r = refusal('y = 1\nif close > open\n    nosuchname\nplot(y)')
    expect(r.guard).toBe('pine:undefined')
    expect(r.message).toContain('nosuchname')
  })

  it('⛔ a function that ENDS in a loop is still valueless — its result is never the skipped line', () => {
    const r = refusal('f(n) =>\n    s = 0\n    for i = 0 to n\n        s\nplot(f(3))')
    expect(r.guard).toBe('runtime:function')
    expect(r.message).toMatch(/ends in a loop/)
  })

  it('⛔ only an ATOM is skipped — an expression with an operator still refuses', () => {
    expect(refusal('y = 1\nif close > open\n    y + 1\nplot(y)').guard).toBe('runtime:statement')
  })
})

describe('B — `[x]` is a one-element tuple', () => {
  it('unpacked by `[a] = f()`', () => {
    const { outputs } = run('f() =>\n    [close + 1]\n[a] = f()\nplot(a)')
    expect(outputs[0]).toEqual(BARS.map((b) => b.c + 1))
  })

  it('⛔ and NOT readable as a plain value', () => {
    for (const body of ['f() =>\n    [close]\nplot(f())', 'f() =>\n    [close]\nx = f()\nplot(x)']) {
      const r = refusal(body)
      expect(r.guard).toBe('runtime:statement')
      expect(r.message).toMatch(/returns a one-element tuple/)
    }
  })

  it('⛔ a count mismatch is named', () => {
    expect(refusal('f() =>\n    [close, open]\n[a] = f()\nplot(a)').message).toMatch(/unpacks 1 names from a call that returns 2/)
  })
})

describe('C — a function ending in a void collection call returns nothing', () => {
  it('called on its own line, it runs', () => {
    const { outputs } = run('var a = array.new_float(1, 0)\nsetIt(_A, v) =>\n    array.set(_A, 0, v)\nsetIt(a, close)\nplot(array.get(a, 0))')
    expect(outputs[0]).toEqual(BARS.map((b) => b.c))
  })

  it('⛔ its result read as a value refuses, naming the void call', () => {
    const r = refusal('var a = array.new_float(1, 0)\nsetIt(_A, v) =>\n    array.set(_A, 0, v)\nx = setIt(a, close)\nplot(x)')
    expect(r.guard).toBe('runtime:function')
    expect(r.message).toMatch(/ends in `array\.set\(…\)`, which returns nothing/)
  })
})

describe('D — `request.security` with its leading arguments named', () => {
  it('answers exactly what the positional call answers', () => {
    const pos = refusal("x = request.security(syminfo.tickerid, 'W', close)\nplot(x)")
    for (const body of [
      "x = request.security(symbol = syminfo.tickerid, timeframe = 'W', expression = close)\nplot(x)",
      "x = request.security(syminfo.tickerid, timeframe = 'W', expression = close)\nplot(x)",
      "x = request.security(syminfo.tickerid, resolution = 'W', expression = close)\nplot(x)",
    ]) {
      const named = refusal(body)
      expect(named.guard).toBe(pos.guard)
      expect(named.message).toBe(pos.message)
    }
    // ⛔ NON-VACUITY: the positional call gets PAST argument reading — it stops
    // on the symbol this build was not given, not on the argument list.
    expect(pos.guard).toBe('interpret:bind-time-text')
  })

  it('⛔ a name the signature does not have keeps the refusal', () => {
    const r = refusal("x = request.security(sym = syminfo.tickerid, timeframe = 'W', expression = close)\nplot(x)")
    expect(r.message).toMatch(/takes a symbol, a timeframe and a value/)
  })
})

describe('E — an output call reads its VALUE argument, not its first', () => {
  it('`plot(title = …, series = …)` plots the series', () => {
    expect(run('plot(title = "R", series = close, color = color.green)').outputs[0]).toEqual(BARS.map((b) => b.c))
  })
  it('⛔ with no series it says so', () => {
    expect(refusal('plot(title = "R")').message).toMatch(/with no value/)
  })
})

describe('F — the one-argument `ta.highest(n)` / `ta.lowest(n)`', () => {
  it('reaches exactly what the explicit `high` / `low` spelling reaches', () => {
    for (const [short, explicit] of [['ta.highest(len)', 'ta.highest(high, len)'], ['ta.lowest(len)', 'ta.lowest(low, len)']]) {
      const a = refusal(`f(len) =>\n    ${short}\nplot(f(3))`)
      const b = refusal(`f(len) =>\n    ${explicit}\nplot(f(3))`)
      expect(a.guard).toBe(b.guard)
      expect(a.message).toBe(b.message)
      // the explicit source is named in the answer — it is NOT the old arity refusal
      expect(a.message).not.toMatch(/given 1/)
    }
  })
})

describe('G — an interpreter refusal keeps its own guard', () => {
  it('a `syminfo.*` read with no symbol is `interpret:bind-time-text`, not a statement shape', () => {
    const r = refusal('var string u = syminfo.basecurrency\nplot(close)')
    expect(r.guard).toBe('interpret:bind-time-text')
  })
})
