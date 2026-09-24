// Wave 6 item 4 — moving a block: the keys, the grip's drag (which must reach
// pasteContainers.handleDrop, so a moved chart keeps its embedId), the grip's
// Move up / Move down, and the touch grip that needs no hover. REAL editor.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { buildExtensions } from './tiptap'
import { buildWidgetEmbedAttrs } from './widgetEmbedCore'
import { moveBlock, topBlockAt, BLOCK_HANDLE_LABEL, MOVE_MENU_LABEL } from './blockHandle'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

let editor
let warn
const realMatchMedia = window.matchMedia
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => {
  editor?.destroy(); editor = null
  window.matchMedia = realMatchMedia
  document.body.innerHTML = ''
  const fired = warn.mock.calls.filter((c) => String(c[0]).includes('[pasteContainers]'))
  warn.mockRestore()
  expect(fired, 'the drop belt fired: a rail must prove the rule, not the fallback').toEqual([])
})

function mount(content, opts = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content }, ...opts })
  return editor
}
const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const top = (ed) => { const o = []; ed.state.doc.forEach((n) => o.push(n.textContent || n.type.name)); return o }
const at = (ed, str) => { let hit = null; ed.state.doc.descendants((n, pos) => { if (hit == null && n.isText) { const i = n.text.indexOf(str); if (i >= 0) hit = pos + i } }); return hit }
const caret = (ed, pos) => ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)))
const keys = (ed, key) => fireEvent.keyDown(ed.view.dom, { key, code: key, altKey: true, shiftKey: true })
const chart = (embedId) => ({ type: 'widgetEmbed', attrs: { ...buildWidgetEmbedAttrs('chart', { symbol: 'NVDA', tf: 'D' }), embedId } })
const embedIds = (ed) => { const o = []; ed.state.doc.descendants((n) => { if (n.type.name === 'widgetEmbed') o.push(n.attrs.embedId) }); return o }
const grip = () => document.querySelector(`button[aria-label="${BLOCK_HANDLE_LABEL}"]`)
const menu = () => document.querySelector(`[role="group"][aria-label="${MOVE_MENU_LABEL}"]`)
const option = (label) => [...menu().querySelectorAll('button')].find((b) => b.textContent === label)
// jsdom has no layout: "the pointer is over position `pos`".
const hoverAt = (ed, pos) => {
  ed.view.posAtCoords = () => ({ pos, inside: -1 })
  fireEvent.mouseMove(ed.view.dom, { clientX: 10, clientY: 10 })
}
const dataTransfer = () => {
  const data = {}
  return {
    data, files: [], types: [],
    setData: (k, v) => { data[k] = v }, getData: (k) => data[k] || '', clearData: () => {},
    setDragImage: vi.fn(), effectAllowed: 'all', dropEffect: 'move',
  }
}
const drag = (el, dt) => {
  const ev = new Event('dragstart', { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  el.dispatchEvent(ev)
  return ev
}
// prosemirror-view's own drop handler, run whole (as pasteContainers.test.js
// domDrop does) — WITHOUT overriding view.dragging: the grip set it.
const dropAt = (ed, pos, dt) => {
  ed.view.posAtCoords = () => ({ pos, inside: -1 })
  const ev = new Event('drop', { bubbles: true, cancelable: true })
  Object.assign(ev, { clientX: 0, clientY: 0 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  ed.view.dom.dispatchEvent(ev)
  return ev
}

describe('Alt+Shift+↑ / ↓ moves the current block', () => {
  it('down, then up again; the caret travels with the block', () => {
    const ed = mount([P('One.'), P('Two.'), P('Three.')])
    caret(ed, at(ed, 'One.') + 2)
    keys(ed, 'ArrowDown')
    expect(top(ed)).toEqual(['Two.', 'One.', 'Three.'])
    expect(ed.state.selection.$from.parent.textContent).toBe('One.')
    keys(ed, 'ArrowDown')
    expect(top(ed)).toEqual(['Two.', 'Three.', 'One.'])
    keys(ed, 'ArrowUp')
    expect(top(ed)).toEqual(['Two.', 'One.', 'Three.'])
    expect(ed.state.selection.$from.parent.textContent).toBe('One.')
  })

  it('at the top or bottom of the note nothing moves (and the key is not claimed)', () => {
    const ed = mount([P('One.'), P('Two.')])
    caret(ed, at(ed, 'One.'))
    expect(moveBlock(ed, -1)).toBe(false)
    caret(ed, at(ed, 'Two.'))
    expect(moveBlock(ed, 1)).toBe(false)
    expect(top(ed)).toEqual(['One.', 'Two.'])
  })

  it('a selection across two blocks moves both together', () => {
    const ed = mount([P('One.'), P('Two.'), P('Three.')])
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, at(ed, 'One.') + 1, at(ed, 'Two.') + 2)))
    keys(ed, 'ArrowDown')
    expect(top(ed)).toEqual(['Three.', 'One.', 'Two.'])
  })

  it('a caret deep in a list item moves the WHOLE top-level list', () => {
    const list = { type: 'bulletList', content: [
      { type: 'listItem', content: [P('a')] }, { type: 'listItem', content: [P('b')] }] }
    const ed = mount([P('Intro.'), list])
    caret(ed, at(ed, 'b'))
    keys(ed, 'ArrowUp')
    // (the trailing empty paragraph is the editor's own: a list cannot end a note)
    expect(top(ed)).toEqual(['ab', 'Intro.', 'paragraph'])
  })

  it('one undo puts it back', () => {
    const ed = mount([P('One.'), P('Two.')])
    caret(ed, at(ed, 'One.'))
    keys(ed, 'ArrowDown')
    ed.commands.undo()
    expect(top(ed)).toEqual(['One.', 'Two.'])
  })

  it('a chart moved by the keys is the SAME node: its embedId is unchanged', () => {
    const ed = mount([P('One.'), chart('e-orig'), P('Two.')])
    ed.commands.setNodeSelection(topBlockAt(ed.state.doc, at(ed, 'One.') + 5).pos)
    keys(ed, 'ArrowDown')
    expect(top(ed)[2]).toBe('widgetEmbed')
    expect(embedIds(ed)).toEqual(['e-orig'])
  })

  it('a read-only note (locked) does not move', () => {
    const ed = mount([P('One.'), P('Two.')], { editable: false })
    caret(ed, at(ed, 'One.'))
    expect(moveBlock(ed, 1)).toBe(false)
    expect(top(ed)).toEqual(['One.', 'Two.'])
  })
})

describe('the grip (desktop: hover, then drag)', () => {
  it('hovering a block shows the grip beside THAT block; leaving the note hides it', () => {
    const ed = mount([P('One.'), P('Two.')])
    expect(grip().hidden).toBe(true)
    hoverAt(ed, at(ed, 'Two.'))
    expect(grip().hidden).toBe(false)
    expect(grip().dataset.pos).toBe(String(topBlockAt(ed.state.doc, at(ed, 'Two.')).pos))
    fireEvent.mouseLeave(ed.view.dom, { relatedTarget: document.body })
    expect(grip().hidden).toBe(true)
  })

  it('never appears on a read-only note', () => {
    const ed = mount([P('One.')], { editable: false })
    hoverAt(ed, at(ed, 'One.'))
    expect(grip().hidden).toBe(true)
  })

  it('dragstart makes prosemirror-view\'s own node drag of THAT block', () => {
    const ed = mount([P('One.'), P('Two.'), P('Three.')])
    hoverAt(ed, at(ed, 'Two.'))
    const dt = dataTransfer()
    drag(grip(), dt)
    const blockPos = topBlockAt(ed.state.doc, at(ed, 'Two.')).pos
    expect(ed.view.dragging).toMatchObject({ move: true })
    expect(ed.view.dragging.node.from).toBe(blockPos)
    expect(ed.view.dragging.slice.content.firstChild.textContent).toBe('Two.')
    expect(dt.data['text/html']).toContain('Two.')
    expect(dt.setDragImage).toHaveBeenCalled()
  })

  it('⛔ the drop goes through pasteContainers.handleDrop: a chart dragged by the grip MOVES and keeps its embedId', () => {
    const ed = mount([P('Mine.'), chart('e-orig'), P('After.')])
    hoverAt(ed, topBlockAt(ed.state.doc, at(ed, 'Mine.') + 6).pos)
    const dt = dataTransfer()
    drag(grip(), dt)
    dropAt(ed, at(ed, 'After.') + 'After.'.length + 1, dt)
    ed.state.doc.check()
    expect(embedIds(ed)).toEqual(['e-orig'])
    expect(top(ed).slice(0, 3)).toEqual(['Mine.', 'After.', 'widgetEmbed'])
  })

  it('⛔ …and a block dragged onto a toggle title follows the title rules (only pasteContainers knows them)', () => {
    const toggle = { type: 'toggle', attrs: { open: true }, content: [
      { type: 'toggleSummary', content: [{ type: 'text', text: 'Summary' }] },
      { type: 'toggleContent', content: [P('Body.')] }] }
    const ed = mount([P('Moved words.'), toggle])
    hoverAt(ed, at(ed, 'Moved'))
    const dt = dataTransfer()
    drag(grip(), dt)
    dropAt(ed, at(ed, 'Summary') + 'Summary'.length, dt)
    ed.state.doc.check()
    let toggles = 0
    ed.state.doc.descendants((n) => { if (n.type.name === 'toggle') toggles += 1 })
    expect(toggles).toBe(1)
    expect(top(ed)).toEqual(['SummaryMoved words.Body.', 'paragraph'])
  })

  it('a click on the grip offers Move up / Move down, disabled at the edges', () => {
    const ed = mount([P('One.'), P('Two.'), P('Three.')])
    hoverAt(ed, at(ed, 'One.'))
    fireEvent.click(grip())
    expect(grip().getAttribute('aria-expanded')).toBe('true')
    expect(option('Move up').disabled).toBe(true)
    fireEvent.click(option('Move down'))
    expect(top(ed)).toEqual(['Two.', 'One.', 'Three.'])
    expect(menu()).toBeNull()
  })

  it('Escape closes the move menu', () => {
    const ed = mount([P('One.'), P('Two.')])
    hoverAt(ed, at(ed, 'One.'))
    fireEvent.click(grip())
    fireEvent.keyDown(menu(), { key: 'Escape' })
    expect(menu()).toBeNull()
  })
})

describe('touch: hover never fires, so the grip is VISIBLE beside the caret\'s block', () => {
  beforeEach(() => {
    window.matchMedia = (q) => ({ matches: /coarse|hover: none/.test(q), media: q, addEventListener() {}, removeEventListener() {} })
  })

  it('a caret in a block shows the grip with no hover at all; Move down moves that block', () => {
    const ed = mount([P('One.'), P('Two.'), P('Three.')])
    ed.view.hasFocus = () => true
    caret(ed, at(ed, 'Two.'))
    expect(grip().hidden).toBe(false)
    expect(grip().dataset.pos).toBe(String(topBlockAt(ed.state.doc, at(ed, 'Two.')).pos))
    fireEvent.click(grip())
    fireEvent.click(option('Move down'))
    expect(top(ed)).toEqual(['One.', 'Three.', 'Two.'])
  })

  it('no hover path on touch: a stray mousemove does not move the grip off the caret\'s block', () => {
    const ed = mount([P('One.'), P('Two.')])
    ed.view.hasFocus = () => true
    caret(ed, at(ed, 'One.'))
    hoverAt(ed, at(ed, 'Two.'))
    expect(grip().dataset.pos).toBe(String(topBlockAt(ed.state.doc, at(ed, 'One.')).pos))
  })
})
