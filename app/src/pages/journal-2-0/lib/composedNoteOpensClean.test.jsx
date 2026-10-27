// 11.20 walk D2 (spec §6.2: opening writes nothing). The first open of a template-made note wrote it once: the server's
// body ended on a widget, and TipTap's TrailingNode appends an empty paragraph on the editor's first transaction, a
// `docChanged` that NoteEditorPage's `onUpdate` turns into an autosave. The server now stores that paragraph
// (journal_styles.with_trailing_paragraph). This rail loads the server's REAL use-template answer (the contract fixture,
// regenerated from the router by tools/notebook_contract_fixtures.py) into the REAL editor (buildExtensions) and asserts
// that opening it and moving the caret change nothing: no transaction with `docChanged`, so `onUpdate` never runs and
// no save is scheduled, and the editor's document is the stored one.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { buildExtensions } from './tiptap'
import { contractBody } from '../__fixtures__/contract'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
document.elementFromPoint = () => null

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
})
afterEach(cleanup)

/** Open `body` the way the note editor does, then put the caret in it twice (the member's first moves). */
async function openAndTouch(body) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const updates = []
  const changes = []
  // Listened from CONSTRUCTION: TipTap v3 dispatches a transaction while the editor is built, and TrailingNode's
  // append rides it (on `appendedTransactions`, never the dispatched one), so both are counted from the first one.
  const ed = new Editor({
    element: el, extensions: buildExtensions(), content: body,
    onUpdate: () => updates.push(1),
    onTransaction: ({ transaction, appendedTransactions = [] }) => {
      for (const tr of [transaction, ...appendedTransactions]) if (tr.docChanged) changes.push(tr)
    },
  })
  ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), noteId: 'n1', noteTicker: () => null, noteDay: () => '2026-10-05' }
  render(<EditorContent editor={ed} />)
  const opened = ed.schema.nodeFromJSON(body)
  await act(async () => {
    ed.commands.focus('start')
    ed.commands.setTextSelection(1)
    ed.view.dispatch(ed.state.tr.setMeta('walkD2', true))
  })
  return { ed, changes, updates, opened }
}

describe('a template-made note opens without a write (walk D2)', () => {
  it("the server's use-template note: no docChanged, no onUpdate, the doc is the stored one", async () => {
    const body = contractBody('template-gallery.use-template').note.bodyJson
    expect(body.content.some((n) => n.type === 'widgetEmbed')).toBe(true)        // non-vacuity: it holds widgets
    expect(body.content.at(-1)).toEqual({ type: 'paragraph' })                   // the server stored the paragraph
    const { ed, changes, updates, opened } = await openAndTouch(body)
    expect(changes).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(ed.state.doc.eq(opened)).toBe(true)
    expect(ed.getJSON()).toEqual(ed.schema.nodeFromJSON(body).toJSON())
    ed.destroy()
  })

  it('CONTROL: the same note WITHOUT the trailing paragraph is changed as it opens (the instrument sees TrailingNode)', async () => {
    const body = contractBody('template-gallery.use-template').note.bodyJson
    const cut = { ...body, content: body.content.slice(0, -1) }
    expect(cut.content.at(-1).type).not.toBe('paragraph')
    const { ed, changes, updates } = await openAndTouch(cut)
    expect(changes.length).toBeGreaterThan(0)
    expect(updates.length).toBeGreaterThan(0)
    expect(ed.state.doc.lastChild.type.name).toBe('paragraph')
    ed.destroy()
  })
})
