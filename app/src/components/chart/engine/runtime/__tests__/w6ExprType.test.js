// app/src/components/chart/engine/runtime/__tests__/w6ExprType.test.js
//
// ─── ⭐⭐ W6-T3b — `exprType`, WITH RETURN-TYPE INFERENCE PER CALL SITE ─────────
//
// `exprType(node, scope)` answers a T3a descriptor (`ast/typeDescriptor.js`) for an
// expression, or `null` when it cannot tell (a caller that needs a type refuses by
// name on `null`). Pine has no declared return types: a user function's result is
// inferred from its body, once per distinct set of argument types, which is why
// one definition can answer two types at two call sites.
//
// The answers are read through the front end's TEST PROBE (`opts.exprTypeProbe`):
// `exprTypeOf(text)` types one expression in the finished program's root scope.
// No served path reads a new answer yet (T6 / T9 will); the one served caller,
// the method form's family callback, is pinned unchanged by `w6TypeDescriptor`.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'

const N = 4
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i * 2, l: 98 - i, c: 100 + i * 3, v: 1000 + i }))
const head = '//@version=6\nindicator("t", overlay = true)\n'

const FOO = 'type Foo\n    float x = 0\n    array<float> xs\n    Bar b\ntype Bar\n    string s = "a"\n'
const HELD = [
  'var obs = array.new<Foo>()',
  'var array<float> af = array.new_float(0)',
  'var Foo f = Foo.new()',
  'var matrix<float> m = na',
  'var map<string, float> mp = na',
  'u = close',
].join('\n')

const build = (src) => buildRuntimeIr(head + src, { bars: BARS, inputs: {}, exprTypeProbe: true })
/** `exprTypeOf` of a program made of `FOO`, `HELD`, the extra source, and a plot. */
const typer = (extra = '') => {
  const b = build(`${FOO}${HELD}\n${extra}\nplot(close)\n`)
  expect(b.ok, b.ok ? '' : `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
  return b.exprTypeOf
}

const num = { kind: 'num' }
const text = { kind: 'text' }
const foo = { kind: 'udt', name: 'Foo' }

describe('⭐ 1. names, field paths and `Foo.new(…)`', () => {
  it('a name is its slot\'s descriptor, without the slot\'s `declaredOnly` history', () => {
    const t = typer()
    expect(t('obs')).toEqual({ kind: 'array', elem: foo })
    expect(t('af')).toEqual({ kind: 'array', elem: num })
    expect(t('m')).toEqual({ kind: 'matrix', elem: num })
    expect(t('mp')).toEqual({ kind: 'map', key: text, elem: num })
    expect(t('f')).toEqual(foo)
    expect(t('u')).toBe(null)
    expect(t('na')).toBe(null)
  })
  it('a field path walks each field\'s WRITTEN type, and a misspelt step is null', () => {
    const t = typer()
    expect(t('f.x')).toEqual(num)
    expect(t('f.xs')).toEqual({ kind: 'array', elem: num })
    expect(t('f.b')).toEqual({ kind: 'udt', name: 'Bar' })
    expect(t('f.b.s')).toEqual(text)
    expect(t('f.nope')).toBe(null)
    expect(t('Foo.new()')).toEqual(foo)
    expect(t('Foo.new().b.s')).toEqual(text)
  })
})

describe('⭐ 2. collection reads give the element (or the map\'s value) type', () => {
  it('array reads, name form and method form', () => {
    const t = typer()
    for (const e of ['array.get(obs, 0)', 'obs.get(0)', 'obs.first()', 'obs.last()', 'obs.pop()',
      'obs.shift()', 'obs.remove(0)', 'array.last(obs)']) expect(t(e), e).toEqual(foo)
    expect(t('af.get(0)')).toEqual(num)
    expect(t('obs.get(0).x')).toEqual(num)
    expect(t('obs.get(0).b.s')).toEqual(text)
  })
  it('matrix.get gives the element; map.get the value type', () => {
    const t = typer()
    expect(t('m.get(0, 0)')).toEqual(num)
    expect(t('matrix.get(m, 0, 0)')).toEqual(num)
    expect(t('mp.get("a")')).toEqual(num)
    expect(t('map.get(mp, "a")')).toEqual(num)
  })
  it('a read on a collection whose element type nobody wrote is null, not a guess', () => {
    const t = typer('var a0 = array.new_float(0)\nvar ws = array.new<float>()')
    expect(t('a0')).toEqual({ kind: 'array' })
    expect(t('a0.get(0)')).toBe(null)
  })
})

describe('⭐ 3. collection-returning built-ins', () => {
  it('copy / concat / slice keep the receiver\'s type; from / new* build one', () => {
    const t = typer()
    expect(t('array.copy(obs)')).toEqual({ kind: 'array', elem: foo })
    expect(t('obs.copy()')).toEqual({ kind: 'array', elem: foo })
    expect(t('array.concat(af, af)')).toEqual({ kind: 'array', elem: num })
    expect(t('array.slice(obs, 0, 1)')).toEqual({ kind: 'array', elem: foo })
    expect(t('array.from(1, 2)')).toEqual({ kind: 'array', elem: num })
    expect(t('array.from("a", "b")')).toEqual({ kind: 'array', elem: text })
    expect(t('array.from(1, "b")')).toEqual({ kind: 'array' })
    expect(t('array.new_float(0)')).toEqual({ kind: 'array', elem: num })
    expect(t('array.new_string(1)')).toEqual({ kind: 'array', elem: text })
    expect(t('array.new<Foo>()')).toEqual({ kind: 'array', elem: foo })
    expect(t('array.new<Foo>().get(0).x')).toEqual(num)
    expect(t('matrix.new<int>(2, 2)')).toEqual({ kind: 'matrix', elem: num })
    expect(t('map.new<string, float>()')).toEqual({ kind: 'map', key: text, elem: num })
  })
  it('map.keys / values and matrix.row / col are arrays of the key / value / element', () => {
    const t = typer()
    expect(t('mp.keys()')).toEqual({ kind: 'array', elem: text })
    expect(t('mp.values()')).toEqual({ kind: 'array', elem: num })
    expect(t('m.row(0)')).toEqual({ kind: 'array', elem: num })
    expect(t('matrix.col(m, 0)')).toEqual({ kind: 'array', elem: num })
    expect(t('mp.keys().get(0)')).toEqual(text)
  })
})

describe('⭐ 4. `?:`, `if` and `switch` as values: the arms\' common type', () => {
  const blocks = [
    'ifNa(x) =>\n    if x > 0\n        Foo.new()\n    else\n        na',
    'ifNoElse(x) =>\n    if x > 0\n        Foo.new()',
    'ifBad(x) =>\n    if x > 0\n        Foo.new()\n    else\n        1',
    'ifElif(x) =>\n    if x > 0\n        "a"\n    else if x < 0\n        "b"\n    else\n        "c"',
    'ifElifBad(x) =>\n    if x > 0\n        "a"\n    else if x < 0\n        Foo.new()\n    else\n        "c"',
    'ifElifLastBad(x) =>\n    if x > 0\n        "a"\n    else if x < 0\n        "b"\n    else\n        1',
    'sw(k) =>\n    switch k\n        1 => Foo.new()\n        => na',
    'swBad(k) =>\n    switch k\n        1 => Foo.new()\n        2 => "x"\n        => na',
    'swBlock(k) =>\n    switch k\n        1 =>\n            y = Foo.new()\n            y\n        => Foo.new()',
    'bound(x) =>\n    r = if x > 0\n        "a"\n    else\n        "b"\n    r',
  ].join('\n')
  it('an `na` arm takes the other arm\'s type', () => {
    const t = typer(blocks)
    expect(t('close > open ? Foo.new() : na')).toEqual(foo)
    expect(t('close > open ? na : obs.get(0)')).toEqual(foo)
    expect(t('ifNa(1)')).toEqual(foo)
    expect(t('ifNoElse(1)')).toEqual(foo)
    expect(t('sw(1)')).toEqual(foo)
    expect(t('swBlock(1)')).toEqual(foo)
    expect(t('ifElif(1)')).toEqual(text)
    expect(t('bound(1)')).toEqual(text)
  })
  it('⛔ arms that DISAGREE answer null, never the first arm', () => {
    const t = typer(blocks)
    expect(t('close > open ? Foo.new() : 1')).toBe(null)
    expect(t('close > open ? Foo.new() : f.b')).toBe(null)
    expect(t('close > open ? 1 : "x"')).toBe(null)
    expect(t('ifBad(1)')).toBe(null)
    expect(t('ifElifBad(1)')).toBe(null)
    expect(t('swBad(1)')).toBe(null)
    // review B1(a): every return path must agree, the third arm and beyond included
    expect(t('ifElifLastBad(1)')).toBe(null)
    expect(t('close > open ? na : na')).toBe(null)
  })
  it('operators: text + text is text, num op num is num, a comparison is bool, mixed is null', () => {
    const t = typer()
    expect(t('"a" + "b"')).toEqual(text)
    expect(t('1 + 2')).toEqual(num)
    expect(t('close > open')).toEqual({ kind: 'bool' })
    expect(t('"a" + 1')).toBe(null)
  })
})

describe('⭐ 5. method-call results', () => {
  const methods = 'method twice(Foo this) => Foo.new(this.x * 2)\nmethod label(Foo this) => "f"'
  it('a user method\'s result, by inference; a built-in member\'s declared result', () => {
    const t = typer(methods)
    expect(t('f.twice()')).toEqual(foo)
    expect(t('twice(f)')).toEqual(foo)
    expect(t('f.twice().x')).toEqual(num)
    expect(t('f.twice().twice()')).toEqual(foo)
    expect(t('obs.get(0).label()')).toEqual(text)
    expect(t('obs.first().twice().b.s')).toEqual(text)
  })
  it('⛔ an overloaded function answers null (T9 types overloads by argument type)', () => {
    // An overloaded `method` refuses the whole build today (`runtime:udt-method`);
    // a plain function written twice builds, and its result is not inferred.
    const t = typer('g(float x) => Foo.new()\ng(string x) => "a"\none(float x) => Foo.new()')
    expect(t('one(1)')).toEqual(foo)
    expect(t('g(1)')).toBe(null)
  })
})

describe('⭐⭐ 6. user function results, inferred PER CALL SITE', () => {
  const fns = [
    'firstOf(x) => x.get(0)',
    'typed(array<float> x) => x.get(0)',
    'pick(a, b) => b',
    'rec(n) => n > 0 ? rec(n - 1) : Foo.new()',
    'nonrec(n) => n > 0 ? Foo.new() : Foo.new()',
    'body(x) =>\n    y = x.get(0)\n    z = y.x\n    z',
    'naPass(x) => close > open ? x : "a"',
    'loopy(x) =>\n    s = 0.0\n    for i = 0 to 2\n        s += i\n    s',
  ].join('\n')
  it('one definition, two answers: `firstOf(array<Foo>)` and `firstOf(array<float>)`', () => {
    const t = typer(fns)
    expect(t('firstOf(obs)')).toEqual(foo)
    expect(t('firstOf(af)')).toEqual(num)
    // and again, from the cache, in the other order
    expect(t('firstOf(obs)')).toEqual(foo)
    expect(t('firstOf(obs).x')).toEqual(num)
  })
  it('an untyped parameter takes its argument\'s type; a typed one its written type', () => {
    const t = typer(fns)
    expect(t('typed(obs)')).toEqual(num)
    expect(t('pick(1, "s")')).toEqual(text)
    expect(t('pick(1, b = obs)')).toEqual({ kind: 'array', elem: foo })
    expect(t('pick(b = "s", a = obs)')).toEqual(text)
    expect(t('body(obs)')).toEqual(num)
  })
  it('⛔ null on an untyped receiver, on recursion, and on a loop\'s value', () => {
    const t = typer(fns)
    expect(t('u.get(0)')).toBe(null)
    expect(t('firstOf(close)')).toBe(null)
    expect(t('firstOf(u)')).toBe(null)
    expect(t('nonrec(3)')).toEqual(foo)
    expect(t('rec(3)')).toBe(null)
    expect(t('loopy(obs)')).toBe(null)
    // review B1(b): `na` handed to an UNTYPED parameter gives it no type, so it cannot join the typed arm
    expect(t('naPass("b")')).toEqual(text)
    expect(t('naPass(na)')).toBe(null)
  })
})

describe('⭐ agreement with the readers the served paths ask today', () => {
  // T3a's binding reader (`initialiserTy`, which asks `udtTypeOf` for records) is
  // read off the slot it typed; `exprType` of the same initialiser must name the
  // same type wherever T3a names one.
  const shapes = ['Foo.new()', 'array.get(obs, 0)', 'obs.get(0)', 'obs.last()', 'f', 'f.b',
    'obs.get(0).b', 'close > open ? f : Foo.new()', 'obs', 'array.copy(obs)', 'array.new<Foo>()',
    'array.from("a", "b")', 'af']
  it.each(shapes)('%s', (e) => {
    const b = build(`${FOO}${HELD}\nprobeX = ${e}\nplot(close)\n`)
    expect(b.ok, b.ok ? '' : `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
    const slot = b.ir.slots.find((s) => s.name === 'probeX')
    const t3a = slot && slot.ty
    expect(t3a, `T3a typed ${e}`).toBeTruthy()
    const got = b.exprTypeOf(e)
    expect(got && got.kind).toBe(t3a.kind)
    if (t3a.name) expect(got.name).toBe(t3a.name)
    if (t3a.elem) expect(got.elem).toEqual(t3a.elem)
  })
})

describe('the probe is test-only', () => {
  it('a build without the option carries no `exprTypeOf`', () => {
    const b = buildRuntimeIr(`${head}plot(close)\n`, { bars: BARS, inputs: {} })
    expect(b.ok).toBe(true)
    expect('exprTypeOf' in b).toBe(false)
  })
})
