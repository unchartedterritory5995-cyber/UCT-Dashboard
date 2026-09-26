/**
 * Wave 6 lane D, fix round 1 — I1: UNLOCK IS A WRITE DOOR, SO IT LANDS ITS REVISION.
 *
 * ⚰️ THE DEFECT (wave6-D-review.md, I1). `PATCH /api/j2/notes/{id}/lock` advances
 * the note's `updatedAt` like every other metadata writer, and Unlock recorded
 * nothing: no landed revision, no durable settle, and `refresh()` never moves the
 * save baseline (the load effect is keyed on the note id). The member presses
 * Unlock — the only reason to press it is to type — and the first autosave went
 * out on the PRE-unlock revision: a 409 on the member's own write, and, once the
 * note left the editor, a drain that could not recognise the unlock's revision as
 * this browser's and forked the note into a `sync-conflict` copy.
 *
 * ⭐ THE WIRE, NOT THE PARTS: the real page, the real durable layer over an
 * in-memory IndexedDB, and a server that does compare-and-set exactly as
 * `update_note` does — a PUT whose `baseUpdatedAt` is not the current revision is
 * a 409. The lock endpoint answers the way lane E's contract says it will
 * (wave6-E-dispatch-addendum.md): the updated note, with a newer `updatedAt`.
 * ⚠️ Lane E's endpoint had not landed when this was written, so the answer below is
 * a FIXTURE of that contract: `{ note: { ...note, locked: false, updatedAt: T2 } }`.
 */
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb } from '../../lib/offline/__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections } from '../../lib/offline/useDurableNote'
import { OFFLINE_FLAG_KEY } from '../../lib/offline/offlineFlag'
import { dbNameFor } from '../../lib/offline/notebookDb'
import { landedKeyFor } from '../../lib/offline/inFlight'

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
  // ⭐ `update_note`'s compare-and-set: a base that is not the current revision
  // is a 409, and nothing is written.
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
      // Lane E's contract: the updated note, with a NEWER revision.
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

async function renderLockedEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>)
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

async function unlock(editor) {
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
  await waitFor(() => expect(editor.isEditable).toBe(true))
  await act(async () => { await settleIdb(6) })
}

async function typeAndLetTheAutosaveFire(editor) {
  act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' and more') })
  await act(async () => { vi.advanceTimersByTime(900); await settleIdb(6) })
  await act(async () => { vi.advanceTimersByTime(200); await settleIdb(6) })
}

const bodyPuts = () => updateMock.mock.calls.map(([patch]) => patch).filter((p) => p && 'bodyJson' in p)

describe('I1 — Unlock lands its revision, so the member\'s first save after it lands too', () => {
  it('unlock, a keystroke, the autosave: the PUT carries the POST-unlock revision and lands — no 409, no fork', async () => {
    const editor = await renderLockedEditor()
    await unlock(editor)
    await typeAndLetTheAutosaveFire(editor)

    expect(bodyPuts().length, 'the autosave never fired').toBeGreaterThan(0)
    expect(bodyPuts()[0].baseUpdatedAt, 'the first save went out on the pre-unlock revision').toBe(T2)
    expect(conflicts, 'the member\'s own save after Unlock was refused as a conflict').toBe(0)
    expect(forks, 'the note was forked over the member\'s own unlock').toEqual([])
    expect(server.bodyJson.content[0].content[0].text).toBe('Original body and more')
  })

  it('the unlock\'s revision is recorded as THIS browser\'s, and the durable copy is settled onto it', async () => {
    const editor = await renderLockedEditor()
    await unlock(editor)
    // ⭐ The artifacts a later drain asks: the landed ring (guard 2: "is this
    // revision ours?") and the durable record's baseline.
    expect(landedRing(), 'guard 2 would call the unlock\'s revision "not ours" and fork').toContain(T2)
    const rec = store('notes').find((r) => r.noteId === 'n1')
    expect(rec?.baseUpdatedAt, 'the durable copy still names the pre-unlock revision').toBe(T2)
    expect(rec?.dirty).toBe(0)
  })

  it('⛔ CONTROL — a server copy that MOVED BEYOND the lock (another device wrote words) is never adopted as the base', async () => {
    // The unlock answers a revision whose body is NOT the one this editor holds:
    // advancing the base onto it would let the next save overwrite those words.
    // It must go out on its own base, 409, and reach the reconcile — never land.
    global.fetch.mockImplementation(async (url, opts = {}) => {
      const u = String(url)
      const method = (opts.method || 'GET').toUpperCase()
      if (u === '/api/j2/notes/n1/lock' && method === 'PATCH') {
        server = {
          ...server, locked: false, updatedAt: T2,
          bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Another device wrote this' }] }] },
        }
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
    const editor = await renderLockedEditor()
    await unlock(editor)
    // ⛔ …and nothing is QUEUED on that revision either: settling the durable copy
    // onto it would queue this editor's stale body at T2, and a drain sending it
    // after the note closed would land it over the other device's words.
    expect(store('outbox').filter((e) => e.baseUpdatedAt === T2), 'stale words were queued on a revision this editor never saw').toEqual([])
    await typeAndLetTheAutosaveFire(editor)

    expect(bodyPuts()[0].baseUpdatedAt, 'a revision whose words this editor never saw was adopted as its base').toBe(T1)
    expect(server.bodyJson.content[0].content[0].text, 'the other device\'s words were overwritten').toBe('Another device wrote this')
  })

  it('an unlock answer with no revision in it (a bare {ok:true}) still unlocks, and settles nothing it was not told', async () => {
    global.fetch.mockImplementation(async (url, opts = {}) => {
      if (String(url) === '/api/j2/notes/n1/lock' && (opts.method || '').toUpperCase() === 'PATCH') {
        return { ok: true, status: 200, json: async () => ({ ok: true }) }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    const editor = await renderLockedEditor()
    await unlock(editor)
    expect(landedRing(), 'a browser cannot record a revision it was never told').toEqual([])
    expect(screen.queryByText('Locked — editing is off')).toBeNull()
  })
})
