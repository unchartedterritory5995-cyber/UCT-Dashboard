// Ruling 165 — Ctrl/Cmd+click (and a touch re-tap) to open a link in the
// note editor. REAL editor over the app's own roster (buildExtensions()),
// same idiom as blockHandle.test.js / webLinks.test.jsx: a plugin wired into
// the actual schema, not a reimplementation tested in isolation.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { buildExtensions } from './tiptap'
import fs from 'node:fs'
import path from 'node:path'
import {
  openableLinkHref, linkOpenHint, internalNoteIdFromHref, pendingLinkFallbackHref,
} from './linkClickOpen'

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
    '/journal?j2tab=notebook&note=n1', // an internal note link is its own door (uct:open-note), never a window.open
    'import-link://some-target-key',
    'import-link://notion:1a2b3c4d-5e6f-47a8-b9c0-d1e2f3a4b5c6', // its own door too (pendingLinkFallbackHref)
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

// ── Plan A Task 2 (L-1): an internal note link opens IN-APP ──────────────────
const INTERNAL = '/journal?j2tab=notebook&note=n123'

describe('internalNoteIdFromHref — exactly the in-app note link shape', () => {
  it.each([
    ['/journal?j2tab=notebook&note=n123', 'n123'],
    ['/journal?note=n123&j2tab=notebook', 'n123'], // params in any order
    ['/journal?j2tab=notebook&note=a_B-9', 'a_B-9'],
  ])('%j -> %j', (href, id) => {
    expect(internalNoteIdFromHref(href)).toBe(id)
  })

  it.each([
    '/journal?j2tab=notebook&note=',
    '/journal?j2tab=notebook&note=a b',
    '/journal/x?note=n1',
    'javascript:alert(1)',
    '/journal/notebook/note/n1',
    '/journal?note=n1',
    '/journal?j2tab=calendar&note=n1',
    '/journal?j2tab=notebook&note=n1&x=1',
    '/journal?j2tab=notebook&note=n1#frag',
    'https://uctintelligence.com/journal?j2tab=notebook&note=n1',
    'import-link://n1',
    '',
    null,
    undefined,
  ])('%j is not an internal note link', (h) => {
    expect(internalNoteIdFromHref(h)).toBeNull()
  })
})

describe('L-1: a resolved internal link opens in-app (uct:open-note)', () => {
  it('a resolved internal link opens in-app on Ctrl+click, same tab', () => {
    const ed = mount([linkPara('Other note', INTERNAL)])
    const seen = vi.fn((e) => e.preventDefault())
    ed.view.dom.addEventListener('uct:open-note', seen)
    const notPrevented = tap(linkEl(ed), { ctrlKey: true })
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0][0].detail.noteId).toBe('n123')
    expect(seen.mock.calls[0][0].detail.originalEvent.ctrlKey).toBe(true)
    expect(notPrevented).toBe(false)
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('unhandled internal open falls back to history + popstate', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {})
    const pop = vi.fn()
    window.addEventListener('popstate', pop)
    try {
      const ed = mount([linkPara('Other note', INTERNAL)])
      tap(linkEl(ed), { ctrlKey: true })
      expect(pushSpy).toHaveBeenCalledWith(null, '', INTERNAL)
      expect(pop).toHaveBeenCalledTimes(1)
      expect(openSpy).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('popstate', pop)
      pushSpy.mockRestore()
    }
  })

  it('CONTROL — a HANDLED internal open never touches history', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {})
    try {
      const ed = mount([linkPara('Other note', INTERNAL)])
      ed.view.dom.addEventListener('uct:open-note', (e) => e.preventDefault())
      tap(linkEl(ed), { ctrlKey: true })
      expect(pushSpy).not.toHaveBeenCalled()
    } finally {
      pushSpy.mockRestore()
    }
  })

  it('read-only view: a plain click opens an internal link in-app', () => {
    const ed = mount([linkPara('Other note', INTERNAL)], { editable: false })
    const seen = vi.fn((e) => e.preventDefault())
    ed.view.dom.addEventListener('uct:open-note', seen)
    const notPrevented = tap(linkEl(ed))
    expect(seen.mock.calls[0][0].detail.noteId).toBe('n123')
    expect(notPrevented).toBe(false)
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('touch re-tap opens an internal link in-app', () => {
    const ed = mount([linkPara('Other note', INTERNAL)])
    const seen = vi.fn((e) => e.preventDefault())
    ed.view.dom.addEventListener('uct:open-note', seen)
    putCaretIn(ed, 'Other note')
    tap(linkEl(ed), { pointerType: 'touch' })
    expect(seen.mock.calls[0][0].detail.noteId).toBe('n123')
  })

  it('a plain click in an editable editor still never opens', () => {
    const ed = mount([linkPara('Other note', INTERNAL)])
    const seen = vi.fn((e) => e.preventDefault())
    ed.view.dom.addEventListener('uct:open-note', seen)
    const notPrevented = tap(linkEl(ed))
    expect(seen).not.toHaveBeenCalled()
    expect(notPrevented).toBe(true)
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('hovering an internal link hints the gesture', () => {
    setPlatform('Win32')
    const ed = mount([linkPara('Other note', INTERNAL)])
    fireEvent.mouseOver(linkEl(ed))
    expect(linkEl(ed).title).toBe('Ctrl+click to open')
  })
})

// ── Plan A Task 2 (B A5 + controller ruling 2): unresolved placeholders ──────
const NOTION_UUID = 'import-link://notion:1a2b3c4d-5e6f-47a8-b9c0-d1e2f3a4b5c6'
const NOTION_URL = 'https://www.notion.so/1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6'

describe('pendingLinkFallbackHref — only a real Notion page id has a door', () => {
  it.each([
    [NOTION_UUID, NOTION_URL],
    ['import-link://notion:1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6', NOTION_URL],
    ['import-link://notion:1A2B3C4D-5E6F-47A8-B9C0-D1E2F3A4B5C6', NOTION_URL],
  ])('%j -> %j', (href, url) => {
    expect(pendingLinkFallbackHref(href)).toBe(url)
  })

  it.each([
    'import-link://some-target-key',
    'import-link://notion:row-0',
    'import-link://notion:Workspace/Page%20Title.md', // Plan B's path-based keys stay plain text
    'import-link://notion:1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c', // 31 hex
    'import-link://notion:1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6x',
    'import-link://notion:1a2b3c4d-5e6f47a8b9c0d1e2f3a4b5c6', // half dashed
    'import-link://roam:1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6',
    'https://www.notion.so/1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6',
    '',
    null,
  ])('%j has no fallback', (href) => {
    expect(pendingLinkFallbackHref(href)).toBeNull()
  })
})

describe('B A5: an unresolved placeholder is plain text; a Notion page id opens notion.so', () => {
  it('import-link://notion:<uuid> opens notion.so in a new tab on Ctrl+click', () => {
    const ed = mount([linkPara('Notion page', NOTION_UUID)])
    tap(linkEl(ed), { ctrlKey: true })
    expect(openSpy).toHaveBeenCalledWith(NOTION_URL, '_blank', 'noopener,noreferrer')
  })

  it('import-link://notion:<uuid> opens on a read-only plain click too, and is hinted on hover', () => {
    setPlatform('Win32')
    const ed = mount([linkPara('Notion page', NOTION_UUID)])
    fireEvent.mouseOver(linkEl(ed))
    expect(linkEl(ed).title).toBe('Ctrl+click to open')
    ed.destroy()
    const ro = mount([linkPara('Notion page', NOTION_UUID)], { editable: false })
    tap(linkEl(ro))
    expect(openSpy).toHaveBeenCalledWith(NOTION_URL, '_blank', 'noopener,noreferrer')
  })

  it.each(['import-link://some-target-key', 'import-link://notion:row-0', 'import-link://notion:Folder/Page.md'])(
    'any other import-link:// never opens and gets no hover hint (plain text): %s', (href) => {
      setPlatform('Win32')
      const ed = mount([linkPara('pending', href)])
      const seen = vi.fn()
      ed.view.dom.addEventListener('uct:open-note', seen)
      const a = linkEl(ed)
      fireEvent.mouseOver(a)
      expect(a.title).toBe('')
      tap(a, { ctrlKey: true })
      expect(openSpy).not.toHaveBeenCalled()
      expect(seen).not.toHaveBeenCalled()
    })

  it('a read-only plain click on a plain-text placeholder is swallowed (the browser must not follow it either)', () => {
    const ed = mount([linkPara('pending', 'import-link://some-target-key')], { editable: false })
    const notPrevented = tap(linkEl(ed))
    expect(notPrevented).toBe(false)
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('an import-link:// anchor is styled as plain text — decided in JS, never by a CSS href prefix', () => {
    const ed = mount([
      linkPara('pending', 'import-link://some-target-key'),
      linkPara('notion path', 'import-link://notion:Folder/Page.md'),
      linkPara('notion page', NOTION_UUID),
      linkPara('other note', INTERNAL),
      linkPara('web', 'https://example.com/x'),
    ])
    const marked = [...ed.view.dom.querySelectorAll('a[href]')].map((a) => [a.textContent, a.hasAttribute('data-link-plain')])
    expect(marked).toEqual([
      ['pending', true], ['notion path', true], ['notion page', false], ['other note', false], ['web', false],
    ])
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/journal-2-0/lib/noteContent.css'), 'utf8')
    expect(css).toMatch(/\.ProseMirror a\[href\]\[data-link-plain\]\s*\{[^}]*color:\s*inherit;[^}]*text-decoration:\s*none;[^}]*cursor:\s*text;/)
    // Controller ruling 2: no rule may key on the notion: prefix (Plan B's path keys share it).
    expect(css).not.toMatch(/import-link:\/\/notion:/)
  })
})
