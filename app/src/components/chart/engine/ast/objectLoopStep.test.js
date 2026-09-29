// app/src/components/chart/engine/ast/objectLoopStep.test.js
//
// ─── ⭐⭐ `for i = a to b by s` DRAWS EVERY s-TH ROW, IN THE DIRECTION a → b ──
//
// The object reader refused any `for … by` loop outright, because the loop op
// had no step and stepping by one would draw rows the author wrote the step to
// skip. It has a step now.
//
// ⚰️ MEASURED against TradingView (2026-09-28, NYSE:RDDT 1D): `heat-map-seasons`
// paints its 30-cell gauge with `for i = 0 to 29 by 1`; the vendor holds 31 cells
// and we held 4, the loop dropped whole.
// `docs/pine/vendor-harness/objects-triage-2026-09-28.md`, C19.
//
// ⭐ The semantics are the runtime VM's, already railed in
// `runtime/__tests__/loops.test.js`: `by` contributes only its SIZE, and the
// direction comes from the bounds.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'
import { evaluateObjects } from '../objectRuntime'
import { bindObjectProgram } from './objectProgram'

const LF = String.fromCharCode(10)
const src = (...lines) => ['//@version=5', 'indicator("t", overlay=true)',
  'var t = table.new(position.top_right, 40, 2)', ...lines].join(LF)

/** The columns of row 0 written by the loop, in the order the table holds them. */
function colsOf(body) {
  const t = translatePine(src(...body), { strict: true })
  expect(t.objects, 'no object program').toBeTruthy()
  const trees = t.objects.trees
  // Only the shapes these fixtures produce: a number, and a negated number.
  const ev = (n) => {
    if (!n) return NaN
    if (n.type === 'num') return n.value
    if (n.type === 'op' && n.name === 'u-') return -ev(n.args[0])
    return NaN
  }
  // ⭐ BOUND the way `objectReaderFor` binds a V1 document — tree i is node i —
  // so a step that is an expression (`-2` is a tree) reaches the runtime.
  const program = bindObjectProgram(t.objects, (i) => i)
  const r = evaluateObjects(program, { barCount: 1, readNode: (i) => ev(trees[i]), readTime: (i) => i })
  expect(r.status).toBe('ok')
  const table = r.live.find((o) => o.family === 'table')
  return (table.cells || []).filter((c) => c.row === 0).map((c) => c.col)
}

describe('⭐⭐ a stepped loop draws exactly the rows its step names', () => {
  it('ascending by 3', () => {
    expect(colsOf(['for i = 0 to 10 by 3', '    table.cell(t, i, 0, "x")'])).toEqual([0, 3, 6, 9])
  })

  it('descending by 3 — the direction is the bounds\', the size is the step\'s', () => {
    expect(colsOf(['for i = 9 to 0 by 3', '    table.cell(t, i, 0, "x")'])).toEqual([0, 3, 6, 9])
  })

  it('a negative step is a SIZE, not a direction (the published reference; the VM agrees)', () => {
    expect(colsOf(['for i = 1 to 7 by -2', '    table.cell(t, i, 0, "x")'])).toEqual([1, 3, 5, 7])
  })

  it('⛔ `by 0` draws NOTHING — never an endless loop, never a guessed 1', () => {
    expect(colsOf(['for i = 0 to 5 by 0', '    table.cell(t, i, 0, "x")'])).toEqual([])
  })

  it('⛔ CONTROL — the same loop WITHOUT `by` draws every row', () => {
    expect(colsOf(['for i = 0 to 10', '    table.cell(t, i, 0, "x")'])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})
