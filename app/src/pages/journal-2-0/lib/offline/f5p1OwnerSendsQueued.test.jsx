/**
 * ⭐⭐ D3 / F5P-1 — QUEUED WORDS LEAVE WHILE THE MEMBER SITS ON THE NOTE.
 *
 * THE EXACT F5P-1 SCENARIO (`docs/notebook/q1-product-followups.md`): the member
 * queued words offline, left the note, and came back to it — and sits there.
 * Nobody types. The real editor and the real sweep (excluding the note the editor
 * owns, as NotebookTab mounts it) run against an in-memory IndexedDB and a
 * compare-and-set server.
 *
 * ⛔ The single writer is the EDITOR: the sweep's send/fork throw if called.
 * ⛔ Each server state is a different door the member met while away — nothing,
 * a metadata door, an append door, a second writer — and each must end with the
 * words on the server, the queue empty, and at most the ONE fork a genuine
 * second writer earns. A blocked entry must still wait for the member.
 *
 * Lands WITH the editor change (E-1 adopt / E-3 settle the owner's fork),
 * `docs/notebook/f5-fixes-2026-09-23.md` §B. Against the editor without it, the
 * four send cells are RED: the words never leave.
 *
 * ⛔⛔ Fix round 1 (§C) adds the member ACTING while the owner works: typing before
 * recovery resolves, with a save on the wire, during the fork's create request,
 * during the settle itself, a Restore clicked mid-save — plus a view that refuses
 * the words (N6). All seven are RED on `fe4e278bc`; each guard's own mutation is
 * recorded in §C.4.
 *
 * ⛔⛔ Fix round 2 (§D) adds typing ACROSS the view swap (R1), the editor's own
 * S1 gate isolated from the store's (R2), and a record poisoned before A-1 that
 * neither adoption nor Restore may use as a base (N4).
 * Fix round 3 (§E): only a base NEWER than the entry is refused. A base OLDER
 * than the entry is adopted and Restored exactly as at `fe4e278bc`.
 */
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb } from './__fixtures__/fakeIndexedDb'
import { createLockManager } from './__fixtures__/fakeWebLocks'
import { __resetNotebookConnections } from './useDurableNote'
import { useOutboxDrain } from './useOutboxDrain'
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import { dbNameFor } from './notebookDb'
import { drainOutbox, SKIPPED } from './outboxDrain'
import { isNoteOwned, noteOwnerLockName } from './noteOwnerLock'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const T0 = '2026-09-23T09:00:00.000000+00:00'
const T1 = '2026-09-23T09:05:00.000000+00:00'
const T2 = '2026-09-23T09:07:00.000000+00:00'
const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const doc = (...blocks) => ({ type: 'doc', content: blocks })
const ONLINE = para('typed online.')
const SENTENCE = 'typed offline while away - THIS must reach the server.'
const MINE = doc(ONLINE, para(SENTENCE))
const WIDGET = { type: 'widgetEmbed', attrs: { widgetId: 'w-1', capturedAt: '2026-09-23T09:04:00Z', searchText: 'NVDA' } }

// ── a server with compare-and-set, the only axis that matters ───────────────
let server
function makeServer({ body, updatedAt }) {
  let rev = 0
  const s = {
    title: 'Thesis', subtitle: '', body, updatedAt, puts: [], forks: [],
    // ⭐ D3b fix round 2 (NN-2): the metadata a door can move, so a rail can say
    // whether the editor left it alone.
    folderId: null, tags: [],
    note: () => ({
      id: 'n1', title: s.title, subtitle: s.subtitle, folderId: s.folderId, ticker: null, tags: s.tags,
      heroImageUrl: null, isFavorite: false, bodyJson: s.body, updatedAt: s.updatedAt,
    }),
    stamp: () => { rev += 1; s.updatedAt = `2026-09-23T09:10:${String(10 + rev).padStart(2, '0')}.000000+00:00` },
  }
  return s
}
// ⭐ Fix round 1: a PUT can be HELD on the wire, and a create request too, so a
// rail can put a member's keystroke exactly where the review said words were lost.
let putGate = null
let createGate = null
let createsStarted = 0
const update = vi.fn(async (patch) => {
  if (putGate) await putGate
  server.puts.push(patch)
  if (patch.baseUpdatedAt && patch.baseUpdatedAt !== server.updatedAt) {
    const e = new Error('note changed — refresh and retry'); e.status = 409; throw e
  }
  if (patch.bodyJson) server.body = patch.bodyJson
  if ('title' in patch) server.title = patch.title
  // ⭐ D3b fix round 1 (b): the real `update_note` writes the subtitle it is sent,
  // so a fake that ignored it could not tell a cleared subtitle from a dropped one.
  if ('subtitle' in patch) server.subtitle = patch.subtitle ?? ''
  // ⭐ D3b fix round 2 (NN-2): metadata is applied if a send ever carries it, so
  // an editor that sent folder or tags would visibly move them.
  if ('folderId' in patch) server.folderId = patch.folderId
  if ('tags' in patch) server.tags = patch.tags
  server.stamp()
  return server.note()
})
let mountedNote = null
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: mountedNote, isLoading: false, error: null, update, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u42', role: 'member' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('../noteCreation', () => ({
  createNoteViaApi: vi.fn(async (args) => {
    createsStarted += 1
    if (createGate) await createGate
    server.forks.push(args)
    return { id: 'fork-1', ...args }
  }),
}))

// ⭐ Fix round 1: a gate AFTER the owner's fork has settled the STORE and before
// the editor decides whether to `markSynced`, so a keystroke can land exactly in
// the window the editor's post-settle re-read exists for. The real function
// runs; only its return is held.
let afterSettleGate = null
let settlesReached = 0
vi.mock('./useDurableNote', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    settleOwnerFork: async (...args) => {
      const settled = await real.settleOwnerFork(...args)
      settlesReached += 1
      if (afterSettleGate) await afterSettleGate
      return settled
    },
  }
})

const ACCOUNT_DB = dbNameFor('u42')
let factory
const sweepSend = vi.fn(async () => { throw new Error('the sweep must never send the note the editor owns') })
const sweepFork = vi.fn(async () => { throw new Error('the sweep must never fork the note the editor owns') })

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
  update.mockClear(); sweepSend.mockClear(); sweepFork.mockClear()
  putGate = null; createGate = null; createsStarted = 0
  afterSettleGate = null; settlesReached = 0
  __resetNotebookConnections()
  factory = createFakeIndexedDbFactory()
  globalThis.indexedDB = factory
  installLocks()
  global.fetch = vi.fn((url) => {
    if (String(url) === '/api/j2/notes/n1') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: server.note() }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  localStorage.clear()
  delete globalThis.indexedDB
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: undefined })
})

/** The member typed offline on the note, left it, and the queue holds their words. */
async function queuedWhileAway({
  permanent = false, serverBase = null, baseUpdatedAt = T0,
  // ⭐ D3b fix round 1 (b): the words' own title/subtitle, and a record with NO
  // last-known server copy (the shape whose Restore base is revision-only).
  title = 'Thesis', subtitle = '', withServerBase = true,
} = {}) {
  factory.open(ACCOUNT_DB)
  await act(async () => { await settleIdb(2) })
  const store = factory.databases.get(ACCOUNT_DB)
  store.seed('notes', {
    noteId: 'n1', title, subtitle, bodyJson: MINE, dirty: 1, generation: 5,
    sessionId: 's-away', localSavedAt: 1000, baseUpdatedAt,
    ...(withServerBase
      ? { serverBase: serverBase || { title: 'Thesis', subtitle: '', bodyJson: doc(ONLINE), updatedAt: T0 } }
      : {}),
  })
  store.seed('outbox', {
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
    patch: { title, subtitle, bodyJson: MINE },
    baseUpdatedAt, generation: 5, sessionId: 's-away', queuedAt: 1000,
    ...(permanent ? { permanent: true, lastError: 'gone', lastStatus: 404 } : {}),
  })
}

/** What NotebookTab renders: the editor, and the sweep excluding the note it owns. */
function Tab({ Editor }) {
  useOutboxDrain({ accountId: 'u42', excludeNoteId: 'n1', send: sweepSend, fork: sweepFork })
  return <Editor noteId="n1" onBack={() => {}} />
}

async function returnToTheNote() {
  mountedNote = server.note()
  const mod = await import('../../components/notebook/NoteEditorPage')
  render(<MemoryRouter><Tab Editor={mod.default} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
}
/** Past the durable window, the 800ms autosave, a 409 round trip and its 50ms
 *  retry — `rounds` times half a second. */
async function sit(rounds = 12) {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { vi.advanceTimersByTime(500); await settleIdb(6) })
  }
}
async function returnToTheNoteAndSit() {
  await returnToTheNote()
  // ⛔ NOBODY TYPES.
  await sit(12)
}

/** The member's own keystrokes, at the end of the body — a real editor
 *  transaction, so the editor's own autosave and durable paths run. */
async function typeInBody(text) {
  const dom = await waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el
  })
  await act(async () => { dom.editor.chain().focus('end').insertContent(text).run(); await settleIdb(2) })
}

/** Hold the outbox READ that `recover()` makes, so the member can act before
 *  recovery resolves. Returns the release. */
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
      const s = inner(n)
      return {
        ...s,
        getAll: () => {
          const req = { result: [] }
          gate.then(() => { const r = s.getAll(); r.onsuccess = () => { req.result = r.result; req.onsuccess?.() } })
          return req
        },
      }
    }
    return tx
  }
  return () => release()
}
function holdPuts() {
  let release
  putGate = new Promise((r) => { release = r })
  return () => { putGate = null; release() }
}
function holdCreates() {
  let release
  createGate = new Promise((r) => { release = r })
  return () => { createGate = null; release() }
}

/** The view refuses content once, as `setContent` does when the view is not
 *  mounted. TipTap rebuilds `editor.commands` on every read, so the refusal is
 *  planted in the raw command table it is built from. Returns the restore. */
async function viewRefusesContent() {
  const dom = await waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el
  })
  const raw = dom.editor.commandManager.rawCommands
  const orig = raw.setContent
  raw.setContent = () => { throw new Error('view not mounted') }
  return () => { raw.setContent = orig }
}

/** Is `text` anywhere a member could get it back from? The server, a sibling,
 *  the queue, the durable record, or the crash draft. */
function survives(text) {
  const rec = record()
  return [
    JSON.stringify(server.body), server.title,
    ...server.forks.map((f) => JSON.stringify(f)),
    ...outbox().map((e) => JSON.stringify(e.patch)),
    JSON.stringify(rec?.bodyJson ?? null), rec?.title ?? '',
    localStorage.getItem('uct.j2.notedraft.n1') || '',
  ].some((b) => String(b).includes(text))
}

const outbox = () => factory.databases.get(ACCOUNT_DB)?.dump('outbox') ?? []
const record = () => (factory.databases.get(ACCOUNT_DB)?.dump('notes') ?? []).find((r) => r.noteId === 'n1')
const serverText = () => JSON.stringify(server.body)
const hasWidget = () => (server.body?.content || []).some((n) => n.type === 'widgetEmbed')

describe('F5P-1 — queued words leave while the member sits on the note', () => {
  it('nothing moved on the server: the owner sends them, no banner, queue settled', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    await queuedWhileAway()
    await returnToTheNoteAndSit()
    expect(serverText(), 'the queued sentence reached the server').toContain(SENTENCE)
    expect(screen.queryByText(/Unsaved changes from a previous session/i)).toBeNull()
    expect(outbox()).toHaveLength(0)
    expect(record()?.dirty).toBe(0)
    expect(server.forks).toHaveLength(0)
    expect(sweepSend).not.toHaveBeenCalled()
  })

  it('a metadata door moved it while away: 409, rebase, sent — no fork', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T1 })
    await queuedWhileAway()
    await returnToTheNoteAndSit()
    expect(serverText()).toContain(SENTENCE)
    expect(server.puts[0]?.baseUpdatedAt, 'the first send is on the words’ own base').toBe(T0)
    expect(outbox()).toHaveLength(0)
    expect(server.forks).toHaveLength(0)
    expect(sweepSend).not.toHaveBeenCalled()
  })

  it('an append door added a widget while away: merged — sentence AND widget survive, no fork', async () => {
    server = makeServer({ body: doc(ONLINE, WIDGET), updatedAt: T1 })
    await queuedWhileAway()
    await returnToTheNoteAndSit()
    expect(serverText()).toContain(SENTENCE)
    expect(hasWidget(), 'the captured widget was dropped').toBe(true)
    expect(outbox()).toHaveLength(0)
    expect(record()?.dirty).toBe(0)
    expect(server.forks).toHaveLength(0)
    expect(sweepSend).not.toHaveBeenCalled()
  })

  it('a second writer rewrote it while away: exactly ONE fork, never clobbered, queue settled', async () => {
    server = makeServer({ body: doc(para('rewritten on another device')), updatedAt: T1 })
    await queuedWhileAway()
    await returnToTheNoteAndSit()
    expect(serverText(), 'the other device’s words were overwritten').toContain('rewritten on another device')
    expect(serverText()).not.toContain(SENTENCE)
    expect(server.forks, 'the member’s words must be preserved in exactly one sibling').toHaveLength(1)
    expect(JSON.stringify(server.forks[0].bodyJson)).toContain(SENTENCE)
    expect(outbox(), 'a settled fork leaves nothing for the sweep to fork again').toHaveLength(0)
    expect(sweepFork).not.toHaveBeenCalled()
  })

  it('a BLOCKED entry is not auto-sent — the member is asked, as before', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    await queuedWhileAway({ permanent: true })
    await returnToTheNoteAndSit()
    expect(server.puts).toHaveLength(0)
    expect(outbox()).toHaveLength(1)
  })
})

/** The banner path, still used for copies the owner must not send by itself. */
async function restoreThenType() {
  const restore = await screen.findByRole('button', { name: 'Restore' })
  await act(async () => { fireEvent.click(restore); await settleIdb(6) })
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { vi.advanceTimersByTime(500); await settleIdb(6) })
  }
  // One keystroke after the Restore — the moment the measured clobber happened.
  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Thesis!' } })
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { vi.advanceTimersByTime(500); await settleIdb(6) })
  }
}

describe('D3 — Restore never overwrites a server that moved, and never drops its appends', () => {
  it('⛔⛔ Restore after a second writer, then a keystroke: ONE fork, the other device’s words kept', async () => {
    server = makeServer({ body: doc(para('rewritten on another device')), updatedAt: T1 })
    await queuedWhileAway({ permanent: true })          // blocked ⇒ the banner, not adoption
    await returnToTheNoteAndSit()
    await restoreThenType()
    expect(serverText(), 'the other device’s words were overwritten').toContain('rewritten on another device')
    expect(server.forks).toHaveLength(1)
    expect(JSON.stringify(server.forks[0].bodyJson)).toContain(SENTENCE)
  })

  it('⛔⛔ Restore after an append door, then a keystroke: the words AND the widget survive, no fork', async () => {
    server = makeServer({ body: doc(ONLINE, WIDGET), updatedAt: T1 })
    await queuedWhileAway({ permanent: true })
    await returnToTheNoteAndSit()
    await restoreThenType()
    expect(serverText()).toContain(SENTENCE)
    expect(hasWidget(), 'the captured widget was dropped').toBe(true)
    expect(server.forks).toHaveLength(0)
  })
})

describe('fix round 1 — adoption and the owner’s fork never lose what the member is doing', () => {
  it('⛔⛔ S2-A: words typed BEFORE recovery resolves are not overwritten — the queued words are offered, both survive', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    await queuedWhileAway()
    const release = holdRecovery()
    await returnToTheNote()
    await typeInBody(' K0-typed-before-recovery')
    release()
    await sit(12)
    expect(survives('K0-typed-before-recovery'), 'the member’s keystrokes were lost').toBe(true)
    expect(survives(SENTENCE), 'the queued words were lost').toBe(true)
    expect(server.forks).toHaveLength(0)
  })

  it('⛔⛔ S2-B: a save ON THE WIRE when recovery resolves is never raced — nothing is saved over it', async () => {
    server = makeServer({ body: doc(ONLINE, WIDGET), updatedAt: T0 })
    await queuedWhileAway()
    const releaseRecovery = holdRecovery()
    const releasePuts = holdPuts()
    await returnToTheNote()
    await typeInBody(' K0-on-the-wire')
    await sit(2)                                            // the 800ms autosave fires; its PUT is held
    expect(update.mock.calls.length, 'precondition: K0’s save is on the wire').toBeGreaterThanOrEqual(1)
    releaseRecovery()
    await act(async () => { await settleIdb(8) })           // recovery resolves while K0 is in flight
    releasePuts()
    await sit(12)
    expect(serverText(), 'the member’s saved words were overwritten').toContain('K0-on-the-wire')
    expect(hasWidget(), 'the note’s own block was dropped').toBe(true)
    expect(survives(SENTENCE), 'the queued words were lost').toBe(true)
  })

  // ⭐ The two cells above each trip BOTH halves of the S2 gate (typing marks the
  // note edited AND schedules a save), so neither can say which half did the
  // work. These two can: each isolates one half.
  it('⛔⛔ S2-A′: an edit since hydration is enough — even with its save LANDED, the queued words are offered, not adopted', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    await queuedWhileAway()
    const release = holdRecovery()
    await returnToTheNote()
    await typeInBody(' K0-saved-before-recovery')
    await sit(4)                                            // the autosave fires and LANDS
    expect(serverText(), 'precondition: K0’s save landed').toContain('K0-saved-before-recovery')
    release()
    await sit(12)
    expect(await screen.findByRole('button', { name: 'Restore' }), 'the queued words were not offered').toBeTruthy()
    expect(server.forks, 'the queued words were put over the member’s edit and forked').toHaveLength(0)
    expect(document.querySelector('.ProseMirror')?.textContent).toContain('K0-saved-before-recovery')
    expect(survives(SENTENCE), 'the queued words were lost').toBe(true)
  })

  it('⛔⛔ S2-B (Restore): a Restore clicked while the member’s own save is on the wire WAITS for it — nothing is saved over it', async () => {
    server = makeServer({ body: doc(ONLINE, WIDGET), updatedAt: T0 })
    await queuedWhileAway({ permanent: true })          // blocked ⇒ the banner
    await returnToTheNoteAndSit()
    const releasePuts = holdPuts()
    await typeInBody(' K0-on-the-wire-at-restore')
    await sit(2)                                            // its autosave fires; the PUT is held
    const sent = update.mock.calls.length
    expect(sent, 'precondition: K0’s save is on the wire').toBeGreaterThanOrEqual(1)
    const restore = await screen.findByRole('button', { name: 'Restore' })
    await act(async () => { fireEvent.click(restore); await settleIdb(6) })
    releasePuts()
    await sit(12)
    expect(serverText(), 'the member’s own saved words were overwritten').toContain('K0-on-the-wire-at-restore')
    expect(hasWidget(), 'the note’s own block was dropped').toBe(true)
    expect(survives(SENTENCE), 'the restored words were lost').toBe(true)
  })

  it('⛔ N6: when the view cannot take the queued words they are OFFERED — never passed off as adopted while still queued', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    await queuedWhileAway()
    const release = holdRecovery()
    await returnToTheNote()
    const restoreView = await viewRefusesContent()
    release()
    await sit(4)
    restoreView()
    expect(await screen.findByRole('button', { name: 'Restore' }), 'the words were neither adopted nor offered').toBeTruthy()
    expect(outbox().map((e) => JSON.stringify(e.patch)).join(''), 'the queue lost the words').toContain(SENTENCE)
  })

  it('⛔⛔ S1: words typed while the sibling is being created are never settled away', async () => {
    server = makeServer({ body: doc(para('rewritten on another device')), updatedAt: T1 })
    await queuedWhileAway()
    const releaseCreates = holdCreates()
    await returnToTheNote()
    await sit(4)                                            // adopt → 409 → reconcile → create (held)
    expect(createsStarted, 'precondition: the sibling is being created').toBe(1)
    await typeInBody(' K-typed-during-the-fork')
    releaseCreates()
    await sit(12)
    expect(survives('K-typed-during-the-fork'), 'the keystrokes typed during the fork were lost').toBe(true)
    expect(serverText(), 'the other device’s words were overwritten').toContain('rewritten on another device')
    expect(JSON.stringify(server.forks[0]?.bodyJson)).toContain(SENTENCE)
  })

  it('⛔⛔ S1′: a keystroke during the owner’s settle is on top of the server copy — its snapshot and draft survive, even offline', async () => {
    server = makeServer({ body: doc(para('rewritten on another device')), updatedAt: T1 })
    await queuedWhileAway()
    let releaseSettle
    afterSettleGate = new Promise((r) => { releaseSettle = r })
    await returnToTheNote()
    await sit(6)                                            // adopt → 409 → fork → the store settles; the editor waits
    expect(settlesReached, 'precondition: the store settled, the editor has not decided').toBe(1)
    const releasePuts = holdPuts()                          // the member's next save cannot leave
    await typeInBody(' K2-typed-during-the-settle')
    // Released with NO clock movement: the keystroke's snapshot is still inside
    // the durable writer's coalescing window when the editor decides — the
    // window its post-settle re-read exists for.
    await act(async () => { afterSettleGate = null; releaseSettle(); await settleIdb(6) })
    await sit(12)
    expect(survives('K2-typed-during-the-settle'), 'the keystroke typed during the settle was lost').toBe(true)
    releasePuts()
    await sit(1)
  })
})

describe('fix round 2 — the editor’s own S1 gate, and a base the queued entry disagrees with', () => {
  it('⛔⛔ R2: a keystroke still inside the durable window when the sibling lands is NOT settled away — the editor’s gate alone', async () => {
    // The store gate cannot see this keystroke: its durable write has not
    // happened yet, so the record still equals what was forked. Only the
    // editor's check of its own view stands between it and the settle.
    server = makeServer({ body: doc(para('rewritten on another device')), updatedAt: T1 })
    await queuedWhileAway()
    const releaseCreates = holdCreates()
    await returnToTheNote()
    await sit(4)                                            // adopt → 409 → reconcile → create (held)
    expect(createsStarted, 'precondition: the sibling is being created').toBe(1)
    await typeInBody(' K-inside-the-durable-window')
    // Released with NO clock movement: the keystroke's durable write is still
    // pending when the editor decides whether to settle.
    await act(async () => { releaseCreates(); await settleIdb(6) })
    await sit(12)
    expect(survives('K-inside-the-durable-window'), 'the keystroke was settled away').toBe(true)
    expect(serverText(), 'the other device’s words were overwritten').toContain('rewritten on another device')
  })

  it('⛔⛔ R1: typing ACROSS the view swap — words typed during the create request survive the next keystroke on the new view', async () => {
    // The editor gate refuses the settle (the view moved), and the sibling does
    // not hold K. K's durable write is still inside the writer's window when the
    // view is swapped to the server copy; the member's NEXT keystroke schedules
    // `fresh+K2`, and the writer keeps only its newest snapshot. Without a flush
    // before the swap, K is superseded before it is ever written — and the draft
    // that held it is overwritten by the same keystroke.
    server = makeServer({ body: doc(para('rewritten on another device')), updatedAt: T1 })
    await queuedWhileAway()
    const releaseCreates = holdCreates()
    await returnToTheNote()
    await sit(4)                                            // adopt → 409 → reconcile → create (held)
    expect(createsStarted, 'precondition: the sibling is being created').toBe(1)
    await typeInBody(' K-before-the-swap')
    await act(async () => { releaseCreates(); await settleIdb(6) })   // no clock movement
    const releasePuts = holdPuts()                          // what is on screen now cannot leave
    await typeInBody(' K2-after-the-swap')                  // still inside K's durable window
    await sit(12)
    expect(survives('K-before-the-swap'), 'the words typed during the fork were superseded before they were written').toBe(true)
    expect(document.querySelector('.ProseMirror')?.textContent).toContain('K2-after-the-swap')
    expect(serverText(), 'the other device’s words were overwritten').toContain('rewritten on another device')
    releasePuts()
    await sit(1)
  })

  // A record written by the settle BEFORE A-1: its base is `acked@landed` (T1,
  // already holding the door's widget) while its entry sits on T0, where the
  // words were really written. Neither door may use that base.
  const POISONED_BASE = { title: 'Thesis', subtitle: '', bodyJson: doc(ONLINE, WIDGET), updatedAt: T1 }

  it('⛔⛔ N4: a poisoned record is OFFERED, never adopted — nobody types, and the widget stays on the server', async () => {
    server = makeServer({ body: doc(ONLINE, WIDGET), updatedAt: T1 })
    await queuedWhileAway({ serverBase: POISONED_BASE })
    await returnToTheNoteAndSit()
    expect(hasWidget(), 'the queued body was adopted on the poisoned base and sent over the widget').toBe(true)
    expect(await screen.findByRole('button', { name: 'Restore' }), 'the words were not offered').toBeTruthy()
    expect(survives(SENTENCE)).toBe(true)
  })

  it('⛔⛔ N4: Restore of a poisoned record never adopts on its base — the Restore itself does not drop the widget', async () => {
    // Blocked, so the banner appears whatever `adopt` says, and only Restore's
    // own use of the base is under test.
    // ⚰️ This said Restore then took a direct PUT that a later keystroke could
    // turn into an overwrite — true until D3b (wave 6): Restore now sends on the
    // ENTRY's revision with an unknown body and forks (f5-fixes §F.2; the
    // keystroke cells are in the D3b block below). This cell still pins only
    // that Restore never sends the words on a base the entry disagrees with.
    server = makeServer({ body: doc(ONLINE, WIDGET), updatedAt: T1 })
    await queuedWhileAway({ permanent: true, serverBase: POISONED_BASE })
    await returnToTheNoteAndSit()
    const restore = await screen.findByRole('button', { name: 'Restore' })
    await act(async () => { fireEvent.click(restore); await settleIdb(6) })
    await sit(8)
    expect(hasWidget(), 'Restore adopted on the poisoned base and sent over the widget').toBe(true)
    expect(survives(SENTENCE), 'the restored words were lost').toBe(true)
    expect(server.puts.every((p) => p.baseUpdatedAt !== T1), 'a send went out on the poisoned revision').toBe(true)
  })
})

describe('fix round 3 — a base OLDER than the entry is used, as at fe4e278bc; only a NEWER one is refused (N4-b)', () => {
  // The legitimate shape the round-2 check refused: the editor's 409 reconcile
  // moved its baseline to T1 and the retry never landed, so the next durable
  // write took T1 (record and entry) while the record kept its T0 copy as base.
  it('⭐ adopted and sent on the older copy: a metadata move rebases, the words arrive, no banner, no fork', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T1 })
    await queuedWhileAway({ baseUpdatedAt: T1 })
    await returnToTheNoteAndSit()
    expect(serverText(), 'the queued words were held behind the banner instead of sent').toContain(SENTENCE)
    expect(screen.queryByText(/Unsaved changes from a previous session/i)).toBeNull()
    expect(server.forks).toHaveLength(0)
    expect(outbox()).toHaveLength(0)
  })

  it('⛔⛔ Restore on the older copy after a second writer, then a keystroke: ONE fork, the other device’s words kept', async () => {
    server = makeServer({ body: doc(para('rewritten on another device')), updatedAt: T2 })
    await queuedWhileAway({ permanent: true, baseUpdatedAt: T1 })   // blocked ⇒ the banner
    await returnToTheNoteAndSit()
    await restoreThenType()
    expect(serverText(), 'the other device’s words were overwritten').toContain('rewritten on another device')
    expect(server.forks).toHaveLength(1)
    expect(JSON.stringify(server.forks[0].bodyJson)).toContain(SENTENCE)
  })
})

/**
 * ⭐⭐ D3b (wave 6) — the lane's items end to end on the real editor.
 * `docs/notebook/f5-fixes-2026-09-23.md` §F.
 */
describe('D3b — Restore never clobbers; the owner lock; a flush behind an in-flight write', () => {
  const DRAFT_KEY = 'uct.j2.notedraft.n1'

  it('⭐ the draft the editor writes RECORDS the revision its words were typed on (the editor half)', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    await returnToTheNote()
    const releasePuts = holdPuts()                          // nothing lands, so the draft is not cleared
    await typeInBody(' K-in-the-draft')
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
    expect(JSON.stringify(draft?.bodyJson ?? null)).toContain('K-in-the-draft')
    expect(draft?.baseUpdatedAt, 'the crash draft carries no base, so Restore cannot know what it was typed on').toBe(T0)
    releasePuts()
    await sit(2)
  })

  it('⛔⛔ a CRASH DRAFT that won, another device saved since, Restore then a keystroke: ONE fork, the other device’s words kept', async () => {
    server = makeServer({ body: doc(para('rewritten on another device')), updatedAt: T1 })
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      title: 'Thesis', subtitle: '', bodyJson: doc(ONLINE, para(SENTENCE), para('typed just before the tab crashed - K-crash')),
      savedAt: Date.now() - 60000, sessionId: 's-crashed', baseUpdatedAt: T0,
    }))
    await returnToTheNoteAndSit()
    await restoreThenType()
    expect(serverText(), 'Restore of the crash draft overwrote the other device’s words').toContain('rewritten on another device')
    expect(server.forks, 'the draft’s words must be preserved in exactly one sibling').toHaveLength(1)
    expect(JSON.stringify(server.forks[0].bodyJson)).toContain('K-crash')
    expect(outbox(), 'the owner’s fork settled the queue').toHaveLength(0)
  })

  it('⛔⛔ a record whose base is NEWER than its entry (the legitimate drain-rebase shape), a second writer, Restore then a keystroke: ONE fork, kept', async () => {
    server = makeServer({ body: doc(para('rewritten on another device')), updatedAt: T2 })
    await queuedWhileAway({
      baseUpdatedAt: T0,
      serverBase: { title: 'Thesis', subtitle: '', bodyJson: doc(ONLINE), updatedAt: T1 },
    })
    await returnToTheNoteAndSit()
    expect(await screen.findByRole('button', { name: 'Restore' }), 'a refused base must be offered, not adopted').toBeTruthy()
    await restoreThenType()
    expect(serverText(), 'the other device’s words were overwritten').toContain('rewritten on another device')
    expect(server.forks).toHaveLength(1)
    expect(JSON.stringify(server.forks[0].bodyJson)).toContain(SENTENCE)
  })

  it('⭐⭐ the open editor HOLDS its note’s owner lock, and another tab’s leading sweep leaves the note to it', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    await queuedWhileAway()
    const mgr = createLockManager()
    Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: mgr.client('tab-A') })
    const releasePuts = holdPuts()                          // the owner's own send is on the wire
    await returnToTheNote()
    await sit(2)
    expect(mgr.heldNames(), 'the editor does not claim its note').toContain(noteOwnerLockName('u42', 'n1'))
    // Tab B leads and sweeps: it has nothing open, so no `excludeNoteId`.
    const tabBSend = vi.fn(async () => { throw new Error('tab B sent the note tab A is editing') })
    const db = factory.databases.get(ACCOUNT_DB)
    const results = await drainOutbox(db, {
      send: tabBSend, fork: sweepFork, noteIsOwned: (id) => isNoteOwned('u42', id, { locks: mgr.client('tab-B') }),
    })
    expect(tabBSend).not.toHaveBeenCalled()
    expect(results.find((r) => r.noteId === 'n1')?.outcome).toBe(SKIPPED)
    releasePuts()
    await sit(12)
    expect(serverText(), 'the owner sent its own queued words').toContain(SENTENCE)
    expect(server.forks, 'two writers on one note forked it').toHaveLength(0)
  })

  it('⛔⛔ a keystroke queued behind an IN-FLIGHT durable write survives the fork fallback’s flush and the view swap', async () => {
    // The member types K1 during the fork's create request and its durable write
    // STARTS (held mid-flight), types K2 (queued behind it), the create returns —
    // the editor refuses the settle and flushes K2 — the view swaps to the server
    // copy, and K3 is typed there. Before D3b the flush waited behind K1's write
    // and K3's snapshot replaced K2's before it was ever written.
    server = makeServer({ body: doc(para('rewritten on another device')), updatedAt: T1 })
    await queuedWhileAway()
    const releaseCreates = holdCreates()
    await returnToTheNote()
    await sit(4)                                            // adopt → 409 → reconcile → create (held)
    expect(createsStarted, 'precondition: the sibling is being created').toBe(1)
    await typeInBody(' K1-starts-a-durable-write')
    const releaseNoteReads = holdNoteReads()                // the durable write about to start is held mid-flight
    await act(async () => { vi.advanceTimersByTime(250); await settleIdb(4) })
    expect(noteReadsHeld(), 'precondition: K1’s durable write is in flight').toBeGreaterThan(0)
    await typeInBody(' K2-queued-behind-it')
    await act(async () => { releaseCreates(); await settleIdb(6) })   // the fork resolves: flush, then swap
    const releasePuts = holdPuts()
    await typeInBody(' K3-on-the-new-view')
    releaseNoteReads()
    await sit(12)
    expect(survives('K2-queued-behind-it'), 'the keystroke queued behind the in-flight write was superseded').toBe(true)
    expect(serverText(), 'the other device’s words were overwritten').toContain('rewritten on another device')
    releasePuts()
    await sit(1)
  })
})

/** Hold every `get` on the notes store — the read a durable write starts with —
 *  until released, so that write is IN FLIGHT. Returns the release. */
let heldNoteReads = 0
const noteReadsHeld = () => heldNoteReads
function holdNoteReads() {
  heldNoteReads = 0
  const store = factory.databases.get(ACCOUNT_DB)
  let release
  const gate = new Promise((r) => { release = r })
  const orig = store.transaction.bind(store)
  store.transaction = (names, mode = 'readonly') => {
    const tx = orig(names, mode)
    if (names !== 'notes' || mode !== 'readonly') return tx
    const inner = tx.objectStore
    tx.objectStore = (n) => {
      const s = inner(n)
      return {
        ...s,
        get: (key) => {
          heldNoteReads += 1
          const req = { result: undefined }
          const read = s.get(key)
          read.onsuccess = () => { gate.then(() => { req.result = read.result; req.onsuccess?.() }) }
          return req
        },
      }
    }
    return tx
  }
  return () => { store.transaction = orig; release() }
}

/**
 * ⭐⭐ D3b FIX ROUND 1 (review `wave6-D3b-review.md`: residuals a and b), on the
 * REAL editor. `docs/notebook/f5-fixes-2026-09-23.md` §G.
 */
describe('D3b fix round 1 — a sweep PUT in flight as the note opens (a); a cleared title on a revision-only Restore (b)', () => {
  it('⛔⛔ (a) another tab’s sweep lands the SAME queued words while this editor opens: its own send 409s — no fork, the queue settles', async () => {
    // The sweep passed its last owner check before this editor existed, so the
    // lock could not stop it. Its PUT lands the words; the editor, which adopted
    // those same words on the revision they were written on, then sends them too.
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    await queuedWhileAway()
    const release = holdRecovery()
    await returnToTheNote()
    // …the other tab's PUT lands exactly what is queued, one revision on.
    server.body = outbox()[0].patch.bodyJson
    server.stamp()
    release()
    await sit(12)
    expect(server.forks, 'the member’s note was forked with nobody else writing').toHaveLength(0)
    expect(serverText()).toContain(SENTENCE)
    expect(server.puts[0]?.baseUpdatedAt, 'precondition: the owner’s own send went out on the words’ base and 409’d').toBe(T0)
    expect(outbox(), 'a landing leaves nothing queued').toHaveLength(0)
    expect(record()?.dirty).toBe(0)
    expect(screen.queryByText(/Unsaved changes from a previous session/i)).toBeNull()
    expect(sweepSend).not.toHaveBeenCalled()
  })

  it('⭐ (a) and a keystroke typed after the landing still goes out, on the server’s revision — nothing is swallowed by “caught up”', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    await queuedWhileAway()
    const release = holdRecovery()
    await returnToTheNote()
    server.body = outbox()[0].patch.bodyJson
    server.stamp()
    release()
    await sit(12)
    expect(server.forks).toHaveLength(0)
    await typeInBody(' K-after-the-landing')
    await sit(6)
    expect(serverText(), 'the keystroke after a landed 409 never left').toContain('K-after-the-landing')
    expect(server.forks).toHaveLength(0)
  })

  it('⛔ (a) CONTROL — a server that holds DIFFERENT words still forks: “landed” is byte-identical content, nothing looser', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    await queuedWhileAway()
    const release = holdRecovery()
    await returnToTheNote()
    server.body = doc(ONLINE, para(SENTENCE), para('and one more sentence from another device'))
    server.stamp()
    release()
    await sit(12)
    expect(server.forks, 'a genuine second writer must still earn a fork').toHaveLength(1)
    expect(serverText()).toContain('another device')
  })

  it('⛔⛔ (b) the title CLEARED offline, the tab crashed, Restore with the server unmoved: the cleared title and subtitle LAND', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.subtitle = 'the old subtitle'
    // No last-known server copy, so the Restore base is revision-only.
    await queuedWhileAway({ title: '', subtitle: '', withServerBase: false })
    await returnToTheNoteAndSit()
    const restore = await screen.findByRole('button', { name: 'Restore' })
    await act(async () => { fireEvent.click(restore); await settleIdb(6) })
    await sit(8)
    expect(serverText()).toContain(SENTENCE)
    expect(server.title, 'the member’s cleared title was silently dropped — the old one would come back on the next load').toBe('')
    expect(server.subtitle, 'the cleared subtitle was silently dropped').toBe('')
    expect(server.forks).toHaveLength(0)
  })

  it('⛔⛔ (b) the NEXT session: a durable copy whose base has no body (as an offline Restore leaves it) is OFFERED, and its Restore still sends the cleared title', async () => {
    // `snapshotOfServerCopy` (frozen) keeps no `bodyUnknown`, so the base the
    // store carries into the next session is a plain copy with a null body.
    // Keyed on a flag, the fix would miss this.
    // ⚖️ D3b fix round 2 (review NN-1): this cell sat on the ADOPTION of that base
    // — `queuedWorkToAdopt` adopted it and sent the words by itself. Adoption now
    // refuses a base with no body (the same key as (b)), so the words are OFFERED;
    // the member's Restore sends them, and the clear must still land.
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    await queuedWhileAway({
      title: '', subtitle: '',
      serverBase: { title: '', subtitle: '', bodyJson: null, updatedAt: T0 },
    })
    await returnToTheNoteAndSit()
    expect(server.puts, 'the words were sent by ourselves on a base with no body').toHaveLength(0)
    const restore = await screen.findByRole('button', { name: 'Restore' })
    await act(async () => { fireEvent.click(restore); await settleIdb(6) })
    await sit(8)
    expect(serverText()).toContain(SENTENCE)
    expect(server.title, 'the cleared title was dropped by the next session’s Restore').toBe('')
    expect(server.forks).toHaveLength(0)
  })

  it('⭐ (b) CONTROL — against a KNOWN base an unchanged title is still not re-sent', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    await queuedWhileAway()
    await returnToTheNoteAndSit()
    expect(serverText()).toContain(SENTENCE)
    expect(server.puts.every((p) => !('title' in p)), 'a known base now re-sends the title on every save').toBe(true)
  })
})

/**
 * ⭐⭐ D3b FIX ROUND 2 (re-review of `d908de394`, notes NN-1 and NN-2), on the REAL
 * editor. `docs/notebook/f5-fixes-2026-09-23.md` §H.
 */
describe('D3b fix round 2 — a base with no body is offered, never sent by ourselves (NN-1); what LANDED covers (NN-2)', () => {
  const NO_BODY = { title: '', subtitle: '', bodyJson: null, updatedAt: T0 }

  it('⛔⛔ NN-1: the NEXT session, a base with no body, a door moved the note while away — nothing sent by ourselves, nothing forked; the words are OFFERED', async () => {
    // A Restore on a revision-only base left the store holding the frozen
    // snapshot: a null body and no flag. Adopted, the send 409'd against a base
    // with no body, the reconcile read BODY_REWRITE, and the note forked with
    // nobody asking.
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.stamp()                                          // a metadata door moved it while away
    await queuedWhileAway({ serverBase: NO_BODY })
    await returnToTheNoteAndSit()
    expect(server.forks, 'a note nobody asked to fork was forked').toHaveLength(0)
    expect(server.puts, 'queued words on a base with no body were sent by ourselves').toHaveLength(0)
    expect(await screen.findByRole('button', { name: 'Restore' }), 'the words were not offered').toBeTruthy()
    expect(survives(SENTENCE)).toBe(true)
    expect(outbox(), 'the queued entry waits for the member').toHaveLength(1)
  })

  it('⭐ NN-1: …and a Restore is the member’s choice — it sends on the words’ own revision and a moved server forks: ONE sibling, both copies kept', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.stamp()
    await queuedWhileAway({ serverBase: NO_BODY })
    await returnToTheNoteAndSit()
    const restore = await screen.findByRole('button', { name: 'Restore' })
    await act(async () => { fireEvent.click(restore); await settleIdb(6) })
    await sit(8)
    expect(server.puts[0]?.baseUpdatedAt, 'Restore did not send on the revision the words were written on').toBe(T0)
    expect(serverText(), 'the server’s copy was overwritten').toBe(JSON.stringify(doc(ONLINE)))
    expect(server.forks).toHaveLength(1)
    expect(JSON.stringify(server.forks[0].bodyJson)).toContain(SENTENCE)
    expect(outbox(), 'the owner’s fork settled the queue').toHaveLength(0)
  })

  it('⭐⭐ NN-2: a METADATA-only difference is LANDED — the sweep landed the same words and a door moved folder and tags: no fork, nothing re-sent, the server’s folder and tags left alone', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    await queuedWhileAway()
    const release = holdRecovery()
    await returnToTheNote()
    server.body = outbox()[0].patch.bodyJson                // the other tab's PUT lands the queued words…
    server.folderId = 'folder-moved-by-a-door'              // …and a door moves the note
    server.tags = ['moved-by-a-door']
    server.stamp()
    release()
    await sit(12)
    expect(server.puts[0]?.baseUpdatedAt, 'precondition: the owner’s own send went out on the words’ base and 409’d').toBe(T0)
    expect(server.forks, 'metadata the editor never sends turned a landing into a fork').toHaveLength(0)
    expect(server.puts, 'a LANDED 409 sent the words again').toHaveLength(1)
    expect(server.puts.every((p) => !('folderId' in p) && !('tags' in p)), 'the editor sent metadata').toBe(true)
    expect(server.folderId).toBe('folder-moved-by-a-door')
    expect(server.tags).toEqual(['moved-by-a-door'])
    expect(outbox(), 'a landing leaves nothing queued').toHaveLength(0)
    expect(record()?.dirty).toBe(0)
  })

  it('⛔⛔ NN-2: a TITLE-only difference is NOT landed — the same body landed but another device renamed the note: ONE fork, the rename kept', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    await queuedWhileAway()
    const release = holdRecovery()
    await returnToTheNote()
    server.body = outbox()[0].patch.bodyJson                // the body is exactly what is queued…
    server.title = 'Renamed on another device'             // …the title is someone else's words
    server.stamp()
    release()
    await sit(12)
    expect(server.title, 'the other device’s title was overwritten').toBe('Renamed on another device')
    expect(server.forks, 'a title the member never wrote was taken for their landing').toHaveLength(1)
    expect(JSON.stringify(server.forks[0].bodyJson)).toContain(SENTENCE)
  })
})
