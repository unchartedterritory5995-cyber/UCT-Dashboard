/**
 * Wave Q1 §29 — THE REQUIRED TIMING INTERLEAVINGS.
 *
 * Three asynchronous writers share one note: a synchronous localStorage draft,
 * a debounced IndexedDB working copy, and an ~800ms server PUT. Every one of
 * them can finish in a different order than it started, and the failure mode is
 * always the same shape — the member's newest words silently replaced by older
 * ones, with every status green.
 *
 *   A  type → IDB commits → server commits
 *   B  type → server commits BEFORE a delayed IDB callback
 *   C  type A → IDB write begins → type B → server fails → IDB finishes → B survives
 *   D  type → tab closes before the IDB debounce → localStorage restores the newest text
 *   E  type → IDB commits → tab closes before the PUT → IDB/outbox restores unsynced state
 *   F  server succeeds → a stale delayed local callback fires → must NOT resurrect
 *      dirty/outbox state
 *
 * ⛔ D models a tab CLOSE, which jsdom cannot perform: nothing runs on a real
 * close — no unmount, no cleanup, no flush. It is modelled as "the durable write
 * never committed", which is precisely what a close before the debounce leaves
 * behind, and the rail says so rather than pretending it killed a process.
 */
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createFakeIndexedDbFactory, createFakeDb, settleIdb } from '../../lib/offline/__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections, useDurableNote } from '../../lib/offline/useDurableNote'
import { OFFLINE_FLAG_KEY } from '../../lib/offline/offlineFlag'
import { dbNameFor, getNote, listOutbox } from '../../lib/offline/notebookDb'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const BASE_BODY = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original body' }] }] }
const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const NOTE = {
  id: 'n1', title: 'NVDA thesis', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: 'T1',
  isFavorite: false, bodyJson: BASE_BODY,
}

const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u42' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

const ACCOUNT_DB = dbNameFor('u42')
let factory

beforeEach(() => {
  localStorage.clear()
  // ⛔ Wave Q1 ships DARK: the offline layer is off until the §32 browser
  // matrix is reported. These rails opt this browser in, the same way
  // certification does.
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  updateMock.mockReset()
  updateMock.mockResolvedValue({ ...NOTE, updatedAt: 'T2' })
  __resetNotebookConnections()
  factory = createFakeIndexedDbFactory()
  globalThis.indexedDB = factory
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  localStorage.clear()
  delete globalThis.indexedDB
})

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const view = render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  await act(async () => { await settleIdb(4) })
  return view
}
const type = (v) => fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: v } })
const tick = async (ms) => { await act(async () => { vi.advanceTimersByTime(ms); await settleIdb(6) }) }

const db = () => factory.databases.get(ACCOUNT_DB)
const store = (name) => db()?.dump(name) ?? []
const draft = () => JSON.parse(localStorage.getItem('uct.j2.notedraft.n1') || 'null')

describe('A — type, IDB commits, then the server commits', () => {
  it('the durable copy lands FIRST and the ack then retires it', async () => {
    await renderEditor()
    type('interleaving A')

    // Past the durable window, inside the server debounce: locally safe, not
    // yet sent. This ORDER is the point — the local copy exists before any
    // network call is even attempted.
    await tick(300)
    expect(store('notes')[0].dirty).toBe(1)
    expect(store('outbox')).toHaveLength(1)
    expect(updateMock).not.toHaveBeenCalled()

    await tick(700)
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    await tick(50)
    expect(store('notes')[0].dirty).toBe(0)
    expect(store('outbox')).toEqual([])
  })
})

describe('B — the server commits BEFORE a delayed IDB callback', () => {
  it('ends clean: the late local write cannot leave the note owing a sync', async () => {
    // The durable write is slow (a cold store, a busy device). The PUT wins the
    // race. ⛔ The final state must still be "the server has this", not a note
    // stuck dirty because its own local write finished second.
    const slowDb = createFakeDb()
    const realTransaction = slowDb.transaction.bind(slowDb)
    let delay = 40
    slowDb.transaction = (...args) => realTransaction(...args)
    const connect = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, delay))
      return slowDb
    })
    const { result } = renderHook(() => useDurableNote({
      accountId: 'u42', noteId: 'n1', debounceMs: 0, connect,
    }))

    const state = { title: 'B', subtitle: '', bodyJson: doc('B'), baseUpdatedAt: 'T1' }
    await act(async () => { result.current.schedule(state) })
    // The server answers while that first write is still queued behind `connect`.
    delay = 0
    await act(async () => {
      result.current.markSynced({ acked: state, current: state, updatedAt: 'T2' })
      await settleIdb(10)
    })

    expect((await getNote(slowDb, 'n1')).dirty).toBe(0)
    expect(await listOutbox(slowDb)).toEqual([])
    expect(result.current.unsynced).toBe(false)
  })
})

describe('C — an edit arrives while a write is in flight and the server then fails', () => {
  it('⭐ the NEWEST words survive, in both the working copy and the intent', async () => {
    updateMock.mockRejectedValue(new Error('network down'))
    await renderEditor()
    type('A')
    // The write for A is scheduled; B lands before it has committed.
    await act(async () => { vi.advanceTimersByTime(150) })
    type('A then B')
    await tick(1000)

    // ⛔ Not "A", and not both — the durable goal is the member's latest state.
    expect(store('notes')).toHaveLength(1)
    expect(store('notes')[0].title).toBe('A then B')
    expect(store('notes')[0].dirty).toBe(1)
    const outbox = store('outbox')
    expect(outbox).toHaveLength(1)
    expect(outbox[0].patch.title).toBe('A then B')
    expect(draft().title).toBe('A then B')
  })
})

describe('D — the tab closes before the durable debounce', () => {
  it('the synchronous draft still holds the newest text, and it is what recovery offers', async () => {
    await renderEditor()
    type('typed and then the tab died')

    // The close happens HERE: no unmount, no cleanup, no flush. What survives
    // is whatever was already on disk.
    expect(draft().title).toBe('typed and then the tab died')
    expect(store('notes')).toEqual([])       // the durable write never committed

    // ⛔ Reopening must find exactly THAT state. `cleanup()` below runs React's
    // unmount path — which a real tab close does not: it flushes the pending
    // save, the PUT succeeds, and the draft is retired. So the disk is put back
    // the way the close actually left it: the draft still there, the durable
    // store still empty.
    const onDiskAtTheClose = localStorage.getItem('uct.j2.notedraft.n1')
    cleanup()
    await act(async () => { await settleIdb(4) })
    localStorage.setItem('uct.j2.notedraft.n1', onDiskAtTheClose)
    factory = createFakeIndexedDbFactory()
    globalThis.indexedDB = factory
    __resetNotebookConnections()

    await renderEditor()
    await act(async () => { await settleIdb(6) })
    await waitFor(() => expect(screen.getByText(/Unsaved changes from a previous session/i)).toBeInTheDocument())
    // ⛔ And it can only have come from localStorage: there is nothing else.
    expect(store('notes')).toEqual([])
    expect(draft().title).toBe('typed and then the tab died')
  })
})

describe('E — the tab closes after the durable write but before the PUT', () => {
  it('the working copy AND its queued intent are what reopening recovers', async () => {
    updateMock.mockRejectedValue(new Error('network down'))
    const view = await renderEditor()
    type('written while the server was gone')
    await tick(300)
    expect(store('notes')[0].dirty).toBe(1)
    expect(store('outbox')).toHaveLength(1)

    // The draft is cleared to model a close where localStorage was the layer
    // that did NOT survive (a quota eviction, a cleared site setting) — so the
    // recovery below can only be coming from the durable copy.
    localStorage.removeItem('uct.j2.notedraft.n1')
    view.unmount()
    await act(async () => { await settleIdb(6) })

    await renderEditor()
    await act(async () => { await settleIdb(6) })
    await waitFor(() => expect(screen.getByText(/Unsaved changes from a previous session/i)).toBeInTheDocument())
    // ⛔ And the sync intent is still queued: recovered on screen is not the
    // same as sent. SAVED ON THIS DEVICE ≠ SYNCED TO UCT.
    expect(store('outbox')).toHaveLength(1)
    expect(store('outbox')[0].patch.title).toBe('written while the server was gone')
  })
})

describe('F — a stale local callback lands after the server succeeded', () => {
  it('⛔ cannot resurrect the dirty flag or re-queue an intent the server already has', async () => {
    // The write for the DIRTY snapshot is deliberately slower than the clean one
    // that follows it. A layer that applied completions in arrival order rather
    // than by generation would leave the note owing a sync it does not owe, and
    // the next reconnect would push content the server already holds — creating
    // a conflict out of nothing.
    const fake = createFakeDb()
    // The dirty write must be IN FLIGHT when the ack lands — not merely
    // scheduled. A version of this rail that only scheduled it proved nothing:
    // the second schedule simply replaced the first before it ever started, and
    // deleting the follow-up write left the rail green.
    let openTheGate
    let gate = new Promise((r) => { openTheGate = r })
    const connect = vi.fn(async () => {
      if (gate) { const g = gate; gate = null; await g }
      return fake
    })
    const { result } = renderHook(() => useDurableNote({
      accountId: 'u42', noteId: 'n1', debounceMs: 0, connect,
    }))

    const state = { title: 'F', subtitle: '', bodyJson: doc('F'), baseUpdatedAt: 'T1' }
    await act(async () => {
      result.current.schedule(state)     // dirty, generation 1
      await settleIdb(2)                 // …and it has STARTED, stuck at the gate
    })
    await act(async () => {
      result.current.markSynced({ acked: state, current: state, updatedAt: 'T2' })  // clean, generation 2
      openTheGate()                      // the stale generation-1 callback finally lands
      await settleIdb(12)
    })

    expect((await getNote(fake, 'n1')).dirty).toBe(0)
    expect((await getNote(fake, 'n1')).baseUpdatedAt).toBe('T2')
    expect(await listOutbox(fake)).toEqual([])
    expect(result.current.unsynced).toBe(false)

    // ⭐ And the generation is the reason, not luck: `durableWriter.test.js`
    // pins that a completion may only ever ADVANCE the committed generation, so
    // an older snapshot resolving late can neither mark newer work durable nor
    // bring itself back.
    expect((await getNote(fake, 'n1')).generation).toBe(2)
  })
})
