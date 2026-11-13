/**
 * ⭐⭐ Follow-up D (2026-11-13), F2 — OPENING THE NOTE MAKES "OPEN IT SO IT CAN FINISH SAVING" TRUE.
 *
 * The device holds what a save whose answer the page never saw leaves behind: a dirty
 * record (and its entry) holding exactly the words the server already has. Before follow-up
 * D, opening the note decided "nothing to recover" and wrote nothing, so the record stayed
 * dirty and every `noteHasUnsentWork` door kept refusing. The real editor runs here against
 * an in-memory IndexedDB; nobody types.
 *
 * ⛔ Controls: a record whose words differ is untouched and the banner path is unchanged; an
 * entry whose words differ is never deleted.
 */
import { render, renderHook, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeDb, createFakeIndexedDbFactory, settleIdb } from './__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections, connectNotebookDb, useDurableNote } from './useDurableNote'
import { DURABLE } from './durableWriter'
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import { dbNameFor } from './notebookDb'
import { noteHasUnsentWork } from './noteHasUnsentWork'
import { SAVED_WORDS, SAVING_WORDS, offlineKept, saveIndicatorWords, unsyncedLabel } from './unsyncedCopy'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const T0 = '2026-11-13T10:00:00.000000+00:00'
const T1 = '2026-11-13T10:00:06.000000+00:00'
const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const doc = (...blocks) => ({ type: 'doc', content: blocks })
const SAVED = doc(para('the words the server applied, answer never seen'))
const OTHER = doc(para('words the server never received'))

const SERVER = {
  id: 'n1', title: 'Thesis', subtitle: '', folderId: null, ticker: null, tags: [],
  heroImageUrl: null, isFavorite: false, bodyJson: SAVED, updatedAt: T1,
}
const update = vi.fn(async () => { throw new Error('nobody typed: nothing may be sent') })
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: SERVER, isLoading: false, error: null, update, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u42', role: 'member' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

const ACCOUNT_DB = dbNameFor('u42')
let factory

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  update.mockClear()
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

const store = () => factory.databases.get(ACCOUNT_DB)
const record = () => store().dump('notes').find((r) => r.noteId === 'n1') || null
const queue = () => store().dump('outbox')
const unsent = () => noteHasUnsentWork('n1', { accountId: 'u42', connect: connectNotebookDb })

/** What the device holds after the unseen landing: a dirty record (+ entries) on T0. */
async function leftOnDevice({ body = SAVED, entries = [SAVED] } = {}) {
  factory.open(ACCOUNT_DB)
  await act(async () => { await settleIdb(2) })
  store().seed('notes', {
    noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: body, dirty: 1, generation: 4,
    sessionId: 'gone', localSavedAt: 1000, baseUpdatedAt: T0,
    serverBase: { title: 'Thesis', subtitle: '', bodyJson: doc(para('before')), updatedAt: T0 },
  })
  entries.forEach((b, i) => store().seed('outbox', {
    mutationId: i === 0 ? 'note:n1' : `legacy${i}:n1`, noteId: 'n1', kind: 'note-update',
    patch: { title: 'Thesis', subtitle: '', bodyJson: b }, baseUpdatedAt: T0, generation: 4, sessionId: 'gone', queuedAt: 1000,
  }))
}

const indicator = () => document.querySelector('[data-save-indicator]')

async function openTheNote() {
  const mod = await import('../../components/notebook/NoteEditorPage')
  render(<MemoryRouter><mod.default noteId="n1" onBack={() => {}} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
}
async function sit(rounds = 6) {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { vi.advanceTimersByTime(500); await settleIdb(6) })
  }
}

describe('⭐ F2 (d): a dirty record equal to the server is settled on open', () => {
  it('with its queued entry: clean at the server revision, entry gone, nothing sent', async () => {
    await leftOnDevice()
    expect((await unsent()).unsent).toBe(true)
    await openTheNote()
    await sit()

    expect(update).not.toHaveBeenCalled()
    expect(record()).toMatchObject({ dirty: 0, baseUpdatedAt: T1, serverBase: null, bodyJson: SAVED })
    expect(queue()).toEqual([])
    expect(await unsent()).toEqual({ unsent: false, why: null })
    expect(screen.queryByText(/Unsaved changes from a previous session/)).toBeNull()
  })

  it('with no entry left (the drain already removed it): still settled', async () => {
    await leftOnDevice({ entries: [] })
    await openTheNote()
    await sit()
    expect(record()).toMatchObject({ dirty: 0, baseUpdatedAt: T1 })
    expect((await unsent()).unsent).toBe(false)
  })

  it('⛔ control: a second queued entry holding other words is never deleted, and the record stays dirty', async () => {
    await leftOnDevice({ entries: [SAVED, OTHER] })
    await openTheNote()
    await sit()
    expect(update).not.toHaveBeenCalled()
    expect(record()).toMatchObject({ dirty: 1, baseUpdatedAt: T0 })
    expect(queue().map((e) => e.patch.bodyJson)).toEqual([SAVED, OTHER])
    expect((await unsent()).unsent).toBe(true)
  })
})

/** Hold the outbox READ `recover()` makes, so the page can be read before the device answers. */
function holdRecovery() {
  const s = store()
  let release
  const gate = new Promise((r) => { release = r })
  const orig = s.transaction.bind(s)
  s.transaction = (names, mode = 'readonly') => {
    const tx = orig(names, mode)
    if (names !== 'outbox' || mode !== 'readonly') return tx
    const inner = tx.objectStore
    tx.objectStore = (n) => {
      const os = inner(n)
      return {
        ...os,
        getAll: () => {
          const req = { result: [] }
          gate.then(() => { const r = os.getAll(); r.onsuccess = () => { req.result = r.result; req.onsuccess?.() } })
          return req
        },
      }
    }
    return tx
  }
  return () => release()
}

describe('⭐ F3 (f): the label claims nothing before the device answers, then says what the store holds', () => {
  const said = []
  const look = async (rounds) => {
    for (let i = 0; i < rounds; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { vi.advanceTimersByTime(250); await settleIdb(6) })
      said.push(indicator()?.textContent ?? null)
    }
  }
  beforeEach(() => { said.length = 0 })

  it('a clean store: nothing while the store is held, then "Saved"', async () => {
    factory.open(ACCOUNT_DB)
    await act(async () => { await settleIdb(2) })
    const release = holdRecovery()
    await openTheNote()
    await look(4)
    expect(indicator()).not.toBeNull()
    expect(said.every((t) => !t)).toBe(true)
    await act(async () => { release(); await settleIdb(6) })
    await waitFor(() => expect(indicator().textContent).toBe(SAVED_WORDS))
  })

  it('the unseen landing: nothing, then "Saved" only after the record is settled (never the queue\'s words first)', async () => {
    await leftOnDevice()
    const release = holdRecovery()
    // every text the region ever holds, not only the samples
    const seen = new MutationObserver(() => { said.push(indicator()?.textContent ?? null) })
    seen.observe(document.body, { subtree: true, childList: true, characterData: true })
    await openTheNote()
    await look(4)
    expect(said.every((t) => !t)).toBe(true)
    await act(async () => { release(); await settleIdb(6) })
    await look(6)
    seen.disconnect()
    expect(said.filter(Boolean)).toEqual(said.filter(Boolean).map(() => SAVED_WORDS))
    expect(indicator().textContent).toBe(SAVED_WORDS)
    expect(record().dirty).toBe(0)
  })

  it('a dirty record the server does not hold: the queue\'s own words, never "Saved"', async () => {
    await leftOnDevice({ body: OTHER, entries: [] })
    await openTheNote()
    await screen.findByText(/Unsaved changes from a previous session/)
    await look(4)
    expect(indicator().textContent).toBe(unsyncedLabel(null))
    expect(said).not.toContain(SAVED_WORDS)
    // Discard writes through this mount's writer: from its commit on, `unsynced` speaks, as before follow-up D
    await act(async () => { screen.getByRole('button', { name: 'Discard' }).click(); await settleIdb(6) })
    await look(4)
    expect(indicator().textContent).toBe(SAVED_WORDS)
  })

  it('a write this mount committed while recovery was still reading makes that read stale: not "held"', async () => {
    const db = createFakeDb()
    db.seed('notes', { noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: OTHER, dirty: 1, baseUpdatedAt: T0 })
    let release
    const gate = new Promise((r) => { release = r })
    const orig = db.transaction.bind(db)
    db.transaction = (names, mode = 'readonly') => {
      const tx = orig(names, mode)
      if (names !== 'outbox' || mode !== 'readonly') return tx
      const inner = tx.objectStore
      tx.objectStore = (n) => {
        const os = inner(n)
        return { ...os, getAll: () => { const req = {}; gate.then(() => { req.result = []; req.onsuccess?.() }); return req } }
      }
      return tx
    }
    const connect = async () => db   // one identity: an inline connect re-runs the writer effect every render
    const { result } = renderHook(() => useDurableNote({ accountId: 'u42', noteId: 'n1', debounceMs: 0, connect }))
    let recovering
    await act(async () => { recovering = result.current.recover({ server: SERVER }); await settleIdb(4) })
    await act(async () => { result.current.schedule({ title: 'Thesis', subtitle: '', bodyJson: SAVED, baseUpdatedAt: T1 }); await settleIdb(6) })
    expect(result.current.status).toBe(DURABLE)
    await act(async () => { release(); await recovering; await settleIdb(4) })
    expect(result.current.held).toBe(false)
  })

  it('the words, one authority: held only changes what an online "saved" claims', () => {
    expect(saveIndicatorWords({ status: 'saved', held: true, persisted: true })).toBe(unsyncedLabel(true))
    expect(saveIndicatorWords({ status: 'saved', held: false })).toBe(SAVED_WORDS)
    expect(saveIndicatorWords({ status: 'saving', held: true })).toBe(SAVING_WORDS)
    expect(saveIndicatorWords({ status: 'saved', held: true, loading: true })).toBe('')
    expect(saveIndicatorWords({ status: 'saved', held: true, offline: true, persisted: true })).toBe(offlineKept(true))
  })
})

describe('⭐ F4 (g): pagehide and a hidden tab flush the pending durable write, nothing more', () => {
  function mountWriter() {
    const db = createFakeDb()
    let writes = 0
    const orig = db.transaction.bind(db)
    db.transaction = (names, mode = 'readonly') => {
      if (mode === 'readwrite' && Array.isArray(names) && names.includes('notes')) writes += 1
      return orig(names, mode)
    }
    const connect = async () => db   // one identity: an inline connect re-runs the writer effect (and its flush) every render
    const view = renderHook(() => useDurableNote({ accountId: 'u42', noteId: 'n1', debounceMs: 60_000, connect }))
    return { db, view, writes: () => writes }
  }
  const typed = { title: 'Thesis', subtitle: '', bodyJson: SAVED, baseUpdatedAt: T1 }
  const setVisibility = (v) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v })
  afterEach(() => { delete document.visibilityState })

  it('pagehide writes the scheduled snapshot at once, exactly one write, none left for the timer', async () => {
    const { db, view, writes } = mountWriter()
    await act(async () => { view.result.current.schedule(typed); await settleIdb(4) })
    expect(db.dump('notes')).toEqual([])                      // still inside the debounce
    await act(async () => { window.dispatchEvent(new Event('pagehide')); await settleIdb(6) })
    expect(db.dump('notes')[0]).toMatchObject({ noteId: 'n1', dirty: 1, bodyJson: SAVED })
    expect(writes()).toBe(1)
    await act(async () => { vi.advanceTimersByTime(61_000); await settleIdb(6) })
    expect(writes()).toBe(1)
    view.unmount()
  })

  it('visibilitychange flushes only when the tab became hidden', async () => {
    const { db, view } = mountWriter()
    await act(async () => { view.result.current.schedule(typed); await settleIdb(4) })
    setVisibility('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await settleIdb(6) })
    expect(db.dump('notes')).toEqual([])
    setVisibility('hidden')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await settleIdb(6) })
    expect(db.dump('notes')[0]).toMatchObject({ dirty: 1, bodyJson: SAVED })
    view.unmount()
  })

  it('no writer (the wave switched off): pagehide is harmless and writes nothing', async () => {
    localStorage.setItem(OFFLINE_FLAG_KEY, '0')
    const off = mountWriter()
    await act(async () => { off.view.result.current.schedule(typed); await settleIdb(4) })
    expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow()
    await act(async () => { await settleIdb(6) })
    expect(off.writes()).toBe(0)
    off.view.unmount()
  })

  it('an unmounted writer stops listening (the handlers it added are the ones removed)', () => {
    const addW = vi.spyOn(window, 'addEventListener'); const remW = vi.spyOn(window, 'removeEventListener')
    const addD = vi.spyOn(document, 'addEventListener'); const remD = vi.spyOn(document, 'removeEventListener')
    const { view } = mountWriter()
    // the writer's one handler serves both events (the owner lock adds a pagehide handler of its own)
    const onVis = addD.mock.calls.find((c) => c[0] === 'visibilitychange')?.[1]
    expect(onVis).toBeTypeOf('function')
    expect(addW).toHaveBeenCalledWith('pagehide', onVis)
    view.unmount()
    expect(remW).toHaveBeenCalledWith('pagehide', onVis)
    expect(remD).toHaveBeenCalledWith('visibilitychange', onVis)
    for (const s of [addW, remW, addD, remD]) s.mockRestore()
  })
})

describe('⛔ F2 (e): a dirty record that differs from the server is untouched', () => {
  it('no entry: the Restore/Discard banner is offered exactly as before, and the record keeps its words', async () => {
    await leftOnDevice({ body: OTHER, entries: [] })
    await openTheNote()
    await sit()
    await screen.findByText(/Unsaved changes from a previous session/)
    expect(update).not.toHaveBeenCalled()
    expect(record()).toMatchObject({ dirty: 1, baseUpdatedAt: T0, bodyJson: OTHER })
    expect((await unsent()).why).toBe('dirty')
  })
})
