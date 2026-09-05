import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Wave 0 (P1-10): the local draft safety net. The network autosave is
// debounced 800ms behind the last keystroke — a tab closed before that
// timer fires (or mid-backoff, offline) never runs React's unmount cleanup
// and loses everything since the last successful PUT. These tests drive the
// REAL editor (no TipTap mock) through real keystrokes, matching the
// convention in NoteEditorPage.rails.test.jsx.

const NOTE = {
  id: 'n1', title: 'Original Title', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original body' }] }] },
}

const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: updateMock, refresh: vi.fn() }),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

const DRAFT_KEY = 'uct.j2.notedraft.n1'

beforeEach(() => {
  localStorage.clear()
  updateMock.mockReset()
  updateMock.mockResolvedValue({ ...NOTE, updatedAt: '2026-01-01T00:01:00Z' })
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  localStorage.clear()
})

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={() => {}} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
}

describe('NoteEditorPage — local draft safety net (P1-10)', () => {
  it('a fresh note with no local draft shows no recovery banner', async () => {
    await renderEditor()
    expect(screen.queryByText(/Unsaved changes from a previous session/)).not.toBeInTheDocument()
  })

  it('typing writes a local draft to localStorage immediately — before the network debounce ever fires', async () => {
    await renderEditor()
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Changed Title' } })

    // No time has advanced at all — the 800ms network debounce has not
    // fired, and update() must not have been called yet.
    expect(updateMock).not.toHaveBeenCalled()
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY))
    expect(draft.title).toBe('Changed Title')
  })

  it('a successful network save clears the local draft — it is a safety net, not a second source of truth', async () => {
    await renderEditor()
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Changed Title' } })
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()

    await act(async () => { vi.advanceTimersByTime(800) })
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toBeNull())
  })

  it('reopening a note with a stale local draft that differs from the server offers Restore/Discard', async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      title: 'Recovered Title', subtitle: '', bodyJson: NOTE.bodyJson, savedAt: Date.now(),
    }))
    await renderEditor()
    expect(screen.getByText(/Unsaved changes from a previous session/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
  })

  it('a local draft identical to the server content is not offered — no noise for a draft that already saved fine', async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      title: NOTE.title, subtitle: NOTE.subtitle, bodyJson: NOTE.bodyJson, savedAt: Date.now(),
    }))
    await renderEditor()
    expect(screen.queryByText(/Unsaved changes from a previous session/)).not.toBeInTheDocument()
    // Self-heals: the stale-but-matching draft key is cleaned up, not left behind.
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('clicking Restore applies the draft title and schedules a real save', async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      title: 'Recovered Title', subtitle: '', bodyJson: NOTE.bodyJson, savedAt: Date.now(),
    }))
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    expect(screen.getByPlaceholderText('Title')).toHaveValue('Recovered Title')
    expect(screen.queryByText(/Unsaved changes from a previous session/)).not.toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(800) })
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Recovered Title' }),
    ))
  })

  it('clicking Discard clears the draft and leaves the server content untouched', async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      title: 'Recovered Title', subtitle: '', bodyJson: NOTE.bodyJson, savedAt: Date.now(),
    }))
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(screen.queryByText(/Unsaved changes from a previous session/)).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Title')).toHaveValue('Original Title')
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(updateMock).not.toHaveBeenCalled()
  })
})
