import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Wave 6 (lane E, item 1) — Archive, WIRED: the real NoteCard, BulkActionBar,
 * NoteMenuActions and noteBatch under the real NotebookTab; the network, the
 * sidebar and the editor stubbed.
 *
 * Pins: the Archived entry lists `folder_id=__archived__` with no tag/ticker/
 * saved-view scoping; its cards still open and carry Unarchive (which PATCHes
 * and settles); the bulk bar archives with an Undo that unarchives exactly the
 * notes it archived; and the editor is handed the note menu (`noteMenu`), whose
 * Archive button is the real one.
 * ⛔ Feedback is asserted by RENDERED TEXT (CLAUDE.md, 2026-09-09).
 */

const mockRefresh = vi.fn()
const hookCalls = []
const NOTES = [
  { id: 'n1', title: 'First note', tags: ['earnings'], updatedAt: '2026-09-18T00:00:00Z' },
  { id: 'n2', title: 'Second note', tags: [], updatedAt: '2026-09-17T00:00:00Z' },
]
vi.mock('../hooks/useJ2Notes', () => ({
  default: (args) => {
    hookCalls.push(args || {})
    return {
      notes: NOTES, isLoading: false, error: null, refresh: mockRefresh, mutate: vi.fn(),
      total: NOTES.length, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
    }
  },
}))
vi.mock('../components/notebook/FolderSidebar', () => ({
  default: ({ onSelectFolder, onSelectTag }) => (
    <div data-testid="folder-sidebar">
      <button type="button" onClick={() => onSelectFolder('__archived__')}>go to archive</button>
      <button type="button" onClick={() => onSelectTag('earnings')}>go to tag</button>
    </div>
  ),
}))
// The editor is lane D's; this stand-in renders the note menu it is handed,
// exactly as the requested one-line mount would.
vi.mock('../components/notebook/NoteEditorPage', () => ({
  default: ({ noteId, noteMenu }) => (
    <div data-testid="note-editor" data-note-id={noteId}>
      {noteMenu?.({ id: noteId, title: 'Open note', archivedAt: null }, { refresh: () => {} })}
    </div>
  ),
}))
vi.mock('../components/notebook/NoteBoardView', () => ({ default: () => <div data-testid="note-board" /> }))
vi.mock('../components/notebook/NoteGraphView', () => ({ default: () => <div data-testid="note-graph" /> }))
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../components/notebook/ResearchHome', () => ({ default: () => <div data-testid="research-home" /> }))
vi.mock('../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))
vi.mock('../lib/offline/useDurableNote', async (importOriginal) => ({
  ...(await importOriginal()),
  recordLandedRevision: vi.fn(async ({ updatedAt }) => updatedAt),
}))

import NotebookTab from './NotebookTab'
import { recordLandedRevision } from '../lib/offline/useDurableNote'
import { setCurrentAccountId } from '../lib/offline/currentAccount'

let batchCalls = []
let patchCalls = []

function ok(body) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  hookCalls.length = 0
  batchCalls = []
  patchCalls = []
  setCurrentAccountId('acct-A')
  global.fetch = vi.fn((url, init = {}) => {
    const u = String(url)
    if (u === '/api/j2/notes/batch') {
      const body = JSON.parse(init.body)
      batchCalls.push(body)
      return ok({ op: body.op, results: body.ids.map((id) => ({ id, status: 'changed' })) })
    }
    const m = u.match(/^\/api\/j2\/notes\/([^/]+)\/archive$/)
    if (m && init.method === 'PATCH') {
      const body = JSON.parse(init.body)
      patchCalls.push({ id: decodeURIComponent(m[1]), body })
      return ok({ note: { id: m[1], updatedAt: '2026-09-18T00:00:00Z', archivedAt: body.archived ? 'x' : null } })
    }
    if (u.startsWith('/api/j2/note-folders')) return ok({ folders: [] })
    if (u.startsWith('/api/j2/notes/tags')) return ok({ tags: [] })
    return ok({})
  })
})
afterEach(() => {
  setCurrentAccountId(null)
})

function renderTab(entry = '/journal?view=all') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <NotebookTab />
    </MemoryRouter>,
  )
}
/** The MAIN list's hook call (the one that carries a sort other than 'title'). */
const lastMainListArgs = () => [...hookCalls].reverse().find((a) => a.sort !== 'title' && a.limit !== 1)

describe('the Archived entry', () => {
  it('lists the archive sentinel with no tag, ticker or saved-view scoping', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'go to tag' }))
    await waitFor(() => expect(lastMainListArgs().tag).toBe('earnings'))
    fireEvent.click(screen.getByRole('button', { name: 'go to archive' }))
    await waitFor(() => expect(lastMainListArgs().folderId).toBe('__archived__'))
    expect(lastMainListArgs().tag).toBeUndefined()
    expect(lastMainListArgs().savedViewId).toBeUndefined()
    expect(lastMainListArgs().deleted).toBe(false)
    expect(screen.getByText('Archived')).toBeInTheDocument()
    // A shelf lists as cards: the view-mode switcher is not offered there.
    expect(screen.queryByRole('button', { name: 'Board view' })).not.toBeInTheDocument()
  })

  it('an archived card still opens, and its Unarchive brings the note back and settles', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'go to archive' }))
    const unarchive = await screen.findByRole('button', { name: 'Unarchive First note' })
    // ⛔ Beside the card, never inside it: the card is itself a button.
    expect(unarchive.closest('[data-note-card-id]')).toBeNull()
    fireEvent.click(unarchive)
    await waitFor(() => expect(patchCalls).toEqual([{ id: 'n1', body: { archived: false } }]))
    await waitFor(() => expect(recordLandedRevision).toHaveBeenCalled())
    expect(mockRefresh).toHaveBeenCalled()
    // The card itself is still the open-the-note button.
    fireEvent.click(screen.getByText('Second note'))
    await waitFor(() => expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'n2'))
  })
})

describe('the bulk bar', () => {
  it('archives the selection, says so, and its Undo unarchives exactly those notes', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select First note' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second note' }))
    fireEvent.click(screen.getByRole('button', { name: /^Archive$/ }))
    await waitFor(() => expect(batchCalls).toHaveLength(1))
    expect(batchCalls[0]).toMatchObject({ op: 'archive', ids: ['n1', 'n2'] })
    expect(await screen.findByText('Archived 2 notes. They are under Archived, in the sidebar.')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /Undo/ }))
    await waitFor(() => expect(batchCalls).toHaveLength(2))
    expect(batchCalls[1]).toMatchObject({ op: 'unarchive', ids: ['n1', 'n2'] })
  })

  it('in the Archived entry the bar offers Unarchive, not Move or Tags', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'go to archive' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select First note' }))
    expect(screen.getByRole('button', { name: /^Unarchive$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tags/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Unarchive$/ }))
    await waitFor(() => expect(batchCalls[0]).toMatchObject({ op: 'unarchive', ids: ['n1'] }))
  })
})

describe('the note menu', () => {
  it('hands the editor a note menu whose Archive is the real one', async () => {
    renderTab('/journal?note=n9')
    const editor = await screen.findByTestId('note-editor')
    expect(editor).toHaveAttribute('data-note-id', 'n9')
    fireEvent.click(screen.getByRole('button', { name: /^Archive$/ }))
    await waitFor(() => expect(patchCalls).toEqual([{ id: 'n9', body: { archived: true } }]))
    expect(await screen.findByText('Archived. It is under Archived in the sidebar, still in its folder.')).toBeInTheDocument()
  })
})
