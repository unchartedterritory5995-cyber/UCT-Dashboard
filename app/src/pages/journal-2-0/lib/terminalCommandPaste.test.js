// TERM-056 (lane N) — the Notebook half of the command-string interchange. A REAL editor over
// the app's own roster (buildExtensions()) and the REAL terminal interchange module, so the
// rails cover the schema keeping the link, the paste making it, and the click opening it.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { buildExtensions } from './tiptap'
import { pasteTerminalCommand } from './terminalCommandPaste'
import { openableLinkHref } from './linkClickOpen'
import { latchNotebookFlags, __resetNotebookFlags } from './offline/notebookFlags'
import * as interchange from '../../terminal/commandInterchange'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

let editor
let openSpy
beforeEach(() => { openSpy = vi.spyOn(window, 'open').mockImplementation(() => {}) })
afterEach(() => {
  editor?.destroy(); editor = null
  openSpy.mockRestore()
  __resetNotebookFlags()
  document.body.innerHTML = ''
})

function mount(content = '<p>See:</p>', opts = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content, ...opts })
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)))
  return editor
}
const pasteEvent = (text) => ({ clipboardData: { getData: (t) => (t === 'text/plain' ? text : '') }, preventDefault: vi.fn() })
const links = (ed) => {
  const out = []
  ed.state.doc.descendants((n) => {
    const m = n.marks?.find((k) => k.type.name === 'link')
    if (n.isText && m) out.push({ text: n.text, href: m.attrs.href })
  })
  return out
}

describe('pasting a terminal command into a note', () => {
  it('a command becomes a link to the terminal at that command', () => {
    const ed = mount()
    const ev = pasteEvent('NVDA GRADE')
    expect(pasteTerminalCommand(ed.view, ev, interchange)).toBe(true)
    expect(ev.preventDefault).toHaveBeenCalled()
    expect(links(ed)).toEqual([{ text: 'NVDA GRADE', href: '/terminal?cmd=NVDA%20GRADE' }])
    expect(ed.getText()).toBe('See:NVDA GRADE')
  })

  it('a board address and a note address work the same way', () => {
    const ed = mount()
    pasteTerminalCommand(ed.view, pasteEvent('B:semis-daily'), interchange)
    pasteTerminalCommand(ed.view, pasteEvent(' N:42'), interchange)
    expect(links(ed).map((l) => l.href)).toEqual(['/terminal?cmd=B%3Asemis-daily', '/terminal?cmd=N%3A42'])
  })

  it('typing on after the link writes plain text, not more link', () => {
    const ed = mount()
    pasteTerminalCommand(ed.view, pasteEvent('NVDA GRADE'), interchange)
    ed.view.dispatch(ed.state.tr.insertText(' looks good'))
    expect(links(ed)).toEqual([{ text: 'NVDA GRADE', href: '/terminal?cmd=NVDA%20GRADE' }])
  })

  it('prose, a bare ticker and a lower-case line stay ordinary pastes (not handled)', () => {
    const ed = mount()
    for (const t of ['Revenue was up 12%', 'NVDA', 'nvda grade']) {
      expect(pasteTerminalCommand(ed.view, pasteEvent(t), interchange)).toBe(false)
    }
    expect(links(ed)).toEqual([])
  })

  it('inside a code block a command stays code', () => {
    const ed = mount('<pre><code>x</code></pre>')
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 2)))
    expect(ed.state.selection.$from.parent.type.name).toBe('codeBlock')
    expect(pasteTerminalCommand(ed.view, pasteEvent('NVDA GRADE'), interchange)).toBe(false)
  })

  it('before the terminal grammar has loaded (or with the gate off) nothing is handled', () => {
    const ed = mount()
    expect(pasteTerminalCommand(ed.view, pasteEvent('NVDA GRADE'), null)).toBe(false)
    expect(links(ed)).toEqual([])
  })
})

describe('the stored link', () => {
  it('survives the schema: the Link mark keeps a /terminal?cmd= href through HTML', () => {
    const ed = mount('<p><a href="/terminal?cmd=NVDA%20GRADE">NVDA GRADE</a></p>')
    expect(links(ed)).toEqual([{ text: 'NVDA GRADE', href: '/terminal?cmd=NVDA%20GRADE' }])
    expect(ed.getHTML()).toContain('href="/terminal?cmd=NVDA%20GRADE"')
  })

  it('opens only while the gate is on; off it is inert like any internal path', () => {
    const href = '/terminal?cmd=NVDA%20GRADE'
    expect(openableLinkHref(href)).toBeNull()                       // nothing latched
    latchNotebookFlags({ notebook_terminal_links_enabled: false })
    expect(openableLinkHref(href)).toBeNull()
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_terminal_links_enabled: true })
    expect(openableLinkHref(href)).toBe(href)
    // the gate opens THIS door only: other internal paths stay closed
    expect(openableLinkHref('/journal/notebook?note=1')).toBeNull()
    expect(openableLinkHref('/terminal?cmd=')).toBeNull()
  })

  it('a read-only note opens it on a plain click, in a new tab', () => {
    latchNotebookFlags({ notebook_terminal_links_enabled: true })
    const ed = mount('<p><a href="/terminal?cmd=NVDA%20GRADE">NVDA GRADE</a></p>', { editable: false })
    fireEvent.click(ed.view.dom.querySelector('a'))
    expect(openSpy).toHaveBeenCalledWith('/terminal?cmd=NVDA%20GRADE', '_blank', 'noopener,noreferrer')
  })
})
