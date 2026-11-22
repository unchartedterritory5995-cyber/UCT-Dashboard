// app/src/components/chart/engine/ast/engine51ObjectFixes.test.js
//
// ─── ⭐⭐ ENGINE 51 — THREE DRAWINGS TRADINGVIEW DRAWS DIFFERENTLY, EACH WITNESSED ──
//
// Found by the objects-v2 grader (`docs/pine/evidence/2026-11-12-objects-v2`), each
// on a vendor capture v1 graded MATCH:
//
//   1. a NAMED address read by position — `table.cell(t, row=1, column=0, …)` drew at
//      (1,0); TradingView (0,1). keltner-center-of-gravity-channel-{rddt,spy}.
//   2. a v4 label style the renderer did not know — `label.style_labeldown` reached it
//      as `labeldown` and drew centred, no pointer; TradingView `label_down`.
//      extrapolated-pivot-connector-{rddt,spy}.
//   3. a computed cell size dropped to the default — `text_size = get_size(input.string
//      (…))`; TradingView `small`, ours the default. ict-killzones-pivots-tfo-{rddt,spy}.
//      And the rule behind it: an enum slot this door cannot read WITHHOLDS its drawing
//      by name (`pine:enum-unreadable`), never draws a default in its place.
//
// Each rail is mutation-proved (docs/pine/evidence/2026-11-12-engine51-cell-order).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine'
import { CELL_SETTER_PROPS, placeObjectArgs } from './pineObjects'
import { OBJECT_ENUM_TABLE, OBJECT_ENUM_VALUES, LEGACY_OBJECT_ENUMS, LABEL_STYLE_WORDS } from '../objectEnums'
import { LABEL_ANCHOR } from '../objectCanvas'
import { ENUM_DROPS } from '../enumNaRule'

const T = (body, v = 6) => translatePine(`//@version=${v}\n${v >= 5 ? 'indicator' : 'study'}("e51", overlay = true)\n${body}plot(close)\n`,
  { strict: false, objects: true })
const opsOf = (t, k) => (((t.objects || {}).ops) || []).filter((o) => o.k === k)
const drops = (t) => (t.objectDiagnostics || {}).dropReasons || {}
const TABLE = 'var table t = table.new(position.top_right, 3, 3)\nvar line l = line.new(bar_index, close, bar_index + 1, close)\nif barstate.islast\n'
const at = (o) => [o.col && o.col.value, o.row && o.row.value]

describe('1 · a named address is placed by its name (keltner-center-of-gravity-channel)', () => {
  it('table.cell: every spelling of (column 0, row 1) lands at (0, 1)', () => {
    for (const call of [
      'table.cell(t, 0, 1, "x")',
      'table.cell(t, row=1, column=0, text="x")',
      'table.cell(t, column=0, row=1, text="x")',
      'table.cell(table_id=t, row=1, column=0, text="x")',
      'table.cell(row=1, table_id=t, column=0, text="x")',
      't.cell(row=1, column=0, text="x")',
    ]) {
      const t = T(`${TABLE}    ${call}\n`)
      const c = opsOf(t, 'cell')
      expect(c, call).toHaveLength(1)
      expect(at(c[0]), call).toEqual([0, 1])
    }
  })

  it('every table.cell_set_* (derived from CELL_SETTER_PROPS) places a named address', () => {
    const value = { text: '"x"', text_color: 'color.red', bgcolor: 'color.red', text_size: 'size.small',
      text_halign: 'text.align_left', text_valign: 'text.align_top', text_formatting: 'text.format_bold',
      tooltip: '"tip"', width: '5', height: '5' }
    const methods = Object.keys(CELL_SETTER_PROPS)
    expect(methods.length).toBeGreaterThan(5)
    for (const m of methods) {
      const prop = CELL_SETTER_PROPS[m]
      const t = T(`${TABLE}    table.${m}(t, row=1, column=0, ${prop}=${value[prop]})\n`)
      const c = opsOf(t, 'cellpatch')
      expect(c, m).toHaveLength(1)
      expect(at(c[0]), m).toEqual([0, 1])
      expect(Object.keys(c[0].props), m).toEqual([prop])
    }
  })

  it('table.clear and table.merge_cells take a named handle and named bounds', () => {
    const cl = opsOf(T(`${TABLE}    table.clear(table_id=t, start_row=1, start_column=0)\n`), 'clearcells')
    expect(cl).toHaveLength(1)
    expect([cl[0].col.value, cl[0].row.value, cl[0].col2.value, cl[0].row2.value]).toEqual([0, 1, 0, 1])
    const mg = opsOf(T(`${TABLE}    table.merge_cells(table_id=t, start_row=0, end_row=2, start_column=1, end_column=2)\n`), 'mergecells')
    expect(mg).toHaveLength(1)
    expect([mg[0].col.value, mg[0].row.value, mg[0].col2.value, mg[0].row2.value]).toEqual([1, 0, 2, 2])
  })

  it('a setter and a delete take a named `id`; a multi-property setter its Pine names', () => {
    const up = opsOf(T(`${TABLE}    line.set_xy1(y=high, id=l, x=bar_index - 5)\n`), 'update')
    expect(up).toHaveLength(1)
    expect(Object.keys(up[0].props)).toEqual(['x1', 'y1'])
    expect(up[0].props.y1).toEqual(opsOf(T(`${TABLE}    line.set_xy1(l, bar_index - 5, high)\n`), 'update')[0].props.y1)
    expect(opsOf(T(`${TABLE}    line.delete(id=l)\n`), 'delete')).toHaveLength(1)
  })

  it('a getter takes a named `id` (line.get_y2(id=l) is line.get_y2(l))', () => {
    const lab = (g) => opsOf(T(`${TABLE}    label.new(bar_index, ${g}, "x")\n`), 'create').filter((o) => o.family === 'label')
    const pos = lab('line.get_y2(l)')
    const named = lab('line.get_y2(id=l)')
    expect(pos).toHaveLength(1)
    expect(pos[0].props.y.v).toBe('get')
    expect(named).toHaveLength(1)
    expect(named[0].props.y).toEqual(pos[0].props.y)
  })

  it('a call Pine would not place is refused by name, never read by position', () => {
    for (const call of ['table.cell(t, colum=0, row=1, text="x")', 'table.cell(t, column=0, 1, "x")', 'table.cell(t, 0, column=1, row=1)']) {
      const t = T(`${TABLE}    ${call}\n`)
      expect(opsOf(t, 'cell'), call).toHaveLength(0)
      expect((t.objectDiagnostics.unsupported || []).some((u) => u.startsWith('table.cell(')), call).toBe(true)
    }
    expect(placeObjectArgs('table', 'cell', null, [{ name: 'row', value: 1 }]).refused).toMatch(/table_id/)
  })
})

describe('2 · every enum constant the reference lists has its word; legacy spellings by witness (extrapolated-pivot-connector)', () => {
  // ⭐ READ, NOT RETYPED: the reference extraction's namespace rows.
  const doc = fs.readFileSync(path.resolve(process.cwd(), '..', 'docs', 'pine', 'pine-v6-constants.md'), 'utf8')
  const listed = (ns) => {
    const row = doc.split(/\r?\n/).find((l) => l.startsWith(`| \`${ns}\` |`))
    return row ? [...row.matchAll(/`([a-z]+\.[a-z_]+)`/g)].map((m) => m[1]).filter((c) => c.startsWith(`${ns}.`)) : []
  }

  it('each namespace the table holds: every constant the reference lists maps to a word', () => {
    for (const ns of Object.keys(OBJECT_ENUM_TABLE)) {
      const consts = listed(ns)
      expect(consts.length, `${ns}: no reference row read`).toBeGreaterThan(1)
      for (const c of consts) {
        // `line.new`'s namespace also holds `line.all` etc. in other tables; this row is the constants'
        expect(OBJECT_ENUM_VALUES[c], c).toBeTypeOf('string')
      }
      expect(Object.keys(OBJECT_ENUM_TABLE[ns]).length, `${ns}: holds more than the reference lists`).toBe(consts.length)
    }
  })

  it('the renderer knows every label word the translator can carry, and nothing else', () => {
    expect([...LABEL_STYLE_WORDS].sort()).toEqual(Object.keys(LABEL_ANCHOR).sort())
  })

  it('label.style_labeldown / labelup (v4) are label_down / label_up, as TradingView records them', () => {
    for (const [legacy, v6] of Object.entries(LEGACY_OBJECT_ENUMS)) {
      const c = opsOf(T(`if barstate.islast\n    label.new(bar_index, close, "x", style=${legacy})\n`, 4), 'create')
      expect(c, legacy).toHaveLength(1)
      expect(c[0].props.style, legacy).toEqual({ v: 'const', value: OBJECT_ENUM_VALUES[v6] })
    }
    expect(OBJECT_ENUM_VALUES['label.style_labeldown']).toBe('label_down')
  })

  it('a constant the table does not hold withholds the drawing by name (never a default)', () => {
    for (const bad of ['label.style_foo', 'box.style_dashed']) {
      const t = T(`if barstate.islast\n    label.new(bar_index, close, "x", style=${bad})\n`)
      expect(opsOf(t, 'create'), bad).toHaveLength(0)
      expect(drops(t)[ENUM_DROPS.unreadable.drop], bad).toBe(1)
    }
  })
})

describe('3 · a computed cell size is carried, or the cell is withheld (ict-killzones-pivots-tfo)', () => {
  const OPTS = "options = ['Auto', 'Tiny', 'Small', 'Normal', 'Large', 'Huge']"
  const HELPER = "get_size(x) =>\n    result = switch x\n        'Auto' => size.auto\n        'Tiny' => size.tiny\n        'Small' => size.small\n        'Normal' => size.normal\n        'Large' => size.large\n        'Huge' => size.huge\n"
  it('text_size = get_size(input.string("Small", …)) is the word `small`, not the default', () => {
    const t = T(`${HELPER}ds = get_size(input.string('Small', "", ${OPTS}))\n${TABLE}    table.cell(t, 0, 0, "x", text_size = ds)\n`)
    const c = opsOf(t, 'cell')
    expect(c).toHaveLength(1)
    expect(c[0].props.text_size && c[0].props.text_size.v).toBe('text')
    expect(JSON.stringify(c[0].props.text_size)).toContain('"s":"small"')
    expect(t.objectDiagnostics.enumUnreadable || 0).toBe(0)
  })

  it('the same helper on a value only the bar knows (`timeframe.period`) is carried as the per-bar choice', () => {
    // ⭐ The text reader's `objectLane` door: the static reader (review of #1149) settles a
    // helper called on inputs before bar 0; this one is read where the op runs.
    const t = T(`get_size(x) =>\n    result = switch x\n        'D' => size.small\n        => size.large\n${TABLE}    table.cell(t, 0, 0, "x", text_size = get_size(timeframe.period))\n`)
    const c = opsOf(t, 'cell')
    expect(c).toHaveLength(1)
    expect(JSON.stringify(c[0].props.text_size)).toContain('"s":"small"')
    expect(JSON.stringify(c[0].props.text_size)).toContain('"s":"large"')
  })

  it('a computed size this door cannot follow withholds the cell by name', () => {
    const t = T(`var sizes = array.from(size.small, size.large)\n${TABLE}    table.cell(t, 0, 0, "x", text_size = array.get(sizes, 0))\n`)
    expect(opsOf(t, 'cell')).toHaveLength(0)
    expect(drops(t)[ENUM_DROPS.unreadable.drop]).toBe(1)
  })

  it('a computed table position this door cannot follow withholds the table, never anchors it top_right', () => {
    const t = T('var ps = array.from(position.bottom_left)\nvar table t = table.new(array.get(ps, 0), 1, 1)\nif barstate.islast\n    table.cell(t, 0, 0, "x")\n')
    expect(opsOf(t, 'create').filter((o) => o.family === 'table')).toHaveLength(0)
    expect(drops(t)[ENUM_DROPS.unreadable.drop]).toBeGreaterThanOrEqual(1)
  })
})
