/**
 * ⭐⭐ HOTFIX 2026-10-15, FIX ROUND 1 — THE VIEW IS REPLACED BY MORE THAN `replaceDocument`.
 *
 * The mid-text hotfix lets a later capture of the SAME live view supersede what
 * that view wrote earlier (`editorLineageSupersedes`, the note above
 * `authoredDigest` in `recoverLocalState.js`). That is only true while the view
 * moves by the member's own editing. Every whole-view swap therefore mints a new
 * lineage (`viewReplaced()` in `NoteEditorPage.jsx`) — and the review of the
 * hotfix (C1) found the swap a lineage does NOT see: a swap is an ordinary,
 * undoable history step, so Undo puts the PRE-swap document back as a
 * transaction inside the POST-swap lineage. Words that only the swap put on
 * screen (adopted queued words, a Restored crash draft) were then superseded by
 * the server copy the Undo restored, and dropped from the record, the queue AND
 * the crash draft.
 *
 * ⭐ THE RULING: an undo or redo transaction that CROSSES a swap mints a new
 * lineage (it replaces the whole document — `replacesWholeDocument` — or crosses a
 * crash-draft Restore). Undo itself is unchanged for the member. ⚰️ Fix round 1
 * minted one on EVERY undo and redo (`isHistoryTransaction`), which pinned the
 * record on an ordinary Undo: `ordinaryUndoNoPin.test.jsx`.
 *
 * C1 — the loss, through the REAL editor, the REAL durable layer and a real
 *      Undo: adoption (offline, and online before the first PUT), the crash-draft
 *      Restore without a base, and the Restore with a base (the adoption effect).
 *      RED on `5895abfa27`.
 * I1 — for each swap that is not the reconcile's (adoption, crash-draft Restore,
 *      version restore): the swap mints a lineage, and keystrokes on the NEW view
 *      never supersede words the OLD view wrote. Behavioural, beyond the
 *      source scan in `midTextEditNoFork.test.jsx` §5; each is red with its own
 *      rotation deleted.
 */
import { render, screen, act, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb } from './__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections } from './useDurableNote'
import { useOutboxDrain } from './useOutboxDrain'
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import { dbNameFor } from './notebookDb'

// The real editor, a real Undo and several durable windows per rail: past the default budget.
vi.setConfig({ testTimeout: 60_000 })

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const T0 = '2026-10-15T20:00:00.000000+00:00'
const TV = '2026-10-15T20:30:00.000000+00:00'
const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const doc = (...blocks) => ({ type: 'doc', content: blocks })
const ONLINE = para('server copy S.')
const SENTENCE = 'queued offline words W - THIS must never be dropped.'
const MINE = doc(ONLINE, para(SENTENCE))
const DRAFT_KEY = 'uct.j2.notedraft.n1'

// ── a server with compare-and-set, and a network that can be down ───────────
let server
function makeServer({ body, updatedAt }) {
  let rev = 0
  const s = {
    title: 'Thesis', subtitle: '', body, updatedAt, puts: [], forks: [], down: false,
    note: () => ({
      id: 'n1', title: s.title, subtitle: s.subtitle, folderId: null, ticker: null, tags: [],
      heroImageUrl: null, isFavorite: false, bodyJson: s.body, updatedAt: s.updatedAt,
    }),
    stamp: () => { rev += 1; s.updatedAt = `2026-10-15T20:10:${String(10 + rev).padStart(2, '0')}.000000+00:00` },
  }
  return s
}
const update = vi.fn(async (patch) => {
  server.puts.push(patch)
  if (server.down) throw new Error('network down')        // no status ⇒ retried, never forked
  if (patch.baseUpdatedAt && patch.baseUpdatedAt !== server.updatedAt) {
    const e = new Error('note changed — refresh and retry'); e.status = 409; throw e
  }
  if (patch.bodyJson) server.body = patch.bodyJson
  if ('title' in patch) server.title = patch.title
  if ('subtitle' in patch) server.subtitle = patch.subtitle ?? ''
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
  createNoteViaApi: vi.fn(async (args) => { server.forks.push(args); return { id: 'fork-1', ...args } }),
}))

// ⭐ Every lineage the editor mints, so a rail can say a swap MINTED one — the
// real function runs; only its answers are recorded.
const minted = vi.hoisted(() => [])
vi.mock('./useDurableNote', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    newEditLineage: () => { const id = real.newEditLineage(); minted.push(id); return id },
  }
})

// ⭐ The version-history panel's hand-off, without its UI: a version restore
// ends in `onRestored(restoredNote)` — the editor's `adoptServerCopy`. The real
// panel calls it with the note the server now holds; so does this one.
const versionGate = vi.hoisted(() => ({ note: null }))
vi.mock('../../components/notebook/NoteHistoryPanel', async () => {
  const React = await import('react')
  return {
    default: ({ onRestored }) => React.createElement('button', {
      type: 'button', onClick: () => onRestored?.(versionGate.note),
    }, 'rail: restore a version'),
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
  minted.length = 0
  versionGate.note = null
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
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  localStorage.clear()
  delete globalThis.indexedDB
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: undefined })
})

/** The member typed offline on the note in an EARLIER session, left it, and the
 *  durable copy and the queue hold their words — the shape the editor adopts. */
async function queuedWhileAway({ permanent = false } = {}) {
  factory.open(ACCOUNT_DB)
  await act(async () => { await settleIdb(2) })
  const store = factory.databases.get(ACCOUNT_DB)
  store.seed('notes', {
    noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: MINE, dirty: 1, generation: 5,
    sessionId: 's-away', localSavedAt: 1000, baseUpdatedAt: T0,
    serverBase: { title: 'Thesis', subtitle: '', bodyJson: doc(ONLINE), updatedAt: T0 },
  })
  store.seed('outbox', {
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
    patch: { title: 'Thesis', subtitle: '', bodyJson: MINE },
    baseUpdatedAt: T0, generation: 5, sessionId: 's-away', queuedAt: 1000,
    ...(permanent ? { permanent: true, lastError: 'gone', lastStatus: 404 } : {}),
  })
}
/** Hold the outbox READ `recover()` makes, so a rail can look at the view before
 *  the adoption runs (the same hold `f5p1OwnerSendsQueued.test.jsx` uses).
 *  Returns the release. */
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
/** A crash draft an earlier session left — with or without the revision it was typed on. */
function crashDraftFromEarlierSession({ base = null } = {}) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({
    title: 'Thesis', subtitle: '', bodyJson: MINE, savedAt: Date.now() - 60_000,
    sessionId: 's-earlier', ...(base ? { baseUpdatedAt: base } : {}),
  }))
}

/** What NotebookTab renders: the editor, and the sweep excluding the note it owns. */
function Tab({ Editor }) {
  useOutboxDrain({ accountId: 'u42', excludeNoteId: 'n1', send: sweepSend, fork: sweepFork })
  return <Editor noteId="n1" onBack={() => {}} />
}
async function openTheNote() {
  mountedNote = server.note()
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
async function editor() {
  const dom = await waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el
  })
  return dom.editor
}
const viewText = async () => (await editor()).getText()
/** Step the clock in small slices until `cond()` holds (bounded). */
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
/** The touch Undo button's own command (`NoteEditorPage`'s Undo control). */
async function undoOnce() {
  const ed = await editor()
  await act(async () => { ed.chain().focus().undo().run(); await settleIdb(2) })
}
/** Undo, one step at a time, until the view no longer holds `text` (bounded). */
async function undoUntilGone(text, max = 8) {
  for (let i = 0; i < max; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await viewText()).includes(text)) return i
    await undoOnce() // eslint-disable-line no-await-in-loop
  }
  return (await viewText()).includes(text) ? -1 : max
}

const outbox = () => factory.databases.get(ACCOUNT_DB)?.dump('outbox') ?? []
const record = () => (factory.databases.get(ACCOUNT_DB)?.dump('notes') ?? []).find((r) => r.noteId === 'n1')
/** Is `text` anywhere a member could get it back from? The server, a sibling,
 *  the queue, the durable record, or the crash draft. */
function survives(text) {
  const rec = record()
  return [
    JSON.stringify(server.body), server.title,
    ...server.forks.map((f) => JSON.stringify(f)),
    ...outbox().map((e) => JSON.stringify(e.patch)),
    JSON.stringify(rec?.bodyJson ?? null), rec?.title ?? '',
    localStorage.getItem(DRAFT_KEY) || '',
  ].some((b) => String(b).includes(text))
}
const where = (text) => ({
  server: JSON.stringify(server.body).includes(text),
  outbox: outbox().some((e) => JSON.stringify(e.patch).includes(text)),
  record: JSON.stringify(record()?.bodyJson ?? null).includes(text),
  draft: (localStorage.getItem(DRAFT_KEY) || '').includes(text),
  forks: server.forks.some((f) => JSON.stringify(f).includes(text)),
})

// ── C1 ──────────────────────────────────────────────────────────────────────
describe('C1 · ⛔⛔ an Undo that crosses a whole-view swap never drops the words the swap put on screen', () => {
  it('adoption, OFFLINE: adopt queued words, the durable write lands, type, Undo past the adoption ⇒ the words are still in a layer', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.down = true
    await queuedWhileAway()
    await openTheNote()
    expect(await until(async () => (await viewText()).includes(SENTENCE)), 'precondition: the queued words were adopted onto the page').toBe(true)
    await tick(400)                                               // past the 200 ms durable window
    expect(record()?.editorLineage, 'precondition: the adopted words were captured and stamped').toBeTruthy()
    await typeAtEnd('!')
    await tick(400)
    const undos = await undoUntilGone(SENTENCE)
    expect(undos, 'precondition: Undo crossed the adoption (the server copy is back on screen)').toBeGreaterThan(0)
    await sit(4)                                                  // the durable write and the autosave run
    expect(survives(SENTENCE), `the adopted words were dropped from every layer: ${JSON.stringify(where(SENTENCE))}`).toBe(true)
  })

  it('adoption, ONLINE, the Undo before the first PUT: the words are still in a layer', async () => {
    // Every keystroke re-arms the 800 ms autosave, so an Undo in the first burst
    // of typing comes before the adoption's own PUT has gone out.
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    await queuedWhileAway()
    await openTheNote()
    expect(await until(async () => (await viewText()).includes(SENTENCE), { step: 20, max: 40 }), 'precondition: adopted').toBe(true)
    await tick(300)                                               // the durable write lands; the save has not
    expect(record()?.editorLineage, 'precondition: the adopted words were captured and stamped').toBeTruthy()
    await typeAtEnd('!')
    await tick(100)
    const undos = await undoUntilGone(SENTENCE)
    expect(undos, 'precondition: Undo crossed the adoption').toBeGreaterThan(0)
    expect(server.puts.some((p) => JSON.stringify(p.bodyJson ?? null).includes(SENTENCE)), 'precondition: no PUT carried the words before the Undo').toBe(false)
    await sit(4)
    expect(survives(SENTENCE), `the adopted words were dropped from every layer: ${JSON.stringify(where(SENTENCE))}`).toBe(true)
  })

  it('crash-draft Restore WITHOUT a base, OFFLINE: Restore, type, Undo past the Restore ⇒ the draft words are still in a layer', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.down = true
    crashDraftFromEarlierSession()
    await openTheNote()
    await sit(2)
    const restore = await screen.findByRole('button', { name: 'Restore' })
    update.mockClear()
    await act(async () => { fireEvent.click(restore); await settleIdb(6) })
    expect(update, 'precondition: the direct Restore path (a PUT straight away), not the adoption effect').toHaveBeenCalled()
    expect(await viewText(), 'precondition: the draft is on the page').toContain(SENTENCE)
    await tick(400)
    await typeAtEnd('!')
    await tick(400)                                               // the keystroke's capture stamps the draft words
    expect(record()?.editorLineage, 'precondition: the restored words were captured and stamped').toBeTruthy()
    const undos = await undoUntilGone(SENTENCE)
    expect(undos, 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(4)
    expect(survives(SENTENCE), `the restored words were dropped from every layer: ${JSON.stringify(where(SENTENCE))}`).toBe(true)
  })

  it('crash-draft Restore WITH a base (the adoption effect), OFFLINE: Undo past it ⇒ the draft words are still in a layer', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.down = true
    crashDraftFromEarlierSession({ base: T0 })
    await openTheNote()
    await sit(2)
    const restore = await screen.findByRole('button', { name: 'Restore' })
    await act(async () => { fireEvent.click(restore); await settleIdb(6) })
    expect(await until(async () => (await viewText()).includes(SENTENCE)), 'precondition: the draft is on the page').toBe(true)
    await tick(400)
    expect(record()?.editorLineage, 'precondition: the restored words were captured and stamped').toBeTruthy()
    await typeAtEnd('!')
    await tick(400)
    const undos = await undoUntilGone(SENTENCE)
    expect(undos, 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(4)
    expect(survives(SENTENCE), `the restored words were dropped from every layer: ${JSON.stringify(where(SENTENCE))}`).toBe(true)
  })

  it('⭐ Undo still does what the member asked: the page goes back, and Redo brings the words back', async () => {
    // The ruling: no change to Undo itself. Over-rotation only changes what the
    // durable layer trusts, never what the page shows.
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.down = true
    await queuedWhileAway()
    await openTheNote()
    expect(await until(async () => (await viewText()).includes(SENTENCE))).toBe(true)
    await tick(400)
    await typeAtEnd('!')
    await tick(400)
    expect(await undoUntilGone(SENTENCE)).toBeGreaterThan(0)
    expect(await viewText()).not.toContain(SENTENCE)
    const ed = await editor()
    await act(async () => { ed.chain().focus().redo().run(); await settleIdb(2) })
    expect(await viewText(), 'Redo put the adopted words back on the page').toContain(SENTENCE)
  })
})

// ── I1 ──────────────────────────────────────────────────────────────────────
describe('I1 · each swap mints a lineage, and keystrokes on the NEW view never supersede what the OLD view wrote', () => {
  it('version restore (`adoptServerCopy`): the old view’s unsent words survive typing on the restored version', async () => {
    server = makeServer({ body: doc(para('ab cd')), updatedAt: T0 })
    await openTheNote()
    await sit(2)
    server.down = true                                            // the old view's words never land
    await typeAtEnd(' ef')
    await tick(400)
    expect(record()?.dirty, 'precondition: the old view wrote a dirty record').toBeTruthy()
    expect(JSON.stringify(record()?.bodyJson)).toContain('ab cd ef')
    expect(record()?.editorLineage, 'precondition: stamped by the old view').toBeTruthy()
    // A version is restored on the server; the panel hands the editor that copy.
    server.body = doc(para('a restored version'))
    server.updatedAt = TV
    versionGate.note = server.note()
    const before = minted.length
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'rail: restore a version' })); await settleIdb(6) })
    expect(await viewText(), 'precondition: the version is on the page').toContain('a restored version')
    expect(minted.length, 'the version restore minted a new lineage').toBeGreaterThan(before)
    await typeAtEnd(' gh')
    await sit(3)
    expect(survives('ab cd ef'), `the old view's words were superseded by the new view: ${JSON.stringify(where('ab cd ef'))}`).toBe(true)
  })

  it('crash-draft Restore WITHOUT a base: words the old view typed before Restore survive typing on the restored draft', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.down = true
    crashDraftFromEarlierSession()
    await openTheNote()
    await sit(2)
    const restore = await screen.findByRole('button', { name: 'Restore' })
    await typeAtEnd(' K-old-view')
    await tick(400)
    expect(JSON.stringify(record()?.bodyJson ?? null), 'precondition: the old view wrote its words').toContain('K-old-view')
    expect(record()?.editorLineage, 'precondition: stamped by the old view').toBeTruthy()
    const before = minted.length
    update.mockClear()
    await act(async () => { fireEvent.click(restore); await settleIdb(6) })
    expect(update, 'precondition: the direct Restore path').toHaveBeenCalled()
    expect(minted.length, 'the Restore minted a new lineage').toBeGreaterThan(before)
    expect(await viewText()).toContain(SENTENCE)
    await typeAtEnd('!')
    await sit(3)
    expect(survives('K-old-view'), `the old view's words were superseded by the new view: ${JSON.stringify(where('K-old-view'))}`).toBe(true)
    expect(survives(SENTENCE), 'the restored words were lost').toBe(true)
    // ⭐ I-A (2026-10-16, re-review M4): the line above passes on the crash draft
    // ALONE — the one layer the next Undo rewrites, because it follows the page.
    // So undo past the Restore and ask again, and ask for a layer the page does
    // not own. Red on the hotfix tip b69eb71e86 (`restoreUndoKeepsWords.test.jsx`).
    expect(await undoUntilGone(SENTENCE), 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(3)
    const w = where(SENTENCE)
    expect(w.record || w.outbox || w.server || w.forks, `after an Undo past the Restore the restored words are not in a layer the page cannot overwrite: ${JSON.stringify(w)}`).toBe(true)
    expect(survives('K-old-view'), `the old view's words were lost to the Undo: ${JSON.stringify(where('K-old-view'))}`).toBe(true)
  })

  it('crash-draft Restore WITH a base (the adoption effect): words the old view typed before Restore survive typing on the restored draft', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.down = true
    crashDraftFromEarlierSession({ base: T0 })
    await openTheNote()
    await sit(2)
    const restore = await screen.findByRole('button', { name: 'Restore' })
    await typeAtEnd(' K-old-view')
    await tick(400)
    expect(JSON.stringify(record()?.bodyJson ?? null), 'precondition: the old view wrote its words').toContain('K-old-view')
    expect(record()?.editorLineage, 'precondition: stamped by the old view').toBeTruthy()
    const before = minted.length
    await act(async () => { fireEvent.click(restore); await settleIdb(6) })
    expect(await until(async () => (await viewText()).includes(SENTENCE)), 'precondition: the draft is on the page').toBe(true)
    expect(minted.length, 'the Restore (adoption effect) minted a new lineage').toBeGreaterThan(before)
    await typeAtEnd('!')
    await sit(3)
    expect(survives('K-old-view'), `the old view's words were superseded by the new view: ${JSON.stringify(where('K-old-view'))}`).toBe(true)
    expect(survives(SENTENCE), 'the restored words were lost').toBe(true)
    // ⭐ I-A (2026-10-16, re-review M4): the line above passes on the crash draft
    // ALONE — the one layer the next Undo rewrites, because it follows the page.
    // So undo past the Restore and ask again, and ask for a layer the page does
    // not own. Red on the hotfix tip b69eb71e86 (`restoreUndoKeepsWords.test.jsx`).
    expect(await undoUntilGone(SENTENCE), 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(3)
    const w = where(SENTENCE)
    expect(w.record || w.outbox || w.server || w.forks, `after an Undo past the Restore the restored words are not in a layer the page cannot overwrite: ${JSON.stringify(w)}`).toBe(true)
    expect(survives('K-old-view'), `the old view's words were lost to the Undo: ${JSON.stringify(where('K-old-view'))}`).toBe(true)
  })

  it('queued-work adoption: the adoption mints a lineage, and the adopted words are captured under it', async () => {
    // The automatic adoption runs only on a view the member has not touched
    // (S2), so no earlier capture of this view can be in the store when it runs;
    // what is railed is that the swap rotates and that its own capture is the
    // one the record carries.
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.down = true
    await queuedWhileAway()
    const release = holdRecovery()
    await openTheNote()
    await sit(2)
    expect(await viewText(), 'precondition: recovery is held, nothing adopted yet').not.toContain(SENTENCE)
    const beforeAdoption = minted.length
    const loadLineage = minted[beforeAdoption - 1]
    release()
    expect(await until(async () => (await viewText()).includes(SENTENCE)), 'precondition: adopted once recovery resolved').toBe(true)
    await tick(400)
    expect(minted.length, 'the adoption minted a new lineage').toBeGreaterThan(beforeAdoption)
    const stamp = record()?.editorLineage
    expect(stamp, 'the adopted words were captured').toBeTruthy()
    expect(stamp.id, 'the adopted words are NOT captured under the view the load built').not.toBe(loadLineage)
    expect(stamp.id, 'they are captured under the lineage the adoption minted').toBe(minted[minted.length - 1])
  })
})
