import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Wave B (High-Frequency Notebook UX): Favorites toggle, the ConfirmModal
// delete flow (replacing native confirm()), and the Recents "opened" beacon.
// Same real-editor-mount convention as NoteEditorPage.draft.test.jsx.

const NOTE = {
  id: 'n1', title: 'Original Title', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original body' }] }] },
}

const updateMock = vi.fn()
const recordNoteOpenedMock = vi.fn()
const setNoteFavoriteMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: (...args) => recordNoteOpenedMock(...args),
  setNoteFavorite: (...args) => setNoteFavoriteMock(...args),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

let fetchMock
beforeEach(() => {
  updateMock.mockReset()
  recordNoteOpenedMock.mockReset()
  setNoteFavoriteMock.mockReset()
  setNoteFavoriteMock.mockResolvedValue(true)
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  global.fetch = fetchMock
})
afterEach(() => vi.clearAllMocks())

async function renderEditor(props = {}) {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const onBack = vi.fn()
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={onBack} showBack {...props} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  return { onBack }
}

describe('NoteEditorPage — Wave B Favorites toggle', () => {
  it('renders the star as outline when the note is not favorited', async () => {
    await renderEditor()
    expect(screen.getByRole('button', { name: 'Add to Favorites' })).toBeInTheDocument()
  })

  it('clicking the star optimistically fills it and calls setNoteFavorite(id, true)', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Favorites' }))
    expect(setNoteFavoriteMock).toHaveBeenCalledWith('n1', true)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove from Favorites' })).toBeInTheDocument())
  })

  it('a failed favorite write reverts the star back to its prior state', async () => {
    setNoteFavoriteMock.mockRejectedValueOnce(new Error('500'))
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Favorites' }))
    // Optimistic fill happens immediately...
    expect(screen.getByRole('button', { name: 'Remove from Favorites' })).toBeInTheDocument()
    // ...then reverts once the write fails.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add to Favorites' })).toBeInTheDocument())
  })

  it('clicking again unfavorites (POST then DELETE semantics via the isFavorite arg)', async () => {
    await renderEditor()
    const star = screen.getByRole('button', { name: 'Add to Favorites' })
    fireEvent.click(star)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove from Favorites' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Remove from Favorites' }))
    expect(setNoteFavoriteMock).toHaveBeenLastCalledWith('n1', false)
  })
})

describe('NoteEditorPage — Wave B delete uses ConfirmModal, not native confirm() (G-103)', () => {
  it('clicking Delete opens a modal instead of calling window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByText('Delete this note?')).toBeInTheDocument()
  })

  it('cancel closes the modal without deleting', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Delete this note?')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/j2/notes/n1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('confirming deletes the note and navigates back', async () => {
    const { onBack } = await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    // The modal's own confirm button carries the same accessible name as the
    // header's Delete trigger -- disambiguate by scoping to the dialog.
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onBack).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/j2/notes/n1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('Escape closes the modal without deleting', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Delete this note?')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('Delete this note?')).not.toBeInTheDocument()
  })
})

describe('NoteEditorPage — Wave B Recents "opened" beacon', () => {
  it('fires recordNoteOpened(noteId) once the note has loaded', async () => {
    await renderEditor()
    await waitFor(() => expect(recordNoteOpenedMock).toHaveBeenCalledWith('n1'))
  })
})

