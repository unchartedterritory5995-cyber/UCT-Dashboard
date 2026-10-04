// app/src/components/chart/engine/runtime/__tests__/rt14Language.test.js
//
// ─── ⭐⭐ RT14 — core language completeness on the runtime lane ─────────────────
//
// Each block is one wall RT14 took, with the rule it serves and a control that
// fails without it. The rules are Pine's own language (the manual's spelling of a
// type, the value of a block); no number here is a new semantic choice, and the
// numeric ones are checked against the same script written in the spelling the
// lane already served.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { translatePine } from '../../ast/pine.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 8
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 103 + (i % 3) * 2, l: 97 - (i % 2), c: 100 + ((i * 7) % 5), v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'
const build = (src) => buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
function run(src) {
  const built = build(src)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o, (v) => (Number.isFinite(v) ? v : null)))
}

describe('⭐⭐ RT14 — `T[] name` in a function header is `array<T> name`', () => {
  const body = (param) => [
    `total(${param}) =>`,
    '    float s = 0.0',
    '    for i = 0 to array.size(a) - 1',
    '        s += array.get(a, i)',
    '    s',
    'var float[] xs = array.new_float()',
    'array.push(xs, close)',
    'if array.size(xs) > 3',
    '    array.shift(xs)',
    'plot(total(xs))',
  ].join('\n') + '\n'

  it('`float[] a`, `float []a` and `array<float> a` compute the same column', () => {
    const generic = run(body('array<float> a'))
    expect(run(body('float[] a'))).toEqual(generic)
    expect(run(body('float []a'))).toEqual(generic)
    // and the column is the rolling sum it says it is (not all-na)
    expect(generic[0][N - 1]).toBe(SERIES[3].slice(N - 3).reduce((p, x) => p + x, 0))
  })

  it('a typed qualifier in front (`series float[] a`) reads the same', () => {
    expect(run(body('series float[] a'))).toEqual(run(body('array<float> a')))
  })

  it('CONTROL: a non-empty `[ ]` in a header is still not a parameter list', () => {
    const r = build('f(a[1]) => a\nplot(f(close))\n')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:function')
  })

  it('CONTROL: `x[1]` in a body is a history read, untouched by the header fold', () => {
    const out = run('f(float[] a) => array.size(a)\nfloat[] q = array.new_float()\narray.push(q, 1)\nplot(close[1] + f(q))\n')
    expect(out[0][0]).toBe(null)
    expect(out[0][2]).toBe(SERIES[3][1] + 1)
  })
})

describe('⭐⭐ RT14 — a root binding read where it has no slot is the every-bar variable', () => {
  // The reference spelling: the same value written as a MUTATED root variable,
  // which the lane has always held as a slot assigned on every bar.
  const asSlot = (decl) => decl.replace(/^float (\w+) = (.*)$/m, 'float $1 = na\n$1 := $2')

  it('`ta.change(top)` over a never-mutated `ta.valuewhen` binding equals the slot spelling', () => {
    const src = [
      'float top = ta.valuewhen(high > high[1], high, 0)',
      'plot(ta.change(top))',
    ].join('\n') + '\n'
    const got = run(src)
    expect(got).toEqual(run(asSlot(src)))
    expect(got[0].some((v) => v !== null)).toBe(true)
  })

  it('the same read inside a block reads the variable, not a copy stepped only there', () => {
    const src = [
      'float top = ta.valuewhen(high > high[1], high, 0)',
      'float r = na',
      'if close > open',
      '    r := ta.change(top)',
      'plot(r)',
    ].join('\n') + '\n'
    expect(run(src)).toEqual(run(asSlot(src)))
  })

  it('a STATEFUL binding expanded inside a block steps on every bar (`ta.valuewhen`)', () => {
    // `v` is the last up-close on EVERY bar. The block runs only where close < 102
    // (bars 0, 3, 5) and every up-close happens on OTHER bars — so a copy of the
    // call stepped only inside the block would never see one and answer na.
    const src = [
      'float v = ta.valuewhen(close > close[1], close, 0)',
      'float r = na',
      'if close < 102',
      '    r := v',
      'plot(r)',
    ].join('\n') + '\n'
    const got = run(src)
    expect(got).toEqual(run(asSlot(src)))
    expect(got[0][3]).toBe(104)
  })

  it('a binding read from several blocks is given ONE root slot', () => {
    const src = [
      'float v = ta.valuewhen(close > close[1], close, 0)',
      'float r = na',
      'if close < 102',
      '    r := v',
      'if close > 103',
      '    r := v + ta.change(v)',
      'plot(r)',
    ].join('\n') + '\n'
    const b = build(src)
    expect(b.ok).toBe(true)
    const names = JSON.stringify(b.ir).match(/v root \d+/g) || []
    expect(names.length).toBeGreaterThan(0)
    expect(new Set(names)).toEqual(new Set(['v root 0']))
    expect(run(src)).toEqual(run(asSlot(src)))
  })

  it('CONTROL: a binding made INSIDE a block is that block\'s, never hoisted to the root', () => {
    // Pine keeps a block-local's history per execution of the block; an every-bar
    // root copy of `y` would answer a different `ta.change(y)`.
    const r = build('float z = na\nif close > open\n    y = ta.valuewhen(close > close[1], close, 0)\n    if high > 104\n        z := ta.change(y)\nplot(z)\n')
    expect(JSON.stringify(r.ok ? r.ir : r.refusal)).not.toMatch(/y root/)
  })
})

describe('⭐⭐ RT14 — v1–v4 bare `max` / `min` take three or more arguments, as `math.max` / `math.min`', () => {
  // `translatePine` is the host lane AND the resolver the runtime lane asks for
  // every column, so one rule serves both (blackflag-fts refused `pine:arity`).
  const LF = '\n'
  const formula = (src) => {
    const out = translatePine(src, { strict: true })
    if (!out.ok) return `REFUSED ${(out.refusal || {}).guard}`
    return out.outputs[out.selected].formula
  }
  const v4 = (call) => formula(`//@version=4${LF}study("t")${LF}plot(${call})${LF}`)
  const v5 = (call) => formula(`//@version=5${LF}indicator("t")${LF}plot(${call})${LF}`)

  it('`max(a, b, c)` in v4 is v5\'s `math.max(a, b, c)` — the vendor-pinned left fold', () => {
    expect(v4('max(high, low, close)')).toBe(v5('math.max(high, low, close)'))
    expect(v4('min(high, low, close, open)')).toBe(v5('math.min(high, low, close, open)'))
    expect(v4('max(high, low, close)')).toBe('max(max(high, low), close)')
  })

  it('CONTROL: two arguments keep the node they always resolved to', () => {
    expect(v4('max(high, low)')).toBe('max(high, low)')
  })

  it('CONTROL: only max and min — v4 round(x, 2) is not given the v5 precision argument', () => {
    // v4's `round` takes one argument; `math.round(x, n)` is a v5 builtin.
    expect(v4('round(close, 2)')).toMatch(/^REFUSED pine:arity/)
    expect(v4('round(close)')).toBe('round(close)')
  })

  it('CONTROL: v5 bare `max` with three arguments still refuses (not Pine v5)', () => {
    expect(v5('max(high, low, close)')).toMatch(/^REFUSED pine:arity/)
  })

  it('CONTROL: a script\'s own `max` wins', () => {
    const own = formula(`//@version=4${LF}study("t")${LF}max(a, b, c) => a + b + c${LF}plot(max(high, low, close))${LF}`)
    expect(own).not.toMatch(/max\(max/)
  })

  it('the runtime lane computes it: equal to the nested spelling bar for bar', () => {
    const r4 = (body) => {
      const built = buildRuntimeIr(`//@version=4${LF}study("t")${LF}${body}`, { bars: BARS, inputs: {} })
      if (!built.ok) throw new Error(`refused: ${built.refusal.guard}`)
      const program = lowerIrProgram(built.ir)
      return execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true }).outputs
        .map((o) => Array.from(o))
    }
    const src = (e) => `var float m = 0.0${LF}m := ${e}${LF}plot(m)${LF}`
    const nested = r4(src('max(max(max(high, low * 1.05), close + 1), nz(m[1]) - 1)'))
    expect(r4(src('max(high, low * 1.05, close + 1, nz(m[1]) - 1)'))).toEqual(nested)
    // non-vacuity: the state argument is read (a bar where it is the largest)
    expect(nested[0].slice(1).every((v) => Number.isFinite(v))).toBe(true)
  })

  it('`math.max` / `math.min` with three arguments over runtime state (v5) fold the same way', () => {
    const r5 = (e) => run(`var float m = 0.0${LF}m := ${e}${LF}plot(m)${LF}`)
    expect(r5('math.max(high, close + 1, nz(m[1]) - 1)')).toEqual(r5('math.max(math.max(high, close + 1), nz(m[1]) - 1)'))
    expect(r5('math.min(low, close - 1, nz(m[1]) + 1)')).toEqual(r5('math.min(math.min(low, close - 1), nz(m[1]) + 1)'))
  })
})

describe('⭐⭐ RT14 — support-and-resistance\'s chain: bindings of bindings, read inside blocks', () => {
  // The script's own shape, reduced: each name is a never-mutated root binding;
  // the last two are read only inside `if` blocks.
  const lines = [
    'float lt = ta.valuewhen(high >= ta.highest(high, 3), high, 0)',
    'float ltr = ta.change(lt) != 0 ? na : lt',
    'bool isNew = ta.change(fixnan(ltr)) != 0',
    'float r = na',
    'if not na(ltr)',
    '    if isNew',
    '        r := ltr',
    'plot(r)',
  ]
  it('builds, and equals the spelling where every binding is a mutated (slot) variable', () => {
    const src = lines.join('\n') + '\n'
    const slotted = lines.map((l) => l.replace(/^(float|bool) (\w+) = (.*)$/, (m, t, n, v) => (n === 'r' ? m : `${t} ${n} = na\n${n} := ${v}`)))
      .join('\n') + '\n'
    expect(run(src)).toEqual(run(slotted))
  })
})
