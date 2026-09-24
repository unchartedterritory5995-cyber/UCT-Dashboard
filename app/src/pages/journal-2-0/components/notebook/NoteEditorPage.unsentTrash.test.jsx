/**
 * Wave 6 item 11 — Delete on a note that still holds unsent words.
 *
 * ⚰️ THE 404 PATH. The editor trashed at once; the note's queued PUT then
 * reached a trashed note, `update_note` refused it (404), the drain retired it
 * as blocked, and a trashed card never shows the blocked badge -- the words
 * were stranded. The server below refuses a PUT to a trashed note with that
 * same 404, so each rail says which way the words went.
 *
 * The unsent signal is the real module's contract (`noteHasUnsentWork`
 * verdicts); only its answer is scripted, per case.
 */
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const NOTE = {
  id: 'n1', title: 'NVDA thesis', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: 'T1', isFavorite: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original body' }] }] },
}

const verdicts = vi.fn()
vi.mock('../../lib/offline/noteHasUnsentWork', async (importOriginal) => ({
  ...(await importOriginal()),
  noteHasUnsentWork: (...args) => verdicts(...args),
}))

const server = { trashed: false, log: [], body: null }
const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'acct1' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

const onBack = vi.fn()
beforeEach(() => {
  server.trashed = false
  server.log = []
  server.body = null
  verdicts.mockReset()
  onBack.mockReset()
  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => {
    if (server.trashed) {
      server.log.push('PUT 404')
      throw Object.assign(new Error('Note not found'), { status: 404 })
    }
    server.log.push('PUT 200')
    if (patch.bodyJson) server.body = JSON.stringify(patch.bodyJson)
    return { ...NOTE, ...patch, updatedAt: 'T2' }
  })
  global.fetch = vi.fn(async (url, opts = {}) => {
    if (String(url) === '/api/j2/notes/n1' && opts.method === 'DELETE') {
      server.trashed = true
      server.log.push('DELETE')
      return { ok: true, json: async () => ({}) }
    }
    return { ok: true, json: async () => ({}) }
  })
})
afterEach(() => vi.clearAllMocks())

const CLEAN = { unsent: false, why: null }
const QUEUED = { unsent: true, why: 'queued' }

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={onBack} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  return waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el.editor
  })
}
// Words the server does not have, put in WITHOUT an update event: no autosave
// is scheduled, so only an explicit send can deliver them (the rail below must
// not pass on an autosave's timing).
const typeUnsentWords = (editor) => act(() => {
  editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Original body plus my new line' }] }] }, { emitUpdate: false })
})
const confirmDelete = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  const modal = await screen.findByRole('dialog', { name: 'Delete this note?' })
  fireEvent.click(within(modal).getByRole('button', { name: 'Delete' }))
}

describe('Delete with unsent words (the 404 path)', () => {
  it('a note holding unsent words is NOT trashed: the dialog names what is unsent', async () => {
    verdicts.mockResolvedValue(QUEUED)
    const editor = await renderEditor()
    typeUnsentWords(editor)
    await confirmDelete()
    const dialog = await screen.findByRole('dialog', { name: /words the server doesn.t have yet/ })
    expect(dialog.textContent).toContain('Not on the server yet: the note’s text.')
    expect(server.log).not.toContain('DELETE')
    expect(document.activeElement.textContent).toBe('Send first')
  })

  it('Send first: the words land (PUT 200) BEFORE the trash -- no 404, nothing stranded', async () => {
    // Unsent until a PUT has landed -- the store's own answer once the save settles.
    verdicts.mockImplementation(async () => (server.log.includes('PUT 200') ? CLEAN : QUEUED))
    const editor = await renderEditor()
    typeUnsentWords(editor)
    await confirmDelete()
    fireEvent.click(await screen.findByRole('button', { name: 'Send first' }))
    await waitFor(() => expect(server.log).toContain('DELETE'))
    const del = server.log.indexOf('DELETE')
    expect(server.log.slice(0, del)).toContain('PUT 200')
    expect(server.log).not.toContain('PUT 404')
    expect(server.body).toContain('plus my new line')
    expect(onBack).toHaveBeenCalled()
  })

  it('still unsent after sending: it says so and does NOT trash', async () => {
    verdicts.mockResolvedValue(QUEUED)
    const editor = await renderEditor()
    typeUnsentWords(editor)
    await confirmDelete()
    fireEvent.click(await screen.findByRole('button', { name: 'Send first' }))
    expect(await screen.findByText('Still sending — try again in a moment.', {}, { timeout: 4000 })).toBeTruthy()
    expect(server.log).not.toContain('DELETE')
  })

  it('Trash anyway is the member\'s explicit choice: it trashes', async () => {
    verdicts.mockResolvedValue(QUEUED)
    const editor = await renderEditor()
    typeUnsentWords(editor)
    await confirmDelete()
    fireEvent.click(await screen.findByRole('button', { name: 'Trash anyway' }))
    await waitFor(() => expect(server.log).toContain('DELETE'))
    expect(onBack).toHaveBeenCalled()
  })

  it('the door-guard mode cannot hide unsent words (the RAW signal decides)', async () => {
    verdicts.mockResolvedValue({ unsent: false, why: 'guard-unknown-only' })
    await renderEditor()
    await confirmDelete()
    expect(await screen.findByRole('dialog', { name: /words the server doesn.t have yet/ })).toBeTruthy()
    expect(server.log).not.toContain('DELETE')
  })

  it('an unreadable store is not a clean one: it asks, and says it could not check', async () => {
    verdicts.mockResolvedValue({ unsent: true, why: 'unreadable' })
    await renderEditor()
    await confirmDelete()
    const dialog = await screen.findByRole('dialog', { name: /words the server doesn.t have yet/ })
    expect(dialog.textContent).toContain('could not check')
  })

  it('CONTROL: a note with nothing unsent trashes at once, no second question', async () => {
    verdicts.mockResolvedValue(CLEAN)
    await renderEditor()
    await confirmDelete()
    await waitFor(() => expect(server.log).toEqual(['DELETE']))
    expect(screen.queryByRole('dialog', { name: /words the server doesn.t have yet/ })).toBeNull()
    expect(verdicts.mock.calls[0][0]).toBe('n1')
  })
})
