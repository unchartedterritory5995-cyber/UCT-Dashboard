// Wave 10 lane 10B — G-134: table sort + column width (lib/tableTools.js), on
// a REAL editor built from the app's own extension roster.
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { undo } from '@tiptap/pm/history'
import { buildExtensions, editorSchema } from './tiptap'
import { NOTEBOOK_TYPE_SCHEMA } from './notebookSchema'
import {
  COLUMN_DEFAULT_PX, COLUMN_MAX_PX, COLUMN_MIN_PX, COLUMN_STEP_PX, canSortTable, cellNumber,
  compareCellText, currentColumnWidth, setColumnWidthTr, sortTableTr, storedColumnWidth, tableContext,
} from './tableTools'

let editor
afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })

const P = (t) => (t ? { type: 'paragraph', content: [{ type: 'text', text: t }] } : { type: 'paragraph' })
const cell = (t, type = 'tableCell', attrs) => ({ type, ...(attrs ? { attrs } : {}), content: [P(t)] })
const row = (...cells) => ({ type: 'tableRow', content: cells })
const H = (t) => cell(t, 'tableHeader')

function mount(content, opts = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content }, ...opts })
  return editor
}
function caretIn(ed, text) {
  let at = null
  ed.state.doc.descendants((n, pos) => { if (at == null && n.isText && n.text === text) at = pos + 1 })
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, at)))
}
const theTable = (ed) => { let t = null; ed.state.doc.descendants((n) => { if (!t && n.type.name === 'table') t = n }); return t }
/** The table as the member reads it: each row's cell texts. */
const grid = (ed) => {
  const out = []
  theTable(ed).forEach((r) => { const cells = []; r.forEach((c) => cells.push(c.textContent)); out.push(cells) })
  return out
}
const column = (ed, i) => grid(ed).map((r) => r[i])

const WATCHLIST = {
  type: 'table',
  content: [
    row(H('Sym'), H('Gain')),
    row(cell('NVDA'), cell('10%')),
    row(cell('amd'), cell('9%')),
    row(cell('AAPL'), cell('')),
    row(cell('TSLA'), cell('-2.5%')),
    row(cell('META'), cell('100%')),
  ],
}

describe('cellNumber — numeric-aware, the way a trader types a table', () => {
  it.each([
    ['1,200', 1200], ['$45.10', 45.1], ['-3.5%', -3.5], ['(2.4)', -2.4], ['+12', 12],
    ['1.2B', 1.2e9], ['850M', 8.5e8], ['3k', 3000], ['.5', 0.5], ['-$4', -4], ['$-4', -4],
  ])('%s → %d', (text, n) => { expect(cellNumber(text)).toBeCloseTo(n) })
  it.each(['NVDA', 'Q2', '', '1.2.3', '12,34', 'n/a', '10 shares'])('%j is text, not a number', (text) => {
    expect(cellNumber(text)).toBeNull()
  })
})

describe('compareCellText', () => {
  it('numbers compare as numbers: 9 before 10 before 100', () => {
    expect(['100', '9', '10'].sort((a, b) => compareCellText(a, b))).toEqual(['9', '10', '100'])
  })
  it('words compare numeric-aware and case-insensitive: Q2 before Q10, amd beside AMZN', () => {
    expect(['Q10', 'Q2', 'q1'].sort((a, b) => compareCellText(a, b))).toEqual(['q1', 'Q2', 'Q10'])
  })
  it('a blank sinks to the bottom in BOTH directions', () => {
    expect(['b', '', 'a'].sort((a, b) => compareCellText(a, b, 'asc'))).toEqual(['a', 'b', ''])
    expect(['b', '', 'a'].sort((a, b) => compareCellText(a, b, 'desc'))).toEqual(['b', 'a', ''])
  })
})

describe('sortTableTr — ONE transaction, header pinned, numeric-aware', () => {
  it('sorts the rows by the caret\'s column, numbers as numbers, blanks last, header on top', () => {
    const ed = mount([WATCHLIST])
    caretIn(ed, '9%')
    ed.view.dispatch(sortTableTr(ed.state, 'asc'))
    expect(column(ed, 1)).toEqual(['Gain', '-2.5%', '9%', '10%', '100%', ''])
    expect(column(ed, 0)).toEqual(['Sym', 'TSLA', 'amd', 'NVDA', 'META', 'AAPL'])
  })

  it('Z→A reverses the values and still sinks the blank', () => {
    const ed = mount([WATCHLIST])
    caretIn(ed, 'NVDA')
    ed.view.dispatch(sortTableTr(ed.state, 'desc'))
    expect(column(ed, 0)).toEqual(['Sym', 'TSLA', 'NVDA', 'META', 'amd', 'AAPL'])
  })

  it('ONE Undo puts every row back where it was', () => {
    const ed = mount([WATCHLIST])
    const before = grid(ed)
    caretIn(ed, '9%')
    ed.view.dispatch(sortTableTr(ed.state, 'asc'))
    expect(grid(ed)).not.toEqual(before)
    undo(ed.state, ed.view.dispatch)
    expect(grid(ed)).toEqual(before)
  })

  it('without a header row, the first row sorts with the rest', () => {
    const ed = mount([{ type: 'table', content: [row(cell('b')), row(cell('c')), row(cell('a'))] }])
    caretIn(ed, 'c')
    ed.view.dispatch(sortTableTr(ed.state, 'asc'))
    expect(column(ed, 0)).toEqual(['a', 'b', 'c'])
  })

  it('is stable: equal keys keep their order', () => {
    const ed = mount([{ type: 'table', content: [
      row(H('k'), H('v')), row(cell('1'), cell('first')), row(cell('0'), cell('x')), row(cell('1'), cell('second')),
    ] }])
    caretIn(ed, 'first')
    // sort by column 0 even though the caret is in column 1
    ed.view.dispatch(sortTableTr(ed.state, 'asc', 0))
    expect(column(ed, 1)).toEqual(['v', 'x', 'first', 'second'])
  })

  it('keeps the caret in the table (the toolbar stays open on the sorted column)', () => {
    const ed = mount([WATCHLIST])
    caretIn(ed, '9%')
    ed.view.dispatch(sortTableTr(ed.state, 'asc'))
    expect(tableContext(ed.state)?.col).toBe(1)
  })

  it('an already-sorted table answers null (nothing to do, nothing on the undo stack)', () => {
    const ed = mount([{ type: 'table', content: [row(cell('a')), row(cell('b'))] }])
    caretIn(ed, 'a')
    expect(sortTableTr(ed.state, 'asc')).toBeNull()
  })

  it('refuses a table with cells merged across rows, and says why', () => {
    const ed = mount([{ type: 'table', content: [
      row(cell('a', 'tableCell', { rowspan: 2 }), cell('x')), row(cell('y')), row(cell('b'), cell('z')),
    ] }])
    caretIn(ed, 'x')
    const check = canSortTable(ed.state)
    expect(check.ok).toBe(false)
    expect(check.reason).toMatch(/merged across rows/)
    expect(sortTableTr(ed.state, 'asc')).toBeNull()
  })

  it('refuses a table with one body row under its header', () => {
    const ed = mount([{ type: 'table', content: [row(H('h')), row(cell('only'))] }])
    caretIn(ed, 'only')
    expect(canSortTable(ed.state).ok).toBe(false)
  })
})

describe('column width — setColumnWidthTr', () => {
  it('writes the width on EVERY row of the column, in one transaction', () => {
    const ed = mount([WATCHLIST])
    caretIn(ed, 'amd')
    const ctx = tableContext(ed.state)
    ed.view.dispatch(setColumnWidthTr(ed.state, ctx, ctx.col, 180))
    const widths = []
    theTable(ed).forEach((r) => widths.push(r.child(0).attrs.colwidth))
    expect(widths).toEqual(Array(6).fill([180]))
    // …and the other column is untouched
    theTable(ed).forEach((r) => expect(r.child(1).attrs.colwidth).toBeNull())
    undo(ed.state, ed.view.dispatch)
    theTable(ed).forEach((r) => expect(r.child(0).attrs.colwidth).toBeNull())
  })

  it('clamps to the floor and the ceiling', () => {
    const ed = mount([WATCHLIST])
    caretIn(ed, 'amd')
    let ctx = tableContext(ed.state)
    ed.view.dispatch(setColumnWidthTr(ed.state, ctx, ctx.col, 3))
    ctx = tableContext(ed.state)
    expect(storedColumnWidth(ctx)).toBe(COLUMN_MIN_PX)
    ed.view.dispatch(setColumnWidthTr(ed.state, ctx, ctx.col, 99999))
    expect(storedColumnWidth(tableContext(ed.state))).toBe(COLUMN_MAX_PX)
  })

  it('an unsized, un-laid-out column starts from the default width', () => {
    const ed = mount([WATCHLIST])
    caretIn(ed, 'amd')
    expect(currentColumnWidth(ed.view, tableContext(ed.state))).toBe(COLUMN_DEFAULT_PX)
    expect(COLUMN_STEP_PX).toBeGreaterThan(0)
  })
})

describe('colwidth is a level-0 attribute, and survives save → reload', () => {
  it('the editor schema has declared colwidth on both cell types all along (no schema-type change)', () => {
    const schema = editorSchema()
    expect(Object.keys(schema.nodes.tableCell.spec.attrs)).toContain('colwidth')
    expect(Object.keys(schema.nodes.tableHeader.spec.attrs)).toContain('colwidth')
    // …and both cell types are level-0 types in the schema table
    expect(NOTEBOOK_TYPE_SCHEMA.tableCell).toBe(0)
    expect(NOTEBOOK_TYPE_SCHEMA.tableHeader).toBe(0)
  })

  it('a resized table\'s saved JSON reopens with the same widths, drawn in the colgroup', () => {
    const ed = mount([WATCHLIST])
    caretIn(ed, 'amd')
    const ctx = tableContext(ed.state)
    ed.view.dispatch(setColumnWidthTr(ed.state, ctx, ctx.col, 200))
    const saved = JSON.parse(JSON.stringify(ed.getJSON())) // what the save PUTs
    ed.destroy()
    // reload: a fresh editor from the stored body
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content: saved })
    expect(editor.getJSON()).toEqual(saved)
    const firstCellWidths = []
    theTable(editor).forEach((r) => firstCellWidths.push(r.child(0).attrs.colwidth))
    expect(firstCellWidths.every((w) => Array.isArray(w) && w[0] === 200)).toBe(true)
    const col = el.querySelector('table colgroup col')
    expect(col?.style.width).toBe('200px')
  })

  it('CONTROL: a read-only editor (a locked note) still DRAWS the stored widths', () => {
    const body = { type: 'doc', content: [{ type: 'table', content: [
      row(cell('a', 'tableCell', { colwidth: [150] }), cell('b')),
    ] }] }
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content: body, editable: false })
    expect(el.querySelector('table colgroup col')?.style.width).toBe('150px')
  })
})

describe('each table action is its OWN undo step (closeHistory)', () => {
  it('a sort straight after typing in the table: ONE Undo reverses the sort and keeps the words', () => {
    const ed = mount([WATCHLIST])
    caretIn(ed, 'amd')
    // typing, then the sort in the same instant (history would merge them)
    ed.view.dispatch(ed.state.tr.insertText(' inc', ed.state.selection.from + 2))
    const typed = grid(ed)
    expect(column(ed, 0)).toContain('amd inc')
    ed.view.dispatch(sortTableTr(ed.state, 'desc'))
    expect(grid(ed)).not.toEqual(typed)
    undo(ed.state, ed.view.dispatch)
    expect(grid(ed)).toEqual(typed)
  })

  it('a width change straight after typing: ONE Undo reverses the width and keeps the words', () => {
    const ed = mount([WATCHLIST])
    caretIn(ed, 'amd')
    ed.view.dispatch(ed.state.tr.insertText(' inc', ed.state.selection.from + 2))
    const ctx = tableContext(ed.state)
    ed.view.dispatch(setColumnWidthTr(ed.state, ctx, ctx.col, 200))
    undo(ed.state, ed.view.dispatch)
    expect(column(ed, 0)).toContain('amd inc')
    expect(storedColumnWidth(tableContext(ed.state))).toBeNull()
  })
})
