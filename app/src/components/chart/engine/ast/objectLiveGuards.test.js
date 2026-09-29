// app/src/components/chart/engine/ast/objectLiveGuards.test.js
//
// ⭐⭐ THE OBJECT PROGRAM'S LIVE-GUARD VOCABULARY — WHERE IT IS LEGAL, AND WHERE NOT.
//
// `{v:'get'|'size'|'bool'|'cmp'|'cross'}` read object state that only the
// runtime holds (see `LIVE_GUARD_KINDS` in objectProgram.js). The door keeps
// them where they are sound — an op's guard, a loop bound, a collection index
// (C16, 2026-09-29) — refuses a CROSSING inside a loop body (it is observed once
// per bar; a body runs several times a bar), and refuses a live node that reads
// no object state, so pure logic can never migrate out of the tree into a second
// boolean algebra.
import { describe, it, expect } from 'vitest'
import {
  assertObjectProgram, bindObjectProgram, graphNodesReferenced, treeRefsReferenced,
} from './objectProgram'

const GET = { v: 'get', target: { r: 'reg', id: 'r0' }, prop: 'bottom' }
const CROSS = { v: 'cross', dir: 'under', args: [{ v: 'tree', tree: 0 }, GET] }
const prog = (op, extra = {}) => ({
  programVersion: 1,
  regs: [{ id: 'r0', family: 'box' }],
  colls: [],
  ops: [op],
  ...extra,
})
const label = (when) => ({
  k: 'create', family: 'label', site: 's1', into: null, when,
  props: { x: { v: 'bar' }, y: { v: 'const', value: 1 } },
})

describe('⭐ a guard may read object state', () => {
  it('a crossing of a tree with a getter, under not/and with a pure tree', () => {
    const when = { v: 'bool', op: 'and', args: [{ v: 'tree', tree: 1 }, { v: 'bool', op: 'not', args: [CROSS] }] }
    expect(() => assertObjectProgram(prog(label(when)))).not.toThrow()
  })

  it('a comparison with a getter', () => {
    expect(() => assertObjectProgram(prog(label({ v: 'cmp', op: '>', args: [{ v: 'tree', tree: 0 }, GET] })))).not.toThrow()
  })

  it('⭐ binding reaches the trees INSIDE a live guard — nothing unbound is stored', () => {
    const when = { v: 'bool', op: 'and', args: [{ v: 'tree', tree: 1 }, CROSS] }
    const p = prog(label(when))
    expect(treeRefsReferenced(p)).toEqual([0, 1])
    const bound = bindObjectProgram(p, (i) => i + 10)
    expect(JSON.stringify(bound.ops[0].when)).not.toMatch(/"tree"/)
    expect(graphNodesReferenced(bound)).toEqual([10, 11])
    expect(() => assertObjectProgram(bound)).not.toThrow()
  })
})

describe('⛔ …and nowhere else', () => {
  it('a getter in a PROPERTY is refused', () => {
    const op = { ...label(null), props: { x: { v: 'bar' }, y: GET } }
    expect(() => assertObjectProgram(prog(op))).toThrow(/legal only in a guard/)
  })

  it('a CROSSING inside a LOOP BODY is refused — it is observed once per bar', () => {
    const loop = { k: 'loop', id: 'i', from: { v: 'const', value: 0 }, to: { v: 'const', value: 1 }, body: [label(CROSS)] }
    expect(() => assertObjectProgram(prog(loop))).toThrow(/a cross in a loop body/)
  })

  it('⭐ C16 — a getter or length COMPARISON inside a loop body is legal: one answer per iteration', () => {
    const cmp = { v: 'cmp', op: '<', args: [{ v: 'tree', tree: 0 }, GET] }
    const loop = { k: 'loop', id: 'i', from: { v: 'const', value: 0 }, to: { v: 'const', value: 1 }, body: [label(cmp)] }
    expect(() => assertObjectProgram(prog(loop))).not.toThrow()
    // ⛔ CONTROL — the same crossing one level up (the loop's own guard) is legal
    const outer = { ...loop, when: CROSS, body: [label(null)] }
    expect(() => assertObjectProgram(prog(outer))).not.toThrow()
  })

  it('⭐ C16 — a length reads a DECLARED collection, in a guard, a loop bound and a slot index', () => {
    const size = { v: 'size', coll: 'c0' }
    const colls = { colls: [{ id: 'c0', family: 'box', cap: 10 }] }
    expect(() => assertObjectProgram(prog(label({ v: 'cmp', op: '>=', args: [size, { v: 'const', value: 3 }] }), colls))).not.toThrow()
    const loop = { k: 'loop', id: 'i', from: { v: 'op', op: '-', args: [size, { v: 'const', value: 1 }] }, to: { v: 'const', value: 0 }, body: [label(null)] }
    expect(() => assertObjectProgram(prog(loop, colls))).not.toThrow()
    const del = { k: 'delete', target: { r: 'coll', id: 'c0', index: { v: 'op', op: '-', args: [size, { v: 'const', value: 1 }] } }, when: null }
    expect(() => assertObjectProgram(prog(del, colls))).not.toThrow()
    expect(() => assertObjectProgram(prog(label({ v: 'cmp', op: '>=', args: [{ ...size, coll: 'c9' }, { v: 'const', value: 3 }] }), colls)))
      .toThrow(/undeclared size/)
    // ⛔ a latch is read only after the op that sets it
    expect(() => assertObjectProgram(prog(label({ v: 'bool', op: 'not', args: [{ v: 'latch', id: 'l0' }] }))))
      .toThrow(/undeclared latch/)
    const latched = { programVersion: 1, regs: [{ id: 'r0', family: 'box' }], colls: [],
      ops: [{ k: 'latch', id: 'l0', cond: { v: 'cmp', op: '<', args: [{ v: 'tree', tree: 0 }, GET] } }, label({ v: 'latch', id: 'l0' })] }
    expect(() => assertObjectProgram(latched)).not.toThrow()
    // ⛔ …and still never a property
    const inProp = { ...label(null), props: { x: { v: 'bar' }, y: size } }
    expect(() => assertObjectProgram(prog(inProp, colls))).toThrow(/legal only in a guard/)
  })

  it('a live node that reads NO object state is refused — pure logic belongs in a tree', () => {
    const when = { v: 'bool', op: 'and', args: [{ v: 'tree', tree: 0 }, { v: 'tree', tree: 1 }] }
    expect(() => assertObjectProgram(prog(label(when)))).toThrow(/belongs in a tree/)
  })

  it('a getter on an undeclared register, or a property the family has not got', () => {
    expect(() => assertObjectProgram(prog(label({ ...CROSS, args: [CROSS.args[0], { ...GET, target: { r: 'reg', id: 'r9' } }] }))))
      .toThrow(/not declared/)
    expect(() => assertObjectProgram(prog(label({ ...CROSS, args: [CROSS.args[0], { ...GET, prop: 'x1' }] }))))
      .toThrow(/no readable numeric property/)
  })

  it('an unknown boolean, comparison or crossing direction', () => {
    expect(() => assertObjectProgram(prog(label({ v: 'bool', op: 'xor', args: [CROSS, CROSS] })))).toThrow(/unknown boolean/)
    expect(() => assertObjectProgram(prog(label({ v: 'cmp', op: '===', args: [{ v: 'tree', tree: 0 }, GET] })))).toThrow(/unknown comparison/)
    expect(() => assertObjectProgram(prog(label({ ...CROSS, dir: 'sideways' })))).toThrow(/'over' or 'under'/)
  })
})
