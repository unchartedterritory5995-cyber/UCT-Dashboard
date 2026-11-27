// app/src/components/chart/engine/__tests__/tableCellPlaceholder.test.js
//
// ─── ⭐⭐ M-T1 (coordinator ruling 2026-11-27) — A CELL THIS CHART COULD NOT COMPUTE IS A "NOT COMPUTED" PLACEHOLDER ──
//
// Black-Scholes [Loxx] drew 8 of TradingView's 22 table cells: every cell whose TEXT hit an engine wall was DROPPED,
// so the table collapsed around the holes (every later row moved up). The ruling:
//   (a) the table keeps TradingView's geometry (rows, columns, positions, colours, sizes);
//   (b) each such cell paints a visible, muted "not computed", never blank, with its reason on hover / long-press;
//   (c) the drawing note names the count ("Table: 2 of 3 cells computed.");
//   (d) a cell whose text TradingView leaves EMPTY stays empty: only a refused cell is a placeholder.
// ⛔ A placeholder is never a value: the harness and every cell count skip it, so no grade moves.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { JSDOM } from 'jsdom'

import { HARNESS_DIR } from './vendorHarness/harness'
import { enterMemberDoor, toProductBars, tfCodeOf, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import * as registry from '../nativeRegistry'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import { layoutTables } from '../objectCanvas'
import { buildTable, cellIsDrawn, PLACEHOLDER_TEXT, PLACEHOLDER_COLOR } from '../objectTableDom'
import { tableCellsComputedSentence } from '../objectRenderNotice'

// the bars of a committed capture; the scripts below are this file's own
const BARS_OF = 'ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28'
const cap = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, `${BARS_OF}.json`), 'utf8'))

function draw(src) {
  const door = enterMemberDoor(src)
  try {
    expect(door.def, door.refusal || '').toBeTruthy()
    const bars = toProductBars(cap)
    const tf = tfCodeOf(cap.timeframe)
    const reader = objectReaderFor(door.def, bars, { inputs: undefined, tf, symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false })
    const run = evaluateObjects(reader.program, { barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime })
    return { door, state: toRenderState(run.live, { bars, tf }) }
  } finally { registry.uninstallUserDefinition(HARNESS_DEF_ID) }
}

// row 1's text is `str.format` of a date (`{0,date,…}`), a text this door refuses (pine:text-value, as Black-Scholes'
// "Time Now" row); rows 0 and 2 are literals. Row 3's text is an EMPTY string TradingView leaves empty.
const SRC = `//@version=5
indicator("M-T1", overlay = true)
var t = table.new(position.top_right, 1, 4, bgcolor = color.yellow, border_width = 1)
if barstate.islast
    table.cell(t, 0, 0, "Head", bgcolor = color.green, text_color = color.white)
    table.cell(t, 0, 1, str.format("{0,date,MMMM dd, yyyy}", timenow), bgcolor = color.red, text_color = color.white)
    table.cell(t, 0, 2, "Tail", bgcolor = color.green, text_color = color.white)
    table.cell(t, 0, 3, "", bgcolor = color.blue)
plot(close)
`
const cellAt = (state, col, row) => state.tables[0].cells.find((c) => c.col === col && c.row === row)

describe('⭐⭐ (a) the refused cell keeps its place and its colours', () => {
  it('row 1 is a placeholder at (0,1) with its own background; rows 0, 2 and 3 are where TradingView puts them', () => {
    const { state } = draw(SRC)
    const ph = cellAt(state, 0, 1)
    expect(ph, 'the refused cell is present').toBeTruthy()
    expect(ph.placeholder).toBe(true)
    expect(ph.text).toBe('')
    expect(ph.bgcolor).toBeTruthy()
    expect(cellAt(state, 0, 0).text).toBe('Head')
    expect(cellAt(state, 0, 2).text).toBe('Tail')
    const [lay] = layoutTables(state)
    expect(lay.rows).toBe(4)
    expect(lay.grid[1][0].placeholder).toBe(true)
    expect(lay.grid[2][0].text).toBe('Tail')
  })
})

describe('⭐⭐ (b) it paints "not computed", muted, with its reason on hover and long-press', () => {
  it('the <td> says "not computed" in the muted colour, and its title / data-uct-reason name the refusal', () => {
    const { state } = draw(SRC)
    const ph = cellAt(state, 0, 1)
    expect(typeof ph.reason).toBe('string')
    // the refusal's OWN words (the translator's), not a generic fallback
    expect(ph.reason).toMatch(/str\.format/)
    expect(ph.reason).toMatch(/date/)
    const dom = new JSDOM('<!doctype html><div id="root"></div>')
    const built = buildTable(layoutTables(state)[0], dom.window.document)
    const td = built.el.querySelector('td[data-uct-cell="placeholder"]')
    expect(td, 'a placeholder cell is drawn').toBeTruthy()
    expect(td.textContent).toBe(PLACEHOLDER_TEXT)
    expect(td.style.color.replace(/\s/g, '')).toBe('rgb(120,123,134)')
    expect(PLACEHOLDER_COLOR).toBe('#787B86')
    expect(td.getAttribute('data-uct-reason')).toBe(ph.reason)
    expect(td.getAttribute('title')).toContain(ph.reason)
    expect(td.style.pointerEvents).toBe('auto')
    // the row order and the background are the table's own
    const rows = [...built.el.querySelectorAll('tr')]
    expect(rows.length).toBe(4)
    expect(rows[1].querySelector('td')).toBe(td)
    // ⛔ a placeholder holds a place, not a value: the drawn-cell count is the computed cells only
    expect(built.cells).toBe(3)
  })

  it('a touch long-press shows the reason in place, then puts "not computed" back', async () => {
    const { state } = draw(SRC)
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true })
    const built = buildTable(layoutTables(state)[0], dom.window.document)
    const td = built.el.querySelector('td[data-uct-cell="placeholder"]')
    const ev = new dom.window.Event('pointerdown')
    ev.pointerType = 'touch'
    td.dispatchEvent(ev)
    await new Promise((r) => setTimeout(r, 650))
    expect(td.textContent).toBe(cellAt(state, 0, 1).reason)
  })
})

describe('⭐ (c) the note names the count', () => {
  it('"Table: 3 of 4 cells computed."', () => {
    const { state } = draw(SRC)
    expect(state.placeholders.cell).toBe(1)
    expect(tableCellsComputedSentence(state)).toBe('Table: 3 of 4 cells computed.')
  })
  it('⛔ CONTROL: a table with nothing refused says nothing', () => {
    const { state } = draw(SRC.replace('str.format("{0,date,MMMM dd, yyyy}", timenow)', '"Mid"'))
    expect(state.placeholders.cell).toBe(0)
    expect(tableCellsComputedSentence(state)).toBe(null)
    expect(cellAt(state, 0, 1).text).toBe('Mid')
  })
})

describe('⛔ (d) a cell whose text TradingView leaves empty stays empty', () => {
  it('row 3 (`""`) is not a placeholder: no words, only its background', () => {
    const { state } = draw(SRC)
    const empty = cellAt(state, 0, 3)
    expect(empty.placeholder).toBeUndefined()
    expect(empty.text).toBe('')
    expect(cellIsDrawn({ text: '' })).toBe(false)
  })
})
