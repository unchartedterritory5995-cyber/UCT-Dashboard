// app/src/components/chart/engine/ast/cellPositionalOrder.test.js
//
// ─── ⭐⭐ ENGINE 51 — `table.cell` READS ITS POSITIONAL ARGUMENTS IN PINE'S ORDER ──
//
// The Pine v4-v6 reference signature is
//
//   table.cell(table_id, column, row, text, width, height, text_color,
//              text_halign, text_valign, text_size, bgcolor, tooltip,
//              text_font_family, text_formatting)
//
// Until engine 51 the host lane's `CELL_POSITIONAL` listed `bgcolor, tooltip,
// text_size` after `text_valign`. A cell written with seven or more positional
// arguments after the address therefore read its size as a colour, its colour as
// a tooltip and its tooltip as a size, while the same call written with names
// was read correctly. The runtime lane (`objectStore.js`) always had Pine's order.
//
// Two rails, each mutation-proved (docs/pine/evidence/2026-11-12-engine51-cell-order):
//
//   1. CROSS-LANE. `CELL_POSITIONAL` is derived from the runtime lane's own
//      `table.cell` signature (`OBJECT_OPS['table.cell'].params` after the
//      address), never restated, so neither lane can move alone again. The cell
//      setters are railed the same way, property by property.
//   2. ONE CELL, TWO SPELLINGS. A positional cell and the same cell written with
//      names translate to the same program, with the values pinned so the fixture
//      can tell the old order from the new one.
import { describe, it, expect } from 'vitest'

import { translatePine } from './pine'
import { CELL_POSITIONAL, CELL_SETTER_PROPS } from './pineObjects'
import { OBJECT_OPS } from '../runtime/objectStore'

const ADDRESS = ['table_id', 'column', 'row']

const head = `//@version=6
indicator("cell order", overlay = true)
var table t = table.new(position.top_right, 2, 2)
if barstate.islast
`
const T = (line) => translatePine(`${head}    ${line}\nplot(close)\n`, { strict: true, objects: true })
const cellsOf = (t) => (((t.objects || {}).ops) || []).filter((o) => o.k === 'cell')
const diag = (t) => t.objectDiagnostics || {}

describe('rail 1 — the host lane reads table.cell in the runtime lane\'s order (derived, not restated)', () => {
  const runtime = OBJECT_OPS['table.cell']

  it('the runtime signature opens with the three-argument address', () => {
    expect(runtime, 'objectStore has no table.cell op').toBeTruthy()
    expect(runtime.params.slice(0, ADDRESS.length)).toEqual(ADDRESS)
  })

  it('CELL_POSITIONAL is the runtime signature after the address, slot for slot', () => {
    const rest = runtime.params.slice(ADDRESS.length)
    expect(CELL_POSITIONAL.length).toBe(rest.length)
    rest.forEach((name, i) => {
      expect(CELL_POSITIONAL[i], `positional slot ${i} after the address`).toBe(name)
    })
  })

  it('every host cell setter writes the property the runtime lane\'s setter of that name writes', () => {
    const names = Object.keys(CELL_SETTER_PROPS)
    expect(names.length).toBeGreaterThan(0)
    for (const m of names) {
      const op = OBJECT_OPS[`table.${m}`]
      expect(op, `runtime lane has no table.${m}`).toBeTruthy()
      expect(op.params.slice(0, ADDRESS.length)).toEqual(ADDRESS)
      expect(op.prop, `table.${m}`).toBe(CELL_SETTER_PROPS[m])
    }
  })
})

/** The cell op's props as plain data (the program carries no line numbers on a cell). */
const propsOf = (t) => {
  const c = cellsOf(t)
  expect(c, JSON.stringify(diag(t).dropReasons || {})).toHaveLength(1)
  return JSON.parse(JSON.stringify(c[0].props))
}

describe('rail 2 — a positional cell and the same cell written with names are one cell', () => {
  // Eleven arguments after the address: every slot through `text_formatting`.
  const POS11 = 'table.cell(t, 0, 0, "Hi", 0, 0, color.white, text.align_left, text.align_top, '
    + 'size.small, color.red, "tip", font.family_default, text.format_bold)'
  const NAMED11 = 'table.cell(t, 0, 0, text = "Hi", width = 0, height = 0, text_color = color.white, '
    + 'text_halign = text.align_left, text_valign = text.align_top, text_size = size.small, '
    + 'bgcolor = color.red, tooltip = "tip", text_font_family = font.family_default, '
    + 'text_formatting = text.format_bold)'
  // Eight after the address: the shortest call that reaches both moved colour slots.
  const POS8 = 'table.cell(t, 1, 0, "Lo", 0, 0, color.black, text.align_right, text.align_bottom, '
    + 'size.large, color.yellow)'
  const NAMED8 = 'table.cell(t, 1, 0, text = "Lo", width = 0, height = 0, text_color = color.black, '
    + 'text_halign = text.align_right, text_valign = text.align_bottom, text_size = size.large, '
    + 'bgcolor = color.yellow)'
  // The method spelling drops the handle, so its address is two arguments.
  const METHOD10 = 't.cell(0, 1, "M", 0, 0, color.white, text.align_center, text.align_center, '
    + 'size.tiny, color.blue, "mtip")'
  const NAMED10 = 'table.cell(t, 0, 1, text = "M", width = 0, height = 0, text_color = color.white, '
    + 'text_halign = text.align_center, text_valign = text.align_center, text_size = size.tiny, '
    + 'bgcolor = color.blue, tooltip = "mtip")'

  it('eleven positional arguments: the same program as the named call', () => {
    const p = T(POS11)
    const n = T(NAMED11)
    expect(propsOf(p)).toEqual(propsOf(n))
    // ⭐ The values, so the fixture distinguishes the old order from the new.
    const props = propsOf(p)
    expect(props.text_size).toEqual({ v: 'const', value: 'small' })
    expect(props.bgcolor.v).toBe('color')
    expect(props.bgcolor.node.hex).toBe('#F23645')
    expect(props.tooltip).toEqual({ v: 'text', node: { t: 'lit', s: 'tip' } })
    expect(props.text_formatting).toEqual({ v: 'const', value: 'bold' })
    // `text_font_family` is named unsupported on both spellings, never silently lost.
    expect(diag(p).unsupportedProps).toEqual(diag(n).unsupportedProps)
    expect((diag(p).unsupportedProps || []).some((s) => s.startsWith('cell.text_font_family'))).toBe(true)
  })

  it('eight positional arguments: size and background land where the named call puts them', () => {
    const p = T(POS8)
    expect(propsOf(p)).toEqual(propsOf(T(NAMED8)))
    expect(propsOf(p).text_size).toEqual({ v: 'const', value: 'large' })
    expect(propsOf(p).bgcolor.v).toBe('color')
    expect(propsOf(p).tooltip).toBeUndefined()
    expect(diag(p).dropReasons || {}).toEqual({})
  })

  it('the method spelling (ten after its two-argument address) reads the same slots', () => {
    const p = T(METHOD10)
    expect(propsOf(p)).toEqual(propsOf(T(NAMED10)))
    expect(propsOf(p).text_size).toEqual({ v: 'const', value: 'tiny' })
    expect(propsOf(p).tooltip).toEqual({ v: 'text', node: { t: 'lit', s: 'mtip' } })
  })
})
