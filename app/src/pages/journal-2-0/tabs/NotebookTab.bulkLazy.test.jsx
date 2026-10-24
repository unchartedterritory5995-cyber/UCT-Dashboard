import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Wave 7 Task 7.3: the bulk bar's module is fetched on the FIRST selection, not on mount.
 * Its own file because the module registry is per FILE: the factory counter below starts at 0 here
 * whatever else ran, which a shared file cannot promise (the lazy component resolves once).
 */

const bulkBarLoads = vi.hoisted(() => ({ factoryRuns: 0 }))
vi.mock('../components/notebook/BulkActionBar', async (importOriginal) => {
  bulkBarLoads.factoryRuns += 1
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

const box = (title) => screen.getByRole('checkbox', { name: `Select ${title}` })
const toolbar = () => screen.queryByRole('group', { name: 'Actions for the selected notes' })
const renderTab = () => render(<MemoryRouter initialEntries={['/journal?view=all']}><NotebookTab /></MemoryRouter>)

describe('NotebookTab: the bulk bar loads on the first selection (Task 7.3)', () => {
  it('bulk_bar_module_not_loaded_without_selection', async () => {
    renderTab()
    expect(box('First note')).toBeInTheDocument()   // non-vacuity: the list and its checkboxes rendered
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(toolbar()).toBeNull()
    expect(bulkBarLoads.factoryRuns).toBe(0)
  })

  it('bulk_bar_appears_after_first_select', async () => {
    renderTab()
    fireEvent.click(box('First note'))
    expect(await screen.findByRole('group', { name: 'Actions for the selected notes' })).toBeInTheDocument()
    expect(bulkBarLoads.factoryRuns).toBe(1)
    expect(within(toolbar()).getByText('1 selected')).toBeInTheDocument()
  })
})
