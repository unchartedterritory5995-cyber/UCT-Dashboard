import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Wave 6 lane E fix round 1, I4 — the tag tree's rename door, wired end to
 * end through the REAL NotebookTab: FolderSidebar's `onRenameTag` (item 8's
 * client caller) goes through `runBulk('renameTag', ...)`, exactly like
 * every other bulk action, so a note whose words are still SENDING is
 * refused and NAMED in `bulkNotice` -- rendered DOM text, never state alone
 * (CLAUDE.md, 2026-09-09; the same discipline NotebookTab.bulk.test.jsx
 * already holds every other op to).
 *
 * Trimmed copy of NotebookTab.bulk.test.jsx's harness: only what this one
 * scenario needs. FolderSidebar is stubbed here too (as that file stubs
 * it) — the REAL tag-tree UI (the preview + input + Rename/Cancel) is
 * railed on its own in FolderSidebar.tagRename.test.jsx; this file's job is
 * proving the DOOR from `onRenameTag` through to the rendered refusal text.
 */

const mockRefresh = vi.fn()
const NOTES = [
  { id: 'n1', title: 'First note', tags: ['earnings'], updatedAt: '2026-09-18T00:00:00Z' },
  { id: 'n2', title: 'Second note', tags: ['earnings'], updatedAt: '2026-09-17T00:00:00Z' },
]
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: NOTES, isLoading: false, error: null, refresh: mockRefresh, mutate: vi.fn(),
    total: NOTES.length, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
}))
vi.mock('../components/notebook/FolderSidebar', () => ({
  default: ({ onRenameTag }) => (
    <div data-testid="folder-sidebar">
      <button type="button" onClick={() => onRenameTag('earnings', 'quarterly', ['n1', 'n2'])}>
        rename earnings to quarterly
      </button>
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
let hubEligible = false
vi.mock('../../../hub/useHubActive', async (importOriginal) => ({
  ...(await importOriginal()),
  useHubEligible: () => hubEligible,
}))

let blockedIds = new Set()
vi.mock('../lib/offline/useBlockedNotes', () => ({
  useBlockedNotes: () => ({ blocked: blockedIds }),
}))
vi.mock('../lib/offline/useDurableNote', async (importOriginal) => ({
  ...(await importOriginal()),
  recordLandedRevision: vi.fn(async ({ updatedAt }) => updatedAt),
}))
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
import { installKeyRange } from '../lib/offline/__fixtures__/fakeIndexedDb'

/** Same shape as NotebookTab.bulk.test.jsx's own helper: turns the offline
 *  wave on with a store holding unsent (queued) work for the given ids. */
function withUnsentWork(queued) {
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
              setTimeout(() => { req.result = { noteId, dirty: 0 }; req.onsuccess?.() }, 0)
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

let batchCalls = []
function ok(body) { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }) }

beforeEach(() => {
  vi.clearAllMocks()
  blockedIds = new Set()
  hubEligible = false
  batchCalls = []
  setCurrentAccountId('acct-A')
  global.fetch = vi.fn((url, init = {}) => {
    const u = String(url)
    if (u === '/api/j2/notes/batch') {
      const body = JSON.parse(init.body)
      batchCalls.push(body)
      return ok({ op: body.op, results: body.ids.map((id) => ({ id, status: 'changed', updatedAt: '2026-09-24T00:00:00Z' })) })
    }
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

function renderTab() {
  return render(<MemoryRouter initialEntries={['/journal?view=all']}><NotebookTab /></MemoryRouter>)
}

describe('NotebookTab — the tag-rename door refuses unsent work, named (wave 6 fix round 1, I4)', () => {
  it('a note whose words are still sending is held back and NAMED in the rendered notice; the rest is sent', async () => {
    withUnsentWork(['n2'])
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'rename earnings to quarterly' }))
    expect(await screen.findByText(/is still syncing/)).toBeInTheDocument()
    const notice = screen.getByRole('status', { hidden: true }) || screen.getByRole('alert')
    expect(notice.textContent).toMatch(/Renamed 1 note from #earnings to #quarterly/)
    expect(notice.textContent).toMatch(/"Second note" is still syncing/)
    expect(batchCalls).toHaveLength(1)
    expect(batchCalls[0]).toMatchObject({ op: 'renameTag', ids: ['n1'], args: { from: 'earnings', to: 'quarterly' } })
  })

  it('CONTROL: with no unsent work, both notes are sent and the notice says so plainly', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'rename earnings to quarterly' }))
    expect(await screen.findByText(/Renamed 2 notes from #earnings to #quarterly/)).toBeInTheDocument()
    expect(batchCalls[0].ids).toEqual(['n1', 'n2'])
  })
})
