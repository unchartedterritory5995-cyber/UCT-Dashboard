import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
import { recordLandedRevision } from '../lib/offline/useDurableNote'
import { setCurrentAccountId } from '../lib/offline/currentAccount'
import { __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { installKeyRange } from '../lib/offline/__fixtures__/fakeIndexedDb'

/** Turn the offline wave on with a store holding unsent work for `queued`;
 *  a note in `unreadable` fails its own read (R1-S1: it cannot be checked). */
function withUnsentWork(queued, { unreadable = [] } = {}) {
  installKeyRange()
  localStorage.setItem('uct.notebook.offline', '1')
  vi.stubGlobal('indexedDB', { open: () => ({}) })
  unsentStore = {
    close() {},
    transaction() {
      return {
        objectStore() {
          return {
            get(noteId) {
              const req = {}
              setTimeout(() => {
                if (unreadable.includes(noteId)) { req.onerror?.(); return }
                req.result = { noteId, dirty: 0 }
                req.onsuccess?.()
              }, 0)
              return req
            },
            index() {
              return {
                getKey(range) {
                  const req = {}
                  setTimeout(() => { req.result = queued.includes(range.__only) ? 'mut-1' : undefined; req.onsuccess?.() }, 0)
                  return req
                },
              }
            },
          }
        },
      }
    },
  }
}

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
afterEach(() => {
  setCurrentAccountId(null)
  unsentStore = null
  localStorage.removeItem('uct.notebook.offline')
  vi.unstubAllGlobals()
  __resetNotebookFlags()
})

/** R1-S1: the offline wave is on, and this device's store can never be opened. */
function withUncheckableDevice() {
  installKeyRange()
  localStorage.setItem('uct.notebook.offline', '1')
  vi.stubGlobal('indexedDB', { open: () => ({}) })
  unsentStore = null   // openNotebookDb rejects: 'no store in this test'
}

function renderTab(entry = '/journal?view=all') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <NotebookTab />
    </MemoryRouter>,
  )
}
const box = (title) => screen.getByRole('checkbox', { name: `Select ${title}` })
const toolbar = () => screen.queryByRole('group', { name: 'Actions for the selected notes' })
/** B1: choosing a folder is not moving — choose, then press Move. */
async function moveTo(folderId) {
  await screen.findByRole('option', { name: 'Research' })
  fireEvent.change(screen.getByRole('combobox', { name: 'Folder to move the selected notes to' }), { target: { value: folderId } })
  fireEvent.click(screen.getByRole('button', { name: 'Move' }))
}
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
    await moveTo('f1')
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

  it('the tag field suggests the member\'s tag TREE — a parent offers what sits below it', async () => {
    const base = global.fetch
    global.fetch = vi.fn((url, init) => (String(url).startsWith('/api/j2/notes/tags')
      ? ok({
        tags: [{ tag: 'research/semis', count: 2 }],
        tree: [
          { path: 'research', key: 'research', own: 0, total: 2 },
          { path: 'research/semis', key: 'research/semis', own: 2, total: 2 },
        ],
      })
      : base(url, init)))
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }))
    const input = screen.getByRole('combobox', { name: 'Tag to add to the selected notes' })
    fireEvent.change(input, { target: { value: 'research/' } })
    expect(await screen.findByRole('option', { name: 'research / semis' })).toBeInTheDocument()
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
    await moveTo('f1')
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
    await moveTo('f1')
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
        'Exported 2 notes as a Markdown zip. 1 note was not included: "Third note" is waiting to sync (edit it again first).',
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

// ── fix round 1 ─────────────────────────────────────────────────────────────

const UNDO_REV = (id) => `2026-09-23T13:00:00.00000${id.slice(1)}+00:00`

describe('NotebookTab — B1: a bulk move can be taken back', () => {
  it('Undo puts every note back in the folder it LEFT, through the same door, and lands the revisions', async () => {
    batchAnswer = (body) => (body.op === 'move' && !body.args.folders
      ? { op: 'move', results: body.ids.map((id) => ({ id, status: 'changed', updatedAt: REV(id), fromFolderId: id === 'n1' ? null : 'f9' })) }
      : { op: body.op, results: body.ids.map((id) => ({ id, status: 'changed', updatedAt: UNDO_REV(id) })) })
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(box('Second note'))
    await moveTo('f1')
    expect(await screen.findByText('Moved 2 notes to Research.')).toBeInTheDocument()
    const undo = screen.getByRole('button', { name: 'Undo' })
    await waitFor(() => expect(undo).toHaveFocus())
    fireEvent.click(undo)
    expect(await screen.findByText('Moved 2 notes back to where they were.')).toBeInTheDocument()
    expect(batchCalls[1]).toEqual({
      ids: ['n1', 'n2'], op: 'move', args: { folders: { n1: null, n2: 'f9' }, expectFolderId: 'f1' },
    })
    expect(landed()).toEqual([
      ['n1', REV('n1')], ['n2', REV('n2')], ['n1', UNDO_REV('n1')], ['n2', UNDO_REV('n2')],
    ])
    // An Undo is not itself undoable.
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })
})

describe('NotebookTab — R1-N3: an Undo that could not put every note back', () => {
  it('says which stayed and why — never "try again" after an Undo', async () => {
    batchAnswer = (body) => {
      if (body.op === 'move' && !body.args.folders) {
        return { op: 'move', results: body.ids.map((id) => ({ id, status: 'changed', updatedAt: REV(id), fromFolderId: 'f9' })) }
      }
      return {
        op: 'move',
        results: [
          { id: 'n1', status: 'moved_since' },
          { id: 'n2', status: 'folder_gone', stayedInFolderId: 'f1', stayedInFolderName: 'Research' },
        ],
      }
    }
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(box('Second note'))
    await moveTo('f1')
    expect(await screen.findByText('Moved 2 notes to Research.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText(
      'Nothing changed. 2 notes were not changed: "First note" was moved again after this — left where it is; '
      + '"Second note" could not go back: its folder no longer exists — it stayed in Research.',
    )).toBeInTheDocument()
    expect(screen.queryByText(/try again/)).toBeNull()
  })
})

describe('NotebookTab — S4: the Undo cannot be lost', () => {
  it('Undo pressed while another batch runs is QUEUED, said so, and restores when that batch ends', async () => {
    const base = global.fetch
    let release = null
    global.fetch = vi.fn((url, init = {}) => {
      if (String(url) === '/api/j2/notes/batch' && JSON.parse(init.body).op === 'favorite') {
        batchCalls.push(JSON.parse(init.body))
        return new Promise((resolve) => {
          release = () => resolve({
            ok: true, status: 200,
            json: () => Promise.resolve({ op: 'favorite', results: [{ id: 'n2', status: 'changed' }] }),
          })
        })
      }
      return base(url, init)
    })
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(box('Third note'))
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(await screen.findByText('Moved 2 notes to the Trash.')).toBeInTheDocument()
    fireEvent.click(box('Second note'))
    fireEvent.click(screen.getByRole('button', { name: 'Favorite' }))
    await waitFor(() => expect(release).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    const notice = screen.getByTestId('bulk-undo-notice')
    expect(notice).toHaveTextContent('Undo will run as soon as the current action finishes.')
    expect(within(notice).getByRole('button', { name: 'Undo queued' })).toBeDisabled()
    expect(batchCalls.map((c) => c.op)).toEqual(['trash', 'favorite'])   // nothing restored yet
    release()
    expect(await screen.findByText('Restored 2 notes.')).toBeInTheDocument()
    expect(batchCalls.map((c) => [c.op, c.ids])).toEqual([
      ['trash', ['n1', 'n3']], ['favorite', ['n2']], ['restore', ['n1', 'n3']],
    ])
  })

  it('a later action\'s sentence appears BESIDE the Undo, never in place of it', async () => {
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(await screen.findByText('Moved 1 note to the Trash.')).toBeInTheDocument()
    fireEvent.click(box('Second note'))
    fireEvent.click(screen.getByRole('button', { name: 'Favorite' }))
    expect(await screen.findByText('Added 1 note to Favorites.')).toBeInTheDocument()
    const notice = screen.getByTestId('bulk-undo-notice')
    expect(notice).toHaveTextContent('Moved 1 note to the Trash.')
    fireEvent.click(within(notice).getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Restored 1 note.')).toBeInTheDocument()
    expect(batchCalls.map((c) => c.op)).toEqual(['trash', 'favorite', 'restore'])
  })

  it('R1-S2: the Undo keeps its OWN slot — a later sentence is a sibling in the stack, never over or around it', async () => {
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(await screen.findByText('Moved 1 note to the Trash.')).toBeInTheDocument()
    fireEvent.click(box('Second note'))
    fireEvent.click(screen.getByRole('button', { name: 'Favorite' }))
    expect(await screen.findByText('Added 1 note to Favorites.')).toBeInTheDocument()

    const stack = screen.getByTestId('bulk-notice-stack')
    const later = screen.getByTestId('bulk-notice')
    const undoBox = screen.getByTestId('bulk-undo-notice')
    const undo = within(undoBox).getByRole('button', { name: 'Undo' })
    // Both present, in their own slots, the Undo LAST (the stack grows upward,
    // so the button does not move when a sentence arrives)…
    expect([...stack.children]).toEqual([later, undoBox])
    // …inside the ONE element the stylesheet fixes (the rule below is only
    // evidence if the page actually wears it).
    expect(stack.className).toMatch(/bulkNoticeStack/)
    // …and neither contains the other: the later notice cannot cover the Undo.
    expect(later.contains(undo)).toBe(false)
    expect(undoBox.contains(later)).toBe(false)
    expect(undo).toBeEnabled()
    fireEvent.click(undo)
    expect(await screen.findByText('Restored 1 note.')).toBeInTheDocument()
    expect(batchCalls.map((c) => c.op)).toEqual(['trash', 'favorite', 'restore'])
  })

  it('R1-S2: only the STACK is fixed — a notice that is itself fixed would sit on top of its sibling', () => {
    // jsdom performs no layout, so the stylesheet is the evidence: the two
    // notices can only overlap if a notice positions itself out of the column.
    const css = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'NotebookTab.module.css'), 'utf8')
    const rule = (sel) => {
      const m = css.match(new RegExp(`\\n\\${sel}\\s*\\{([^}]*)\\}`))
      return m ? m[1] : null
    }
    const stackRule = rule('.bulkNoticeStack')
    const noticeRule = rule('.bulkNotice')
    expect(stackRule, 'the stack rule exists').not.toBeNull()
    expect(noticeRule, 'the notice rule exists').not.toBeNull()
    expect(stackRule).toMatch(/position:\s*fixed/)
    expect(stackRule).toMatch(/display:\s*flex/)
    expect(stackRule).toMatch(/flex-direction:\s*column/)
    expect(stackRule).toMatch(/pointer-events:\s*none/)
    expect(noticeRule).not.toMatch(/position:/)
    expect(noticeRule).toMatch(/pointer-events:\s*auto/)   // the Undo still takes the click
  })
})

describe('NotebookTab — S1: a note still SENDING is neither trashed nor exported', () => {
  it('a queued note the drain has not retired is refused for trash, and named', async () => {
    withUnsentWork(['n2'])
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(box('Second note'))
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(await screen.findByText(
      'Moved 1 note to the Trash. 1 note was not changed: "Second note" is still syncing — try again in a moment.',
    )).toBeInTheDocument()
    expect(batchCalls).toEqual([{ ids: ['n1'], op: 'trash', args: {} }])
  })

  it('…and left out of an export, by name', async () => {
    withUnsentWork(['n2'])
    const origCreate = URL.createObjectURL
    const origRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      renderTab()
      fireEvent.click(box('Second note'))
      fireEvent.click(box('Third note'))
      fireEvent.click(screen.getByRole('button', { name: 'Export selected' }))
      expect(await screen.findByText(
        'Exported 1 note as a Markdown zip. 1 note was not included: "Second note" is still syncing — try again in a moment.',
      )).toBeInTheDocument()
      expect(exportCalls).toEqual([{ ids: ['n3'] }])
    } finally {
      click.mockRestore()
      URL.createObjectURL = origCreate
      URL.revokeObjectURL = origRevoke
    }
  })

  it('⛔ CONTROL — a move still goes through for that note (it rebases, the words still arrive)', async () => {
    withUnsentWork(['n2'])
    renderTab()
    fireEvent.click(box('Second note'))
    await moveTo('f1')
    expect(await screen.findByText('Moved 1 note to Research.')).toBeInTheDocument()
    expect(batchCalls).toEqual([{ ids: ['n2'], op: 'move', args: { folderId: 'f1' } }])
  })
})

describe('NotebookTab — R1-S1: a device that cannot be CHECKED is told so, and offered a confirmed way through', () => {
  const UNCHECKED = /Can't check this device for unsent words\./

  it('trash: the true sentence, nothing sent, and "Trash anyway" proceeds only after the confirmation', async () => {
    withUncheckableDevice()
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(await screen.findByText(
      'Can\'t check this device for unsent words. 1 note was not moved to the Trash: "First note".',
    )).toBeInTheDocument()
    expect(screen.queryByText(/still syncing|try again/)).toBeNull()      // the untrue sentence is gone
    expect(batchCalls).toEqual([])                                        // never a silent proceed
    fireEvent.click(screen.getByRole('button', { name: 'Trash anyway' }))
    expect(screen.getByText(/^Move 1 note to the Trash without checking this device\?/)).toBeInTheDocument()
    expect(batchCalls).toEqual([])                                        // the first press is not the confirmation
    const yes = screen.getByRole('button', { name: 'Yes, trash anyway' })
    await waitFor(() => expect(yes).toHaveFocus())
    fireEvent.click(yes)
    expect(await screen.findByText('Moved 1 note to the Trash.')).toBeInTheDocument()
    expect(batchCalls).toEqual([{ ids: ['n1'], op: 'trash', args: {} }])
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()    // and it can still be taken back
  })

  it('Cancel goes back to the sentence and sends nothing', async () => {
    withUncheckableDevice()
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(await screen.findByText(UNCHECKED)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Trash anyway' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText(UNCHECKED)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trash anyway' })).toBeInTheDocument()
    expect(batchCalls).toEqual([])
  })

  it('a partial trash: the Undo for what moved and the offer for what could not be checked stand side by side', async () => {
    withUnsentWork([], { unreadable: ['n1'] })
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(box('Third note'))
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(await screen.findByText('Moved 1 note to the Trash.')).toBeInTheDocument()
    expect(batchCalls).toEqual([{ ids: ['n3'], op: 'trash', args: {} }])
    const offer = screen.getByTestId('bulk-notice')
    expect(offer).toHaveTextContent('Can\'t check this device for unsent words. 1 note was not moved to the Trash: "First note".')
    expect(within(screen.getByTestId('bulk-undo-notice')).getByRole('button', { name: 'Undo' })).toBeEnabled()
    fireEvent.click(within(offer).getByRole('button', { name: 'Trash anyway' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, trash anyway' }))
    await waitFor(() => expect(batchCalls).toHaveLength(2))
    expect(batchCalls[1]).toEqual({ ids: ['n1'], op: 'trash', args: {} })
  })

  it('export: the same truth, and "Export anyway" exports only after the confirmation', async () => {
    withUncheckableDevice()
    const origCreate = URL.createObjectURL
    const origRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      renderTab()
      fireEvent.click(box('Second note'))
      fireEvent.click(screen.getByRole('button', { name: 'Export selected' }))
      expect(await screen.findByText(
        'Can\'t check this device for unsent words. 1 note was not included: "Second note".',
      )).toBeInTheDocument()
      expect(exportCalls).toEqual([])
      fireEvent.click(screen.getByRole('button', { name: 'Export anyway' }))
      expect(screen.getByText(/^Export 1 note without checking this device\?/)).toBeInTheDocument()
      expect(exportCalls).toEqual([])
      fireEvent.click(screen.getByRole('button', { name: 'Yes, export anyway' }))
      expect(await screen.findByText('Exported 1 note as a Markdown zip.')).toBeInTheDocument()
      expect(exportCalls).toEqual([{ ids: ['n2'] }])
    } finally {
      click.mockRestore()
      URL.createObjectURL = origCreate
      URL.revokeObjectURL = origRevoke
    }
  })

  it('⛔ CONTROL — a device that CAN be checked is never offered "anyway"', async () => {
    withUnsentWork(['n2'])
    renderTab()
    fireEvent.click(box('Second note'))
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(await screen.findByText(/"Second note" is still syncing/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Trash anyway' })).toBeNull()
    expect(screen.queryByText(UNCHECKED)).toBeNull()
  })
})

describe('NotebookTab — R1-N4: a bulk action re-asks the tag counts only when it can move them', () => {
  const tagAsks = () => global.fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/j2/notes/tags')).length
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })

  it('a move or a favourite does not; a tag edit and a trash do', async () => {
    renderTab()
    await waitFor(() => expect(tagAsks()).toBeGreaterThan(0))      // non-vacuity: the probe sees the key
    await settle()
    let before = tagAsks()
    fireEvent.click(box('First note'))
    await moveTo('f1')
    expect(await screen.findByText('Moved 1 note to Research.')).toBeInTheDocument()
    await settle()
    expect(tagAsks()).toBe(before)                                   // a move cannot change a count

    fireEvent.keyDown(document, { key: 'Escape' })                    // a fresh selection each time
    fireEvent.click(box('Second note'))
    fireEvent.click(screen.getByRole('button', { name: 'Favorite' }))
    expect(await screen.findByText('Added 1 note to Favorites.')).toBeInTheDocument()
    await settle()
    expect(tagAsks()).toBe(before)                                   // nor a favourite

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(box('Third note'))
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Tag to add to the selected notes' }), { target: { value: 'fresh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    expect(await screen.findByText('Tagged 1 note #fresh.')).toBeInTheDocument()
    await settle()
    expect(tagAsks()).toBeGreaterThan(before)                        // a tag edit can
    before = tagAsks()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(box('First note'))
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(await screen.findByText('Moved 1 note to the Trash.')).toBeInTheDocument()
    await settle()
    expect(tagAsks()).toBeGreaterThan(before)                        // and so can a trash (live notes only)
  })
})
