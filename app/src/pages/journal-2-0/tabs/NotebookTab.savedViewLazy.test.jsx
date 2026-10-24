import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Wave 7 Task 7.6: the "Save view" name prompt's module is fetched on its FIRST open, not on mount.
 * Its own file because the module registry is per FILE: the factory counter below starts at 0 here
 * whatever else ran, which a shared file cannot promise (the lazy component resolves once).
 */

const editorLoads = vi.hoisted(() => ({ factoryRuns: 0 }))
vi.mock('../components/notebook/SavedViewEditor', async (importOriginal) => {
  editorLoads.factoryRuns += 1
  return importOriginal()
})

const mockRefresh = vi.fn()
const NOTES = [
  { id: 'n1', title: 'First note', tags: ['earnings'], updatedAt: '2026-09-18T00:00:00Z' },
  { id: 'n2', title: 'Second note', tags: ['swing'], updatedAt: '2026-09-17T00:00:00Z' },
  { id: 'n3', title: 'Third note', tags: [], updatedAt: '2026-09-16T00:00:00Z' },
]
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: NOTES, isLoading: false, error: null, refresh: mockRefresh, mutate: vi.fn(),
    total: NOTES.length, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
}))
vi.mock('../components/notebook/FolderSidebar', () => ({
  default: ({ onSelectFolder, onSelectAllNotes }) => (
    <div data-testid="folder-sidebar">
      <button type="button" onClick={() => onSelectFolder('__trash__')}>go to trash</button>
      <button type="button" onClick={() => onSelectFolder('f1')}>go to folder f1</button>
      <button type="button" onClick={onSelectAllNotes}>go to all notes</button>
    </div>
  ),
}))
vi.mock('../components/notebook/NoteEditorPage', () => ({
  default: ({ noteId }) => <div data-testid="note-editor" data-note-id={noteId} />,
}))
vi.mock('../components/notebook/NoteBoardView', () => ({ default: () => <div data-testid="note-board" /> }))
vi.mock('../components/notebook/NoteGraphView', () => ({ default: () => <div data-testid="note-graph" /> }))
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../components/notebook/ResearchHome', () => ({ default: () => <div data-testid="research-home" /> }))
// R23-N6: the hub's own answer to "could the joystick be in the corner here?"
let hubEligible = false
vi.mock('../../../hub/useHubActive', async (importOriginal) => ({
  ...(await importOriginal()),
  useHubEligible: () => hubEligible,
}))
// ⭐ The pad geometry is MOVED from what the hub ships: a notice column that
// restated the hub's numbers instead of deriving them from hub/constants.js
// would still sit at the old height here, and the rail below would see it.
vi.mock('../../../hub/constants', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, PAD_PX: real.PAD_PX + 7, BOTTOM_OFFSET_PX: real.BOTTOM_OFFSET_PX + 3 }
})

let blockedIds = new Set()
vi.mock('../lib/offline/useBlockedNotes', () => ({
  useBlockedNotes: () => ({ blocked: blockedIds }),
}))
vi.mock('../lib/offline/useDurableNote', async (importOriginal) => ({
  ...(await importOriginal()),
  recordLandedRevision: vi.fn(async ({ updatedAt }) => updatedAt),
}))
// S1: the durable store, answered PER NOTE (the real noteHasUnsentWork runs over
// it). Only reached when a test turns the offline wave on and gives the page an
// indexedDB; every other test stays 'wave-off' and never opens it.
let unsentStore = null
vi.mock('../lib/offline/notebookDb', async (importOriginal) => ({
  ...(await importOriginal()),
  openNotebookDb: vi.fn(async () => {
    if (!unsentStore) throw new Error('no store in this test')
    return unsentStore
  }),
}))

import NotebookTab from './NotebookTab'
import { setCurrentAccountId } from '../lib/offline/currentAccount'
import { __resetNotebookFlags } from '../lib/offline/notebookFlags'

function ok(body) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}
beforeEach(() => {
  vi.clearAllMocks()
  blockedIds = new Set()
  hubEligible = false
  setCurrentAccountId('acct-A')
  global.fetch = vi.fn((url) => {
    const u = String(url)
    if (u.startsWith('/api/j2/note-folders')) return ok({ folders: [] })
    if (u.startsWith('/api/j2/notes/tags')) return ok({ tags: [] })
    return ok({})
  })
})
afterEach(() => {
  setCurrentAccountId(null)
  vi.unstubAllGlobals()
  __resetNotebookFlags()
})

const renderTab = () => render(<MemoryRouter initialEntries={['/journal?view=all']}><NotebookTab /></MemoryRouter>)
const opener = () => screen.getByRole('button', { name: 'Save view' })

describe('NotebookTab: the Save view prompt loads on its first open (Task 7.6)', () => {
  it('saved_view_editor_module_not_loaded_on_mount', async () => {
    renderTab()
    expect(opener()).toBeInTheDocument()   // non-vacuity: the toolbar that opens it rendered
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.queryByRole('dialog', { name: 'Save view' })).toBeNull()
    expect(editorLoads.factoryRuns).toBe(0)
  })

  it('saved_view_editor_appears_after_first_open', async () => {
    renderTab()
    fireEvent.click(opener())
    expect(await screen.findByRole('dialog', { name: 'Save view' })).toBeInTheDocument()
    expect(editorLoads.factoryRuns).toBe(1)
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument()
  })
})
