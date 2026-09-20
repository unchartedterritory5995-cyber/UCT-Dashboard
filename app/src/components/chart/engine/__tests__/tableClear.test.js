// app/src/components/chart/engine/__tests__/tableClear.test.js
//
// ─── ⭐⭐ GAP 2 — `table.clear` NEVER RAN, SO A SHRINKING LIST NEVER SHRANK ──
//
// ⚰️ THE ROOT CAUSE IS ONE MISSING KEY. `pineObjects.SETTER_PROPS.table` names
// six setters and no `clear`, so `emitMethod`'s last branch —
// `const props = (SETTER_PROPS[ns] || {})[method]; if (!props) { unsupported }`
// — filed every `table.clear` in the corpus under `diagnostics.unsupported` and
// emitted no operation at all. `table.delete` was the only thing that could
// remove a cell, and deleting the table is not what the author asked for.
//
// ⛔⛔ WHY IT MATTERS MORE THAN ITS 20 CALL SITES SUGGEST. The Pine idiom for a
// dashboard is "clear the block, then write today's rows":
// `strong-start-rvol-dashboard.pine:179` clears rows 1..40 and then writes as
// many rows as it has symbols. With the clear a no-op, a list that had eight
// rows yesterday and three today draws THREE FRESH ROWS OVER FIVE STALE ONES —
// and the stale five are last bar's numbers, formatted identically, with
// nothing on screen to say they are old. That is the single worst failure mode
// a table can have: not a missing number, a WRONG number that looks right.
//
// ⭐ PINE'S SEMANTICS, READ FROM THE VENDOR EXTRACTION IN THIS REPO RATHER THAN
// FROM MEMORY — `docs/pine/pine-presentation-spec.md:1685-1691` and its C117:
//
//   table.clear(table_id, start_column, start_row, end_column, end_row) → void
//
//   * "removes a rectangle of cells, `start_*` = top-left, `end_*` = bottom-right"
//   * "**`end_column` and `end_row` are optional**, defaulting to the argument
//     used for `start_column` / `start_row`" ⇒ `table.clear(t, 2, 3)` clears
//     EXACTLY cell (2,3) — so the range is INCLUSIVE at both ends, which is the
//     one thing an off-by-one here would get wrong in the quietest way.
//   * `supertrend-relative-volume-kernel-optimized-flux-charts.pine:217` writes
//     the two-argument form for real, so the defaults are not a hypothetical.
import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { translatePine } from '../ast/pine'
import { bindObjectProgram } from '../ast/objectProgram'
import { interpret } from '../ast/interpret'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import { layoutTables } from '../objectCanvas'
import { renderTables } from '../objectTableDom'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1_700_000_000 + i * 86400,
  o: 100, h: 104, l: 96, c: 100 + Math.sin(i / 5) * 4, v: 1_000_000,
}))

const dom = new JSDOM('<!doctype html><body></body>')
const doc = dom.window.document

function wire(src) {
  const t = translatePine(src)
  const program = t.objects
  if (!program) return { t, program: null, run: null, texts: [] }
  const bound = bindObjectProgram(program, (i) => i)
  const cols = program.trees.map((tree) => {
    try { return interpret(tree, BARS, {}) } catch { return null }
  })
  const run = evaluateObjects(bound, {
    barCount: N,
    readNode: (node, bar) => (cols[node] ? cols[node][bar] : NaN),
    readTime: (i) => BARS[i].t,
  })
  const state = toRenderState(run.live, { bars: BARS })
  const root = doc.createElement('div')
  doc.body.appendChild(root)
  const stats = renderTables(root, layoutTables(state), doc)
  return {
    t,
    program,
    run,
    stats,
    // ⭐ THE PAINTED STRINGS, SORTED — what is left on the member's chart after
    // the last bar. A count alone would pass for a build that cleared the wrong
    // rectangle and wrote something else into it.
    texts: [...root.querySelectorAll('td')].map((td) => td.textContent).sort(),
  }
}

/** Six cells in a 2×3 grid, written on bar 10; `tail` runs on bar 20. */
const script = (tail) => `//@version=6
indicator("clr", overlay = true)
var table t = table.new(position.top_right, 2, 3)
if bar_index == 10
    table.cell(t, 0, 0, "A0")
    table.cell(t, 1, 0, "B0")
    table.cell(t, 0, 1, "A1")
    table.cell(t, 1, 1, "B1")
    table.cell(t, 0, 2, "A2")
    table.cell(t, 1, 2, "B2")
if bar_index == 20
${tail}
plot(close)
`

const ALL = ['A0', 'A1', 'A2', 'B0', 'B1', 'B2']

describe('⛔⛔ GAP 2 — the root cause, named before it is fixed', () => {
  it('`table.clear` is no longer filed as an unsupported method', () => {
    const { t } = wire(script('    table.clear(t, 0, 1, 1, 1)'))
    expect(t.objectDiagnostics.unsupported).not.toContain('table.clear')
  })

  it('…and it emits a REAL operation, not a silently accepted no-op', () => {
    const { program } = wire(script('    table.clear(t, 0, 1, 1, 1)'))
    const clears = program.ops.filter((o) => o.k === 'clearcells')
    expect(clears).toHaveLength(1)
    // ⭐ BOTH CORNERS, CARRIED. An op that kept only the start would clear one
    // cell and look like it worked on every single-cell fixture.
    expect(clears[0].col).toEqual({ v: 'const', value: 0 })
    expect(clears[0].row).toEqual({ v: 'const', value: 1 })
    expect(clears[0].col2).toEqual({ v: 'const', value: 1 })
    expect(clears[0].row2).toEqual({ v: 'const', value: 1 })
  })

  it('⛔ CONTROL — `table.merge_cells`, its sibling in the same reference section, is STILL a named refusal', () => {
    // Without this, "unsupported no longer contains table.clear" would also pass
    // for a build that stopped reporting unsupported methods at all.
    const { t } = wire(script('    table.merge_cells(t, 0, 0, 1, 0)'))
    expect(t.objectDiagnostics.unsupported).toContain('table.merge_cells')
  })
})

describe('⭐⭐ GAP 2 — a cleared rectangle really leaves the chart', () => {
  it('⛔⛔ CONTROL FIRST — with NO clear, all six cells are still painted', () => {
    // ⭐ This is the A of the A/B. Every assertion below is a DIFFERENCE from
    // this line, so a build that painted nothing at all could not pass them by
    // accident — which is the failure mode a "the row is gone" test has.
    const { texts, stats } = wire(script('    table.cell(t, 0, 0, "A0")'))
    expect(texts).toEqual(ALL)
    expect(stats.cells).toBe(6)
  })

  it('⭐⭐ a whole row cleared is a whole row GONE, and the rows around it stay', () => {
    const { texts, run } = wire(script('    table.clear(t, 0, 1, 1, 1)'))
    expect(run.status).toBe('ok')
    expect(texts).toEqual(['A0', 'A2', 'B0', 'B2'])
    expect(run.stats.cellsCleared).toBe(2)
  })

  it('⛔ SUB-RANGE CONTROL — one column of one row, and nothing else moves', () => {
    const { texts } = wire(script('    table.clear(t, 1, 1, 1, 1)'))
    expect(texts).toEqual(['A0', 'A1', 'A2', 'B0', 'B2'])
  })

  it('⭐ the range is INCLUSIVE at BOTH ends — C117, checked as a rectangle', () => {
    // (0,0)..(1,1) is four cells, not one, not two, and not six. An exclusive
    // `end` would leave B0/A1/B1 behind; an off-by-one the other way would take
    // row 2 with it. Only the inclusive reading leaves exactly row 2.
    const { texts } = wire(script('    table.clear(t, 0, 0, 1, 1)'))
    expect(texts).toEqual(['A2', 'B2'])
  })

  it('⭐⭐ `end_*` OMITTED defaults to `start_*` — one cell, per the reference', () => {
    // `table.clear(t, 1, 1)` ⇒ exactly cell (1,1). The two-argument form is real
    // Pine that real scripts write, and a reader that required five arguments
    // would drop the whole op and silently leave every stale row in place.
    const { texts, run } = wire(script('    table.clear(t, 1, 1)'))
    expect(texts).toEqual(['A0', 'A1', 'A2', 'B0', 'B2'])
    expect(run.stats.cellsCleared).toBe(1)
  })

  it('⭐ the fully NAMED form reads the same rectangle', () => {
    // `03-rsi-directional-momentum-scanner.pine:733` writes exactly this, and a
    // positional-only reader would take `table_id` for a start column.
    const { texts } = wire(script(
      '    table.clear(table_id = t, start_column = 0, start_row = 0, end_column = 1, end_row = 0)',
    ))
    expect(texts).toEqual(['A1', 'A2', 'B1', 'B2'])
  })
})

describe('⛔⛔ GAP 2 — a COMPUTED corner binds like every other value', () => {
  it('an end column that is a SERIES expression still clears the right cells', () => {
    // ⚠️ THIS IS THE WALKER TEST, AND IT IS WHY THE FIELD LIST IS SHARED.
    // `graphNodesReferenced`, `treeRefsReferenced`, `paramsReferenced` and
    // `bindObjectProgram` each enumerated an op's value-bearing fields BY HAND,
    // four times. Adding `col2`/`row2` to three of the four and forgetting the
    // fourth leaves `{v:'tree'}` in a bound program: the runtime reads
    // `undefined`, `Number(undefined)` is `NaN`, the range is rejected and the
    // clear silently does nothing — green everywhere, dead on the chart.
    // `smart-money-volume-activity-algoalpha.pine:244` writes
    // `table.clear(plTable, 0, 0, cols - 1, rows - 1)`, so a computed corner is
    // the corpus's habit and not an invented case.
    const { texts, run } = wire(script(
      '    table.clear(t, 0, 0, close > 0 ? 1 : 0, 0)',
    ))
    expect(run.status).toBe('ok')
    expect(texts).toEqual(['A1', 'A2', 'B1', 'B2'])
  })
})

describe('⚠️ GAP 2 — the corner Pine does not document, ruled conservatively', () => {
  it('an INVERTED rectangle clears NOTHING rather than guessing at a swap', () => {
    // ⛔ UNVERIFIED IN THE REFERENCE, AND LABELLED AS SUCH. The spec says
    // `start_*` is the top-left and `end_*` the bottom-right; it does not say
    // what TradingView does when an author inverts them. `box` normalises
    // top/bottom because Pine documents that it draws the same box either way —
    // there is no such sentence here, so normalising would be inventing one.
    // Clearing nothing is the direction that cannot destroy a cell the author
    // still wanted, and it is what the map walk does naturally.
    const { texts } = wire(script('    table.clear(t, 1, 2, 0, 0)'))
    expect(texts).toEqual(ALL)
  })
})
