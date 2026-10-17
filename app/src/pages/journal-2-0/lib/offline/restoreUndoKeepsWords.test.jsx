/**
 * ⭐⭐ RESTORE, THEN UNDO PAST IT (review I-A of the mid-text hotfix, 2026-10-16).
 *
 * The finding, traced from source by the re-review and NOT run there: offline,
 * the member types in the open note (a dirty durable record now holds words the
 * crash draft does not), then presses Restore on a crash draft, then undoes past
 * the Restore. The containment test kept the OLDER record when the restored
 * words were captured (a different lineage, and the restored copy does not
 * contain the old view's words), so the restored words W lived only on screen
 * and in the crash draft — and the crash draft mirrors the view, so the Undo's
 * own capture overwrote the only copy.
 *
 * Every rail drives the REAL `NoteEditorPage`, the REAL durable layer over the
 * fake IndexedDB, the REAL outbox sweep hook and a real Undo command (the touch
 * Undo button's own `editor.chain().focus().undo().run()`). Only the server
 * (a compare-and-set mock that is DOWN), auth and the folder list are stubbed.
 *
 * ⛔⛔ FIX ROUND 1 (independent review `restore-undo-review.md`, C1/C2/I1/I2): a
 * word survives only in a DURABLE layer — the server, a `(conflicted copy)`
 * sibling, an outbox entry, or the durable record. The crash draft follows the
 * page, so the next keystroke or Undo rewrites it: it is convenience, never a
 * word's only home. Every rail asserts that for the restored words W AND for the
 * words the member typed before pressing Restore — the fix may not buy one with
 * the other — and several of them close the tab and reopen it.
 */
import { render, screen, act, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AsyncLocalStorage } from 'node:async_hooks'
import { describe, it as vitestIt, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb } from './__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections } from './useDurableNote'
import { useOutboxDrain, forkConflictedCopy } from './useOutboxDrain'
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import { dbNameFor } from './notebookDb'

// The real editor, a real Undo and several durable windows per rail.
vi.setConfig({ testTimeout: 60_000 })

/*
 * ⭐⭐ FIX ROUND 4 (review M-12): EVERY REQUEST IS BOUND TO THE CELL THAT MADE IT.
 * The mocks used to read the module's `server` when they WROTE, so a PUT (or a
 * fork) one cell left in flight landed in whichever server the NEXT cell had made.
 *   · `update` is bound per mount: `useJ2Note` hands each editor the PUT of the
 *     server it was opened on (`updateFor`), and that PUT writes only there.
 *   · the fork's two requests (`fetch` of the source, `createNoteViaApi`) resolve
 *     their server through `cellScope`, the async context each cell runs in, so a
 *     request issued from a promise chain a cell started still writes to that
 *     cell's server after the next cell began. The sweep's own fork is the REAL
 *     `forkConflictedCopy`, run inside the scope of the server its tab opened on.
 * Rails: the "review M-12" cells at the end of this file.
 */
const cellScope = new AsyncLocalStorage()
// ⭐ Fix round 5 (review M-20): the fake clock is installed INSIDE the cell's scope. Its
// auto-advance runs from a real interval, and an interval carries the async context it
// was created in, so the editor's own reconcile fork that the clock starts resolves this
// cell's server, never the module's (which by then may be the next cell's).
const it = (name, fn, ...rest) => vitestIt(name, (...args) => cellScope.run({ server: null }, () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  return fn(...args)
}), ...rest)
/** The server of the cell this request belongs to (the module's, outside any cell). */
const serverNow = () => cellScope.getStore()?.server ?? server

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const T0 = '2026-10-16T20:00:00.000000+00:00'
const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const doc = (...blocks) => ({ type: 'doc', content: blocks })
const ONLINE = para('server copy S.')
const SENTENCE = 'crash-draft words W - THIS must never be dropped.'
const DRAFT = doc(ONLINE, para(SENTENCE))
const OLD = 'K-old-view'
const DRAFT_KEY = 'uct.j2.notedraft.n1'

let server
function makeServer({ body, updatedAt }) {
  let rev = 0
  const s = {
    title: 'Thesis', subtitle: '', body, updatedAt, puts: [], forks: [], down: false, refuseCreate: 0,
    // Fix round 4 (M-12): `refuseDetail` is the server's sentence for a refused create;
    // `holdPuts` / `holdReads` hold a PUT / the source read in flight until released.
    refuseDetail: 'title too long', holdPuts: null, holdReads: null, inflight: 0,
    note: () => ({
      id: 'n1', title: s.title, subtitle: s.subtitle, folderId: null, ticker: null, tags: [],
      heroImageUrl: null, isFavorite: false, bodyJson: s.body, updatedAt: s.updatedAt,
    }),
    stamp: () => { rev += 1; s.updatedAt = `2026-10-16T20:10:${String(10 + rev).padStart(2, '0')}.000000+00:00` },
  }
  const box = cellScope.getStore()
  if (box) box.server = s
  return s
}
/** The compare-and-set PUT, into ONE server, whichever cell is running when it lands. */
async function putInto(s, patch) {
  s.puts.push(patch)
  if (s.down) throw new Error('network down')        // no status ⇒ retried, never forked
  if (s.holdPuts) { s.inflight += 1; await s.holdPuts; s.inflight -= 1 }
  if (patch.baseUpdatedAt && patch.baseUpdatedAt !== s.updatedAt) {
    const e = new Error('note changed — refresh and retry'); e.status = 409; throw e
  }
  if (patch.bodyJson) s.body = patch.bodyJson
  if ('title' in patch) s.title = patch.title
  if ('subtitle' in patch) s.subtitle = patch.subtitle ?? ''
  s.stamp()
  return s.note()
}
/** Records every PUT an editor makes (assertions only); the write is `updateFor`'s. */
const update = vi.fn()
const boundUpdates = new WeakMap()
function updateFor(s) {
  if (!boundUpdates.has(s)) boundUpdates.set(s, async (patch, ...rest) => { update(patch, ...rest); return putInto(s, patch) })
  return boundUpdates.get(s)
}
const boundForks = new WeakMap()
function forkFor(s) {
  if (!boundForks.has(s)) boundForks.set(s, (entry) => cellScope.run({ server: s }, () => forkConflictedCopy(entry)))
  return boundForks.get(s)
}
let mountedNote = null
let mountedUpdate = null
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: mountedNote, isLoading: false, error: null, update: mountedUpdate, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u42', role: 'member' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('../noteCreation', () => ({
  // ⭐ FIX ROUND 2 (review I-2): the sweep forks through the REAL `forkConflictedCopy`;
  // only the network call underneath is stubbed, and it honours the network being down.
  createNoteViaApi: vi.fn(async (args) => {
    const s = serverNow()                                 // M-12: the cell that made the request
    if (s.down) throw new Error('network down')
    // Fix round 3: the server can refuse a create (the real helper sets `.status`).
    if (s.refuseCreate) {
      const e = new Error(`Could not create note (${s.refuseCreate})`)
      e.status = s.refuseCreate; e.detail = s.refuseDetail
      throw e
    }
    s.forks.push(args)
    return { id: `fork-${s.forks.length}`, ...args }
  }),
}))

const ACCOUNT_DB = dbNameFor('u42')
let factory
const sweepSend = vi.fn(async () => { throw new Error('the sweep must never send the note the editor owns') })

function installLocks() {
  const held = new Set()
  Object.defineProperty(globalThis.navigator, 'locks', {
    configurable: true,
    value: {
      request: async (name, opts, cb) => {
        if (opts?.ifAvailable) {
          if (held.has(name)) return cb(null)
          held.add(name)
          return cb({ name })
        }
        return new Promise(() => {})
      },
    },
  })
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  update.mockClear(); sweepSend.mockClear()
  __resetNotebookConnections()
  factory = createFakeIndexedDbFactory()
  globalThis.indexedDB = factory
  installLocks()
  global.fetch = vi.fn((url) => {
    if (String(url) === '/api/j2/notes/n1') {
      const s = serverNow()                               // M-12: the cell that made the request
      if (s.down) return Promise.reject(new TypeError('Failed to fetch'))
      const answer = () => ({ ok: true, json: () => Promise.resolve({ note: s.note() }) })
      if (s.holdReads) { s.inflight += 1; return s.holdReads.then(answer) }
      return Promise.resolve(answer())
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
  // Fix round 5 (M-20): the fake clock is installed by `it`, inside the cell's scope.
})
afterEach(async () => {
  cleanup()
  // M-12: let the outgoing tab's own work settle before the next cell swaps the store.
  await act(async () => { await settleIdb(8) })
  // Fix round 4: a test that put a clipboard on `navigator` takes it away again.
  Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: undefined })
  vi.useRealTimers()
  vi.clearAllMocks()
  localStorage.clear()
  delete globalThis.indexedDB
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: undefined })
})

/** A crash draft an earlier session left — with or without the revision it was typed on. */
function crashDraftFromEarlierSession({ base = null, title = 'Thesis' } = {}) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({
    title, subtitle: '', bodyJson: DRAFT, savedAt: Date.now() - 60_000,
    sessionId: 's-earlier', ...(base ? { baseUpdatedAt: base } : {}),
  }))
}
function Tab({ Editor }) {
  // The REAL `forkConflictedCopy`: review I-2 — a stub here hid C-1. Fix round 4
  // (M-12): run inside the scope of the server this tab was opened on.
  useOutboxDrain({ accountId: 'u42', excludeNoteId: 'n1', send: sweepSend, fork: forkFor(server) })
  return <Editor noteId="n1" onBack={() => {}} />
}
async function openTheNote() {
  mountedNote = server.note()
  mountedUpdate = updateFor(server)
  const mod = await import('../../components/notebook/NoteEditorPage')
  render(<MemoryRouter><Tab Editor={mod.default} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
}
async function tick(ms) {
  await act(async () => { vi.advanceTimersByTime(ms); await settleIdb(6) })
}
async function sit(rounds) {
  for (let i = 0; i < rounds; i += 1) await tick(500) // eslint-disable-line no-await-in-loop
}
/** Close the tab: the unmount runs, nothing else does. */
async function closeTheTab() {
  cleanup()
  await act(async () => { await settleIdb(8) })
}
async function openAgain() {
  installLocks()
  __resetNotebookConnections()
  await openTheNote()
  await sit(2)
}
async function reopen() {
  await closeTheTab()
  await openAgain()
}
async function editor() {
  const dom = await waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el
  })
  return dom.editor
}
const viewText = async () => (await editor()).getText()
async function until(cond, { step = 50, max = 60 } = {}) {
  for (let i = 0; i < max; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await cond()) return true
    await tick(step) // eslint-disable-line no-await-in-loop
  }
  return Boolean(await cond())
}
async function typeAtEnd(text) {
  const ed = await editor()
  await act(async () => { ed.chain().focus('end').insertContent(text).run(); await settleIdb(2) })
}
async function typeTitle(value) {
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value } })
    await settleIdb(2)
  })
}
async function typeSubtitle(value) {
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText('Subtitle (optional)'), { target: { value } })
    await settleIdb(2)
  })
}
/** An EARLIER session left a dirty record R (and, with `entry`, its queued entry). */
const R_WORDS = 'earlier-session record R words'
async function earlierSessionRecord({ entry = true } = {}) {
  factory.open(ACCOUNT_DB)
  await act(async () => { await settleIdb(2) })
  const store = factory.databases.get(ACCOUNT_DB)
  const body = doc(ONLINE, para(R_WORDS))
  store.seed('notes', {
    noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: body, dirty: 1, generation: 5,
    sessionId: 's-away', localSavedAt: 1000, baseUpdatedAt: T0,
    serverBase: { title: 'Thesis', subtitle: '', bodyJson: doc(ONLINE), updatedAt: T0 },
  })
  if (entry) {
    store.seed('outbox', {
      mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
      patch: { title: 'Thesis', subtitle: '', bodyJson: body },
      baseUpdatedAt: T0, generation: 5, sessionId: 's-away', queuedAt: 1000,
    })
  }
}
/** Hold the outbox read `recover()` makes, so the member can type before the
 *  banner is decided (S2). Returns the release. */
function holdRecovery() {
  const store = factory.databases.get(ACCOUNT_DB)
  let release
  const gate = new Promise((r) => { release = r })
  const orig = store.transaction.bind(store)
  store.transaction = (names, mode = 'readonly') => {
    const tx = orig(names, mode)
    if (names !== 'outbox' || mode !== 'readonly') return tx
    const inner = tx.objectStore
    tx.objectStore = (n) => {
      const st = inner(n)
      return {
        ...st,
        getAll: () => {
          const req = { result: [] }
          gate.then(() => { const r = st.getAll(); r.onsuccess = () => { req.result = r.result; req.onsuccess?.() } })
          return req
        },
      }
    }
    return tx
  }
  return () => { store.transaction = orig; release() }
}
/** The touch Undo / Redo buttons' own commands (`NoteEditorPage`'s controls). */
async function undoOnce() {
  const ed = await editor()
  await act(async () => { ed.chain().focus().undo().run(); await settleIdb(2) })
}
async function redoOnce() {
  const ed = await editor()
  await act(async () => { ed.chain().focus().redo().run(); await settleIdb(2) })
}
async function undoUntilGone(text, max = 8) {
  for (let i = 0; i < max; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await viewText()).includes(text)) return i
    await undoOnce() // eslint-disable-line no-await-in-loop
  }
  return (await viewText()).includes(text) ? -1 : max
}
async function pressRestore() {
  const restore = await screen.findByRole('button', { name: 'Restore' })
  await act(async () => { fireEvent.click(restore); await settleIdb(6) })
}

const outbox = () => factory.databases.get(ACCOUNT_DB)?.dump('outbox') ?? []
const record = () => (factory.databases.get(ACCOUNT_DB)?.dump('notes') ?? []).find((r) => r.noteId === 'n1')
const words = (o) => JSON.stringify({ t: o?.title ?? '', s: o?.subtitle ?? '', b: o?.bodyJson ?? null })
/** The DURABLE layers; the crash draft is reported beside them and never counted. */
const where = (text) => ({
  server: JSON.stringify(server.body).includes(text) || String(server.title).includes(text),
  outbox: outbox().some((e) => JSON.stringify(e.patch).includes(text)),
  record: words(record()).includes(text),
  forks: server.forks.some((f) => JSON.stringify(f).includes(text)),
  draftNotCounted: (localStorage.getItem(DRAFT_KEY) || '').includes(text),
})
const durable = (text) => { const w = where(text); return w.server || w.outbox || w.record || w.forks }
function expectDurable(text, label) {
  expect(durable(text), `${label}: "${text}" is in no DURABLE layer ${JSON.stringify(where(text))}`).toBe(true)
}
function expectBothDurable(label, old = OLD) {
  expectDurable(SENTENCE, `${label}: the restored words W`)
  expectDurable(old, `${label}: the words typed before Restore`)
}

/** Open offline on S, type in the old view, let the durable write land, wait
 *  `beforeRestoreMs`, press Restore. Returns once the draft is on the page.
 *  With `beforeRestoreMs` under the 200 ms durable window (0: straight after the
 *  keystroke) the old view's words are still PENDING in the writer at Restore. */
async function typeThenRestore({ base = null, beforeRestoreMs = 1000, draftTitle } = {}) {
  server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
  server.down = true
  crashDraftFromEarlierSession({ base, ...(draftTitle ? { title: draftTitle } : {}) })
  await openTheNote()
  await sit(2)
  await typeAtEnd(` ${OLD}`)
  const typedAt = Date.now()
  if (beforeRestoreMs < 200) {
    // ⚠️ No tick: under `shouldAdvanceTime` every `settleIdb` round lets the fake
    // clock run ~20 ms, so Restore goes in straight after the keystroke.
    expect(JSON.stringify(record()?.bodyJson ?? null), "precondition: the old view's words are not durable yet").not.toContain(OLD)
  } else {
    await tick(Math.min(beforeRestoreMs, 400))
    expect(JSON.stringify(record()?.bodyJson ?? null), 'precondition: the old view wrote its words to the record').toContain(OLD)
    expect(record()?.dirty, 'precondition: the record is dirty (unsent)').toBeTruthy()
    if (beforeRestoreMs > 400) await tick(beforeRestoreMs - 400)
  }
  update.mockClear()
  const gapMs = Date.now() - typedAt          // the fake clock prosemirror-history stamps transactions with
  await pressRestore()
  expect(await until(async () => (await viewText()).includes(SENTENCE)), 'precondition: the draft is on the page').toBe(true)
  return { gapMs }
}

describe('I-A · ⛔⛔ a crash-draft Restore, and any Undo past it, never leaves a word outside the durable layers (offline)', () => {
  it('Restore WITHOUT a base after old-view typing ⇒ W durable AT the Restore (C2); a keystroke, then Undo past it ⇒ both durable', async () => {
    await typeThenRestore()
    expect(update, 'precondition: the direct Restore path (a PUT straight away, refused: offline)').toHaveBeenCalled()
    await tick(400)
    expectBothDurable('right after the Restore, before any keystroke')
    await typeAtEnd('!')
    await tick(400)
    expect(await undoUntilGone(SENTENCE), 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(4)
    expectBothDurable('no-base Restore, keystroke, Undo')
  })

  it('Restore WITH a base (the adoption effect) after old-view typing ⇒ W durable before any Undo (I1); a keystroke, then Undo past it ⇒ both durable', async () => {
    await typeThenRestore({ base: T0 })
    await tick(400)
    expectBothDurable('right after the Restore')
    await typeAtEnd('!')
    await tick(400)
    expect(await undoUntilGone(SENTENCE), 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(4)
    expectBothDurable('with-base Restore, keystroke, Undo')
  })

  it('Restore WITHOUT a base after old-view typing, then Undo at once ⇒ both durable', async () => {
    await typeThenRestore()
    await tick(400)
    expect(await undoUntilGone(SENTENCE), 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(4)
    expectBothDurable('no-base Restore, Undo at once')
  })

  it('the simplest variant: Restore WITHOUT a base, no typing at all, Undo at once ⇒ W durable', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.down = true
    crashDraftFromEarlierSession()
    await openTheNote()
    await sit(2)
    await pressRestore()
    expect(await viewText(), 'precondition: the draft is on the page').toContain(SENTENCE)
    await tick(400)
    expect(await undoUntilGone(SENTENCE), 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(4)
    expectDurable(SENTENCE, 'Restore, Undo at once')
  })

  it('typing then Restore INSIDE one history group (under 500 ms apart), a keystroke, then Undo past it ⇒ both durable', async () => {
    const { gapMs } = await typeThenRestore({ beforeRestoreMs: 200 })
    expect(gapMs, 'precondition: the keystroke and the Restore were under newGroupDelay (500 ms) apart').toBeLessThan(500)
    await tick(400)
    await typeAtEnd('!')
    await tick(400)
    expect(await undoUntilGone(SENTENCE), 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(4)
    expectBothDurable('typing + Restore in one group, keystroke, Undo')
  })

  it('Undo past the Restore, Redo, type, then Undo across the Restore again ⇒ both durable at every step', async () => {
    await typeThenRestore()
    await tick(400)
    await typeAtEnd('!')
    await tick(400)
    expect(await undoUntilGone(SENTENCE), 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(2)
    expectBothDurable('after the Undo')
    await redoOnce()
    expect(await viewText(), 'precondition: Redo put the restored page back').toContain(SENTENCE)
    await sit(2)
    expectBothDurable('after the Redo')
    await typeAtEnd(' after-redo')
    await sit(2)
    expectDurable('after-redo', 'the words typed after the Redo')
    // ⭐ OFFLINE-UNDO (2026-10-16): the first Undo below takes ' after-redo' back —
    // an ORDINARY Undo of the member's own typing, which is an edit of this view
    // like a keystroke: the record follows the page and is never pinned to the
    // undone words (`ordinaryUndoNoPin.test.jsx`). Fix round 1 rotated on it and
    // kept them; this rail used to assert that. The crossing after it still keeps
    // both, and Redo brings the typing back into a durable layer.
    await undoOnce()
    expect(await viewText(), 'precondition: an ordinary Undo took the typing back').not.toContain('after-redo')
    expect(await viewText(), 'precondition: it did not cross the Restore').toContain(SENTENCE)
    await sit(2)
    expectBothDurable('after the ordinary Undo')
    expect(words(record()), 'the record stayed pinned to words the member undid').not.toContain('after-redo')
    expect(await undoUntilGone(SENTENCE), 'precondition: Undo crossed the Restore again').toBeGreaterThan(0)
    await sit(2)
    expectBothDurable('after the second Undo')
    await redoOnce()                                              // the Restore, across it again
    await redoOnce()                                              // and the typing
    expect(await viewText(), 'precondition: Redo put the typing back').toContain('after-redo')
    await sit(2)
    expectBothDurable('after the second Redo')
    expectDurable('after-redo', 'the words typed after the Redo, redone')
  })

  it('a keystroke INSIDE the 200 ms window right after the Undo cannot coalesce anything away', async () => {
    await typeThenRestore()
    await tick(400)
    await typeAtEnd('!')
    await tick(400)
    expect(await undoUntilGone(SENTENCE)).toBeGreaterThan(0)
    await typeAtEnd(' typed-after-undo')                        // no tick: same coalescing window
    await sit(3)
    expectBothDurable('Undo then an immediate keystroke')
    expectDurable('typed-after-undo', 'the keystroke after the Undo')
  })

  it('back online after the Undo: the page saves, and nothing is settled away', async () => {
    await typeThenRestore()
    await tick(400)
    await typeAtEnd('!')
    await tick(400)
    expect(await undoUntilGone(SENTENCE)).toBeGreaterThan(0)
    await sit(2)
    server.down = false
    await typeAtEnd(' online')
    await sit(6)                                                  // the 800 ms autosave lands
    expect(JSON.stringify(server.body), 'precondition: the page saved').toContain('online')
    expectBothDurable('online after the Undo')
    // ⭐ And the queued copies become real `(conflicted copy)` siblings once the
    // sweep can reach the server — the queue empties of them, nothing is dropped.
    await act(async () => { window.dispatchEvent(new Event('online')); await settleIdb(6) })
    await sit(2)
    expect(server.forks.some((f) => f.tags?.includes('sync-conflict') && JSON.stringify(f).includes(SENTENCE)), `W never became a sibling ${JSON.stringify(where(SENTENCE))}`).toBe(true)
    expect(outbox().filter((e) => e.kind === 'note-copy'), 'a forked copy stayed queued').toEqual([])
    expectBothDurable('after the sweep forked the copies')
  })

  it('⛔ the restored words travel on the OLDER baseline: a draft typed on an earlier revision is queued on that revision', async () => {
    const T_OLD = '2026-10-16T19:00:00.000000+00:00'
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.down = true
    crashDraftFromEarlierSession({ base: T_OLD })             // the server has moved since
    await openTheNote()
    await sit(2)
    await typeAtEnd(` ${OLD}`)
    await tick(400)
    expect(record()?.baseUpdatedAt, 'precondition: the old view typed on the current revision').toBe(T0)
    await sit(2)
    await pressRestore()
    expect(await until(async () => (await viewText()).includes(SENTENCE)), 'precondition: the draft is on the page').toBe(true)
    await tick(400)
    const entry = outbox().find((e) => e.kind !== 'note-copy' && JSON.stringify(e.patch).includes(SENTENCE))
    expect(entry?.baseUpdatedAt, 'W must be queued on the revision it was typed on, so a moved server 409s').toBe(T_OLD)
    expect(await undoUntilGone(SENTENCE)).toBeGreaterThan(0)
    await sit(3)
    expectBothDurable('older-base Restore, Undo')
  })

  it("⛔ control: an Undo of the member's OWN typing after a Restore (not across it) queues nothing extra", async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.down = true
    crashDraftFromEarlierSession()
    await openTheNote()
    await sit(2)
    await pressRestore()
    expect(await viewText()).toContain(SENTENCE)
    await sit(2)                                                  // the Restore and the next keystroke are separate steps
    await typeAtEnd('#')
    await undoOnce()                                              // inside the durable window
    expect(await viewText(), 'precondition: the Undo took back only the keystroke').toContain(SENTENCE)
    await sit(3)
    expectDurable(SENTENCE, 'the restored words')
    expect(outbox().some((e) => JSON.stringify(e.patch).includes('dropped.#')), 'the undone keystroke was queued').toBe(false)
    expect(outbox().filter((e) => e.kind === 'note-copy'), 'a copy was queued for an Undo that crossed nothing').toEqual([])
  })

  for (const base of [null, T0]) {
    const path = base ? 'WITH a base (the adoption effect)' : 'WITHOUT a base'
    it(`Restore ${path} pressed INSIDE the 200 ms window after old-view typing, and a keystroke INSIDE the window after it ⇒ the old words survive, and both survive an Undo past it`, async () => {
      await typeThenRestore({ base, beforeRestoreMs: 0 })
      await typeAtEnd('!')                                        // no tick: the Restore's capture is still pending
      await sit(2)
      expectBothDurable(`${path}: after the Restore and the keystroke`)
      expect(await undoUntilGone(SENTENCE), 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
      await sit(4)
      expectBothDurable(`${path} Restore inside the durable window, Undo`)
    })
  }
})

describe('I-A · fix round 1 — the routes the review traced (C1, C2, I1, I2, M1)', () => {
  it('C1a: an Undo in the OLD view before Restore, then Undo past the Restore ⇒ W and the kept old words durable', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.down = true
    crashDraftFromEarlierSession()
    await openTheNote()
    await sit(2)
    await typeAtEnd(' K1-first')
    await sit(2)                                                  // its own undo step, and durable
    await typeAtEnd(' K2-second')
    await sit(2)
    await undoOnce()                                              // the member takes back K2
    expect(await viewText(), 'precondition: the Undo removed only K2').not.toContain('K2-second')
    expect(await viewText()).toContain('K1-first')
    await sit(2)
    await pressRestore()
    expect(await until(async () => (await viewText()).includes(SENTENCE))).toBe(true)
    await tick(400)
    expect(await undoUntilGone(SENTENCE), 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(4)
    expectDurable(SENTENCE, 'C1a: the restored words W')
    expectDurable('K1-first', "C1a: the old view's kept words")
  })

  it('C1b: the crash draft carries a DIFFERENT title (a renamed note) ⇒ an Undo past the Restore keeps W and its title durable', async () => {
    await typeThenRestore({ draftTitle: 'Renamed in the crash draft' })
    await tick(400)
    await typeAtEnd('!')
    await tick(400)
    expect(await undoUntilGone(SENTENCE), 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(4)
    expectBothDurable('C1b renamed draft')
    expectDurable('Renamed in the crash draft', "C1b: the draft's title")
  })

  it('C1b: the old-view edit was a TITLE edit ⇒ Restore, Undo past it ⇒ W and the old title durable', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.down = true
    crashDraftFromEarlierSession()
    await openTheNote()
    await sit(2)
    await typeTitle(`Thesis ${OLD}`)
    await sit(2)
    expect(record()?.title, 'precondition: the title edit is in the record').toContain(OLD)
    await pressRestore()
    expect(await until(async () => (await viewText()).includes(SENTENCE))).toBe(true)
    await tick(400)
    await typeAtEnd('!')
    await tick(400)
    expect(await undoUntilGone(SENTENCE), 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(4)
    expectBothDurable('C1b old-view title edit')
  })

  it('C1b: a title edit AFTER the Restore and before the Undo ⇒ both durable', async () => {
    await typeThenRestore()
    await tick(400)
    await typeTitle('A title typed after Restore')
    await sit(2)
    expect(await undoUntilGone(SENTENCE), 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(4)
    expectBothDurable('C1b title after Restore')
    expectDurable('A title typed after Restore', 'the title typed after Restore')
  })

  it('C2: no-base Restore offline after old-view typing, then the tab closes with no keystroke ⇒ W durable, and still durable after reopening', async () => {
    await typeThenRestore()
    await tick(400)
    await closeTheTab()
    expectBothDurable('C2 after the tab closed')
    await openAgain()
    await sit(1)
    expectBothDurable('C2 after reopening')
  })

  it('I1: Undo past the Restore, close, reopen, type before choosing, close ⇒ W and the old words durable throughout', async () => {
    await typeThenRestore()
    await tick(400)
    await typeAtEnd('!')
    await tick(400)
    expect(await undoUntilGone(SENTENCE)).toBeGreaterThan(0)
    await sit(2)
    await reopen()
    expectBothDurable('I1 after reopening')
    await typeAtEnd(' typed-before-choosing')
    await sit(2)
    await closeTheTab()
    expectBothDurable('I1 after typing over the banner and closing')
  })

  it('I2: a FURTHER Undo past the pre-Restore page (multi-hop) never drops W', async () => {
    await typeThenRestore()
    await tick(400)
    await typeAtEnd('!')
    await tick(400)
    expect(await undoUntilGone(SENTENCE)).toBeGreaterThan(0)
    await sit(2)
    await undoOnce()                                              // past the pre-Restore page: takes back the old typing
    await sit(3)
    expectDurable(SENTENCE, 'multi-hop Undo')
  })

  it('the member replaced the restored words, undid back to them (the record stays pinned), then undid past the Restore ⇒ W durable', async () => {
    // The page the crossing Undo leaves is NOT the record here: the record holds
    // the replacement (an Undo pins it, re-review M2). Only writing the page
    // being left, before the rotation, keeps W.
    await typeThenRestore()
    await sit(2)
    const ed = await editor()
    await act(async () => { ed.chain().focus().selectAll().deleteSelection().insertContent('Z-replacement').run(); await settleIdb(2) })
    await sit(2)
    expect(words(record())).toContain('Z-replacement')
    await undoOnce()                                              // back to the restored page — not across the Restore
    expect(await viewText(), 'precondition: the Undo brought the restored words back').toContain(SENTENCE)
    await sit(2)
    expect(await undoUntilGone(SENTENCE), 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(3)
    expectDurable(SENTENCE, 'the restored words the member had brought back')
    expectDurable('Z-replacement', 'the replacement')
  })

  it('a keystroke INSIDE the 200 ms window right after a with-base Restore (nothing else in flight) cannot coalesce the Restore\'s capture away', async () => {
    await typeThenRestore({ base: T0 })                           // the old view's write landed long ago
    await typeAtEnd('!')                                          // no tick
    await sit(3)
    expectBothDurable('with-base Restore, then an immediate keystroke')
  })

  it('M1: a keystroke under 500 ms BEFORE the Restore is its own undo step too (one Undo takes back only the Restore)', async () => {
    const { gapMs } = await typeThenRestore({ beforeRestoreMs: 200 })
    expect(gapMs, 'precondition: under newGroupDelay (500 ms)').toBeLessThan(500)
    await tick(400)
    await undoOnce()
    const text = await viewText()
    expect(text, 'precondition: the Undo took back the Restore').not.toContain(SENTENCE)
    expect(text, 'one Undo also took back the keystroke typed just before Restore').toContain(OLD)
  })

  it('M1: a keystroke under 500 ms after the Restore is its OWN undo step (one Undo takes back only it)', async () => {
    await typeThenRestore()
    await typeAtEnd('#after')                                     // straight after the Restore
    await undoOnce()
    const text = await viewText()
    expect(text, 'one Undo also took back the Restore').toContain(SENTENCE)
    expect(text).not.toContain('#after')
  })
})

describe('I-A · fix round 2 — the routes the round-1 review traced (C-1, C-2)', () => {
  it('C-1: a SUBTITLE the Restore pushed into a copy reaches the created copy (the real fork)', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.down = true
    crashDraftFromEarlierSession()
    await openTheNote()
    await sit(2)
    await typeSubtitle('NVDA: wait for 140 reclaim')
    await sit(2)
    expect(record()?.subtitle, 'precondition: the subtitle is in the record').toContain('140 reclaim')
    await pressRestore()
    expect(await until(async () => (await viewText()).includes(SENTENCE))).toBe(true)
    await sit(2)
    expectDurable('140 reclaim', 'C-1 offline, the subtitle after the Restore')
    server.down = false
    await act(async () => { window.dispatchEvent(new Event('online')); await settleIdb(6) })
    await sit(3)
    expect(outbox().filter((e) => e.kind === 'note-copy'), 'precondition: the sweep forked the copy').toEqual([])
    expectDurable('140 reclaim', 'C-1 after the sweep forked the copy')
    expect(server.forks.some((f) => String(f.subtitle).includes('140 reclaim')), `the created copy has no subtitle ${JSON.stringify(server.forks)}`).toBe(true)
  })

  for (const online of [false, true]) {
    const net = online ? 'ONLINE' : 'OFFLINE'
    it(`C-2 (${net}): an earlier session's dirty record, typing BEFORE the banner is decided, then Restore of it, then reload ⇒ the typed words and R durable`, async () => {
      server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
      server.down = !online
      await earlierSessionRecord({ entry: true })
      const release = holdRecovery()
      await openTheNote()
      await sit(2)
      await typeAtEnd(' T-typed-before-the-banner')
      await sit(2)
      release()
      const restore = await screen.findByRole('button', { name: 'Restore' })
      expect(await viewText(), 'precondition: S2 offered the queued words instead of adopting them').toContain('T-typed-before-the-banner')
      await act(async () => { fireEvent.click(restore); await settleIdb(6) })
      expect(await until(async () => (await viewText()).includes(R_WORDS)), 'precondition: R is on the page').toBe(true)
      await sit(3)
      expectDurable('T-typed-before-the-banner', `C-2 ${net}: the words typed before the banner`)
      expectDurable(R_WORDS, `C-2 ${net}: R`)
      await reopen()
      await sit(2)
      expectDurable('T-typed-before-the-banner', `C-2 ${net}: after reload, the typed words`)
      expectDurable(R_WORDS, `C-2 ${net}: after reload, R`)
    })
  }

  it('C-2 (no-base path): an earlier record AND a newer crash draft, typing before the banner, Restore of the draft, reload ⇒ T, R and W durable', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.down = true
    await earlierSessionRecord({ entry: false })
    crashDraftFromEarlierSession()                                 // newer than R, no base: the no-base path
    const release = holdRecovery()
    await openTheNote()
    await sit(2)
    await typeAtEnd(' T-typed-before-the-banner')
    await sit(2)
    release()
    const restore = await screen.findByRole('button', { name: 'Restore' })
    update.mockClear()
    await act(async () => { fireEvent.click(restore); await settleIdb(6) })
    expect(await until(async () => (await viewText()).includes(SENTENCE)), 'precondition: the draft is on the page').toBe(true)
    expect(update, 'precondition: the direct (no-base) Restore path').toHaveBeenCalled()
    await sit(3)
    expectDurable('T-typed-before-the-banner', 'C-2 no-base: the typed words')
    expectDurable(R_WORDS, 'C-2 no-base: R')
    expectDurable(SENTENCE, 'C-2 no-base: W')
    await reopen()
    expectDurable('T-typed-before-the-banner', 'C-2 no-base after reload: the typed words')
    expectDurable(R_WORDS, 'C-2 no-base after reload: R')
    expectDurable(SENTENCE, 'C-2 no-base after reload: W')
  })
})

describe('I-A · fix round 3 — a copy the server refused is its own offer: saved as a separate note, never restored into its source (C-3, I-4)', () => {
  // ⛔⛔ Review I-5: the copy's words must DIFFER from the server's text. Round 2's
  // fixture held a superset of the server body, so writing the copy over the
  // note could not fail any assertion — that is what hid C-3.
  const COPY_WORDS = 'words in a copy the server refused - R-copy'
  const SERVER_NOW = 'the note as it is on the server now - S-now'
  async function refusedCopy({ status = 400, detail = 'title too long', body = doc(para(COPY_WORDS)) } = {}) {
    factory.open(ACCOUNT_DB)
    await act(async () => { await settleIdb(2) })
    const { copyEntryFor } = await import('./noteCopy')
    const copy = copyEntryFor({
      noteId: 'n1', words: { title: 'Thesis', subtitle: 'copy subtitle', bodyJson: body }, sessionId: 's-away',
    })
    factory.databases.get(ACCOUNT_DB).seed('outbox', {
      ...copy, permanent: true, copyRefused: { status, error: `Could not create note (${status})`, detail },
      lastStatus: status, lastError: `Could not create note (${status})`,
    })
    return copy
  }
  const copyKept = (copy) => outbox().some((e) => e.mutationId === copy.mutationId)
  // ⚠️ The shared `update` mock writes to whichever `server` is current, so a PUT an
  // EARLIER cell left in flight can land here (measured: the C-2 no-base cell's draft
  // W). The property is that the COPY's words never reach the source note, and that
  // is asserted directly — a leaked PUT cannot carry them.
  const sourceNeverGotTheCopy = (label) => {
    expect(server.puts.some((p) => JSON.stringify(p).includes(COPY_WORDS)), `${label}: a PUT carried the copy into its source note`).toBe(false)
    expect(JSON.stringify(server.body), `${label}: the copy was written over its source note`).not.toContain(COPY_WORDS)
  }
  async function openOnRefusedCopy(refusal) {
    server = makeServer({ body: doc(para(SERVER_NOW)), updatedAt: T0 })
    const copy = await refusedCopy(refusal)
    await openTheNote()
    await sit(2)
    return copy
  }

  it('⛔⛔ C-3: the offer never writes the copy into its source note — "Save as a separate note" creates a new note and the source keeps its text', async () => {
    const copy = await openOnRefusedCopy()
    await sit(2)
    expect(screen.queryByRole('button', { name: 'Restore' }), 'a refused copy is offered as a Restore into its source').toBeNull()
    const save = await screen.findByRole('button', { name: 'Save as a separate note' })
    await act(async () => { fireEvent.click(save); await settleIdb(6) })
    await sit(3)
    sourceNeverGotTheCopy('after Save as a separate note')
    expect(server.forks, 'exactly one separate note was created').toHaveLength(1)
    expect(JSON.stringify(server.forks[0].bodyJson)).toContain(COPY_WORDS)
    expect(server.forks[0].subtitle).toBe('copy subtitle')
    expect(server.forks[0].title).toBe('Thesis (conflicted copy)')
    expect(copyKept(copy), 'the copy entry was kept after its note was created').toBe(false)
    expect(screen.queryByRole('button', { name: 'Save as a separate note' }), 'the offer stayed up after it was saved').toBeNull()
    expect(screen.getByText(/saved as a separate note/i), 'the member is told where the words went').toBeTruthy()
  })

  it('the offer says, in plain words, that the copy is kept on this device and what each button does (I-4)', async () => {
    await openOnRefusedCopy()
    const offer = await screen.findByTestId('refused-copy-offer')
    expect(offer.textContent).toMatch(/kept on this device/i)
    expect(offer.textContent).toMatch(/save as a separate note/i)
    expect(offer.textContent).toMatch(/discard/i)
    // ⛔ Fix round 4 (review I-7) REVERSES round 3 here: the server's sentence is kept
    // in the stored record for diagnosis and never shown to the member.
    expect(offer.textContent, 'the server’s refusal sentence reached the member').not.toMatch(/title too long/i)
  })

  it('⛔ I-4: a refused copy does NOT mark its healthy source note blocked ("edit it again to sync" is false for a copy)', async () => {
    const copy = await openOnRefusedCopy()
    await sit(4)
    expect(copyKept(copy), 'precondition: the refused copy is still held on this device').toBe(true)
    expect(screen.getByPlaceholderText('Title'), 'precondition: the note is open').toBeTruthy()
    expect(screen.queryByText(/edit it again to sync/i), 'the source note wears the blocked label').toBeNull()
  })

  it('a re-POST refused AGAIN keeps the copy on this device and keeps offering it, with its reason', async () => {
    const copy = await openOnRefusedCopy()
    server.refuseCreate = 422
    const save = await screen.findByRole('button', { name: 'Save as a separate note' })
    await act(async () => { fireEvent.click(save); await settleIdb(6) })
    await sit(2)
    expect(copyKept(copy), 'a refused re-POST lost the copy').toBe(true)
    expectDurable(COPY_WORDS, 'after a refused re-POST')
    expect(server.forks).toHaveLength(0)
    const offer = await screen.findByTestId('refused-copy-offer')
    expect(offer.textContent).toMatch(/kept on this device/i)
    expect(screen.getByRole('button', { name: 'Save as a separate note' }), 'the copy is no longer offered').toBeTruthy()
    sourceNeverGotTheCopy('after a refused re-POST')
  })

  it('Discard asks first (in the page), and keeps the copy if the member backs out', async () => {
    const copy = await openOnRefusedCopy()
    const discard = await screen.findByRole('button', { name: 'Discard' })
    await act(async () => { fireEvent.click(discard); await settleIdb(4) })
    expect(copyKept(copy), 'Discard deleted the copy before it was confirmed').toBe(true)
    const keep = await screen.findByRole('button', { name: 'Keep it' })
    expect(screen.getByRole('button', { name: 'Delete copy' })).toBeTruthy()
    await act(async () => { fireEvent.click(keep); await settleIdb(4) })
    expect(copyKept(copy)).toBe(true)
    expect(screen.getByRole('button', { name: 'Save as a separate note' })).toBeTruthy()
  })

  it('Discard, confirmed, deletes the copy and it does NOT come back on the next open', async () => {
    const copy = await openOnRefusedCopy()
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Discard' })); await settleIdb(4) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Delete copy' })); await settleIdb(6) })
    await sit(2)
    expect(copyKept(copy), 'a confirmed Discard kept the copy').toBe(false)
    expect(screen.queryByTestId('refused-copy-offer')).toBeNull()
    sourceNeverGotTheCopy('after Discard')
    await reopen()
    await sit(2)
    expect(copyKept(copy), 'the discarded copy came back').toBe(false)
    expect(screen.queryByTestId('refused-copy-offer'), 'the discarded copy is offered again').toBeNull()
  })

  // ⭐⭐ I-A BYTES: the offer is its own chunk, loaded only when a note has an offer
  // (`refusedCopyDoorLoaders` in NoteEditorPage). A chunk that cannot load (offline, or a
  // deploy replaced it) may change WHEN the offer appears, never whether the copy is kept.
  it('⛔ I-A bytes: the offer’s chunk fails to load — the member is told a copy is kept, the copy stays in the outbox, and Try again shows the offer', async () => {
    const { refusedCopyDoorLoaders, REFUSED_COPY_UNAVAILABLE } = await import('../../components/notebook/NoteEditorPage')
    const real = refusedCopyDoorLoaders.offer
    // Safari's wording (it names no chunk URL): a real chunk-load error, so the door's
    // importWithOneRetry asks again in place once before it gives up.
    const failing = vi.fn(() => Promise.reject(new TypeError('Importing a module script failed.')))
    refusedCopyDoorLoaders.offer = failing
    try {
      const copy = await openOnRefusedCopy()
      await sit(2)
      const said = await screen.findByText(REFUSED_COPY_UNAVAILABLE, {}, { timeout: 5000 })
      expect(said.getAttribute('role'), 'the fixed sentence is not in a live region').toBe('status')
      expect(failing.mock.calls.length, 'the chunk was not asked for again in place').toBeGreaterThanOrEqual(2)
      expect(screen.queryByTestId('refused-copy-offer')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Discard' }), 'a Discard is offered without the copy’s words').toBeNull()
      await sit(4)
      expect(copyKept(copy), 'a chunk that failed to load lost the copy').toBe(true)
      expectDurable(COPY_WORDS, 'while the offer could not load')
      sourceNeverGotTheCopy('while the offer could not load')

      // The member's way back: Try again, and this time the chunk loads.
      refusedCopyDoorLoaders.offer = real
      const tryAgain = screen.getByRole('button', { name: 'Try again' })
      tryAgain.focus()
      await act(async () => { fireEvent.click(tryAgain); await settleIdb(6) })
      const offer = await screen.findByTestId('refused-copy-offer', {}, { timeout: 5000 })
      expect(offer.textContent).toMatch(/kept on this device/i)
      expect((await screen.findByTestId('refused-copy-preview')).textContent).toContain(COPY_WORDS)
      expect(screen.queryByText(REFUSED_COPY_UNAVAILABLE)).toBeNull()
      expect(document.activeElement, 'Try again left focus on nothing').toBe(screen.getByTestId('refused-copy-reason'))
      expect(copyKept(copy)).toBe(true)

      // …and the offer it brought in works: the copy becomes its own note.
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save as a separate note' })); await settleIdb(6) })
      await sit(3)
      expect(server.forks, 'exactly one separate note was created').toHaveLength(1)
      expect(JSON.stringify(server.forks[0].bodyJson)).toContain(COPY_WORDS)
      expect(copyKept(copy), 'the copy entry was kept after its note was created').toBe(false)
      sourceNeverGotTheCopy('after Try again and Save as a separate note')
    } finally {
      refusedCopyDoorLoaders.offer = real
    }
  })

  describe('fix round 4 — the offer shows the words and speaks for itself (I-6, I-7)', () => {
    // A body with structure and a mark, so a flattened re-POST is visible as such.
    const RICH = doc(
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan H2' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [para('first point')] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'bold ', marks: [{ type: 'bold' }] }, { type: 'text', text: COPY_WORDS }] },
    )
    // A sentence only the SERVER says: it must never be found on the page.
    const SERVER_PHRASE = 'ZQ-SERVER-SENTENCE'
    const useClipboard = (writeText) => {
      Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { writeText } })
    }
    const offer = () => screen.findByTestId('refused-copy-offer')
    async function press(name) {
      const button = await screen.findByRole('button', { name })
      await act(async () => { fireEvent.click(button); await settleIdb(6) })
    }
    const flatOnly = (d) => d?.type === 'doc' && Array.isArray(d.content) && d.content.every((p) => (
      p.type === 'paragraph' && (p.content || []).every((t) => t.type === 'text' && t.text && !t.marks)))

    it('⛔ I-6: the offer shows the COPY’s own words (title, subtitle, body as plain text), never the note’s', async () => {
      await openOnRefusedCopy({ body: RICH })
      const preview = await screen.findByTestId('refused-copy-preview')
      for (const w of ['Thesis', 'copy subtitle', 'Plan H2', 'first point', COPY_WORDS]) expect(preview.textContent).toContain(w)
      expect(preview.textContent, 'the preview showed the note’s server text').not.toContain(SERVER_NOW)
      expect((await offer()).contains(preview), 'the preview is not part of the offer').toBe(true)
    })

    it('⛔ I-6: the Discard confirm shows the same words, and its own "Copy text" copies them', async () => {
      await openOnRefusedCopy()
      await press('Discard')
      const confirm = await screen.findByTestId('refused-copy-confirm')
      expect(confirm.textContent).toMatch(/can’t be undone/)
      expect(confirm.textContent, 'the confirm asks to delete words it does not show').toContain(COPY_WORDS)
      expect(confirm.textContent).toContain('copy subtitle')
      const writeText = vi.fn(() => Promise.resolve())
      useClipboard(writeText)
      await press('Copy text')
      expect(writeText).toHaveBeenCalledTimes(1)
      expect(writeText.mock.calls[0][0]).toContain(COPY_WORDS)
      expect(screen.getByRole('button', { name: 'Delete copy' }), 'copying ended the confirm').toBeTruthy()
    })

    it('"Copy text" puts the copy’s words on the clipboard, and says so', async () => {
      await openOnRefusedCopy({ body: RICH })
      const writeText = vi.fn(() => Promise.resolve())
      useClipboard(writeText)
      await press('Copy text')
      expect(writeText).toHaveBeenCalledTimes(1)
      const text = writeText.mock.calls[0][0]
      for (const w of ['Thesis', 'copy subtitle', 'Plan H2', 'first point', COPY_WORDS]) expect(text).toContain(w)
      expect(text).not.toContain(SERVER_NOW)
      expect((await offer()).textContent).toMatch(/the words are on your clipboard/i)
    })

    for (const [label, install] of [
      ['refuses', () => useClipboard(vi.fn(() => Promise.reject(new Error('NotAllowedError'))))],
      ['is missing', () => {}],
    ]) {
      it(`a clipboard that ${label} ⇒ the preview's words are SELECTED so they can be copied by hand, and the offer says so`, async () => {
        await openOnRefusedCopy()
        install()
        await press('Copy text')
        expect(window.getSelection().toString(), 'the words were not selected').toContain(COPY_WORDS)
        const text = (await offer()).textContent
        expect(text).toMatch(/the words are selected/i)
        // ⛔ Fix round 5 (wording ruling): the fallback does not assume a keyboard.
        expect(text).toMatch(/use your device’s copy command to copy them/i)
        expect(text, 'the fallback assumes a keyboard').not.toMatch(/ctrl|⌘|press/i)
      })
    }

    // ⛔⛔ Fix round 5 (review C-4) REVERSES round 4's last line here: the copy is KEPT.
    it('⛔ a CONTENT refusal (413) offers "Save as plain text": its re-POST body is flattened, nothing is PUT, the copy is KEPT', async () => {
      const copy = await openOnRefusedCopy({ status: 413, detail: SERVER_PHRASE, body: RICH })
      const o = await offer()
      expect(screen.queryByRole('button', { name: 'Save as a separate note' }), 'a retry that cannot succeed is offered').toBeNull()
      expect(o.textContent, 'the offer says a create that cannot succeed "tries again"').not.toMatch(/tries again/i)
      expect(o.textContent).toMatch(/save as plain text/i)
      update.mockClear()
      const putsBefore = server.puts.length
      await press('Save as plain text')
      await sit(3)
      expect(server.forks, 'exactly one separate note was created').toHaveLength(1)
      const created = server.forks[0]
      expect(created.title).toBe('Thesis (conflicted copy)')
      expect(created.subtitle).toBe('copy subtitle')
      expect(created.tags).toEqual(['sync-conflict'])
      expect(flatOnly(created.bodyJson), `the re-POST body was not flattened: ${JSON.stringify(created.bodyJson)}`).toBe(true)
      for (const w of ['Plan H2', 'first point', COPY_WORDS]) expect(JSON.stringify(created.bodyJson)).toContain(w)
      expect(update, 'a PUT went to the source note').not.toHaveBeenCalled()
      expect(server.puts).toHaveLength(putsBefore)
      sourceNeverGotTheCopy('after Save as plain text')
      expect(copyKept(copy), 'a plain save deleted the copy (C-4)').toBe(true)
      expect(screen.getByText(/saved as a separate note, as plain text/i)).toBeTruthy()
    })

    it('a 400 whose reason is the BODY (the create guard) is a content refusal too: "Save as plain text" is offered', async () => {
      await openOnRefusedCopy({
        status: 400,
        detail: 'This note has a piece of text the editor can\'t open (an empty or malformed text node), so it wasn\'t saved.',
      })
      expect(await screen.findByRole('button', { name: 'Save as plain text' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Save as a separate note' })).toBeNull()
      expect(document.body.textContent, 'the server’s sentence reached the page').not.toMatch(/it wasn.t saved/i)
    })

    it('⛔ a plain-text save refused AGAIN keeps the copy with its ORIGINAL words, still shown, still with "Copy text"', async () => {
      const copy = await openOnRefusedCopy({ status: 413, detail: SERVER_PHRASE, body: RICH })
      server.refuseCreate = 413
      server.refuseDetail = `${SERVER_PHRASE} again`
      await press('Save as plain text')
      await sit(2)
      const kept = outbox().find((e) => e.mutationId === copy.mutationId)
      expect(kept, 'a refused plain-text save lost the copy').toBeTruthy()
      expect(kept.patch.bodyJson, 'the stored copy lost its original words').toEqual(RICH)
      expect(server.forks).toHaveLength(0)
      expectDurable(COPY_WORDS, 'after a refused plain-text save')
      expect((await screen.findByTestId('refused-copy-preview')).textContent).toContain(COPY_WORDS)
      expect(screen.getByRole('button', { name: 'Copy text' })).toBeTruthy()
      const text = (await offer()).textContent
      expect(text).toMatch(/kept on this device/i)
      expect(text).toMatch(/plain text was refused too/i)
      expect(document.body.textContent, 'the server’s sentence reached the page').not.toContain(SERVER_PHRASE)
      sourceNeverGotTheCopy('after a refused plain-text save')
    })

    for (const [refusal, ours, plain] of [
      [{ status: 413, detail: SERVER_PHRASE }, /too large to be saved as its own note/i, true],
      [{ status: 400, detail: `${SERVER_PHRASE}: this note is too long to save as one page` }, /too large to be saved as its own note/i, true],
      [{ status: 400, detail: `${SERVER_PHRASE}: too many lists nested inside each other` }, /content the server can’t store/i, true],
      [{ status: 422, detail: SERVER_PHRASE }, /content the server can’t store/i, true],
      [{ status: 400, detail: `${SERVER_PHRASE}: subtitle too long` }, /couldn’t be saved as a separate note/i, false],
    ]) {
      it(`⛔ I-7: a ${refusal.status} ("${refusal.detail.slice(SERVER_PHRASE.length) || '…'}") shows the offer’s own sentence, never the server’s`, async () => {
        await openOnRefusedCopy(refusal)
        const text = (await offer()).textContent
        expect(text).toMatch(ours)
        expect(text).toMatch(/kept on this device/i)
        expect(text).toMatch(/copy text puts its words on your clipboard/i)
        expect(text).toMatch(/discard deletes the copy from this device/i)
        expect(document.body.textContent, 'the server’s sentence reached the page').not.toContain(SERVER_PHRASE)
        expect(Boolean(screen.queryByRole('button', { name: 'Save as plain text' })), 'the plain-text save is offered for this class').toBe(plain)
        expect(Boolean(screen.queryByRole('button', { name: 'Save as a separate note' }))).toBe(!plain)
      })
    }

    it('⛔ I-7: a re-POST refused again does not bring the server’s new sentence onto the page either', async () => {
      await openOnRefusedCopy()
      server.refuseCreate = 400
      server.refuseDetail = `${SERVER_PHRASE}: subtitle too long`
      await press('Save as a separate note')
      await sit(2)
      expect((await offer()).textContent).toMatch(/still couldn’t be saved/i)
      expect(document.body.textContent).not.toContain(SERVER_PHRASE)
    })

    it('"try again when you’re online" only after a NETWORK failure', async () => {
      const copy = await openOnRefusedCopy()
      server.down = true
      await press('Save as a separate note')
      await sit(2)
      expect(copyKept(copy)).toBe(true)
      expect((await offer()).textContent).toMatch(/try again when you’re online/i)
    })

    it('a failure that is NOT the network (409 from the create) says "try again later", never "when you’re online"', async () => {
      const copy = await openOnRefusedCopy()
      server.refuseCreate = 409
      await press('Save as a separate note')
      await sit(2)
      expect(copyKept(copy)).toBe(true)
      const text = (await offer()).textContent
      expect(text).toMatch(/try again later/i)
      expect(text).not.toMatch(/online/i)
    })

    it('⛔ focus moves INTO the Discard confirm, and "Keep it" returns it to the offer', async () => {
      await openOnRefusedCopy()
      const discard = await screen.findByRole('button', { name: 'Discard' })
      act(() => { discard.focus() })
      await press('Discard')
      const confirm = await screen.findByTestId('refused-copy-confirm')
      expect(confirm.contains(document.activeElement), `focus was left on ${document.activeElement?.outerHTML?.slice(0, 80)}`).toBe(true)
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep it' }))
      await press('Keep it')
      expect(document.activeElement, 'focus did not return to the offer').toBe(screen.getByRole('button', { name: 'Discard' }))
    })
  })

  describe('fix round 5 — a plain save never deletes, and the preview shows every word (C-4, I-8, M-18, M-19)', () => {
    // Every word here lives in a node ATTRIBUTE (or a link mark), never in a text node,
    // except the paragraph text around them. The copy's words still differ from the
    // server's, so a copy written over its source would show.
    const ATTRS = doc(
      { type: 'paragraph', content: [
        { type: 'text', text: 'Entry on ' }, { type: 'dateMention', attrs: { date: '2026-10-20' } },
        { type: 'text', text: ' at ' }, { type: 'inlineMath', attrs: { latex: 'R=2.5' } },
      ] },
      { type: 'paragraph', content: [{ type: 'text', text: 'see filing', marks: [{ type: 'link', attrs: { href: 'https://sec.gov/x' } }] }] },
      { type: 'blockMath', attrs: { latex: 'E = p q' } },
      { type: 'linkPreview', attrs: { url: 'https://ex.com/preview', title: 'NVDA earnings preview', description: 'Guide raised' } },
      { type: 'attachmentChip', attrs: { name: 'plan.xlsx', href: '/a/1' } },
      { type: 'image', attrs: { src: '/img/1.png', alt: 'NVDA daily chart' } },
      { type: 'tradeCanvas', attrs: { board: { items: [], levels: [], edges: [] }, searchText: 'Trade-plan canvas · NVDA long stop 121.50 target 140' } },
      para(COPY_WORDS),
    )
    const ATTR_WORDS = [
      '2026-10-20', 'R=2.5', 'see filing (https://sec.gov/x)', 'E = p q', 'NVDA earnings preview', 'Guide raised',
      'https://ex.com/preview', 'plan.xlsx', 'NVDA daily chart', 'NVDA long stop 121.50 target 140', COPY_WORDS,
    ]
    const offer = () => screen.findByTestId('refused-copy-offer')
    async function press(name) {
      const button = await screen.findByRole('button', { name })
      await act(async () => { fireEvent.click(button); await settleIdb(6) })
    }
    const focusIsLive = (label) => {
      const el = document.activeElement
      expect(el && el !== document.body && el.isConnected, `${label}: focus fell to ${el?.tagName || 'nothing'}`).toBe(true)
    }

    it('⛔ I-8: the preview, Copy text and the plain-text note carry every word held in an attribute', async () => {
      await openOnRefusedCopy({ status: 413, detail: 'x', body: ATTRS })
      const preview = await screen.findByTestId('refused-copy-preview')
      for (const w of ATTR_WORDS) expect(preview.textContent, `the preview dropped "${w}"`).toContain(w)
      const writeText = vi.fn(() => Promise.resolve())
      Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { writeText } })
      await press('Copy text')
      for (const w of ATTR_WORDS) expect(writeText.mock.calls[0]?.[0], `Copy text dropped "${w}"`).toContain(w)
      await press('Save as plain text')
      await sit(3)
      expect(server.forks).toHaveLength(1)
      const created = JSON.stringify(server.forks[0].bodyJson)
      for (const w of ATTR_WORDS) expect(created, `the plain-text note dropped "${w}"`).toContain(w)
    })

    it('⛔ I-8: a canvas-only copy shows the plan’s words, never "This copy has no text."', async () => {
      await openOnRefusedCopy({
        status: 413, detail: 'x',
        body: doc({ type: 'tradeCanvas', attrs: { board: { items: [], levels: [], edges: [] }, searchText: 'Trade-plan canvas · NVDA long stop 121.50' } }),
      })
      const preview = await screen.findByTestId('refused-copy-preview')
      expect(preview.textContent).toContain('NVDA long stop 121.50')
      expect(preview.textContent).not.toMatch(/has no text/i)
    })

    it('⛔⛔ C-4: after a plain save lands the copy stays with its ORIGINAL body, is offered as plain-saved, survives a reopen, and only Discard removes it', async () => {
      const copy = await openOnRefusedCopy({ status: 413, detail: 'x', body: ATTRS })
      await press('Save as plain text')
      await sit(3)
      expect(server.forks).toHaveLength(1)
      const kept = outbox().find((e) => e.mutationId === copy.mutationId)
      expect(kept, 'the plain save deleted the copy').toBeTruthy()
      expect(kept.patch.bodyJson, 'the stored copy lost its ORIGINAL body').toEqual(ATTRS)
      const text = (await offer()).textContent
      expect(text).toMatch(/plain-text version of this copy is now its own note/i)
      expect(text).toMatch(/original copy, with everything plain text can’t hold, is still kept on this device until you discard it/i)
      expect(screen.queryByRole('button', { name: 'Save as plain text' }), 'a second plain save is offered').toBeNull()
      expect(screen.queryByRole('button', { name: 'Save as a separate note' })).toBeNull()
      expect((await screen.findByTestId('refused-copy-preview')).textContent).toContain('NVDA daily chart')
      await reopen()
      await sit(3)
      expect(server.forks, 'the plain-saved copy was posted again').toHaveLength(1)
      expect(copyKept(copy), 'the plain-saved copy did not survive a reopen').toBe(true)
      expect((await offer()).textContent).toMatch(/still kept on this device until you discard it/i)
      await press('Discard')
      expect((await screen.findByTestId('refused-copy-confirm')).textContent).toMatch(/plain text can’t hold/i)
      await press('Delete copy')
      await sit(2)
      expect(copyKept(copy), 'a confirmed Discard kept the copy').toBe(false)
      expect(screen.queryByTestId('refused-copy-offer')).toBeNull()
      sourceNeverGotTheCopy('after a plain save and Discard')
    })

    for (const status of [400, 422]) {
      it(`⛔ M-18: a ${status} with no detail is not a content refusal — no "Save as plain text"`, async () => {
        await openOnRefusedCopy({ status, detail: null })
        await offer()
        expect(screen.queryByRole('button', { name: 'Save as plain text' }), 'a detail-less refusal took the plain path').toBeNull()
        expect(screen.getByRole('button', { name: 'Save as a separate note' })).toBeTruthy()
        expect((await offer()).textContent).not.toMatch(/tries again/i)
      })
    }

    it('the `other` class never says the save "tries again" for a refusal a retry cannot fix, and says what to do instead', async () => {
      await openOnRefusedCopy({ status: 400, detail: 'subtitle too long' })
      const text = (await offer()).textContent
      expect(text).not.toMatch(/tries again/i)
      expect(text).toMatch(/paste them into a new note/i)
    })

    it('⛔ M-19: the live region exists, empty, BEFORE the message, and the SAME region then carries it; focus stays on a live element', async () => {
      await openOnRefusedCopy()
      const region = await screen.findByTestId('copy-saved-status')
      expect(region.getAttribute('role')).toBe('status')
      expect(region.textContent, 'the live region arrived already holding a message').toBe('')
      const save = await screen.findByRole('button', { name: 'Save as a separate note' })
      act(() => { save.focus() })
      await press('Save as a separate note')
      await sit(3)
      expect(screen.getByTestId('copy-saved-status'), 'the live region was replaced, not updated').toBe(region)
      expect(region.textContent).toMatch(/saved as a separate note: “Thesis \(conflicted copy\)”/i)
      focusIsLive('after a successful save')
    })

    it('⛔ M-19: focus stays on a live element after a confirmed Discard, and after a plain save', async () => {
      await openOnRefusedCopy({ status: 413, detail: 'x' })
      const plain = await screen.findByRole('button', { name: 'Save as plain text' })
      act(() => { plain.focus() })
      await press('Save as plain text')
      await sit(3)
      focusIsLive('after a plain save')
      expect((await offer()).contains(document.activeElement), 'focus left the offer that is still on screen').toBe(true)
      await press('Discard')
      await press('Delete copy')
      await sit(2)
      expect(screen.queryByTestId('refused-copy-offer')).toBeNull()
      focusIsLive('after a confirmed Discard')
    })

    it('⛔ M-19: the offer keeps ONE status line when the confirm swaps in (a note on it is not re-mounted)', async () => {
      await openOnRefusedCopy()
      const status = (await offer()).querySelector('[role="status"]')
      expect(status, 'the offer has no status line').toBeTruthy()
      await press('Discard')
      await screen.findByTestId('refused-copy-confirm')
      expect((await offer()).querySelector('[role="status"]'), 'the confirm mounted a new status line').toBe(status)
    })
  })
})

describe('I-A · fix round 4 — review M-12: a cell cannot write into the NEXT cell’s server', () => {
  // ⚠️ These cells run in order, in pairs: the first leaves a request in flight, the
  // second creates its own server and only then lets that request land.
  let leftPut = null
  let leftFork = null

  it('(a) a cell ends with a PUT still in flight', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    let release
    server.holdPuts = new Promise((r) => { release = r })
    await openTheNote()
    await sit(2)
    await typeAtEnd(' M12-left-in-flight')
    expect(await until(() => server.inflight > 0, { max: 80 }), 'precondition: a PUT is in flight').toBe(true)
    leftPut = { release, owner: server }
  })

  it('(b) that PUT, landing in the next cell, changes only the cell that sent it', async () => {
    expect(leftPut, 'precondition: cell (a) ran first').toBeTruthy()
    server = makeServer({ body: doc(para('M12 the next cell’s note')), updatedAt: T0 })
    const before = JSON.stringify({ body: server.body, title: server.title, updatedAt: server.updatedAt })
    leftPut.release()
    await act(async () => { await settleIdb(8) })
    await tick(50)
    expect(server.puts, 'the leftover PUT reached the next cell’s server').toHaveLength(0)
    expect(JSON.stringify({ body: server.body, title: server.title, updatedAt: server.updatedAt }), 'the next cell’s note changed').toBe(before)
    expect(JSON.stringify(leftPut.owner.body), 'control: the leftover PUT did land, in the cell that sent it').toContain('M12-left-in-flight')
  })

  it('(c) a cell ends with a separate-note save still in flight (its source read is held)', async () => {
    server = makeServer({ body: doc(para('M12 source')), updatedAt: T0 })
    factory.open(ACCOUNT_DB)
    await act(async () => { await settleIdb(2) })
    const { copyEntryFor } = await import('./noteCopy')
    const copy = copyEntryFor({ noteId: 'n1', words: { title: 'Thesis', subtitle: '', bodyJson: doc(para('M12-fork-words')) }, sessionId: 's-away' })
    factory.databases.get(ACCOUNT_DB).seed('outbox', {
      ...copy, permanent: true, copyRefused: { status: 400, error: 'x', detail: 'title too long' }, lastStatus: 400,
    })
    await openTheNote()
    await sit(2)
    let release
    server.holdReads = new Promise((r) => { release = r })
    const save = await screen.findByRole('button', { name: 'Save as a separate note' })
    await act(async () => { fireEvent.click(save); await settleIdb(6) })
    expect(await until(() => server.inflight > 0, { max: 40 }), 'precondition: the save is in flight').toBe(true)
    leftFork = { release, owner: server }
  })

  it('(d) that save, finishing in the next cell, creates its note only in the cell that sent it', async () => {
    expect(leftFork, 'precondition: cell (c) ran first').toBeTruthy()
    server = makeServer({ body: doc(para('M12 the next cell’s note')), updatedAt: T0 })
    leftFork.release()
    await act(async () => { await settleIdb(8) })
    await tick(50)
    expect(server.forks, 'the leftover save created a note in the next cell’s server').toHaveLength(0)
    expect(leftFork.owner.forks.map((f) => JSON.stringify(f.bodyJson)).join(), 'control: the leftover save did land, in the cell that sent it').toContain('M12-fork-words')
  })
})

describe('I-A · fix round 2 — review M-8: a body-less (legacy) crash draft', () => {
  it('a Restore of a draft that carries only a TITLE writes that title to a durable layer before the tab closes', async () => {
    const TITLE_WORDS = 'Renamed before the crash K-title'
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.down = true
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      title: TITLE_WORDS, subtitle: '', savedAt: Date.now() - 60_000, sessionId: 's-legacy',
    }))
    await openTheNote()
    await sit(2)
    await pressRestore()
    expect(screen.getByPlaceholderText('Title').value, 'precondition: the draft’s title is on the page').toBe(TITLE_WORDS)
    await tick(400)
    await closeTheTab()
    expectDurable(TITLE_WORDS, 'M-8 after the tab closed')
  })
})
