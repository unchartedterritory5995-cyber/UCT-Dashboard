/**
 * ⭐⭐ D3b (wave 6) — THE OWNER'S FORK SETTLE IS ONE TRANSACTION.
 *
 * `settleOwnerFork` may only write the server copy clean while the durable record
 * and every queued entry for the note still hold exactly what the
 * `(conflicted copy)` sibling holds (`forked`) — anything else is a word the
 * sibling does not have (review S1). Wave 5 checked that with two reads and then
 * wrote in a third transaction, so a durable write that landed AFTER the check's
 * last read was overwritten and its queued entry deleted (`wave5-A-review.md`,
 * re-review 1 point 2 — residual S1).
 *
 * The rail injects a durable write — the member's words plus a keystroke K, dirty,
 * queued, exactly what `persist` writes — at each moment around the settle's
 * reads, and asserts K survives every one. It is written against WHEN THE SETTLE
 * READS (the note, then the note's queue), never against how many transactions it
 * uses, so the same rail reads the three-transaction version and the one-
 * transaction version alike.
 *
 * ⛔ It runs on the SERIALIZED fake store (`createFakeDb({ serialize: true })`),
 * because the question is what IndexedDB's own ordering does with a write that
 * arrives while a readwrite transaction is open. The default fake lets two open
 * readwrite transactions overwrite each other's stores wholesale; the control
 * below proves both halves of that, so this rail cannot pass on the fake's
 * unfaithfulness.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { injectAfterRead } from './__fixtures__/injectAfterRead'
import { putNoteWithIntent, getNote, listOutbox } from './notebookDb'
import { settleOwnerFork, __resetNotebookConnections } from './useDurableNote'
import { OFFLINE_FLAG_KEY } from './offlineFlag'

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const T0 = '2026-09-23T09:00:00.000000+00:00'
const T1 = '2026-09-23T09:05:00.000000+00:00'
const MINE = doc('online. and offline')
const WITH_K = doc('online. and offline K-typed-in-the-window')
const FORKED = { title: 'Thesis', subtitle: '', bodyJson: MINE }
const SERVER_NOW = { title: 'Thesis', subtitle: '', bodyJson: doc('a second writer rewrote this'), updatedAt: T1 }

const recordOf = (body) => ({
  noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: body, dirty: 1, generation: 3,
  sessionId: 's-here', localSavedAt: 10, baseUpdatedAt: T0,
  serverBase: { title: 'Thesis', subtitle: '', bodyJson: doc('online'), updatedAt: T0 },
})
const entryOf = (body) => ({
  mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
  patch: { title: 'Thesis', subtitle: '', bodyJson: body },
  baseUpdatedAt: T0, generation: 3, sessionId: 's-here', queuedAt: 10,
})

beforeEach(() => {
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  installKeyRange()
  __resetNotebookConnections()
  if (!globalThis.indexedDB) globalThis.indexedDB = { open: () => { throw new Error('injected in tests') } }
})

/** What the member's keystroke writes: the words plus K, dirty, queued. */
const keystrokeWrite = (db) => putNoteWithIntent(db, recordOf(WITH_K), entryOf(WITH_K))

async function setUp() {
  const db = createFakeDb({ serialize: true })
  await putNoteWithIntent(db, recordOf(MINE), entryOf(MINE))
  await settleIdb(4)
  return db
}

const settle = (db) => settleOwnerFork({
  accountId: 'a1', noteId: 'n1', serverNote: SERVER_NOW, forked: FORKED, connect: async () => db,
})

/** K is somewhere the member can get it back from: the record, or the queue. */
async function kSurvived(db) {
  const rec = await getNote(db, 'n1')
  const queued = await listOutbox(db)
  return JSON.stringify(rec?.bodyJson).includes('K-typed-in-the-window')
    || queued.some((e) => JSON.stringify(e.patch).includes('K-typed-in-the-window'))
}

describe('⭐⭐ a durable write landing around the owner’s fork check is never overwritten', () => {
  it('⛔⛔ AFTER THE CHECK’S LAST READ, before its write — the window three transactions left open — K survives', async () => {
    const db = await setUp()
    let injected = null
    injectAfterRead(db, 'queue', () => { injected = keystrokeWrite(db) })
    await settle(db)
    await injected
    await settleIdb(8)
    expect(injected, 'precondition: the write was injected').not.toBeNull()
    expect(await kSurvived(db), 'the keystroke that landed between the check and the write was overwritten').toBe(true)
    // ⭐ and it is still UNSENT work, so a later send or fork carries it
    expect((await getNote(db, 'n1')).dirty).toBe(1)
    expect(await listOutbox(db)).toHaveLength(1)
  })

  it('⛔ between the two READS — K survives (the check sees it, or it lands after the write)', async () => {
    const db = await setUp()
    let injected = null
    injectAfterRead(db, 'note', () => { injected = keystrokeWrite(db) })
    await settle(db)
    await injected
    await settleIdb(8)
    expect(injected).not.toBeNull()
    expect(await kSurvived(db)).toBe(true)
  })

  it('⭐ before the settle starts — refused, K untouched', async () => {
    const db = await setUp()
    await keystrokeWrite(db)
    await settleIdb(4)
    expect(await settle(db)).toBe(false)
    expect(await kSurvived(db)).toBe(true)
  })

  it('⭐ after the settle committed — K lands on top of the settled copy, dirty and queued', async () => {
    const db = await setUp()
    expect(await settle(db)).toBe(true)
    await settleIdb(4)
    await keystrokeWrite(db)
    await settleIdb(4)
    expect(await kSurvived(db)).toBe(true)
    expect(await listOutbox(db)).toHaveLength(1)
  })

  it('⭐ CONTROL — with nothing injected the settle still settles: clean, the server copy, the queue empty', async () => {
    const db = await setUp()
    expect(await settle(db)).toBe(true)
    await settleIdb(4)
    const rec = await getNote(db, 'n1')
    expect(rec.dirty).toBe(0)
    expect(rec.bodyJson).toEqual(SERVER_NOW.bodyJson)
    expect(rec.baseUpdatedAt).toBe(T1)
    expect(await listOutbox(db)).toHaveLength(0)
  })
})

describe('⭐ CONTROL — the serialized fake models IndexedDB’s ordering, and the default fake does not', () => {
  const twoOverlappingWriters = async (db) => {
    // Two readwrite transactions alive at once, each writing a different key.
    const a = putNoteWithIntent(db, { noteId: 'x', dirty: 0 }, null)
    const b = putNoteWithIntent(db, { noteId: 'y', dirty: 0 }, null)
    await Promise.all([a, b])
    await settleIdb(4)
    return db.dump('notes').map((r) => r.noteId).sort()
  }

  it('serialized: the second waits for the first, and BOTH writes are kept', async () => {
    expect(await twoOverlappingWriters(createFakeDb({ serialize: true }))).toEqual(['x', 'y'])
  })

  it('default: the second overwrites the first wholesale — why the rail above cannot run on it', async () => {
    expect(await twoOverlappingWriters(createFakeDb())).toEqual(['y'])
  })

  it('serialized: a read issued while a write is open sees the write once it commits', async () => {
    const db = createFakeDb({ serialize: true })
    const w = putNoteWithIntent(db, { noteId: 'x', dirty: 0, title: 'written' }, null)
    const r = getNote(db, 'x')
    await w
    expect((await r)?.title).toBe('written')
  })
})
