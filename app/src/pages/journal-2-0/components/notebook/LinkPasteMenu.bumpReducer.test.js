// Wave 10 (lane TY7, "whose caller" perf pass).
//
// `linkOfferBumpReducer` replaced a bare counter (`(x) => x + 1`) that bumped
// on EVERY transaction in EVERY note, pasted-link offer or not -- forcing a
// React commit (and the O(doc-size) selection-offset walk
// `commitBeforeMutationEffects` runs on every commit while the editor has
// focus, confirmed via `docs/notebook/perf-runs/ty7/`) on every keystroke of
// every note. This is a pure, isolated rail on the reducer, mirroring
// `NoteEditorPage.toolbarRerender.test.js`'s own convention for
// `toolbarStateReducer`: the reducer is the entire mechanism -- prove it
// bails to the SAME reference when `linkPasteKey`'s own plugin state hasn't
// changed, and produces a NEW one when it has, and the re-render behaviour
// follows for free (React's own, not ours to re-test).
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { buildExtensions } from '../../lib/tiptap'
import { linkPasteKey } from '../../lib/linkPasteOffer'
import { linkOfferBumpReducer } from './LinkPasteMenu'

let editor
afterEach(() => { editor?.destroy(); editor = null })

function mount() {
  const el = document.createElement('div')
  editor = new Editor({
    element: el, extensions: buildExtensions(),
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
  })
  return editor
}

/** Same shape placeLinkBlock's paste handler sets on an offer -- a real
 *  object, not a stand-in, so this test exercises the SAME plugin.apply()
 *  path a real paste does. */
const OFFER = { from: 1, to: 6, url: 'https://example.com', preview: true, embed: null }

describe('linkOfferBumpReducer: the bailout that stops a keystroke re-rendering LinkPasteMenu with no offer on screen', () => {
  it('plain typing (no offer, ever) keeps returning the SAME reference across many transactions', () => {
    mount()
    let s = linkOfferBumpReducer(null, editor)
    const first = s
    for (let i = 0; i < 50; i += 1) {
      editor.view.dispatch(editor.state.tr.insertText('x'))
      s = linkOfferBumpReducer(s, editor)
    }
    expect(s).toBe(first)
    expect(linkPasteKey.getState(editor.state)).toBeNull()
  })

  it('an offer appearing produces a NEW reference', () => {
    mount()
    const s1 = linkOfferBumpReducer(null, editor)
    editor.view.dispatch(editor.state.tr.setMeta(linkPasteKey, { offer: OFFER }))
    const s2 = linkOfferBumpReducer(s1, editor)
    expect(s2).not.toBe(s1)
    expect(s2).toEqual(OFFER)
  })

  it('the offer surviving an UNRELATED transaction (selection stays inside it) keeps returning the SAME reference -- the plugin\'s own apply() already returns the identical object, which is what this reducer leans on', () => {
    mount()
    editor.view.dispatch(editor.state.tr.setMeta(linkPasteKey, { offer: OFFER }))
    const s1 = linkOfferBumpReducer(null, editor)
    // a selection move that STAYS inside the offer's own range is the one
    // case linkPasteOffer.js's own apply() keeps the value for -- see its
    // header: "tr.selectionSet && (!tr.selection.empty || tr.selection.from !== value.to)"
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, OFFER.to)))
    const s2 = linkOfferBumpReducer(s1, editor)
    expect(s2).toBe(s1)
  })

  it('dismissing the offer (Escape) produces a NEW reference back to null, and further typing then bails to THAT null', () => {
    mount()
    editor.view.dispatch(editor.state.tr.setMeta(linkPasteKey, { offer: OFFER }))
    const s1 = linkOfferBumpReducer(null, editor)
    editor.view.dispatch(editor.state.tr.setMeta(linkPasteKey, { offer: null }))
    const s2 = linkOfferBumpReducer(s1, editor)
    expect(s2).not.toBe(s1)
    expect(s2).toBeNull()
    editor.view.dispatch(editor.state.tr.insertText('y'))
    const s3 = linkOfferBumpReducer(s2, editor)
    expect(s3).toBe(s2)
  })

  it('a destroyed editor is a no-op: the reducer returns prev unchanged', () => {
    mount()
    const s1 = linkOfferBumpReducer(null, editor)
    const destroyed = { ...editor, isDestroyed: true }
    expect(linkOfferBumpReducer(s1, destroyed)).toBe(s1)
  })

  it('a null/undefined editor is a no-op: the reducer returns prev unchanged', () => {
    mount()
    const s1 = linkOfferBumpReducer(null, editor)
    expect(linkOfferBumpReducer(s1, null)).toBe(s1)
    expect(linkOfferBumpReducer(s1, undefined)).toBe(s1)
  })

  it('a non-editable editor reads as no offer, consistently (same reference across calls)', () => {
    mount()
    editor.setEditable(false)
    let s = linkOfferBumpReducer(null, editor)
    const first = s
    editor.view.dispatch(editor.state.tr.insertText('z'))
    s = linkOfferBumpReducer(s, editor)
    expect(s).toBe(first)
  })
})
