/**
 * Task 8.18 fix round 1 (I-1, R-45): the REAL editor page puts its router's navigate on the editor's storage, so the
 * / menu's builder and My tools doors can move the router rather than load the whole page for a link out. This proves
 * the storage key MOVES the router (a location probe beside the page), not merely that it exists.
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetNotebookFlags } from '../../lib/offline/notebookFlags'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const NOTE = {
  id: 'n1', title: 'AMD thesis', subtitle: '', folderId: null, ticker: null, tags: [], heroImageUrl: null,
  updatedAt: '2026-10-01T14:00:00.000000+00:00', isFavorite: false, locked: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
}
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, error: null, update: vi.fn(async (p) => ({ ...NOTE, ...p })), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u7' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{loc.pathname + loc.search}</output>
}

beforeEach(() => {
  localStorage.clear()
  __resetNotebookFlags()
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
})
afterEach(() => { vi.clearAllMocks(); __resetNotebookFlags(); localStorage.clear() })

describe("the editor page's router on the editor's storage", () => {
  it('storage.navigate moves the page router', async () => {
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    render(<MemoryRouter initialEntries={['/journal/notebook?note=n1']}>
      <NoteEditorPage noteId="n1" onBack={vi.fn()} /><Where />
    </MemoryRouter>)
    await screen.findByPlaceholderText('Title')
    const ed = await waitFor(() => {
      const el = document.querySelector('.ProseMirror')
      if (!el?.editor) throw new Error('editor not mounted')
      return el.editor
    })
    expect(screen.getByTestId('where').textContent).toBe('/journal/notebook?note=n1')   // control: where it starts
    expect(ed.storage.uctJournalWidgets.uid).toBe('u7')
    await act(async () => { ed.storage.uctJournalWidgets.navigate('/journal/accounts') })
    expect(screen.getByTestId('where').textContent).toBe('/journal/accounts')
  })
})
