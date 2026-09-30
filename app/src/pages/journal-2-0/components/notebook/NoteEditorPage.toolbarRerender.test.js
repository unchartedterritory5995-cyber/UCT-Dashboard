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

/** A minimal stand-in exposing exactly what `readToolbarFormatState` reads. */
function fakeEditor(overrides = {}) {
  const state = {
    bold: false, italic: false, h1: false, h2: false, bulletList: false,
    orderedList: false, blockquote: false, codeBlock: false,
    fontFamily: '', fontSize: '', textColor: '',
    canUndo: true, canRedo: false, inTable: false,
    ...overrides,
  }
  // `readToolbarFormatState` also calls `tableAtSelection(editor.state)` (TableToolbar's
  // OWN predicate, imported and reused -- never a second copy) -- a minimal $from stand-in
  // that either has no ancestors (depth 0, not in a table) or one 'table' ancestor.
  const $from = state.inTable
    ? { depth: 1, node: (d) => (d === 1 ? { type: { name: 'table' } } : null), before: () => 0 }
    : { depth: 0 }
  return {
    isDestroyed: false,
    isEditable: true,
    state: { selection: { $from } },
    isActive: (name, attrs) => {
      if (name === 'bold') return state.bold
      if (name === 'italic') return state.italic
      if (name === 'bulletList') return state.bulletList
      if (name === 'orderedList') return state.orderedList
      if (name === 'blockquote') return state.blockquote
      if (name === 'codeBlock') return state.codeBlock
      if (name === 'heading' && attrs?.level === 1) return state.h1
      if (name === 'heading' && attrs?.level === 2) return state.h2
      return false
    },
    getAttributes: (type) => {
      if (type === 'textStyle') return { fontFamily: state.fontFamily, fontSize: state.fontSize }
      if (type === 'textColor') return { color: state.textColor }
      return {}
    },
    can: () => ({ undo: () => state.canUndo, redo: () => state.canRedo }),
  }
}

describe('readToolbarFormatState', () => {
  it('reads every field the toolbar JSX reads live from `editor` (grep parity)', () => {
    const s = readToolbarFormatState(fakeEditor({ bold: true, fontFamily: 'Georgia', canRedo: true }))
    expect(s).toEqual({
      bold: true, italic: false, h1: false, h2: false, bulletList: false,
      orderedList: false, blockquote: false, codeBlock: false,
      fontFamily: 'Georgia', fontSize: '', textColor: '',
      canUndo: true, canRedo: true, inTable: false,
    })
  })

  it('inTable reflects TableToolbar\'s own predicate (tableAtSelection), reused not restated', () => {
    expect(readToolbarFormatState(fakeEditor({ inTable: false })).inTable).toBe(false)
    expect(readToolbarFormatState(fakeEditor({ inTable: true })).inTable).toBe(true)
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

  it('the caret entering or leaving a table produces a NEW reference (regression: TableToolbar reads tableAtSelection live at its OWN render with no subscription of its own, and relies entirely on THIS reducer re-rendering its parent -- NoteEditorPage.wave6.test.jsx caught this live, "Add a row" never appeared behind a bailed-out render before `inTable` was added)', () => {
    const outside = fakeEditor({ inTable: false })
    const inside = fakeEditor({ inTable: true })
    const s1 = toolbarStateReducer(null, outside)
    const s2 = toolbarStateReducer(s1, inside)
    expect(s2).not.toBe(s1)
    expect(s2.inTable).toBe(true)
    const s3 = toolbarStateReducer(s2, outside)
    expect(s3).not.toBe(s2)
    expect(s3.inTable).toBe(false)
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
