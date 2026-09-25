/**
 * Wave 6 lane E fix round 2, M2 — the note menu's Unlock button skipped the
 * editor's own baseline move.
 *
 * ⚰️ THE DEFECT. `NoteEditorPage`'s own Unlock (I1, round 1) does THREE
 * steps before making the editor editable: `setNoteLock` lands the revision;
 * when the server's copy moved by METADATA ONLY, the save baseline
 * (`lastSavedRef`) moves onto it; and `settleMetadataRevision` records the
 * landing for guard 2 and settles the durable/offline copy. The menu's own
 * Unlock button (`NoteMenuActions.toggleLock`) called `setNoteLock` directly
 * — step one only — so the FIRST save after a menu Unlock always 409'd into
 * the reconcile (METADATA_ONLY, so it never forked, but it cost an extra
 * round trip on every single menu unlock).
 *
 * Same wire-level harness as `NoteEditorPage.unlock.test.jsx` (the editor's
 * OWN unlock button's rail) — real page, real durable layer over an
 * in-memory IndexedDB, a server that does compare-and-set exactly as
 * `update_note` does — driving the MENU's Unlock instead, scoped via the
 * menu's own `role="group"` so it cannot be confused with the editor's own
 * inline Unlock button.
 */
import { render, screen, act, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb } from '../../lib/offline/__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections } from '../../lib/offline/useDurableNote'
import { OFFLINE_FLAG_KEY } from '../../lib/offline/offlineFlag'
import { dbNameFor } from '../../lib/offline/notebookDb'
import { landedKeyFor } from '../../lib/offline/inFlight'
import NoteMenuActions from './NoteMenuActions'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const T1 = '2026-09-24T14:00:00.000000+00:00'
const T2 = '2026-09-24T14:05:00.000000+00:00'
const BODY = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original body' }] }] }
const baseNote = () => ({
  id: 'n1', title: 'NVDA thesis', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: T1,
  isFavorite: false, locked: true, bodyJson: BODY,
})

let NOTE
let server
let serverRevision
let conflicts
let forks
const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u42', role: 'member' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

const ACCOUNT_DB = dbNameFor('u42')
let factory
const store = (name) => factory.databases.get(ACCOUNT_DB)?.dump(name) ?? []
const landedRing = () => store('meta').find((m) => m.name === landedKeyFor('n1'))?.value ?? []

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  NOTE = baseNote()
  server = { ...NOTE }
  serverRevision = 2
  conflicts = 0
  forks = []
  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => {
    if (patch && 'baseUpdatedAt' in patch && patch.baseUpdatedAt !== server.updatedAt) {
      conflicts += 1
      const err = new Error('conflict')
      err.status = 409
      throw err
    }
    const { baseUpdatedAt, ...fields } = patch || {}
    serverRevision += 1
    server = { ...server, ...fields, updatedAt: `2026-09-24T14:0${serverRevision}:30.000000+00:00` }
    return { ...server }
  })
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url)
    const method = (opts.method || 'GET').toUpperCase()
    if (u === '/api/j2/notes/n1/lock' && method === 'PATCH') {
      server = { ...server, locked: JSON.parse(opts.body).locked, updatedAt: T2 }
      return { ok: true, status: 200, json: async () => ({ note: { ...server } }) }
    }
    if (u === '/api/j2/notes/n1' && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ note: { ...server } }) }
    }
    if (u === '/api/j2/notes' && method === 'POST') {
      forks.push(JSON.parse(opts.body))
      return { ok: true, status: 200, json: async () => ({ note: { id: 'fork1', updatedAt: T2 } }) }
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

async function renderLockedEditorWithMenu() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(
    <MemoryRouter>
      <NoteEditorPage
        noteId="n1"
        onBack={vi.fn()}
        noteMenu={(note, api) => <NoteMenuActions note={note} onChanged={vi.fn()} onUnlock={api.unlockNote} />}
      />
    </MemoryRouter>,
  )
  await screen.findByPlaceholderText('Title')
  await act(async () => { await settleIdb(4) })
  const editor = await waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el.editor
  })
  expect(editor.isEditable).toBe(false)
  return editor
}

/** The MENU's own Unlock button, scoped to its group so it is never
 *  confused with the editor's own inline Unlock button (both render here). */
async function unlockViaMenu(editor) {
  const menu = screen.getByRole('group', { name: 'Organise this note' })
  fireEvent.click(within(menu).getByRole('button', { name: 'Unlock' }))
  await waitFor(() => expect(editor.isEditable).toBe(true))
  await act(async () => { await settleIdb(6) })
}

async function typeAndLetTheAutosaveFire(editor) {
  act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' and more') })
  await act(async () => { vi.advanceTimersByTime(900); await settleIdb(6) })
  await act(async () => { vi.advanceTimersByTime(200); await settleIdb(6) })
}

const bodyPuts = () => updateMock.mock.calls.map(([patch]) => patch).filter((p) => p && 'bodyJson' in p)

describe('M2 (wave 6 fix round 2) — the MENU\'s Unlock goes through the SAME settle as the editor\'s own', () => {
  it('menu unlock, a keystroke, the autosave: the PUT carries the POST-unlock revision and lands — no 409, no fork', async () => {
    const editor = await renderLockedEditorWithMenu()
    await unlockViaMenu(editor)
    await typeAndLetTheAutosaveFire(editor)

    expect(bodyPuts().length, 'the autosave never fired').toBeGreaterThan(0)
    expect(bodyPuts()[0].baseUpdatedAt, 'the first save went out on the pre-unlock revision').toBe(T2)
    expect(conflicts, 'the member\'s own save after a MENU unlock was refused as a conflict').toBe(0)
    expect(forks, 'the note was forked over the member\'s own menu unlock').toEqual([])
    expect(server.bodyJson.content[0].content[0].text).toBe('Original body and more')
  })

  it('the menu unlock\'s revision is recorded as THIS browser\'s, and the durable copy is settled onto it', async () => {
    const editor = await renderLockedEditorWithMenu()
    await unlockViaMenu(editor)
    expect(landedRing(), 'guard 2 would call the menu unlock\'s revision "not ours" and fork').toContain(T2)
    const rec = store('notes').find((r) => r.noteId === 'n1')
    expect(rec?.baseUpdatedAt, 'the durable copy still names the pre-unlock revision').toBe(T2)
    expect(rec?.dirty).toBe(0)
  })
})
