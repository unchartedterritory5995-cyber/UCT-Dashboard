/**
 * NoteEditorPage — note-load error/retry state (P0-2 fix).
 *
 * useJ2Note already returned `error`, but this component never destructured
 * it -- so a failed initial fetch left `note` permanently null while
 * `isLoading` settled false, and the page hung on "Loading…" forever with
 * no way forward. Reachable via any ordinary transient network failure, not
 * a rare edge case.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

const NOTE = {
  id: 'n1', title: 'Original Title', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original body' }] }] },
}

const refreshMock = vi.fn()
// A real stateful hook (not a static return) so clicking "Try again" can
// actually flip the mock from error -> success and prove the retry path
// re-renders the real editor, not just that a button exists.
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => {
    const [attempt, setAttempt] = React.useState(0)
    if (attempt === 0) {
      return {
        note: null,
        isLoading: false,
        error: new Error('500'),
        update: vi.fn(),
        refresh: () => { refreshMock(); setAttempt(1); return Promise.resolve() },
      }
    }
    return { note: NOTE, isLoading: false, error: null, update: vi.fn(), refresh: vi.fn() }
  },
}))

async function renderEditor(props = {}) {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  return render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack {...props} /></MemoryRouter>)
}

beforeEach(() => {
  refreshMock.mockClear()
  vi.resetModules()
})

describe('NoteEditorPage — note-load error state (P0-2 fix)', () => {
  it('shows a distinct error card, never an infinite "Loading…", when the initial fetch fails', async () => {
    await renderEditor()
    expect(screen.getByText("Couldn't load this note.")).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })

  it('never shows the raw backend error text (bare HTTP status)', async () => {
    await renderEditor()
    expect(screen.queryByText(/^500$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/HTTP 500/)).not.toBeInTheDocument()
  })

  it('reassures the member their work is safe -- this is a connection problem, not data loss', async () => {
    await renderEditor()
    expect(screen.getByText(/connection problem/i)).toBeInTheDocument()
  })

  it('offers a retry action wired to refresh()', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('a successful retry replaces the error card with the real editor', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByText("Couldn't load this note.")).not.toBeInTheDocument())
    expect(await screen.findByPlaceholderText('Title')).toHaveValue('Original Title')
  })

  it('offers safe back-navigation when showBack is true', async () => {
    await renderEditor({ showBack: true })
    expect(screen.getByRole('button', { name: /notebook/i })).toBeInTheDocument()
  })

  it('omits the back button when showBack is false (matches the real editor header\'s own convention)', async () => {
    await renderEditor({ showBack: false })
    expect(screen.queryByRole('button', { name: /notebook/i })).not.toBeInTheDocument()
    // Still never an infinite hang even without a back button -- the retry
    // action alone is enough, and NotebookTab's own persistent folder
    // sidebar (outside this component) remains the safe way out.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
