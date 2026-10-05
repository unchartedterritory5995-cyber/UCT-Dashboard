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

describe('⭐⭐ RT14 — `var x = if …` / `var x = switch …` initialise ONCE', () => {
  // closes: 100, 102, 104, 101, 103, 100, 102, 104
  const col = (src) => run(src)[0]

  it('`var … = if`: the first bar\'s branch value, kept on every later bar', () => {
    const src = 'var float x = if close > 101\n    close\nelse\n    -1.0\nplot(x)\n'
    expect(col(src)).toEqual(Array(N).fill(-1))
    // CONTROL: without `var` the same block is evaluated on every bar
    expect(col(src.replace('var float x', 'float x'))).toEqual([-1, 102, 104, -1, 103, -1, 102, 104])
  })

  it('`var … = switch`: evaluated on the first bar only', () => {
    const src = 'var float s = switch\n    close > 99 => close\n    => -2.0\nplot(s)\n'
    expect(col(src)).toEqual(Array(N).fill(100))
    const subj = 'var float t = switch close\n    102.0 => 1.0\n    100.0 => 2.0\n    => 3.0\nplot(t)\n'
    expect(col(subj)).toEqual(Array(N).fill(2))
  })

  it('an unmatched `var … = if` with no else is `na` on every bar', () => {
    expect(col('var float u = if close > 500\n    close\nplot(u)\n')).toEqual(Array(N).fill(null))
  })

  it('a `var` block inside a block initialises on that block\'s first run', () => {
    // the block first runs on bar 1 (close 102); `v` takes 102 then and keeps it
    const src = 'float r = na\nif close > 101\n    var float v = if close > 0\n        close\n    r := v\nplot(r)\n'
    expect(col(src)).toEqual([null, 102, 102, null, 102, null, 102, 102])
  })
})

describe('⭐⭐ RT14 — a function ending in an `if` run for its effect is VALUELESS', () => {
  // closes: 100, 102, 104, 101, 103, 100, 102, 104 — above 101 on bars 1, 2, 4, 6, 7
  const yields = 'f(x) =>\n    if x > 101\n        y = x * 2\n        y\n    else\n        0.0\n'
  const effect = 'var a = array.new_float()\nf(x) =>\n    if x > 101\n        array.push(a, x)\n'

  it('called on a line of its own, its statements run on every call', () => {
    expect(run(effect + 'f(close)\nplot(array.size(a))\n')[0]).toEqual([0, 1, 2, 2, 3, 3, 4, 5])
  })

  it('and a caller ending in a call to it is valueless too (double-topbottom\'s zigzag)', () => {
    const src = effect + 'g(x) =>\n    if x > 0\n        f(x)\ng(close)\nplot(array.size(a))\n'
    expect(run(src)[0]).toEqual([0, 1, 2, 2, 3, 3, 4, 5])
  })

  it('reading its result refuses by name, never answers a value it does not carry', () => {
    const r = build(effect + 'plot(f(close))\n')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:function')
    expect(r.refusal.message).toMatch(/ends in an `if` block/)
  })

  it('CONTROL: an `if` whose arms YIELD is still the function\'s value', () => {
    expect(run(yields + 'plot(f(close))\n')[0]).toEqual([0, 204, 208, 0, 206, 0, 204, 208])
  })
})

describe('⭐⭐ RT14 — an `if` arm whose value is a `switch`', () => {
  it('yields the switch\'s value; an unmatched switch with no default is na', () => {
    const src = 'float x = if close > 101\n    switch\n        close > 103 => 2.0\n        close > 101.5 => 1.0\nelse\n    0.0\nplot(x)\n'
    expect(run(src)[0]).toEqual([0, 1, 2, 0, 1, 0, 1, 2])
    const noDefault = 'float y = if close > 101\n    switch\n        close > 103 => 2.0\nelse\n    0.0\nplot(y)\n'
    expect(run(noDefault)[0]).toEqual([0, null, 2, 0, null, 0, null, 2])
  })
})

describe('⭐⭐ RT14 — a user-type field declared an array is an array', () => {
  // closes: 100, 102, 104, 101, 103, 100, 102, 104
  const T = (decl) => `type T\n    ${decl}\nvar T t = T.new(array.new_float())\n`
  const sums = [100, 202, 306, 407, 510, 610, 712, 816]

  it('`for … in t.xs` walks the field, as `for … in` a named array does', () => {
    const src = T('array<float> xs') + 'array.push(t.xs, close)\nfloat s = 0.0\nfor x in t.xs\n    s += x\nplot(s)\n'
    expect(run(src)[0]).toEqual(sums)
  })

  it('the method form on the field (`t.xs.push(x)`, `t.xs.size()`) is `array.push(t.xs, x)`', () => {
    const src = T('array<float> xs') + 't.xs.push(close)\nplot(t.xs.size())\n'
    expect(run(src)[0]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('`float[] xs` and `float [] xs` declare the same field as `array<float> xs`', () => {
    const body = 't.xs.push(close)\nfloat s = 0.0\nfor x in t.xs\n    s += x\nplot(s)\n'
    expect(run(T('float[] xs') + body)[0]).toEqual(sums)
    expect(run(T('float [] xs') + body)[0]).toEqual(sums)
  })

  it('CONTROL: a field declared a number is not walked as an array', () => {
    const r = build('type U\n    float v\nvar U u = U.new(1.0)\nfloat s = 0.0\nfor x in u.v\n    s += x\nplot(s)\n')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:loop')
  })
})

describe('⭐⭐ RT14 — a record\'s type follows it through a call and out of a global array', () => {
  // closes: 100, 102, 104, 101, 103, 100, 102, 104
  const P = 'type P\n    float v\n    bool up\n'

  it('`d = make(x)` where `make` returns a record: `d.v` is a field read (volume-delta-hapharmonic)', () => {
    const src = P + 'make(x) =>\n    var P p = P.new(0.0, false)\n    p.v := x * 2\n    p\nd = make(close)\nplot(d.v)\n'
    expect(run(src)[0]).toEqual([200, 204, 208, 202, 206, 200, 204, 208])
  })

  it('`for e in pts` over a global `array<P>` inside a function: `e.up` is a field read (sr-logistic)', () => {
    const src = P + 'var pts = array.new<P>()\narray.push(pts, P.new(close, close > 101))\n'
      + 'countUp() =>\n    int n = 0\n    for e in pts\n        if e.up\n            n += 1\n    n\nplot(countUp())\n'
    expect(run(src)[0]).toEqual([0, 1, 2, 2, 3, 3, 4, 5])
  })

  it('`e = pts.get(i)` on a global array inside a function: `e.v` is a field read (volumized-ob)', () => {
    const src = P + 'var pts = array.new<P>()\narray.push(pts, P.new(close, true))\n'
      + 'lastV() =>\n    e = pts.get(pts.size() - 1)\n    e.v\nplot(lastV())\n'
    expect(run(src)[0]).toEqual([100, 102, 104, 101, 103, 100, 102, 104])
  })

  it('a helper ending in a field write is valueless: its effect runs, a read of it refuses by name', () => {
    const base = P + 'var P p = P.new(0.0, false)\nbump(P q) =>\n    q.v := q.v + 1\n'
    expect(run(base + 'bump(p)\nplot(p.v)\n')[0]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    const r = build(base + 'plot(bump(p))\n')
    expect(r.ok).toBe(false)
    expect(r.refusal.message).toMatch(/ends in a write to a field/)
  })
})
