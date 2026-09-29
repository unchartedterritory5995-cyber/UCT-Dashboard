// app/src/components/chart/engine/__tests__/objectCollectionSlots.test.js
//
// ─── C16 — A DRAWING COLLECTION KEEPS ITS SLOTS THE WAY PINE'S ARRAY DOES ─────
//
// Pine's `box.delete(b)` ends the OBJECT; the `array<box>` that holds `b` is not
// touched — `array.size` is unchanged and the slot still holds the dead handle.
// That is why the corpus writes the pair
//
//     box.delete(b)
//     array.remove(bull_boxes, i)          ← institutional-smc, lines 137–138
//
// and `box.delete(array.shift(boxes))`. And `array.push(bs, na)` grows the array
// by one `na` slot. The runtime used to splice a deleted id out of every
// collection and skip an `na` push, so the pair above removed TWO elements and
// every later index read addressed the wrong box.
//
// ⛔ Each case is built so the old behaviour gives a DIFFERENT answer, not a
// missing one.
import { describe, it, expect } from 'vitest'
import { evaluateObjects, OBJECT_STATUS } from '../objectRuntime'

const ctxOf = (barCount, cols = {}) => ({
  barCount,
  readNode: (node, bar) => (cols[node] ? cols[node][bar] : NaN),
  readTime: (bar) => 1_700_000_000 + bar * 86400,
})
const onBars = (n, list) => Array.from({ length: n }, (_, i) => (list.includes(i) ? 1 : 0))
const P = (over) => ({ programVersion: 1, regs: [], colls: [], ops: [], ...over })
const bar0 = { v: 'graph', node: 0 }
const bar1 = { v: 'graph', node: 1 }

describe('C16 — a deleted drawing keeps its slot in the collection', () => {
  it('⭐⭐ `box.delete(b)` then `array.remove(bs, 0)` removes ONE element — the dead one', () => {
    // bar 0: A and B pushed. bar 1: delete A (through the register), then remove
    // slot 0, then move whatever slot 0 holds now. Pine: slot 0 is B.
    const prog = P({
      regs: [{ id: 'a', family: 'box' }],
      colls: [{ id: 'bs', family: 'box', cap: 10 }],
      ops: [
        { k: 'create', family: 'box', site: 'sa', into: 'a', when: bar0, props: { top: { v: 'const', value: 1 } } },
        { k: 'push', coll: 'bs', value: { r: 'reg', id: 'a' }, when: bar0 },
        { k: 'create', family: 'box', site: 'sb', into: null, when: bar0, props: { top: { v: 'const', value: 2 } } },
        { k: 'push', coll: 'bs', value: { r: 'site', id: 'sb' }, when: bar0 },
        { k: 'delete', target: { r: 'reg', id: 'a' }, when: bar1 },
        { k: 'collremove', coll: 'bs', index: { v: 'const', value: 0 }, when: bar1 },
        { k: 'update', target: { r: 'coll', id: 'bs', index: { v: 'const', value: 0 } }, when: bar1, props: { right: { v: 'const', value: 99 } } },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(3, { 0: onBars(3, [0]), 1: onBars(3, [1]) }))
    expect(r.status).toBe(OBJECT_STATUS.OK)
    expect(r.live).toHaveLength(1)
    expect(r.live[0].props.top).toBe(2)
    // ⛔ the splice-on-delete runtime removed B at `collremove 0` and moved nothing
    expect(r.live[0].props.right).toBe(99)
  })

  it('⭐ a slot whose object was deleted is a counted no-op when written through', () => {
    const prog = P({
      regs: [{ id: 'a', family: 'box' }],
      colls: [{ id: 'bs', family: 'box', cap: 10 }],
      ops: [
        { k: 'create', family: 'box', site: 'sa', into: 'a', when: bar0, props: {} },
        { k: 'push', coll: 'bs', value: { r: 'reg', id: 'a' }, when: bar0 },
        { k: 'create', family: 'box', site: 'sb', into: null, when: bar0, props: { top: { v: 'const', value: 2 } } },
        { k: 'push', coll: 'bs', value: { r: 'site', id: 'sb' }, when: bar0 },
        { k: 'delete', target: { r: 'reg', id: 'a' }, when: bar1 },
        // slot 0 still names the DEAD box; slot 1 is B
        { k: 'update', target: { r: 'coll', id: 'bs', index: { v: 'const', value: 1 } }, when: bar1, props: { right: { v: 'const', value: 7 } } },
        { k: 'update', target: { r: 'coll', id: 'bs', index: { v: 'const', value: 0 } }, when: bar1, props: { right: { v: 'const', value: 5 } } },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(2, { 0: onBars(2, [0]), 1: onBars(2, [1]) }))
    expect(r.live).toHaveLength(1)
    // ⛔ splicing made slot 1 empty and slot 0 B, so B got 5 and the dead write vanished
    expect(r.live[0].props.right).toBe(7)
    expect(r.stats.writesToDeleted).toBe(1)
  })

  it('⭐ `array.push(bs, na)` grows the array by one `na` slot', () => {
    const prog = P({
      regs: [{ id: 'empty', family: 'label' }],
      colls: [{ id: 'ls', family: 'label', cap: 10 }],
      ops: [
        { k: 'push', coll: 'ls', value: { r: 'reg', id: 'empty' }, when: bar0 },
        { k: 'create', family: 'label', site: 's', into: null, when: bar0, props: { text: { v: 'const', value: 'x' } } },
        { k: 'push', coll: 'ls', value: { r: 'site', id: 's' }, when: bar0 },
        { k: 'update', target: { r: 'coll', id: 'ls', index: { v: 'const', value: 1 } }, when: bar1, props: { text: { v: 'const', value: 'moved' } } },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(2, { 0: onBars(2, [0]), 1: onBars(2, [1]) }))
    expect(r.live).toHaveLength(1)
    // ⛔ skipping the `na` push put the label at slot 0, and slot 1 was empty
    expect(r.live[0].props.text).toBe('moved')
  })

  it('⛔ the cap counts LIVE objects — a create/push/delete churn never trips it', () => {
    // cap 2; one fresh box pushed and the previous one deleted every bar, so the
    // array holds many dead slots and never more than one live box.
    const prog = P({
      regs: [{ id: 'cur', family: 'box' }],
      colls: [{ id: 'bs', family: 'box', cap: 2 }],
      ops: [
        { k: 'delete', target: { r: 'reg', id: 'cur' }, when: null },
        { k: 'create', family: 'box', site: 's', into: 'cur', when: null, props: {} },
        { k: 'push', coll: 'bs', value: { r: 'reg', id: 'cur' }, when: null },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(12))
    expect(r.status).toBe(OBJECT_STATUS.OK)
    expect(r.live).toHaveLength(1)
  })

  it('⛔ CONTROL — the cap still refuses a collection holding more LIVE objects than it allows', () => {
    const prog = P({
      colls: [{ id: 'bs', family: 'box', cap: 2 }],
      ops: [
        { k: 'create', family: 'box', site: 's', into: null, when: null, props: {} },
        { k: 'push', coll: 'bs', value: { r: 'site', id: 's' }, when: null },
      ],
    })
    const r = evaluateObjects(prog, ctxOf(5))
    expect(r.status).toBe(OBJECT_STATUS.LIMIT_EXCEEDED)
  })
})
