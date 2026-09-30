/**
 * NoteEditorPage — save-error sanitization (P1-1 fix).
 *
 * update()'s thrown Error carries a real backend-authored `detail` when the
 * API supplied one (must be preserved verbatim), or just a bare numeric HTTP
 * status code string when it didn't (e.g. "500") -- which used to render
 * directly as "Save failed: 500" / "Save failed: 404". Neither means
 * anything to a member.
 */
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const NOTE = {
  id: 'n1', title: 'Original Title', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original body' }] }] },
}

const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

function httpError(message, status) {
  const e = new Error(message)
  e.status = status
  return e
}

beforeEach(() => {
  updateMock.mockReset()
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
}

async function triggerAutosave() {
  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Changed Title' } })
  await act(async () => { vi.advanceTimersByTime(800) })
}

describe('NoteEditorPage — save-error sanitization (P1-1 fix)', () => {
  it('a non-retryable 4xx with no real detail (bare status "404") never shows the bare code', async () => {
    updateMock.mockRejectedValue(httpError('404', 404))
    await renderEditor()
    await triggerAutosave()

    expect(await screen.findByText(/Save failed/)).toBeInTheDocument()
    expect(screen.queryByText(/Save failed: 404$/)).not.toBeInTheDocument()
    expect(screen.getByText(/This note could not be found/)).toBeInTheDocument()
  })

  it('a real backend-authored detail (not a bare status code) is preserved verbatim', async () => {
    updateMock.mockRejectedValue(httpError('Title is required', 400))
    await renderEditor()
    await triggerAutosave()

    expect(await screen.findByText('Save failed: Title is required')).toBeInTheDocument()
  })

  // ⛔⛔ Wave 10 F7 (Part A, 5d): this whole sentence used to live ONLY in the
  // `title` tooltip attribute, and the VISIBLE text was the single word
  // "Reconnecting…" -- no explanation of what failed, no reassurance the note
  // was unchanged. The proof walk's silent-failure sweep forced a PUT
  // /api/j2/notes/{id} to fail offline and read this SILENT (`is_sentence`
  // requires 3+ words and 12+ characters; "Reconnecting…" is one word). The
  // sentence is now the VISIBLE text, same as the 'error' branch always did.
  it('a retryable 5xx with no detail never shows the bare code, and the sentence is VISIBLE text, not just a tooltip', async () => {
    updateMock.mockRejectedValue(httpError('500', 500))
    await renderEditor()
    await triggerAutosave()

    expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument()
    // ⛔ Queried by "retrying automatically" rather than "couldn't reach the server":
    // NoteLinkedTradeChips's own (unrelated, unmocked-fetch) LoadFailed sentence also
    // contains "Couldn't reach the server" -- only the autosave status carries this.
    const status = await screen.findByText(/retrying automatically/i)
    expect(status).toHaveAttribute('role', 'status')
    expect(status.textContent).not.toBe('Reconnecting…')
    expect(status.textContent).not.toContain('500')
    expect(status.textContent).toMatch(/couldn't reach the server/i)
    expect(status.textContent).toMatch(/retrying automatically/i)
  })

  it('a network error (no status at all) never shows "undefined" or a raw status, in the VISIBLE text', async () => {
    updateMock.mockRejectedValue(new Error('Failed to fetch'))
    await renderEditor()
    await triggerAutosave()

    // "Failed to fetch" is the BROWSER's message, not the server's detail:
    // since wave 7 fix round 1 (review M-4) friendlySaveError reads it as the
    // network failure it is, instead of preserving it verbatim. The regression
    // this guards is still a BARE status code slipping through.
    const status = await screen.findByText(/retrying automatically/i)
    expect(status.textContent).not.toMatch(/^\d{3}$/)
    expect(status.textContent).not.toContain('Failed to fetch')
    expect(status.textContent).toMatch(/couldn't reach the server/i)
  })

  // Wave 7 whole-branch fix (lane H nit N-3): the network reading is keyed on the
  // BROWSER'S network words, never on the error's class. A TypeError is also what a
  // programming fault on the save path throws, and calling that "couldn't reach the
  // server" sends a member to check a connection that is fine.
  it('a code fault (a TypeError that is not a network word) is never called the network, nor shown verbatim, in the VISIBLE text', async () => {
    updateMock.mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'bodyJson')"))
    await renderEditor()
    await triggerAutosave()

    const status = await screen.findByText('Could not save — retrying automatically.')
    expect(status.textContent).not.toMatch(/couldn't reach the server/i)
    expect(status.textContent).not.toContain('Cannot read properties')
  })

  it('CONTROL — Safari\'s network TypeError ("Load failed") still reads as the network, in the VISIBLE text', async () => {
    updateMock.mockRejectedValue(new TypeError('Load failed'))
    await renderEditor()
    await triggerAutosave()

    const status = await screen.findByText(/retrying automatically/i)
    expect(status.textContent).toMatch(/couldn't reach the server/i)
    expect(status.textContent).not.toContain('Load failed')
  })
})
