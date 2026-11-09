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
// two lanes drew the same script differently. Now one rule, the reference's.
//
// ⛔ WHAT IS NOT DECIDED HERE, BY NAME: whether a `table.cell` on a MERGED top-left
// cell un-merges it. The reference says `table.cell` overwrites the cell's
// *properties* (it lists them: text, width, height, colours, alignment, size,
// tooltip, font, formatting); the span is set by `table.merge_cells`, which is not
// one of them, and nothing says a later `table.cell` undoes it. So the object lane
// keeps the span exactly as before this change (pinned below) — not a ruling that
// TradingView keeps it, a refusal to invent one.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'
import { bindObjectProgram } from '../ast/objectProgram'
import { interpret } from '../ast/interpret'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'

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

const script = (body) => `//@version=6
indicator("replace", overlay = true)
var table t = table.new(position.top_right, 3, 3)
if barstate.islast
${body.map((l) => `    ${l}`).join('\n')}
plot(close)
`

describe('⭐⭐ DIV-3 — a second `table.cell` on one address replaces the first', () => {
  it('⭐ the reference\'s own example: text=\'Test Text\', then text_color=color.red alone → an empty string', () => {
    const w = wire(script([
      'table.cell(t, 0, 0, text = "Test Text", bgcolor = color.blue)',
      'table.cell(t, 0, 0, text_color = color.red)',
    ]))
    expect(w.run.status).toBe('ok')
    // the program really carries two `cell` ops at one address (non-vacuity)
    expect(w.program.ops.filter((o) => o.k === 'cell')).toHaveLength(2)
    const c = w.run.live.find((o) => o.family === 'table').cells.find((x) => x.col === 0 && x.row === 0)
    expect(c.props.text).toBeUndefined()           // `text` not passed → its default, ""
    expect(c.props.bgcolor).toBeUndefined()        // `bgcolor` not passed → "no color"
    expect(c.props.text_color).toBe('#F23645')     // the one property the second call set
    // and the drawn cell reads as Pine prints it: an empty string, red, no fill
    expect(w.state.tables[0].cells.find((x) => x.col === 0 && x.row === 0))
      .toMatchObject({ text: '', text_color: '#F23645', bgcolor: undefined })
  })

  it('⭐ every property the second call names is the second call\'s; every one it omits is gone', () => {
    const w = wire(script([
      'table.cell(t, 1, 1, "first", text_color = #112233, bgcolor = #445566, text_size = size.large, text_halign = text.align_left)',
      'table.cell(t, 1, 1, "second", text_halign = text.align_right)',
    ]))
    const c = w.run.live.find((o) => o.family === 'table').cells.find((x) => x.col === 1 && x.row === 1)
    expect(c.props).toEqual({ text: 'second', text_halign: 'right' })
  })

  it('⛔ CONTROL — `cell_set_*` is still a PATCH: the properties it does not name survive', () => {
    const w = wire(script([
      'table.cell(t, 0, 0, "A", text_color = #112233, bgcolor = #445566)',
      'table.cell_set_text(t, 0, 0, "B")',
    ]))
    const c = w.run.live.find((o) => o.family === 'table').cells.find((x) => x.col === 0 && x.row === 0)
    expect(c.props).toEqual({ text: 'B', text_color: '#112233', bgcolor: '#445566' })
  })

  it('⛔ CONTROL — a different address is untouched by the replace', () => {
    const w = wire(script([
      'table.cell(t, 0, 0, "keep", bgcolor = #445566)',
      'table.cell(t, 1, 0, "x", bgcolor = #778899)',
      'table.cell(t, 1, 0, "y")',
    ]))
    const cells = w.run.live.find((o) => o.family === 'table').cells
    expect(cells.find((x) => x.col === 0 && x.row === 0).props).toEqual({ text: 'keep', bgcolor: '#445566' })
    expect(cells.find((x) => x.col === 1 && x.row === 0).props).toEqual({ text: 'y' })
  })

  it('⛔ NOT DECIDED (span) — a `table.cell` on a merged head keeps the span `merge_cells` set', () => {
    const w = wire(script([
      'table.cell(t, 0, 0, "head", bgcolor = #445566)',
      'table.merge_cells(t, 0, 0, 1, 0)',
      'table.cell(t, 0, 0, "again")',
    ]))
    const head = w.run.live.find((o) => o.family === 'table').cells.find((x) => x.col === 0 && x.row === 0)
    expect(head.props).toEqual({ text: 'again', colspan: 2, rowspan: 1 })
  })
})
