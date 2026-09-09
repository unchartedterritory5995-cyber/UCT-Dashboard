/**
 * Wave Q1 — spending the outbox.
 *
 * ⛔ Every rail here is about what happens to the member's WORDS when a send
 * does not simply succeed. The queue draining is the easy half; not losing
 * anything on the way is the product.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { getNote, listOutbox, putNoteWithIntent } from './notebookDb'
import { drainOutbox, SENT, FORKED, KEPT, BLOCKED, SKIPPED } from './outboxDrain'

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

const entryFor = (noteId, text, base = 'T1') => ({
  mutationId: `note:${noteId}`,
  noteId,
  kind: 'note-update',
  patch: { title: `${noteId} title`, subtitle: '', bodyJson: doc(text) },
  baseUpdatedAt: base,
  generation: 3,
  queuedAt: 10,
})

async function seed(db, noteId, text, base = 'T1') {
  const entry = entryFor(noteId, text, base)
  await putNoteWithIntent(db, {
    noteId, title: entry.patch.title, subtitle: '', bodyJson: entry.patch.bodyJson,
    baseUpdatedAt: base, generation: 3, sessionId: 's1', localSavedAt: 20, dirty: 1,
  }, entry)
  return entry
}

const httpError = (status) => { const e = new Error(`http ${status}`); e.status = status; return e }

let db
beforeEach(async () => {
  installKeyRange()
  db = createFakeDb()
})

describe('the happy path', () => {
  it('sends the queued work with ITS OWN baseline, then leaves the note clean', async () => {
    await seed(db, 'n1', 'written offline')
    const send = vi.fn(async () => ({ id: 'n1', updatedAt: 'T2' }))
    const results = await drainOutbox(db, { send, fork: vi.fn() })
    await settleIdb()

    expect(results.map((r) => r.outcome)).toEqual([SENT])
    // ⛔ The baseline travels with the entry. Sending "whatever the server has
    // now" would turn a compare-and-set into an overwrite.
    expect(send.mock.calls[0][0].baseUpdatedAt).toBe('T1')
    expect(await listOutbox(db)).toEqual([])
    const rec = await getNote(db, 'n1')
    expect(rec.dirty).toBe(0)
    expect(rec.baseUpdatedAt).toBe('T2')
  })

  it('⛔ SKIPS the note the editor has open — two writers on one note is the bug', async () => {
    await seed(db, 'n1', 'the open one')
    await seed(db, 'n2', 'a closed one')
    const send = vi.fn(async () => ({ updatedAt: 'T2' }))
    const results = await drainOutbox(db, { send, fork: vi.fn(), excludeNoteId: 'n1' })

    expect(results.find((r) => r.noteId === 'n1').outcome).toBe(SKIPPED)
    expect(results.find((r) => r.noteId === 'n2').outcome).toBe(SENT)
    expect(send).toHaveBeenCalledTimes(1)
    // …and n1's work is untouched, still queued for when the editor lets go.
    const left = await listOutbox(db)
    expect(left.map((e) => e.noteId)).toEqual(['n1'])
  })
})

describe('⛔ nothing is discarded to make the queue drain', () => {
  it('a transient failure leaves the entry queued', async () => {
    await seed(db, 'n1', 'still offline')
    const results = await drainOutbox(db, { send: vi.fn(async () => { throw new Error('network down') }), fork: vi.fn() })
    expect(results[0].outcome).toBe(KEPT)
    const left = await listOutbox(db)
    expect(left).toHaveLength(1)
    expect(left[0].patch.bodyJson).toEqual(doc('still offline'))
    expect((await getNote(db, 'n1')).dirty).toBe(1)
  })

  it('a 5xx is transient too — the server restarting is not the member being wrong', async () => {
    await seed(db, 'n1', 'work')
    const results = await drainOutbox(db, { send: vi.fn(async () => { throw httpError(503) }), fork: vi.fn() })
    expect(results[0].outcome).toBe(KEPT)
    expect(await listOutbox(db)).toHaveLength(1)
  })

  it('a permanent 4xx retires the entry from RETRYING but keeps every word', async () => {
    // The note was deleted, or access was revoked. Spinning forever is useless;
    // deleting the member's paragraphs to tidy the queue is unforgivable.
    await seed(db, 'n1', 'work nobody can send')
    const send = vi.fn(async () => { throw httpError(404) })
    const first = await drainOutbox(db, { send, fork: vi.fn() })
    await settleIdb()
    expect(first[0].outcome).toBe(BLOCKED)

    const left = await listOutbox(db)
    expect(left).toHaveLength(1)
    expect(left[0].patch.bodyJson).toEqual(doc('work nobody can send'))
    expect(left[0].permanent).toBe(true)
    expect(left[0].lastStatus).toBe(404)

    // And a second pass does not hammer it again.
    const second = await drainOutbox(db, { send, fork: vi.fn() })
    expect(second[0].outcome).toBe(BLOCKED)
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('⛔ a 409 preserves BOTH versions', () => {
  it('forks the local work into a sibling and adopts the server copy locally', async () => {
    await seed(db, 'n1', 'my offline paragraph')
    const serverNote = { id: 'n1', title: 'edited on another device', subtitle: '', bodyJson: doc('theirs'), updatedAt: 'T9' }
    const fork = vi.fn(async () => serverNote)
    const results = await drainOutbox(db, {
      send: vi.fn(async () => { throw httpError(409) }),
      fork,
    })
    await settleIdb()

    expect(results[0].outcome).toBe(FORKED)
    expect(fork.mock.calls[0][0].patch.bodyJson).toEqual(doc('my offline paragraph'))
    // The intent is spent: the words live in a real note now.
    expect(await listOutbox(db)).toEqual([])
    // ⛔ And the durable copy stops claiming to be an unsent edit of a note it
    // no longer matches — it holds what the SERVER has, clean.
    const rec = await getNote(db, 'n1')
    expect(rec.bodyJson).toEqual(doc('theirs'))
    expect(rec.dirty).toBe(0)
    expect(rec.baseUpdatedAt).toBe('T9')
  })

  it('⭐ a fork that FAILS leaves the entry exactly where it was', async () => {
    // Half a conflict resolution is worse than none: the local words would be
    // gone from the queue and never have reached a note.
    await seed(db, 'n1', 'my offline paragraph')
    const results = await drainOutbox(db, {
      send: vi.fn(async () => { throw httpError(409) }),
      fork: vi.fn(async () => { throw new Error('could not create the sibling') }),
    })
    expect(results[0].outcome).toBe(KEPT)
    const left = await listOutbox(db)
    expect(left).toHaveLength(1)
    expect(left[0].patch.bodyJson).toEqual(doc('my offline paragraph'))
    expect((await getNote(db, 'n1')).dirty).toBe(1)
  })
})

describe('⭐ the note moved on while the request was in flight', () => {
  it('stays dirty, and re-queues the NEWER words rather than the ones just sent', async () => {
    // THE CONTROL for the happy path. An acknowledgement of older words is not
    // permission to forget newer ones — the same rule the editor's ack obeys.
    const entry = await seed(db, 'n1', 'first draft')
    const send = vi.fn(async () => {
      // another tab (or the editor, before it closed) advanced the record
      await putNoteWithIntent(db, {
        noteId: 'n1', title: entry.patch.title, subtitle: '', bodyJson: doc('first draft, then more'),
        baseUpdatedAt: 'T1', generation: 9, sessionId: 's1', localSavedAt: 99, dirty: 1,
      }, { ...entry, patch: { ...entry.patch, bodyJson: doc('first draft, then more') } })
      return { updatedAt: 'T2' }
    })
    const results = await drainOutbox(db, { send, fork: vi.fn() })
    await settleIdb()

    expect(results[0].outcome).toBe(SENT)
    const rec = await getNote(db, 'n1')
    expect(rec.dirty).toBe(1)
    const left = await listOutbox(db)
    expect(left).toHaveLength(1)
    expect(left[0].patch.bodyJson).toEqual(doc('first draft, then more'))
    // …re-based on the revision the send just created, so the retry is a
    // compare-and-set against the right baseline instead of a stale 409.
    expect(left[0].baseUpdatedAt).toBe('T2')
  })
})
