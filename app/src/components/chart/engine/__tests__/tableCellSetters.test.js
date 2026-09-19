// app/src/components/chart/engine/__tests__/tableCellSetters.test.js
//
// ─── ⭐⭐ GAP 3 — THE `cell_set_*` FAMILY NEVER EXECUTED ─────────────────────
//
// ⚰️ SAME ROOT CAUSE AS GAP 2, SAME ONE LINE. `pineObjects.SETTER_PROPS.table`
// lists six TABLE setters and no CELL setters at all, so every
// `table.cell_set_text(…)` fell through `emitMethod`'s last branch into
// `diagnostics.unsupported` and emitted nothing. A member's script could ask to
// recolour a cell on every bar and the cell never changed.
//
// ⭐ PINE'S SEMANTICS, FROM THE VENDOR EXTRACTION IN THIS REPO — and the
// distinction it draws is the whole reason this is its own operation, not a
// `table.cell` with one argument. `docs/pine/pine-presentation-spec.md:1630`
// quotes the reference verbatim:
//
//   > "**Each `table.cell()` call overwrites all previously defined properties
//   > of a cell.** … If you want, instead, to modify any of the cell's
//   > properties, use the `table.cell_set_*()` functions."
//
// and the spec's own conclusion at :1640: "`table.cell()` is a full replace with
// defaults for every unspecified field; `table.cell_set_*()` are field patches.
// **Implement them as two distinct operations. Never implement `cell()` as a
// merge.**"
//
// ⚠️⚠️ AND THIS REPO'S `cell` IS CURRENTLY A MERGE — `objectRuntime.js` does
// `map.set(key, resolveProps(op.props, map.get(key) || {}))`. That is a FOURTH
// fidelity gap, it is PRE-EXISTING, and it is deliberately not fixed here:
// changing `cell` to a true replace changes what every already-imported script
// renders and needs its own evidence. The consequence for this file is worth
// stating plainly rather than leaving for a reviewer to notice: today a patch
// and a put behave identically, so NONE of the cases below can tell them apart.
// The op kinds are kept separate anyway, because the day `cell` becomes a real
// replace is the day a `cell_set_text` modelled as a `cell` would wipe the
// colours off the row it was only supposed to relabel.
//
// ⭐ 11 setters exist; 10 are implemented. `cell_set_text_font_family` is the
// one refusal and it is NAMED, for the reason `CELL_PROPS` gives: a substituted
// typeface silently changes every column width in the table.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'
import { bindObjectProgram } from '../ast/objectProgram'
import { interpret } from '../ast/interpret'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'

const N = 40
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

/** Two fully-specified cells written on bar 10; `tail` patches on bar 20. */
const script = (tail) => `//@version=6
indicator("set", overlay = true)
var table t = table.new(position.top_right, 2, 2)
if bar_index == 10
    table.cell(t, 0, 0, "A0", text_color = #112233, bgcolor = #445566, text_size = size.large, text_halign = text.align_left, text_valign = text.align_top, text_formatting = text.format_bold)
    table.cell(t, 1, 0, "B0", text_color = #778899, bgcolor = #99AABB)
${tail ? `if bar_index == 20\n${tail}\n` : ''}plot(close)
`

/** ⭐ THE UNPATCHED RUN, COMPUTED ONCE — every assertion below is a DIFFERENCE
 *  from it, so a build that lost the whole table could not pass any of them. */
const BASE = wire(script(''))

describe('⛔⛔ GAP 3 — the root cause, named before it is fixed', () => {
  it('the cell setters are no longer filed as unsupported methods', () => {
    const { t } = wire(script('    table.cell_set_text(t, 0, 0, "PATCHED")'))
    expect(t.objectDiagnostics.unsupported).not.toContain('table.cell_set_text')
  })

  it('…and a setter emits a `cellpatch`, which is NOT a `cell`', () => {
    // ⭐ THE KIND MATTERS EVEN WHILE IT IS INDISTINGUISHABLE. Pine's `cell()` is
    // a full replace and `cell_set_*()` is a patch; folding the second into the
    // first is the shortcut this repo's own spec forbids by name.
    const { program } = wire(script('    table.cell_set_text(t, 0, 0, "PATCHED")'))
    const kinds = program.ops.map((o) => o.k)
    expect(kinds.filter((k) => k === 'cellpatch')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'cell')).toHaveLength(2)
    const patch = program.ops.find((o) => o.k === 'cellpatch')
    expect(Object.keys(patch.props)).toEqual(['text'])
  })

  it('⛔ CONTROL — `cell_set_text_font_family` is STILL a named refusal', () => {
    // Without this, "unsupported no longer contains the setters" would also
    // pass for a build that quietly accepted every `table.*` method it met.
    const { t } = wire(script('    table.cell_set_text_font_family(t, 0, 0, font.family_monospace)'))
    expect(t.objectDiagnostics.unsupported).toContain('table.cell_set_text_font_family')
  })
})

describe('⭐⭐ GAP 3 — each setter lands on its own property', () => {
  const cases = [
    ['cell_set_text', '"PATCHED"', 'text', 'PATCHED'],
    ['cell_set_text_color', '#DDEEFF', 'text_color', '#DDEEFF'],
    ['cell_set_bgcolor', '#AABBCC', 'bgcolor', '#AABBCC'],
    ['cell_set_text_size', 'size.tiny', 'text_size', 'tiny'],
    ['cell_set_text_halign', 'text.align_right', 'text_halign', 'right'],
    ['cell_set_text_valign', 'text.align_bottom', 'text_valign', 'bottom'],
    ['cell_set_text_formatting', 'text.format_italic', 'text_formatting', 'italic'],
  ]

  for (const [method, arg, prop, want] of cases) {
    it(`⭐ table.${method} writes ${prop}`, () => {
      const { run, cells } = wire(script(`    table.${method}(t, 0, 0, ${arg})`))
      expect(run.status).toBe('ok')
      expect(cells['0,0'][prop]).toBe(want)
      // ⛔⛔ AND IT REALLY MOVED. A property that already held the wanted value
      // would make this assertion pass for a setter that never ran, which is
      // the exact thing under test.
      expect(BASE.cells['0,0'][prop]).not.toBe(want)
    })
  }
})

describe('⛔⛔ GAP 3 — a patch is a patch: everything it did not name is untouched', () => {
  const { cells } = wire(script('    table.cell_set_text(t, 0, 0, "PATCHED")'))

  it('⭐⭐ the text changed and the SIX other properties did not', () => {
    expect(cells['0,0'].text).toBe('PATCHED')
    for (const prop of ['text_color', 'bgcolor', 'text_size',
      'text_halign', 'text_valign', 'text_formatting']) {
      expect(cells['0,0'][prop], prop).toBe(BASE.cells['0,0'][prop])
    }
  })

  it('⛔ CONTROL — the cell NEXT DOOR is byte-identical to the unpatched run', () => {
    // A setter that ignored its (column, row) address and wrote the whole table
    // would pass every assertion above and fail here.
    expect(cells['1,0']).toEqual(BASE.cells['1,0'])
  })
})

describe('⛔ GAP 3 — the edges, ruled rather than left to chance', () => {
  it('a setter aimed at a DELETED table is a counted no-op, never a crash', () => {
    const { run } = wire(`//@version=6
indicator("gone", overlay = true)
var table t = table.new(position.top_right, 1, 1)
if bar_index == 10
    table.cell(t, 0, 0, "A")
if bar_index == 15
    table.delete(t)
if bar_index == 20
    table.cell_set_text(t, 0, 0, "LATE")
plot(close)
`)
    expect(run.status).toBe('ok')
    expect(run.stats.writesToDeleted).toBe(1)
    expect(run.live).toHaveLength(0)
  })

  it('⚠️ OUR RULING ON AN UNVERIFIED POINT — a patch to a cell never written CREATES it', () => {
    // ⛔ THE REFERENCE DOES NOT SAY. `docs/pine/lwc5-capability-map.md:858`
    // files it as open question A7: "`table.cell_set_*` on a cell never passed
    // to `table.cell()` — create-with-defaults, or no-op?", noting that
    // `merge_cells` explicitly DOES work on undefined cells. We follow the
    // family's documented lean and create the entry, which is also what this
    // repo's own `cell` op already does with `map.get(key) || {}`. Pinned here
    // so the choice is a recorded ruling and not an accident of implementation.
    const { cells } = wire(script('    table.cell_set_text(t, 1, 1, "NEW")'))
    expect(BASE.cells['1,1']).toBeUndefined()
    expect(cells['1,1'].text).toBe('NEW')
  })

  it('⛔ a setter whose VALUE this door cannot read is a named drop, not a wrong one', () => {
    // Formatting is constant-only (see gap 1), so a computed one refuses — and
    // the REST of the cell must survive it: a patch that could not be read is a
    // property left alone, never a property blanked.
    const { t, cells } = wire(script(
      '    table.cell_set_text_formatting(t, 0, 0, close > 0 ? text.format_italic : text.format_none)',
    ))
    // ⭐ LINE 8 IS THE SETTER'S OWN LINE in the template above, not the cell's —
    // the point of a named drop is that it addresses the expression an engineer
    // has to go and look at.
    expect(t.objectDiagnostics.droppedPropNames).toContain('cell.text_formatting@8')
    expect(cells['0,0'].text_formatting).toBe(BASE.cells['0,0'].text_formatting)
    expect(cells['0,0'].text).toBe('A0')
  })
})
