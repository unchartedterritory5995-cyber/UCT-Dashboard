// app/src/components/chart/engine/runtime/__tests__/w6ReceiverTypes.test.js
//
// ─── ⭐⭐ W6-T9 — RECEIVER TYPES: OVERLOADED METHODS, CHAINS, MEMBERS ON ANY TYPED RECEIVER ──
//
// The Pine manual, read 2026-11-06. *Methods*
// (https://www.tradingview.com/pine-script-docs/language/methods/):
//   · "User-defined methods can override and overload existing built-in and user-defined
//     methods with the same identifier." (with "different parameter signatures")
//   · "The type of the first parameter in the signature must be explicitly declared."
//   · "The underlying type of each variable determines which overload of `getType()` the
//     compiler will use." (its example overloads `int` AND `float`)
//   · "The compiler will only use this `fill()` overload instead of the built-in when the
//     user provides …"
// *Objects* (https://www.tradingview.com/pine-script-docs/language/objects/):
//   · "the built-in `copy()` method produces a _shallow copy_ of an object", and fields that
//     reference UDT or special-type objects "in a shallow copy of the object will point to the
//     same instances as the original".
// So the receiver's type picks the declaration, and a member read off an expression's result
// belongs to that result's type. The type is T3b's `exprType`, the one owner. This lane has
// ONE number type, so it cannot tell an `int` receiver from a `float` one: an overload whose
// receiver holds numbers refuses by name (W6-U1). Every shape below is SYNTHETIC.
//
// Served: overloads by receiver type (dotted and function form); a method or field on an
// element, a copy, a function's result, a field path; a collection member on a field or
// on a name bound to a typed expression; the typed shadowing rule (a script's method wins
// only for its own receiver type); a record's shallow `copy`.
// Refused by name: an overload the receiver's type cannot settle; two overloads this lane
// cannot tell apart; an unreadable receiver type; a script's method beside a built-in member
// of the same name that could take the same call (W6-U1); a copy of a value read more than
// once. The object door keeps master's answers (`objectDoorGate.test.js`).
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { translatePine } from '../../ast/pine.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 6
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + i * 2
  return { t: 1700000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + i }
})
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const H = '//@version=6\nindicator("t")\n'

const build = (body, extra = {}) => buildRuntimeIr(H + body,
  { bars: BARS, inputs: {}, pane: true, tf: 'D', basePeriod: 'D', ...extra })
/** Every output, every bar (`null` for na). A refusal or a runtime stop throws, by name. */
function run(body, extra = {}) {
  const built = build(body, extra)
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t) })
  return r.outputs.map((o) => Array.from(o, (x) => (Number.isNaN(x) ? null : x)))
}
const refusal = (body, extra = {}) => {
  const b = build(body, extra)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}
const close = BARS.map((b) => b.c)

const TWO_CLR = 'method clr(array<string> id, int m = 0) =>\n    id.size() > m ? id.size() : 0\n'
  + 'method clr(array<bool> id, int m = 0) =>\n    id.size() > m ? -id.size() : 0\n'
const DOT_CND = 'type Dot\n    float v = 1\ntype Cnd\n    float w = 2\n'
  + 'method mk(Dot this) =>\n    this.v * 10\nmethod mk(Cnd this) =>\n    this.w * 100\n'

describe('⭐ 1. overloads: the receiver\'s type picks the declaration', () => {
  it('two `clr` over `array<string>` and `array<bool>` each run on their own receiver', () => {
    const v = run(`${TWO_CLR}var array<string> s = array.new<string>()\nvar array<bool> f = array.new<bool>()\n`
      + 's.push("a")\nf.push(true)\nf.push(false)\nplot(s.clr())\nplot(f.clr())\n')
    expect(v[0]).toEqual([1, 2, 3, 4, 5, 6])
    expect(v[1]).toEqual([-2, -4, -6, -8, -10, -12])
  })
  it('the receiver may be a FIELD, with the method\'s other arguments (a built-in `clear` cannot take two)', () => {
    const src = 'type Sess\n    array<bool> pr\n    array<string> nm\n'
      + 'method clear(array<string> id, int _min = 0) =>\n    if id.size() > _min\n        id.shift()\n    id.size()\n'
      + 'method clear(array<bool> id, int _min = 0) =>\n    if id.size() > _min\n        id.shift()\n    id.size() * 10\n'
      + 'var s = Sess.new(array.new<bool>(), array.new<string>())\ns.pr.push(close > 0)\ns.nm.push("x")\n'
      + 'plot(s.pr.clear(3))\nplot(s.nm.clear(2))\n'
    const v = run(src)
    expect(v[0]).toEqual([10, 20, 30, 30, 30, 30])
    expect(v[1]).toEqual([1, 2, 2, 2, 2, 2])
  })
  it('record receivers, in the dotted form and the function form', () => {
    expect(run(`${DOT_CND}d = Dot.new()\nc = Cnd.new()\nplot(d.mk() + c.mk())\n`)[0]).toEqual(Array(N).fill(210))
    expect(run(`${DOT_CND}plot(mk(Dot.new(close)) + mk(Cnd.new()))\n`)[0]).toEqual(close.map((c) => c * 10 + 200))
  })
  it('an overload called on a line of its own runs for its effect on its own receiver', () => {
    const src = 'type A\n    float n = 0\ntype B\n    float n = 0\n'
      + 'method bump(A a) =>\n    a.n += 1\n    a.n\nmethod bump(B b) =>\n    b.n += 10\n    b.n\n'
      + 'var a = A.new()\nvar b = B.new()\na.bump()\nb.bump()\nplot(a.n + b.n)\n'
    expect(run(src)[0]).toEqual([11, 22, 33, 44, 55, 66])
  })
  it('the name form of a built-in (`array.clear(f)`) is the built-in, whatever methods are declared', () => {
    const src = 'method clear(array<string> id, int m) =>\n    0\nmethod clear(array<float> id, int m) =>\n    1\n'
      + 'var array<float> f = array.new<float>()\nf.push(1)\narray.clear(f)\nplot(f.size())\n'
    expect(run(src)[0]).toEqual(Array(N).fill(0))
    // and in value position, where the dotted head would otherwise be read as a receiver
    const val = 'method size(array<string> id, int m) =>\n    0\nmethod size(array<float> id, int m) =>\n    1\n'
      + 'var array<float> f = array.new<float>()\nf.push(1)\nplot(array.size(f))\n'
    expect(run(val)[0]).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('⭐ 2. chains: each step\'s receiver is the previous step\'s type', () => {
  const ZS = 'type Z\n    float s = 0\nvar zs = array.new<Z>()\nzs.push(Z.new(close))\n'
  it('a field read off an element, through a copy of the array, the name form and the method form', () => {
    expect(run(`${ZS}cp = zs.copy()\nplot(cp.get(0).strength)\n`.replace('strength', 's'))[0]).toEqual(Array(N).fill(100))
    expect(run(`${ZS}plot(array.get(zs, 0).s + zs.last().s)\n`)[0]).toEqual(close.map((c) => 100 + c))
  })
  it('a script\'s method on an element', () => {
    const src = 'type G\n    float x = 0\nmethod dbl(G this) =>\n    this.x * 2\n'
      + 'var gs = array.new<G>()\ngs.push(G.new(close))\nplot(gs.get(0).dbl() + gs.last().dbl())\n'
    expect(run(src)[0]).toEqual(close.map((c) => 200 + 2 * c))
  })
  it('methods chained off a function\'s result', () => {
    const src = 'type B\n    float o = 0\nmethod mc(B r) =>\n    B.new(r.o * 2)\nmethod ha(B b) =>\n    b.o + 1\n'
      + 'f_rt(float a) =>\n    B.new(a)\nplot(f_rt(close).mc().ha())\n'
    expect(run(src)[0]).toEqual(close.map((c) => 2 * c + 1))
  })
  it('a field of a function\'s result bounds a loop (the binding holds the result\'s type)', () => {
    const src = 'type Hb\n    int leftIndex = 0\n    int rightIndex = 0\nmk(int a) =>\n    Hb.new(a, a + 2)\n'
      + 'hb = mk(bar_index)\ns = 0.0\nfor i = hb.leftIndex to hb.rightIndex\n    s += i\nplot(s)\n'
    expect(run(src)[0]).toEqual([3, 6, 9, 12, 15, 18])
  })
  it('an overload chained through a field and off an element', () => {
    const src = 'type Dev\n    float a = 1\ntype TW\n    Dev up\n    float b = 2\n'
      + 'method delete(Dev d) =>\n    d.a * 10\nmethod delete(TW t) =>\n    t.up.delete() + t.b\n'
      + 'var tws = array.new<TW>()\ntws.push(TW.new(Dev.new(close), 3))\nplot(tws.last().delete() + tws.get(0).up.delete())\n'
    expect(run(src)[0]).toEqual(close.map((c) => 10 * c + 3 + 1000))
  })
  it('a script\'s method on an element, as a statement (`allGaps.shift().delete()`)', () => {
    const src = 'type Gap\n    float x = 0\nmethod delete(Gap this) =>\n    this.x := 0\n    this.x\n'
      + 'var allGaps = array.new<Gap>()\nallGaps.push(Gap.new(close))\nif allGaps.size() > 2\n    allGaps.shift().delete()\n'
      + 'plot(allGaps.size())\n'
    expect(run(src)[0]).toEqual([1, 2, 2, 2, 2, 2])
  })
  it('a drawing member read off an element, when the run draws', () => {
    const src = 'var bx = array.new_box()\nbx.unshift(box.new(bar_index, high, bar_index, low))\nplot(bx.get(0).get_bottom())\n'
    expect(run(src, { objectsInRun: true })[0]).toEqual(BARS.map((b) => b.l))
  })
  it('⛔ a field read off an `na` element stops by name (Pine raises a runtime error)', () => {
    const src = `type Z\n    float s = 0\nvar zs = array.new<Z>()\nzs.push(bar_index < 2 ? Z.new(close) : na)\nplot(zs.last().s)\n`
    expect(() => run(src)).toThrow(/is `na`/)
  })
})

describe('⭐ 3. built-in members on a collection held anywhere typed', () => {
  it('a UDT field\'s array: a member as a value and as a statement, and a name bound to its copy', () => {
    const src = 'type T\n    array<float> change\nvar bull = T.new(array.new<float>())\nbull.change.unshift(close)\n'
      + 'rec = bull.change.copy()\nplot(rec.avg())\nplot(bull.change.size())\n'
    const v = run(src)
    expect(v[0]).toEqual([100, 101, 102, 103, 104, 105])
    expect(v[1]).toEqual([1, 2, 3, 4, 5, 6])
  })
  it('the typed shadowing rule: a script\'s `clear(Foo)` does not replace `array.clear` on an array', () => {
    const src = 'type Foo\n    float x = 0\nmethod clear(Foo f) =>\n    f.x := 0\n    f.x\n'
      + 'var a = array.new_float()\na.push(close)\nif a.size() > 2\n    a.clear()\nplot(a.size())\n'
    expect(run(src)[0]).toEqual([1, 2, 0, 1, 2, 0])
  })
  it('⛔ CONTROL — one declaration on an array of an untold element still binds as master bound it', () => {
    const src = 'method tot(array<float> a) =>\n    a.sum()\nvar a = array.new<float>()\na.push(close)\nplot(a.tot())\n'
    expect(run(src)[0]).toEqual([100, 202, 306, 412, 520, 630])
  })
})

describe('⭐ 3b. the shadowing rule within one kind (review N2)', () => {
  it('a script\'s method on `Foo` does not run for a `Bar` receiver (two record types, one kind)', () => {
    const b = build('type Foo\n    float x = 1\ntype Bar\n    float y = 2\nmethod mm(Foo f) =>\n    f.x\nv = Bar.new()\nplot(v.mm())\n')
    expect(b.ok).toBe(false)
  })
})

describe('⭐ 4. a record\'s own `copy` (shallow)', () => {
  it('`f.copy()` and `Foo.copy(f)` are new records; a collection field is SHARED', () => {
    const src = 'type Z\n    float s = 0\n    array<float> xs\nvar z = Z.new(1, array.new<float>())\n'
      + 'c = z.copy()\nd = Z.copy(z)\nc.s := 5\nc.xs.push(close)\nplot(z.s + c.s + d.s)\nplot(z.xs.size())\n'
    const v = run(src)
    expect(v[0]).toEqual(Array(N).fill(7))
    expect(v[1]).toEqual([1, 2, 3, 4, 5, 6])
  })
  it('⛔ a copy of a value read off a call refuses by name (it would be computed once per field)', () => {
    const r = refusal('type Z\n    float s = 0\nvar zs = array.new<Z>()\nzs.push(Z.new(close))\nplot(zs.last().copy().s)\n')
    expect(r.guard).toBe('runtime:udt')
    expect(r.message).toMatch(/once per field/)
  })
})

describe('⛔ 5. what still refuses, by name', () => {
  it('an overloaded name on a receiver whose type does not settle the choice', () => {
    const r = refusal(`${TWO_CLR}var f = array.new<float>()\nplot(f.clr())\n`)
    expect(r.guard).toBe('runtime:udt-method')
    expect(r.message).toMatch(/does not settle/)
  })
  it('an overloaded name on a receiver this lane cannot type at all', () => {
    const r = refusal(`${DOT_CND}g(x) => x.mk()\nplot(g(Dot.new()))\n`)
    expect(r.guard).toBe('runtime:udt-method')
    expect(r.message).toMatch(/cannot tell here/)
  })
  it('two overloads this lane cannot tell apart (`int` and `float` are one number type)', () => {
    const r = refusal('method m(int x) =>\n    1\nmethod m(float x) =>\n    2\nplot(close.m())\n')
    expect(r.guard).toBe('runtime:udt-method')
    expect(r.message).toMatch(/cannot tell apart/)
  })
  it('an overload whose receiver type this lane does not read (a library type is W8)', () => {
    const r = refusal('method m(lib.Thing x) =>\n    1\nmethod m(float x) =>\n    2\nplot(close.m())\n')
    expect(r.guard).toBe('runtime:udt-method')
    expect(r.message).toMatch(/does not read/)
  })
  it('a method and a plain function of the same name', () => {
    const r = refusal('type A\n    float a = 1\nmethod m(A x) =>\n    1\nm(float y) =>\n    2\nplot(A.new().m())\n')
    expect(r.guard).toBe('runtime:udt-method')
  })
  it('W6-U1 — a script\'s overload beside a built-in member that takes the same call', () => {
    const r = refusal('method clear(array<string> id) =>\n    0\nmethod clear(array<bool> id) =>\n    1\n'
      + 'var array<bool> f = array.new<bool>()\nf.push(true)\nf.clear()\nplot(f.size())\n')
    expect(r.guard).toBe('runtime:udt-method')
    expect(r.message).toMatch(/built-in member of a `array<bool>` that takes this call.*W6-U1/)
  })
  it('N2 — an overload whose receiver holds numbers: an `array<int>` never runs the `array<float>` one', () => {
    const OV = 'method clr(array<string> id) =>\n    1\nmethod clr(array<float> id) =>\n    2\n'
    for (const decl of ['var array<int> a = array.new<int>()', 'var array<float> a = array.new<float>()']) {
      const r = refusal(`${OV}${decl}\nplot(a.clr())\n`)
      expect(r.guard, decl).toBe('runtime:udt-method')
      expect(r.message, decl).toMatch(/one number type \(W6-U1\)/)
    }
    const r = refusal('method m(float x) =>\n    1\nmethod m(string x) =>\n    2\nx = 1.5\nplot(x.m())\n')
    expect(r.message).toMatch(/one number type \(W6-U1\)/)
  })
  it('two declarations on the SAME receiver type say so (Pine then reads the other arguments)', () => {
    const r = refusal('type P\n    float x = 0\nmethod b(P p, float d) =>\n    p.x\nmethod b(P p, string d) =>\n    p.x\nplot(P.new().b(1))\n')
    expect(r.guard).toBe('runtime:udt-method')
    expect(r.message).toMatch(/same receiver type/)
  })
  it('a member off an expression whose type is not known keeps the shared resolver\'s refusal', () => {
    const r = refusal('type Z\n    float s = 0\ng(a) => a.get(0).s\nvar zs = array.new<Z>()\nzs.push(Z.new(close))\nplot(g(zs))\n')
    expect(r.guard).toBe('pine:member')
  })
})

describe('⛔⛔ 5b. (r2) a collection member off a CALL\'s result keeps the shared refusal, as the host does', () => {
  // `postfixMember.test.js` C rails one shape (`array.new_float(1, 5.0).size()`); these hold the
  // agreement per receiver kind: a built-in call, a member call, a user function's result. The
  // spec serves a collection member on a FIELD or a typed name only (W6-BREAKDOWN section 4 T9 item 3).
  const SH = [
    ['a built-in constructor\'s result', 'plot(close + array.new_float(1, 5.0).size())\n', 3],
    ['a member call\'s result', 'var a = array.new_float(2, 1.0)\nplot(a.copy().size())\n', 4],
    ['a slice\'s result', 'var a = array.new_float(3, 1.0)\nplot(a.slice(0, 2).size())\n', 4],
    ['a user function\'s result', 'f() =>\n    array.new_float(2, 1.0)\nplot(f().size())\n', 5],
    // the receiver is itself a postfix METHOD node (a served user method off an element), not a
    // call: the guard's other arm. `array.new_float(1).copy().size()` cannot hold it, because its
    // inner `.copy()` already refuses.
    ['a user method\'s result off an element',
      'type O\n    array<float> xs\nmethod mk(O this) =>\n    this.xs\nvar os = array.new<O>()\n'
        + 'os.push(O.new(array.new_float(2, 1.0)))\nplot(os.get(0).mk().size())\n', 9],
  ]
  for (const [what, body, line] of SH) {
    it(`${what} refuses \`pine:member\` at line ${line}, in both lanes`, () => {
      const host = translatePine(`${H}${body}`, { strict: true })
      expect(host.ok).toBe(false)
      expect(host.refusal.guard).toBe('pine:member')
      expect(host.refusal.line).toBe(line)
      const r = refusal(body)
      expect(r.guard).toBe('pine:member')
      expect(r.line).toBe(line)
    })
  }
  it('⛔ CONTROL — the same member on a FIELD is still served', () => {
    const b = build('type O\n    array<float> xs\nvar o = O.new(array.new_float(2, 1.0))\nplot(o.xs.size())\n')
    expect(b.ok).toBe(true)
  })
  it('⛔ CONTROL — a FIELD read off an element (a `member` receiver) is still served, with its value', () => {
    // T9 item 3 progress kept: the receiver of `.size()` is the field `xs`, not the call `get(0)`.
    const body = 'type O\n    array<float> xs\nvar os = array.new<O>()\n'
      + 'os.push(O.new(array.new_float(2, 1.0)))\nplot(os.get(0).xs.size())\n'
    expect(build(body).ok).toBe(true)
    expect(run(body)[0]).toEqual(BARS.map(() => 2))
  })
})

describe('⭐⭐ 6. the object door keeps master\'s answers', () => {
  it('an overload still refuses `runtime:udt-method` with master\'s sentence at the door', () => {
    const r = refusal(`${DOT_CND}d = Dot.new()\nplot(d.mk())\n`, { objectDoor: true })
    expect(r.guard).toBe('runtime:udt-method')
    expect(r.message).toMatch(/which this lane does not resolve/)
  })
  it('a chain still refuses `pine:member` at the door', () => {
    const r = refusal('type Z\n    float s = 0\nvar zs = array.new<Z>()\nzs.push(Z.new(close))\ncp = zs.copy()\nplot(cp.get(0).s)\n',
      { objectDoor: true })
    expect(r.guard).toBe('pine:member')
  })
})
