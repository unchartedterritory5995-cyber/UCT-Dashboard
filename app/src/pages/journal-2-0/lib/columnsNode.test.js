// Wave 6 item 5 — side-by-side columns: the slash insert, the no-nesting rule
// at every door (slash, transaction, paste, drag), the paste rules for a
// container, citation text in column order, and the phone stacking rule.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { Editor, generateJSON } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildExtensions } from './tiptap'
import { hasNestedColumns, inColumn, insertColumns } from './columnsNode'
import { citationText } from './askCitation'
import { ITEMS, blockItemsAvailable } from '../components/notebook/SlashMenu'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
if (typeof globalThis.ClipboardEvent === 'undefined') {
  globalThis.ClipboardEvent = class extends Event {
    constructor(type, opts) { super(type, opts); this.clipboardData = (opts && opts.clipboardData) || null }
  }
}

let editor
let warn
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => {
  editor?.destroy(); editor = null; document.body.innerHTML = ''
  const fired = warn.mock.calls.filter((c) => String(c[0]).includes('[pasteContainers]'))
  warn.mockRestore()
  expect(fired, 'the paste belt fired: a rail must prove the rule, not the fallback').toEqual([])
})

function mount(content, opts = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content }, ...opts })
  return editor
}
const P = (t) => (t ? { type: 'paragraph', content: [{ type: 'text', text: t }] } : { type: 'paragraph' })
const COL = (...blocks) => ({ type: 'column', content: blocks })
const COLS = (...cols) => ({ type: 'columns', content: cols })
const at = (ed, str) => { let hit = null; ed.state.doc.descendants((n, pos) => { if (hit == null && n.isText) { const i = n.text.indexOf(str); if (i >= 0) hit = pos + i } }); return hit }
const caret = (ed, pos) => ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)))
const count = (ed, type) => { let c = 0; ed.state.doc.descendants((n) => { if (n.type.name === type) c += 1 }); return c }
const firstPos = (ed, type) => { let p = null; ed.state.doc.descendants((n, pos) => { if (p == null && n.type.name === type) p = pos }); return p }
const titles = (ed) => blockItemsAvailable(ed).map((i) => i.title)

describe('inserting columns', () => {
  it('/2 columns inserts two empty columns with the caret in the FIRST; typing lands there', () => {
    const ed = mount([P('x')])
    ITEMS.find((i) => i.title === '2 columns').command({ editor: ed, range: { from: 1, to: 2 } })
    expect(count(ed, 'columns')).toBe(1)
    expect(count(ed, 'column')).toBe(2)
    expect(inColumn(ed.state.selection.$from)).toBe(true)
    ed.commands.insertContent('Bull case')
    expect(ed.state.doc.nodeAt(firstPos(ed, 'column')).textContent).toBe('Bull case')
  })

  it('/3 columns inserts three', () => {
    const ed = mount([P('x')])
    ITEMS.find((i) => i.title === '3 columns').command({ editor: ed, range: { from: 1, to: 2 } })
    expect(count(ed, 'column')).toBe(3)
  })

  it('parses its own HTML back (copy/paste stability)', () => {
    const json = generateJSON('<div data-type="columns"><div data-type="column"><p>a</p></div><div data-type="column"><p>b</p></div></div>', buildExtensions())
    expect(json.content[0].type).toBe('columns')
    expect(json.content[0].content.map((c) => c.type)).toEqual(['column', 'column'])
  })

  it('a read-only note (locked) refuses the insert', () => {
    const ed = mount([P('x')], { editable: false })
    expect(insertColumns(ed, 2)).toBe(false)
    expect(count(ed, 'columns')).toBe(0)
  })
})

describe('⛔ columns never nest — at every door', () => {
  it('the slash menu does not offer columns inside a column (and does everywhere else)', () => {
    const ed = mount([P('Out.'), COLS(COL(P('In.')), COL(P('Other.')))])
    caret(ed, at(ed, 'Out.'))
    expect(titles(ed)).toContain('2 columns')
    caret(ed, at(ed, 'In.'))
    expect(titles(ed)).not.toContain('2 columns')
    expect(titles(ed)).not.toContain('3 columns')
    expect(insertColumns(ed, 2)).toBe(false)
  })

  it('a transaction that would put columns inside a column is REFUSED — the note is unchanged', () => {
    const ed = mount([COLS(COL(P('In.')), COL(P('Other.')))])
    const before = ed.state.doc
    const nested = ed.schema.nodes.columns.create(null, [
      ed.schema.nodes.column.create(null, ed.schema.nodes.paragraph.create()),
      ed.schema.nodes.column.create(null, ed.schema.nodes.paragraph.create())])
    ed.view.dispatch(ed.state.tr.insert(at(ed, 'In.') + 3 + 1, nested))
    expect(ed.state.doc.eq(before)).toBe(true)
    expect(hasNestedColumns(ed.state.doc)).toBe(false)
  })

  it('a whole columns block PASTED into a column arrives as its blocks — nothing lost, nothing nested', () => {
    const ed = mount([COLS(COL(P('Bull.')), COL(P('Bear.'))), P('Target.'), COLS(COL(P('Here.')), COL(P('There.')))])
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, firstPos(ed, 'columns'))))
    const html = ed.view.serializeForClipboard(ed.state.selection.content()).dom.innerHTML
    caret(ed, at(ed, 'Here.') + 5)
    ed.view.pasteHTML(html)
    ed.state.doc.check()
    expect(hasNestedColumns(ed.state.doc)).toBe(false)
    const second = ed.state.doc.child(2)
    expect(second.type.name).toBe('columns')
    expect(second.firstChild.textContent).toContain('Bull.')
    expect(second.firstChild.textContent).toContain('Bear.')
  })

  it('CONTROL: the same paste OUTSIDE a column keeps its columns', () => {
    const ed = mount([COLS(COL(P('Bull.')), COL(P('Bear.'))), P('Target.')])
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, firstPos(ed, 'columns'))))
    const html = ed.view.serializeForClipboard(ed.state.selection.content()).dom.innerHTML
    caret(ed, at(ed, 'Target.') + 7)
    ed.view.pasteHTML(html)
    expect(count(ed, 'columns')).toBe(2)
  })

  const dropColumnsAt = (ed, target) => {
    const node = NodeSelection.create(ed.state.doc, firstPos(ed, 'columns'))
    ed.view.posAtCoords = () => ({ pos: target, inside: -1 })
    ed.view.dragging = { slice: node.content(), move: true, node }
    const ev = new Event('drop', { bubbles: true, cancelable: true })
    Object.assign(ev, { clientX: 0, clientY: 0 })
    Object.defineProperty(ev, 'dataTransfer', { value: { getData: () => '', files: [], types: [] } })
    ed.view.dom.dispatchEvent(ev)
  }

  it('a columns block DRAGGED into a column is refused: the source stays whole where it was', () => {
    const ed = mount([COLS(COL(P('Bull.')), COL(P('Bear.'))), P('Mid.'), COLS(COL(P('Here.')), COL(P('There.')))])
    const before = ed.state.doc
    dropColumnsAt(ed, at(ed, 'Here.') + 5)
    expect(ed.state.doc.eq(before)).toBe(true)
  })

  it('CONTROL: the same drag dropped OUTSIDE any column moves the block (the harness can move)', () => {
    const ed = mount([COLS(COL(P('Bull.')), COL(P('Bear.'))), P('Mid.'), P('End.')])
    dropColumnsAt(ed, at(ed, 'End.') + 4)
    expect(ed.state.doc.firstChild.textContent).toBe('Mid.')
    expect(count(ed, 'columns')).toBe(1)
    expect(hasNestedColumns(ed.state.doc)).toBe(false)
  })
})

describe('copy and paste across columns (a PASTE_CONTAINER)', () => {
  const copyRange = (ed, from, to) => {
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)))
    return ed.view.serializeForClipboard(ed.state.selection.content()).dom.innerHTML
  }

  it('a selection across three columns never puts a bare column on the clipboard, and pastes as paragraphs', () => {
    const ed = mount([COLS(COL(P('Alpha one.')), COL(P('Beta two.')), COL(P('Gamma three.'))), P('Mine.')])
    const html = copyRange(ed, at(ed, 'one.'), at(ed, 'Gamma') + 5)
    expect(html).not.toMatch(/data-type="columns?"/)
    caret(ed, at(ed, 'Mine.') + 5)
    ed.view.pasteHTML(html)
    ed.state.doc.check()
    expect(count(ed, 'columns')).toBe(1)
    const tail = []
    ed.state.doc.forEach((n, _o, i) => { if (i >= 1) tail.push(n.textContent) })
    expect(tail.join('|')).toContain('Mine.one.')
    expect(tail.join('|')).toContain('Beta two.')
    expect(tail.join('|')).toContain('Gamma')
  })

  it('a word copied from inside a column pastes as a word', () => {
    const ed = mount([COLS(COL(P('Alpha one.')), COL(P('Beta.'))), P('Mine.')])
    const html = copyRange(ed, at(ed, 'one'), at(ed, 'one') + 3)
    caret(ed, at(ed, 'Mine.') + 4)
    ed.view.pasteHTML(html)
    expect(ed.state.doc.lastChild.textContent).toBe('Mineone.')
    expect(count(ed, 'columns')).toBe(1)
  })
})

describe('editing inside a column', () => {
  it('Backspace at the start of the second column never merges the columns', () => {
    const ed = mount([COLS(COL(P('Left.')), COL(P('Right.')))])
    caret(ed, at(ed, 'Right.'))
    fireEvent.keyDown(ed.view.dom, { key: 'Backspace', code: 'Backspace' })
    expect(count(ed, 'column')).toBe(2)
    expect(ed.state.doc.firstChild.lastChild.textContent).toBe('Right.')
  })

  it('citation text reads the columns in column order, one block per line', () => {
    const ed = mount([P('Intro.'), COLS(COL(P('Bull.'), P('Wide.')), COL(P('Bear.'))), P('After.')])
    expect(citationText(ed.state.doc, 0, ed.state.doc.content.size)).toBe('Intro.\nBull.\nWide.\nBear.\nAfter.')
  })
})

describe('on a phone the columns stack (the stylesheet says so, in the canonical tier)', () => {
  it('noteContent.css turns the grid into rows at max-width: 640px', () => {
    const HERE = path.dirname(fileURLToPath(import.meta.url))
    const css = fs.readFileSync(path.join(HERE, 'noteContent.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const phone = [...css.matchAll(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n')
    expect(phone).toMatch(/\.uctColumns\s*\{[^}]*grid-auto-flow:\s*row/)
    expect(css).toMatch(/\.ProseMirror \.uctColumns\s*\{[^}]*grid-auto-flow:\s*column/)
  })
})
