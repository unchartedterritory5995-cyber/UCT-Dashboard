import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
// M5 (wave 6 fix round 2): a module-level, test-overridable id list — the
// preview's own ids, same as FolderSidebar's real `submitTagRename` would
// hand `onRenameTag` after GET /notes/tag-members. Defaults to the two-note
// N1/I4 scenario every other test in this file exercises.
let renameIds = ['n1', 'n2']
vi.mock('../components/notebook/FolderSidebar', () => ({
  default: ({ onRenameTag }) => (
    <div data-testid="folder-sidebar">
      <button type="button" onClick={() => onRenameTag('earnings', 'quarterly', renameIds)}>
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
 *  wave on with a store holding unsent (queued) work for the given ids.
 *  `unreadable` (wave 6 fix round 2, N1) simulates a note the device could
 *  not be ASKED about at all — the `get` request errors, so `checkUnsentWork`
 *  reports it as `unchecked`, never `unsent`. */
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

let batchCalls = []
function ok(body) { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }) }

beforeEach(() => {
  vi.clearAllMocks()
  blockedIds = new Set()
  hubEligible = false
  batchCalls = []
  renameIds = ['n1', 'n2']
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
    // M9 (wave 6 fix round 2): `getByRole` throws on no match, so an `||`
    // fallback here could never run — this tone is always 'partial' (a
    // change plus a named failure, never a bare error), so it is always
    // `role="status"`.
    const notice = screen.getByRole('status', { hidden: true })
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

describe('NotebookTab — N1 (wave 6 fix round 2): a rename the device cannot check offers "Rename the others", never "Trash anyway"', () => {
  it('names the unchecked note, offers "Rename the others", and confirming carries {from,to} + the tag names', async () => {
    // n1 cannot be asked at all (unreadable); n2 is clean and gets renamed
    // in the first batch — the same partial-plus-offer shape as trash's own
    // R1-S1 test in NotebookTab.bulk.test.jsx.
    withUnsentWork([], { unreadable: ['n1'] })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'rename earnings to quarterly' }))

    // The first batch renames n2 only, and the unchecked note is named —
    // never folded into a "still syncing" sentence.
    const notice = await screen.findByTestId('bulk-notice')
    expect(notice).toHaveTextContent('Renamed 1 note from #earnings to #quarterly.')
    expect(notice).toHaveTextContent(
      'Can\'t check this device for unsent words. 1 note was not renamed: "First note".')
    expect(batchCalls).toEqual([{ ids: ['n2'], op: 'renameTag', args: { from: 'earnings', to: 'quarterly' } }])

    // N1's own defect, pinned as its own absence: never "Trash anyway".
    expect(screen.queryByRole('button', { name: 'Trash anyway' })).toBeNull()
    const renameOthers = screen.getByRole('button', { name: 'Rename the others' })
    fireEvent.click(renameOthers)

    // The armed confirmation is a rename sentence, never a trash one.
    const confirmText = screen.getByText(/^Rename 1 note without checking this device\?/)
    expect(confirmText.textContent).not.toMatch(/Trash/)
    fireEvent.click(screen.getByRole('button', { name: 'Yes, rename the others' }))

    // The retried batch carries the op's own args (fixes the 400) …
    await waitFor(() => expect(batchCalls).toHaveLength(2))
    expect(batchCalls[1]).toEqual({ ids: ['n1'], op: 'renameTag', args: { from: 'earnings', to: 'quarterly' } })
    // … and its OWN success sentence names the real tags, not "#undefined"
    // (the ctx carry — without it this reads "#undefined" instead).
    await waitFor(() => expect(screen.getByTestId('bulk-notice'))
      .toHaveTextContent('Renamed 1 note from #earnings to #quarterly.'))
  })
})

describe('NotebookTab — M5 (wave 6 fix round 2): a tag on more than 500 notes is chunked, not refused', () => {
  it('501 ids become two requests, both renameTag, ids disjoint and complete', async () => {
    renameIds = Array.from({ length: 501 }, (_, i) => `id-${i}`)
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'rename earnings to quarterly' }))
    await waitFor(() => expect(batchCalls).toHaveLength(2))

    expect(batchCalls[0].op).toBe('renameTag')
    expect(batchCalls[1].op).toBe('renameTag')
    expect(batchCalls[0].args).toEqual({ from: 'earnings', to: 'quarterly' })
    expect(batchCalls[1].args).toEqual({ from: 'earnings', to: 'quarterly' })

    // The server's own cap (NOTE_BATCH_MAX in journal_two.py) — the first
    // chunk is exactly at it, never over.
    expect(batchCalls[0].ids).toHaveLength(500)
    expect(batchCalls[1].ids).toHaveLength(1)

    // Disjoint AND complete: every one of the 501 ids appears in EXACTLY one
    // of the two requests, never both, never neither.
    const seen = new Map()
    for (const id of [...batchCalls[0].ids, ...batchCalls[1].ids]) {
      seen.set(id, (seen.get(id) || 0) + 1)
    }
    expect(seen.size).toBe(501)
    expect([...seen.values()].every((n) => n === 1)).toBe(true)
  })
})
