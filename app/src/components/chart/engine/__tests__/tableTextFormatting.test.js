// app/src/components/chart/engine/__tests__/tableTextFormatting.test.js
//
// ─── ⭐⭐ GAP 1 — `text_formatting` WAS DROPPED WITHOUT A WORD ───────────────
//
// A member's imported dashboard is mostly a table, and the one thing a table
// does to separate a HEADER row from a data row is set it bold. Pine says that
// with `text_formatting = text.format_bold`, and until this file existed the
// whole wire lost it in silence, at four separate places:
//
//   1. `pineObjects.CELL_POSITIONAL` did not name it, so a positional write
//      could not reach it at all;
//   2. `objectProgram.CELL_PROPS` did not list it, so
//   3. `pine.js`'s cell pass hit `if (!OBJECT_CELL_PROPS.includes(k)) continue`
//      — a bare `continue`, which is the silent drop itself: no count, no name,
//      no line number, nothing an engineer could have grepped for;
//   4. and `objectTableDom.js` contained no `fontWeight` at all, so even a
//      carried value would have painted the same as no value.
//
// ⛔⛔ SO THE ASSERTIONS BELOW WALK ALL FOUR, NOT ONE. Every earlier table wave
// in this repo has been bitten by the same shape — `memberPaneTables.test.js`
// exists because six layers were each green on their own while a member's chart
// showed ZERO tables — and a unit test on `CELL_PROPS` would have passed for a
// build whose `<td>` was still unbolded.
//
// ⭐ PINE'S OWN SEMANTICS, CHECKED RATHER THAN GUESSED — from this repo's
// vendor-derived extraction, not from memory:
//
//   * `docs/pine/pine-v6-constants.md:24` — the `text.*` namespace holds exactly
//     three formatting values: `text.format_none`, `text.format_bold`,
//     `text.format_italic`.
//   * `docs/pine/pine-v6-constants.md:187` — "`text.align_*` / `text.wrap_*` are
//     `const string`, but `text.format_*` is `const text_format` … Only
//     `text_format` supports `+` arithmetic (`text.format_bold +
//     text.format_italic`)." ⛔ So the combination operator is `+`, NOT a
//     bitwise `|` — Pine v6 has no bitwise operators at all, and a reader
//     written for `|` would have matched nothing in any real script.
//   * `docs/pine/pine-presentation-spec.md:1605,1624` — `text_formatting` is
//     `table.cell()`'s FOURTEENTH parameter and its default is
//     `text.format_none`, which is why an absent value is not a diagnostic.
import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { translatePine } from '../ast/pine'
import { bindObjectProgram } from '../ast/objectProgram'
import { interpret } from '../ast/interpret'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import { layoutTables } from '../objectCanvas'
import { renderTables } from '../objectTableDom'

const N = 60
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1_700_000_000 + i * 86400,
  o: 100 + Math.sin(i / 7) * 5,
  h: 106 + Math.sin(i / 7) * 5,
  l: 94 + Math.sin(i / 7) * 5,
  c: 100 + Math.sin(i / 5) * 9,
  v: 1_000_000 + (i % 11) * 50_000,
}))

const dom = new JSDOM('<!doctype html><body></body>')
const doc = dom.window.document

/** Pine text → every layer the value has to survive, with none of them mocked.
 *
 *  ⛔ THE BIND IS NOT OPTIONAL. A translator emits `{v:'tree', i}` against its
 *  own `trees`; the runtime only knows `{v:'graph', node}`. Identity-binding
 *  (tree index → node index) is the smallest honest stand-in for what
 *  `toGraphDocument` does for real, and skipping it makes every guard read
 *  `undefined` — eleven tests failing identically, which is at least a legible
 *  kind of wrong. */
function wire(src) {
  const t = translatePine(src)
  const program = t.objects
  if (!program) return { t, program: null, run: null, state: null, root: null }
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
  return { t, program, run, state, root, stats }
}

/** The `<td>` whose text is `label`, or null. ⭐ Addressed by CONTENT, not by
 *  index: a test that reads `cells[2]` goes green on a build that reordered the
 *  row, which is exactly the regression a table test must be able to see. */
const cellNamed = (root, label) => [...root.querySelectorAll('td')]
  .find((td) => td.textContent === label) || null

const SRC = `//@version=6
indicator("fmt", overlay = true)
var table t = table.new(position.top_right, 2, 2)
if barstate.islast
    table.cell(t, 0, 0, "Header", text_formatting = text.format_bold)
    table.cell(t, 1, 0, "Plain")
    table.cell(t, 0, 1, "Slanted", text_formatting = text.format_italic)
    table.cell(t, 1, 1, "Both", text_formatting = text.format_bold + text.format_italic)
plot(close)
`

describe('⭐⭐ GAP 1 — a Pine cell written BOLD reaches the member bold', () => {
  const { t, program, run, state, root } = wire(SRC)

  it('the translator CARRIES text_formatting into the object program', () => {
    expect(t.objects, t.refusal ? JSON.stringify(t.refusal) : 'no object program').toBeTruthy()
    const cells = program.ops.filter((o) => o.k === 'cell')
    expect(cells).toHaveLength(4)
    // ⭐ THE VALUE, NOT ITS PRESENCE. `toBeDefined()` would pass for a build
    // that carried `undefined` through every layer and painted nothing.
    expect(cells.map((c) => c.props.text_formatting && c.props.text_formatting.value))
      .toEqual(['bold', undefined, 'italic', 'bold_italic'])
  })

  it('⛔ and `+` really COMBINES — `bold + italic` is not silently one of them', () => {
    const both = program.ops.filter((o) => o.k === 'cell')[3]
    expect(both.props.text_formatting).toEqual({ v: 'const', value: 'bold_italic' })
  })

  it('the render state carries it to the adapter', () => {
    expect(run.status).toBe('ok')
    expect(state.tables).toHaveLength(1)
    const by = Object.fromEntries(state.tables[0].cells.map((c) => [c.text, c.text_formatting]))
    expect(by).toEqual({
      Header: 'bold', Plain: undefined, Slanted: 'italic', Both: 'bold_italic',
    })
  })

  it('⭐⭐ THE PAINTED CELL IS BOLD — the only assertion a member can see', () => {
    const td = cellNamed(root, 'Header')
    expect(td, 'no <td> was painted with the header text').toBeTruthy()
    expect(td.style.fontWeight).toBe('bold')
    expect(td.style.fontStyle).toBe('')
  })

  it('⭐ italic is its own axis, and `bold + italic` sets BOTH', () => {
    expect(cellNamed(root, 'Slanted').style.fontStyle).toBe('italic')
    expect(cellNamed(root, 'Slanted').style.fontWeight).toBe('')
    expect(cellNamed(root, 'Both').style.fontWeight).toBe('bold')
    expect(cellNamed(root, 'Both').style.fontStyle).toBe('italic')
  })

  it('⛔⛔ CONTROL — a cell with NO formatting is still drawn unbolded', () => {
    // Without this the suite passes for a renderer that bolds every cell, which
    // is a worse table than the one that bolds none: the header stops being a
    // header and nothing in the DOM says why.
    const td = cellNamed(root, 'Plain')
    expect(td, 'the unformatted cell was not drawn at all').toBeTruthy()
    expect(td.style.fontWeight).toBe('')
    expect(td.style.fontStyle).toBe('')
    // …and it is otherwise a normal cell, so "unbolded" is not "undrawn".
    expect(td.textContent).toBe('Plain')
  })
})

describe('⛔⛔ GAP 1 — what this door CANNOT carry, it NAMES', () => {
  it('⭐⭐ a text_formatting chosen at RUNTIME is CARRIED — and PAINTS both ways', () => {
    // ⚰️ THIS CASE USED TO ASSERT THE OPPOSITE, and the sentence it rested on was
    // *"the reader is deliberately CONSTANT-ONLY … a `{t:'if'}` formatting node
    // would be a second conditional vocabulary to evaluate per bar for zero
    // measured demand"*. The 2026-09-23 merge made the first half false: the
    // interception no longer `return null`s on a value it cannot fold, it falls
    // through to the `ENUM_SLOTS` reader two lines below, which returns exactly a
    // `{v:'text'}` template — *"what the object runtime already evaluates per
    // bar"*, in its own words. The second vocabulary was never added; the sibling
    // slots (`text_halign`, `text_size`, `text_color`) had been paying for it all
    // along and `text_formatting` alone was not being handed the bill.
    //
    // ⛔⛔ AND IT IS ASSERTED AT THE GLASS, IN BOTH DIRECTIONS, because this file's
    // own header is the reason: *"a unit test on `CELL_PROPS` would have passed
    // for a build whose `<td>` was still unbolded"*. A carried value that painted
    // bold unconditionally would satisfy any one-sided check and is a worse table
    // than one that carries nothing.
    const { t, root } = wire(`//@version=6
indicator("fmt2", overlay = true)
var table t = table.new(position.top_right, 1, 2)
if barstate.islast
    table.cell(t, 0, 0, "Yes", text_formatting = close > 0 ? text.format_bold : text.format_none)
    table.cell(t, 0, 1, "No", text_formatting = close < 0 ? text.format_bold : text.format_none)
plot(close)
`)
    expect(t.objectDiagnostics.droppedPropNames,
      'a format the reader CAN template is not a drop any more').toBeFalsy()
    const yes = cellNamed(root, 'Yes')
    const no = cellNamed(root, 'No')
    expect(yes, 'the true-branch cell was not drawn at all').toBeTruthy()
    expect(no, 'the false-branch cell was not drawn at all').toBeTruthy()
    expect(yes.style.fontWeight).toBe('bold')
    expect(no.style.fontWeight).toBe('')
  })

  it('⛔ a text_formatting the reader CANNOT read is still a named drop', () => {
    // ⭐ THE HALF THAT SURVIVED, AND IT IS KEPT DELIBERATELY. Widening what the
    // door carries must not quietly retire the machinery that NAMES what it
    // still cannot — that machinery is gap 1's whole subject. `close` is a
    // number, not a `text_format`, so there is no template to build and the
    // reader says so with the line an engineer has to go and look at.
    const { t } = wire(`//@version=6
indicator("fmt4", overlay = true)
var table t = table.new(position.top_right, 1, 1)
if barstate.islast
    table.cell(t, 0, 0, "X", text_formatting = close)
plot(close)
`)
    expect(t.objectDiagnostics.droppedPropNames).toContain('cell.text_formatting@5')
    // ⭐ AND IT IS COUNTED, not merely named — a visible limit, not a missing
    // feature. (`enumUnreadable` is what the fall-through added beside the name.)
    expect(t.objectDiagnostics.enumUnreadable).toBeGreaterThan(0)
    // ⛔ THE CELL ITSELF SURVIVES. Formatting is styling, not content — losing
    // the bold must not lose the number, the same rule `REQUIRED`/`CONTENT`
    // already encode for a label's caption.
    expect(t.objects.ops.filter((o) => o.k === 'cell')).toHaveLength(1)
  })

  it('⛔⛔ and a cell property OUTSIDE the vocabulary is named too — the bare `continue` is gone', () => {
    // ⚰️ `if (!OBJECT_CELL_PROPS.includes(k)) continue` was the whole of gap 1's
    // silence: `text_font_family` is a real Pine argument this door does not
    // implement, and the only record that a member had written one was that
    // their cell looked wrong. A refusal nobody can read is not a refusal.
    const { t } = wire(`//@version=6
indicator("fmt3", overlay = true)
var table t = table.new(position.top_right, 1, 1)
if barstate.islast
    table.cell(t, 0, 0, "X", text_font_family = font.family_monospace)
plot(close)
`)
    expect(t.objectDiagnostics.unsupportedProps).toContain('cell.text_font_family@5')
    expect(t.objects.ops.filter((o) => o.k === 'cell')).toHaveLength(1)
  })
})
