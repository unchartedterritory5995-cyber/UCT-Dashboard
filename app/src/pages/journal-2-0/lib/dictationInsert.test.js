// Wave 7 lane H (H1) — dictated words land at the caret as ONE undo step.
//
// A REAL editor on the Notebook's own extension roster (buildExtensions), so
// the history plugin, the schema and insertContent are the ones a member runs.
// The undo assertions compare the WHOLE document text, never "the dictated
// words are gone": a Ctrl+Z that also took the member's typing with it would
// pass a presence check.
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { buildExtensions } from './tiptap'
import { dictationText, insertDictation, DICTATE_EVENT } from './dictationInsert'

const P = (t) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })

let editor
function make(content = { type: 'doc', content: [P('Hello')] }, { caret = 'end' } = {}) {
  // A MOUNTED editor: `insertDictation` refuses one with no live view (its
  // `editor.view` is a throwing getter until it mounts — NoteEditorPage R5-1).
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content })
  // caret at the end of the document, where a member dictates
  editor.commands.setTextSelection(caret === 'end' ? editor.state.doc.content.size - 1 : caret)
  return editor
}
afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })

const text = () => editor.state.doc.textContent

describe('dictationText', () => {
  it('collapses whitespace and trims; nothing heard is empty', () => {
    expect(dictationText('  buy   the\n\nbreakout  ')).toBe('buy the breakout')
    expect(dictationText('')).toBe('')
    expect(dictationText(null)).toBe('')
  })
})

describe('insertDictation — at the caret, one undoable step', () => {
  it('inserts at the caret with a separating space after a word', () => {
    make()
    expect(insertDictation(editor, 'world')).toBe(true)
    expect(text()).toBe('Hello world')
  })

  it('Ctrl+Z removes exactly the dictated words — typing made just before them stays', () => {
    make()
    // typing, immediately followed by a dictation: without closeHistory the two
    // would share one undo event (same newGroupDelay window)
    editor.commands.insertContent(' there')
    insertDictation(editor, 'buy the breakout')
    expect(text()).toBe('Hello there buy the breakout')
    editor.commands.undo()
    expect(text()).toBe('Hello there')
  })

  it('typing right after a dictation is its own step', () => {
    make()
    insertDictation(editor, 'first')
    editor.commands.insertContent('!')
    expect(text()).toBe('Hello first!')
    editor.commands.undo()
    expect(text()).toBe('Hello first')
    editor.commands.undo()
    expect(text()).toBe('Hello')
  })

  it('a second dictation is a second step', () => {
    make()
    insertDictation(editor, 'one')
    insertDictation(editor, 'two')
    expect(text()).toBe('Hello one two')
    editor.commands.undo()
    expect(text()).toBe('Hello one')
  })

  it('the words are plain text, never parsed as HTML', () => {
    make()
    insertDictation(editor, 'price <b>under</b> 50 & falling')
    expect(text()).toBe('Hello price <b>under</b> 50 & falling')
  })

  it('a SELECTED NODE is never replaced — the words land after it', () => {
    make({ type: 'doc', content: [P('Top'), { type: 'horizontalRule' }, P('Bottom')] })
    let hrPos = null
    editor.state.doc.descendants((n, pos) => { if (n.type.name === 'horizontalRule') hrPos = pos })
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, hrPos)))
    expect(editor.state.selection.node?.type.name).toBe('horizontalRule')
    expect(insertDictation(editor, 'kept')).toBe(true)
    const types = []
    editor.state.doc.forEach((n) => types.push(n.type.name))
    expect(types).toContain('horizontalRule')
    expect(text()).toContain('kept')
  })

  it('nothing heard inserts nothing and reports false', () => {
    make()
    expect(insertDictation(editor, '   ')).toBe(false)
    expect(text()).toBe('Hello')
  })

  it('an editor with no live view refuses without throwing (`editor.view` throws there)', () => {
    // `element: null` is tiptap v3's genuinely view-less editor (its default is
    // a detached <div>, which DOES have a view).
    const unmounted = new Editor({ element: null, extensions: buildExtensions(), content: { type: 'doc', content: [P('x')] } })
    expect(unmounted.isDestroyed).toBe(true)
    try {
      expect(() => insertDictation(unmounted, 'words')).not.toThrow()
      expect(insertDictation(unmounted, 'words')).toBe(false)
    } finally {
      unmounted.destroy()
    }
  })

  it('a read-only editor (locked or unreadable) takes nothing and reports false', () => {
    make()
    editor.setEditable(false, false)
    expect(insertDictation(editor, 'nope')).toBe(false)
    expect(text()).toBe('Hello')
  })

})

describe('the slash menu\'s "Dictate" item', () => {
  it('is offered only while THIS editor\'s mic can dictate — never a dead item', async () => {
    const { ITEMS, blockItemsAvailable } = await import('../components/notebook/SlashMenu')
    expect(ITEMS.some((i) => i.title === 'Dictate')).toBe(true)
    make()
    const offered = () => blockItemsAvailable(editor).some((i) => i.title === 'Dictate')
    // no mic handle published (unpaid member, recorder still loading, no support)
    expect(offered()).toBe(false)
    editor.storage.uctJournalWidgets = { canDictate: () => false }
    expect(offered()).toBe(false)
    editor.storage.uctJournalWidgets = { canDictate: () => true }
    expect(offered()).toBe(true)
  })

  it('removes its "/dictate" text and asks ITS OWN editor (never window) to start', async () => {
    const { ITEMS } = await import('../components/notebook/SlashMenu')
    const item = ITEMS.find((i) => i.title === 'Dictate')
    // caret at the START: a caret after "/dictate" would open the real slash
    // menu, which measures the page (jsdom has no layout). The item's command
    // acts on the range it is handed, wherever the caret is.
    make({ type: 'doc', content: [P('Hello /dictate')] }, { caret: 1 })
    const heard = []
    editor.view.dom.addEventListener(DICTATE_EVENT, (e) => heard.push(e.type))
    const onWindow = []
    const winListener = (e) => onWindow.push(e.target)
    window.addEventListener(DICTATE_EVENT, winListener)
    try {
      const end = editor.state.doc.content.size - 1
      item.command({ editor, range: { from: end - '/dictate'.length, to: end } })
    } finally {
      window.removeEventListener(DICTATE_EVENT, winListener)
    }
    expect(heard).toEqual([DICTATE_EVENT])
    expect(text()).toBe('Hello ')
    // it bubbles (like the Image item's event), so it reaches window only
    // through this editor's own DOM — its target is this editor, never window
    for (const t of onWindow) expect(t).toBe(editor.view.dom)
  })
})
