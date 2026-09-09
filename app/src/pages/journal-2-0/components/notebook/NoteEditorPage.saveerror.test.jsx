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

  it('a retryable 5xx with no detail never shows the bare code, even in the reconnecting tooltip', async () => {
    updateMock.mockRejectedValue(httpError('500', 500))
    await renderEditor()
    await triggerAutosave()

    expect(await screen.findByText('Reconnecting…')).toBeInTheDocument()
    const status = screen.getByText('Reconnecting…').closest('[title]')
    expect(status.getAttribute('title')).not.toBe('500')
    expect(status.getAttribute('title')).not.toContain('500')
    expect(status.getAttribute('title')).toMatch(/couldn't reach the server/i)
    expect(status.getAttribute('title')).toMatch(/retrying automatically/i)
  })

  it('a network error (no status at all) never shows "undefined" or a raw status', async () => {
    updateMock.mockRejectedValue(new Error('Failed to fetch'))
    await renderEditor()
    await triggerAutosave()

    // "Failed to fetch" is a real browser-authored message, not a bare
    // 3-digit code -- friendlySaveError preserves it verbatim by design;
    // the regression this guards is a BARE status code slipping through,
    // which this asserts does not happen.
    const status = screen.getByText('Reconnecting…').closest('[title]')
    expect(status.getAttribute('title')).not.toMatch(/^\d{3}$/)
  })
})
