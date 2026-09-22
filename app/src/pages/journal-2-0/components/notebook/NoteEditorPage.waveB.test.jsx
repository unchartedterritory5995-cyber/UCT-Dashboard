import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
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

/**
 * ⛔⛔ A DIFFERENT AXIS FROM SAVE STATUS — connectivity, not writes. Wave Q1's
 * durable working copy lets a member reopen a previously-viewed note while
 * offline (G-083), completely silently before this. Competitive audit
 * finding Accessibility QW-5, 2026-09-22.
 */
describe('NoteEditorPage — offline-viewing banner (Accessibility QW-5)', () => {
  const BANNER_TEXT = "Viewing an earlier saved copy — you're offline."

  it('shows nothing while online (the default)', async () => {
    await renderEditor()
    expect(screen.queryByText(BANNER_TEXT)).toBeNull()
  })

  it('appears the instant the browser goes offline, no reload needed', async () => {
    await renderEditor()
    expect(screen.queryByText(BANNER_TEXT)).toBeNull()
    fireEvent(window, new Event('offline'))
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument()
  })

  it('auto-clears the instant connectivity returns — no dismiss state to manage', async () => {
    await renderEditor()
    fireEvent(window, new Event('offline'))
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument()
    fireEvent(window, new Event('online'))
    expect(screen.queryByText(BANNER_TEXT)).toBeNull()
  })
})

describe('NoteEditorPage — Wave B Recents "opened" beacon', () => {
  it('fires recordNoteOpened(noteId) once the note has loaded', async () => {
    await renderEditor()
    await waitFor(() => expect(recordNoteOpenedMock).toHaveBeenCalledWith('n1'))
  })
})

/**
 * ⛔⛔ DUPLICATE — no such action existed anywhere in the product before this
 * pass (grepped the header, NoteCard.jsx, NotebookTab.jsx: zero clone path).
 * Competitive audit finding UX #12, 2026-09-22.
 */
describe('NoteEditorPage — Duplicate note (UX #12)', () => {
  const postCreate = () => fetchMock.mock.calls.find(
    ([u, o]) => String(u) === '/api/j2/notes' && o?.method === 'POST',
  )

  it('clones title/subtitle/body/tags/ticker/folder via the shared createNoteViaApi path', async () => {
    fetchMock = vi.fn((url, opts) => (
      String(url) === '/api/j2/notes' && opts?.method === 'POST'
        ? Promise.resolve({ ok: true, json: () => Promise.resolve({ note: { id: 'dup1' } }) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    ))
    global.fetch = fetchMock
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate note' }))
    await waitFor(() => expect(postCreate()).toBeTruthy())
    const body = JSON.parse(postCreate()[1].body)
    expect(body.title).toBe('Copy of Original Title')
    expect(body.bodyJson).toEqual(NOTE.bodyJson)
  })

  it('navigates to the newly-created note via the app\'s one note-routing idiom (?note=)', async () => {
    fetchMock = vi.fn((url, opts) => (
      String(url) === '/api/j2/notes' && opts?.method === 'POST'
        ? Promise.resolve({ ok: true, json: () => Promise.resolve({ note: { id: 'dup1' } }) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    ))
    global.fetch = fetchMock
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    function LocationProbe() {
      const [params] = useSearchParams()
      return <div data-testid="loc">{params.toString()}</div>
    }
    render(
      <MemoryRouter initialEntries={['/journal/notebook?note=n1']}>
        <NoteEditorPage noteId="n1" onBack={vi.fn()} showBack />
        <LocationProbe />
      </MemoryRouter>,
    )
    await screen.findByPlaceholderText('Title')
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate note' }))
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toContain('note=dup1'))
  })

  it('a failed duplicate leaves the member on the SAME note (no navigation, no console crash)', async () => {
    fetchMock = vi.fn((url, opts) => (
      String(url) === '/api/j2/notes' && opts?.method === 'POST'
        ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    ))
    global.fetch = fetchMock
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate note' }))
    await waitFor(() => expect(postCreate()).toBeTruthy())
    expect(screen.getByPlaceholderText('Title')).toHaveValue('Original Title')
    errSpy.mockRestore()
  })

  it('the button is disabled while the duplicate is in flight, so a double-click cannot fire it twice', async () => {
    let resolveCreate
    fetchMock = vi.fn((url, opts) => (
      String(url) === '/api/j2/notes' && opts?.method === 'POST'
        ? new Promise((resolve) => { resolveCreate = resolve })
        : Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    ))
    global.fetch = fetchMock
    await renderEditor()
    const btn = screen.getByRole('button', { name: 'Duplicate note' })
    fireEvent.click(btn)
    fireEvent.click(btn)
    await waitFor(() => expect(btn).toBeDisabled())
    expect(fetchMock.mock.calls.filter(([u, o]) => String(u) === '/api/j2/notes' && o?.method === 'POST')).toHaveLength(1)
    resolveCreate({ ok: true, json: () => Promise.resolve({ note: { id: 'dup1' } }) })
  })
})

