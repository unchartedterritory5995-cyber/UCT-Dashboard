// Wave 10 (lane TY7, "whose caller" perf pass).
//
// `nodeActiveAtCursor` / `canBlockquoteFast` replace an O(doc size) prosemirror
// walk with an O(depth) read of the selection's ALREADY-RESOLVED ancestor
// chain, for the common collapsed-selection case. This file is the
// EQUIVALENCE PROOF the fix brief asks for: a REAL editor (real schema, real
// `buildExtensions()`), comparing the fast path against the real
// `editor.isActive(...)` / `editor.can().toggleBlockquote()` it replaces,
// across every node type the toolbar checks and a flat doc large enough that
// the OLD O(n) walk and the NEW O(depth) walk would disagree if the fast path
// were wrong about which ancestors "contain the cursor".
import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { buildExtensions } from './tiptap'
import { nodeActiveAtCursor, canBlockquoteFast, __test__ } from './fastToolbarProbes'
import { canRunHistory } from '../components/notebook/NoteEditorPage'

let editor
afterEach(() => { editor?.destroy(); editor = null })

function mount(content) {
  const el = document.createElement('div')
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content } })
  return editor
}
const P = (t) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })
const H = (level, t) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text: t }] })
const BQ = (t) => ({ type: 'blockquote', content: [P(t)] })
const CODE = (t) => ({ type: 'codeBlock', content: t ? [{ type: 'text', text: t }] : [] })
const BULLET = (...items) => ({ type: 'bulletList', content: items.map((t) => ({ type: 'listItem', content: [P(t)] })) })
const ORDERED = (...items) => ({ type: 'orderedList', content: items.map((t) => ({ type: 'listItem', content: [P(t)] })) })

/** Put the collapsed caret inside the text node whose text is `marker`. */
function caretAt(ed, marker) {
  let at = null
  ed.state.doc.descendants((n, pos) => { if (at == null && n.isText && n.text === marker) at = pos + 1 })
  if (at == null) throw new Error(`marker not found: ${marker}`)
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, at)))
  return at
}

const NODE_TYPES = [
  ['heading', { level: 1 }], ['heading', { level: 2 }], ['heading', { level: 3 }],
  ['bulletList', {}], ['orderedList', {}], ['blockquote', {}], ['codeBlock', {}], ['paragraph', {}],
]

/** Every fast-path answer equals the real editor.isActive answer, for every
 *  tracked node type, at the editor's CURRENT (collapsed) selection. */
function assertAllTypesMatch(ed) {
  for (const [type, attrs] of NODE_TYPES) {
    const fast = nodeActiveAtCursor(ed, type, attrs)
    const real = ed.isActive(type, attrs)
    expect({ type, attrs, fast }).toEqual({ type, attrs, fast: real })
  }
}

describe('nodeActiveAtCursor: equivalence with editor.isActive over a real editor', () => {
  it('a plain paragraph: only "paragraph" is active, never heading/list/blockquote/codeBlock', () => {
    mount([P('hello')])
    caretAt(editor, 'hello')
    assertAllTypesMatch(editor)
    expect(nodeActiveAtCursor(editor, 'paragraph')).toBe(true)
    expect(nodeActiveAtCursor(editor, 'heading', { level: 1 })).toBe(false)
  })

  it('a heading at each level is active ONLY at that level', () => {
    mount([H(1, 'one'), H(2, 'two'), H(3, 'three'), P('p')])
    for (const [lvl, marker] of [[1, 'one'], [2, 'two'], [3, 'three']]) {
      caretAt(editor, marker)
      assertAllTypesMatch(editor)
      expect(nodeActiveAtCursor(editor, 'heading', { level: lvl })).toBe(true)
      for (const other of [1, 2, 3]) {
        if (other !== lvl) expect(nodeActiveAtCursor(editor, 'heading', { level: other })).toBe(false)
      }
    }
  })

  it('a bulletList item: bulletList is active, orderedList is not (nested ancestor chain, depth > 1)', () => {
    mount([BULLET('alpha', 'beta')])
    caretAt(editor, 'alpha')
    assertAllTypesMatch(editor)
    expect(nodeActiveAtCursor(editor, 'bulletList')).toBe(true)
    expect(nodeActiveAtCursor(editor, 'orderedList')).toBe(false)
  })

  it('an orderedList item: orderedList is active, bulletList is not', () => {
    mount([ORDERED('alpha', 'beta')])
    caretAt(editor, 'alpha')
    assertAllTypesMatch(editor)
    expect(nodeActiveAtCursor(editor, 'orderedList')).toBe(true)
    expect(nodeActiveAtCursor(editor, 'bulletList')).toBe(false)
  })

  it('a blockquote paragraph: blockquote is active', () => {
    mount([BQ('quoted')])
    caretAt(editor, 'quoted')
    assertAllTypesMatch(editor)
    expect(nodeActiveAtCursor(editor, 'blockquote')).toBe(true)
  })

  it('a code block: codeBlock is active, not paragraph', () => {
    mount([CODE('const x = 1')])
    caretAt(editor, 'const x = 1')
    assertAllTypesMatch(editor)
    expect(nodeActiveAtCursor(editor, 'codeBlock')).toBe(true)
    expect(nodeActiveAtCursor(editor, 'paragraph')).toBe(false)
  })

  it('a FLAT doc of many top-level paragraphs: the fast path (O(depth)) agrees with the real O(n) walk at EVERY position, early, middle and late -- the exact shape ty5/ty7 profiled', () => {
    const paras = []
    for (let i = 0; i < 300; i += 1) paras.push(P(`p${i}`))
    mount(paras)
    for (const marker of ['p0', 'p1', 'p149', 'p298', 'p299']) {
      caretAt(editor, marker)
      assertAllTypesMatch(editor)
      expect(nodeActiveAtCursor(editor, 'paragraph')).toBe(true)
    }
  })

  it('a non-empty (real) selection falls back to editor.isActive exactly -- never the fast path', () => {
    mount([P('select me'), H(1, 'heading here')])
    const from = caretAt(editor, 'select me')
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, from + 4)))
    expect(editor.state.selection.empty).toBe(false)
    assertAllTypesMatch(editor)
  })

  it('structural rail: the fast path does NOT call editor.isActive for a collapsed selection (the common typing case) -- it only falls back when it genuinely cannot answer', () => {
    mount([P('hello')])
    caretAt(editor, 'hello')
    const spy = vi.spyOn(editor, 'isActive')
    nodeActiveAtCursor(editor, 'paragraph')
    nodeActiveAtCursor(editor, 'bulletList')
    nodeActiveAtCursor(editor, 'heading', { level: 1 })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('falls back to editor.isActive for a test double with no resolved $from (exact behaviour preserved for a mock)', () => {
    const fake = {
      state: { selection: { empty: true } }, // no $from at all
      isActive: vi.fn(() => 'MOCK_ANSWER'),
    }
    expect(nodeActiveAtCursor(fake, 'bulletList')).toBe('MOCK_ANSWER')
    expect(fake.isActive).toHaveBeenCalledWith('bulletList', {})
  })
})

describe('canBlockquoteFast: equivalence with canRunHistory(editor, "toggleBlockquote") over a real editor', () => {
  it('a plain top-level paragraph: toggleBlockquote is allowed (G-131 baseline case)', () => {
    mount([P('hello')])
    caretAt(editor, 'hello')
    expect(canBlockquoteFast(editor, canRunHistory)).toBe(canRunHistory(editor, 'toggleBlockquote'))
    expect(canBlockquoteFast(editor, canRunHistory)).toBe(true)
  })

  it("a paragraph inside a list item: toggleBlockquote is REFUSED (G-131's own finding -- listItem's content expression needs its leading paragraph)", () => {
    mount([ORDERED('one item')])
    caretAt(editor, 'one item')
    expect(canBlockquoteFast(editor, canRunHistory)).toBe(canRunHistory(editor, 'toggleBlockquote'))
    expect(canBlockquoteFast(editor, canRunHistory)).toBe(false)
  })

  it('a FLAT doc of many top-level paragraphs: the cached answer agrees with the direct call at an early AND a late position (index does not change the schema-level answer)', () => {
    const paras = []
    for (let i = 0; i < 300; i += 1) paras.push(P(`p${i}`))
    mount(paras)
    for (const marker of ['p0', 'p149', 'p299']) {
      caretAt(editor, marker)
      const direct = canRunHistory(editor, 'toggleBlockquote')
      expect(canBlockquoteFast(editor, canRunHistory)).toBe(direct)
    }
  })

  it('memoization: two calls at the SAME position call the real can() check only ONCE', () => {
    mount([P('hello')])
    caretAt(editor, 'hello')
    const spy = vi.fn(canRunHistory)
    const v1 = canBlockquoteFast(editor, spy)
    const v2 = canBlockquoteFast(editor, spy)
    expect(v1).toBe(true)
    expect(v2).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('moving to a DIFFERENT block context (paragraph -> inside a list item) invalidates the cache and recomputes', () => {
    mount([P('plain'), ORDERED('listed')])
    caretAt(editor, 'plain')
    const spy = vi.fn(canRunHistory)
    const v1 = canBlockquoteFast(editor, spy)
    caretAt(editor, 'listed')
    const v2 = canBlockquoteFast(editor, spy)
    expect(v1).toBe(true)
    expect(v2).toBe(false)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('typing more characters into the SAME block (ancestor chain unchanged) reuses the cached answer -- the exact case the typing budget measures', () => {
    mount([P('ab')])
    const at = caretAt(editor, 'ab')
    const spy = vi.fn(canRunHistory)
    canBlockquoteFast(editor, spy)
    // simulate several keystrokes: insert text, caret still inside the SAME paragraph
    for (let i = 0; i < 5; i += 1) {
      editor.view.dispatch(editor.state.tr.insertText('x', at + i))
      canBlockquoteFast(editor, spy)
    }
    expect(spy).toHaveBeenCalledTimes(1) // only the first call ever reached canRunHistory
  })

  it('falls back to the direct call for a test double with no resolved $from', () => {
    const fake = { state: { selection: {} } }
    const spy = vi.fn(() => 'MOCK')
    expect(canBlockquoteFast(fake, spy)).toBe('MOCK')
    expect(spy).toHaveBeenCalledWith(fake, 'toggleBlockquote')
  })

  it('blockContextSignature is a string keyed on depth + each ancestor type name (unit-level, not behavioural)', () => {
    mount([ORDERED('one item')])
    caretAt(editor, 'one item')
    const sig = __test__.blockContextSignature(editor.state.selection.$from)
    expect(typeof sig).toBe('string')
    expect(sig).toContain('orderedList')
    expect(sig).toContain('listItem')
  })
})
