// Wave 10 (lane TY5 -- "typing busy time < 16 ms/char up to 2,000 paragraphs", ruling D24).
// Same two-kind proof as memoDocJSON.test.js, one cache layer up:
//   1. EQUIVALENCE -- `createMemoStringify()` must produce BYTE-IDENTICAL output to plain
//      `JSON.stringify()` on the same `memoDocJSON`-shaped tree, and `stringifyDraftPayload`
//      byte-identical to `JSON.stringify()` of the object literal it replaces in
//      `saveDraftLocally` (NoteEditorPage.jsx). The member's local crash-recovery draft must
//      never diverge from what plain JSON.stringify would have written.
//   2. CACHE REUSE -- the reason this file exists at all: an untouched sibling's STRING form
//      is reused, never recomputed, after an edit elsewhere in the document. Proven by
//      spying on the NATIVE `JSON.stringify` and counting calls, never by timing.
import {
  describe, it, expect, afterEach, vi,
} from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { createMemoDocJSON } from './memoDocJSON'
import { createMemoStringify, stringifyDraftPayload } from './memoStringifyBody'
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

// Same fixture memoDocJSON.test.js uses, kept in sync on purpose: a cache layered on top of
// memoDocJSON must still be correct across every node/mark family that file already covers.
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
        // Deliberately JSON-hostile text: quotes, a backslash, a newline, unicode -- proves
        // the leaf fields go through the NATIVE JSON.stringify's own escaping unchanged.
        { type: 'text', text: 'quote " slash \\ newline \n unicode café  sep' },
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

describe('createMemoStringify: equivalence to JSON.stringify()', () => {
  it('matches exactly on a document exercising many node and mark types, and JSON-hostile text', () => {
    const ed = mount(richDocContent())
    const toJSON = createMemoDocJSON()
    const stringify = createMemoStringify()
    const body = toJSON(ed.state.doc)
    expect(stringify(body)).toBe(JSON.stringify(body))
    expect(stringify(body)).toBe(JSON.stringify(ed.getJSON()))
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
    const stringify = createMemoStringify()
    const body = toJSON(ed.state.doc)
    expect(stringify(body)).toBe(JSON.stringify(ed.getJSON()))
  })

  it('stays byte-identical through a run of edits in different parts of the document -- SAME instances across every edit, the way NoteEditorPage reuses one pair across a whole session', () => {
    const ed = mount(richDocContent())
    const toJSON = createMemoDocJSON()
    const stringify = createMemoStringify()
    expect(stringify(toJSON(ed.state.doc))).toBe(JSON.stringify(ed.getJSON()))
    const edits = [
      () => ed.chain().setTextSelection(ed.state.doc.content.size - 1).insertContent('x').run(),
      () => ed.chain().setTextSelection(3).insertContent('y').run(),
      () => ed.commands.toggleBold(),
      () => ed.chain().setTextSelection(ed.state.doc.content.size - 1).insertContent('z "quoted"').run(),
    ]
    for (const edit of edits) {
      edit()
      expect(stringify(toJSON(ed.state.doc))).toBe(JSON.stringify(ed.getJSON()))
    }
  })

  it('matches exactly on a plain-paragraph note at the scale the typing budget measures (2,000 paragraphs)', () => {
    const content = Array.from({ length: 2000 }, (_, i) => P(
      `paragraph ${i}: price reclaimed the 20 EMA on rising volume, stop under the swing low.`,
    ))
    const ed = mount(content)
    const toJSON = createMemoDocJSON()
    const stringify = createMemoStringify()
    expect(stringify(toJSON(ed.state.doc))).toBe(JSON.stringify(ed.getJSON()))
    ed.chain().setTextSelection(ed.state.doc.content.size - 1).insertContent('x').run()
    expect(stringify(toJSON(ed.state.doc))).toBe(JSON.stringify(ed.getJSON()))
  })
})

describe('createMemoStringify: an unchanged sibling subtree is REUSED, never re-stringified', () => {
  it('a keystroke at the END of a 500-paragraph note calls the native JSON.stringify a BOUNDED number of times, not once per paragraph', () => {
    const content = Array.from({ length: 500 }, (_, i) => P(`paragraph ${i}`))
    const ed = mount(content)
    const toJSON = createMemoDocJSON()
    const stringify = createMemoStringify()
    // Prime both caches on the pre-edit doc, exactly as a real keystroke would have left them.
    stringify(toJSON(ed.state.doc))

    ed.chain().setTextSelection(ed.state.doc.content.size - 1).insertContent('x').run()

    const spy = vi.spyOn(JSON, 'stringify')
    const out = stringify(toJSON(ed.state.doc))
    spy.mockRestore()
    // Only the edited (last) paragraph's own leaf fields, plus the doc node's own `type`
    // (the doc's object is always new -- see memoStringifyBody.js's header), should reach the
    // native stringify -- a handful of calls, never one per untouched paragraph (500).
    expect(spy.mock.calls.length).toBeLessThan(10)
    expect(out).toBe(JSON.stringify(ed.getJSON()))
    expect(out).toContain('x')
  })

  it('control: two separate createMemoStringify() instances do not share state', () => {
    const content = Array.from({ length: 5 }, (_, i) => P(`p${i}`))
    const ed = mount(content)
    const toJSON = createMemoDocJSON()
    const a = createMemoStringify()
    const b = createMemoStringify()
    const body = toJSON(ed.state.doc)
    expect(a(body)).toBe(b(body))
    expect(a(body)).toBe(JSON.stringify(body))
  })
})

describe('stringifyDraftPayload: equivalence to the saveDraftLocally object literal', () => {
  const nativePayload = (f) => JSON.stringify({
    title: f.title, subtitle: f.subtitle, bodyJson: f.bodyJson, savedAt: f.savedAt,
    sessionId: f.sessionId, baseUpdatedAt: f.baseUpdatedAt, writtenSchema: f.writtenSchema,
  })

  it('matches the native object literal field-for-field, including JSON-hostile title/subtitle text', () => {
    const fields = {
      title: 'quote " slash \\ newline \n tab \t unicode café',
      subtitle: 'line-sep   para-sep   emoji 😀',
      bodyJson: { type: 'doc', content: [{ type: 'paragraph' }] },
      savedAt: 1735689600000,
      sessionId: 'sess_abc123',
      baseUpdatedAt: '2026-09-22T12:00:00.000Z',
      writtenSchema: 2,
    }
    const got = stringifyDraftPayload({ ...fields, bodyJsonStr: JSON.stringify(fields.bodyJson) })
    expect(got).toBe(nativePayload(fields))
    expect(JSON.parse(got)).toEqual(JSON.parse(nativePayload(fields)))
  })

  it('matches with the minimum/edge values the real call site can hand it (empty title/subtitle, null baseUpdatedAt, writtenSchema 0)', () => {
    const fields = {
      title: '', subtitle: '', bodyJson: { type: 'doc' }, savedAt: 0,
      sessionId: 's', baseUpdatedAt: null, writtenSchema: 0,
    }
    const got = stringifyDraftPayload({ ...fields, bodyJsonStr: JSON.stringify(fields.bodyJson) })
    expect(got).toBe(nativePayload(fields))
  })

  it('composes with createMemoStringify()\'s own output as bodyJsonStr, end to end, on a real editor', () => {
    const content = Array.from({ length: 50 }, (_, i) => P(`paragraph ${i}`))
    const ed = mount(content)
    const toJSON = createMemoDocJSON()
    const stringify = createMemoStringify()
    const bodyJson = toJSON(ed.state.doc)
    const fields = {
      title: 'My note', subtitle: '', bodyJson, savedAt: 1700000000000,
      sessionId: 'sess_x', baseUpdatedAt: null, writtenSchema: 0,
    }
    const got = stringifyDraftPayload({ ...fields, bodyJsonStr: stringify(bodyJson) })
    expect(got).toBe(nativePayload(fields))
    const parsed = JSON.parse(got)
    expect(parsed.bodyJson).toEqual(ed.getJSON())
  })
})
