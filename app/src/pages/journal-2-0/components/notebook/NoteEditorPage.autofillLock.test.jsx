import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { UNREADABLE_NOTE_MESSAGE } from '../../lib/noteContentGuard'

// Wave 10 lane 10B, review M-4 -- "Suggest values" (G-165) in the REAL editor
// page: offered on an ordinary note, and NEVER on a locked or an unreadable
// one (wave 6's rule: a locked note shows no editing controls at all; the
// title and subtitle are read-only for exactly these two reasons). Asserted by
// what the member SEES, with the ordinary note as the control that proves the
// button would be there.

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const READABLE = { type: 'doc', content: [P('Long NVDA into earnings.')] }
const UNREADABLE = { type: 'doc', content: [P('NVDA thesis'), { type: 'waveSixDiagram', attrs: { id: 'd1' } }] }
let noteLocked = false
let body = READABLE
const note = () => ({
  id: 'n1', title: 'NVDA', subtitle: '', folderId: null, ticker: null, tags: [], heroImageUrl: null,
  updatedAt: '2026-01-01T00:00:00Z', isFavorite: false, bodyJson: body, locked: noteLocked,
})
const AUTH = { user: { id: 'u1' }, isPaid: true }
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: note(), isLoading: false, update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => AUTH }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('../VoiceInputButton', async () => {
  const React = await import('react')
  return { default: React.forwardRef(() => null) }
})

const EMPTY_STATUS = {
  id: 'builtin:thesis_status', name: 'Thesis Status', type: 'select', source: 'user_set', value: null,
  options: [{ id: 'watching', label: 'Watching' }, { id: 'active', label: 'Active' }],
}

beforeEach(() => {
  noteLocked = false
  body = READABLE
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_writing_help_enabled: true })
  global.fetch = vi.fn((url) => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(String(url).endsWith('/api/j2/notes/n1/properties') ? { properties: [EMPTY_STATUS] } : {}),
  }))
})
afterEach(() => { __resetNotebookFlags(); vi.clearAllMocks() })

async function mount() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>)
  await waitFor(() => {
    if (!document.querySelector('.ProseMirror')?.editor) throw new Error('editor not mounted')
  })
  // Notebook UX pass (2026-10-10): the properties sit behind the one "Details" line, collapsed
  // by default. Opened here so "not offered" below means NOT RENDERED, never merely hidden (a
  // hidden button would pass every `queryByRole(...) === null` vacuously).
  const details = screen.getByRole('button', { name: /^(add )?details$/i })
  if (details.getAttribute('aria-expanded') !== 'true') fireEvent.click(details)
  // the Properties section has loaded its list once "Add property" is on screen
  await screen.findByRole('button', { name: /Add property/ })
}

describe('Suggest values -- never on a locked or unreadable note (review M-4)', () => {
  it('control: an ordinary note with an empty property offers it', async () => {
    await mount()
    expect(await screen.findByRole('button', { name: 'Suggest values with Compass' })).toBeTruthy()
  })

  it('a LOCKED note does not', async () => {
    noteLocked = true
    await mount()
    expect(screen.getByRole('textbox', { name: 'Note title' }).readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: 'Suggest values with Compass' })).toBeNull()
  })

  it('an UNREADABLE note does not', async () => {
    body = UNREADABLE
    await mount()
    expect(await screen.findByText(UNREADABLE_NOTE_MESSAGE)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Suggest values with Compass' })).toBeNull()
  })
})
