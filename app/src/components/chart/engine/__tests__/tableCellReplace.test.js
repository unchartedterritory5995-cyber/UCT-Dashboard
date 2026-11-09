// app/src/components/chart/engine/__tests__/tableCellReplace.test.js
//
// ─── ⭐⭐ DIV-3 — `table.cell` IS A REPLACE, NOT A MERGE ───────────────────────
//
// THE REFERENCE, verbatim (`pine_v6_reference.json`, functions › `table.cell`,
// remarks[1]):
//
//   > "Each table.cell() call overwrites all previously defined properties of a
//   > cell. If you call table.cell() twice in a row, e.g., the first time with
//   > text='Test Text', and the second time with text_color=color.red but without
//   > a new text argument, the default value of the 'text' being an empty string,
//   > it will overwrite 'Test Text', and your cell will display an empty string.
//   > If you want, instead, to modify any of the cell's properties, use the
//   > table.cell_set_*() functions."
//
// and its args: `text` "Optional. The default is empty string."; `bgcolor`
// "Optional. The default is no color."
//
// ⚰️ The object lane did `map.set(key, resolveProps(op.props, map.get(key) || {}))`:
// every `table.cell` was a PATCH, so the reference's own example kept 'Test Text'.
// The runtime lane already replaced (`runtime/objectStore.js`, kind `cell`), so the
// two lanes drew the same script differently. ⭐ r1: ONE rule, in ONE place —
// `objectCells.js::writeCell` — and both lanes call it; every case below runs BOTH
// lanes and asserts they draw the same cells.
//
// ⛔⛔ WHAT IS NOT DECIDED, WITHHELD BY NAME: a `table.cell` on a MERGED head cell.
// The reference lists the properties `table.cell` overwrites; the span
// `table.merge_cells` set is not one of them, and nothing says whether a later
// `table.cell` keeps or undoes it. The host lane kept it, the runtime lane dropped
// it — two guesses. Both lanes now withhold the tables under `MERGED_HEAD_REWRITE`
// with a member sentence, until the queued probes settle it
// (`docs/pine/capture-queue-2026-11-09-div3-merged-head.md`, Q-DIV3-1 / Q-DIV3-2).
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'
import { bindObjectProgram } from '../ast/objectProgram'
import { interpret } from '../ast/interpret'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import { buildRuntimeIr } from '../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'
import { MERGED_HEAD_REWRITE, MERGED_HEAD_REWRITE_SENTENCE } from '../objectCells.js'

const N = 30
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1_700_000_000 + i * 86400,
  o: 100, h: 104, l: 96, c: 100 + Math.sin(i / 5) * 4, v: 1_000_000,
}))

function wire(src) {
  const t = translatePine(src)
  const program = t.objects
  if (!program) return { t, program: null, run: null, cells: {} }
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
  const cells = {}
  for (const c of (state.tables[0] || { cells: [] }).cells) cells[`${c.col},${c.row}`] = c
  return { t, program, run, state, cells }
}

/** The runtime lane over the same bars: its own run, its own store. */
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
function runtimeWire(src) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D' })
  if (!built.ok) throw new Error(`runtime refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t),
  })
  const fin = res.objects.finish()
  const state = toRenderState(fin.live, { bars: BARS })
  return { fin, state }
}
/** ⭐ BOTH LANES DRAW THE SAME TABLE — the render state's cells, lane for lane. */
const drawnCells = (state) => state.tables.map((t) => t.cells)
function bothLanes(src) {
  const host = wire(src)
  const rt = runtimeWire(src)
  expect(drawnCells(rt.state), 'runtime lane draws what the host lane draws').toEqual(drawnCells(host.state))
  return { host, rt }
}

const script = (body) => `//@version=6
indicator("replace", overlay = true)
var table t = table.new(position.top_right, 3, 3)
if barstate.islast
${body.map((l) => `    ${l}`).join('\n')}
plot(close)
`

describe('⭐⭐ DIV-3 — a second `table.cell` on one address replaces the first', () => {
  it('⭐ the reference\'s own example: text=\'Test Text\', then text_color=color.red alone → an empty string', () => {
    const w = bothLanes(script([
      'table.cell(t, 0, 0, text = "Test Text", bgcolor = color.blue)',
      'table.cell(t, 0, 0, text_color = color.red)',
    ]))
    expect(w.host.run.status).toBe('ok')
    // the program really carries two `cell` ops at one address (non-vacuity)
    expect(w.host.program.ops.filter((o) => o.k === 'cell')).toHaveLength(2)
    const c = w.host.run.live.find((o) => o.family === 'table').cells.find((x) => x.col === 0 && x.row === 0)
    expect(c.props.text).toBeUndefined()           // `text` not passed → its default, ""
    expect(c.props.bgcolor).toBeUndefined()        // `bgcolor` not passed → "no color"
    expect(c.props.text_color).toBe('#F23645')     // the one property the second call set
    // and the drawn cell reads as Pine prints it: an empty string, red, no fill
    expect(w.host.state.tables[0].cells.find((x) => x.col === 0 && x.row === 0))
      .toMatchObject({ text: '', text_color: '#F23645', bgcolor: undefined })
  })

  it('⭐ every property the second call names is the second call\'s; every one it omits is gone', () => {
    const w = bothLanes(script([
      'table.cell(t, 1, 1, "first", text_color = #112233, bgcolor = #445566, text_size = size.large, text_halign = text.align_left)',
      'table.cell(t, 1, 1, "second", text_halign = text.align_right)',
    ]))
    const c = w.host.run.live.find((o) => o.family === 'table').cells.find((x) => x.col === 1 && x.row === 1)
    expect(c.props).toEqual({ text: 'second', text_halign: 'right' })
  })

  it('⛔ CONTROL — `cell_set_*` is still a PATCH: the properties it does not name survive', () => {
    const w = bothLanes(script([
      'table.cell(t, 0, 0, "A", text_color = #112233, bgcolor = #445566)',
      'table.cell_set_text(t, 0, 0, "B")',
    ]))
    const c = w.host.run.live.find((o) => o.family === 'table').cells.find((x) => x.col === 0 && x.row === 0)
    expect(c.props).toEqual({ text: 'B', text_color: '#112233', bgcolor: '#445566' })
  })

  it('⛔ CONTROL — a different address is untouched by the replace', () => {
    const w = bothLanes(script([
      'table.cell(t, 0, 0, "keep", bgcolor = #445566)',
      'table.cell(t, 1, 0, "x", bgcolor = #778899)',
      'table.cell(t, 1, 0, "y")',
    ]))
    const cells = w.host.run.live.find((o) => o.family === 'table').cells
    expect(cells.find((x) => x.col === 0 && x.row === 0).props).toEqual({ text: 'keep', bgcolor: '#445566' })
    expect(cells.find((x) => x.col === 1 && x.row === 0).props).toEqual({ text: 'y' })
  })

  it('⛔⛔ WITHHELD BY NAME — a `table.cell` on a MERGED head: neither lane serves a guessed span', () => {
    const src = script([
      'table.cell(t, 0, 0, "head", bgcolor = #445566)',
      'table.merge_cells(t, 0, 0, 1, 0)',
      'table.cell(t, 0, 0, "again")',
    ])
    const host = wire(src)
    expect(host.run.live.filter((o) => o.family === 'table')).toEqual([])
    expect(host.run.withheld).toEqual({ table: 1 })
    expect(host.run.withheldBy).toEqual({ [MERGED_HEAD_REWRITE]: ['table'] })
    expect(host.run.withheldWhy).toEqual({ table: MERGED_HEAD_REWRITE_SENTENCE })
    const rt = runtimeWire(src)
    expect(rt.fin.live.filter((o) => o.family === 'table')).toEqual([])
    expect(rt.fin.withheld).toEqual({ table: MERGED_HEAD_REWRITE_SENTENCE })
    // the member sentence is plain words: no guard id, no code
    expect(MERGED_HEAD_REWRITE_SENTENCE).not.toMatch(/[`_]|table\.cell|merge_cells/)
  })

  it('⛔ CONTROL — merge FIRST, then write the head ONCE: drawn, span served, both lanes', () => {
    // `table.merge_cells` on an undefined cell is the reference's own allowance
    // ("This function will merge cells, even if their properties are not yet
    // defined"); a head written by `table.cell_set_*` after the merge is a PATCH,
    // which keeps the span by definition. Neither is the unsettled case.
    const w = bothLanes(script([
      'table.merge_cells(t, 0, 0, 1, 0)',
      'table.cell_set_text(t, 0, 0, "head")',
      'table.cell(t, 2, 0, "other")',
    ]))
    expect(w.host.run.withheldBy).toBeUndefined()
    expect(w.rt.fin.withheld).toEqual({})
    expect(w.host.state.tables[0].cells.find((c) => c.col === 0 && c.row === 0))
      .toMatchObject({ text: 'head', colspan: 2 })
  })

  it('⛔ CONTROL — a write to a COVERED cell of a merge is not a head rewrite: drawn, both lanes', () => {
    const w = bothLanes(script([
      'table.cell(t, 0, 0, "head")',
      'table.merge_cells(t, 0, 0, 1, 0)',
      'table.cell(t, 1, 0, "covered")',
    ]))
    expect(w.host.run.withheldBy).toBeUndefined()
    expect(w.rt.fin.withheld).toEqual({})
    expect(w.host.state.tables[0].cells.find((c) => c.col === 0 && c.row === 0)).toMatchObject({ text: 'head', colspan: 2 })
  })

  it('⛔ CONTROL — a rewrite of a cell that is NOT a merged head is drawn (the guard is that narrow)', () => {
    const w = bothLanes(script([
      'table.merge_cells(t, 0, 1, 1, 1)',
      'table.cell(t, 2, 2, "a")',
      'table.cell(t, 2, 2, "b")',
    ]))
    expect(w.host.run.withheldBy).toBeUndefined()
    expect(w.host.state.tables[0].cells.find((c) => c.col === 2 && c.row === 2).text).toBe('b')
  })
})
