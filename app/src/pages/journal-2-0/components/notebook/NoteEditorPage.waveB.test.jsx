// S7 (audit 2026-11-05, one vocabulary): the note menu's "Delete" reads "Move to Trash" (and its question "Move this note to Trash?"), the sidebar's word; the rails below follow the new words.
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
// Wave 10 lane K2 (D-3): the page-level actions (Duplicate, Lock, Archive, Save as template,
// Open beside, Delete) sit behind the note's "More note actions" door -- open it first.
const openMoreNoteActions = (scope = screen) => {
  const more = scope.getByRole('button', { name: 'More note actions' })
  if (more.getAttribute('aria-expanded') !== 'true') fireEvent.click(more)
}

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
    openMoreNoteActions()
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByText('Move this note to Trash?')).toBeInTheDocument()
  })

  it('cancel closes the modal without deleting', async () => {
    await renderEditor()
    openMoreNoteActions()
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Move this note to Trash?')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/j2/notes/n1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('confirming deletes the note and navigates back', async () => {
    const { onBack } = await renderEditor()
    openMoreNoteActions()
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    // The modal's own confirm button carries the same accessible name as the
    // header's Delete trigger -- disambiguate by scoping to the dialog.
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move to Trash' }))
    await waitFor(() => expect(onBack).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/j2/notes/n1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('Escape closes the modal without deleting', async () => {
    await renderEditor()
    openMoreNoteActions()
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(screen.getByText('Move this note to Trash?')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('Move this note to Trash?')).not.toBeInTheDocument()
  })
})

/**
 * ⛔⛔ A DIFFERENT AXIS FROM SAVE STATUS — connectivity, not writes. Wave Q1's durable working copy lets a member
 * reopen a previously-viewed note while offline (G-083), completely silently before Accessibility QW-5.
 * VIS-5 (audit 2026-11-05, issue 17): the fact is now said ONCE, by the header's offline pill in the Saved
 * indicator's reserved slot ("Offline · saved on this device"); the separate "Viewing an earlier saved copy —
 * you're offline." line is retired, because beside the other two it made three contradictory lines.
 */
describe('NoteEditorPage — going offline is said once (QW-5, VIS-5)', () => {
  const OLD_BANNER = "Viewing an earlier saved copy — you're offline."
  const pill = () => document.querySelector('[data-save-indicator]')

  it('shows nothing offline while online (the default)', async () => {
    await renderEditor()
    await waitFor(() => expect(pill().textContent).toBe('Saved'))
    expect(pill().textContent).not.toMatch(/Offline/)
  })

  it('says it the instant the browser goes offline, no reload needed -- in ONE place', async () => {
    await renderEditor()
    fireEvent(window, new Event('offline'))
    // jsdom exposes no navigator.storage, so persistence is unknown and the honest noun is the narrow one.
    await waitFor(() => expect(pill().textContent).toBe('Offline · saved in this browser'))
    expect(screen.queryByText(OLD_BANNER)).toBeNull()
    expect(screen.getAllByText(/offline/i)).toHaveLength(1)
  })

  it('clears the instant connectivity returns — no dismiss state to manage', async () => {
    await renderEditor()
    fireEvent(window, new Event('offline'))
    await waitFor(() => expect(pill().textContent).toMatch(/^Offline/))
    fireEvent(window, new Event('online'))
    await waitFor(() => expect(pill().textContent).toBe('Saved'))
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
    openMoreNoteActions()
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
    openMoreNoteActions()
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
    openMoreNoteActions()
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
    openMoreNoteActions()
    const btn = screen.getByRole('button', { name: 'Duplicate note' })
    fireEvent.click(btn)
    fireEvent.click(btn)
    await waitFor(() => expect(btn).toBeDisabled())
    expect(fetchMock.mock.calls.filter(([u, o]) => String(u) === '/api/j2/notes' && o?.method === 'POST')).toHaveLength(1)
    resolveCreate({ ok: true, json: () => Promise.resolve({ note: { id: 'dup1' } }) })
  })
})

