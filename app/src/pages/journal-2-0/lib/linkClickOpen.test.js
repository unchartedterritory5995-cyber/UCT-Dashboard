// Ruling 165 — Ctrl/Cmd+click (and a touch re-tap) to open a link in the
// note editor. REAL editor over the app's own roster (buildExtensions()),
// same idiom as blockHandle.test.js / webLinks.test.jsx: a plugin wired into
// the actual schema, not a reimplementation tested in isolation.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { buildExtensions } from './tiptap'
import { openableLinkHref, linkOpenHint } from './linkClickOpen'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const setPlatform = (value) => Object.defineProperty(navigator, 'platform', { value, configurable: true })

let editor
let openSpy
beforeEach(() => {
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => {})
})
afterEach(() => {
  editor?.destroy(); editor = null
  openSpy.mockRestore()
  delete navigator.platform
  document.body.innerHTML = ''
})

function mount(content, opts = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content }, ...opts })
  return editor
}
const linkPara = (text, href) => ({
  type: 'paragraph',
  content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }],
})
const linkEl = (ed) => ed.view.dom.querySelector('a[href]')
const at = (ed, str) => {
  let hit = null
  ed.state.doc.descendants((n, pos) => { if (hit == null && n.isText) { const i = n.text.indexOf(str); if (i >= 0) hit = pos + i } })
  return hit
}
const putCaretIn = (ed, str) => {
  const pos = at(ed, str) + 1 // one char inside the text, safely inside the mark's range
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)))
}
/** pointerdown then click, as one gesture — mirrors a real tap/click pair. */
function tap(el, opts = {}) {
  fireEvent.pointerDown(el, { pointerType: opts.pointerType || 'mouse', bubbles: true })
  return fireEvent.click(el, { ctrlKey: !!opts.ctrlKey, metaKey: !!opts.metaKey, bubbles: true })
}

describe('openableLinkHref — ruling 165: only http(s) and mailto ever open', () => {
  it.each([
    ['https://example.com/path', 'https://example.com/path'],
    ['http://example.com/path', 'http://example.com/path'],
    ['  https://example.com/path  ', 'https://example.com/path'],
    ['mailto:trader@example.com', 'mailto:trader@example.com'],
    ['mailto:a@example.com,b@example.com?subject=Hi', 'mailto:a@example.com,b@example.com?subject=Hi'],
  ])('%s opens', (href, expected) => {
    expect(openableLinkHref(href)).toBe(expected)
  })

  it.each([
    'javascript:alert(1)',
    'javascript:void(fetch("https://evil.example"))',
    'data:text/html,<script>alert(1)</script>',
    'mailto:',
    'mailto:not-an-email',
    'mailto:has space@example.com',
    '/journal/notebook/note/n1',
    'import-link://some-target-key',
    '',
    null,
    undefined,
    42,
  ])('%j never opens', (href) => {
    expect(openableLinkHref(href)).toBeNull()
  })
})

describe('a plain click — unchanged: never opens, never blocks the caret', () => {
  it('no modifier, no prior selection: window.open is never called and the click is not prevented', () => {
    const ed = mount([linkPara('read this', 'https://example.com/report')])
    const notPrevented = tap(linkEl(ed))
    expect(notPrevented).toBe(true) // fireEvent's dispatchEvent return: true = NOT defaultPrevented
    expect(openSpy).not.toHaveBeenCalled()
  })
})

describe('Ctrl/Cmd+click opens the link, safely, in a new tab', () => {
  it('Ctrl+click opens with noopener,noreferrer', () => {
    const ed = mount([linkPara('read this', 'https://example.com/report')])
    const notPrevented = tap(linkEl(ed), { ctrlKey: true })
    expect(notPrevented).toBe(false) // defaultPrevented
    expect(openSpy).toHaveBeenCalledWith('https://example.com/report', '_blank', 'noopener,noreferrer')
  })

  it('Cmd+click (metaKey) opens the same way', () => {
    const ed = mount([linkPara('read this', 'https://example.com/report')])
    tap(linkEl(ed), { metaKey: true })
    expect(openSpy).toHaveBeenCalledWith('https://example.com/report', '_blank', 'noopener,noreferrer')
  })

  it('a mailto: link opens on Ctrl+click too', () => {
    const ed = mount([linkPara('email the desk', 'mailto:desk@example.com')])
    tap(linkEl(ed), { ctrlKey: true })
    expect(openSpy).toHaveBeenCalledWith('mailto:desk@example.com', '_blank', 'noopener,noreferrer')
  })
})

describe('ruling 165: a TOUCH tap opens the link only when the caret is ALREADY inside it', () => {
  it('a touch tap with the caret already in this link opens it', () => {
    const ed = mount([linkPara('read this', 'https://example.com/report')])
    putCaretIn(ed, 'read this')
    tap(linkEl(ed), { pointerType: 'touch' })
    expect(openSpy).toHaveBeenCalledWith('https://example.com/report', '_blank', 'noopener,noreferrer')
  })

  it('CONTROL — the FIRST touch tap (caret not yet in the link) does not open it', () => {
    const ed = mount([linkPara('read this', 'https://example.com/report'), { type: 'paragraph', content: [{ type: 'text', text: 'elsewhere' }] }])
    putCaretIn(ed, 'elsewhere') // caret is NOT in the link
    tap(linkEl(ed), { pointerType: 'touch' })
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('CONTROL — the same already-selected setup on a MOUSE (not touch) never opens; a mouse always has Ctrl instead', () => {
    const ed = mount([linkPara('read this', 'https://example.com/report')])
    putCaretIn(ed, 'read this')
    tap(linkEl(ed), { pointerType: 'mouse' })
    expect(openSpy).not.toHaveBeenCalled()
  })
})

describe('controller ruling on FYI 2: a READ-ONLY view opens on a PLAIN click/tap', () => {
  it('a plain click on a read-only (editable:false) editor opens an http link, safely, in a new tab', () => {
    const ed = mount([linkPara('read this', 'https://example.com/report')], { editable: false })
    const notPrevented = tap(linkEl(ed))
    expect(notPrevented).toBe(false) // defaultPrevented: it opened
    expect(openSpy).toHaveBeenCalledWith('https://example.com/report', '_blank', 'noopener,noreferrer')
  })

  it('a plain TAP (no mod key, no prior selection) on a read-only editor opens it too — there is no caret to require', () => {
    const ed = mount([linkPara('read this', 'https://example.com/report')], { editable: false })
    tap(linkEl(ed), { pointerType: 'touch' })
    expect(openSpy).toHaveBeenCalledWith('https://example.com/report', '_blank', 'noopener,noreferrer')
  })

  it('javascript: and import-link:// still never open on a read-only plain click', () => {
    const ed = mount([
      linkPara('bad js', 'javascript:alert(1)'),
      linkPara('import placeholder', 'import-link://some-target-key'),
    ], { editable: false })
    ed.view.dom.querySelectorAll('a[href]').forEach((a) => tap(a))
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('CONTROL — an EDITABLE editor\'s plain click still does NOT open (only the read-only branch opens on a plain click)', () => {
    const ed = mount([linkPara('read this', 'https://example.com/report')]) // editable: true (default)
    const notPrevented = tap(linkEl(ed))
    expect(notPrevented).toBe(true) // NOT defaultPrevented -- the caret-placing click is untouched
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('CONTROL — the hover hint is NOT shown on a read-only view (no second gesture to name)', () => {
    const ed = mount([linkPara('read this', 'https://example.com/report')], { editable: false })
    const a = linkEl(ed)
    fireEvent.mouseOver(a)
    expect(a.title).toBe('')
  })
})

describe('ruling 165: hovering a link hints the gesture', () => {
  it('mouseover sets a native tooltip naming the mod key', () => {
    setPlatform('Win32')
    const ed = mount([linkPara('read this', 'https://example.com/report')])
    const a = linkEl(ed)
    expect(a.title).toBe('')
    fireEvent.mouseOver(a)
    expect(a.title).toBe('Ctrl+click to open')
    expect(linkOpenHint()).toBe('Ctrl+click to open')
  })

  it('on a Mac, the hint names Cmd instead', () => {
    setPlatform('MacIntel')
    const ed = mount([linkPara('read this', 'https://example.com/report')])
    fireEvent.mouseOver(linkEl(ed))
    expect(linkEl(ed).title).toBe('Cmd+click to open')
  })
})
