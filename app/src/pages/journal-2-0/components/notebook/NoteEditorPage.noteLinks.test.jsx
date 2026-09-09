import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { _resetNoteLinkTargetsBatchForTests } from '../../lib/noteLinkTargetsBatch'

// Wave D — the real-editor-mount smoke test that would have caught the
// "Adding different instances of a keyed plugin (suggestion$)" crash found
// live: SlashMenu's own `/`-triggered Suggestion() and NoteLinkMenu's new
// `[[`-triggered one collide unless NoteLinkMenu is given an explicit,
// distinct pluginKey. Same real-editor-mount convention as
// NoteEditorPage.waveB.test.jsx.

const NOTE = {
  id: 'n1', title: 'Original Title', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false,
  bodyJson: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [
        { type: 'text', text: 'See ' },
        { type: 'noteLink', attrs: { noteId: 'target-1' } },
        { type: 'text', text: ' for background.' },
      ] },
    ],
  },
}

vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

beforeEach(() => {
  _resetNoteLinkTargetsBatchForTests()
  global.fetch = vi.fn((url) => {
    if (typeof url === 'string' && url.includes('/link-targets')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ targets: { 'target-1': { title: 'Background Thesis', status: 'active' } } }),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
})
afterEach(() => vi.clearAllMocks())

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
}

describe('NoteEditorPage — Wave D internal note links', () => {
  it('mounts successfully with a noteLink node in the initial body (no plugin-key crash)', async () => {
    await renderEditor()
    // Reaching here at all is the real assertion: the editor construction
    // itself is where the "Adding different instances of a keyed plugin"
    // RangeError was thrown, before any DOM even rendered.
    expect(screen.getByPlaceholderText('Title')).toBeInTheDocument()
  })

  it('resolves and renders the linked note\'s current title', async () => {
    await renderEditor()
    await waitFor(() => expect(screen.getByText('Background Thesis')).toBeInTheDocument())
  })

  it('does not crash with the backlinks section also mounted (renders nothing -- zero backlinks in this fixture)', async () => {
    await renderEditor()
    await waitFor(() => expect(screen.getByText('Background Thesis')).toBeInTheDocument())
    expect(screen.queryByText(/Linked from/)).toBeNull()
  })
})
