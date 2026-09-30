// Wave 10 (lane TY, standard 4 -- "typing < 16 ms/char up to the size cap").
// docs/notebook/perf-budgets.md §7: typing is over its 16 ms/char line at every
// measured size, and the harness's own attribution work names "React scheduler
// tasks (render + commit)" as a real, uncharacterised cost.
//
// `NoteEditorPage`'s toolbar-sync effect used to bump a bare counter on EVERY
// 'transaction' AND 'selectionUpdate' event TipTap's editor fires -- which is
// every single keystroke -- forcing this ~4,000-line component (and every
// unmemoised child in its tree) to re-render just so eleven `editor.isActive(...)`
// / `editor.getAttributes(...)` reads in the formatting toolbar stayed fresh.
// `toolbarStateReducer` fixes it: it computes the same signature those toolbar
// reads depend on and returns the SAME object reference when nothing in it
// changed, which is what lets React bail out of re-rendering the subtree
// (`useReducer`'s documented Object.is bailout) without changing anything the
// toolbar itself reads (still live `editor.isActive(...)` calls at render time).
//
// This file is a pure, isolated rail on that reducer -- not a full RTL mount of
// NoteEditorPage (which needs a large mock harness elsewhere in this directory)
// -- because the reducer is the ENTIRE mechanism: prove it returns the same
// reference when the signature is unchanged and a new one when it changed, and
// the re-render count follows for free (React's own behaviour, not ours to
// re-test).
import { describe, it, expect } from 'vitest'
import { readToolbarFormatState, toolbarStateReducer } from './NoteEditorPage'

/** A minimal stand-in exposing exactly what `readToolbarFormatState` reads,
 *  incl. TextColorMenu's `highlightActive`/`highlightColor` (the other child
 *  that reads `editor` at render time with no subscription of its own), the
 *  selection-emptiness gap the L12 full proof walk (G-131, touch) found, and
 *  `canBlockquote` (G-131 SECOND finding, L12 full walk 62e252649, desktop):
 *  `editor.can().toggleBlockquote()` -- the schema genuinely refuses the
 *  toggle with the caret inside a list item, which the button now surfaces
 *  as `disabled` instead of a silent dead click.
 *  TableToolbar is NOT represented here: it got its OWN `editor.on('transaction', …)`
 *  subscription (see TableToolbar.jsx, TableToolbar.test.jsx) rather than a
 *  field, because it reads far more at render time than one boolean. */
function fakeEditor(overrides = {}) {
  const state = {
    bold: false, italic: false, h1: false, h2: false, bulletList: false,
    orderedList: false, blockquote: false, codeBlock: false,
    fontFamily: '', fontSize: '', textColor: '',
    highlightActive: false, highlightColor: '',
    canUndo: true, canRedo: false, selectionEmpty: true, canBlockquote: true,
    ...overrides,
  }
  return {
    isDestroyed: false,
    isEditable: true,
    state: { selection: { empty: state.selectionEmpty } },
    isActive: (name, attrs) => {
      if (name === 'bold') return state.bold
      if (name === 'italic') return state.italic
      if (name === 'bulletList') return state.bulletList
      if (name === 'orderedList') return state.orderedList
      if (name === 'blockquote') return state.blockquote
      if (name === 'codeBlock') return state.codeBlock
      if (name === 'highlight') return state.highlightActive
      if (name === 'heading' && attrs?.level === 1) return state.h1
      if (name === 'heading' && attrs?.level === 2) return state.h2
      return false
    },
    getAttributes: (type) => {
      if (type === 'textStyle') return { fontFamily: state.fontFamily, fontSize: state.fontSize }
      if (type === 'textColor') return { color: state.textColor }
      if (type === 'highlight') return { color: state.highlightColor }
      return {}
    },
    can: () => ({
      undo: () => state.canUndo,
      redo: () => state.canRedo,
      toggleBlockquote: () => state.canBlockquote,
    }),
  }
}

describe('readToolbarFormatState', () => {
  it('reads every field the toolbar JSX reads live from `editor` (grep parity)', () => {
    const s = readToolbarFormatState(fakeEditor({ bold: true, fontFamily: 'Georgia', canRedo: true }))
    expect(s).toEqual({
      bold: true, italic: false, h1: false, h2: false, bulletList: false,
      orderedList: false, blockquote: false, canBlockquote: true, codeBlock: false,
      fontFamily: 'Georgia', fontSize: '', textColor: '',
      highlightActive: false, highlightColor: '',
      canUndo: true, canRedo: true, selectionEmpty: true,
    })
  })

  it('highlightColor is only read while a highlight is active (matches TextColorMenu.jsx\'s own guard)', () => {
    expect(readToolbarFormatState(fakeEditor({ highlightActive: false, highlightColor: 'stale' })).highlightColor)
      .toBe('') // not active: the field TextColorMenu shows is 'no highlight', not a leftover colour
    expect(readToolbarFormatState(fakeEditor({ highlightActive: true, highlightColor: 'blue' })).highlightColor)
      .toBe('blue')
  })
})

describe('toolbarStateReducer -- the bailout that stops a keystroke re-rendering the whole page', () => {
  it('first call after mount (prev=null) always produces a value (the one un-skippable render)', () => {
    const first = toolbarStateReducer(null, fakeEditor())
    expect(first).not.toBeNull()
  })

  it('a second call with an UNCHANGED signature returns the exact same object reference', () => {
    const ed = fakeEditor()
    const s1 = toolbarStateReducer(null, ed)
    const s2 = toolbarStateReducer(s1, ed)
    expect(s2).toBe(s1) // reference equality: this IS the React bailout signal
  })

  it('plain typing (no active-mark change) keeps returning the SAME reference across many keystrokes', () => {
    const ed = fakeEditor()
    let s = toolbarStateReducer(null, ed)
    const first = s
    for (let i = 0; i < 200; i += 1) s = toolbarStateReducer(s, ed) // 200 "keystrokes", nothing toolbar-relevant changes
    expect(s).toBe(first)
  })

  it('a change in ANY tracked field produces a NEW object reference', () => {
    const on = fakeEditor({ bold: true })
    const off = fakeEditor({ bold: false })
    const s1 = toolbarStateReducer(null, off)
    const s2 = toolbarStateReducer(s1, on)
    expect(s2).not.toBe(s1)
    expect(s2.bold).toBe(true)
  })

  it('undo/redo availability is tracked (Undo/Redo button disabled state)', () => {
    const before = fakeEditor({ canUndo: false, canRedo: false })
    const after = fakeEditor({ canUndo: true, canRedo: false })
    const s1 = toolbarStateReducer(null, before)
    const s2 = toolbarStateReducer(s1, after)
    expect(s2).not.toBe(s1)
  })

  it('font/size/colour changes are tracked (mutation target: dropping a field here would let those go stale behind a bailed-out render)', () => {
    const s1 = toolbarStateReducer(null, fakeEditor({ fontSize: '14px' }))
    const s2 = toolbarStateReducer(s1, fakeEditor({ fontSize: '18px' }))
    expect(s2).not.toBe(s1)
    const s3 = toolbarStateReducer(s1, fakeEditor({ textColor: '#c9a84c' }))
    expect(s3).not.toBe(s1)
  })

  it('G-131 (owner finding, L12 walk 62e252649, touch): selecting text (empty -> non-empty) produces a NEW reference even when no mark/block field moved -- TextColorMenu.apply() runs setTextColor()/setHighlight() against whatever selection is live at click time, and against an EMPTY selection that sets a stored mark for the next keystroke instead of colouring anything already on the page (\'no colour mark in the note\' is exactly that outcome). Tracked as the BOOLEAN empty flag, never the range itself, so continuous typing (selection stays collapsed throughout) pays no extra render', () => {
    const collapsed = fakeEditor({ selectionEmpty: true })
    const selected = fakeEditor({ selectionEmpty: false })
    const s1 = toolbarStateReducer(null, collapsed)
    const s2 = toolbarStateReducer(s1, selected)
    expect(s2).not.toBe(s1)
    expect(s2.selectionEmpty).toBe(false)
    const s3 = toolbarStateReducer(s2, collapsed)
    expect(s3).not.toBe(s2)
  })

  it('G-131 (SECOND finding, L12 full walk 62e252649, desktop): canBlockquote is tracked -- entering/leaving a context the schema refuses (caret moving in/out of a list item) re-renders the button so its `disabled` state never goes stale behind a bailed-out render (mutation target: dropping this field from readToolbarFormatState would let it stick)', () => {
    const allowed = fakeEditor({ canBlockquote: true })
    const refused = fakeEditor({ canBlockquote: false })
    const s1 = toolbarStateReducer(null, allowed)
    const s2 = toolbarStateReducer(s1, refused)
    expect(s2).not.toBe(s1)
    expect(s2.canBlockquote).toBe(false)
    const s3 = toolbarStateReducer(s2, allowed)
    expect(s3).not.toBe(s2)
    expect(s3.canBlockquote).toBe(true)
  })

  it('highlight state is tracked (Mod-Shift-H toggles it without opening the picker, per TextColorMenu.jsx\'s own header comment)', () => {
    const s1 = toolbarStateReducer(null, fakeEditor({ highlightActive: false }))
    const s2 = toolbarStateReducer(s1, fakeEditor({ highlightActive: true, highlightColor: 'yellow' }))
    expect(s2).not.toBe(s1)
    expect(s2.highlightActive).toBe(true)
  })

  it('CONTROL: 200 keystrokes of plain typing (selection stays collapsed the whole time) still return the SAME reference -- selectionEmpty/highlightActive do not cost the typing budget anything', () => {
    const ed = fakeEditor({ selectionEmpty: true })
    let s = toolbarStateReducer(null, ed)
    const first = s
    for (let i = 0; i < 200; i += 1) s = toolbarStateReducer(s, ed)
    expect(s).toBe(first)
  })

  it('a destroyed editor is a no-op: the reducer returns prev unchanged', () => {
    const ed = fakeEditor()
    const s1 = toolbarStateReducer(null, ed)
    const destroyed = { ...ed, isDestroyed: true }
    expect(toolbarStateReducer(s1, destroyed)).toBe(s1)
  })

  it('a null/undefined editor is a no-op: the reducer returns prev unchanged', () => {
    const s1 = toolbarStateReducer(null, fakeEditor())
    expect(toolbarStateReducer(s1, null)).toBe(s1)
    expect(toolbarStateReducer(s1, undefined)).toBe(s1)
  })
})
