// app/src/components/chart/engine/__tests__/objectLoop.test.js
//
// ─── ⭐⭐ A LOOP IS AN OPERATION THE RUNTIME EXECUTES ────────────────────────
//
// `pineObjects.js` refuses an object operation inside a `for`/`while`, and its
// stated reason is right about the pass it guards: *"RISK-043 stands, the loop
// is not executed, and drawing the first iteration would be a lie."* That pass
// is a STATIC tree reader — it cannot unroll `for i = 0 to slots - 1`, because
// `slots` is a runtime value.
//
// ⭐ BUT THE OBJECT RUNTIME ALREADY RUNS BAR BY BAR. The loop never needed
// unrolling at read time; it needed to BE an op. Measured on the acceptance
// dashboard: 15 ops blocked this way (`array.push`, `array.set`, `table.cell`),
// which is the whole difference between one header cell and a watchlist table.
//
// ⛔ THIS FILE TESTS THE RUNTIME HALF ONLY, on hand-written programs. The Pine
// reader that EMITS these ops is a separate step, and proving the executor
// first is what keeps a failure attributable to one of the two.
import { describe, it, expect } from 'vitest'

import { evaluateObjects, OBJECT_STATUS } from '../objectRuntime'
import { assertObjectProgram } from '../ast/objectProgram'

const BARS = 3
const ctx = (over = {}) => ({
  barCount: BARS,
  readNode: (node) => node,          // node index doubles as its value
  readTime: (i) => 1_700_000_000 + i * 86400,
  ...over,
})

/** A table whose rows are written by a loop — the dashboard's own shape. */
const loopProgram = (from, to, body = null) => ({
  programVersion: 1,
  regs: [{ id: 'r0', family: 'table' }],
  colls: [],
  ops: [
    { k: 'create', family: 'table', site: 's1', into: 'r0', once: true, props: {} },
    {
      k: 'loop',
      id: 'i',
      from,
      to,
      body: body || [{
        k: 'cell',
        target: { r: 'reg', id: 'r0' },
        col: { v: 'const', value: 0 },
        row: { v: 'loop', id: 'i' },
        props: { text: { v: 'text', node: { t: 'lit', s: 'row' } } },
      }],
    },
  ],
})

/** The table's cells, as `col,row` keys — `live` is an ARRAY of plain objects
 *  and each table carries its own `cells`, sorted by row then column. */
const cellKeys = (run) => {
  const table = (run.live || []).find((o) => o.family === 'table')
  return (table && table.cells ? table.cells : []).map((c) => `${c.col},${c.row}`)
}

describe('a loop writes one cell per iteration', () => {
  it('⭐⭐ FOUR ITERATIONS PRODUCE FOUR ROWS', () => {
    const p = loopProgram({ v: 'const', value: 0 }, { v: 'const', value: 3 })
    assertObjectProgram(p)
    const run = evaluateObjects(p, ctx())
    expect(run.status).toBe(OBJECT_STATUS.OK)
        // ⛔ THE ROWS ARE THE RAIL, not the count. A body that wrote row 0 four
    // times would also answer "four executions" and leave ONE cell — which is
    // exactly what an unbound counter produces, and it looks like a table with
    // one row where the author wrote four.
    expect(cellKeys(run).sort()).toEqual(['0,0', '0,1', '0,2', '0,3'])
  })

  it('⛔ CONTROL: without the loop, one cell', () => {
    // Without this, "four cells" is satisfied by any build that writes four —
    // including one that ignores the loop and repeats the body statically.
    const p = loopProgram({ v: 'const', value: 0 }, { v: 'const', value: 0 })
    expect(cellKeys(evaluateObjects(p, ctx()))).toEqual(['0,0'])
  })

  it('⭐ it counts DOWN when `to` is below `from`', () => {
    // `for i = n to 0` is a real Pine idiom. An ascending-only reader draws
    // nothing for it, silently.
    const p = loopProgram({ v: 'const', value: 2 }, { v: 'const', value: 0 })
    expect(cellKeys(evaluateObjects(p, ctx())).sort())
      .toEqual(['0,0', '0,1', '0,2'])
  })

  it('⭐ the bounds are ordinary value references, so a GRAPH node works', () => {
    // `for i = 0 to array.size(syms) - 1` is a graph node like any other — the
    // point of reusing valueRef rather than inventing a bounds grammar.
    const p = loopProgram({ v: 'const', value: 0 }, { v: 'graph', node: 2 })
    expect(cellKeys(evaluateObjects(p, ctx())).sort())
      .toEqual(['0,0', '0,1', '0,2'])
  })
})

describe('⛔ what a loop refuses to invent', () => {
  it('a non-finite bound runs ZERO times, never "from 0"', () => {
    // `array.size(syms) - 1` before the array is filled is `na`. Treating that
    // as 0 would draw a row of blanks that looks like data; drawing nothing is
    // the honest answer for an empty list.
    const p = loopProgram({ v: 'const', value: 0 }, { v: 'const', value: NaN })
    const run = evaluateObjects(p, ctx())
    expect(run.status).toBe(OBJECT_STATUS.OK)
    expect(cellKeys(run)).toEqual([])
  })

  it('⛔⛔ AND `Infinity` IS THE ONE THAT HANGS — it must not spin', () => {
    // ⚰ A MUTATION FOUND THIS. The NaN case above passes with the finiteness
    // guard DELETED, because every `n <= NaN` comparison is false and the body
    // never runs — JavaScript happens to do the right thing. `Infinity` does
    // not: `n <= Infinity` is always true, so without the guard this is an
    // unbounded loop stopped only by the ops envelope, on every bar.
    const p = loopProgram({ v: 'const', value: 0 }, { v: 'const', value: Infinity })
    const run = evaluateObjects(p, ctx())
    expect(run.status).toBe(OBJECT_STATUS.OK)
    expect(cellKeys(run)).toEqual([])
    expect(run.stats.opsExecuted).toBeLessThan(50)
  })

  it('⛔⛔ AN UNBOUND COUNTER IS `undefined`, NOT ROW ZERO', () => {
    // A body naming a counter its loop does not declare would otherwise write
    // row 0 every iteration — one row where the author wrote forty, with
    // nothing anywhere saying so.
    const p = loopProgram({ v: 'const', value: 0 }, { v: 'const', value: 3 },
      [{
        k: 'cell',
        target: { r: 'reg', id: 'r0' },
        col: { v: 'const', value: 0 },
        row: { v: 'loop', id: 'j' },          // declared nowhere
        props: { text: { v: 'text', node: { t: 'lit', s: 'x' } } },
      }])
    const keys = cellKeys(evaluateObjects(p, ctx()))
    expect(keys).not.toEqual(['0,0'])
  })

  it('⛔ the ops envelope stops a runaway, and stops the whole BAR', () => {
    const p = loopProgram({ v: 'const', value: 0 }, { v: 'const', value: 100000 })
    const run = evaluateObjects(p, { ...ctx(), limits: { opsPerBar: 50 } })
    expect(run.status).toBe(OBJECT_STATUS.LIMIT_EXCEEDED)
    expect(String(run.reason)).toMatch(/object operations/)
    // ⚰ AND IT ACTUALLY STOPS. A mutation that dropped the loop's own break
    // left this green on the STATUS alone — `fail()` latches once, so the
    // verdict was identical while the loop went on spinning a hundred thousand
    // times per bar. Reporting a runaway is not the same as ending one, and the
    // work done is the only thing that can tell them apart.
    expect(run.stats.opsExecuted).toBeLessThan(500)
  })
})

describe('⛔ the program validator descends into a loop body', () => {
  it('a malformed op INSIDE a loop is a build error', () => {
    // ⚰️ Both validation passes used `ops.entries()`, which sees a loop op and
    // nothing inside it — so every malformed op in a body would have reached
    // the runtime unvalidated, which is the one thing that function prevents.
    const p = loopProgram({ v: 'const', value: 0 }, { v: 'const', value: 1 },
      [{ k: 'nonsense' }])
    expect(() => assertObjectProgram(p)).toThrow(/unknown operation/)
  })

  it('⭐ and the failure names the PATH, not an index', () => {
    const p = loopProgram({ v: 'const', value: 0 }, { v: 'const', value: 1 },
      [{ k: 'nonsense' }])
    expect(() => assertObjectProgram(p)).toThrow(/ops\[1\]\.body\[0\]/)
  })

  it('a loop without a body, or with an empty one, is refused', () => {
    const base = loopProgram({ v: 'const', value: 0 }, { v: 'const', value: 1 })
    const noBody = { ...base, ops: [base.ops[0], { ...base.ops[1], body: undefined }] }
    const empty = { ...base, ops: [base.ops[0], { ...base.ops[1], body: [] }] }
    expect(() => assertObjectProgram(noBody)).toThrow(/body array/)
    expect(() => assertObjectProgram(empty)).toThrow(/draws nothing/)
  })

  it('a loop counter with no id is refused', () => {
    const base = loopProgram({ v: 'const', value: 0 }, { v: 'const', value: 1 })
    const bad = { ...base, ops: [base.ops[0], { ...base.ops[1], id: '' }] }
    expect(() => assertObjectProgram(bad)).toThrow(/counter id/)
  })
})
