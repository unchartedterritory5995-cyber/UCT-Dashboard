// Wave 10 (lane TY2, standard 4 -- typing budget). Two kinds of proof, and
// neither substitutes for the other:
//   1. EQUIVALENCE -- `createMemoDocJSON()` must produce BYTE-IDENTICAL JSON
//      to `editor.getJSON()` / `node.toJSON()`, on a real editor over a real
//      schema, for a document exercising many node and mark types, through a
//      run of edits, and at the plain-paragraph scale the typing budget
//      itself measures. This is the correctness rail: a member's local
//      crash-recovery draft must never diverge from what the editor
//      actually holds.
//   2. CACHE REUSE -- the reason this file exists at all: an untouched
//      sibling subtree must come back as the SAME cached object, never
//      re-walked, after an edit elsewhere in the document. Proven
//      structurally (object identity), not by timing -- a wall-clock
//      assertion would be exactly the kind of load-sensitive test this
//      repo's own conventions warn against.
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { createMemoDocJSON } from './memoDocJSON'
import { buildAskInsertNode, appendAskInsert } from './askInsert'
import { insertColumns } from './columnsNode'

let editor
afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })

function mount(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content } })
  return editor
}

const P = (t) => (t ? { type: 'paragraph', content: [{ type: 'text', text: t }] } : { type: 'paragraph' })
const cell = (t, type = 'tableCell') => ({ type, content: [P(t)] })
const row = (...cells) => ({ type: 'tableRow', content: cells })
const H = (t) => cell(t, 'tableHeader')

/** A document exercising many node and mark types this schema registers --
 *  not every custom extension (some need elaborate attrs of their own), but
 *  every family the base algorithm has to get right: headings, marks on
 *  text runs, nested lists, a blockquote, a code block, a table, a task
 *  list, a horizontal rule, and -- through the app's own helpers, so the
 *  fixture is guaranteed schema-valid rather than hand-guessed -- a columns
 *  container and an Ask-inserted citation block. */
function richDocContent() {
  return [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'NVDA thesis' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Bold ', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'italic ', marks: [{ type: 'italic' }] },
        { type: 'text', text: 'link ', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        { type: 'text', text: 'colored ', marks: [{ type: 'textColor', attrs: { color: 'gold' } }] },
        { type: 'text', text: 'highlighted', marks: [{ type: 'highlight', attrs: { color: 'yellow' } }] },
      ],
    },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [P('first bullet')] },
        { type: 'listItem', content: [P('second bullet')] },
      ],
    },
    { type: 'orderedList', content: [{ type: 'listItem', content: [P('step one')] }] },
    { type: 'blockquote', content: [P('a quoted line')] },
    { type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'x = 1' }] },
    { type: 'horizontalRule' },
    {
      type: 'table',
      content: [
        row(H('Sym'), H('Gain')),
        row(cell('NVDA'), cell('10%')),
        row(cell('AMD'), cell('9%')),
      ],
    },
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: false }, content: [P('review the stop')] },
        { type: 'taskItem', attrs: { checked: true }, content: [P('set the alert')] },
      ],
    },
    P('trailing paragraph'),
  ]
}

describe('createMemoDocJSON: equivalence to editor.getJSON() / node.toJSON()', () => {
  it('matches exactly on a document exercising many node and mark types', () => {
    const ed = mount(richDocContent())
    const toJSON = createMemoDocJSON()
    expect(JSON.stringify(toJSON(ed.state.doc))).toBe(JSON.stringify(ed.getJSON()))
  })

  it('matches exactly once helper-built nodes (columns, an Ask-inserted citation block) are added', () => {
    const ed = mount(richDocContent())
    ed.commands.setTextSelection(ed.state.doc.content.size)
    expect(insertColumns(ed, 2)).toBe(true)
    const insert = buildAskInsertNode({
      answer: 'Margins fell [1].',
      sources: [{ n: 1, label: 'NVDA thesis', citation: 'exact', navigation: { kind: 'note', note_id: 'n1' } }],
      question: 'q', scope: 'note', insertedAt: '2026-09-22T12:00:00.000Z',
    })
    expect(appendAskInsert(ed, insert)).toBe(true)
    const toJSON = createMemoDocJSON()
    expect(JSON.stringify(toJSON(ed.state.doc))).toBe(JSON.stringify(ed.getJSON()))
  })

  it('stays byte-identical through a run of edits in different parts of the document -- SAME toJSON instance across every edit, the way NoteEditorPage reuses one across a whole session', () => {
    const ed = mount(richDocContent())
    const toJSON = createMemoDocJSON()
    // Before any edit.
    expect(JSON.stringify(toJSON(ed.state.doc))).toBe(JSON.stringify(ed.getJSON()))
    const edits = [
      () => ed.chain().setTextSelection(ed.state.doc.content.size - 1).insertContent('x').run(), // append at the very end
      () => ed.chain().setTextSelection(3).insertContent('y').run(), // inside the heading
      () => ed.commands.toggleBold(), // a mark-only transaction (no text inserted)
      () => ed.chain().setTextSelection(ed.state.doc.content.size - 1).insertContent('z').run(),
    ]
    for (const edit of edits) {
      edit()
      expect(JSON.stringify(toJSON(ed.state.doc))).toBe(JSON.stringify(ed.getJSON()))
    }
  })

  it('matches exactly on a plain-paragraph note at the scale the typing budget measures (2,000 paragraphs)', () => {
    const content = Array.from({ length: 2000 }, (_, i) => P(
      `paragraph ${i}: price reclaimed the 20 EMA on rising volume, stop under the swing low.`,
    ))
    const ed = mount(content)
    const toJSON = createMemoDocJSON()
    expect(JSON.stringify(toJSON(ed.state.doc))).toBe(JSON.stringify(ed.getJSON()))
    // One keystroke at the end -- the harness's own typing position -- then re-check.
    ed.chain().setTextSelection(ed.state.doc.content.size - 1).insertContent('x').run()
    expect(JSON.stringify(toJSON(ed.state.doc))).toBe(JSON.stringify(ed.getJSON()))
  })
})

describe('createMemoDocJSON: an unchanged sibling subtree is REUSED, never re-walked', () => {
  it('a keystroke at the END of a 500-paragraph note returns the SAME cached JSON object for every untouched paragraph', () => {
    const content = Array.from({ length: 500 }, (_, i) => P(`paragraph ${i}`))
    const ed = mount(content)
    const toJSON = createMemoDocJSON()
    const before = toJSON(ed.state.doc)
    // Control: capture the actual node objects BEFORE the edit, so the
    // assertion below is about THIS run's structural sharing, never assumed.
    const untouchedNodesBefore = []
    for (let i = 0; i < ed.state.doc.childCount - 1; i += 1) untouchedNodesBefore.push(ed.state.doc.child(i))

    ed.chain().setTextSelection(ed.state.doc.content.size - 1).insertContent('x').run()

    const after = toJSON(ed.state.doc)
    // Control: ProseMirror really did keep every untouched paragraph's
    // object reference (the guarantee this whole optimisation rests on).
    for (let i = 0; i < untouchedNodesBefore.length; i += 1) {
      expect(ed.state.doc.child(i)).toBe(untouchedNodesBefore[i])
    }
    // The memoized serializer reused the cached JSON object for every one
    // of them -- not merely equal content, the SAME object -- which is only
    // possible if it skipped re-walking that subtree entirely.
    for (let i = 0; i < untouchedNodesBefore.length; i += 1) {
      expect(after.content[i]).toBe(before.content[i])
    }
    // And the edited (last) paragraph is a NEW object, reflecting the edit --
    // proof the cache did not go stale for the one thing that DID change.
    expect(after.content[after.content.length - 1]).not.toBe(before.content[before.content.length - 1])
    expect(JSON.stringify(after.content[after.content.length - 1])).toContain('x')
  })

  it('control: two separate createMemoDocJSON() instances do not share state', () => {
    const content = Array.from({ length: 5 }, (_, i) => P(`p${i}`))
    const ed = mount(content)
    const a = createMemoDocJSON()
    const b = createMemoDocJSON()
    const aOut = a(ed.state.doc)
    const bOut = b(ed.state.doc)
    expect(aOut).not.toBe(bOut) // different cache instances -> independently computed objects
    expect(JSON.stringify(aOut)).toBe(JSON.stringify(bOut)) // same content either way
  })
})
