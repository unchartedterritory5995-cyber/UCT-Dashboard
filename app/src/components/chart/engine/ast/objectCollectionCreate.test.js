// app/src/components/chart/engine/ast/objectCollectionCreate.test.js
//
// ─── ⭐⭐ A CREATE WRITTEN INSIDE THE CALL — `array.push(coll, box.new(…))` ──
//
// The object reader only ever saw a create in a STATEMENT position: the right
// hand side of a declaration, the right hand side of a reassignment, or a bare
// call. So the corpus idiom for a script that keeps a LIST of drawings — create
// it straight into the array — collected NO create at all, `buildObjectProgram`
// answered `program: null`, and the script was reported as drawing nothing.
//
// ⛔ THE MEASURE HERE IS THE PROGRAM, NEVER "IT PARSED". A reader that emitted
// the push and dropped the create would leave a collection that fills with
// nothing, which draws exactly what refusing drew. Every case below asserts the
// CREATE survives, that the push REFERENCES it, and — the load-bearing half —
// that the values it carries are still bound to the script's own expressions.
//
// ⛔⛔ ONE CASE IS BUILT ENTIRELY FROM COMPUTED ARGUMENTS, and that is not
// decoration. A fixture whose coordinates are literals folds to `{v:'const'}`
// before it reaches any binding code, so the binding stays completely unrailed
// and a mutation that broke it would survive. `computedCase` below reads `high`,
// `low`, `bar_index` and a `close > open` ternary, so every coordinate arrives
// as a TREE reference and is then read back through the object runtime.
import { describe, it, expect } from 'vitest'

import { translatePine } from './pine'
import { assertObjectProgram, bindObjectProgram } from './objectProgram'
import { evaluateObjects } from '../objectRuntime'

const head = '//@version=6\nindicator("t", overlay = true)\n'
const T = (src, opts = {}) => translatePine(head + src, { strict: true, objects: true, ...opts })
const opsOf = (t) => ((t.objects || {}).ops || [])
const kindsOf = (t) => opsOf(t).map((o) => o.k)
const dropsOf = (t) => ((t.objectDiagnostics || {}).dropReasons || {})

/** ⛔ CONTROL, on every case: the object pass RAN. `translatePine` catches a
 *  throw from the reader and reports `{failed: true}` with no program, and an
 *  empty `ops` array satisfies almost any check written over it — so "no create"
 *  and "the reader crashed" would otherwise be the same observation. */
const ranCleanly = (t) => {
  expect(t.objectDiagnostics, 'the object pass produced no diagnostics at all').toBeTruthy()
  expect(t.objectDiagnostics.failed, `the object reader threw: ${t.objectDiagnostics.error}`)
    .toBeUndefined()
}

const LITERAL = 'var boxes = array.new_box(0)\n'
  + 'array.push(boxes, box.new(1, 2, 3, 4))\n'

// ⭐⭐ EVERY ARGUMENT COMPUTED FROM SERIES DATA — see the header note.
const COMPUTED = 'var boxes = array.new_box(0)\n'
  + 'if close > open\n'
  + '    array.push(boxes, box.new(bar_index - 2, high, bar_index, low))\n'

describe('⭐⭐ the reader collects a create written inside a collection call', () => {
  it('emits the CREATE and the push, in that order', () => {
    const t = T(LITERAL)
    ranCleanly(t)
    expect(kindsOf(t), 'a push with no create fills the collection with nothing')
      .toEqual(['create', 'push'])
  })

  it('⭐⭐ and the push REFERENCES that create by its site', () => {
    const [create, push] = opsOf(T(LITERAL))
    expect(create.family).toBe('box')
    // A bar-local `{r:'site'}` is what this format already documents for an
    // inline create: "what THIS bar's create at that site made".
    expect(push.value).toEqual({ r: 'site', id: create.site })
  })

  it('⛔ the program VALIDATES — the shape is one the runtime accepts', () => {
    // A reader that emitted a plausible op the validator rejects has moved the
    // failure later rather than fixing it: `assertObjectProgram` throwing inside
    // `translatePine` is caught and reported as `objectDiagnostics.failed`, so
    // the whole drawing disappears instead of one op.
    expect(() => assertObjectProgram(T(LITERAL).objects)).not.toThrow()
  })

  it('⭐ `array.set(coll, i, box.new(…))` carries a create the same way', () => {
    const t = T('var boxes = array.new_box(0)\n'
      + 'array.set(boxes, 0, box.new(1, 2, 3, 4))\n')
    ranCleanly(t)
    expect(kindsOf(t)).toEqual(['create', 'collset'])
    const [create, set] = opsOf(t)
    expect(set.value).toEqual({ r: 'site', id: create.site })
    expect(() => assertObjectProgram(t.objects)).not.toThrow()
  })

  it('⛔ a collection call with no object argument is untouched', () => {
    // `remove` takes an index. A reader that hunted for a create in every
    // argument position would start reading an index as a handle.
    const t = T('var boxes = array.new_box(0)\n'
      + 'array.remove(boxes, 0)\n'
      + 'array.push(boxes, box.new(1, 2, 3, 4))\n')
    ranCleanly(t)
    expect(kindsOf(t)).toEqual(['collremove', 'create', 'push'])
  })

  it('⛔ CONTROL — pushing an ordinary declared handle still binds to a REGISTER', () => {
    // The path that already worked must keep working, and must keep answering a
    // DIFFERENT kind of reference: a register outlives the bar, a site does not.
    const t = T('var boxes = array.new_box(0)\n'
      + 'var box b = na\n'
      + 'b := box.new(1, 2, 3, 4)\n'
      + 'array.push(boxes, b)\n')
    ranCleanly(t)
    const push = opsOf(t).find((o) => o.k === 'push')
    expect(push.value.r).toBe('reg')
  })
})

describe('⛔⛔ a create this door cannot carry takes its push with it', () => {
  // `label.new(x)` has no `y`, and Pine has no default for it — the reader
  // refuses the create. If the push survived, it would name a site that never
  // creates, `assertObjectProgram` would throw *"site is referenced but never
  // created"*, and `translatePine` would report the WHOLE object program as
  // failed — losing every other drawing in the script to one bad call.
  const BAD = 'var labels = array.new_label(0)\n'
    + 'array.push(labels, label.new(bar_index))\n'
    + 'var boxes = array.new_box(0)\n'
    + 'array.push(boxes, box.new(1, 2, 3, 4))\n'

  it('drops both, by name, and keeps the healthy drawing', () => {
    const t = T(BAD)
    ranCleanly(t)
    expect(dropsOf(t)['create:label'], 'the refused create was not counted').toBe(1)
    expect(dropsOf(t)['coll:push'], 'the push naming it was not dropped with it').toBe(1)
    expect(kindsOf(t), 'the other drawing was lost too').toEqual(['create', 'push'])
  })

  it('⭐ and the surviving program still VALIDATES', () => {
    expect(() => assertObjectProgram(T(BAD).objects)).not.toThrow()
  })
})

describe('⭐⭐ COMPUTED ARGUMENTS — the coordinates stay bound to the script', () => {
  it('every coordinate is a TREE reference, not a folded constant', () => {
    const t = T(COMPUTED)
    ranCleanly(t)
    const create = opsOf(t).find((o) => o.k === 'create')
    expect(create, 'no create survived the computed case').toBeTruthy()
    // ⛔ THE ASSERTION THAT MAKES THIS FIXTURE WORTH HAVING. A literal fixture
    // answers `{v:'const'}` here and proves nothing about binding.
    expect(create.props.top.v, 'the `high` coordinate folded to a constant')
      .toBe('tree')
    expect(create.props.bottom.v).toBe('tree')
    expect(create.props.top.tree).not.toBe(create.props.bottom.tree)
    // The guard is a computed expression too — `if close > open`.
    expect(create.when).toBeTruthy()
    expect(create.when.v).toBe('tree')
  })

  it('⭐⭐ and the DRAWING reads them back per bar, through the object runtime', () => {
    const t = T(COMPUTED)
    const program = bindObjectProgram(t.objects, (i) => i)
    const create = program.ops.find((o) => o.k === 'create')

    // Each tree index gets its own series, so a coordinate wired to the wrong
    // tree — or folded — produces a DIFFERENT number rather than a missing one.
    const bars = 4
    const series = {}
    const treeCount = (t.objects.trees || []).length
    for (let i = 0; i < treeCount; i += 1) {
      series[i] = Array.from({ length: bars }, (_, b) => (i + 1) * 10 + b)
    }
    // The guard's own tree must answer truthy on every bar or nothing is drawn.
    series[create.when.node] = Array.from({ length: bars }, () => 1)

    const r = evaluateObjects(program, {
      barCount: bars,
      readNode: (node, bar) => (series[node] ? series[node][bar] : NaN),
      readTime: (bar) => 1_700_000_000 + bar * 86400,
    })

    expect(r.live.length, 'the loop drew nothing at all').toBe(bars)
    const tops = r.live.map((o) => o.props.top)
    const bottoms = r.live.map((o) => o.props.bottom)
    expect(tops).toEqual(series[create.props.top.node].slice(0, bars))
    expect(bottoms).toEqual(series[create.props.bottom.node].slice(0, bars))
    // ⛔ THE CONTROL ON THE CONTROL: a value that is the same on every bar is
    // exactly what a folded constant looks like, so the fixture is only
    // meaningful if these actually move.
    expect(new Set(tops).size, 'the coordinate was identical on every bar').toBe(bars)
    expect(tops[0]).not.toBe(bottoms[0])
  })
})
