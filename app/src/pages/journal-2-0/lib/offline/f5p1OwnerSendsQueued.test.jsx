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
 */
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb } from './__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections } from './useDurableNote'
import { useOutboxDrain } from './useOutboxDrain'
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import { dbNameFor } from './notebookDb'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const T0 = '2026-09-23T09:00:00.000000+00:00'
const T1 = '2026-09-23T09:05:00.000000+00:00'
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
    note: () => ({
      id: 'n1', title: s.title, subtitle: s.subtitle, folderId: null, ticker: null, tags: [],
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
async function queuedWhileAway({ permanent = false, serverBase = null } = {}) {
  factory.open(ACCOUNT_DB)
  await act(async () => { await settleIdb(2) })
  const store = factory.databases.get(ACCOUNT_DB)
  store.seed('notes', {
    noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: MINE, dirty: 1, generation: 5,
    sessionId: 's-away', localSavedAt: 1000, baseUpdatedAt: T0,
    serverBase: serverBase || { title: 'Thesis', subtitle: '', bodyJson: doc(ONLINE), updatedAt: T0 },
  })
  store.seed('outbox', {
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
    patch: { title: 'Thesis', subtitle: '', bodyJson: MINE },
    baseUpdatedAt: T0, generation: 5, sessionId: 's-away', queuedAt: 1000,
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
    // ⚠️ What this does NOT pin: Restore then takes its path for a copy with no
    // known base (a direct PUT on the words' own revision, which 409s here), and
    // a keystroke after that can still overwrite — the crash-draft class the
    // N5 ruling leaves open (f5-fixes §C.5). This cell pins only that Restore
    // never sends the words on a base the entry disagrees with.
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
