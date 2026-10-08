import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

// Wave 13 lane 13D — the note door of a resurfacing insight: `?resurfaceVersion=<id>` opens
// the version that first named the level, read-only, beside the live note. Real editor mount.
//   * flag ON + the door's own note: the sheet shows THAT version (fetched by its id);
//   * flag OFF: the parameter is ignored -- no sheet, no version request (inert);
//   * the door names another note (a side pane): this editor does not answer it;
//   * closing returns to the note as it is now and drops the parameter.

const NOTE = {
  id: 'n1', title: 'NVDA swing plan (now)', subtitle: '', folderId: null,
  ticker: 'NVDA', tags: [], heroImageUrl: null, updatedAt: '2026-10-02T12:00:00Z',
  isFavorite: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Stop: 100 Target: 130' }] }] },
}
const VERSION = {
  id: 'v1', noteId: 'n1', title: 'NVDA swing plan', subtitle: null, createdAt: '2026-09-12T15:00:00Z',
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Stop: 100 (the original plan)' }] }] },
}

vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

let versionRequests = []
beforeEach(() => {
  versionRequests = []
  __resetNotebookFlags()
  global.fetch = vi.fn((url) => {
    if (typeof url === 'string' && /\/api\/j2\/notes\/n1\/versions\/v1$/.test(url)) {
      versionRequests.push(url)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ version: VERSION }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
})
afterEach(() => { vi.clearAllMocks(); __resetNotebookFlags() })

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{loc.search}</div>
}

async function renderAt(search) {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(
    <MemoryRouter initialEntries={[`/journal/notebook${search}`]}>
      <NoteEditorPage noteId="n1" onBack={vi.fn()} showBack />
      <Where />
    </MemoryRouter>,
  )
  await screen.findByPlaceholderText('Title')
}

describe('NoteEditorPage — lane 13D resurfacing door', () => {
  it('flag ON: opens the version that named the level, read-only, and closing drops the parameter', async () => {
    latchNotebookFlags({ awareness_note_resurface_enabled: true })
    await renderAt('?note=n1&resurfaceVersion=v1')
    const dialog = await screen.findByRole('dialog', { name: 'What you wrote then' })
    await waitFor(() => expect(dialog).toHaveTextContent('Stop: 100 (the original plan)'))
    expect(dialog).toHaveTextContent('first named the level')
    expect(versionRequests).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Back to the note as it is now' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'What you wrote then' })).toBeNull())
    expect(screen.getByTestId('where').textContent).toBe('?note=n1')
  })

  it('flag OFF: the parameter is ignored -- no sheet and no version request', async () => {
    latchNotebookFlags({ awareness_note_resurface_enabled: false })
    await renderAt('?note=n1&resurfaceVersion=v1')
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('dialog', { name: 'What you wrote then' })).toBeNull()
    expect(versionRequests).toHaveLength(0)
  })

  it('a door naming ANOTHER note is not answered by this editor', async () => {
    latchNotebookFlags({ awareness_note_resurface_enabled: true })
    await renderAt('?note=other&resurfaceVersion=v1')
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('dialog', { name: 'What you wrote then' })).toBeNull()
    expect(versionRequests).toHaveLength(0)
  })
})
