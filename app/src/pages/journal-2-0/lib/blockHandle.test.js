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

// ⛔⛔ I3 (wave 6 fix round 1): THE TAP MUST LAND. The two rails above stub
// `view.hasFocus = () => true`, so they cannot see what a real tap does to
// focus. On Android Chrome a tap on a button FOCUSES it first (at the
// compatibility mousedown, AFTER pointerdown), so the editor BLURS, TipTap
// dispatches a transaction on that blur, the touch branch of `update()` asked
// `view.hasFocus()` and hid the grip — and the click arrived at a grip that had
// already let go of its block. These drive the REAL focus change, in the order
// a phone sends it, on a real editor with nothing stubbed.
//
// ⚠️ jsdom performs the focus change and runs every handler, but it does not
// hit-test: it delivers a click to a hidden button that a phone never would.
// So these prove the ORDER of events is handled; that the grip survives a
// finger on a real Android device is a device check, and it is still owed.
describe('touch: a TAP on the grip lands — the editor blurring under the finger does not hide it', () => {
  beforeEach(() => {
    window.matchMedia = (q) => ({ matches: /coarse|hover: none/.test(q), media: q, addEventListener() {}, removeEventListener() {} })
  })
  afterEach(() => { vi.useRealTimers() })

  /** A focused editor with the caret in "Two.", the grip beside it — no stubs. */
  function focusedAtTwo() {
    const ed = mount([P('One.'), P('Two.'), P('Three.')])
    ed.view.focus()
    caret(ed, at(ed, 'Two.'))
    expect(ed.view.hasFocus(), 'jsdom must really focus the editor for this rail to mean anything').toBe(true)
    expect(grip().hidden).toBe(false)
    return ed
  }
  /** What Android Chrome sends for a tap on a button, in its order. */
  function tapGrip() {
    fireEvent.pointerDown(grip(), { pointerType: 'touch' })
    fireEvent.pointerUp(grip(), { pointerType: 'touch' })
    fireEvent.mouseDown(grip())
    grip().focus()                      // ← the focus move: the editor blurs HERE
    fireEvent.mouseUp(grip())
    fireEvent.click(grip())
  }

  it('the tap opens the move menu for the caret\'s block, and Move down moves it', () => {
    const ed = focusedAtTwo()
    tapGrip()
    expect(ed.view.hasFocus(), 'the focus really left the editor').toBe(false)
    expect(grip().hidden, 'the grip vanished under the finger').toBe(false)
    expect(menu(), 'the tap never reached the grip').not.toBeNull()
    fireEvent.click(option('Move down'))
    expect(top(ed)).toEqual(['One.', 'Three.', 'Two.'])
  })

  it('CONTROL — a blur the grip did not cause (focus went elsewhere) still hides it', () => {
    const ed = focusedAtTwo()
    const other = document.createElement('button')
    document.body.appendChild(other)
    other.focus()
    expect(ed.view.hasFocus()).toBe(false)
    expect(grip().hidden).toBe(true)
  })

  it('a press that never becomes a tap (the finger slid off) lets go: the grip hides once the press is over', () => {
    vi.useFakeTimers()
    const ed = focusedAtTwo()
    fireEvent.pointerDown(grip(), { pointerType: 'touch' })
    grip().focus()
    expect(grip().hidden).toBe(false)
    vi.advanceTimersByTime(2000)
    expect(ed.view.hasFocus()).toBe(false)
    expect(grip().hidden, 'a press that ended without a tap held the grip up for good').toBe(true)
  })

  it('a press the browser takes back (pointercancel: it became a scroll) lets go at once', () => {
    const ed = focusedAtTwo()
    fireEvent.pointerDown(grip(), { pointerType: 'touch' })
    grip().focus()
    fireEvent.pointerCancel(grip(), { pointerType: 'touch' })
    expect(ed.view.hasFocus()).toBe(false)
    expect(grip().hidden).toBe(true)
  })
})

// ⛔⛔ P2 (verify-1009, docs/notebook/verify-1009-sandbox.md): a real browser starts an
// HTML5 drag a few pixels AFTER the button goes down on the grip, and the mouse events in
// between still reach the grip's view. Measured (evidence/verify-1009/sbx/grip/): a quick
// first motion either crossed another block (the grip re-aimed at it, and the drag moved
// the WRONG block) or left the grip into the gutter (the grip hid, and a hidden drag
// source never starts). These replay that order of events.
describe('P2: a press on the grip holds the block it was pressed for', () => {
  it('a mousemove over another block between mousedown and dragstart does not change WHAT is dragged (chart)', () => {
    const ed = mount([chart('e-orig'), P('Paragraph A.'), P('Paragraph B.')])
    hoverAt(ed, 0)
    expect(grip().dataset.pos).toBe('0')
    fireEvent.mouseDown(grip(), { button: 0 })
    hoverAt(ed, at(ed, 'Paragraph B.'))          // the pointer crosses Paragraph B before the drag begins
    expect(grip().dataset.pos, 'the grip jumped to the block under the pointer while pressed').toBe('0')
    const dt = dataTransfer()
    drag(grip(), dt)
    expect(ed.view.dragging.slice.content.firstChild.type.name, 'the drag took the block under the pointer, not the one grabbed').toBe('widgetEmbed')
    dropAt(ed, at(ed, 'Paragraph B.') + 'Paragraph B.'.length + 1, dt)
    ed.state.doc.check()
    expect(top(ed).slice(0, 3)).toEqual(['Paragraph A.', 'Paragraph B.', 'widgetEmbed'])
    expect(embedIds(ed)).toEqual(['e-orig'])
  })

  it('the same for a paragraph: the grabbed block is the one that moves', () => {
    const ed = mount([P('One.'), P('Two.'), P('Three.')])
    hoverAt(ed, at(ed, 'One.'))
    fireEvent.mouseDown(grip(), { button: 0 })
    hoverAt(ed, at(ed, 'Three.'))
    const dt = dataTransfer()
    drag(grip(), dt)
    expect(ed.view.dragging.slice.content.firstChild.textContent).toBe('One.')
  })

  it('leaving the grip for the gutter while the button is down does not hide it (a hidden source never drags)', () => {
    const ed = mount([chart('e-orig'), P('Paragraph A.')])
    hoverAt(ed, 0)
    fireEvent.mouseDown(grip(), { button: 0 })
    fireEvent.mouseLeave(grip(), { relatedTarget: document.body })
    expect(grip().hidden, 'the grip hid under a pressed button').toBe(false)
    expect(ed.state.doc.firstChild.type.name).toBe('widgetEmbed')
  })

  it('CONTROL — once the button is up, the grip follows the pointer and leaving hides it, as before', () => {
    const ed = mount([P('One.'), P('Two.')])
    hoverAt(ed, at(ed, 'One.'))
    fireEvent.mouseDown(grip(), { button: 0 })
    fireEvent.mouseUp(document, { button: 0 })
    hoverAt(ed, at(ed, 'Two.'))
    expect(grip().dataset.pos).toBe(String(topBlockAt(ed.state.doc, at(ed, 'Two.')).pos))
    fireEvent.mouseLeave(grip(), { relatedTarget: document.body })
    expect(grip().hidden).toBe(true)
  })

  it('CONTROL — after a drag ends (dragend swallows the mouseup), the press is over too', () => {
    const ed = mount([P('One.'), P('Two.')])
    hoverAt(ed, at(ed, 'One.'))
    fireEvent.mouseDown(grip(), { button: 0 })
    drag(grip(), dataTransfer())
    fireEvent(grip(), new Event('dragend', { bubbles: true }))
    hoverAt(ed, at(ed, 'Two.'))
    expect(grip().dataset.pos).toBe(String(topBlockAt(ed.state.doc, at(ed, 'Two.')).pos))
  })
})

describe('P2: the grip stays inside the visible part of a block whose top edge is scrolled away', () => {
  const rectAt = (top, bottom) => () => ({ top, bottom, left: 400, right: 1180, width: 780, height: bottom - top, x: 400, y: top })
  function scrolled(scrollerTop) {
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    scroller.getBoundingClientRect = rectAt(scrollerTop, 800)
    document.body.appendChild(scroller)
    const el = document.createElement('div')
    scroller.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content: [chart('e-tall'), P('After.')] } })
    return editor
  }

  it('a tall chart whose top is above the visible area: the grip sits at the visible top, not off screen', () => {
    const ed = scrolled(60)
    ed.view.nodeDOM(0).getBoundingClientRect = rectAt(-29, 543)
    hoverAt(ed, 0)
    expect(grip().hidden).toBe(false)
    expect(grip().style.top, 'the grip was placed above the visible area').toBe('62px')
  })

  it('…and below anything pinned over that edge (the note\'s sticky header): the first row where the block shows', () => {
    const ed = scrolled(60)
    const dom = ed.view.nodeDOM(0)
    dom.getBoundingClientRect = rectAt(-29, 543)
    const header = document.createElement('div')
    const realEFP = document.elementFromPoint
    document.elementFromPoint = (_x, y) => (y < 130 ? header : dom)
    try {
      hoverAt(ed, 0)
      expect(Number.parseInt(grip().style.top, 10)).toBeGreaterThanOrEqual(119)
      expect(Number.parseInt(grip().style.top, 10)).toBeLessThan(140)
    } finally { document.elementFromPoint = realEFP }
  })

  it('CONTROL — a block whose top edge is in view keeps the grip exactly where it stood (top + 2)', () => {
    const ed = scrolled(60)
    ed.view.nodeDOM(0).getBoundingClientRect = rectAt(170, 742)
    hoverAt(ed, 0)
    expect(grip().style.top).toBe('172px')
  })
})
