import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Wave 5 bulk operations, WIRED: the real NoteCard, NotesTableView and
 * BulkActionBar under the real NotebookTab, with only the network, the
 * sidebar and the editor stubbed.
 *
 * ⭐ THE REVISION RING IS READ, NOT A SPY ON A HELPER. `recordLandedRevision`
 * is stubbed at the bottom of the stack (as lib/offline/doorFamilies does), so
 * "the batch landed n1 and n2" is asserted from what reached the ring through
 * the real `settleNoteWrites` — the thing that stops an open editor forking.
 *
 * ⛔ FEEDBACK IS ASSERTED BY RENDERED TEXT (CLAUDE.md, 2026-09-09): a notice
 * whose state was set but which rendered blank, or rendered inside the bar its
 * own action unmounts, passes every state assertion and tells the member
 * nothing.
 */

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

let blockedIds = new Set()
vi.mock('../lib/offline/useBlockedNotes', () => ({
  useBlockedNotes: () => ({ blocked: blockedIds }),
}))
vi.mock('../lib/offline/useDurableNote', async (importOriginal) => ({
  ...(await importOriginal()),
  recordLandedRevision: vi.fn(async ({ updatedAt }) => updatedAt),
}))

import NotebookTab from './NotebookTab'
import { recordLandedRevision } from '../lib/offline/useDurableNote'
import { setCurrentAccountId } from '../lib/offline/currentAccount'

const REV = (id) => `2026-09-23T12:00:00.00000${id.slice(1)}+00:00`
let batchCalls = []
let batchAnswer = null
let exportCalls = []

function ok(body, extra = {}) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), ...extra })
}

beforeEach(() => {
  vi.clearAllMocks()
  blockedIds = new Set()
  batchCalls = []
  exportCalls = []
  batchAnswer = (body) => ({
    op: body.op,
    results: body.ids.map((id) => (
      ['favorite', 'unfavorite', 'trash'].includes(body.op)
        ? { id, status: 'changed' }
        : { id, status: 'changed', updatedAt: REV(id) })),
  })
  setCurrentAccountId('acct-A')
  global.fetch = vi.fn((url, init = {}) => {
    const u = String(url)
    if (u === '/api/j2/notes/batch') {
      const body = JSON.parse(init.body)
      batchCalls.push(body)
      const a = batchAnswer(body)
      if (a && a.__status) return Promise.resolve({ ok: false, status: a.__status, json: () => Promise.resolve({ detail: a.detail }) })
      return ok(a)
    }
    if (u === '/api/j2/notes/batch/export') {
      exportCalls.push(JSON.parse(init.body))
      const headers = { 'content-disposition': 'attachment; filename="sel.zip"', 'x-export-count': String(JSON.parse(init.body).ids.length), 'x-export-skipped': '0' }
      return ok({}, { blob: () => Promise.resolve(new Blob(['z'])), headers: { get: (k) => headers[k.toLowerCase()] ?? null } })
    }
    if (u.startsWith('/api/j2/note-folders')) return ok({ folders: [{ id: 'f1', name: 'Research', parentId: null }] })
    if (u.startsWith('/api/j2/notes/tags')) return ok({ tags: [{ tag: 'earnings', count: 1 }] })
    return ok({})
  })
})
afterEach(() => setCurrentAccountId(null))

function renderTab(entry = '/journal?view=all') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <NotebookTab />
    </MemoryRouter>,
  )
}
const box = (title) => screen.getByRole('checkbox', { name: `Select ${title}` })
const toolbar = () => screen.queryByRole('toolbar', { name: 'Actions for the selected notes' })
const landed = () => recordLandedRevision.mock.calls.map(([a]) => [a.noteId, a.updatedAt])

describe('NotebookTab — selecting notes', () => {
  it('every card in the list view carries a checkbox; the board view carries none', () => {
    renderTab()
    expect(box('First note')).toBeInTheDocument()
    expect(box('Third note')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /board view/i }))
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('selecting shows the toolbar with a count; clicking a card body still opens the note', () => {
    renderTab()
    expect(toolbar()).toBeNull()
    fireEvent.click(box('First note'))
    fireEvent.click(box('Second note'))
    expect(within(toolbar()).getByText('2 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Third note/ }))
    expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'n3')
  })

  it('Shift+click selects the range between', () => {
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(box('Third note'), { shiftKey: true })
    expect(box('Second note')).toBeChecked()
    expect(within(toolbar()).getByText('3 selected')).toBeInTheDocument()
  })

  it('"Select all N shown" selects every note in view', () => {
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(screen.getByRole('button', { name: 'Select all 3 shown' }))
    expect(within(toolbar()).getByText('3 selected')).toBeInTheDocument()
  })

  it('Esc clears the selection', () => {
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(toolbar()).toBeNull()
    expect(box('First note')).not.toBeChecked()
  })

  it('⛔ Esc while typing a tag does NOT throw the selection away', () => {
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }))
    const input = screen.getByRole('combobox', { name: 'Tag to add to the selected notes' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(toolbar()).not.toBeNull()
  })

  it('going to another folder starts a fresh selection', () => {
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(screen.getByRole('button', { name: 'go to folder f1' }))
    expect(toolbar()).toBeNull()
  })

  it('the table view selects too, with a select-all header', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /table view/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all notes in view' }))
    expect(within(toolbar()).getByText('3 selected')).toBeInTheDocument()
  })
})

describe('NotebookTab — bulk actions', () => {
  it('move: one request, every advanced revision LANDED, and a sentence saying where', async () => {
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(box('Second note'))
    await screen.findByRole('option', { name: 'Research' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Move the selected notes to a folder' }), { target: { value: 'f1' } })
    expect(await screen.findByText('Moved 2 notes to Research.')).toBeInTheDocument()
    expect(batchCalls).toEqual([{ ids: ['n1', 'n2'], op: 'move', args: { folderId: 'f1' } }])
    expect(landed()).toEqual([['n1', REV('n1')], ['n2', REV('n2')]])
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('add a tag, remove a tag', async () => {
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Tag to add to the selected notes' }), { target: { value: 'research/semis' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    expect(await screen.findByText('Tagged 1 note #research/semis.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove the tag earnings from the selected notes' }))
    expect(await screen.findByText('Removed #earnings from 1 note.')).toBeInTheDocument()
    expect(batchCalls.map((c) => [c.op, c.args.tag])).toEqual([['addTag', 'research/semis'], ['removeTag', 'earnings']])
  })

  it('favorite lands nothing — it never advances a revision', async () => {
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(screen.getByRole('button', { name: 'Favorite' }))
    expect(await screen.findByText('Added 1 note to Favorites.')).toBeInTheDocument()
    expect(landed()).toEqual([])
  })

  it('trash: the notice OUTLIVES the toolbar, Undo takes focus, and Undo restores exactly those notes', async () => {
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(box('Third note'))
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(await screen.findByText('Moved 2 notes to the Trash.')).toBeInTheDocument()
    expect(toolbar()).toBeNull()                      // the bar is gone…
    const undo = screen.getByRole('button', { name: 'Undo' })
    await waitFor(() => expect(undo).toHaveFocus())   // …and the way back is in hand
    fireEvent.click(undo)
    expect(await screen.findByText('Restored 2 notes.')).toBeInTheDocument()
    expect(batchCalls.map((c) => [c.op, c.ids])).toEqual([['trash', ['n1', 'n3']], ['restore', ['n1', 'n3']]])
    // restore advances revisions; the undo lands them like any other door
    expect(landed()).toEqual([['n1', REV('n1')], ['n3', REV('n3')]])
  })

  it('a partial failure names the note that did not change, and why', async () => {
    batchAnswer = (body) => ({
      op: body.op,
      results: [
        { id: 'n1', status: 'changed', updatedAt: REV('n1') },
        { id: 'n2', status: 'in_trash' },
      ],
    })
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(box('Second note'))
    await screen.findByRole('option', { name: 'Research' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Move the selected notes to a folder' }), { target: { value: 'f1' } })
    expect(await screen.findByText(
      'Moved 1 note to Research. 1 note was not changed: "Second note" is in the Trash.',
    )).toBeInTheDocument()
    expect(landed()).toEqual([['n1', REV('n1')]])
  })

  it('⛔ a note waiting to sync is never sent, and the member is told which', async () => {
    blockedIds = new Set(['n2'])
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(box('Second note'))
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(await screen.findByText(/"Second note" is waiting to sync \(edit it again first\)/)).toBeInTheDocument()
    expect(batchCalls).toEqual([{ ids: ['n1'], op: 'trash', args: {} }])
  })

  it('a refused request is an alert with the reason, lands nothing, and keeps the selection', async () => {
    batchAnswer = () => ({ __status: 400, detail: 'folder not found' })
    renderTab()
    fireEvent.click(box('First note'))
    await screen.findByRole('option', { name: 'Research' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Move the selected notes to a folder' }), { target: { value: 'f1' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('folder not found')
    expect(landed()).toEqual([])
    expect(toolbar()).not.toBeNull()
  })

  it('export: the selected notes, minus any waiting to sync, and a sentence saying so', async () => {
    blockedIds = new Set(['n3'])
    const origCreate = URL.createObjectURL
    const origRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      renderTab()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select First note' }))
      fireEvent.click(screen.getByRole('button', { name: 'Select all 3 shown' }))
      fireEvent.click(screen.getByRole('button', { name: 'Export selected' }))
      expect(await screen.findByText(
        'Exported 2 notes as a Markdown zip. 1 not included: waiting to sync (edit it again first).',
      )).toBeInTheDocument()
      expect(exportCalls).toEqual([{ ids: ['n1', 'n2'] }])
    } finally {
      click.mockRestore()
      URL.createObjectURL = origCreate
      URL.revokeObjectURL = origRevoke
    }
  })

  it('in the Trash, the only bulk action is Restore', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'go to trash' }))
    fireEvent.click(box('Second note'))
    expect(screen.queryByRole('button', { name: 'Move to Trash' })).toBeNull()
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Restore' }))
    expect(await screen.findByText('Restored 1 note.')).toBeInTheDocument()
    expect(batchCalls).toEqual([{ ids: ['n2'], op: 'restore', args: {} }])
  })
})
