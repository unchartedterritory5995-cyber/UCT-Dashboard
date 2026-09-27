// Wave 6 item 1 — the table UI: the slash insert, the floating toolbar's every
// control (through the table extension's own commands, on a REAL editor), and
// Tab / Shift-Tab between cells.
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { useEffect, useReducer } from 'react'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { buildExtensions } from '../../lib/tiptap'
import { ITEMS } from './SlashMenu'
import TableToolbar, { hasHeaderRow, tableAtSelection } from './TableToolbar'

let editor
afterEach(() => { cleanup(); editor?.destroy(); editor = null; document.body.innerHTML = '' })

function mount(content, opts = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content }, ...opts })
  return editor
}
const P = (t) => (t ? { type: 'paragraph', content: [{ type: 'text', text: t }] } : { type: 'paragraph' })
const cell = (t, type = 'tableCell') => ({ type, content: [P(t)] })
const row = (...cells) => ({ type: 'tableRow', content: cells })
const TABLE = {
  type: 'table',
  content: [
    row(cell('Sym', 'tableHeader'), cell('R', 'tableHeader')),
    row(cell('NVDA'), cell('2.1')),
  ],
}

// The page re-renders on every transaction; the harness does the same.
function Harness({ ed }) {
  const [, bump] = useReducer((x) => x + 1, 0)
  useEffect(() => {
    ed.on('transaction', bump)
    return () => ed.off('transaction', bump)
  }, [ed])
  return <TableToolbar editor={ed} />
}

/** Put the caret inside the cell whose text is `text`. */
function caretIn(ed, text) {
  let at = null
  ed.state.doc.descendants((n, pos) => { if (at == null && n.isText && n.text === text) at = pos + 1 })
  act(() => { ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, at))) })
}
const theTable = (ed) => { let t = null; ed.state.doc.descendants((n) => { if (!t && n.type.name === 'table') t = n }); return t }
const shape = (ed) => { const t = theTable(ed); return t ? [t.childCount, t.firstChild.childCount] : null }
const cellText = (ed) => {
  const { $from } = ed.state.selection
  for (let d = $from.depth; d > 0; d -= 1) {
    if (['tableCell', 'tableHeader'].includes($from.node(d).type.name)) return $from.node(d).textContent
  }
  return null
}

describe('the slash insert', () => {
  it('/Table inserts a 3×3 table whose first row is a header', () => {
    const ed = mount([P('x')])
    const item = ITEMS.find((i) => i.title === 'Table')
    item.command({ editor: ed, range: { from: 1, to: 2 } })
    expect(shape(ed)).toEqual([3, 3])
    expect(hasHeaderRow(theTable(ed))).toBe(true)
  })
})

describe('<TableToolbar>', () => {
  it('appears only while the caret is inside a table, as a labelled toolbar', () => {
    const ed = mount([P('before'), TABLE])
    render(<Harness ed={ed} />)
    caretIn(ed, 'before')
    expect(screen.queryByRole('toolbar', { name: 'Table' })).toBeNull()
    caretIn(ed, 'NVDA')
    expect(screen.getByRole('toolbar', { name: 'Table' })).toBeTruthy()
    caretIn(ed, 'before')
    expect(screen.queryByRole('toolbar', { name: 'Table' })).toBeNull()
  })

  it('never appears on a read-only editor (a locked note, a version preview)', () => {
    const ed = mount([TABLE], { editable: false })
    render(<Harness ed={ed} />)
    caretIn(ed, 'NVDA')
    expect(screen.queryByRole('toolbar', { name: 'Table' })).toBeNull()
  })

  it('adds and deletes rows and columns where the caret is', () => {
    const ed = mount([TABLE])
    render(<Harness ed={ed} />)
    caretIn(ed, 'NVDA')
    fireEvent.click(screen.getByRole('button', { name: 'Add a row below' }))
    expect(shape(ed)).toEqual([3, 2])
    caretIn(ed, 'NVDA')
    fireEvent.click(screen.getByRole('button', { name: 'Add a row above' }))
    expect(shape(ed)).toEqual([4, 2])
    caretIn(ed, 'NVDA')
    fireEvent.click(screen.getByRole('button', { name: 'Add a column to the right' }))
    expect(shape(ed)).toEqual([4, 3])
    caretIn(ed, 'NVDA')
    fireEvent.click(screen.getByRole('button', { name: 'Add a column to the left' }))
    expect(shape(ed)).toEqual([4, 4])
    caretIn(ed, 'NVDA')
    fireEvent.click(screen.getByRole('button', { name: 'Delete this row' }))
    expect(shape(ed)).toEqual([3, 4])
    expect(ed.state.doc.textContent).not.toContain('NVDA')
    caretIn(ed, 'R')
    fireEvent.click(screen.getByRole('button', { name: 'Delete this column' }))
    expect(shape(ed)).toEqual([3, 3])
    expect(ed.state.doc.textContent).not.toContain('R')
  })

  it('toggles the header row, and says which way it is', () => {
    const ed = mount([TABLE])
    render(<Harness ed={ed} />)
    caretIn(ed, 'NVDA')
    const btn = screen.getByRole('button', { name: 'Header row' })
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(btn)
    expect(hasHeaderRow(theTable(ed))).toBe(false)
    expect(screen.getByRole('button', { name: 'Header row' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Header row' }))
    expect(hasHeaderRow(theTable(ed))).toBe(true)
  })

  it('deletes the whole table', () => {
    const ed = mount([P('before'), TABLE, P('after')])
    render(<Harness ed={ed} />)
    caretIn(ed, 'NVDA')
    fireEvent.click(screen.getByRole('button', { name: 'Delete table' }))
    expect(theTable(ed)).toBeNull()
    expect(ed.state.doc.textContent).toBe('beforeafter')
  })

  it('a control that would do nothing is disabled, never a silent click (the only column)', () => {
    const ed = mount([{ type: 'table', content: [row(cell('only')), row(cell('one'))] }])
    render(<Harness ed={ed} />)
    caretIn(ed, 'only')
    expect(screen.getByRole('button', { name: 'Delete this column' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Delete this row' }).disabled).toBe(false)
    // …and a click on it (were it enabled) is exactly the silent no-op this prevents.
    const before = ed.state.doc
    ed.chain().focus().deleteColumn().run()
    expect(ed.state.doc.eq(before)).toBe(true)
  })

  it('…and the only row cannot be deleted either (Delete table is the door for that)', () => {
    const ed = mount([{ type: 'table', content: [row(cell('a'), cell('b'))] }])
    render(<Harness ed={ed} />)
    caretIn(ed, 'a')
    expect(screen.getByRole('button', { name: 'Delete this row' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Delete this column' }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Delete table' }).disabled).toBe(false)
  })

  it('Alt+F10 moves focus onto the bar; Escape hands it back to the note', () => {
    const ed = mount([TABLE])
    render(<Harness ed={ed} />)
    caretIn(ed, 'NVDA')
    fireEvent.keyDown(ed.view.dom, { key: 'F10', altKey: true })
    const bar = screen.getByRole('toolbar', { name: 'Table' })
    expect(bar.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' })
    expect(bar.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(bar.contains(document.activeElement)).toBe(false)
    // …into the cell the member left, not the start of the note.
    expect(cellText(ed)).toBe('NVDA')
  })

  it('Escape on a bar whose editor was destroyed under it does not throw (wave 6 fix round 5, R5-1 sweep)', () => {
    // tiptap's `editor.view` is a THROWING getter once the editor is destroyed
    // (a note switch while the bar still holds focus): `editor.view.focus()`
    // unguarded is "[tiptap error]: The editor view is not available".
    const ed = mount([TABLE])
    render(<Harness ed={ed} />)
    caretIn(ed, 'NVDA')
    fireEvent.keyDown(ed.view.dom, { key: 'F10', altKey: true })
    const bar = screen.getByRole('toolbar', { name: 'Table' })
    expect(bar.contains(document.activeElement)).toBe(true)
    const thrown = []
    const onError = (e) => { thrown.push(e.error?.message || e.message); e.preventDefault() }
    window.addEventListener('error', onError)
    try {
      ed.destroy()
      fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    } finally {
      window.removeEventListener('error', onError)
    }
    expect(thrown, 'Escape on the bar threw on a destroyed editor').toEqual([])
    expect(bar.contains(document.activeElement)).toBe(false)
  })

  it('tableAtSelection is null outside a table (non-vacuity for the gate above)', () => {
    const ed = mount([P('x'), TABLE])
    caretIn(ed, 'x')
    expect(tableAtSelection(ed.state)).toBeNull()
    caretIn(ed, '2.1')
    expect(tableAtSelection(ed.state)?.node.type.name).toBe('table')
  })
})

describe('Tab / Shift-Tab between cells', () => {
  const press = (ed, key, shiftKey = false) => fireEvent.keyDown(ed.view.dom, { key, code: key, shiftKey })

  it('Tab goes to the next cell, Shift-Tab to the previous one', () => {
    const ed = mount([TABLE])
    caretIn(ed, 'Sym')
    press(ed, 'Tab')
    expect(cellText(ed)).toBe('R')
    press(ed, 'Tab')
    expect(cellText(ed)).toBe('NVDA')
    press(ed, 'Tab', true)
    expect(cellText(ed)).toBe('R')
  })

  it('Tab in the LAST cell adds a row and moves into it (it never leaves the table)', () => {
    const ed = mount([TABLE, P('after')])
    caretIn(ed, '2.1')
    press(ed, 'Tab')
    expect(shape(ed)).toEqual([3, 2])
    expect(cellText(ed)).toBe('')
    expect(tableAtSelection(ed.state)).not.toBeNull()
  })
})

// Wave 10 lane 10B — G-134: sort by a column, and size a column, from the bar.
// Asserted by the table the member SEES (the rendered cells, the colgroup),
// never by a spied command.
describe('<TableToolbar> — sort and column width (wave 10, G-134)', () => {
  // jsdom has no layout: an Undo scrolls the selection into view, which asks a
  // Range for its rects. Stubbed for this block only (the editor tests' idiom).
  const saved = {}
  beforeAll(() => {
    saved.rects = Range.prototype.getClientRects
    saved.box = Range.prototype.getBoundingClientRect
    Range.prototype.getClientRects = () => []
    Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
  })
  afterAll(() => {
    Range.prototype.getClientRects = saved.rects
    Range.prototype.getBoundingClientRect = saved.box
  })
  const PRICES = {
    type: 'table',
    content: [
      row(cell('Sym', 'tableHeader'), cell('Px', 'tableHeader')),
      row(cell('NVDA'), cell('120')),
      row(cell('AMD'), cell('9.5')),
      row(cell('META'), cell('')),
      row(cell('TSLA'), cell('1,050')),
    ],
  }
  /** The rendered column, top to bottom, as the member reads it. */
  const renderedColumn = (ed, i) => [...ed.view.dom.querySelectorAll('tr')].map((tr) => tr.children[i]?.textContent)

  it('Sort A→Z orders the rows by the caret\'s column — numbers as numbers, blank last, header on top', () => {
    const ed = mount([PRICES])
    render(<Harness ed={ed} />)
    caretIn(ed, '9.5')
    fireEvent.click(screen.getByRole('button', { name: 'Sort rows by this column, A to Z' }))
    expect(renderedColumn(ed, 1)).toEqual(['Px', '9.5', '120', '1,050', ''])
    expect(renderedColumn(ed, 0)).toEqual(['Sym', 'AMD', 'NVDA', 'TSLA', 'META'])
    // the bar is still open, on the same column
    expect(screen.getByRole('toolbar', { name: 'Table' })).toBeTruthy()
  })

  it('Sort Z→A reverses it; the blank still sinks', () => {
    const ed = mount([PRICES])
    render(<Harness ed={ed} />)
    caretIn(ed, '120')
    fireEvent.click(screen.getByRole('button', { name: 'Sort rows by this column, Z to A' }))
    expect(renderedColumn(ed, 1)).toEqual(['Px', '1,050', '120', '9.5', ''])
  })

  it('ONE Ctrl+Z after a sort puts every row back', () => {
    const ed = mount([PRICES])
    render(<Harness ed={ed} />)
    const before = renderedColumn(ed, 0)
    caretIn(ed, 'AMD')
    fireEvent.click(screen.getByRole('button', { name: 'Sort rows by this column, A to Z' }))
    expect(renderedColumn(ed, 0)).not.toEqual(before)
    act(() => { ed.commands.undo() })
    expect(renderedColumn(ed, 0)).toEqual(before)
  })

  it('a sort is ONE document change (one transaction), and so is a width step', () => {
    const ed = mount([PRICES])
    render(<Harness ed={ed} />)
    caretIn(ed, 'AMD')
    let changes = 0
    const count = ({ transaction }) => { if (transaction.docChanged) changes += 1 }
    ed.on('transaction', count)
    fireEvent.click(screen.getByRole('button', { name: 'Sort rows by this column, Z to A' }))
    expect(changes).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Make this column wider' }))
    expect(changes).toBe(2)
    ed.off('transaction', count)
  })

  it('Sort is DISABLED, with the reason, on a table that cannot be sorted', () => {
    const ed = mount([{ type: 'table', content: [row(cell('h', 'tableHeader')), row(cell('only'))] }])
    render(<Harness ed={ed} />)
    caretIn(ed, 'only')
    const asc = screen.getByRole('button', { name: 'Sort rows by this column, A to Z' })
    expect(asc.disabled).toBe(true)
    expect(asc.getAttribute('title')).toBe('There is only one row to sort.')
  })

  it('Wider widens the caret\'s column — drawn in the colgroup — and Narrower brings it back', () => {
    const ed = mount([PRICES])
    render(<Harness ed={ed} />)
    caretIn(ed, 'AMD')
    const col0 = () => ed.view.dom.closest('div').querySelector('table colgroup col')
    fireEvent.click(screen.getByRole('button', { name: 'Make this column wider' }))
    // an unsized column starts at 120px; one step is 40px
    expect(col0()?.style.width).toBe('160px')
    fireEvent.click(screen.getByRole('button', { name: 'Make this column narrower' }))
    expect(col0()?.style.width).toBe('120px')
  })

  it('Narrower is disabled at the floor — never a silent click', () => {
    const ed = mount([{ type: 'table', content: [
      // a real column carries ONE width in every row (fixTables normalises a
      // mixed column), exactly as the drag handle and Wider write it
      row({ type: 'tableCell', attrs: { colwidth: [40] }, content: [P('a')] }, cell('b')),
      row({ type: 'tableCell', attrs: { colwidth: [40] }, content: [P('c')] }, cell('d')),
    ] }])
    render(<Harness ed={ed} />)
    caretIn(ed, 'a')
    expect(screen.getByRole('button', { name: 'Make this column narrower' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Make this column wider' }).disabled).toBe(false)
  })
})
