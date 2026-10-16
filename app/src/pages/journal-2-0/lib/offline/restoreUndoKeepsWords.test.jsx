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
 * A word "survives" when a member can get it back from SOME layer: the server,
 * a `(conflicted copy)` sibling, the outbox, the durable record, or the crash
 * draft. Each rail asserts that for the restored words W AND for the words the
 * member typed before pressing Restore — the fix may not buy one with the other.
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
function crashDraftFromEarlierSession({ base = null } = {}) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({
    title: 'Thesis', subtitle: '', bodyJson: DRAFT, savedAt: Date.now() - 60_000,
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
const where = (text) => ({
  server: JSON.stringify(server.body).includes(text),
  outbox: outbox().some((e) => JSON.stringify(e.patch).includes(text)),
  record: JSON.stringify(record()?.bodyJson ?? null).includes(text),
  draft: (localStorage.getItem(DRAFT_KEY) || '').includes(text),
  forks: server.forks.some((f) => JSON.stringify(f).includes(text)),
})
const survives = (text) => Object.values(where(text)).some(Boolean)
function expectBothSurvive(label) {
  expect(survives(SENTENCE), `${label}: the restored words W are in no layer ${JSON.stringify(where(SENTENCE))}`).toBe(true)
  expect(survives(OLD), `${label}: the words typed before Restore are in no layer ${JSON.stringify(where(OLD))}`).toBe(true)
}

/** Open offline on S, type in the old view, let the durable write land, wait
 *  `beforeRestoreMs`, press Restore. Returns once the draft is on the page.
 *  With `beforeRestoreMs` under the 200 ms durable window (0: straight after the
 *  keystroke) the old view's words are still PENDING in the writer at Restore. */
async function typeThenRestore({ base = null, beforeRestoreMs = 1000 } = {}) {
  server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
  server.down = true
  crashDraftFromEarlierSession({ base })
  await openTheNote()
  await sit(2)
  await typeAtEnd(` ${OLD}`)
  const typedAt = Date.now()
  if (beforeRestoreMs < 200) {
    // ⚠️ No tick: under `shouldAdvanceTime` every `settleIdb` round lets the fake
    // clock run ~20 ms, so Restore goes in straight after the keystroke.
    expect(JSON.stringify(record()?.bodyJson ?? null), 'precondition: the old view\'s words are not durable yet').not.toContain(OLD)
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

describe('I-A · ⛔⛔ Undo past a crash-draft Restore never drops the restored words (offline)', () => {
  it('Restore WITHOUT a base after old-view typing, a keystroke, then Undo past the Restore ⇒ W and the old words survive', async () => {
    await typeThenRestore()
    expect(update, 'precondition: the direct Restore path (a PUT straight away, refused: offline)').toHaveBeenCalled()
    await tick(400)
    await typeAtEnd('!')
    await tick(400)                                                // past the 200 ms durable window
    expect(where(SENTENCE).record, 'precondition (the finding): the restored words are NOT in the record').toBe(false)
    const undos = await undoUntilGone(SENTENCE)
    expect(undos, 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await tick(400)
    await sit(4)
    expectBothSurvive('no-base Restore, keystroke, Undo')
    // ⭐ And W is now in a layer the NEXT view change cannot overwrite (the crash
    // draft follows the page; the record and the queue do not).
    expect(where(SENTENCE).record && where(SENTENCE).outbox, `W is only in the crash draft ${JSON.stringify(where(SENTENCE))}`).toBe(true)
    expect(where(OLD).draft, "the old view's words are on the page the Undo brought back (the crash draft)").toBe(true)
  })

  it('Restore WITH a base (the adoption effect) after old-view typing, a keystroke, then Undo past it ⇒ W and the old words survive', async () => {
    await typeThenRestore({ base: T0 })
    await tick(400)
    await typeAtEnd('!')
    await tick(400)
    expect(where(SENTENCE).record, 'precondition (the finding): the restored words are NOT in the record').toBe(false)
    const undos = await undoUntilGone(SENTENCE)
    expect(undos, 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(4)
    expectBothSurvive('with-base Restore, keystroke, Undo')
  })

  it('Restore WITHOUT a base after old-view typing, then Undo at once (no keystroke after Restore) ⇒ W and the old words survive', async () => {
    await typeThenRestore()
    await tick(400)
    const undos = await undoUntilGone(SENTENCE)
    expect(undos, 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(4)
    expectBothSurvive('no-base Restore, Undo at once')
  })

  it('the simplest variant: Restore WITHOUT a base, no typing at all, Undo at once ⇒ W survives', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.down = true
    crashDraftFromEarlierSession()
    await openTheNote()
    await sit(2)
    await pressRestore()
    expect(await viewText(), 'precondition: the draft is on the page').toContain(SENTENCE)
    await tick(400)
    const undos = await undoUntilGone(SENTENCE)
    expect(undos, 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(4)
    expect(survives(SENTENCE), `the restored words W are in no layer ${JSON.stringify(where(SENTENCE))}`).toBe(true)
  })

  it('typing then Restore INSIDE one history group (under 500 ms apart), a keystroke, then Undo past it ⇒ W and the old words survive', async () => {
    // prosemirror-history merges adjacent transactions less than 500 ms apart,
    // and a whole-document swap is adjacent to anything — so without a boundary
    // ONE Undo would take back the old-view typing AND the Restore together.
    const { gapMs } = await typeThenRestore({ beforeRestoreMs: 200 })
    expect(gapMs, 'precondition: the keystroke and the Restore were under newGroupDelay (500 ms) apart').toBeLessThan(500)
    await tick(400)
    await typeAtEnd('!')
    await tick(400)
    const undos = await undoUntilGone(SENTENCE)
    expect(undos, 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(4)
    expectBothSurvive('typing + Restore in one group, keystroke, Undo')
  })

  it('Undo past the Restore, then Redo, then Undo again ⇒ both survive every step (the swap is symmetric)', async () => {
    await typeThenRestore()
    await tick(400)
    await typeAtEnd('!')
    await tick(400)
    expect(await undoUntilGone(SENTENCE), 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
    await sit(2)
    expectBothSurvive('after the Undo')
    await redoOnce()
    expect(await viewText(), 'precondition: Redo put the restored page back').toContain(SENTENCE)
    await sit(2)
    expectBothSurvive('after the Redo')
    expect(where(OLD).record, `the Redo pushed the old view's words off the page; the record must hold them ${JSON.stringify(where(OLD))}`).toBe(true)
    expect(await undoUntilGone(SENTENCE), 'precondition: Undo crossed the Restore again').toBeGreaterThan(0)
    await sit(2)
    expectBothSurvive('after the second Undo')
  })

  it('a keystroke INSIDE the 200 ms window right after the Undo cannot coalesce the displaced words away', async () => {
    await typeThenRestore()
    await tick(400)
    await typeAtEnd('!')
    await tick(400)
    expect(await undoUntilGone(SENTENCE)).toBeGreaterThan(0)
    await typeAtEnd(' typed-after-undo')                        // no tick: same coalescing window
    await sit(3)
    expectBothSurvive('Undo then an immediate keystroke')
    expect(survives('typed-after-undo'), 'the keystroke after the Undo').toBe(true)
  })

  it('back online after the Undo: the page saves, and the displaced words stay QUEUED (a copy on leave, never settled away)', async () => {
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
    expect(where(OLD).server, "the old view's words reached the server with the page").toBe(true)
    expect(where(SENTENCE).record && where(SENTENCE).outbox, `the landed save settled W away ${JSON.stringify(where(SENTENCE))}`).toBe(true)
    expect(record()?.dirty, 'W is still owed to the server').toBeTruthy()
  })

  it('⛔ displaced words travel on the OLDER baseline: a Restore whose draft was typed on an earlier revision queues W on that revision', async () => {
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
    expect(await undoUntilGone(SENTENCE)).toBeGreaterThan(0)
    await sit(3)
    expectBothSurvive('older-base Restore, Undo')
    const entry = outbox().find((e) => JSON.stringify(e.patch).includes(SENTENCE))
    expect(entry?.baseUpdatedAt, 'W must be queued on the revision it was typed on, so a moved server 409s').toBe(T_OLD)
    expect(record()?.baseUpdatedAt).toBe(T_OLD)
  })

  it("⛔ control: an Undo of the member's OWN typing after a Restore (not across it) keeps nothing extra — the undone keystroke is not queued", async () => {
    // Without the crossing gate, the page before this Undo would be "displaced"
    // and, with no record yet, queued: every quick Undo a spurious copy.
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    server.down = true
    crashDraftFromEarlierSession()
    await openTheNote()
    await sit(2)
    await pressRestore()
    expect(await viewText()).toContain(SENTENCE)
    await sit(2)                                                  // the Restore and the next keystroke are separate steps
    await typeAtEnd('#')
    await undoOnce()                                              // inside the durable window: no record yet
    expect(await viewText(), 'precondition: the Undo took back only the keystroke').toContain(SENTENCE)
    await sit(3)
    expect(survives(SENTENCE), 'the restored words').toBe(true)
    expect(JSON.stringify(record()?.bodyJson ?? null), 'the undone keystroke was queued as if it were displaced words').not.toContain('dropped.#')
  })

  for (const base of [null, T0]) {
    const path = base ? 'WITH a base (the adoption effect)' : 'WITHOUT a base'
    it(`Restore ${path} pressed INSIDE the 200 ms durable window after old-view typing ⇒ the old words survive the Restore, and both survive an Undo past it`, async () => {
      await typeThenRestore({ base, beforeRestoreMs: 0 })
      await tick(400)
      await typeAtEnd('!')
      await sit(2)
      expect(survives(OLD), `the words typed just before Restore are in no layer ${JSON.stringify(where(OLD))}`).toBe(true)
      const undos = await undoUntilGone(SENTENCE)
      expect(undos, 'precondition: Undo crossed the Restore').toBeGreaterThan(0)
      await sit(4)
      expectBothSurvive(`${path} Restore inside the durable window, Undo`)
    })
  }
})
