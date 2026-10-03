// app/src/components/chart/engine/runtime/__tests__/c18WhileAndLastBar.test.js
//
// ─── ⭐⭐ C18 — `while`, AND THE IMPERATIVE LAST-BAR PROGRAMS IT UNLOCKS ─────────
//
// Objects-triage § C18. Two corpus scripts compute what they draw imperatively on
// the last bar: `k-clustering` (a convergence `while`, arrays reassigned whole,
// `array.slice`, a method on an untyped parameter) and
// `options-max-pain-calculator-backquant` (`while` loops building and scanning
// arrays inside helpers called for effect, if-expression arms that declare, `int()`
// over computed values, `color.from_gradient`, and — measured on its capture — a
// v6 `or` and a `?:` whose un-taken side would read past an array's end).
//
// ⛔ THE RULE FOR A LOOP: a `while` that STOPS within the engine's
// `WHILE_ITERATIONS` bound computes exactly what Pine computes (the loop has no
// semantics but its body), so it is served; one that does not is stopped BY NAME
// at its own line, for that run — never cut short and read.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lexPine, blockStatements, parseWholeExpression } from '../../ast/pine.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { Budget, RuntimeLimitError, DEFAULT_LIMITS } from '../limits.js'

const N = 4
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const V6 = '//@version=6\nindicator("t", overlay = true)\n'
const V5 = '//@version=5\nindicator("t", overlay = true)\n'

function build(src, opts = {}) {
  return buildRuntimeIr((opts.head || V6) + src, { bars: BARS, inputs: {}, ...(opts.build || {}) })
}
function run(src, opts = {}) {
  const built = build(src, opts)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const budget = opts.budget || new Budget(opts.limits)
  const { outputs } = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  }, undefined, { budget })
  return { outputs: outputs.map((o) => Array.from(o)), built, budget }
}
const out0 = (src, opts) => run(src, opts).outputs[0]
const all = (v) => new Array(N).fill(v)

describe('⭐⭐ `while` — the test is re-read before every pass', () => {
  it('sums while the test holds', () => {
    expect(out0('float s = 0.0\nint i = 0\nwhile i < 4\n    i += 1\n    s += i\nplot(s)\n')).toEqual(all(10))
  })

  it('⛔ the test is RE-EVALUATED — a body that moves the bound is obeyed', () => {
    // A `for` reads its bound once; a `while` reads it every pass. With the bound
    // read once this stops at 3; Pine keeps going to 5.
    expect(out0('int n = 3\nint i = 0\nwhile i < n\n    i += 1\n    if i == 2\n        n := 5\nplot(i)\n'))
      .toEqual(all(5))
  })

  it('`break` leaves the loop and `continue` skips to the next test', () => {
    expect(out0('float s = 0.0\nint i = 0\nwhile true\n    i += 1\n    if i > 6\n        break\n'
      + '    if i % 2 == 0\n        continue\n    s += i\nplot(s)\n')).toEqual(all(1 + 3 + 5))
  })

  it('⛔ an `na` test is false — the body never runs (v5, where a number may be a test)', () => {
    expect(out0('float t = na\nint c = 0\nwhile t\n    c += 1\n    t := 0.0\nplot(c)\n', { head: V5 }))
      .toEqual(all(0))
  })
})

describe('⛔⛔ the bound — an ENGINE limit, and exceeding it is a refusal, never a value', () => {
  it('a loop that stops on its last allowed pass is served whole', () => {
    expect(out0('int i = 0\nwhile i < 5\n    i += 1\nplot(i)\n', { limits: { WHILE_ITERATIONS: 5 } }))
      .toEqual(all(5))
  })

  it('one pass more stops the run BY NAME, at the loop\'s own line and bar', () => {
    let err = null
    try { run('int i = 0\nwhile i < 6\n    i += 1\nplot(i)\n', { limits: { WHILE_ITERATIONS: 5 } }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(RuntimeLimitError)
    expect(err.limit).toBe('WHILE_ITERATIONS')
    expect(err.line).toBe(4)
    expect(err.bar).toBe(0)
  })

  it('⭐ the count is PER ENTRY — a loop reached every bar does not accumulate', () => {
    // 3 passes a bar over 4 bars is 12 passes in all, under a bound of 5.
    expect(out0('int i = 0\nwhile i < 3\n    i += 1\nplot(i)\n', { limits: { WHILE_ITERATIONS: 5 } }))
      .toEqual(all(3))
  })

  it('⛔ a loop that never stops is stopped, not hung', () => {
    let err = null
    try { run('float s = 0.0\nwhile true\n    s += 1\nplot(s)\n') } catch (e) { err = e }
    expect(err).toBeInstanceOf(RuntimeLimitError)
    expect(err.limit).toBe('WHILE_ITERATIONS')
    expect(err.ceiling).toBe(DEFAULT_LIMITS.WHILE_ITERATIONS)
  })
})

describe('⭐ what the two C18 scripts write around their loops', () => {
  it('`x += 1` on a plain declaration is a mutation (the pre-scan reads the compound form)', () => {
    expect(out0('count = 0\ncount += 2\nplot(count)\n')).toEqual(all(2))
  })

  it('`max_bars_back(x, 5000)` is a no-op here; a smaller bound still refuses', () => {
    expect(out0('x = close\nmax_bars_back(x, 5000)\nplot(x[1])\n').slice(1)).toEqual([100, 101, 102])
    const r = build('x = close\nmax_bars_back(x, 100)\nplot(x[1])\n')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:directive')
  })

  it('an array member on an UNTYPED parameter reads as the array call', () => {
    expect(out0('f(arry) =>\n    arry.size()\na = array.from(1.0, 2.0, 3.0)\nplot(f(a))\n')).toEqual(all(3))
  })

  it('⛔ …and a non-array argument is stopped by the VM\'s own kind check, by name', () => {
    expect(() => run('f(arry) =>\n    arry.size()\nplot(f(close))\n')).toThrow(/array\.size/)
  })

  it('a helper that ENDS IN A LOOP runs for its effect; reading its value is refused', () => {
    const src = 'var strikes = array.new<float>()\n'
      + 'load(n) =>\n    array.clear(strikes)\n    i = 0\n    while i < n\n        array.push(strikes, i)\n        i += 1\n'
      + 'load(3)\nplot(array.size(strikes))\n'
    expect(out0(src)).toEqual(all(3))
    const r = build('g(n) =>\n    i = 0\n    while i < n\n        i += 1\nplot(g(3))\n')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:function')
    expect(r.refusal.message).toMatch(/ends in a loop/)
  })

  it('an if-expression arm may DECLARE, then answer (max-pain `bs_gamma_simple`)', () => {
    const src = 'f(c) =>\n    if c <= 0\n        0.0\n    else\n        d1 = c * 2\n        d1 + 1\nplot(f(close))\n'
    expect(out0(src)).toEqual([201, 203, 205, 207])
  })

  it('an arm may END in a nested if chain; a nested chain that matches nothing is na', () => {
    const src = 'f(c) =>\n    if c > 101\n        if c > 102\n            2.0\n    else\n        1.0\nplot(f(close))\n'
    const out = out0(src).map((v) => (Number.isFinite(v) ? v : null))
    // 100 → else → 1; 101 → else → 1; 102 → outer arm, inner no match → na; 103 → 2
    expect(out).toEqual([1, 1, null, 2])
  })

  it('`int(x)` truncates toward zero over a computed value; `float(x)` is x', () => {
    const src = 'var float x = 0.0\nx := close - 102.5\nplot(int(x))\nplot(float(x))\n'
    const { outputs } = run(src)
    expect(outputs[0]).toEqual([-2, -1, 0, 0])
    expect(outputs[1]).toEqual([-2.5, -1.5, -0.5, 0.5])
    expect(out0('var float x = na\nx := x\nplot(int(x))\n').every((v) => Number.isNaN(v))).toBe(true)
  })
})

describe('⭐⭐ v6 `and`/`or` and `?:` do not run the side that is not taken', () => {
  it('`or` does not read past an empty array when its left side decides (v6)', () => {
    const src = 'a = array.new<float>()\nbool ok = array.size(a) == 0 or array.get(a, array.size(a) - 1) > 0\nplot(ok ? 1 : 0)\n'
    expect(out0(src)).toEqual(all(1))
  })

  it('⛔ CONTROL — v5 evaluates both sides, so the same line stops the run there', () => {
    const src = 'a = array.new<float>()\nbool ok = array.size(a) == 0 or array.get(a, array.size(a) - 1) > 0\nplot(ok ? 1 : 0)\n'
    expect(() => run(src, { head: V5 })).toThrow(/array\.get: index -1/)
  })

  it('`and` skips its right side when the left is false', () => {
    const src = 'a = array.new<float>()\nbool ok = array.size(a) > 0 and array.get(a, 0) > 0\nplot(ok ? 1 : 0)\n'
    expect(out0(src)).toEqual(all(0))
  })

  it('`?:` runs only the arm it picks when its test is a comparison', () => {
    const src = 'a = array.from(1.0, 2.0)\nint i = 0\ni := 1\nv = i < 1 ? array.get(a, i + 1) : 7.0\nplot(v)\n'
    expect(out0(src)).toEqual(all(7))
  })
})

describe('⭐⭐ an unmeasured value under a caller\'s PROBE', () => {
  it('without a probe, an empty reduction and a gradient still stop the run by name', () => {
    expect(() => run('a = array.new<float>()\nplot(array.avg(a))\n')).toThrow(/array\.avg of an empty array/)
    // ⚰️ C29 computes a gradient; only what no capture pins stops. ⭐ C48 re-pin —
    // that was an empty range (`1, 1`), measured now (the zero colour); a value
    // outside REVERSED bounds is what is left.
    expect(() => run('bgcolor(color.from_gradient(close, 1e12, 1e11, color.red, color.green))\nplot(close)\n'))
      .toThrow(/color\.from_gradient/)
    expect(() => run('bgcolor(color.from_gradient(close, 1, 1, color.red, color.green))\nplot(close)\n')).not.toThrow()
  })

  it('with one, it answers the probe and records the hit', () => {
    const budget = new Budget()
    budget.unmeasured = { probe: -7.5, colourProbe: 0x11223344, hits: [] }
    const { outputs } = run('a = array.new<float>()\nplot(array.avg(a))\n', { budget })
    expect(outputs[0]).toEqual(all(-7.5))
    expect(budget.unmeasured.hits).toEqual(new Array(N).fill('array.avg'))
  })
})

describe('⭐⭐ `objectTreesAt` — a value read where a drawing stands', () => {
  const headerAt = (src, line) => {
    const { tokens, indents } = lexPine(src)
    const find = (list) => {
      for (const st of list) {
        const h = st.header || []
        if (h[0] && h[0].line === line) return h
        const r = find(st.sub || [])
        if (r) return r
      }
      return null
    }
    return find(blockStatements(tokens, indents, 0))
  }
  const at = (src, line, expr) => {
    const h = headerAt(V6 + src, line)
    return { line: h[0].line, column: h[0].column, node: expr ? parseWholeExpression(lexPine(expr).tokens) : null }
  }
  const runAt = (src, specs) => {
    const built = buildRuntimeIr(V6 + src, { bars: BARS, inputs: {}, objectTrees: [], objectTreesAt: specs })
    if (!built.ok) return { built }
    const program = lowerIrProgram(built.ir)
    const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
    return { built, cols: built.objectAtOutputs.map((k) => Array.from(outputs[k])) }
  }

  it('reads the value AT the statement — a later write in the block is not seen', () => {
    const src = 'float y = 0.0\nif close > 101\n    y := close * 2\n    label.new(bar_index, y)\n    y := -1.0\n'
    const { cols } = runAt(src, [at(src, 6, null), at(src, 6, 'y')])
    const nn = (xs) => xs.map((v) => (Number.isFinite(v) ? v : null))
    expect(nn(cols[0])).toEqual([null, null, 1, 1])        // reached only where the `if` holds
    expect(nn(cols[1])).toEqual([null, null, 204, 206])    // y at the label, not the -1 after it
  })

  it('⛔ a position inside a loop refuses — it has more than one value a bar', () => {
    const src = 'int i = 0\nwhile i < 2\n    label.new(bar_index, i)\n    i += 1\n'
    const { built } = runAt(src, [at(src, 5, 'i')])
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('runtime:object-position')
  })

  it('⛔ a position the walk never reaches refuses', () => {
    const src = 'label.new(bar_index, close)\n'
    const { built } = runAt(src, [{ line: 99, column: 1, node: null }])
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('runtime:object-position')
  })
})
