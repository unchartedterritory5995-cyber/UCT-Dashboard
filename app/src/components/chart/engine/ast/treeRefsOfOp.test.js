// app/src/components/chart/engine/ast/treeRefsOfOp.test.js
//
// ─── ⭐⭐ ONE AUTHORITY ON "WHICH TREES DOES THIS OP READ" ───────────────────
//
// Two callers need that answer and they need it at different granularities:
// the document validator asks it of a whole program (does every referenced
// index exist), and `buildObjectLane` asks it of ONE op (which loop encloses
// the read). Those were about to become two walks over the same shapes, which
// is how the second one drifts and nobody finds out
// (`lesson_a_second_authority_over_one_value`).
import { describe, it, expect } from 'vitest'

import { treeRefsOfOp, treeRefsReferenced } from './objectProgram.js'

const tree = (n) => ({ v: 'tree', tree: n })

describe('⭐⭐ treeRefsOfOp — one op, no descent', () => {
  it('⛔ DOES NOT descend into a loop BODY', () => {
    // The whole reason this is separate from `treeRefsReferenced`: a caller
    // asking "where is this read" must be able to tell the loop op itself from
    // the ops inside it. Descending would put every read in the outermost loop.
    const op = {
      k: 'loop',
      id: 'i',
      from: tree(1),
      to: tree(2),
      body: [{ k: 'cell', props: { text: tree(9) } }],
    }
    expect([...treeRefsOfOp(op)].sort((a, b) => a - b)).toEqual([1, 2])
  })

  it("⭐ finds a tree in a `clear`'s ADDRESS — the fields the old walk missed", () => {
    // ⚰️ `treeRefsReferenced` walked `col`/`row`/`index` and the props, but not
    // `startCol`/`startRow`/`endCol`/`endRow`. A tree referenced only by
    // `table.clear(t, …)` was therefore invisible to the one consumer whose
    // entire job is to check that every referenced index exists — and a ref it
    // cannot see is a ref it cannot check.
    const op = {
      k: 'clear',
      target: { r: 'reg', id: 't' },
      startCol: tree(3),
      startRow: tree(4),
      endCol: tree(5),
      endRow: tree(6),
    }
    expect([...treeRefsOfOp(op)].sort((a, b) => a - b)).toEqual([3, 4, 5, 6])
  })

  it('⛔ CONTROL — the fields it ALWAYS read are still read', () => {
    // Without this the case above is satisfied by a walk that looks at the new
    // four and nothing else.
    const op = {
      k: 'cell',
      when: tree(1),
      col: tree(2),
      row: tree(3),
      target: { r: 'coll', id: 'c', index: tree(4) },
      props: { text: { v: 'text', node: { t: 'cat', args: [{ t: 'str', tree: 5 }] } } },
    }
    expect([...treeRefsOfOp(op)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('reads through an `op` value, a text `if` and a colour `if`', () => {
    const op = {
      k: 'update',
      props: {
        x: { v: 'op', args: [tree(7), { v: 'op', args: [tree(8)] }] },
        text: {
          v: 'text',
          node: { t: 'if', cond: tree(9), then: { t: 'num', tree: 10 }, else: { t: 'num', tree: 11 } },
        },
        color: { v: 'color', node: { c: 'if', cond: tree(12), then: null, else: null } },
      },
    }
    expect([...treeRefsOfOp(op)].sort((a, b) => a - b)).toEqual([7, 8, 9, 10, 11, 12])
  })

  it('a non-object op answers empty rather than throwing', () => {
    expect([...treeRefsOfOp(null)]).toEqual([])
    expect([...treeRefsOfOp(undefined)]).toEqual([])
  })
})

describe('⭐ treeRefsReferenced is DERIVED from it', () => {
  it('unions across nested bodies, INCLUDING a clear address', () => {
    // The end-to-end proof that the two are one walk: a tree reachable only
    // through the newly-read fields, two levels down, arrives at the validator.
    const program = {
      ops: [
        { k: 'create', family: 'table', props: { rows: tree(1) } },
        {
          k: 'loop',
          id: 'i',
          from: tree(2),
          to: tree(3),
          body: [
            { k: 'cell', col: tree(4), props: {} },
            {
              k: 'loop',
              id: 'j',
              from: tree(5),
              to: tree(6),
              body: [{ k: 'clear', startCol: tree(7), endRow: tree(8) }],
            },
          ],
        },
      ],
    }
    expect(treeRefsReferenced(program)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('⛔ CONTROL — it still answers empty for a program that reads no tree', () => {
    // A union that returned everything would satisfy the case above too.
    expect(treeRefsReferenced({ ops: [{ k: 'create', family: 'label', props: {} }] })).toEqual([])
    expect(treeRefsReferenced({})).toEqual([])
  })
})
