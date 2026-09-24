/**
 * ⛔⛔ B1 — EVERY CAPTURE CARRIES THE LEVEL OF THE EDITOR THAT WROTE ITS BODY,
 * AND EVERY WRITER KEEPS THE STAMP WITH THE WORDS IT DESCRIBES.
 *
 * The send side (`notebookSchemaHeaders({ writtenSchema })`) is only as honest
 * as the stamp it is handed. The dangerous failure is NOT a missing stamp — a
 * missing stamp reads as 0, which over-refuses and forks (litter). It is a stamp
 * from ONE source written beside words from ANOTHER: a newer bundle's `1` on the
 * old bundle's empty stand-in, which is B1 again one layer down. So every writer
 * that picks WHICH words to keep must pick the stamp from the same place:
 *
 *   persist            source = prev (unsent work kept) or the editor's state
 *   settleLandedSave   state  = prev (unsent work kept), the ack, or current
 *   settleSent         re-queues the RECORD's newer words, not the entry's
 *   settleBlocked      reconstructs a missing record from the entry
 *   recovery           the winning copy's stamp; agreeing copies ⇒ the lower;
 *                      adoption ⇒ the lower of the record's and the entry's
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { getNote, listOutbox, putNoteWithIntent } from './notebookDb'
import { useDurableNote, settleLandedSave, __resetNotebookConnections } from './useDurableNote'
import { drainOutbox, BLOCKED } from './outboxDrain'
import { chooseLocalRecovery, queuedWorkToAdopt } from './recoverLocalState'
import { OFFLINE_FLAG_KEY } from './offlineFlag'

const T0 = '2026-09-24T09:00:00.000000+00:00'
const T1 = '2026-09-24T09:05:00.000000+00:00'
const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const words = (t) => ({ title: 'Thesis', subtitle: '', bodyJson: doc(t) })
const BASE = { ...words('server copy'), updatedAt: T0 }

let db
beforeEach(() => {
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  installKeyRange()
  __resetNotebookConnections()
  if (!globalThis.indexedDB) globalThis.indexedDB = { open: () => { throw new Error('injected in tests') } }
  db = createFakeDb()
})

const connect = async () => db
const record = () => db.dump('notes').find((r) => r.noteId === 'n1')
const entry = () => db.dump('outbox').find((e) => e.noteId === 'n1')

/** A dirty record + queued entry, as a writer at `stamp` left them (`undefined` ⇒ no field). */
async function seedQueued(text, stamp, { base = T0 } = {}) {
  const s = stamp === undefined ? {} : { writtenSchema: stamp }
  await putNoteWithIntent(db, {
    noteId: 'n1', ...words(text), baseUpdatedAt: base, generation: 2, sessionId: 's-old',
    localSavedAt: 5, dirty: 1, serverBase: BASE, ...s,
  }, {
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update', patch: words(text),
    baseUpdatedAt: base, generation: 2, sessionId: 's-old', queuedAt: 5, ...s,
  })
}

function mountDurable() {
  return renderHook(() => useDurableNote({ accountId: 'acct1', noteId: 'n1', debounceMs: 0, connect }))
}

describe('persist — the editor’s own snapshot', () => {
  it('stamps the record AND the queued entry with the snapshot’s writtenSchema', async () => {
    const { result } = mountDurable()
    await act(async () => {
      result.current.schedule({ ...words('typed here'), baseUpdatedAt: T0, serverBase: BASE, writtenSchema: 1 })
      await settleIdb()
    })
    expect(record().writtenSchema).toBe(1)
    expect(entry().writtenSchema).toBe(1)
  })

  it.each([
    ['stamped 0', 0],
    ['unstamped (production’s shape)', undefined],
  ])('⛔⛔ when it KEEPS the unsent words already in the store (%s), it keeps THEIR stamp — never the snapshot’s', async (_label, stamp) => {
    // The store holds an old bundle's words. The editor's snapshot does not
    // carry them, so fix 6 keeps `prev` — and the stamp must be prev's.
    await seedQueued('an old bundle’s words', stamp)
    const { result } = mountDurable()
    await act(async () => {
      result.current.schedule({ ...words('something else entirely'), baseUpdatedAt: T1, serverBase: BASE, writtenSchema: 1 })
      await settleIdb()
    })
    expect(record().bodyJson, 'precondition: fix 6 kept the unsent words').toEqual(doc('an old bundle’s words'))
    expect(record().writtenSchema, 'the old words were relabelled as a newer bundle’s').toBe(stamp)
    expect(entry().writtenSchema).toBe(stamp)
  })
})

describe('settleLandedSave — the mount-independent settle', () => {
  it('⛔⛔ unsent work kept ⇒ prev’s stamp, never current’s', async () => {
    await seedQueued('an old bundle’s words', 0)
    await settleLandedSave({
      accountId: 'acct1', noteId: 'n1', connect,
      acked: words('what the server accepted'),
      current: { ...words('what the server accepted'), writtenSchema: 1 },
      updatedAt: T1,
    })
    await settleIdb()
    expect(record().bodyJson).toEqual(doc('an old bundle’s words'))
    expect(record().writtenSchema).toBe(0)
    expect(entry().writtenSchema).toBe(0)
  })

  it('still ahead of the ack, with no unsent work ⇒ current’s words and current’s stamp', async () => {
    await settleLandedSave({
      accountId: 'acct1', noteId: 'n1', connect,
      acked: words('sent'),
      current: { ...words('sent and more'), writtenSchema: 1 },
      updatedAt: T1,
    })
    await settleIdb()
    expect(record().bodyJson).toEqual(doc('sent and more'))
    expect(record().writtenSchema).toBe(1)
    expect(entry().writtenSchema).toBe(1)
  })
})

describe('the drain’s settles', () => {
  it('⛔⛔ settleSent re-queues the RECORD’s newer words with the RECORD’s stamp, not the sent entry’s', async () => {
    // The entry went out stamped 1; meanwhile the record took newer words from a
    // capture stamped 0 (an editor holding recovered words). What is re-queued
    // is the record's words — so it is the record's stamp.
    await seedQueued('the sent words', 1)
    const rec = await getNote(db, 'n1')
    await putNoteWithIntent(db, { ...rec, ...words('newer words, recovered'), writtenSchema: 0 }, {
      ...entry(),
    })
    const send = vi.fn(async () => ({ id: 'n1', updatedAt: T1 }))
    await drainOutbox(db, { send, fork: vi.fn() })
    await settleIdb()
    const left = await listOutbox(db)
    expect(left, 'precondition: the newer words were re-queued').toHaveLength(1)
    expect(left[0].patch.bodyJson).toEqual(doc('newer words, recovered'))
    expect(left[0].writtenSchema, 'newer words re-queued under the sent entry’s stamp').toBe(0)
  })

  it('…and the reverse: a record stamped 1 re-queued after an entry stamped 0 keeps 1 (no over-refusal from the entry)', async () => {
    await seedQueued('the sent words', 0)
    const rec = await getNote(db, 'n1')
    await putNoteWithIntent(db, { ...rec, ...words('newer, typed in this bundle'), writtenSchema: 1 }, { ...entry() })
    await drainOutbox(db, { send: vi.fn(async () => ({ id: 'n1', updatedAt: T1 })), fork: vi.fn() })
    await settleIdb()
    expect((await listOutbox(db))[0].writtenSchema).toBe(1)
  })

  it('settleBlocked, with no record to keep, rebuilds one carrying the ENTRY’s stamp', async () => {
    await putNoteWithIntent(db, { noteId: 'other', dirty: 0 }, {
      mutationId: 'note:n1', noteId: 'n1', kind: 'note-update', patch: words('queued'),
      baseUpdatedAt: '', generation: 1, queuedAt: 1, writtenSchema: 0,
    })
    const results = await drainOutbox(db, { send: vi.fn(), fork: vi.fn() })
    await settleIdb()
    expect(results.map((r) => r.outcome)).toEqual([BLOCKED])
    expect(record().writtenSchema).toBe(0)
    expect(entry().writtenSchema).toBe(0)
  })
})

describe('recovery — the stamp travels with the copy that wins', () => {
  const server = { ...words('server copy'), updatedAt: T1 }
  const idb = (text, stamp) => ({
    noteId: 'n1', ...words(text), dirty: 1, generation: 3, sessionId: 's-a', localSavedAt: 10,
    baseUpdatedAt: T0, serverBase: BASE, ...(stamp === undefined ? {} : { writtenSchema: stamp }),
  })
  const draft = (text, stamp, sessionId = 's-a') => ({
    ...words(text), savedAt: 11, sessionId, ...(stamp === undefined ? {} : { writtenSchema: stamp }),
  })

  it('the durable record alone: its stamp (and none ⇒ none, read as 0 at send)', () => {
    expect(chooseLocalRecovery({ server, idbRecord: idb('mine', 1) }).writtenSchema).toBe(1)
    expect(chooseLocalRecovery({ server, idbRecord: idb('mine', undefined) }).writtenSchema).toBeUndefined()
  })

  it('the crash draft alone: its stamp', () => {
    expect(chooseLocalRecovery({ server, lsDraft: draft('mine', 1) }).writtenSchema).toBe(1)
    expect(chooseLocalRecovery({ server, lsDraft: draft('mine', undefined) }).writtenSchema).toBeUndefined()
  })

  it('a draft AHEAD of the record wins with the DRAFT’s stamp', () => {
    const d = chooseLocalRecovery({ server, idbRecord: idb('mine', 0), lsDraft: draft('mine and more', 1) })
    expect(d.state.bodyJson).toEqual(doc('mine and more'))
    expect(d.writtenSchema).toBe(1)
  })

  it('⛔ two copies that AGREE ⇒ the LOWER stamp, whichever is listed first', () => {
    expect(chooseLocalRecovery({ server, idbRecord: idb('mine', 1), lsDraft: draft('mine', 0, 's-b') }).writtenSchema).toBe(0)
    expect(chooseLocalRecovery({ server, idbRecord: idb('mine', 0), lsDraft: draft('mine', 1, 's-b') }).writtenSchema).toBe(0)
    expect(chooseLocalRecovery({ server, idbRecord: idb('mine', 1), lsDraft: draft('mine', undefined, 's-b') }).writtenSchema).toBe(0)
  })

  it('⛔ adoption carries the LOWER of the record’s and the entry’s stamps', () => {
    const rec = idb('mine', 1)
    const decision = chooseLocalRecovery({ server, idbRecord: rec })
    const queued = (stamp) => ({
      mutationId: 'note:n1', noteId: 'n1', patch: words('mine'), baseUpdatedAt: T0,
      ...(stamp === undefined ? {} : { writtenSchema: stamp }),
    })
    expect(queuedWorkToAdopt({ decision, record: rec, entry: queued(1) }).writtenSchema).toBe(1)
    expect(queuedWorkToAdopt({ decision, record: rec, entry: queued(0) }).writtenSchema).toBe(0)
    expect(queuedWorkToAdopt({ decision, record: rec, entry: queued(undefined) }).writtenSchema).toBe(0)
    const unstamped = idb('mine', undefined)
    expect(queuedWorkToAdopt({
      decision: chooseLocalRecovery({ server, idbRecord: unstamped }), record: unstamped, entry: queued(1),
    }).writtenSchema).toBe(0)
  })
})
