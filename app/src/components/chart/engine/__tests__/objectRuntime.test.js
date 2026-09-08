// app/src/components/chart/engine/__tests__/objectRuntime.test.js
//
// ─── C3B — THE LIFECYCLE, PROVEN RATHER THAN ASSERTED ───────────────────────
//
// ⛔ EVERY CASE HERE IS BUILT SO THAT THE WRONG ANSWER IS A *DIFFERENT* ANSWER,
// not a missing one. A test that only checks "an object exists" passes for an
// engine that creates one object per bar and never deletes, which is precisely
// the architecture this wave exists to avoid.
import { describe, it, expect } from 'vitest'
import { evaluateObjects, OBJECT_STATUS } from '../objectRuntime'
import { assertObjectProgram, makeObjectRef, isObjectRef, NA_REF } from '../ast/objectProgram'

/** A column-backed context: node 0 is "true on the bars listed", node 1 counts. */
const ctxOf = (barCount, cols = {}, extra = {}) => ({
  barCount,
  readNode: (node, bar) => (cols[node] ? cols[node][bar] : NaN),
  readTime: (bar) => 1_700_000_000 + bar * 86400,
  ...extra,
})

const onBars = (n, list) => Array.from({ length: n }, (_, i) => (list.includes(i) ? 1 : 0))

const P = (over) => ({ programVersion: 1, regs: [], colls: [], ops: [], ...over })

describe('C3B — object identity', () => {
  it('⭐⭐ two objects with IDENTICAL geometry are two objects', () => {
    const prog = P({
      ops: [
        { k: 'create', family: 'line', site: 'a', into: null, when: { v: 'graph', node: 0 }, props: { x1: { v: 'const', value: 5 }, y1: { v: 'const', value: 100 } } },
        { k: 'create', family: 'line', site: 'b', into: null, when: { v: 'graph', node: 0 }, props: { x1: { v: 'const', value: 5 }, y1: { v: 'const', value: 100 } } },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(3, { 0: onBars(3, [1]) }))
    expect(r.live).toHaveLength(2)
    expect(r.live[0].id).not.toBe(r.live[1].id)
    // …and the props really are identical, so nothing distinguishes them but id
    expect(r.live[0].props).toEqual(r.live[1].props)
  })

  it('⭐⭐ ONE object moved twice is still one object, and keeps its id', () => {
    const prog = P({
      regs: [{ id: 'l', family: 'line' }],
      ops: [
        { k: 'create', family: 'line', site: 'a', into: 'l', when: { v: 'graph', node: 0 }, props: { y1: { v: 'const', value: 1 } } },
        { k: 'update', target: { r: 'reg', id: 'l' }, when: { v: 'graph', node: 1 }, props: { y1: { v: 'bar' } } },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(5, { 0: onBars(5, [0]), 1: onBars(5, [2, 4]) }))
    expect(r.live).toHaveLength(1)
    expect(r.live[0].id).toBe(1)
    expect(r.live[0].createdBar).toBe(0)
    // last write wins, and the last write was bar 4
    expect(r.live[0].props.y1).toBe(4)
    expect(r.stats.updated).toBe(2)
  })

  it('⛔ the same source line on two bars creates two DIFFERENT objects', () => {
    const prog = P({
      ops: [{ k: 'create', family: 'label', site: 'a', into: null, when: { v: 'graph', node: 0 }, props: { x: { v: 'bar' } } }],
    })
    const r = evaluateObjects(prog, ctxOf(6, { 0: onBars(6, [1, 3, 5]) }))
    expect(r.live.map((o) => o.id)).toEqual([1, 2, 3])
    expect(r.live.map((o) => o.props.x)).toEqual([1, 3, 5])
  })
})

describe('C3B — create / update / delete', () => {
  it('⭐ the full lifecycle: born, moved, moved again, deleted', () => {
    const prog = P({
      regs: [{ id: 'l', family: 'line' }],
      ops: [
        { k: 'create', family: 'line', site: 'a', into: 'l', when: { v: 'graph', node: 0 }, props: { y1: { v: 'const', value: 10 } } },
        { k: 'update', target: { r: 'reg', id: 'l' }, when: { v: 'graph', node: 1 }, props: { y1: { v: 'bar' } } },
        { k: 'delete', target: { r: 'reg', id: 'l' }, when: { v: 'graph', node: 2 } },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(10, {
      0: onBars(10, [1]), 1: onBars(10, [2, 3]), 2: onBars(10, [7]),
    }, { trace: true }))
    expect(r.live).toHaveLength(0)
    expect(r.stats).toMatchObject({ created: 1, updated: 2, deleted: 1 })
    expect(r.events.map((e) => `${e.bar}:${e.k}`)).toEqual(['1:create', '2:update', '3:update', '7:delete'])
  })

  it('⛔ a write to a DELETED object is a counted no-op, never a crash', () => {
    const prog = P({
      regs: [{ id: 'l', family: 'line' }],
      ops: [
        { k: 'create', family: 'line', site: 'a', into: 'l', when: { v: 'graph', node: 0 }, props: {} },
        { k: 'delete', target: { r: 'reg', id: 'l' }, when: { v: 'graph', node: 1 } },
        { k: 'update', target: { r: 'reg', id: 'l' }, when: { v: 'graph', node: 2 }, props: { y1: { v: 'const', value: 9 } } },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(6, { 0: onBars(6, [0]), 1: onBars(6, [2]), 2: onBars(6, [4]) }))
    expect(r.status).toBe(OBJECT_STATUS.OK)
    expect(r.live).toHaveLength(0)
    expect(r.stats.writesToDeleted).toBe(1)
  })

  it('⛔ DELETE CLEARS EVERY CONTAINER THAT NAMED THE OBJECT', () => {
    // Otherwise a register keeps a handle to nothing and the next update lands
    // nowhere — silently, which is the "why did it stop moving" defect.
    const prog = P({
      regs: [{ id: 'l', family: 'line' }],
      colls: [{ id: 'c', family: 'line', cap: 10 }],
      ops: [
        { k: 'create', family: 'line', site: 'a', into: 'l', when: { v: 'graph', node: 0 }, props: {} },
        { k: 'push', coll: 'c', value: { r: 'reg', id: 'l' }, when: { v: 'graph', node: 0 } },
        { k: 'delete', target: { r: 'reg', id: 'l' }, when: { v: 'graph', node: 1 } },
        { k: 'create', family: 'line', site: 'b', into: null, when: { v: 'graph', node: 2 }, props: { y1: { v: 'const', value: 3 } } },
        { k: 'push', coll: 'c', value: { r: 'site', id: 'b' }, when: { v: 'graph', node: 2 } },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(6, { 0: onBars(6, [0]), 1: onBars(6, [2]), 2: onBars(6, [4]) }))
    expect(r.live).toHaveLength(1)
    expect(r.live[0].props.y1).toBe(3)
  })
})

describe('C3B — bar order and no future leakage', () => {
  it('⛔⛔ an object cannot be created before the bar its condition fires', () => {
    const prog = P({
      ops: [{ k: 'create', family: 'box', site: 'a', into: null, when: { v: 'graph', node: 0 }, props: { left: { v: 'bar' } } }],
    })
    // the condition is true ONLY on the last bar; a lookahead engine would have
    // created it on bar 0 with left=0.
    const r = evaluateObjects(prog, ctxOf(50, { 0: onBars(50, [49]) }))
    expect(r.live).toHaveLength(1)
    expect(r.live[0].createdBar).toBe(49)
    expect(r.live[0].props.left).toBe(49)
  })

  it('⭐ ops run in SOURCE ORDER within a bar — a create then an update in the same bar', () => {
    const prog = P({
      ops: [
        { k: 'create', family: 'label', site: 'a', into: null, when: null, props: { text: { v: 'const', value: 'born' } } },
        { k: 'update', target: { r: 'site', id: 'a' }, when: null, props: { text: { v: 'const', value: 'moved' } } },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(1))
    expect(r.live[0].props.text).toBe('moved')
  })

  it('⛔ a SITE reference is bar-local — it cannot reach yesterday’s object', () => {
    const prog = P({
      ops: [
        { k: 'create', family: 'label', site: 'a', into: null, when: { v: 'graph', node: 0 }, props: { text: { v: 'const', value: 'x' } } },
        // fires on a LATER bar than the create, so the site is empty
        { k: 'update', target: { r: 'site', id: 'a' }, when: { v: 'graph', node: 1 }, props: { text: { v: 'const', value: 'y' } } },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(5, { 0: onBars(5, [0]), 1: onBars(5, [3]) }))
    expect(r.live[0].props.text).toBe('x')
    expect(r.stats.writesToDeleted).toBe(1)
  })
})

describe('C3B — var-held references', () => {
  it('⭐⭐ `var line l = na` … `l := line.new()` … `line.set_*(l)` across bars', () => {
    const prog = P({
      regs: [{ id: 'l', family: 'line' }],
      ops: [
        { k: 'create', family: 'line', site: 'a', into: 'l', when: { v: 'graph', node: 0 }, props: { y1: { v: 'const', value: 1 } } },
        { k: 'update', target: { r: 'reg', id: 'l' }, when: null, props: { y2: { v: 'bar' } } },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(8, { 0: onBars(8, [2]) }))
    expect(r.live).toHaveLength(1)
    // updated on every bar from 2 onward, so the last value is the last bar
    expect(r.live[0].props.y2).toBe(7)
    // …and nothing was written before the register was filled
    expect(r.stats.writesToDeleted).toBe(2)
  })

  it('⭐ a register REASSIGNED to a new object leaves the old one alone', () => {
    const prog = P({
      regs: [{ id: 'l', family: 'line' }],
      ops: [
        { k: 'create', family: 'line', site: 'a', into: 'l', when: { v: 'graph', node: 0 }, props: { y1: { v: 'bar' } } },
        { k: 'update', target: { r: 'reg', id: 'l' }, when: null, props: { y2: { v: 'const', value: 99 } } },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(6, { 0: onBars(6, [1, 4]) }))
    expect(r.live.map((o) => o.props.y1)).toEqual([1, 4])
    // both got y2 — the first while it was held, the second after the swap
    expect(r.live.map((o) => o.props.y2)).toEqual([99, 99])
  })

  it('⛔ setreg to na empties the register and later writes go nowhere', () => {
    const prog = P({
      regs: [{ id: 'l', family: 'line' }],
      ops: [
        { k: 'create', family: 'line', site: 'a', into: 'l', when: { v: 'graph', node: 0 }, props: {} },
        { k: 'setreg', reg: 'l', value: null, when: { v: 'graph', node: 1 } },
        { k: 'update', target: { r: 'reg', id: 'l' }, when: { v: 'graph', node: 2 }, props: { y1: { v: 'const', value: 7 } } },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(6, { 0: onBars(6, [0]), 1: onBars(6, [1]), 2: onBars(6, [3]) }))
    expect(r.live).toHaveLength(1)
    expect(r.live[0].props.y1).toBeUndefined()
    expect(r.stats.writesToDeleted).toBe(1)
  })
})

describe('C3B — typed collections', () => {
  it('⭐ push / index / set / remove, all typed and bounded', () => {
    const prog = P({
      colls: [{ id: 'c', family: 'line', cap: 4 }],
      ops: [
        { k: 'create', family: 'line', site: 'a', into: null, when: null, props: { y1: { v: 'bar' } } },
        { k: 'push', coll: 'c', value: { r: 'site', id: 'a' }, when: null },
        { k: 'update', target: { r: 'coll', id: 'c', index: { v: 'const', value: 0 } }, when: null, props: { y2: { v: 'bar' } } },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(4))
    expect(r.live).toHaveLength(4)
    // element 0 is the FIRST object pushed, and it was updated on every bar
    expect(r.live[0].props.y2).toBe(3)
    expect(r.live[3].props.y2).toBeUndefined()
  })

  it('⛔⛔ over the cap is a STRUCTURED REFUSAL, never a silent discard', () => {
    const prog = P({
      colls: [{ id: 'c', family: 'line', cap: 3 }],
      ops: [
        { k: 'create', family: 'line', site: 'a', into: null, when: null, props: {} },
        { k: 'push', coll: 'c', value: { r: 'site', id: 'a' }, when: null },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(10))
    expect(r.status).toBe(OBJECT_STATUS.LIMIT_EXCEEDED)
    expect(r.reason).toMatch(/collection c exceeded its cap of 3/)
  })
})

describe('C3B — the resource envelope', () => {
  it('⛔⛔ over the per-family ceiling REFUSES with a named reason', () => {
    const prog = P({
      limits: { line: 5 },
      ops: [{ k: 'create', family: 'line', site: 'a', into: null, when: null, props: {} }],
    })
    const r = evaluateObjects(prog, ctxOf(100))
    expect(r.status).toBe(OBJECT_STATUS.LIMIT_EXCEEDED)
    expect(r.reason).toMatch(/more than 5 live line objects/)
    // ⛔ AND IT STOPPED THERE — it did not keep drawing past its own ceiling.
    expect(r.live.length).toBeLessThanOrEqual(5)
  })

  it('⛔ a runaway ops-per-bar is bounded too', () => {
    const ops = Array.from({ length: 12 }, (_, i) => ({
      k: 'create', family: 'label', site: `s${i}`, into: null, when: null, props: {},
    }))
    const r = evaluateObjects(P({ limits: { opsPerBar: 5 }, ops }), ctxOf(3))
    expect(r.status).toBe(OBJECT_STATUS.LIMIT_EXCEEDED)
    expect(r.reason).toMatch(/more than 5 object operations/)
  })

  it('⭐⭐ CREATE→DELETE across thousands of bars stays FLAT — this is the GC proof', () => {
    const prog = P({
      regs: [{ id: 'l', family: 'line' }],
      ops: [
        { k: 'delete', target: { r: 'reg', id: 'l' }, when: null },
        { k: 'create', family: 'line', site: 'a', into: 'l', when: null, props: { y1: { v: 'bar' } } },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(5000))
    expect(r.status).toBe(OBJECT_STATUS.OK)
    expect(r.live).toHaveLength(1)
    expect(r.stats.created).toBe(5000)
    expect(r.stats.deleted).toBe(4999)
    // ⛔ THE NUMBER THAT MATTERS: never more than one alive at a time, so the
    // 500-line ceiling is never approached by a program that recycles.
    expect(r.stats.peakLive.line).toBe(1)
    expect(r.live[0].props.y1).toBe(4999)
  })
})

describe('C3B — tables are addressed, not listed', () => {
  it('⭐ a cell is (column, row) and the last write to a cell wins', () => {
    const prog = P({
      regs: [{ id: 't', family: 'table' }],
      ops: [
        { k: 'create', family: 'table', site: 'a', into: 't', when: { v: 'graph', node: 0 }, props: { position: { v: 'const', value: 'top_right' }, columns: { v: 'const', value: 2 }, rows: { v: 'const', value: 2 } } },
        { k: 'cell', target: { r: 'reg', id: 't' }, when: null, col: { v: 'const', value: 0 }, row: { v: 'const', value: 0 }, props: { text: { v: 'const', value: 'RSI' } } },
        { k: 'cell', target: { r: 'reg', id: 't' }, when: null, col: { v: 'const', value: 1 }, row: { v: 'const', value: 0 }, props: { text: { v: 'bar' } } },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(4, { 0: onBars(4, [0]) }))
    expect(r.live).toHaveLength(1)
    expect(r.live[0].cells).toEqual([
      { col: 0, row: 0, props: { text: 'RSI' } },
      { col: 1, row: 0, props: { text: 3 } },
    ])
  })

  it('⛔ a table’s cells die with the table', () => {
    const prog = P({
      regs: [{ id: 't', family: 'table' }],
      ops: [
        { k: 'create', family: 'table', site: 'a', into: 't', when: { v: 'graph', node: 0 }, props: {} },
        { k: 'cell', target: { r: 'reg', id: 't' }, when: null, col: { v: 'const', value: 0 }, row: { v: 'const', value: 0 }, props: { text: { v: 'const', value: 'x' } } },
        { k: 'delete', target: { r: 'reg', id: 't' }, when: { v: 'graph', node: 1 } },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(5, { 0: onBars(5, [0]), 1: onBars(5, [3]) }))
    expect(r.live).toHaveLength(0)
  })
})

describe('C3B — typed refs refuse cross-family misuse AT THE DOOR', () => {
  it('⛔⛔ a line cannot be stored in a label register', () => {
    expect(() => assertObjectProgram(P({
      regs: [{ id: 'l', family: 'label' }],
      ops: [{ k: 'create', family: 'line', site: 'a', into: 'l', when: null, props: {} }],
    }))).toThrow(/cannot be stored in register l, which holds label/)
  })

  it('⛔ a property outside the family vocabulary is refused, not ignored', () => {
    expect(() => assertObjectProgram(P({
      ops: [{ k: 'create', family: 'line', site: 'a', into: null, when: null, props: { text: { v: 'const', value: 'x' } } }],
    }))).toThrow(/line has no property "text"/)
  })

  it('⛔ a cell op aimed at a line is refused', () => {
    expect(() => assertObjectProgram(P({
      regs: [{ id: 'l', family: 'line' }],
      ops: [
        { k: 'create', family: 'line', site: 'a', into: 'l', when: null, props: {} },
        { k: 'cell', target: { r: 'reg', id: 'l' }, when: null, col: { v: 'const', value: 0 }, row: { v: 'const', value: 0 }, props: {} },
      ],
    }))).toThrow(/cell targets a line, but only a table has cells/)
  })

  it('⛔ a linefill must reference LINES, not labels', () => {
    expect(() => assertObjectProgram(P({
      regs: [{ id: 'a', family: 'label' }],
      ops: [
        { k: 'create', family: 'label', site: 's1', into: 'a', when: null, props: {} },
        { k: 'create', family: 'linefill', site: 's2', into: null, when: null, props: { line1: { r: 'reg', id: 'a' } } },
      ],
    }))).toThrow(/linefill\.line1 must reference a line, got a label/)
  })

  it('⛔ a site referenced but never created is refused', () => {
    expect(() => assertObjectProgram(P({
      ops: [{ k: 'update', target: { r: 'site', id: 'ghost' }, when: null, props: {} }],
    }))).toThrow(/site "ghost" is referenced but never created/)
  })

  it('⛔ an unbounded collection is refused', () => {
    expect(() => assertObjectProgram(P({ colls: [{ id: 'c', family: 'line' }] })))
      .toThrow(/needs an integer cap in 1\.\.500/)
  })

  it('⭐ a typed handle is a HANDLE, never a bare number', () => {
    const ref = makeObjectRef('line', 7)
    expect(isObjectRef(ref)).toBe(true)
    expect(isObjectRef(7)).toBe(false)
    expect(isObjectRef({ family: 'line', id: 7 })).toBe(false)
    expect(NA_REF.id).toBe(-1)
  })
})
