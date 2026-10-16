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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb } from './__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections } from './useDurableNote'
import { useOutboxDrain } from './useOutboxDrain'
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import { dbNameFor } from './notebookDb'

// The real editor, a real Undo and several durable windows per rail.
vi.setConfig({ testTimeout: 60_000 })

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
    title: 'Thesis', subtitle: '', body, updatedAt, puts: [], forks: [], down: false,
    note: () => ({
      id: 'n1', title: s.title, subtitle: s.subtitle, folderId: null, ticker: null, tags: [],
      heroImageUrl: null, isFavorite: false, bodyJson: s.body, updatedAt: s.updatedAt,
    }),
    stamp: () => { rev += 1; s.updatedAt = `2026-10-16T20:10:${String(10 + rev).padStart(2, '0')}.000000+00:00` },
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

const ACCOUNT_DB = dbNameFor('u42')
let factory
const sweepSend = vi.fn(async () => { throw new Error('the sweep must never send the note the editor owns') })
// ⭐ A queued `(conflicted copy)` (kind 'note-copy') is a NEW note, nobody's to own: online the
// sweep creates it, exactly as `forkConflictedCopy` would. Anything else is the open note's.
const sweepFork = vi.fn(async (entry) => {
  if (entry?.kind === 'note-copy' && !server.down) {
    server.forks.push({ title: `${entry.patch?.title || ''} (conflicted copy)`, bodyJson: entry.patch?.bodyJson, copy: true })
    return server.note()
  }
  throw new Error('the sweep must never fork the note the editor owns')
})

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

/** A crash draft an earlier session left — with or without the revision it was typed on. */
function crashDraftFromEarlierSession({ base = null, title = 'Thesis' } = {}) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({
    title, subtitle: '', bodyJson: DRAFT, savedAt: Date.now() - 60_000,
    sessionId: 's-earlier', ...(base ? { baseUpdatedAt: base } : {}),
  }))
}
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
    expect(await undoUntilGone(SENTENCE), 'precondition: Undo crossed the Restore again').toBeGreaterThan(0)
    await sit(2)
    expectBothDurable('after the second Undo')
    expectDurable('after-redo', 'the words typed after the Redo')
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
    expect(server.forks.some((f) => f.copy && JSON.stringify(f).includes(SENTENCE)), `W never became a sibling ${JSON.stringify(where(SENTENCE))}`).toBe(true)
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

  it('M1: a keystroke under 500 ms after the Restore is its OWN undo step (one Undo takes back only it)', async () => {
    await typeThenRestore()
    await typeAtEnd('#after')                                     // straight after the Restore
    await undoOnce()
    const text = await viewText()
    expect(text, 'one Undo also took back the Restore').toContain(SENTENCE)
    expect(text).not.toContain('#after')
  })
})
