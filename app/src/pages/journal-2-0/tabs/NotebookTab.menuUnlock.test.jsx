/**
 * Wave 6 lane E fix round 3, M2 (remainder) — the note menu's Unlock, wired
 * through the REAL NotebookTab, for BOTH panes.
 *
 * ⚰️ THE GAP THIS CLOSES. `NoteEditorPage.menuUnlock.test.jsx` proves the
 * MECHANISM (the menu's Unlock reaches the editor's own settle) by mounting
 * `NoteEditorPage` directly and handing it a hand-built `noteMenu` render
 * prop. It never asks whether NotebookTab's OWN two `noteMenu={...}` call
 * sites (main pane, side pane) actually pass `onUnlock={api?.unlockNote}` —
 * the round-2 re-review found the side pane's did not, and NotebookTab's own
 * tests all STUB `NoteEditorPage`, so nothing could see it (`api` was thrown
 * away by the stub before `onUnlock` was ever read).
 *
 * This file stubs everything NotebookTab needs to render EXCEPT
 * `NoteEditorPage` itself, mounts two REAL locked notes side by side
 * (`?note=n1&side=n2`, desktop), and drives the menu's Unlock in each pane.
 *
 * WHAT IT PROVES, per pane: unlock from the menu → a keystroke → the autosave
 * PUT carries the POST-unlock revision (`baseUpdatedAt === T2[id]`) and no 409
 * happens.
 *
 * ⭐ WHY IT CAN TELL THE TWO DOORS APART (wave 6 fix round 4, R4-1). The note
 * the editor sees is the harness's SERVER copy (`SERVERS[id]`), and `refresh`
 * re-reads it — as `useJ2Note`'s SWR `mutate()` does. So a pane whose menu is
 * NOT wired to the editor's own `unlockNote` still ends editable: the thin
 * `setNoteLock` door lands the PATCH, the refresh shows `locked: false`, the
 * member can type — and the first save goes out on the PRE-unlock revision
 * and is refused as a conflict. That is the member-visible defect, and it is
 * what reds here: cut either pane's `onUnlock` and the test fails on the
 * PUT's `baseUpdatedAt` / the conflict counter, not on `isEditable`.
 * ⚰️ Until round 4 the harness served a STATIC `locked: true` copy and a
 * no-op `refresh`, so the thin door could never make the editor editable and
 * a cut wire failed on `isEditable` — before either assertion this header
 * claimed decided the test.
 */
import { useCallback, useReducer } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createFakeIndexedDbFactory, settleIdb } from '../lib/offline/__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections } from '../lib/offline/useDurableNote'
import { OFFLINE_FLAG_KEY } from '../lib/offline/offlineFlag'
import { dbNameFor } from '../lib/offline/notebookDb'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const T1 = '2026-09-24T14:00:00.000000+00:00'
// Distinct post-unlock revisions per note so a mix-up between panes cannot
// pass by accident (each assertion names its OWN note's stamp).
const T2 = { n1: '2026-09-24T15:00:00.000000+00:00', n2: '2026-09-24T16:00:00.000000+00:00' }
const bodyFor = (label) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Original ${label} body` }] }] })
const baseNote = (id, label) => ({
  id, title: `${label} thesis`, subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: T1,
  isFavorite: false, locked: true, bodyJson: bodyFor(label),
})

let SERVERS // { n1, n2 } — the "server" copy: what useJ2Note serves and what update()/fetch act on
let REV // { n1, n2 } — a monotonic revision counter per note
let CONFLICTS // { n1: 0, n2: 0 }
const updateMock = vi.fn() // records [noteId, patch] for every call, either note

vi.mock('../../../hooks/useBreakpoint', async (importOriginal) => ({
  ...(await importOriginal()),
  useIsDesktop: () => true,
}))
vi.mock('../../../context/AuthContext', async (importOriginal) => ({
  ...(await importOriginal()),
  useAuth: () => ({ user: { id: 'u42', role: 'member' } }),
}))
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: [], isLoading: false, error: null, refresh: vi.fn(),
    mutate: vi.fn(), total: 0, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
  useJ2Note: (noteId) => {
    // `refresh` re-reads the server copy, like SWR's `mutate()`: it re-renders
    // the editor, which then sees whatever the PATCH/PUT left in SERVERS.
    const [, reread] = useReducer((n) => n + 1, 0)
    const refresh = useCallback(async () => { reread() }, [])
    return {
      note: SERVERS[noteId],
      isLoading: false,
      error: null,
      update: async (patch) => {
        updateMock(noteId, patch)
        const server = SERVERS[noteId]
        if (patch && 'baseUpdatedAt' in patch && patch.baseUpdatedAt !== server.updatedAt) {
          CONFLICTS[noteId] += 1
          const err = new Error('conflict')
          err.status = 409
          throw err
        }
        const { baseUpdatedAt, ...fields } = patch || {}
        REV[noteId] += 1
        SERVERS[noteId] = { ...server, ...fields, updatedAt: `2026-09-24T14:${10 + REV[noteId]}:00.000000+00:00` }
        return { ...SERVERS[noteId] }
      },
      refresh,
    }
  },
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('../components/notebook/FolderSidebar', () => ({ default: () => <div data-testid="folder-sidebar" /> }))
vi.mock('../components/notebook/NoteBoardView', () => ({ default: () => <div data-testid="note-board" /> }))
vi.mock('../components/notebook/NoteGraphView', () => ({ default: () => <div data-testid="note-graph" /> }))
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../components/notebook/ResearchHome', () => ({ default: () => <div data-testid="research-home" /> }))
vi.mock('../../../hub/useHubActive', async (importOriginal) => ({
  ...(await importOriginal()),
  useHubEligible: () => false,
}))
vi.mock('../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))

import NotebookTab from './NotebookTab'

let factory
beforeEach(() => {
  SERVERS = { n1: baseNote('n1', 'Main'), n2: baseNote('n2', 'Side') }
  REV = { n1: 0, n2: 0 }
  CONFLICTS = { n1: 0, n2: 0 }
  updateMock.mockReset()
  localStorage.clear()
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url)
    const method = (opts.method || 'GET').toUpperCase()
    const lock = u.match(/^\/api\/j2\/notes\/(n1|n2)\/lock$/)
    if (lock && method === 'PATCH') {
      const id = lock[1]
      SERVERS[id] = { ...SERVERS[id], locked: JSON.parse(opts.body).locked, updatedAt: T2[id] }
      return { ok: true, status: 200, json: async () => ({ note: { ...SERVERS[id] } }) }
    }
    const get = u.match(/^\/api\/j2\/notes\/(n1|n2)$/)
    if (get && method === 'GET') {
      const id = get[1]
      return { ok: true, status: 200, json: async () => ({ note: { ...SERVERS[id] } }) }
    }
    if (u === '/api/j2/notes' && method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ note: { id: 'forkX', updatedAt: T1 } }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
  __resetNotebookConnections()
  factory = createFakeIndexedDbFactory()
  globalThis.indexedDB = factory
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  localStorage.clear()
  delete globalThis.indexedDB
})

function renderBothPanes() {
  return render(
    <MemoryRouter initialEntries={['/journal?note=n1&side=n2']}>
      <NotebookTab />
    </MemoryRouter>,
  )
}

const mainPane = () => document.querySelector('[data-note-pane="main"]')
const sidePane = () => document.querySelector('[data-note-pane="side"]')

async function unlockAndType(pane, noteId) {
  await within(pane).findByPlaceholderText('Title')
  await act(async () => { await settleIdb(4) })
  const editor = await waitFor(() => {
    const el = pane.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error(`editor not mounted for ${noteId}`)
    return el.editor
  })
  expect(editor.isEditable, `${noteId} started editable`).toBe(false)

  const menu = within(pane).getByRole('group', { name: 'Organise this note' })
  fireEvent.click(within(menu).getByRole('button', { name: 'Unlock' }))
  await waitFor(() => expect(editor.isEditable, `${noteId} never became editable`).toBe(true))
  await act(async () => { await settleIdb(6) })

  act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' and more') })
  await act(async () => { vi.advanceTimersByTime(900); await settleIdb(6) })
  await act(async () => { vi.advanceTimersByTime(200); await settleIdb(6) })
}

const bodyPutsFor = (noteId) => updateMock.mock.calls
  .filter(([id]) => id === noteId)
  .map(([, patch]) => patch)
  .filter((p) => p && 'bodyJson' in p)

describe('M2 (remainder, wave 6 fix round 3) — the menu\'s Unlock reaches the settle in BOTH panes', () => {
  it('main pane: unlock from the menu, a keystroke, the autosave — the PUT carries the post-unlock revision, no 409', async () => {
    renderBothPanes()
    await unlockAndType(mainPane(), 'n1')

    const puts = bodyPutsFor('n1')
    expect(puts.length, 'the main pane\'s autosave never fired').toBeGreaterThan(0)
    expect(puts[0].baseUpdatedAt, 'the first save went out on the PRE-unlock revision').toBe(T2.n1)
    expect(CONFLICTS.n1, 'the member\'s own save after a menu unlock was refused as a conflict').toBe(0)
  })

  it('side pane: unlock from the menu, a keystroke, the autosave — the PUT carries the post-unlock revision, no 409', async () => {
    renderBothPanes()
    await unlockAndType(sidePane(), 'n2')

    const puts = bodyPutsFor('n2')
    expect(puts.length, 'the side pane\'s autosave never fired').toBeGreaterThan(0)
    expect(puts[0].baseUpdatedAt, 'the first save went out on the PRE-unlock revision').toBe(T2.n2)
    expect(CONFLICTS.n2, 'the member\'s own save after a menu unlock was refused as a conflict').toBe(0)
  })
})
