/**
 * P2a Task 10 — price stamps in the REAL editor page: the page puts the note's ticker in editor storage
 * (read live); the note's stamps block, once its lazy body has painted, holds the stamp plugin; and Enter
 * at the end of a line that names the ticker sends the stamp's one write. The unit rails
 * (lib/blocks/priceStamps.test.js, blocks/PriceStampsBlock.test.jsx) prove the halves; this proves the wiring.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { PRICE_STAMPS_KEY } from '../../lib/blocks/priceStamps'

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
/** The stamps block's lazy body has painted and holds the plugin; then Enter at the end of line 1. */
async function enterAtEndOfLine(ed) {
  await screen.findByRole('switch', { name: 'Stamp prices as I write' })
  await waitFor(() => expect(PRICE_STAMPS_KEY.get(ed.state)).toBeTruthy())
  let end = 0
  ed.state.doc.forEach((n, off, i) => { if (i === 1) end = off + n.nodeSize - 1 })
  ed.commands.setTextSelection(end)
  ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: 'Enter' })))
}

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
    await enterAtEndOfLine(ed)
    await waitFor(() => expect(stampCalls()).toHaveLength(1))
    const [, init] = stampCalls()[0]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ noteId: 'n1', ticker: 'AMD' })
  })

  it('a note with no ticker: storage reads null, and Enter on a bare word sends nothing', async () => {
    NOTE = note(null, 'AMD held the 20 EMA')
    const ed = await renderEditor()
    expect(ed.storage.uctJournalWidgets.noteTicker()).toBeNull()
    await enterAtEndOfLine(ed)
    // nothing pending is left, and no write was sent (the CONTROL below sends one for a $cashtag)
    await waitFor(() => expect(PRICE_STAMPS_KEY.getState(ed.state).size).toBe(0))
    await new Promise((r) => setTimeout(r, 50))
    expect(stampCalls()).toHaveLength(0)
  })

  it('CONTROL for the case above: the same line with a $cashtag does send', async () => {
    NOTE = note(null, 'AMD held, $AMD too')
    const ed = await renderEditor()
    await enterAtEndOfLine(ed)
    await waitFor(() => expect(stampCalls()).toHaveLength(1))
    expect(JSON.parse(stampCalls()[0][1].body).ticker).toBe('AMD')
  })
})
