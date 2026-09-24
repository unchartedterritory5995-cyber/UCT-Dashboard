/**
 * S1 / H14 — the ONE content guard every editor built from `buildExtensions()`
 * shares, and the four editors other than NoteEditorPage that use it
 * (NoteEditorPage has its own wire rail: NoteEditorPage.unreadable.test.jsx).
 *
 * The hazard: a stored body with a node or mark type this bundle's schema lacks
 * opens as an EMPTY document, and the editor's next save writes it over the note.
 * Each surface here must LOCK, SAY SO in words, and write nothing.
 */
import { Editor } from '@tiptap/core'
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildExtensions } from './tiptap'
import {
  UNREADABLE_NOTE_MESSAGE, canReadDocument, isUnreadable, noteContentGuardOptions, replaceDocument,
} from './noteContentGuard'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const para = (text, marks) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] })
const UNKNOWN_NODE = { type: 'doc', content: [para('NVDA thesis'), { type: 'waveSixDiagram' }] }
const UNKNOWN_MARK = { type: 'doc', content: [para('key level', [{ type: 'waveSixUnderwave' }])] }
const READABLE = { type: 'doc', content: [para('Original body', [{ type: 'bold' }])] }
const BLANK = { type: 'doc', content: [] }

let widgetNote = null
const widgetUpdate = vi.fn()
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({ notes: [], refresh: vi.fn() }),
  useJ2Note: () => ({ note: widgetNote, update: widgetUpdate }),
}))
vi.mock('../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, loading: false }) }))
vi.mock('../../../hooks/usePlacedTheme', () => ({ default: () => 'dark' }))

const editors = []
function guardedEditor(content, onUpdate = vi.fn()) {
  const ed = new Editor({
    element: document.createElement('div'),
    extensions: buildExtensions(),
    ...noteContentGuardOptions(),
    content,
    onUpdate,
  })
  editors.push(ed)
  return ed
}
afterEach(() => {
  cleanup()
  editors.splice(0).forEach((ed) => ed.destroy())
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('the guard itself', () => {
  it.each([['node', UNKNOWN_NODE], ['mark', UNKNOWN_MARK]])(
    'an unknown %s type LOCKS the editor, without emitting the update that is every autosave',
    (_kind, body) => {
      const onUpdate = vi.fn()
      const ed = guardedEditor(body, onUpdate)
      expect(isUnreadable(ed)).toBe(true)
      expect(ed.isEditable).toBe(false)
      expect(onUpdate).not.toHaveBeenCalled()
    },
  )

  it('⛔ the controls: a readable note and a BLANK note are not locked', () => {
    for (const body of [READABLE, BLANK]) {
      const ed = guardedEditor(body)
      expect(isUnreadable(ed)).toBe(false)
      expect(ed.isEditable).toBe(true)
    }
  })

  it('replaceDocument locks on content it cannot read and leaves the document alone', () => {
    const ed = guardedEditor(READABLE)
    expect(replaceDocument(ed, { type: 'doc', content: [para('refreshed')] }, { emitUpdate: false })).toBe(true)
    expect(ed.getText()).toBe('refreshed')
    expect(replaceDocument(ed, UNKNOWN_NODE, { emitUpdate: false })).toBe(false)
    expect(isUnreadable(ed)).toBe(true)
    expect(ed.getText()).toBe('refreshed')        // never swapped for an empty stand-in
    expect(ed.isEditable).toBe(false)
  })

  it('replaceDocument keeps the pre-guard tolerance for a loose-but-readable body', () => {
    const ed = guardedEditor(READABLE)
    expect(() => replaceDocument(ed, BLANK, { emitUpdate: false })).not.toThrow()
    expect(isUnreadable(ed)).toBe(false)
  })

  it('a failed INSERT after load does not lock the note (only an unreadable document does)', () => {
    const ed = guardedEditor(READABLE)
    ed.commands.insertContent({ type: 'waveSixDiagram' })
    expect(isUnreadable(ed)).toBe(false)
    expect(ed.isEditable).toBe(true)
  })

  it('canReadDocument answers for JSON only', () => {
    const schema = guardedEditor(READABLE).schema
    expect(canReadDocument(schema, READABLE)).toBe(true)
    expect(canReadDocument(schema, UNKNOWN_MARK)).toBe(false)
    expect(canReadDocument(schema, null)).toBe(true)
    expect(canReadDocument(schema, '<p>html</p>')).toBe(true)
  })
})

const editorDom = () => document.querySelector('.ProseMirror')

describe('the Model Book entry editor (UpbRichEditor)', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })

  it.each([['node', UNKNOWN_NODE], ['mark', UNKNOWN_MARK]])(
    'an unknown %s: locked, said in words, and NOT saved on open', async (_kind, body) => {
      const UpbRichEditor = (await import('../../modelbook/builder/UpbRichEditor')).default
      const onSave = vi.fn(async () => {})
      render(<UpbRichEditor docJson={body} contentKey="e1" onSave={onSave} />)
      expect(await screen.findByText(UNREADABLE_NOTE_MESSAGE)).toBeInTheDocument()
      const ed = editorDom().editor
      expect(ed.isEditable).toBe(false)
      await act(async () => { ed.commands.insertContent('x'); vi.advanceTimersByTime(5000) })
      cleanup()                                   // the unmount flush
      await act(async () => { vi.advanceTimersByTime(5000) })
      expect(onSave).not.toHaveBeenCalled()
    },
  )

  it('a save pending when the editor switches to an unreadable entry never writes the empty stand-in', async () => {
    const UpbRichEditor = (await import('../../modelbook/builder/UpbRichEditor')).default
    const onSave = vi.fn(async () => {})
    const view = render(<UpbRichEditor docJson={READABLE} contentKey="e1" onSave={onSave} />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { editorDom().editor.commands.insertContent('x') })   // arms the 800ms save
    view.rerender(<UpbRichEditor docJson={UNKNOWN_NODE} contentKey="e2" onSave={onSave} />)
    expect(await screen.findByText(UNREADABLE_NOTE_MESSAGE)).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(3000) })
    const blank = onSave.mock.calls.filter(([arg]) => !/Original body/.test(JSON.stringify(arg?.bodyJson)))
    expect(blank).toEqual([])
  })

  it('⛔ control: a readable entry is editable and an edit IS saved', async () => {
    const UpbRichEditor = (await import('../../modelbook/builder/UpbRichEditor')).default
    const onSave = vi.fn(async () => {})
    render(<UpbRichEditor docJson={READABLE} contentKey="e2" onSave={onSave} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText(UNREADABLE_NOTE_MESSAGE)).toBeNull()
    const ed = editorDom().editor
    expect(ed.isEditable).toBe(true)
    await act(async () => { ed.commands.insertContent('x'); vi.advanceTimersByTime(2000) })
    expect(onSave).toHaveBeenCalled()
  })
})

describe('the /charts Notebook widget', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })

  async function renderWidget(bodyJson) {
    widgetNote = { id: 'n1', title: 'NVDA thesis', bodyJson }
    const NotebookWidget = (await import('../../charts/widgets/NotebookWidget')).default
    render(<NotebookWidget opts={{ noteId: 'n1' }} onOptsChange={vi.fn()} />)
    await screen.findByDisplayValue('NVDA thesis')
  }

  it.each([['node', UNKNOWN_NODE], ['mark', UNKNOWN_MARK]])(
    'an unknown %s: locked, said in words, and nothing written', async (_kind, body) => {
      await renderWidget(body)
      expect(screen.getByText(UNREADABLE_NOTE_MESSAGE)).toBeInTheDocument()
      const ed = editorDom().editor
      expect(ed.isEditable).toBe(false)
      await act(async () => { ed.commands.insertContent('x') })
      fireEvent.change(screen.getByDisplayValue('NVDA thesis'), { target: { value: 'renamed' } })
      await act(async () => { vi.advanceTimersByTime(3000) })
      cleanup()
      await act(async () => { vi.advanceTimersByTime(3000) })
      expect(widgetUpdate).not.toHaveBeenCalled()
    },
  )

  it('⛔ control: a readable note is editable and an edit IS saved', async () => {
    await renderWidget(READABLE)
    expect(screen.queryByText(UNREADABLE_NOTE_MESSAGE)).toBeNull()
    const ed = editorDom().editor
    await act(async () => { ed.commands.insertContent('x'); vi.advanceTimersByTime(2000) })
    expect(widgetUpdate).toHaveBeenCalled()
  })
})

describe('the read-only surfaces say so instead of rendering an empty note', () => {
  it('Version History preview', async () => {
    const NoteVersionPreview = (await import('../components/notebook/NoteVersionPreview')).default
    render(<NoteVersionPreview title="v3" bodyJson={UNKNOWN_NODE} />)
    expect(await screen.findByText(UNREADABLE_NOTE_MESSAGE)).toBeInTheDocument()
    expect(editorDom().editor.isEditable).toBe(false)
  })

  it('⛔ Version History preview control: a readable version shows no notice', async () => {
    const NoteVersionPreview = (await import('../components/notebook/NoteVersionPreview')).default
    render(<NoteVersionPreview title="v3" bodyJson={READABLE} />)
    await screen.findByText('Original body')
    expect(screen.queryByText(UNREADABLE_NOTE_MESSAGE)).toBeNull()
  })

  it('the public shared-note page', async () => {
    const SharedNotePage = (await import('../SharedNotePage')).default
    const { SHARED_NOTE_ROUTE, sharedNotePath } = await import('./noteShareLink')
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ note: { title: 'NVDA thesis', bodyJson: UNKNOWN_MARK } }),
    }))
    render(
      <MemoryRouter initialEntries={[sharedNotePath('tok1')]}>
        <Routes><Route path={SHARED_NOTE_ROUTE} element={<SharedNotePage />} /></Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText(UNREADABLE_NOTE_MESSAGE)).toBeInTheDocument()
  })
})
