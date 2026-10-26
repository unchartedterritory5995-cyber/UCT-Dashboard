/**
 * Wave 9 Task 9.19: the REAL editor page puts the note's day on the editor's storage, as a FUNCTION over the ref that
 * holds this render's note (the `noteTicker` precedent), so the / menu's routine and tracker rows and the tool picker
 * bind a block to the day the note belongs to: its daily date, else the ET day it was created.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetNotebookFlags } from '../../lib/offline/notebookFlags'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const base = {
  id: 'n1', title: 'Tuesday', subtitle: '', folderId: null, ticker: null, tags: [], heroImageUrl: null,
  updatedAt: '2026-10-29T14:00:00.000000+00:00', isFavorite: false, locked: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
}
const held = vi.hoisted(() => ({ note: null }))
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: held.note, isLoading: false, error: null, update: vi.fn(async (p) => ({ ...held.note, ...p })), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u7' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

beforeEach(() => {
  localStorage.clear()
  __resetNotebookFlags()
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
})
afterEach(() => { vi.clearAllMocks(); __resetNotebookFlags(); localStorage.clear() })

/** Mount the real page on `note` and answer its editor's storage. */
async function mountOn(note) {
  held.note = note
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const view = render(
    <MemoryRouter initialEntries={['/journal/notebook?note=n1']}>
      <NoteEditorPage noteId="n1" onBack={vi.fn()} />
    </MemoryRouter>,
  )
  await screen.findByPlaceholderText('Title')
  const ed = await waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el.editor
  })
  return { storage: ed.storage.uctJournalWidgets, view }
}

describe("the note's day on the editor's storage", () => {
  it('note_day_storage_function', async () => {
    // A daily note: its daily date wins over the day it was created.
    let { storage, view } = await mountOn({ ...base, dailyDate: '2026-10-27', createdAt: '2026-10-29T15:00:00Z' })
    expect(typeof storage.noteDay).toBe('function')                     // read when a row runs, never a snapshot
    expect(storage.noteDay()).toBe('2026-10-27')
    view.unmount()
    // No daily date, created at 03:30Z on the 28th: in New York that is still the 27th.
    ;({ storage, view } = await mountOn({ ...base, dailyDate: null, createdAt: '2026-10-28T03:30:00Z' }))
    expect(storage.noteDay()).toBe('2026-10-27')
    view.unmount()
    // CONTROL: created later that day, the 28th (so the answer above is the conversion, not a fixed day).
    ;({ storage, view } = await mountOn({ ...base, dailyDate: null, createdAt: '2026-10-28T15:00:00Z' }))
    expect(storage.noteDay()).toBe('2026-10-28')
    view.unmount()
  })
})
