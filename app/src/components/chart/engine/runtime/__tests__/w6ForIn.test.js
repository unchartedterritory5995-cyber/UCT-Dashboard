// app/src/components/chart/engine/runtime/__tests__/w6ForIn.test.js
//
// ─── ⭐⭐ W6-T6 — `for … in` ON THE RUNTIME LANE: what is served, what is refused BY NAME ───
//
// The capture-backed half (the probe `vw-forin-collections`, every row and object) is
// `__tests__/vendorHarness/vendorHarness.w6ForInRuntime.test.js`. This file holds the
// lowering's own rules, each with a control that comes out the OTHER way:
//   · SERVED — `for x in` / `for [i, x] in` over a user array (numbers, text, records, drawings),
//     `<family>.all`; an empty list runs no pass; `break` / `continue`; the element read off a
//     record list types `x.f`; push / shift / set in the body walk the LIVE list.
//   · REFUSED BY NAME (`runtime:loop`) — any other change of the walked list (G-rows, ungraded),
//     a change that MAY reach it through another name, a write to or through the loop variable,
//     a function body, a loop whose value is read, `polyline.all`, a matrix, a map, a value
//     that is not an array.
//   · THE ONE TABLE — the host lane and this lane read `forInRule.js`; its sentence is the
//     host's sentence.
//   · THE DOORS — the C18 object door refuses BY NAME (`runtime:object-door`); the host
//     object pass's own lane (`objectLane.js`) keeps master's refusal.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { FOR_IN_LIVE_WITNESSED, FOR_IN_SNAPSHOT_SOURCES, forInMutationRefusal, forInHeldListRefusal } from '../../ast/forInRule.js'
import { translatePine } from '../../ast/pine.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 5 * Math.sin(i / 3) + i * 0.1
  return { t: 1700000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + i }
})
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const H = '//@version=6\nindicator("t", overlay = true)\n'

const build = (body, extra = {}) => buildRuntimeIr(H + body,
  { bars: BARS, inputs: {}, objectsInRun: true, pane: true, tf: 'D', basePeriod: 'D', ...extra })
/** The last bar's value of every output. */
function lastValues(body) {
  const built = build(body)
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t) })
  return r.outputs.map((o) => o[N - 1])
}
const refusal = (body, extra) => {
  const b = build(body, extra)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

describe('⭐ SERVED — the walk', () => {
  it('passes in index order over a number list; `[i, x]` hands the position', () => {
    expect(lastValues('a = array.from(3.0, 5.0, 7.0)\ns = 0.0\nw = 0.0\nfor [i, x] in a\n    s += x\n    w += i * x\nplot(s)\nplot(w)\n'))
      .toEqual([15, 0 * 3 + 1 * 5 + 2 * 7])
  })
  it('⛔ an empty list runs NO pass (never counts down, unlike `for i = 0 to size - 1`)', () => {
    expect(lastValues('a = array.new_float()\nn = 0\nfor x in a\n    n += 1\nm = 0\nfor i = 0 to array.size(a) - 1\n    m += 1\nplot(n)\nplot(m)\n'))
      .toEqual([0, 2])
  })
  it('`break` leaves the walk, `continue` goes to the next element', () => {
    expect(lastValues('a = array.from(1.0, 2.0, 3.0, 4.0)\ns = 0.0\nfor x in a\n    if x == 2\n        continue\n    if x == 4\n        break\n    s += x\nplot(s)\n'))
      .toEqual([4])
  })
  it('a text list: `x` is text', () => {
    expect(lastValues('a = array.from("ab", "cde")\nn = 0\nfor x in a\n    n += str.length(x)\nplot(n)\n')).toEqual([5])
  })
  it('a record list: `x.f` reads the element\'s field (the type comes from `exprType`)', () => {
    const src = 'type P\n    float v\nvar ps = array.new<P>()\nif barstate.isfirst\n    array.push(ps, P.new(2))\n    array.push(ps, P.new(5))\n'
      + 's = 0.0\nfor p in ps\n    s += p.v\nplot(s)\n'
    expect(lastValues(src)).toEqual([7])
  })
  it('⭐ LIVE: the body pushes (the length is re-read) and shifts (the slot is read when reached)', () => {
    // push: 3 elements, each pass below 5 pushes one more → 5 passes
    expect(lastValues('a = array.from(1.0, 1.0, 1.0)\nn = 0\nfor x in a\n    if array.size(a) < 5\n        array.push(a, 1.0)\n    n += 1\nplot(n)\n')).toEqual([5])
    // shift: five elements, every pass drops the oldest → 3 passes, reading 1, 3, 5
    expect(lastValues('a = array.from(1.0, 2.0, 3.0, 4.0, 5.0)\ns = 0.0\nfor x in a\n    array.shift(a)\n    s += x\nplot(s)\n')).toEqual([9])
    // set: a later slot replaced before it is reached
    expect(lastValues('a = array.from(1.0, 2.0, 3.0)\ns = 0.0\nfor [i, x] in a\n    if i == 0\n        array.set(a, 2, 30.0)\n    s += x\nplot(s)\n')).toEqual([33])
  })
  it('`<family>.all` is a SNAPSHOT: deleting every label in the walk makes one pass per label', () => {
    expect(lastValues('if barstate.islast\n    for k = 0 to 3\n        label.new(bar_index, close, "x")\nn = 0\nif barstate.islast\n    for l in label.all\n        label.delete(l)\n        n += 1\nplot(n)\nplot(array.size(label.all))\n'))
      .toEqual([4, 0])
  })
})

describe('⛔ REFUSED BY NAME — no capture settles these', () => {
  const WALK = (change) => `a = array.from(1.0, 2.0, 3.0)\ns = 0.0\nfor [i, x] in a\n    ${change}\n    s += x\nplot(s)\n`
  it('the G-rows (ungraded): remove / pop / unshift / insert / clear / reverse / sort / a reassignment / a helper', () => {
    const helper = 'drop(arr) =>\n    array.pop(arr)\n'
    for (const change of ['array.remove(a, 0)', 'array.pop(a)', 'array.unshift(a, 1.0)', 'array.insert(a, 0, 1.0)',
      'array.clear(a)', 'array.reverse(a)', 'array.sort(a)', 'a := array.from(9.0)', 'a.remove(0)', 'drop(a)']) {
      const r = refusal((change === 'drop(a)' ? helper : '') + WALK(change))
      expect(r.guard, change).toBe('runtime:loop')
      expect(r.message, change).toContain(forInMutationRefusal('a'))
    }
  })
  it('CONTROL — push / shift / set, the three a capture shows, are served', () => {
    for (const change of ['array.push(a, 1.0)', 'array.shift(a)', 'array.set(a, 0, 1.0)', 'a.push(1.0)']) {
      expect(build(WALK(`if array.size(a) < 6\n        ${change}`)).ok, change).toBe(true)
    }
  })
  it('a change that MAY reach the walked list through another name (an alias of the same type)', () => {
    const r = refusal(`b = array.from(1.0)\n${WALK('array.remove(b, 0)')}`)
    expect(r.message).toMatch(/changes `b`, which may be `a`/)
    // CONTROL — a list of ANOTHER type cannot be the walked one
    expect(build(`b = array.from("q", "r")\n${WALK('if array.size(b) > 0\n        array.remove(b, 0)')}`).ok).toBe(true)
  })
  it('a list the body binds to a NEW array (and never reassigns) cannot be the walked one; one bound to a name can', () => {
    const fresh = WALK('var float[] t = array.new_float(2)\n    if array.size(t) > 0\n        array.pop(t)')
    const b = build(fresh)
    expect(b.ok, b.refusal && b.refusal.message).toBe(true)
    // ⛔ CONTROLS — bound to the walked list, or reassigned in the body: refused by name
    expect(refusal(WALK('t = a\n    array.pop(t)')).message).toMatch(/changes `t`, which may be `a`/)
    // `array.slice` is a VIEW of the list (Pine reference), not a new array
    expect(refusal(WALK('t = array.slice(a, 0, 1)\n    array.pop(t)')).message).toMatch(/changes `t`, which may be `a`/)
    expect(refusal(WALK('var float[] t = array.new_float(2)\n    t := a\n    array.pop(t)')).message).toMatch(/changes `t`, which may be `a`/)
  })
  it('a write to the loop variable, or through it (W6-F1)', () => {
    expect(refusal(WALK('x := 4.0')).message).toMatch(/writes the loop variable `x`/)
    expect(refusal(WALK('i += 1')).message).toMatch(/writes the loop variable `i`/)
    const rec = 'type P\n    float v\nps = array.from(P.new(1))\nfor p in ps\n    p.v := 2\nplot(close)\n'
    expect(refusal(rec).message).toMatch(/writes the loop variable `p`/)
    const handed = 'type P\n    float v\nbump(q) =>\n    q.v := 3\nps = array.from(P.new(1))\nfor p in ps\n    bump(p)\nplot(close)\n'
    expect(refusal(handed).message).toMatch(/hands the element `p`/)
    // …through a function that calls one that writes, too
    const deep = 'type P\n    float v\nbump(q) =>\n    q.v := 3\nouter(q) =>\n    bump(q)\nps = array.from(P.new(1))\nfor p in ps\n    outer(p)\nplot(close)\n'
    expect(refusal(deep).message).toMatch(/hands the element `p`/)
    // ⛔ (review N1) a list the element HOLDS, changed in the body or by a helper (W6-F1)
    const H2 = 'type Q\n    array<float> arr\nvar qs = array.new<Q>()\nif barstate.isfirst\n    array.push(qs, Q.new(array.new_float()))\n'
    for (const change of ['array.push(q.arr, 1.0)', 'q.arr.push(1.0)', 'array.clear(q.arr)']) {
      expect(refusal(`${H2}for q in qs\n    ${change}\nplot(close)\n`).message, change)
        .toBe(`a loop in a form this lane does not iterate — \`for … in\`: ${forInHeldListRefusal('q')}`)
    }
    expect(refusal(`${H2}fill1(Q z) =>\n    array.push(z.arr, 1.0)\nfor q in qs\n    fill1(q)\nplot(close)\n`).message).toMatch(/hands the element `q`/)
    // CONTROL — READING a list the element holds is served
    expect(lastValues(`${H2}n = 0\nfor q in qs\n    n += array.size(q.arr)\nplot(n)\n`)).toEqual([0])
    // CONTROL — a function that only READS the element is served
    const reads = 'type P\n    float v\nvar ps = array.new<P>()\nif barstate.isfirst\n    array.push(ps, P.new(4))\ntwice(P q) =>\n    q.v * 2\ns = 0.0\nfor p in ps\n    s += twice(p)\nplot(s)\n'
    expect(lastValues(reads)).toEqual([8])
  })
  it('⛔ (review N1b) a held list reached INDIRECTLY: a function handed it, an alias (W6-F1, Q-W6T6-H)', () => {
    const H2 = 'type Q\n    array<float> arr\nvar qs = array.new<Q>()\nif barstate.isfirst\n    array.push(qs, Q.new(array.new_float()))\n'
    const FNS = 'bump(array<float> a) =>\n    array.push(a, 1.0)\n'
      + 'method bumpm(array<float> a) =>\n    a.push(1.0)\n'
      + 'viaLocal(array<float> a) =>\n    l = a\n    array.push(l, 1.0)\n'
      + 'outer(array<float> b) =>\n    bump(b)\n'
      + 'named(float v, array<float> into) =>\n    array.push(into, v)\n'
    const walk = (change, pre = '') => `${H2}${FNS}${pre}for q in qs\n    ${change}\nplot(close)\n`
    const msg = (via) => `a loop in a form this lane does not iterate — \`for … in\`: ${forInHeldListRefusal('q', via)}`
    // (a) a user function that changes its own parameter, handed a list the element holds
    for (const [change, fn] of [['bump(q.arr)', 'bump'], ['q.arr.bumpm()', 'bumpm'], ['bumpm(q.arr)', 'bumpm'],
      ['viaLocal(q.arr)', 'viaLocal'], ['outer(q.arr)', 'outer'], ['named(1.0, into = q.arr)', 'named'],
      ['bump(q.copy().arr)', 'bump']]) {
      expect(refusal(walk(change)).message, change).toBe(msg(`handed to \`${fn}\`, which changes it`))
    }
    // …and handed the ELEMENT, to a function that changes a list it holds through a local alias
    expect(refusal(`${H2}grab(Q z) =>\n    l = z.arr\n    array.push(l, 1.0)\nfor q in qs\n    grab(q)\nplot(close)\n`).message)
      .toBe(msg('handed to `grab`, which changes it'))
    // (b) an alias, through any chain of re-assignments, then a mutating member
    expect(refusal(walk('a = q.arr\n    array.push(a, 1.0)')).message).toBe(msg('through `a`, an alias of it'))
    expect(refusal(walk('a = q.arr\n    b = a\n    b.push(1.0)')).message).toBe(msg('through `b`, an alias of it'))
    expect(refusal(walk('r = q\n    array.set(r.arr, 0, 1.0)')).message).toBe(msg('through `r.arr`, an alias of it'))
    expect(refusal(walk('g := q.arr\n    array.push(g, 1.0)', 'var array<float> g = array.new_float()\n')).message)
      .toBe(msg('through `g`, an alias of it'))
    // …or an alias the body hands to a function that changes it
    expect(refusal(walk('a = q.arr\n    bump(a)')).message).toBe(msg('handed to `bump`, which changes it'))
    // ⛔ conservative: a list bound BEFORE the walk, of a type the element holds, may be the same array
    expect(refusal(walk('array.push(pre, 1.0)', 'var array<float> pre = array.new_float()\n')).message)
      .toBe(msg('through `pre`, a list of a type it holds'))
    // CONTROL — a list the element does not hold, handed to a function that changes it, is served
    // (int and float are ONE type, `num`, to this lane, so the unrelated list is text)
    const other = 'var array<string> other = array.new_string()\nbumps(array<string> a) =>\n    array.push(a, "x")\n'
    expect(lastValues(`${H2}${other}for q in qs\n    bumps(other)\nplot(array.size(other))\n`)).toEqual([N])
    // CONTROL — a NEW array of the held type, handed to a function that changes it, is served
    expect(build(walk('t = array.new_float()\n    bump(t)')).ok).toBe(true)
    // CONTROL — an alias of an unrelated list (any chain), changed, is served
    expect(lastValues(`${H2}${other}for q in qs\n    a = other\n    b = a\n    array.push(b, "x")\nplot(array.size(other))\n`))
      .toEqual([N])
    // CONTROL — a number list: the element holds nothing, so nothing is refused for it
    expect(lastValues('var b = array.new_float()\nbumpf(array<float> a) =>\n    array.push(a, 1.0)\na = array.from(1.0, 2.0)\n'
      + 'for x in a\n    bumpf(b)\nplot(array.size(b))\n')).toEqual([2 * N])
  })
  it('inside a function body; a loop whose value is read; `polyline.all`; a matrix; a map; a non-array', () => {
    expect(refusal('f(a) =>\n    s = 0.0\n    for x in a\n        s += x\n    s\nplot(f(array.from(1.0)))\n').message)
      .toMatch(/inside a function body/)
    expect(refusal('if barstate.islast\n    for p in polyline.all\n        polyline.delete(p)\nplot(close)\n').message).toMatch(/`polyline.all` is not yet captured \(W6-F1\)/)
    expect(refusal('a = array.from(1.0, 2.0)\nr = if close > 0\n    for x in a\n        x\nplot(r)\n').message).toMatch(/value of a `for … in` loop/)
    // a matrix / map is refused by name (here at its creation, `runtime:array`, before the walk)
    expect(refusal('m = matrix.new<float>(2, 2, 0)\nfor r in m\n    log.info("x")\nplot(close)\n').guard).toMatch(/^runtime:(loop|array)$/)
    expect(refusal('m = map.new<string, float>()\nfor [k, v] in m\n    log.info(k)\nplot(close)\n').guard).toMatch(/^runtime:(loop|array)$/)
    expect(refusal('n = close\nfor x in n\n    log.info("x")\nplot(close)\n').guard).toBe('runtime:loop')
  })
})

describe('⭐ ONE TABLE — `forInRule.js` is what both lanes read', () => {
  it('the witnessed mutations and snapshot sources are the capture\'s', () => {
    expect([...FOR_IN_LIVE_WITNESSED]).toEqual(['push', 'shift', 'set'])
    expect(FOR_IN_SNAPSHOT_SOURCES).toEqual({ 'line.all': 'line', 'box.all': 'box', 'label.all': 'label' })
  })
  it('the host lane refuses the same body with the same sentence', () => {
    const src = '//@version=5\nindicator("t", overlay = true)\nvar line[] xs = array.new_line()\narray.push(xs, line.new(bar_index, high, bar_index + 1, high))\n'
      + 'for [i, l] in xs\n    line.set_x2(l, bar_index + 2)\n    array.remove(xs, i)\n'
    const t = translatePine(src, { strict: true })
    expect(t.objectDiagnostics.forInRefused).toEqual([`${forInMutationRefusal('xs')}@5`])
  })
})

describe('⛔ THE DOORS', () => {
  const SRC = 'a = array.from(1.0, 2.0)\ns = 0.0\nfor x in a\n    s += x\nplot(s)\n'
  it('the C18 object door refuses a `for … in` BY NAME; the pane builds it', () => {
    const b = build(SRC, { objectDoor: true })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:object-door')
    expect(build(SRC).ok).toBe(true)
  })
  it('the host object pass\'s lane (`objectIterTrees`) keeps master\'s refusal', () => {
    const b = build(SRC, { objectIterTrees: [] })
    expect(b.ok).toBe(false)
    expect([b.refusal.guard, b.refusal.message]).toEqual(['runtime:loop', 'a loop in a form this lane does not iterate — `for … in`'])
  })
})
