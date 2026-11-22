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
import { dbNameFor, putNoteWithIntent } from './notebookDb'
import { drainOutbox } from './outboxDrain'
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
// Fix round 1: `update` refuses (nobody typed) unless a case installs `accept`; `LOAD` says whether the
// mount's note read was a CACHE hit (the copy at once, no loading) or a network read (loading, then the copy).
let accept = null
const update = vi.fn(async (patch) => {
  if (!accept) throw new Error('nobody typed: nothing may be sent')
  return accept(patch)
})
let LOAD = { cached: false, note: null }
vi.mock('../../hooks/useJ2Notes', async () => {
  const React = await import('react')
  return {
    useJ2Note: () => {
      const [n, setN] = React.useState(() => (LOAD.cached ? (LOAD.note || SERVER) : null))
      React.useEffect(() => {
        if (n) return undefined
        const t = setTimeout(() => setN(LOAD.note || SERVER), 0)
        return () => clearTimeout(t)
      }, [n])
      return { note: n, isLoading: !n, error: null, update, refresh: vi.fn() }
    },
    recordNoteOpened: vi.fn(),
    setNoteFavorite: vi.fn(),
  }
})
// Fix round 2: a case can replace one member of the real hook's answer (the rest stays real).
let DURABLE_OVERRIDE = null
vi.mock('./useDurableNote', async (importOriginal) => {
  const real = await importOriginal()
  // Final fix pass (E-M2): an override may also be a function of the real answer, to wrap a member.
  return {
    ...real,
    useDurableNote: (...args) => {
      const r = real.useDurableNote(...args)
      return { ...r, ...((typeof DURABLE_OVERRIDE === 'function' ? DURABLE_OVERRIDE(r) : DURABLE_OVERRIDE) || {}) }
    },
  }
})
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u42', role: 'member' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

const ACCOUNT_DB = dbNameFor('u42')
let factory

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  update.mockClear()
  accept = null
  DURABLE_OVERRIDE = null
  LOAD = { cached: false, note: null }
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
const RING = ['2026-11-13T09:00:00.000000+00:00']
async function leftOnDevice({ body = SAVED, entries = [SAVED], withServerBase = true } = {}) {
  factory.open(ACCOUNT_DB)
  await act(async () => { await settleIdb(2) })
  store().seed('notes', {
    noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: body, dirty: 1, generation: 4,
    sessionId: 'gone', localSavedAt: 1000, baseUpdatedAt: T0,
    ...(withServerBase ? { serverBase: { title: 'Thesis', subtitle: '', bodyJson: doc(para('before')), updatedAt: T0 } } : {}),
  })
  store().seed('meta', { name: 'landed:n1', value: RING })
  entries.forEach((b, i) => store().seed('outbox', {
    mutationId: i === 0 ? 'note:n1' : `legacy${i}:n1`, noteId: 'n1', kind: 'note-update',
    patch: { title: 'Thesis', subtitle: '', bodyJson: b }, baseUpdatedAt: T0, generation: 4, sessionId: 'gone', queuedAt: 1000,
  }))
}

const indicator = () => document.querySelector('[data-save-indicator]')
const ring = () => store().dump('meta').find((m) => m.name === 'landed:n1')?.value ?? null
async function typeInBody(text) {
  const dom = await waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el
  })
  await act(async () => { dom.editor.chain().focus('end').insertContent(text).run(); await settleIdb(2) })
  expect(dom.editor.getText()).toContain(text.trim())
}

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
    expect(ring()).toEqual(RING)   // identical content never enters the landed ring
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
    // Discard (fix round 1, section 4) removes the offered words from the store: the record is the server copy,
    // clean, nothing queued, so "Saved" is now true
    await act(async () => { screen.getByRole('button', { name: 'Discard' }).click(); await settleIdb(6) })
    await look(4)
    expect(record()).toMatchObject({ dirty: 0, baseUpdatedAt: T1, bodyJson: SAVED })
    expect(queue()).toEqual([])
    expect(indicator().textContent).toBe(SAVED_WORDS)
  })

  it('typing over the banner commits a write of this page: from then on `unsynced` speaks, not `held`', async () => {
    await leftOnDevice({ body: OTHER, entries: [] })
    accept = (patch) => ({ ...SERVER, ...patch, updatedAt: '2026-11-13T10:00:30.000000+00:00' })
    await openTheNote()
    await screen.findByText(/Unsaved changes from a previous session/)
    await look(2)
    expect(indicator().textContent).toBe(unsyncedLabel(null))
    await typeInBody(' typed over the banner')
    await look(8)
    expect(update).toHaveBeenCalled()
    expect(indicator().textContent).toBe(SAVED_WORDS)
  })

  it('3b: another tab\'s drain settled the note while recovery read it: "Saved", never "waiting to sync" over a clean store', async () => {
    await leftOnDevice()
    const release = holdRecovery()
    await openTheNote()
    await look(2)
    await act(async () => {
      await putNoteWithIntent(await connectNotebookDb('u42'), {
        noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: SAVED, dirty: 0, baseUpdatedAt: T1,
      }, null)
      await settleIdb(4)
    })
    await act(async () => { release(); await settleIdb(6) })
    await look(4)
    expect(record()).toMatchObject({ dirty: 0 })
    expect(queue()).toEqual([])
    expect(indicator().textContent).toBe(SAVED_WORDS)
  })

  it('3a: typing before the device answers shows "Saving…"; a store that never answers still says "Saved" after a landed save', async () => {
    factory.open(ACCOUNT_DB)
    await act(async () => { await settleIdb(2) })
    holdRecovery()   // never released
    accept = (patch) => ({ ...SERVER, ...patch, updatedAt: '2026-11-13T10:00:30.000000+00:00' })
    await openTheNote()
    await look(2)
    expect(indicator().textContent).toBe('')
    await typeInBody(' typed before the device answered')
    expect(indicator().textContent).toBe(SAVING_WORDS)
    await look(8)
    expect(update).toHaveBeenCalled()
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

describe('⛔ fix round 1, section 1: a cached or older copy is never proof', () => {
  const TA = '2026-11-13T09:59:00.000000+00:00'   // older than the record's base T0

  it('an in-app reopen served from the cache leaves the record and its entry untouched (the drain decides later)', async () => {
    await leftOnDevice()
    LOAD = { cached: true, note: { ...SERVER, updatedAt: TA } }
    await openTheNote()
    await sit()
    expect(record()).toMatchObject({ dirty: 1, baseUpdatedAt: T0, bodyJson: SAVED })
    expect(queue()).toHaveLength(1)
    expect(indicator().textContent).toBe(unsyncedLabel(null))
    expect(ring()).toEqual(RING)
  })

  it('the same words from the cache at the CURRENT revision: still not proof, still untouched', async () => {
    await leftOnDevice()
    LOAD = { cached: true, note: SERVER }
    await openTheNote()
    await sit()
    expect(record()).toMatchObject({ dirty: 1, baseUpdatedAt: T0 })
    expect(queue()).toHaveLength(1)
  })

  it('a network copy whose revision is OLDER than the words\' base proves nothing: untouched', async () => {
    await leftOnDevice()
    LOAD = { cached: false, note: { ...SERVER, updatedAt: TA } }
    await openTheNote()
    await sit()
    expect(record()).toMatchObject({ dirty: 1, baseUpdatedAt: T0 })
    expect(queue()).toHaveLength(1)
  })
})

describe('⭐ fix round 1, section 4: Discard on the recovery banner removes exactly the offered words', () => {
  const NEWER = doc(para('words written after the offer'))
  const banner = () => screen.findByText(/Unsaved changes from a previous session/)
  const discard = async () => {
    await act(async () => { screen.getByRole('button', { name: 'Discard' }).click(); await settleIdb(6) })
    await sit(2)
  }

  it('a dirty record and its entry holding the offered words: server copy clean, nothing queued, the drain sends nothing', async () => {
    // no last-known server copy ⇒ the queued words are offered, not adopted
    await leftOnDevice({ body: OTHER, entries: [OTHER], withServerBase: false })
    await openTheNote()
    await banner()
    await discard()
    expect(record()).toMatchObject({ dirty: 0, baseUpdatedAt: T1, bodyJson: SAVED, serverBase: null })
    expect(queue()).toEqual([])
    const send = vi.fn(); const fork = vi.fn()
    expect(await drainOutbox(await connectNotebookDb('u42'), { send, fork })).toEqual([])
    expect(send).not.toHaveBeenCalled()
    expect(fork).not.toHaveBeenCalled()
    expect(ring()).toEqual(RING)
    expect((await unsent()).unsent).toBe(false)
  })

  it('newer words reached the store after the offer: refused, the newer words and their entry intact', async () => {
    await leftOnDevice({ body: OTHER, entries: [OTHER], withServerBase: false })
    await openTheNote()
    await banner()
    await act(async () => {
      await putNoteWithIntent(await connectNotebookDb('u42'), {
        noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: NEWER, dirty: 1, generation: 9, baseUpdatedAt: T0,
      }, {
        mutationId: 'note:n1', noteId: 'n1', kind: 'note-update', patch: { title: 'Thesis', subtitle: '', bodyJson: NEWER },
        baseUpdatedAt: T0, generation: 9, queuedAt: 9,
      })
      await settleIdb(4)
    })
    await discard()
    expect(record()).toMatchObject({ dirty: 1, bodyJson: NEWER })
    expect(queue().map((e) => e.patch.bodyJson)).toEqual([NEWER])
    expect(ring()).toEqual(RING)
  })

  it('a second queued entry holding other words: refused, every entry intact', async () => {
    await leftOnDevice({ body: OTHER, entries: [OTHER, NEWER], withServerBase: false })
    await openTheNote()
    await banner()
    await discard()
    expect(record()).toMatchObject({ dirty: 1 })
    expect(JSON.stringify(queue().map((e) => e.patch.bodyJson))).toContain('words written after the offer')
    expect(ring()).toEqual(RING)
  })

  it('the member typed while the banner was up: the offered words go, the typed words are in the record and queued', async () => {
    await leftOnDevice({ body: OTHER, entries: [OTHER], withServerBase: false })
    await openTheNote()
    await banner()
    await typeInBody(' typed while the banner was up')
    await sit(1)   // the keystroke's own durable write commits first: fix 6 keeps the offered words in the record
    expect(JSON.stringify(record().bodyJson)).not.toContain('typed while the banner was up')
    await discard()
    await sit(2)
    const words = JSON.stringify(record().bodyJson)
    expect(words).toContain('typed while the banner was up')
    expect(words).not.toContain('words the server never received')
    expect(JSON.stringify(queue().map((e) => e.patch.bodyJson))).toContain('typed while the banner was up')
    expect(JSON.stringify(queue())).not.toContain('words the server never received')
    expect(ring()).toEqual(RING)
  })

  // ⭐ Fix round 2, section 1: the containment arm of `offerCarries`, both directions.
  const PREFIX = doc(para('the start of what was typed'))
  const LONGER = doc(para('the start of what was typed, and more after it'))
  async function offerTheCrashDraft({ recordBody, draftBody }) {
    await leftOnDevice({ body: recordBody, entries: [recordBody], withServerBase: false })
    // same session, newer generation ⇒ the crash draft is the copy the banner offers
    localStorage.setItem('uct.j2.notedraft.n1', JSON.stringify({
      title: 'Thesis', subtitle: '', bodyJson: draftBody, savedAt: 2000, sessionId: 'gone', generation: 9,
    }))
    await openTheNote()
    await banner()
  }

  it('2a: the record and its entry hold the offered words PLUS more: refused, both intact', async () => {
    await offerTheCrashDraft({ recordBody: LONGER, draftBody: PREFIX })
    await discard()
    expect(record()).toMatchObject({ dirty: 1, bodyJson: LONGER })
    expect(queue().map((e) => e.patch.bodyJson)).toEqual([LONGER])
  })

  it('2b: the record holds a strict prefix of the offered copy: discarded, clean, nothing queued', async () => {
    await offerTheCrashDraft({ recordBody: PREFIX, draftBody: LONGER })
    await discard()
    expect(record()).toMatchObject({ dirty: 0, bodyJson: SAVED, baseUpdatedAt: T1 })
    expect(queue()).toEqual([])
  })

  // ⭐ Fix round 2, section 2: no moment without a copy for words typed under the banner.
  it('2c: in the same turn as the discard, the crash draft and the record already hold the typed words (no debounce)', async () => {
    await leftOnDevice({ body: OTHER, entries: [OTHER], withServerBase: false })
    await openTheNote()
    await banner()
    await typeInBody(' typed under the banner')
    await sit(1)
    await act(async () => { screen.getByRole('button', { name: 'Discard' }).click(); await settleIdb(8) })
    expect(localStorage.getItem('uct.j2.notedraft.n1') || '').toContain('typed under the banner')
    expect(JSON.stringify(record().bodyJson)).toContain('typed under the banner')
    expect(JSON.stringify(record().bodyJson)).not.toContain('words the server never received')
  })

  // ⭐ Final fix pass (E-M2): the capture after the discard compares with the copy the server holds NOW.
  it('2f: the autosave of the words typed under the banner lands during the discard: nothing re-queued, no draft, the record clean', async () => {
    await leftOnDevice({ body: OTHER, entries: [OTHER], withServerBase: false })
    let release
    const held = new Promise((r) => { release = r })
    const T2 = '2026-11-13T10:00:09.000000+00:00'
    accept = (patch) => held.then(() => ({ ...SERVER, ...patch, updatedAt: T2 }))
    // The discard's transaction commits, THEN the autosave's answer arrives, THEN the editor's `.then` runs.
    DURABLE_OVERRIDE = (real) => ({
      discardOffered: async (args) => {
        const done = await real.discardOffered(args)
        vi.advanceTimersByTime(1000)          // the 800 ms autosave has fired (it waits on `held`)
        await settleIdb(4)
        release()
        await settleIdb(12)
        return done
      },
    })
    await openTheNote()
    await banner()
    await typeInBody(' typed under the banner')
    await act(async () => { screen.getByRole('button', { name: 'Discard' }).click(); await settleIdb(12) })
    await sit(2)
    expect(update).toHaveBeenCalled()
    expect(JSON.stringify(update.mock.calls.at(-1)[0].bodyJson)).toContain('typed under the banner')
    expect(queue()).toEqual([])
    expect(record()).toMatchObject({ dirty: 0 })
    expect(JSON.stringify(record().bodyJson)).toContain('typed under the banner')
    expect(localStorage.getItem('uct.j2.notedraft.n1')).toBeNull()
    expect((await unsent()).unsent).toBe(false)
  })

  it('2d: nothing typed, or typing undone back to the server copy: no capture, the record stays the clean server copy', async () => {
    await leftOnDevice({ body: OTHER, entries: [OTHER], withServerBase: false })
    await openTheNote()
    await banner()
    await typeInBody(' typed then undone')
    const dom = document.querySelector('.ProseMirror')
    await act(async () => { dom.editor.commands.undo(); await settleIdb(2) })
    expect(dom.editor.getText()).not.toContain('typed then undone')
    await sit(1)
    await act(async () => { screen.getByRole('button', { name: 'Discard' }).click(); await settleIdb(8) })
    await sit(2)
    expect(localStorage.getItem('uct.j2.notedraft.n1')).toBeNull()
    expect(record()).toMatchObject({ dirty: 0, bodyJson: SAVED })
    expect(queue()).toEqual([])
  })

  it('2e: a rejected discard falls back to the old path (markSynced through this tab writer), never half-handled', async () => {
    await leftOnDevice({ body: OTHER, entries: [OTHER], withServerBase: false })
    DURABLE_OVERRIDE = { discardOffered: () => Promise.reject(new Error('the transaction was aborted')) }
    await openTheNote()
    await banner()
    await discard()
    expect(screen.queryByText(/Unsaved changes from a previous session/)).toBeNull()
    // the old path ran: fix 6 kept the words, rewritten by THIS tab's writer (no longer the gone session's)
    expect(record()).toMatchObject({ dirty: 1, bodyJson: OTHER })
    expect(record().sessionId).not.toBe('gone')
  })

  it('a crash draft alone: unchanged, the draft is cleared and the store holds the server copy, nothing queued', async () => {
    factory.open(ACCOUNT_DB)
    await act(async () => { await settleIdb(2) })
    store().seed('meta', { name: 'landed:n1', value: RING })
    localStorage.setItem('uct.j2.notedraft.n1', JSON.stringify({ title: 'Thesis', subtitle: '', bodyJson: OTHER, savedAt: 5 }))
    await openTheNote()
    await banner()
    await discard()
    expect(localStorage.getItem('uct.j2.notedraft.n1')).toBeNull()
    expect(record()?.dirty ?? 0).toBe(0)
    expect(queue()).toEqual([])
    expect(ring()).toEqual(RING)
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
