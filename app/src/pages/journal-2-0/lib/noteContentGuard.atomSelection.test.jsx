/**
 * A note that opens with a block atom (an imported tweet card, a horizontal rule) must not sit on a
 * NodeSelection nobody made. ProseMirror's `keypress` handler inserts over any non-text selection,
 * so a first keystroke that beats the click's `selectionchange` replaced the card.
 * Browser proof: tools/tweet_import_smoke.py --caret-repro.
 */
import { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { buildExtensions } from './tiptap'
import { NoImplicitAtomSelection, replaceDocument } from './noteContentGuard'
import noteEditorPageSource from '../components/notebook/NoteEditorPage.jsx?raw'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const OPENS_WITH_ATOM = { type: 'doc', content: [{ type: 'horizontalRule' }, para('below the rule')] }
const OPENS_WITH_TEXT = { type: 'doc', content: [para('first line'), { type: 'horizontalRule' }, para('last line')] }

const live = []

async function open(content, extra = [NoImplicitAtomSelection]) {
  const editor = new Editor({ element: document.createElement('div'), extensions: [...buildExtensions(), ...extra], content })
  live.push(editor)
  // TipTap emits `create` on the next tick.
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  return editor
}

/** The keypress ProseMirror's own handler answers, the way a real key reaches it. */
function press(editor, ch) {
  editor.view.dom.dispatchEvent(new KeyboardEvent('keypress', {
    key: ch, charCode: ch.charCodeAt(0), bubbles: true, cancelable: true,
  }))
}

const ruleCount = (editor) => {
  let n = 0
  editor.state.doc.descendants((node) => { if (node.type.name === 'horizontalRule') n += 1 })
  return n
}

afterEach(() => {
  while (live.length) live.pop().destroy()
})

describe('the default the bug is made of (no guard)', () => {
  it('opens on a NodeSelection and a key replaces the atom', async () => {
    const editor = await open(OPENS_WITH_ATOM, [])
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
    press(editor, 'p')
    expect(ruleCount(editor)).toBe(0)
  })
})

describe('NoImplicitAtomSelection', () => {
  it('opens a note that starts with an atom on a text position, and a key leaves the atom', async () => {
    const editor = await open(OPENS_WITH_ATOM)
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection)
    expect(editor.state.selection.$from.parent.isTextblock).toBe(true)
    press(editor, 'p')
    expect(ruleCount(editor)).toBe(1)
  })

  it('leaves no NodeSelection when a stored body arrives after the editor opened', async () => {
    // The caret maps to the end of the replaced range, so a body ENDING in an atom is the one
    // that would put a NodeSelection on it.
    const editor = await open(OPENS_WITH_TEXT)
    const endsWithAtom = { type: 'doc', content: [para('above the rule'), { type: 'horizontalRule' }] }
    expect(replaceDocument(editor, endsWithAtom, { emitUpdate: false })).toBe(true)
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection)
    press(editor, 'p')
    expect(ruleCount(editor)).toBe(1)
  })

  it('leaves a NodeSelection the member made alone', async () => {
    const editor = await open(OPENS_WITH_TEXT)
    const at = editor.state.doc.child(0).nodeSize
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, at)))
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
    expect(editor.state.selection.from).toBe(at)
  })

  it('leaves a text selection alone when it opens', async () => {
    const editor = await open(OPENS_WITH_TEXT)
    expect(editor.state.selection.from).toBe(1)
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection)
  })

  it('puts nothing in the undo stack', async () => {
    const editor = await open(OPENS_WITH_ATOM)
    expect(editor.can().undo()).toBe(false)
  })
})

describe('the note editor uses it', () => {
  it('is in the extension list of the page members write in', () => {
    expect(noteEditorPageSource).toMatch(/extensions: \[\.\.\.buildExtensions\(\), HistoryCompleteWatch, NoImplicitAtomSelection\]/)
  })
})
