// app/src/components/chart/engine/ast/engine52ServeNeverDefault.test.js
//
// ⭐⭐ ENGINE 52 — SERVE, NEVER DEFAULT. Rails for the drawing lane's slice:
//   1. a v6 INT text size (typographic points) is served as that number and drawn on the
//      words' scale (`objectCanvas.js::textSizePx`, the reference's word ↔ point table);
//   2. a colour / width / count / tooltip fixed before bar 0 is read by the static reader
//      (numbers, C44 colours, C46 gradient, the script's own types, `str.*`, a bounded
//      helper loop); one it cannot read WITHHOLDS its drawing by name
//      (`pine:prop-unreadable`), never drawn at the renderer's default;
//   3. the objects-v2 grader never grades a point size as a word.
// Evidence: docs/pine/evidence/2026-11-12-engine52-serve-never-default/EVIDENCE.md
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { textSizePx, pointSizePx, TEXT_SIZE_PX, POINT_SIZE_ANCHORS } from '../objectCanvas.js'
import { ENUM_DROPS } from '../enumNaRule.js'
import { V2_NOT_GRADED } from '../../../../../../tools/vendor_harness/compare.mjs'

const HEAD = "//@version=6\nindicator('x', overlay=true)\n"
const tr = (body, opts = {}) => translatePine(HEAD + body, { strict: false, objects: true, ...opts })
const opsOf = (t) => ((t.objects || {}).ops || [])
const firstOf = (t, k, family) => opsOf(t).find((o) => o.k === k && (!family || o.family === family))
const diag = (t) => t.objectDiagnostics || {}

describe('1. v6 integer point text sizes are SERVED', () => {
  it('a literal, an input.int and a name bound to one are carried as the number (label, box, cell)', () => {
    const t = tr([
      'pt = input.int(13)',
      'var tb = table.new(position.top_right, 1, 1)',
      'if barstate.islast',
      "    table.cell(tb, 0, 0, 'a', text_size = pt)",
      "label.new(bar_index, close, 'x', size = 14)",
      "box.new(bar_index, high, bar_index + 1, low, text = 'b', text_size = 9)",
    ].join('\n'))
    expect(firstOf(t, 'cell').props.text_size).toEqual({ v: 'const', value: 13 })
    expect(firstOf(t, 'create', 'label').props.size).toEqual({ v: 'const', value: 14 })
    expect(firstOf(t, 'create', 'box').props.text_size).toEqual({ v: 'const', value: 9 })
    expect(diag(t).dropReasons && diag(t).dropReasons['enum:points']).toBeUndefined()
  })

  it('an int equal to a word\'s stated size is drawn EXACTLY as that word (reference table)', () => {
    for (const w of ['tiny', 'small', 'normal', 'large', 'huge']) {
      expect(textSizePx(POINT_SIZE_ANCHORS.label[w], 'label')).toBeCloseTo(TEXT_SIZE_PX[w], 9)
      expect(textSizePx(POINT_SIZE_ANCHORS.boxTable[w], 'boxTable')).toBeCloseTo(TEXT_SIZE_PX[w], 9)
    }
    // the two tables are not crossed: 14 points is `normal` in a table, past it on a label
    expect(textSizePx(14, 'boxTable')).toBe(TEXT_SIZE_PX.normal)
    expect(textSizePx(14, 'label')).toBeGreaterThan(TEXT_SIZE_PX.normal)
  })

  it('between anchors it is linear, past `huge` proportional, 0 is auto; words unchanged', () => {
    expect(pointSizePx(11, 'boxTable')).toBeCloseTo((TEXT_SIZE_PX.small + TEXT_SIZE_PX.normal) / 2 - 0.5 * (TEXT_SIZE_PX.normal - TEXT_SIZE_PX.small) / 2, 9)
    expect(pointSizePx(48, 'label')).toBeCloseTo(TEXT_SIZE_PX.huge * 2, 9)
    expect(textSizePx(0, 'label')).toBe(TEXT_SIZE_PX.auto)
    expect(textSizePx('large', 'label')).toBe(TEXT_SIZE_PX.large)
    const ladder = [1, 5, 8, 9, 10, 12, 14, 17, 20, 30, 36, 50].map((p) => pointSizePx(p, 'boxTable'))
    for (let i = 1; i < ladder.length; i += 1) expect(ladder[i]).toBeGreaterThan(ladder[i - 1])
  })

  it('the v2 grader never grades a point size as a word', () => {
    expect(V2_NOT_GRADED.has('pointSize')).toBe(true)
  })
})

describe('2. a value fixed before bar 0 is SERVED by the static reader', () => {
  it('a `var` transparency inside an input.color default (ict-killzones) is that colour', () => {
    const t = tr([
      'var dt = 60',
      'c1 = input.color(color.new(color.blue, dt))',
      'var tb = table.new(position.top_right, 1, 1)',
      'if barstate.islast',
      "    table.cell(tb, 0, 0, 'a', bgcolor = c1)",
    ].join('\n'))
    expect(firstOf(t, 'cell').props.bgcolor).toEqual({ v: 'color', node: { c: 'lit', hex: '#2962FF66' } })
  })

  it('color.rgb with a transparency, and color.from_gradient over constants (C44, C46)', () => {
    const t = tr([
      'lo = 0',
      'g = color.from_gradient(5, lo, 10, color.rgb(0, 0, 0), color.rgb(255, 255, 255))',
      "label.new(bar_index, close, 'x', textcolor = color.rgb(10, 20, 30, 50), color = g)",
    ].join('\n'))
    const p = firstOf(t, 'create', 'label').props
    expect(p.textcolor).toEqual({ v: 'color', node: { c: 'lit', hex: '#0A141E80' } })
    // the gradient keeps the colour reader's own node (`{c:'grad'}`, the runtime's measured
    // blend), which answers first; the static reader is asked only when nothing else read it
    expect(['grad', 'lit']).toContain(p.color.node.c)
  })

  it('a field of the script\'s own type, built by a helper over an input (multicator-table)', () => {
    const t = tr([
      'type TP',
      '    color frame',
      '    color bull',
      'mk(bool dark) =>',
      '    TP.new(',
      '         dark ? color.new(#00f3ff, 20) : color.new(#0b4f6c, 0),',
      '         dark ? color.new(#00ff9c, 35) : color.new(#c8f7d6, 0))',
      "themeName = input.string('Dark', 'Theme', options = ['Dark', 'Light'])",
      "theme = mk(themeName == 'Dark')",
      'var tb = table.new(position.top_right, 1, 1, border_color = theme.frame)',
      'if barstate.islast',
      "    table.cell(tb, 0, 0, 'a', bgcolor = close > open ? theme.bull : theme.frame)",
    ].join('\n'))
    expect(firstOf(t, 'create', 'table').props.border_color).toEqual({ v: 'color', node: { c: 'lit', hex: '#00f3ffCC' } })
    const bg = firstOf(t, 'cell').props.bgcolor.node
    expect(bg.c).toBe('if')
    expect(bg.then).toEqual({ c: 'lit', hex: '#00ff9cA6' })
  })

  it('str.* over an input and a bounded helper loop fold to a position / size word', () => {
    const t = tr([
      'tablePos = input.string("Middle Right", "Table Location ")',
      'tableSiz = input.string("Tiny", "")',
      'locNsze(x) =>',
      '    y   = str.split(str.lower(x), " ")',
      '    out = ""',
      '    for i = 0 to array.size(y) - 1',
      '        out := out + array.get(y, i)',
      '        if i != array.size(y) - 1',
      '            out := out + "_"',
      '    out',
      'var tbl = table.new(locNsze(tablePos), 2, 3)',
      'if barstate.islast',
      '    table.cell(tbl, 0, 0, text = "a", text_size = locNsze(tableSiz), tooltip = str.upper(str.replace_all(tablePos, " ", "-")))',
    ].join('\n'))
    expect(firstOf(t, 'create', 'table').props.position).toEqual({ v: 'text', node: { t: 'lit', s: 'middle_right' } })
    const cell = firstOf(t, 'cell').props
    expect(cell.text_size).toEqual({ v: 'text', node: { t: 'lit', s: 'tiny' } })
    expect(cell.tooltip).toEqual({ v: 'text', node: { t: 'lit', s: 'MIDDLE-RIGHT' } })
  })

  it('a folded string that is not a word of the slot is NOT served as one', () => {
    const t = tr([
      'p = str.lower("SOLID")',
      'var tbl = table.new(p, 1, 1)',
      'if barstate.islast',
      '    table.cell(tbl, 0, 0, "a")',
    ].join('\n'))
    const pos = firstOf(t, 'create', 'table') && firstOf(t, 'create', 'table').props.position
    expect(pos).not.toEqual({ v: 'text', node: { t: 'lit', s: 'solid' } })
  })

  it('a default reassigned in an `if` is followed like the text reader follows it', () => {
    const t = tr([
      'var tb = table.new(position.top_right, 1, 1)',
      'if barstate.islast',
      '    color c = color.gray',
      '    if close > open',
      '        c := color.green',
      "    table.cell(tb, 0, 0, 'a', text_color = c)",
    ].join('\n'))
    const cell = firstOf(t, 'cell')
    expect(cell).toBeDefined()
    expect(cell.props.text_color.v).toBe('color')
  })
})

describe('3. a property this door cannot read WITHHOLDS its drawing, never a default', () => {
  it('a cell colour chosen on the chart theme brightness (no reader follows it): the cell is withheld by name', () => {
    const t = tr([
      'var tb = table.new(position.top_right, 1, 1)',
      'isDark = color.r(chart.bg_color) < 128',
      'if barstate.islast',
      "    table.cell(tb, 0, 0, 'a', bgcolor = isDark ? #FFFFFF : #000000)",
    ].join('\n'))
    expect(firstOf(t, 'cell')).toBeUndefined()
    expect(diag(t).dropReasons[ENUM_DROPS.value.drop]).toBe(1)
    expect((diag(t).withheldPropNames || []).some((e) => e.startsWith('cell.bgcolor@'))).toBe(true)
    expect(diag(t).droppedPropNames || []).toEqual([])
  })

  it('a create whose colour cannot be read is withheld (create:… counted as prop:unreadable)', () => {
    const t = tr([
      'isDark = color.r(chart.bg_color) < 128',
      "label.new(bar_index, close, 'x', textcolor = isDark ? #FFFFFF : #000000)",
    ].join('\n'))
    expect(firstOf(t, 'create', 'label')).toBeUndefined()
    expect(diag(t).dropReasons[ENUM_DROPS.value.drop]).toBe(1)
    expect((diag(t).createDropWhy || []).some((w) => w.includes(ENUM_DROPS.value.guard))).toBe(true)
  })

  it('a cell patch whose colour cannot be read withholds its TABLE (contentLost), never keeps the old colour', () => {
    const t = tr([
      'var tb = table.new(position.top_right, 1, 1)',
      'isDark = color.r(chart.bg_color) < 128',
      'if barstate.islast',
      "    table.cell(tb, 0, 0, 'a', bgcolor = color.blue)",
      '    table.cell_set_bgcolor(tb, 0, 0, isDark ? #FFFFFF : #000000)',
    ].join('\n'))
    expect(opsOf(t).some((o) => o.k === 'cellpatch')).toBe(false)
    expect(diag(t).dropReasons[ENUM_DROPS.value.drop]).toBe(1)
  })

  it('the withhold reason is one entry of the shared table', () => {
    expect(ENUM_DROPS.value).toEqual({ guard: 'pine:prop-unreadable', drop: 'prop:unreadable', sentence: expect.any(String) })
  })
})

describe('4. the objects-v2 grader, field by field', () => {
  it('an int text size is `pointSize` (not graded); a word is still graded', async () => {
    const { fieldRow } = await import('../__tests__/vendorHarness/objectRecords.js')
    const spec = { field: 'text_size', vendor: 'ts', ours: 'text_size', kind: 'enum', codes: { normal: 'normal', small: 'small' }, default: 'auto' }
    const ctx = { D: {}, ourFamily: 'table' }
    expect(fieldRow(spec, ctx, { ts: 'normal' }, { text_size: 11 }).state).toBe('pointSize')
    expect(fieldRow(spec, ctx, { ts: 'normal' }, { text_size: 'normal' }).state).toBe('agree')
    expect(fieldRow(spec, ctx, { ts: 'normal' }, { text_size: 'small' }).state).toBe('differ')
  })
})
