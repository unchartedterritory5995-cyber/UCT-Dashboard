/**
 * ⭐⭐ HOTFIX 2026-10-15 — A MID-TEXT EDIT, A PAUSE, AND LEAVING THE NOTE MUST NOT
 * FORK IT. A GENUINE SECOND WRITER MUST STILL FORK IT.
 *
 * ⚰️ THE DEFECT, measured in a real browser before any of this was written
 * (`docs/notebook/evidence/t2b-forkdiag-20261015T235943Z/`, cells E and E-master,
 * 5/5 on master `4649e2d03e` and on the Tier-2 branch): one tab, no other
 * writer. The member types, pauses past the durable writer's ~200 ms window,
 * changes a character in the MIDDLE of the line, the autosave lands (PUT 200),
 * and the member leaves. The drain then sends a STALE queued entry on the OLD
 * revision: 409, BODY_REWRITE, and a `(conflicted copy)` holding the OLDER text.
 *
 * Two answers made it, both read and both reproduced below:
 *   1. `editorStateDiscardsUnsentWork` asked whether the new text CONTAINS the
 *      old one. No edit but an append does, so `persist` kept the older record
 *      and its queued entry (and offline, the member's newest words reached the
 *      crash draft only — never the durable copy or the queue).
 *   2. `settleLandedSave`'s strict question then left that older entry queued
 *      after the newer save — which the member's own view had produced — landed.
 *
 * ⭐ THE FIX ANSWERS BY PROVENANCE: the editor's EDIT LINEAGE (which live view a
 * capture came from, and when), stamped on the record with a digest of its words.
 * The same view, later, supersedes what it wrote earlier. Anything else — no
 * lineage, another lineage, an older capture, a record whose words moved under
 * its stamp — keeps today's conservative answer. Both halves are railed here.
 *
 * Layers, smallest first: the predicate; the durable hook (`persist`); the
 * mount-independent settle and the REAL drain; and the REAL editor and the REAL
 * drain end to end, with a compare-and-set server.
 */
import { render, screen, act, waitFor, cleanup } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { createFakeDb, createFakeIndexedDbFactory, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { getNote, listOutbox, putNoteWithIntent, dbNameFor } from './notebookDb'
import { drainOutbox, FORKED } from './outboxDrain'
import { useDurableNote, settleLandedSave, __resetNotebookConnections } from './useDurableNote'
import { serverCopyIsOursDefault } from './useOutboxDrain'
import {
  editorStateDiscardsUnsentWork, editorLineageStamp, editorLineageSupersedes, authoredDigest,
} from './recoverLocalState'
import { OFFLINE_FLAG_KEY } from './offlineFlag'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const doc = (...blocks) => ({ type: 'doc', content: blocks })
const T0 = '2026-10-15T20:00:00.000000+00:00'
const T1 = '2026-10-15T20:00:09.000000+00:00'

const BEFORE = 'ab cd'
// The four shapes of a member's edit of `BEFORE`. Only `append` CONTAINS it.
const EDITS = {
  'insert in the middle': 'abX cd',
  'insert before existing text': 'Xab cd',
  'delete a character': 'a cd',
  append: 'ab cd ef',
}

const L = 'tab-1:v1'           // one live view
const OTHER = 'tab-1:v2'       // a replaced view, another pane, another tab
const words = (t) => ({ title: 'Note', subtitle: '', bodyJson: doc(para(t)) })
/** A durable record the view `id` wrote from its capture `seq`. */
function stampedRecord(t, { id = L, seq = 1, dirty = 1 } = {}) {
  const rec = { noteId: 'n1', ...words(t), dirty, baseUpdatedAt: T0 }
  rec.editorLineage = editorLineageStamp(rec, { id, seq })
  return rec
}

// ── 1. the predicate ────────────────────────────────────────────────────────
describe('1 · the predicate answers by provenance', () => {
  for (const [shape, after] of Object.entries(EDITS)) {
    it(`⭐ ${shape}, by the SAME live view, later ⇒ not a discard`, () => {
      const prev = stampedRecord(BEFORE, { seq: 1 })
      expect(editorStateDiscardsUnsentWork(prev, { ...words(after), editLineage: { id: L, seq: 2 } })).toBe(false)
    })
  }

  // ⛔ The other provenances keep today's containment answer: true for every
  // shape but the append (which contains the old words, and always passed).
  const conservative = {
    'no lineage at all (a door, a server copy)': () => undefined,
    'a DIFFERENT lineage (a swapped view, a remount, another tab)': () => ({ id: OTHER, seq: 9 }),
    'an OLDER capture than the record (a stale snapshot landing late)': () => ({ id: L, seq: 0 }),
  }
  for (const [why, lineage] of Object.entries(conservative)) {
    for (const [shape, after] of Object.entries(EDITS)) {
      it(`⛔ ${shape}, from ${why} ⇒ today's answer (${shape !== 'append'})`, () => {
        const prev = stampedRecord(BEFORE, { seq: 1 })
        expect(editorStateDiscardsUnsentWork(prev, { ...words(after), editLineage: lineage() }))
          .toBe(shape !== 'append')
      })
    }
  }

  it('⛔⛔ a record whose WORDS moved under its stamp is not vouched for (the drain\'s mergeAppends spreads `...rec`)', () => {
    const prev = stampedRecord(BEFORE, { seq: 1 })
    const merged = { ...prev, bodyJson: doc(para(BEFORE), para('a block the server appended')) }
    expect(editorLineageSupersedes(merged, { id: L, seq: 2 })).toBe(false)
    expect(editorStateDiscardsUnsentWork(merged, { ...words('abX cd'), editLineage: { id: L, seq: 2 } })).toBe(true)
  })

  it('⛔ an unstamped record (everything written before this fix) is never vouched for', () => {
    const prev = { noteId: 'n1', ...words(BEFORE), dirty: 1 }
    expect(editorLineageSupersedes(prev, { id: L, seq: 2 })).toBe(false)
    expect(editorStateDiscardsUnsentWork(prev, { ...words('abX cd'), editLineage: { id: L, seq: 2 } })).toBe(true)
  })

  it('a malformed lineage claims nothing, and a clean record still owes nothing', () => {
    const prev = stampedRecord(BEFORE, { seq: 1 })
    for (const bad of [{ id: '', seq: 2 }, { id: L }, { id: L, seq: NaN }, { seq: 2 }, null]) {
      expect(editorLineageSupersedes(prev, bad)).toBe(false)
    }
    expect(editorLineageStamp(prev, { id: L })).toBeUndefined()
    expect(editorStateDiscardsUnsentWork(stampedRecord(BEFORE, { dirty: 0 }), words('zz'))).toBe(false)
  })

  it('the digest tells the words apart, and is stable for the same words', () => {
    expect(authoredDigest(words('abX cd'))).toBe(authoredDigest(words('abX cd')))
    expect(authoredDigest(words('abX cd'))).not.toBe(authoredDigest(words('ab cd')))
    expect(authoredDigest({ ...words('x'), title: 'a' })).not.toBe(authoredDigest({ ...words('x'), title: 'b' }))
  })
})

// ── 2. the durable hook: `persist` ──────────────────────────────────────────
describe('2 · persist — the same view\'s later edit is what the durable copy holds', () => {
  beforeEach(() => {
    localStorage.setItem(OFFLINE_FLAG_KEY, '1')
    installKeyRange()
    __resetNotebookConnections()
    if (!globalThis.indexedDB) globalThis.indexedDB = { open: () => { throw new Error('injected in tests') } }
  })
  const capture = (t, lineage) => ({
    ...words(t), baseUpdatedAt: T0,
    serverBase: { ...words(BEFORE), updatedAt: T0 },
    ...(lineage ? { editLineage: lineage } : {}),
  })
  async function persistTwo(first, second) {
    const db = createFakeDb()
    const { result } = renderHook(() => useDurableNote({
      accountId: 'a1', noteId: 'n1', debounceMs: 0, connect: async () => db,
    }))
    await act(async () => { result.current.schedule(first); await settleIdb(6) })
    await act(async () => { result.current.schedule(second); await settleIdb(6) })
    return { rec: await getNote(db, 'n1'), queued: await listOutbox(db) }
  }

  for (const [shape, after] of Object.entries(EDITS)) {
    it(`⭐ ${shape}: the record AND the queued entry hold the newer words`, async () => {
      const { rec, queued } = await persistTwo(capture(BEFORE, { id: L, seq: 1 }), capture(after, { id: L, seq: 2 }))
      expect(rec.bodyJson).toEqual(doc(para(after)))
      expect(rec.dirty).toBe(1)
      expect(queued).toHaveLength(1)
      expect(queued[0].patch.bodyJson).toEqual(doc(para(after)))
      // ⛔ The baseline does not move: the newer words still go out on the
      // revision they were typed on, so a moved server still 409s.
      expect(queued[0].baseUpdatedAt).toBe(T0)
      expect(editorLineageSupersedes(rec, { id: L, seq: 3 })).toBe(true)   // re-stamped on the newer words
    })
  }

  it('⛔ a DIFFERENT view\'s mid-text content keeps the older record (fix 6, unchanged)', async () => {
    const { rec, queued } = await persistTwo(capture(BEFORE, { id: L, seq: 1 }), capture('abX cd', { id: OTHER, seq: 2 }))
    expect(rec.bodyJson).toEqual(doc(para(BEFORE)))
    expect(queued[0].patch.bodyJson).toEqual(doc(para(BEFORE)))
    // …and the kept words keep THEIR stamp, so the other view cannot claim them later.
    expect(editorLineageSupersedes(rec, { id: OTHER, seq: 5 })).toBe(false)
  })

  it('⛔ content with NO lineage keeps the older record (a door, `discardDraft`, a server copy)', async () => {
    const { rec } = await persistTwo(capture(BEFORE, { id: L, seq: 1 }), capture('abX cd', null))
    expect(rec.bodyJson).toEqual(doc(para(BEFORE)))
  })
})

// ── 3. the mount-independent settle, then the REAL drain ────────────────────
describe('3 · settleLandedSave — the landed save from the same view retires the older entry', () => {
  let db
  const connect = async () => db
  beforeEach(() => {
    localStorage.setItem(OFFLINE_FLAG_KEY, '1')
    installKeyRange()
    db = createFakeDb()
    globalThis.indexedDB = { open: () => { throw new Error('injected') } }
  })

  /** The view L captured `BEFORE` at seq 1 and that is what the store holds,
   *  queued on T0 — the save that carried the mid-text edit has NOT been
   *  written to the durable copy yet (it landed first). */
  async function olderCaptureQueued({ seq = 1, id = L } = {}) {
    const rec = { ...stampedRecord(BEFORE, { id, seq }), generation: 1, sessionId: 'tab-1', serverBase: { ...words(BEFORE), updatedAt: T0 } }
    await putNoteWithIntent(db, rec, {
      mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
      patch: words(BEFORE), baseUpdatedAt: T0, generation: 1, sessionId: 'tab-1', queuedAt: 1,
    })
  }
  const AFTER = 'abX cd'
  /** The real drain against a server that now holds the member's own landed save. */
  async function drainAfterLeaving() {
    const send = vi.fn(async () => { const e = new Error('conflict'); e.status = 409; throw e })
    const fork = vi.fn(async () => ({ ...words(AFTER), updatedAt: T1 }))
    const serverCopyIsOurs = async () => ({
      ours: true, identical: false, serverUpdatedAt: T1, serverNote: { ...words(AFTER), updatedAt: T1 }, why: 'ours',
    })
    const results = await drainOutbox(db, { send, fork, serverCopyIsOurs })
    return { send, fork, results }
  }
  const settle = (extra = {}) => settleLandedSave({
    accountId: 'a1', noteId: 'n1', acked: words(AFTER), current: { ...words(AFTER), editLineage: { id: L, seq: 6 } },
    updatedAt: T1, connect, ...extra,
  })

  it('⭐⭐ RED BEFORE THE FIX: the save the same view sent lands ⇒ queue retired, record clean, the drain forks nothing', async () => {
    await olderCaptureQueued()
    await act(async () => { await settle({ sentFrom: { id: L, seq: 5 } }); await settleIdb(4) })
    expect(await listOutbox(db)).toHaveLength(0)
    const rec = await getNote(db, 'n1')
    expect(rec.dirty).toBe(0)
    expect(rec.baseUpdatedAt).toBe(T1)
    expect(rec.bodyJson).toEqual(doc(para(AFTER)))
    const { fork, send } = await drainAfterLeaving()
    expect(send).not.toHaveBeenCalled()
    expect(fork).not.toHaveBeenCalled()
  })

  it('⭐ CONTROL — the defect itself: with NO `sentFrom` (as every caller before the fix) the older entry stays and the drain FORKS it', async () => {
    // This is the strict, unchanged path every door and Restore still takes. It
    // pins that the drain-side fork really is what the green case above avoids.
    await olderCaptureQueued()
    await act(async () => { await settle(); await settleIdb(4) })
    expect(await listOutbox(db)).toHaveLength(1)
    const { fork, results } = await drainAfterLeaving()
    expect(fork).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.outcome)).toEqual([FORKED])
  })

  const refusals = {
    'a DIFFERENT lineage sent the save (the record was written by another view)': { sentFrom: { id: OTHER, seq: 5 } },
    'the record is a LATER capture than the body the save carried (typed during the PUT)': { sentFrom: { id: L, seq: 0 } },
  }
  for (const [why, extra] of Object.entries(refusals)) {
    it(`⛔ ${why} ⇒ strict, the entry stays queued`, async () => {
      await olderCaptureQueued()
      await act(async () => { await settle(extra); await settleIdb(4) })
      expect(await listOutbox(db)).toHaveLength(1)
      expect((await getNote(db, 'n1')).dirty).toBe(1)
    })
  }

  it('⛔⛔ a door that hands LOCAL STATE as `acked` — carrying a lineage — still cannot clear the queue (fix 4)', async () => {
    // The lineage rides `current` and `acked` here, as a capture would; only
    // `sentFrom` may vouch, and a door never passes it.
    await olderCaptureQueued()
    const local = { ...words(AFTER), editLineage: { id: L, seq: 7 } }
    await act(async () => {
      await settleLandedSave({ accountId: 'a1', noteId: 'n1', acked: local, current: local, updatedAt: T1, connect })
      await settleIdb(4)
    })
    expect(await listOutbox(db)).toHaveLength(1)
    expect((await getNote(db, 'n1')).bodyJson).toEqual(doc(para(BEFORE)))
  })

  it('⛔ the record\'s words moved under its stamp ⇒ strict, the entry stays queued', async () => {
    await olderCaptureQueued()
    const rec = await getNote(db, 'n1')
    await putNoteWithIntent(db, { ...rec, bodyJson: doc(para(BEFORE), para('appended by the server')) }, (await listOutbox(db))[0])
    await act(async () => { await settle({ sentFrom: { id: L, seq: 5 } }); await settleIdb(4) })
    expect(await listOutbox(db)).toHaveLength(1)
  })
})

// ── 5. every whole-view swap rotates the lineage ────────────────────────────
describe('5 · ⛔⛔ every whole-view swap in the editor mints a new lineage before it moves anything', () => {
  // A swap that keeps the lineage would let keystrokes on the NEW view supersede
  // words the OLD view wrote and nothing else holds — the one way this fix could
  // lose words. Only the reconcile's swap has a behavioural rail (R1 in
  // `f5p1OwnerSendsQueued.test.jsx`); this pins the rest, and any swap added later.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'components', 'notebook', 'NoteEditorPage.jsx'), 'utf8')
  const lines = src.split(/\r?\n/)
  const swaps = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => /\breplaceDocument\(/.test(line) && !/^\s*(import|\/\/|\*)/.test(line) && !/noteContentGuardOptions/.test(line))

  it('non-vacuity: the swaps this rail is about are found', () => {
    expect(swaps.length, 'replaceDocument call sites in NoteEditorPage').toBeGreaterThanOrEqual(5)
  })

  it('each one is preceded, in the same synchronous span, by `viewReplaced()`', () => {
    const missing = []
    for (const { i, line } of swaps) {
      let found = false
      for (let j = i - 1; j >= Math.max(0, i - 25); j -= 1) {
        if (/\bawait\b/.test(lines[j])) break                 // a yield between them is not "before"
        if (/^\s*viewReplaced\(\)/.test(lines[j])) { found = true; break }
      }
      if (!found) missing.push(`NoteEditorPage.jsx:${i + 1}  ${line.trim()}`)
    }
    expect(missing, 'a whole-view swap that keeps the old edit lineage').toEqual([])
  })
})

// ── 4. the REAL editor and the REAL drain, end to end ───────────────────────
let server
function makeServer({ body, updatedAt }) {
  let rev = 0
  const s = {
    title: 'Note', subtitle: '', body, updatedAt, forks: [], offline: false, hold: null,
    note: () => ({
      id: 'n1', title: s.title, subtitle: s.subtitle, folderId: null, ticker: null, tags: [],
      heroImageUrl: null, isFavorite: false, bodyJson: s.body, updatedAt: s.updatedAt,
    }),
    stamp: () => { rev += 1; s.updatedAt = `2026-10-15T20:10:${String(10 + rev).padStart(2, '0')}.000000+00:00` },
  }
  return s
}
/** Compare-and-set, the one axis that matters. Used by the editor's save AND by
 *  the drain's send, so both meet the same server. */
function casPut(patch) {
  if (patch.baseUpdatedAt && patch.baseUpdatedAt !== server.updatedAt) {
    const e = new Error('note changed — refresh and retry'); e.status = 409; throw e
  }
  if (patch.bodyJson) server.body = patch.bodyJson
  if ('title' in patch) server.title = patch.title
  if ('subtitle' in patch) server.subtitle = patch.subtitle ?? ''
  server.stamp()
  return server.note()
}
const update = vi.fn(async (patch) => {
  if (server.offline) throw new Error('network down')      // no status ⇒ retried
  if (server.hold) await server.hold                         // a PUT on the wire
  return casPut(patch)
})
// ⭐ A durable write that never lands (IndexedDB's measured p95 is as long as the
// whole autosave debounce, and a write can fail outright). Pass-through unless a
// rail sets `gate.refuse`.
const gate = vi.hoisted(() => ({ refuse: null }))
vi.mock('./notebookDb', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    putNoteWithIntent: async (db, rec, intent) => {
      if (gate.refuse && gate.refuse(rec)) throw new Error('injected: this durable write did not land')
      return real.putNoteWithIntent(db, rec, intent)
    },
  }
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

describe('4 · end to end — the real editor, a pause, a mid-text edit, the save lands, the member leaves', () => {
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
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: server.note() }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    gate.refuse = null
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
    localStorage.clear()
    delete globalThis.indexedDB
  })

  async function openTheNote() {
    mountedNote = server.note()
    const NoteEditorPage = (await import('../../components/notebook/NoteEditorPage')).default
    render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={() => {}} /></MemoryRouter>)
    await screen.findByPlaceholderText('Title')
    await tick(600)
  }
  async function tick(ms) {
    await act(async () => { vi.advanceTimersByTime(ms); await settleIdb(6) })
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
  const store = () => factory.databases.get(ACCOUNT_DB)
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
  const text = () => JSON.stringify(server.body)

  // The member's first line is typed AT THE END of what the server holds and
  // persisted (the pause); then the second edit is one of the four shapes.
  const SECOND = {
    'insert in the middle': { run: (c) => c.insertContentAt(3, 'X'), expect: 'abX cd ef' },
    'insert before existing text': { run: (c) => c.insertContentAt(1, 'X'), expect: 'Xab cd ef' },
    'delete a character': { run: (c) => c.deleteRange({ from: 2, to: 3 }), expect: 'a cd ef' },
    append: { run: (c) => c.focus('end').insertContent(' gh'), expect: 'ab cd ef gh' },
  }
  for (const [shape, step] of Object.entries(SECOND)) {
    it(`⭐⭐ ${shape}: no (conflicted copy), and the server holds the newest words`, async () => {
      server = makeServer({ body: doc(para('ab cd')), updatedAt: T0 })
      await openTheNote()
      await edit((c) => c.focus('end').insertContent(' ef'))
      await tick(300)                                    // the pause: the durable write lands, the save has not
      expect(store().dump('outbox'), 'precondition: the first edit is queued').toHaveLength(1)
      await edit(step.run)
      await tick(1500)                                   // the autosave fires and LANDS
      expect(text(), 'precondition: the member\'s own save landed').toContain(step.expect)
      const { fork, results } = await leaveAndDrain()
      expect(fork, 'a (conflicted copy) of a note only this member touched').not.toHaveBeenCalled()
      expect(results.map((r) => r.outcome)).not.toContain(FORKED)
      expect(server.forks).toHaveLength(0)
      expect(text()).toContain(step.expect)
      expect(store().dump('outbox')).toHaveLength(0)
    })
  }

  it('⭐⭐ the member leaves while the save is ON THE WIRE and the edit’s durable write never landed: the landed save still retires the older entry', async () => {
    // The case the mount-independent settle exists for: `markSynced` is gone with
    // the editor, so only `settleLandedSave` — with the lineage the save SENT —
    // can tell that the older queued capture is superseded. Without `sentFrom`
    // (or with the settle's strict answer alone) this forks.
    server = makeServer({ body: doc(para('ab cd')), updatedAt: T0 })
    await openTheNote()
    await edit((c) => c.focus('end').insertContent(' ef'))
    await tick(300)
    expect(store().dump('outbox'), 'precondition: the first edit is queued').toHaveLength(1)
    gate.refuse = (rec) => Boolean(rec?.dirty) && JSON.stringify(rec.bodyJson).includes('abX')
    let release
    server.hold = new Promise((r) => { release = r })
    await edit((c) => c.insertContentAt(3, 'X'))
    await tick(1000)                                   // the autosave fires; its PUT is held
    expect(update, 'precondition: the save is on the wire').toHaveBeenCalled()
    expect(JSON.stringify(store().dump('outbox')[0]?.patch), 'precondition: the queue holds the OLDER capture').not.toContain('abX')
    cleanup()                                          // the member leaves
    await tick(50)
    server.hold = null
    release()
    await tick(300)                                    // the PUT lands; the settle runs without the editor
    expect(text(), 'precondition: the member’s own save landed').toContain('abX cd ef')
    const { fork, results } = await leaveAndDrain()
    expect(fork, 'a (conflicted copy) of a note only this member touched').not.toHaveBeenCalled()
    expect(results.map((r) => r.outcome)).not.toContain(FORKED)
    expect(text()).toContain('abX cd ef')
  })

  it('⛔⛔ CONTROL — a GENUINE SECOND WRITER still forks, and the fork carries the member\'s NEWEST words', async () => {
    // Offline: nothing the member types lands. While they are away another device
    // rewrites the note. The drain must preserve BOTH — and the member's copy is
    // the mid-text-edited one, not the older capture (before the fix the durable
    // copy and the queue held only the older line; the newest was in the crash
    // draft alone).
    server = makeServer({ body: doc(para('ab cd')), updatedAt: T0 })
    await openTheNote()
    server.offline = true
    await edit((c) => c.focus('end').insertContent(' ef'))
    await tick(300)
    await edit((c) => c.insertContentAt(3, 'X'))
    await tick(1500)
    expect(text(), 'precondition: nothing landed').not.toContain('ef')
    server.offline = false
    server.body = doc(para('rewritten on another device'))
    server.stamp()
    const { fork, results } = await leaveAndDrain()
    expect(fork).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.outcome)).toEqual([FORKED])
    expect(JSON.stringify(fork.mock.calls[0][0].patch.bodyJson)).toContain('abX cd ef')
    expect(text(), 'the other device\'s words were overwritten').toContain('rewritten on another device')
  })
})
