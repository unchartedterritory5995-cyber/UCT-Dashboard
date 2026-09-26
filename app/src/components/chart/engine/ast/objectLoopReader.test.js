// app/src/components/chart/engine/ast/objectLoopReader.test.js
//
// ─── ⭐⭐ THE PINE HALF OF A LOOP — READING ONE, NOT EXECUTING IT ────────────
//
// `objectLoop.test.js` proves the object RUNTIME executes a `loop` op. This file
// proves the READER emits one from real Pine, which is the other half and the
// one that was missing: the executor has existed and been mutation-proved while
// every corpus loop was still refused at the door.
//
// ⛔ THE MEASURE IS OPS DRAWN, NEVER "IT PARSED". A reader that accepted the
// head and dropped every body op would satisfy any check that asked whether the
// loop was seen — and would draw exactly what refusing drew, which is nothing.
import { describe, it, expect } from 'vitest'

import { translatePine } from './pine'
import { assertObjectProgram } from './objectProgram'

const head = '//@version=6\nindicator("t", overlay = true)\n'
const T = (src, opts = {}) => translatePine(head + src, { strict: true, objects: true, ...opts })
const opsOf = (t) => ((t.objects || {}).ops || [])
const loopOf = (t) => opsOf(t).find((o) => o.k === 'loop')

describe('⭐⭐ a counted `for` survives the read', () => {
  const LINES = 'var label lb = na\n'
    + 'for i = 0 to 3\n'
    + '    lb := label.new(bar_index - i, close, "x")\n'

  it('emits ONE loop op carrying its body', () => {
    const t = T(LINES)
    const loop = loopOf(t)
    expect(loop, `no loop op — ops were ${JSON.stringify(opsOf(t).map((o) => o.k))}`)
      .toBeTruthy()
    expect(loop.id).toBe('i')
    expect(loop.body.length, 'the loop was read and its body thrown away, which '
      + 'draws exactly what refusing drew').toBeGreaterThan(0)
    expect(loop.body.some((o) => o.k === 'create')).toBe(true)
  })

  it('⭐ the bounds are ordinary value references', () => {
    const loop = loopOf(T(LINES))
    expect(loop.from).toEqual({ v: 'const', value: 0 })
    expect(loop.to).toEqual({ v: 'const', value: 3 })
  })

  it('⭐⭐ the COUNTER reaches a coordinate, as an arithmetic reference', () => {
    // `bar_index - i` is the whole point: a value that changes per ITERATION,
    // which no tree can express because a tree is a value per BAR.
    const create = loopOf(T(LINES)).body.find((o) => o.k === 'create')
    expect(create.props.x).toEqual({
      v: 'op', op: '-', args: [{ v: 'bar' }, { v: 'loop', id: 'i' }],
    })
  })

  it('⛔ and the program VALIDATES — the shape is one the runtime accepts', () => {
    // A reader that emitted a plausible-looking op the validator rejects has
    // moved the failure later, not fixed it.
    expect(() => assertObjectProgram(T(LINES).objects)).not.toThrow()
  })

  it('⭐ a table address offset from the counter — `r + 1`', () => {
    // The corpus idiom: a header row at 0, data from 1. Measured on the
    // acceptance dashboard, every data cell is addressed this way.
    const t = T('var t = table.new(position.top_right, 1, 5)\n'
      + 'for r = 0 to 3\n'
      + '    table.cell(t, 0, r + 1, "x")\n')
    const cell = loopOf(t).body.find((o) => o.k === 'cell')
    expect(cell.row).toEqual({
      v: 'op', op: '+', args: [{ v: 'loop', id: 'r' }, { v: 'const', value: 1 }],
    })
  })

  it('⭐ NESTED loops nest, rather than flattening beside each other', () => {
    const t = T('var label lb = na\n'
      + 'for a = 0 to 2\n'
      + '    for b = 0 to 2\n'
      + '        lb := label.new(a + b, close, "x")\n')
    const outer = loopOf(t)
    expect(outer.id).toBe('a')
    const inner = outer.body.find((o) => o.k === 'loop')
    expect(inner, 'the inner loop was flattened into the outer body — its ops '
      + 'would then run once per OUTER iteration instead of once per pair')
      .toBeTruthy()
    expect(inner.id).toBe('b')
    // ⭐ BOTH counters are live inside the inner body.
    const create = inner.body.find((o) => o.k === 'create')
    expect(create.props.x).toEqual({
      v: 'op', op: '+', args: [{ v: 'loop', id: 'a' }, { v: 'loop', id: 'b' }],
    })
  })
})

describe('⛔ the shapes the reader still refuses, BY NAME', () => {
  const blocked = (t) => (t.objectDiagnostics || {}).loopBlocked || 0

  it('`while` is refused — a counted op cannot express a condition', () => {
    const t = T('var label lb = na\n'
      + 'i = 0\n'
      + 'while i < 3\n'
      + '    lb := label.new(bar_index, close, "x")\n')
    expect(loopOf(t)).toBeUndefined()
    expect(blocked(t)).toBeGreaterThan(0)
  })

  it('`for … by <step>` is refused rather than stepped by one', () => {
    // Drawing every row of a loop the author wrote to skip is a WRONG table,
    // which is worse than a missing one.
    const t = T('var label lb = na\n'
      + 'for i = 0 to 10 by 2\n'
      + '    lb := label.new(bar_index - i, close, "x")\n')
    expect(loopOf(t)).toBeUndefined()
    expect(blocked(t)).toBeGreaterThan(0)
  })

  it('⛔⛔ AND A COUNTER DEPENDENCE THROUGH A BLOCK-LOCAL NAME IS STILL ONE', () => {
    // ⚰️ THE BUG THIS EXISTS FOR, MEASURED ON THE ACCEPTANCE DASHBOARD. The
    // corpus idiom binds the counter away immediately:
    //
    //     for r = 0 to cnt - 1
    //         i  = array.get(idx, r)
    //         nm = array.get(names, i)
    //         table.cell(t, 0, r + 1, nm)
    //
    // `nm` is a NAME, so a check that looked only at the immediate AST said "no
    // counter here" and sent it down the tree path — a per-BAR value for a
    // per-ROW cell. The dashboard emitted four such cells, one per column, and
    // would have rendered FORTY IDENTICAL ROWS that read as data.
    //
    // ⛔ The DIRECT case below cannot catch this: `array.get(a, r)` names the
    // counter in the argument, so it is caught with or without name-following.
    // ⚠️ THE `if` IS LOAD-BEARING FOR THE FIXTURE, not decoration: a binding made
    // directly in a top-level loop body is not carried into the reader's local
    // scope at all, so it refuses as an UNBOUND NAME and the counter check is
    // never consulted. Under a guard — which is how every dashboard in the
    // corpus is written, and how the acceptance script is — the name IS bound,
    // the tree path is reachable, and this is the only shape that can tell the
    // fix from its absence.
    const t = T('var a = array.new<float>(4, 1.0)\n'
      + 'var t = table.new(position.top_right, 1, 5)\n'
      + 'if barstate.islast\n'
      + '    for r = 0 to 3\n'
      + '        v = array.get(a, r)\n'
      + '        table.cell(t, 0, r + 1, str.tostring(v))\n')
    const d = t.objectDiagnostics || {}
    expect(d.loopValuesUnresolved, 'the counter dependence was not seen through '
      + 'the block-local name — this cell will hold one bar\'s value repeated '
      + 'down every row').toBeGreaterThan(0)
    expect(d.unboundLocals || 0, 'the fixture refused for the WRONG reason — '
      + '`v` was unbound, so this case cannot see the counter check at all')
      .toBe(0)
    expect(loopOf(t), 'the loop survived with a per-bar value standing in for a '
      + 'per-row one, which is worse than not drawing it').toBeUndefined()
  })

  it('⛔⛔ a COUNTER-DEPENDENT VALUE is refused, never served from a tree', () => {
    // `array.get(vals, i)` is a value per ITERATION. The tree path would answer
    // it once per BAR and reuse that for every row — forty rows of the same
    // number, which a member reads as data. The cell is dropped and counted.
    const t = T('var a = array.new<float>(4, 1.0)\n'
      + 'var t = table.new(position.top_right, 1, 5)\n'
      + 'for r = 0 to 3\n'
      + '    table.cell(t, 0, r + 1, str.tostring(array.get(a, r)))\n')
    const d = t.objectDiagnostics || {}
    expect(d.loopValuesUnresolved, 'a counter-dependent value was resolved to '
      + 'something — check it is not a per-bar tree standing in for a per-row '
      + 'value').toBeGreaterThan(0)
    // The address was fine; it is the CONTENT that could not be said, so the
    // cell is dropped by the existing `cell:text` rule rather than drawn blank.
    expect((d.dropReasons || {})['cell:text']).toBeGreaterThan(0)
  })
})
