/**
 * ⭐⭐ C-1 — AN UNDO NEVER DELETES A BLOCK ANOTHER DEVICE ADDED.
 *
 * ⚰️ THE DEFECT (review of the offline-Undo fix, pre-existing on master). The 409
 * reconcile's append merge (`reconcileConflict`, `insertContent(missing)`) puts a
 * block another device appended on the server into the member's view: a
 * `widgetEmbed` (whose `caption` is free text and whose `annotations` are frozen
 * chart drawings), a `financialFact` or a `documentExcerpt`. The merge is an
 * ordinary undoable step, so it is the newest history event, and an Undo removes
 * the BLOCK. The capture that follows comes from the same live view, so it
 * superseded the record (which held the block); the retry then PUT the page on the
 * adopted revision, compare-and-set passed, nothing forked — and the block was on
 * the server, in the record, in the queue and in a copy: none of them. The
 * containment test that should have stopped it reads only TEXT
 * (`authoredText`), so an attrs-only atom block was invisible to it.
 *
 * ⭐ THE RULING: a write from a live view that would drop a block THE RECONCILE
 * MERGED INTO THAT VIEW never supersedes silently. The record follows the page
 * (no pin), and the words it held — the block included — become a queued
 * `(conflicted copy)` in the same transaction. A block the member inserted in this
 * view is the member's own: removing it is an edit like any other.
 *
 * (a) the reviewer's trace, a widget with a caption and drawings — offline, and the
 *     online variant: the block ends on the server or in a conflicted copy
 * (b) the same for `financialFact` and `documentExcerpt`
 * (c) the member's OWN inserted widget removed by Undo: no copy, no pin
 * (d) a genuine second writer of prose still forks (both-ways control)
 *
 * (a) and (b) are RED on `928ba69bd6`. The REAL editor, the REAL durable layer over
 * the fake IndexedDB, a real Undo, the REAL drain, and a compare-and-set server.
 */
import { render, screen, act, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AsyncLocalStorage } from 'node:async_hooks'
import { describe, it as vitestIt, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb } from './__fixtures__/fakeIndexedDb'
import { dbNameFor } from './notebookDb'
import { drainOutbox, FORKED } from './outboxDrain'
import { __resetNotebookConnections } from './useDurableNote'
import { serverCopyIsOursDefault } from './useOutboxDrain'
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import { isNoteCopy } from './noteCopy'

// The real editor and several durable windows per rail: past the default budget.
vi.setConfig({ testTimeout: 60_000 })

/*
 * ⭐ FIX ROUND 1 (review MI-2, the I-A M-12 pattern): EVERY REQUEST IS BOUND TO THE
 * CELL THAT MADE IT. The mocks used to read the module's `server` when they wrote, so
 * a save or a fork one cell left in flight landed in the NEXT cell's server (the M7
 * log showed (d) with two forks for that reason). `update` is bound per mount
 * (`updateFor`), and `fetch` / `createNoteViaApi` resolve their server through
 * `cellScope`; the fake clock is installed inside the cell's scope, so timers it
 * fires carry that cell's server.
 */
const cellScope = new AsyncLocalStorage()
const it = (name, fn, ...rest) => vitestIt(name, (...args) => cellScope.run({ server: null }, () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  return fn(...args)
}), ...rest)
const serverNow = () => cellScope.getStore()?.server ?? server

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const doc = (...blocks) => ({ type: 'doc', content: blocks })
const T0 = '2026-10-16T20:00:00.000000+00:00'

/** The three blocks only the server appends — each with the identity fields
 *  `nodeKeyOf` reads, and a marker string that says where the block is. */
const OTHER_DEVICE = {
  widgetEmbed: {
    marker: 'CAPTION-KEEP my words on this chart',
    node: {
      type: 'widgetEmbed',
      attrs: {
        widgetId: 'w-other-device', capturedAt: '2026-10-16T19:00:00Z', searchText: 'NVDA chart',
        caption: 'CAPTION-KEEP my words on this chart',
        annotations: [{ id: 'drawing-keep-1', type: 'trendline', points: [{ t: 1, p: 2 }, { t: 3, p: 4 }] }],
      },
    },
  },
  financialFact: {
    marker: 'fact-from-other-device',
    node: { type: 'financialFact', attrs: { factId: 'fact-from-other-device' } },
  },
  documentExcerpt: {
    marker: 'excerpt-from-other-device',
    node: { type: 'documentExcerpt', attrs: { excerptId: 'excerpt-from-other-device' } },
  },
}

let server
function makeServer({ body, updatedAt }) {
  let rev = 0
  const s = {
    title: 'Note', subtitle: '', body, updatedAt, forks: [], offline: false,
    // The reconcile's read goes through, then the connection drops: the retry fails.
    dropAfterRead: false,
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
/** Compare-and-set: the editor's save AND the drain's send meet the same server. */
function casPut(patch, s = serverNow()) {
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
  if (!boundUpdates.has(s)) {
    boundUpdates.set(s, async (patch, ...rest) => {
      update(patch, ...rest)
      if (s.offline) throw new Error('network down')    // no status ⇒ retried, never forked
      return casPut(patch, s)
    })
  }
  return boundUpdates.get(s)
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
  createNoteViaApi: vi.fn(async (args) => { serverNow().forks.push(args); return { id: 'fork-1', ...args } }),
}))

const ACCOUNT_DB = dbNameFor('u42')
let factory

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  update.mockClear()
  __resetNotebookConnections()
  factory = createFakeIndexedDbFactory()
  globalThis.indexedDB = factory
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: undefined })
  global.fetch = vi.fn((url) => {
    if (String(url) === '/api/j2/notes/n1') {
      const s = serverNow()                              // MI-2: the cell that made the request
      const note = s.note()
      if (s.dropAfterRead) { s.dropAfterRead = false; s.offline = true }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ note }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
  // MI-2: the fake clock is installed by `it`, inside the cell's scope.
})
afterEach(async () => {
  cleanup()
  // MI-2: let the outgoing editor's own work settle before the next cell begins.
  await act(async () => { await settleIdb(8) })
  vi.useRealTimers()
  vi.clearAllMocks()
  localStorage.clear()
  delete globalThis.indexedDB
})

async function tick(ms) {
  await act(async () => { vi.advanceTimersByTime(ms); await settleIdb(6) })
}
/** Several short ticks: a timer scheduled by async work INSIDE one tick (the
 *  reconcile's merge, after its fetch resolves) fires in a later one. */
async function ticks(n, ms) {
  for (let i = 0; i < n; i += 1) await tick(ms)  // eslint-disable-line no-await-in-loop
}
async function openTheNote() {
  mountedNote = server.note()
  mountedUpdate = updateFor(server)
  const NoteEditorPage = (await import('../../components/notebook/NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={() => {}} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  await tick(600)
}
async function editor() {
  const dom = await waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el
  })
  return dom.editor
}
/** A real editor transaction, so the editor's own draft / durable / autosave paths run. */
async function edit(fn) {
  const ed = await editor()
  await act(async () => { fn(ed.chain()).run(); await settleIdb(2) })
}
/** The touch Undo button's own command. */
const undo = () => edit((c) => c.focus().undo())
const viewJson = async () => JSON.stringify((await editor()).getJSON())
const viewText = async () => (await editor()).getText()
const store = () => factory.databases.get(ACCOUNT_DB)
const outbox = () => store()?.dump('outbox') ?? []
const record = () => (store()?.dump('notes') ?? []).find((r) => r.noteId === 'n1')
const serverText = () => JSON.stringify(server.body)
/** The member left: the editor unmounts and the sweep drains, as on the page they landed on. */
async function leaveAndDrain() {
  cleanup()
  await tick(50)
  const fork = vi.fn(async (entry) => { server.forks.push(entry); return server.note() })
  const send = vi.fn(async (entry) => casPut({
    title: entry.patch?.title ?? '', subtitle: entry.patch?.subtitle || null,
    ...(entry.patch?.bodyJson ? { bodyJson: entry.patch.bodyJson } : {}),
    ...(entry.baseUpdatedAt ? { baseUpdatedAt: entry.baseUpdatedAt } : {}),
  }))
  const results = await drainOutbox(store(), { send, fork, serverCopyIsOurs: serverCopyIsOursDefault })
  return { fork, send, results }
}
/** Every layer the block could still be in, once the member has left and the sweep ran. */
const whereIs = (marker) => ({
  onServer: serverText().includes(marker),
  inAConflictedCopy: JSON.stringify(server.forks).includes(marker),
  queued: JSON.stringify(outbox()).includes(marker),
  inTheRecord: JSON.stringify(record() ?? null).includes(marker),
})

/**
 * The reviewer's trace up to the Undo: type (unsent), another device appends the
 * block, the autosave 409s, the reconcile merges the block into the view and adopts
 * the server's revision — and, offline, the retry fails, so the record and the
 * queue hold the block. Then the member presses Undo and the BLOCK comes off.
 */
async function mergeThenUndo(kind, { offline }) {
  const { node, marker } = OTHER_DEVICE[kind]
  server = makeServer({ body: doc(para('ab cd')), updatedAt: T0 })
  await openTheNote()
  await edit((c) => c.focus('end').insertContent(' ef'))
  await tick(300)                                        // the durable write lands; the save has not
  server.body = doc(para('ab cd'), node)                 // ANOTHER DEVICE appends the block
  server.stamp()
  server.dropAfterRead = offline
  await ticks(10, 300)                                   // 409 ⇒ reconcile merges ⇒ retry (fails offline)
  expect(await viewJson(), 'precondition: the reconcile merged the block into the view').toContain(marker)
  expect(JSON.stringify(record()?.bodyJson), 'precondition: the record holds the merged block').toContain(marker)
  if (offline) {
    expect(server.offline, 'precondition: the retry is offline').toBe(true)
    expect(JSON.stringify(outbox()), 'precondition: the queue holds the merged block').toContain(marker)
    expect(serverText(), 'precondition: the server still holds the block').toContain(marker)
  } else {
    expect(serverText(), 'precondition: the server holds the block').toContain(marker)
    expect(update.mock.calls.some(([p]) => JSON.stringify(p?.bodyJson ?? null).includes(marker) && JSON.stringify(p?.bodyJson ?? null).includes('ab cd ef')),
      'precondition: the retry carried the merged block and the member’s words').toBe(true)
  }
  await undo()
  expect(await viewJson(), 'precondition: the Undo took the BLOCK off the page (the merge was the newest event)').not.toContain(marker)
  expect(await viewText(), 'precondition: the member’s own words are still on the page').toContain('ab cd ef')
  await ticks(2, 300)                                    // the Undo's capture is written
  return marker
}

// ── (a) + (b) ───────────────────────────────────────────────────────────────
describe.each(Object.keys(OTHER_DEVICE))('(a)/(b) a %s another device appended survives the member’s Undo', (kind) => {
  it(`⭐⭐ the reviewer's trace, offline: the ${kind} ends on the server or in a (conflicted copy), never in no layer`, async () => {
    const marker = await mergeThenUndo(kind, { offline: true })
    server.offline = false                               // back online: the retry PUTs on the adopted base
    await ticks(12, 300)
    await leaveAndDrain()
    const at = whereIs(marker)
    expect(at.onServer || at.inAConflictedCopy, `the ${kind} is in no layer: ${JSON.stringify(at)} server=${serverText()} forks=${JSON.stringify(server.forks)}`).toBe(true)
    expect(serverText(), 'the member’s own words did not land').toContain('ab cd ef')
    if (kind === 'widgetEmbed') {
      const all = serverText() + JSON.stringify(server.forks)
      expect(all, 'the widget’s frozen drawings are in no layer').toContain('drawing-keep-1')
    }
  })

  it(`⭐ the online variant: the retry landed WITH the ${kind}; the Undo's save removes it from the note — and it survives in a (conflicted copy)`, async () => {
    const marker = await mergeThenUndo(kind, { offline: false })
    await ticks(10, 300)                                 // the Undo's own save lands
    await leaveAndDrain()
    const at = whereIs(marker)
    expect(at.onServer || at.inAConflictedCopy, `the ${kind} is in no layer: ${JSON.stringify(at)} server=${serverText()} forks=${JSON.stringify(server.forks)}`).toBe(true)
  })
})

describe('(a″) the record FOLLOWS the page after the Undo — it is never pinned to the pre-undo words', () => {
  it('⭐⭐ offline: after the Undo the member keeps typing ⇒ the durable copy holds the newest words, and the block still ends in a copy', async () => {
    const marker = await mergeThenUndo('widgetEmbed', { offline: true })
    await edit((c) => c.focus('end').insertContent(' gh'))
    await ticks(2, 300)
    expect(JSON.stringify(record()?.bodyJson), `the record was pinned: the member's newest words are in no durable layer: ${JSON.stringify(record()?.bodyJson)}`).toContain('ab cd ef gh')
    server.offline = false
    await ticks(12, 300)
    await leaveAndDrain()
    const at = whereIs(marker)
    expect(at.onServer || at.inAConflictedCopy, `the widget is in no layer: ${JSON.stringify(at)}`).toBe(true)
    expect(serverText(), 'the member’s newest words did not land').toContain('ab cd ef gh')
  })
})

describe('(a′) an Undo INSIDE the durable writer’s coalescing window after the merge', () => {
  it('⭐ offline: the Undo comes before the merge’s own capture could land — the widget still ends in a layer', async () => {
    const { node, marker } = OTHER_DEVICE.widgetEmbed
    server = makeServer({ body: doc(para('ab cd')), updatedAt: T0 })
    await openTheNote()
    await edit((c) => c.focus('end').insertContent(' ef'))
    await tick(300)
    server.body = doc(para('ab cd'), node)
    server.stamp()
    server.dropAfterRead = true
    // Step until the merge is on the page, then Undo AT ONCE (well inside ~200 ms).
    for (let i = 0; i < 40 && !(await viewJson()).includes(marker); i += 1) await tick(50)  // eslint-disable-line no-await-in-loop
    expect(await viewJson(), 'precondition: the reconcile merged the block').toContain(marker)
    await undo()
    expect(await viewJson(), 'precondition: the Undo took the block off the page').not.toContain(marker)
    await ticks(3, 300)
    server.offline = false
    await ticks(12, 300)
    await leaveAndDrain()
    const at = whereIs(marker)
    expect(at.onServer || at.inAConflictedCopy, `the widget is in no layer: ${JSON.stringify(at)} server=${serverText()} forks=${JSON.stringify(server.forks)}`).toBe(true)
  })
})

// ── (c) ─────────────────────────────────────────────────────────────────────
describe('(c) the member’s OWN inserted widget removed by Undo is the member’s edit', () => {
  const OWN = {
    type: 'widgetEmbed',
    attrs: { widgetId: 'w-mine', capturedAt: '2026-10-16T19:30:00Z', searchText: 'AAPL chart', caption: 'MY-OWN-WIDGET' },
  }
  it('⭐⭐ offline: type, insert a widget, Undo it, come back online and leave ⇒ no copy, no pin, the Undo holds on the server', async () => {
    server = makeServer({ body: doc(para('ab cd')), updatedAt: T0 })
    await openTheNote()
    server.offline = true
    await edit((c) => c.focus('end').insertContent(' ef'))
    await tick(800)                                      // past the history group delay: the insert is its own step
    await edit((c) => c.focus('end').insertContent(OWN))
    await tick(400)
    expect(JSON.stringify(record()?.bodyJson), 'precondition: the record holds the member’s widget').toContain('MY-OWN-WIDGET')
    await undo()
    expect(await viewJson(), 'precondition: the Undo took the member’s widget off the page').not.toContain('MY-OWN-WIDGET')
    await tick(400)
    expect(outbox().filter(isNoteCopy), 'a (conflicted copy) was queued for the member’s own removal').toHaveLength(0)
    expect(JSON.stringify(record()?.bodyJson), 'the record is PINNED to the pre-undo page').not.toContain('MY-OWN-WIDGET')
    server.offline = false
    await tick(3500)
    const { fork, results } = await leaveAndDrain()
    expect(fork, 'a (conflicted copy) of a note only this member touched').not.toHaveBeenCalled()
    expect(results.map((r) => r.outcome)).not.toContain(FORKED)
    expect(server.forks, 'a sibling note was created').toHaveLength(0)
    expect(serverText(), 'the member’s Undo was reversed on the server').not.toContain('MY-OWN-WIDGET')
    expect(serverText(), 'the member’s words did not land').toContain('ab cd ef')
  })
})

// ── (d) ─────────────────────────────────────────────────────────────────────
describe('(d) ⛔⛔ CONTROL — a genuine second writer of prose still forks', () => {
  it('online: another device rewrites the prose while this view holds unsent words ⇒ preserve both, never a merge', async () => {
    server = makeServer({ body: doc(para('ab cd')), updatedAt: T0 })
    await openTheNote()
    await edit((c) => c.focus('end').insertContent(' ef'))
    await tick(300)
    server.body = doc(para('rewritten on another device'))
    server.stamp()
    await tick(2500)                                     // 409 ⇒ reconcile ⇒ preserve both
    expect(serverText(), 'the other device’s words were overwritten').toContain('rewritten on another device')
    expect(server.forks, 'the second writer did not fork').toHaveLength(1)
    expect(JSON.stringify(server.forks[0]), 'the member’s words are not in the sibling').toContain('ab cd ef')
  })

  it('offline: type; another device rewrites the prose AND appends a widget; leaving forks once, with the member’s words', async () => {
    server = makeServer({ body: doc(para('ab cd')), updatedAt: T0 })
    await openTheNote()
    server.offline = true
    await edit((c) => c.focus('end').insertContent(' ef'))
    await tick(1500)
    server.offline = false
    server.body = doc(para('rewritten on another device'), OTHER_DEVICE.widgetEmbed.node)
    server.stamp()
    const { fork, results } = await leaveAndDrain()
    expect(fork, 'the second writer did not fork').toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.outcome)).toEqual([FORKED])
    expect(JSON.stringify(fork.mock.calls[0][0].patch.bodyJson), 'the fork does not carry the member’s words').toContain('ab cd ef')
    expect(serverText(), 'the other device’s words were overwritten').toContain('rewritten on another device')
    expect(serverText(), 'the other device’s widget was overwritten').toContain(OTHER_DEVICE.widgetEmbed.marker)
  })
})
