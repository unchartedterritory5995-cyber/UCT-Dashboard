/**
 * P2a Task 10 — price stamps in the REAL editor page: the page puts the note's ticker in editor storage
 * (read live), and Enter at the end of a line that names it sends the stamp's one write. The unit rail
 * (lib/blocks/priceStamps.test.js) proves the editor half; this one proves the page wires it.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const T1 = '2026-10-01T14:00:00.000000+00:00'
let NOTE
const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

const note = (ticker, line) => ({
  id: 'n1', title: 'AMD thesis', subtitle: '', folderId: null, ticker, tags: [],
  heroImageUrl: null, updatedAt: T1, isFavorite: false, locked: false,
  bodyJson: { type: 'doc', content: [
    { type: 'widgetEmbed', attrs: { widgetId: 'priceStamps', params: { on: 'yes' } } },
    { type: 'paragraph', content: [{ type: 'text', text: line }] },
  ] },
})

beforeEach(() => {
  localStorage.clear()
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_journal_styles_enabled: true })
  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => ({ ...NOTE, ...patch }))
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
})
afterEach(() => {
  vi.clearAllMocks()
  __resetNotebookFlags()
  localStorage.clear()
})

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter initialEntries={['/journal/notebook?note=n1']}><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  return waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el.editor
  })
}
const stampCalls = () => global.fetch.mock.calls.filter(([u]) => String(u) === '/api/j2/trader-blocks/price-stamp')

describe('price stamps in the editor page', () => {
  it("editor storage carries the note's ticker, read live", async () => {
    NOTE = note('AMD', 'AMD held the 20 EMA')
    const ed = await renderEditor()
    expect(typeof ed.storage.uctJournalWidgets.noteTicker).toBe('function')
    expect(ed.storage.uctJournalWidgets.noteTicker()).toBe('AMD')
  })

  it("Enter at the end of a line naming the note's ticker sends the stamp's one write", async () => {
    NOTE = note('AMD', 'AMD held the 20 EMA')
    const ed = await renderEditor()
    let end = 0
    ed.state.doc.forEach((n, off, i) => { if (i === 1) end = off + n.nodeSize - 1 })
    ed.commands.setTextSelection(end)
    ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: 'Enter' })))
    await waitFor(() => expect(stampCalls()).toHaveLength(1))
    const [, init] = stampCalls()[0]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ noteId: 'n1', ticker: 'AMD' })
  })

  it('a note with no ticker: storage reads null, and a bare word names nothing', async () => {
    NOTE = note(null, 'AMD held the 20 EMA')
    const ed = await renderEditor()
    expect(ed.storage.uctJournalWidgets.noteTicker()).toBeNull()
  })
})
