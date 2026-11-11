// app/src/components/chart/engine/runtime/__tests__/w6TypeDescriptor.test.js
//
// ─── ⭐⭐ W6-T3a — ONE STATIC TYPE PER SLOT (`ast/typeDescriptor.js`) ─────────
//
// The front end's per-slot type flags (`collection`, `elemText`, `elemColour`,
// `elemUdt`, `udt`, `colour`, `text`, the drawing family) are ONE descriptor,
// `slots[s].ty`, read from the written type first and the initialiser else.
// This rail pins the descriptor for each declaration form (it rides the IR's
// slot table, so it is read off a real build), the method form's family
// callback, the C18 door's reading of a declared-only collection, and the pure
// module's rules. The colour / text / drawing / array / record rails already on
// master (`colours.test.js`, `w4PaintTyping.test.js`, `methodsAndArrayMembers`,
// `udtRecords`, `objectLane`, …) are the behaviour rails and stay unchanged.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import {
  makeTy, tyOfTypeWord, bindingTy, isCollectionTy, elemKindOf, udtNameOf, elemUdtOf, drawingOf,
  methodNsOf, TY_KINDS,
} from '../../ast/typeDescriptor.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 6
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i * 2, l: 98 - i, c: 100 + i * 3, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t", overlay = true)\n'

const build = (src, opts = {}) => buildRuntimeIr(head + src, { bars: BARS, inputs: {}, ...opts })
/** The descriptor of the slot named `name` (the first one), or `undefined`. */
const tyOf = (built, name) => {
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const s = built.ir.slots.find((sl) => sl.name === name)
  expect(s, `no slot ${name}`).toBeTruthy()
  return s.ty
}
const run = (built) => {
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o))
}
const FOO = 'type Foo\n    float x = 0\n'

describe('⭐⭐ the descriptor for each declaration form', () => {
  it('a written collection type wins over an `na` initialiser, and keeps its element type', () => {
    expect(tyOf(build('var array<float> a = na\nplot(close)\n'), 'a'))
      .toEqual({ kind: 'array', elem: { kind: 'num' }, declaredOnly: true })
    expect(tyOf(build('var array<string> a = na\nplot(close)\n'), 'a'))
      .toEqual({ kind: 'array', elem: { kind: 'text' }, declaredOnly: true })
    expect(tyOf(build(`${FOO}var array<Foo> a = na\nplot(close)\n`), 'a'))
      .toEqual({ kind: 'array', elem: { kind: 'udt', name: 'Foo' }, declaredOnly: true })
  })

  it('an initialiser collection: the element type its own readers answer', () => {
    expect(tyOf(build('var a = array.new_float(0)\na.push(close)\nplot(a.size())\n'), 'a')).toEqual({ kind: 'array' })
    expect(tyOf(build('var syms = array.from("AAPL", "MSFT")\nplot(syms.size())\n'), 'syms'))
      .toEqual({ kind: 'array', elem: { kind: 'text' } })
    expect(tyOf(build(`${FOO}var obs = array.new<Foo>()\nobs.push(Foo.new(close))\nplot(obs.get(0).x)\n`), 'obs'))
      .toEqual({ kind: 'array', elem: { kind: 'udt', name: 'Foo' } })
    // the written type and the initialiser agree: not declared-only
    expect(tyOf(build('array<string> parts = str.split("NASDAQ:AAPL", ":")\nplot(parts.size())\n'), 'parts'))
      .toEqual({ kind: 'array', elem: { kind: 'text' } })
  })

  it('a matrix and a map are their own kinds, with element and key types', () => {
    const m = build('var matrix<float> m = na\nplot(close)\n')
    expect(tyOf(m, 'm')).toEqual({ kind: 'matrix', elem: { kind: 'num' }, declaredOnly: true })
    const mp = build('var map<string, float> mp = na\nplot(close)\n')
    expect(tyOf(mp, 'mp')).toEqual({ kind: 'map', key: { kind: 'text' }, elem: { kind: 'num' }, declaredOnly: true })
  })

  it('a record, written or built', () => {
    expect(tyOf(build(`${FOO}var Foo f = na\nf := Foo.new(close)\nplot(f.x)\n`), 'f')).toEqual({ kind: 'udt', name: 'Foo' })
    expect(tyOf(build(`${FOO}var f = Foo.new(close)\nplot(f.x)\n`), 'f')).toEqual({ kind: 'udt', name: 'Foo' })
  })

  it('a colour, a text and a written number', () => {
    expect(tyOf(build('var c = color.red\nc := close > open ? color.green : color.red\nbgcolor(c)\nplot(close)\n'), 'c'))
      .toEqual({ kind: 'colour' })
    expect(tyOf(build('var s = "ab"\ns := s + "c"\nplot(str.length(s))\n'), 's')).toEqual({ kind: 'text' })
    expect(tyOf(build('var float x = na\nx := close\nplot(x)\n'), 'x')).toEqual({ kind: 'num' })
    expect(tyOf(build('var bool b = na\nb := close > open\nplot(b ? 1 : 0)\n'), 'b')).toEqual({ kind: 'bool' })
  })

  it('⛔ a written `string` / `color` does not type an `na` slot (master read those off the initialiser)', () => {
    expect(tyOf(build('var string s = na\nplot(close)\n'), 's')).toBeUndefined()
    expect(tyOf(build('var color c = na\nplot(close)\n'), 'c')).toBeUndefined()
  })

  it('a drawing handle is a type only when the run draws', () => {
    const src = 'var line l = na\nl := line.new(bar_index, close, bar_index + 1, close)\nplot(close)\n'
    expect(tyOf(build(src, { objectsInRun: true }), 'l')).toEqual({ kind: 'drawing', name: 'line' })
    expect(tyOf(build('var line l = na\nplot(close)\n'), 'l')).toBeUndefined()
  })

  it('a parameter: only its written REFERENCE type (a collection, a record)', () => {
    expect(tyOf(build('f(array<string> xs) => xs.size()\nplot(f(array.from("a")))\n'), 'xs'))
      .toEqual({ kind: 'array', elem: { kind: 'text' } })
    expect(tyOf(build(`${FOO}g(Foo p) => p.x\nplot(g(Foo.new(close)))\n`), 'p')).toEqual({ kind: 'udt', name: 'Foo' })
    expect(tyOf(build('h(string s) => str.length(s)\nplot(h("ab"))\n'), 's')).toBeUndefined()
  })
})

describe('⭐ the method form reads the receiver\'s own family (`methodNsOf`)', () => {
  it('an array receiver is served exactly as before', () => {
    expect(run(build('var a = array.new_float(0)\na.push(close)\nplot(a.size())\n'))[0]).toEqual([1, 2, 3, 4, 5, 6])
  })
  it('a matrix receiver refuses naming `matrix.*`, a map receiver `map.*` — never an `array.*` member', () => {
    // ⭐ W6-T7 serves `matrix.rows`, so the method form is ADMITTED under its own family
    // (an `na` matrix then stops at run, `w6Matrix.test.js`); `matrix.det` is not held.
    expect(build('var matrix<float> m = na\nplot(m.rows())\n').ok).toBe(true)
    const m = build('var matrix<float> m = na\nplot(m.det())\n')
    expect(m.ok).toBe(false)
    expect(m.refusal.guard).toBe('runtime:array')
    expect(m.refusal.message).toContain('`matrix.det`')
    // ⛔ a map's `get` is NOT `array.get`: answered as an array it would be ADMITTED
    // ⭐ W6-T8 serves `map.*`: each is ADMITTED under the MAP family, and the `na` map then
    // stops naming the map member (`array.get` would say "the array is `na`")
    const mp = build('var map<string, float> mp = na\nplot(mp.get("a"))\n')
    expect(mp.ok).toBe(true)
    expect(() => run(mp)).toThrow(/`map\.get`: the map is `na`/)
    const st = build('var map<string, float> mp = na\nmp.put("a", close)\nplot(close)\n')
    expect(st.ok).toBe(true)
    expect(() => run(st)).toThrow(/`map\.put`: the map is `na`/)
    const pm = build('f(map<string, float> m) => m.size()\nplot(f(na))\n')
    expect(pm.ok).toBe(true)
    expect(() => run(pm)).toThrow(/`map\.size`: the map is `na`/)
  })
  it('an alias of a matrix is a matrix', () => {
    const b = build('var matrix<float> m = na\nm2 = m\nplot(m2.det())\n')
    expect(b.ok).toBe(false)
    expect(b.refusal.message).toContain('`matrix.det`')
  })
})

describe('⛔ C18 — the object door reads a declared-only collection as master did', () => {
  const PUSH = 'var array<float> a = na\na := array.new_float()\na.push(close)\nplot(a.size())\n'
  it('off the door the written type is the type: the method form is served', () => {
    expect(run(build(PUSH))[0]).toEqual([1, 1, 1, 1, 1, 1])
  })
  it('⛔ (review N1) a declared-only array used while still `na` stops BY NAME, never a VM kind mismatch', () => {
    for (const use of ['plot(a.size())\n', 'a.push(close)\nplot(close)\n', 'plot(array.get(a, 0))\n']) {
      const b = build(`var array<float> a = na\n${use}`)
      expect(b.ok, b.ok ? '' : b.refusal.message).toBe(true)
      let err = null
      try { run(b) } catch (e) { err = e }
      expect(err, use).toBeTruthy()
      expect(err.name, use).toBe('CollectionError')
      expect(err.message, use).toContain('the array is `na`')
    }
    // ⛔ only `na` is this stop: a NUMBER reaching an array operand (an untyped parameter handed
    // `close`, the C18 rule) keeps the VM's own kind check
    let numErr = null
    try { run(build('f(arr) => arr.size()\nplot(f(close))\n')) } catch (e) { numErr = e }
    expect(numErr).toBeTruthy()
    expect(numErr.name).not.toBe('CollectionError')
    expect(numErr.message).toContain('takes an array, got number')
    // the control: once an array is assigned, the same calls run
    expect(run(build('var array<float> a = na\na := array.new_float()\na.push(close)\nplot(a.size())\n'))[0])
      .toEqual([1, 1, 1, 1, 1, 1])
  })
  it('at the door it is not a collection (master refused this method form)', () => {
    const b = build(PUSH, { objectDoor: true })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:expression-statement')
  })
  it('at the door the annotation still types the ELEMENT as a record (master read it off the annotation)', () => {
    const src = `${FOO}var array<Foo> obs = na\nobs := array.new<Foo>()\narray.push(obs, Foo.new(close))\n`
      + 'ob = array.get(obs, array.size(obs) - 1)\nplot(ob.x)\n'
    const at = build(src, { objectDoor: true })
    expect(at.ok, at.ok ? '' : at.refusal.message).toBe(true)
    expect(run(at)[0]).toEqual(BARS.map((b) => b.c))
  })
})


describe('⭐ the getters drive what a slot\'s READERS lower (behaviour, not only the descriptor)', () => {
  it('a text slot on both sides of `+` is a concatenation', () => {
    expect(run(build('var s = "ab"\nvar t = "cde"\nu = s + t\nplot(str.length(u))\n'))[0]).toEqual([5, 5, 5, 5, 5, 5])
  })
  it('⛔ a text slot handed to `plot` refuses by name (the reader is the text getter)', () => {
    const b = build('var s = "ab"\ns := s + "c"\nplot(s)\n')
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:statement')
    expect(b.refusal.message).toContain('a plot draws numbers')
  })
  it('a hoisted switch subject keeps its text type, so its text cases match', () => {
    const src = 'v = switch str.lower(input.string("AB"))\n    "ab" => 1\n    => 0\nplot(v)\n'
    expect(run(build(src))[0]).toEqual([1, 1, 1, 1, 1, 1])
  })
  it('a function whose last line binds a colour slot returns a colour (`bgcolor(f(x))` builds)', () => {
    const b = build('f(x) =>\n    c = x > open ? color.green : color.red\nbgcolor(f(close))\nplot(close)\n')
    expect(b.ok, b.ok ? '' : `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
  })
})

describe('the pure module', () => {
  it('reads written types', () => {
    const udtTypes = new Set(['Foo'])
    expect(tyOfTypeWord('int')).toEqual({ kind: 'num' })
    expect(tyOfTypeWord('color')).toEqual({ kind: 'colour' })
    expect(tyOfTypeWord('array', ['Foo'], { udtTypes })).toEqual({ kind: 'array', elem: { kind: 'udt', name: 'Foo' } })
    expect(tyOfTypeWord('array', null)).toBe(null)
    expect(tyOfTypeWord('array', ['array<float>'])).toEqual({ kind: 'array' })
    expect(tyOfTypeWord('map', ['string', 'float'])).toEqual({ kind: 'map', key: { kind: 'text' }, elem: { kind: 'num' } })
    expect(tyOfTypeWord('map', ['string'])).toBe(null)
    expect(tyOfTypeWord('E', null, { enums: new Set(['E']) })).toEqual({ kind: 'enum', name: 'E' })
    expect(tyOfTypeWord('box')).toEqual({ kind: 'drawing', name: 'box' })
    expect(tyOfTypeWord('polyline')).toBe(null)
    expect(tyOfTypeWord('series')).toBe(null)
  })
  it('the binding rule: written reference type first, element from a same-kind initialiser', () => {
    const arr = makeTy('array')
    const initText = makeTy('array', { elem: makeTy('text') })
    expect(bindingTy(arr, initText)).toEqual({ kind: 'array', elem: { kind: 'text' } })
    expect(bindingTy(makeTy('udt', { name: 'A' }), makeTy('udt', { name: 'B' }))).toEqual({ kind: 'udt', name: 'A' })
    expect(bindingTy(makeTy('text'), null)).toBe(null)
    expect(bindingTy(makeTy('num'), makeTy('colour'))).toEqual({ kind: 'colour' })
    expect(bindingTy(null, null)).toBe(null)
  })
  it('the getters', () => {
    const a = makeTy('array', { elem: makeTy('udt', { name: 'Foo' }) })
    expect(isCollectionTy(a)).toBe(true)
    expect(elemKindOf(a)).toBe('udt')
    expect(elemUdtOf(a)).toBe('Foo')
    expect(udtNameOf(a)).toBe(null)
    expect(drawingOf(makeTy('drawing', { name: 'line' }))).toBe('line')
    expect(methodNsOf(makeTy('map'))).toBe('map')
    expect(methodNsOf(makeTy('udt', { name: 'Foo' }))).toBe(null)
  })
  it('⛔ an unknown kind is a front-end bug and throws', () => {
    expect(() => makeTy('vector')).toThrow(/unknown kind/)
    expect(TY_KINDS).toContain('enum')
  })
})
