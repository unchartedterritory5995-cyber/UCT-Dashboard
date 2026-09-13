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

describe('⛔⛔ a write that cannot prove it is not clobbering is NEVER sent', () => {
  // `baseUpdatedAt` IS the compare-and-set, and `sendNoteUpdate` omits the field
  // when it is falsy — so a baseline-less entry would go out as a PUT with no
  // CAS at all and overwrite whatever the server holds. The activation canary
  // (2026-09-09) found exactly such an entry queued in production.
  //
  // The path that produced it is fixed at its source in NoteEditorPage; this is
  // the second line, for the next unforeseen path.

  it('refuses a null baseline, keeps every word, and stops retrying', async () => {
    const entry = await seed(db, 'n1', 'the member typed this', null)
    expect(entry.baseUpdatedAt).toBeNull()
    const send = vi.fn(async () => ({ id: 'n1', updatedAt: 'T9' }))
    const results = await drainOutbox(db, { send, fork: vi.fn() })
    await settleIdb()

    // ⛔ The load-bearing assertion: the request was never made.
    expect(send).not.toHaveBeenCalled()
    expect(results[0].outcome).toBe(BLOCKED)

    // …and NOTHING was discarded to achieve that.
    const queued = await listOutbox(db)
    expect(queued).toHaveLength(1)
    expect(queued[0].permanent).toBe(true)
    expect(JSON.stringify(queued[0].patch.bodyJson)).toContain('the member typed this')
    const rec = await getNote(db, 'n1')
    expect(rec.dirty).toBe(1)
    expect(JSON.stringify(rec.bodyJson)).toContain('the member typed this')
  })

  it('refuses an empty-string baseline too — falsy is what the sender checks', async () => {
    await seed(db, 'n1', 'still the member', '')
    const send = vi.fn(async () => ({ id: 'n1', updatedAt: 'T9' }))
    const results = await drainOutbox(db, { send, fork: vi.fn() })
    await settleIdb()
    expect(send).not.toHaveBeenCalled()
    expect(results[0].outcome).toBe(BLOCKED)
  })

  it('⭐ CONTROL — an entry WITH a baseline still goes out', async () => {
    // Without this, deleting the whole drain would pass both rails above.
    await seed(db, 'n1', 'ordinary work', 'T1')
    const send = vi.fn(async () => ({ id: 'n1', updatedAt: 'T2' }))
    const results = await drainOutbox(db, { send, fork: vi.fn() })
    await settleIdb()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].baseUpdatedAt).toBe('T1')
    expect(results[0].outcome).toBe(SENT)
  })

  it('⭐ CONTROL — one bad entry does not stop a good one behind it', async () => {
    await seed(db, 'n1', 'baseline-less', null)
    await seed(db, 'n2', 'perfectly fine', 'T1')
    const send = vi.fn(async () => ({ id: 'n2', updatedAt: 'T2' }))
    const results = await drainOutbox(db, { send, fork: vi.fn() })
    await settleIdb()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].noteId).toBe('n2')
    expect(results.map((r) => r.outcome).sort()).toEqual([BLOCKED, SENT].sort())
  })
})

/**
 * ⚰️⚰️ 2026-09-12 — THE LANDED RING IS AN ENUMERATION, AND ENUMERATIONS GO
 * STALE SILENTLY.
 *
 * The ring only knows revisions THIS browser recorded. A door fired in another
 * tab, a door that shipped before its settle did, a door nobody has enumerated
 * yet — each produces a revision the ring has never heard of, and the answer
 * was always "not ours ⇒ fork": a `(conflicted copy)` of a note only the member
 * had ever touched.
 *
 * So the drain asks the DIFF as well, and the diff has three answers. These
 * rails drive each one, and each is paired with the neighbour that must still
 * fork — a fixture that cannot distinguish is not a rail.
 */
describe('the drain classifies what the server changed, and only forks when it must', () => {
  const embed = { type: 'widgetEmbed', attrs: { widgetId: 'w1', capturedAt: 'C1', searchText: 'SPY' } }
  const fact = { type: 'financialFact', attrs: { factId: 'f1' } }
  const excerpt = { type: 'documentExcerpt', attrs: { excerptId: 'x1' } }

  /** The note as the server held it when the member started typing. */
  const SERVER_BASE = { title: 'n1 title', subtitle: '', bodyJson: doc('what the server had'), updatedAt: 'T1' }

  /** A dirty record that REMEMBERS what the server last held — the state a real
   *  editor leaves behind, and the only thing that makes a diff possible. */
  async function seedWithBase(noteId, text, { serverBase = SERVER_BASE } = {}) {
    const entry = entryFor(noteId, text)
    await putNoteWithIntent(db, {
      noteId, title: entry.patch.title, subtitle: '', bodyJson: entry.patch.bodyJson,
      baseUpdatedAt: 'T1', generation: 3, sessionId: 's1', localSavedAt: 20, dirty: 1, serverBase,
    }, entry)
    return entry
  }

  /** The server says "not ours" — exactly what the ring says about a door it
   *  never recorded — and hands back the document it is holding. */
  const notOurs = (serverNote) => vi.fn(async () => ({
    ours: false, identical: false, serverUpdatedAt: serverNote.updatedAt, serverNote,
    why: 'the server copy differs and is not one of ours',
  }))

  const serverWith = (content) => ({
    ...SERVER_BASE, updatedAt: 'T2',
    bodyJson: { ...SERVER_BASE.bodyJson, content: [...SERVER_BASE.bodyJson.content, ...content] },
  })

  it('METADATA-ONLY: a door moved the revision and nothing else — rebase and send, never fork', async () => {
    await seedWithBase('n1', 'the words I typed offline')
    // ticker/folder/tags/hero: the body, title and subtitle are untouched.
    const server = { ...SERVER_BASE, updatedAt: 'T2', ticker: 'NVDA' }
    const send = vi.fn()
      .mockRejectedValueOnce(httpError(409))
      .mockResolvedValue({ id: 'n1', updatedAt: 'T3' })
    const fork = vi.fn()
    const results = await drainOutbox(db, { send, fork, serverCopyIsOurs: notOurs(server) })
    await settleIdb()

    expect(results.map((r) => r.outcome)).toEqual([SENT])
    expect(results[0].shape).toBe('metadata-only')
    expect(fork).not.toHaveBeenCalled()
    expect(send.mock.calls[1][0].baseUpdatedAt).toBe('T2')
    // ⛔ The member's words went out unchanged. Only the baseline moved.
    expect(JSON.stringify(send.mock.calls[1][0].patch.bodyJson)).toContain('the words I typed offline')
  })

  it.each([
    ['widgetEmbed (Send to Journal)', embed, 'widgetEmbed'],
    ['financialFact (a saved price)', fact, 'financialFact'],
    ['documentExcerpt (an excerpt capture)', excerpt, 'documentExcerpt'],
  ])('APPEND-ONLY: the server appended a %s — merge and send, never fork', async (_label, node, marker) => {
    await seedWithBase('n1', 'the words I typed offline')
    const send = vi.fn()
      .mockRejectedValueOnce(httpError(409))
      .mockResolvedValue({ id: 'n1', updatedAt: 'T3' })
    const fork = vi.fn()
    const results = await drainOutbox(db, {
      send, fork, serverCopyIsOurs: notOurs(serverWith([node])),
    })
    await settleIdb()

    expect(results.map((r) => r.outcome)).toEqual([SENT])
    expect(results[0].shape).toBe('append-only')
    expect(fork).not.toHaveBeenCalled()
    const sent = send.mock.calls[1][0]
    expect(sent.baseUpdatedAt).toBe('T2')
    // ⛔⛔ BOTH SURVIVE. That is the whole claim.
    expect(JSON.stringify(sent.patch.bodyJson)).toContain('the words I typed offline')
    expect(JSON.stringify(sent.patch.bodyJson)).toContain(marker)
  })

  it('⛔⛔ the RECORD gets the append too — or the next drain sends it straight back out', async () => {
    // ⚰️ The trap: `settleSent` re-queues the RECORD's words whenever they are
    // ahead of the ack. A merge that only touched the outbox entry would be
    // undone by the very next drain, which would send a body with the server's
    // blocks stripped back out — a clobber one pass later.
    await seedWithBase('n1', 'the words I typed offline')
    const send = vi.fn()
      .mockRejectedValueOnce(httpError(409))
      .mockResolvedValue({ id: 'n1', updatedAt: 'T3' })
    await drainOutbox(db, { send, fork: vi.fn(), serverCopyIsOurs: notOurs(serverWith([embed])) })
    await settleIdb()

    const rec = await getNote(db, 'n1')
    expect(JSON.stringify(rec.bodyJson)).toContain('widgetEmbed')
    expect(JSON.stringify(rec.bodyJson)).toContain('the words I typed offline')
    // …and with the record and the ack agreeing, nothing is left owed.
    expect(await listOutbox(db)).toEqual([])
    expect(rec.dirty).toBe(0)
  })

  it('⛔ BODY-REWRITE: somebody else changed the prose — fork, preserving both', async () => {
    await seedWithBase('n1', 'the words I typed offline')
    const server = { ...SERVER_BASE, updatedAt: 'T2', bodyJson: doc('rewritten on another device') }
    const send = vi.fn()
      .mockRejectedValueOnce(httpError(409))
      .mockResolvedValue({ id: 'n1', updatedAt: 'T3' })
    const fork = vi.fn(async () => server)
    const results = await drainOutbox(db, { send, fork, serverCopyIsOurs: notOurs(server) })
    await settleIdb()

    expect(results.map((r) => r.outcome)).toEqual([FORKED])
    expect(fork).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)          // never re-sent over their words
  })

  it('⛔ an APPENDED PARAGRAPH is not an append the server makes — it forks', async () => {
    await seedWithBase('n1', 'the words I typed offline')
    const server = serverWith([{ type: 'paragraph', content: [{ type: 'text', text: 'typed elsewhere' }] }])
    // ⛔ Same reason as above: the retry must be ABLE to succeed, or forking
    // proves nothing about which branch was taken.
    const send = vi.fn()
      .mockRejectedValueOnce(httpError(409))
      .mockResolvedValue({ id: 'n1', updatedAt: 'T3' })
    const fork = vi.fn(async () => server)
    const results = await drainOutbox(db, { send, fork, serverCopyIsOurs: notOurs(server) })
    await settleIdb()

    expect(results.map((r) => r.outcome)).toEqual([FORKED])
    expect(send).toHaveBeenCalledTimes(1)        // it was never re-sent at all
  })

  it('⛔ NO REMEMBERED BASE, NO CLASSIFICATION — a dirty record that cannot say what the server held forks', async () => {
    // ⭐ THE CONTROL THAT PROVES THE DIFF IS DOING THE WORK. Same server copy as
    // the metadata-only rail above; the only thing removed is the memory of
    // what the server held. Merging on an assumption is how words get lost.
    await seedWithBase('n1', 'the words I typed offline', { serverBase: null })
    const server = { ...SERVER_BASE, updatedAt: 'T2', ticker: 'NVDA' }
    // ⛔⛔ THE SECOND SEND MUST BE ABLE TO SUCCEED. A mock that 409s for ever
    // forks down BOTH branches, so it cannot tell "refused to classify" from
    // "classified, merged, and the merge failed" — a fixture that cannot
    // distinguish is not a rail. With this, a wrong merge shows up as SENT.
    const send = vi.fn()
      .mockRejectedValueOnce(httpError(409))
      .mockResolvedValue({ id: 'n1', updatedAt: 'T3' })
    const fork = vi.fn(async () => server)
    const results = await drainOutbox(db, { send, fork, serverCopyIsOurs: notOurs(server) })
    await settleIdb()

    expect(results.map((r) => r.outcome)).toEqual([FORKED])
  })

  it('⛔ a SECOND 409 on the merged send forks — the ground will not hold still', async () => {
    await seedWithBase('n1', 'the words I typed offline')
    const server = serverWith([embed])
    const send = vi.fn().mockRejectedValue(httpError(409))
    const fork = vi.fn(async () => server)
    const results = await drainOutbox(db, { send, fork, serverCopyIsOurs: notOurs(server) })
    await settleIdb()

    expect(results.map((r) => r.outcome)).toEqual([FORKED])
    expect(send).toHaveBeenCalledTimes(2)          // tried the merge once, then stopped
  })

  it('⛔ a non-409 failure on the merged send KEEPS the entry — it is never dropped', async () => {
    await seedWithBase('n1', 'the words I typed offline')
    const send = vi.fn()
      .mockRejectedValueOnce(httpError(409))
      .mockRejectedValue(httpError(503))
    const fork = vi.fn()
    const results = await drainOutbox(db, { send, fork, serverCopyIsOurs: notOurs(serverWith([embed])) })
    await settleIdb()

    expect(results.map((r) => r.outcome)).toEqual([KEPT])
    expect(fork).not.toHaveBeenCalled()
    expect((await listOutbox(db)).length).toBe(1)
  })

  it('⭐ the ring still wins when it CAN vouch — the diff is the second line, not a replacement', async () => {
    await seedWithBase('n1', 'the words I typed offline')
    const ours = vi.fn(async () => ({
      ours: true, identical: false, serverUpdatedAt: 'T2', serverNote: { ...SERVER_BASE, updatedAt: 'T2' },
      why: 'the server revision T2 is ours',
    }))
    const send = vi.fn()
      .mockRejectedValueOnce(httpError(409))
      .mockResolvedValue({ id: 'n1', updatedAt: 'T3' })
    const results = await drainOutbox(db, { send, fork: vi.fn(), serverCopyIsOurs: ours })
    await settleIdb()

    expect(results.map((r) => r.outcome)).toEqual([SENT])
    expect(results[0].shape).toBeUndefined()      // the ring answered; the diff was never asked
    expect(send).toHaveBeenCalledTimes(2)         // one rebase, not two
  })
})

/**
 * ⚰️ THE EMPTIED WORKING COPY — the small defect that rode alongside the big one.
 *
 * `settleForked` writes the SERVER's copy back into the durable record, and
 * every field of it falls back to `''`/`null`. So a fork that resolved without
 * a usable server note blanked the member's local copy of that note and marked
 * it clean — and a clean record is not a recovery candidate, so the banner
 * would never offer it back either. The words survived in the `(conflicted
 * copy)` sibling; the note the member had been looking at did not.
 */
describe('⛔ a fork never empties the working copy', () => {
  const emptied = (rec) => !rec || (!rec.bodyJson && !rec.title)

  it('writes the SERVER copy back when there is one — the normal path', async () => {
    await seed(db, 'n1', 'my offline words')
    const server = { id: 'n1', title: 'theirs', subtitle: '', bodyJson: doc('what they wrote'), updatedAt: 'T2' }
    const send = vi.fn().mockRejectedValue(httpError(409))
    const results = await drainOutbox(db, { send, fork: vi.fn(async () => server) })
    await settleIdb()

    expect(results.map((r) => r.outcome)).toEqual([FORKED])
    const rec = await getNote(db, 'n1')
    expect(rec.title).toBe('theirs')
    expect(JSON.stringify(rec.bodyJson)).toContain('what they wrote')
    expect(rec.dirty).toBe(0)
  })

  it.each([
    ['the fork resolved with nothing', undefined],
    ['the fork resolved with null', null],
    ['the server answered 200 with no note', {}],
  ])('⛔ %s ⇒ the working copy is KEPT, not blanked', async (_label, forkResult) => {
    await seed(db, 'n1', 'my offline words')
    const send = vi.fn().mockRejectedValue(httpError(409))
    const results = await drainOutbox(db, { send, fork: vi.fn(async () => forkResult) })
    await settleIdb()

    expect(results.map((r) => r.outcome)).toEqual([FORKED])
    const rec = await getNote(db, 'n1')
    expect(emptied(rec), '⛔ the member opened this note and found it blank').toBe(false)
    expect(JSON.stringify(rec.bodyJson)).toContain('my offline words')
    // …and the queue IS settled: the fork happened, nothing is owed.
    expect(await listOutbox(db)).toEqual([])
    expect(rec.dirty).toBe(0)
  })

  it('⛔ a stale serverBase never survives a fork — the record IS the base now', async () => {
    await seed(db, 'n1', 'my offline words')
    const server = { id: 'n1', title: 'theirs', subtitle: '', bodyJson: doc('theirs'), updatedAt: 'T2' }
    await drainOutbox(db, { send: vi.fn().mockRejectedValue(httpError(409)), fork: vi.fn(async () => server) })
    await settleIdb()
    expect((await getNote(db, 'n1')).serverBase ?? null).toBeNull()
  })
})

/**
 * ⛔⛔ Q1-F4 (c) — THE DRAIN'S PUT CANNOT NULL A HERO, AND THAT IS STRUCTURAL.
 *
 * A production canary read `heroImageUrl = null` after a hero-door run, which
 * has two readings: the drain clobbered the hero, or the door never set one.
 * This is the half that can be settled without a browser — and it is pinned as
 * a rail rather than read once, because "the payload happens not to include it"
 * is a fact that a later convenience (`...entry.patch`) would quietly reverse.
 *
 * `update_note` builds its SQL `SET` list only from keys PRESENT in the patch,
 * so a key the drain never sends is a column the drain can never write.
 */
describe('⛔ Q1-F4 — the drain sends four keys, and `heroImageUrl` is not one of them', () => {
  it('the compare-and-set PUT carries title, subtitle, bodyJson, baseUpdatedAt — and nothing else', async () => {
    const { sendNoteUpdate } = await import('./useOutboxDrain')
    let sent = null
    globalThis.fetch = vi.fn(async (_u, opts) => {
      sent = JSON.parse(opts.body)
      return { ok: true, json: async () => ({ note: { id: 'n1', updatedAt: 'T2' } }) }
    })

    await sendNoteUpdate({
      noteId: 'n1',
      baseUpdatedAt: 'T1',
      patch: { title: 't', subtitle: 's', bodyJson: doc('words') },
    })

    expect(Object.keys(sent).sort()).toEqual(['baseUpdatedAt', 'bodyJson', 'subtitle', 'title'])
    expect(sent, '⛔ a hero the member just set is not the drain\'s to touch').not.toHaveProperty('heroImageUrl')
  })

  it('⛔ and it stays four keys even when the entry patch carries extra fields', async () => {
    // ⭐ THE ONE THAT MATTERS. A queued entry is a stored object; if the send
    // ever spread it, every field a future wave adds to an entry would start
    // going out as a note update. The payload is BUILT, never forwarded.
    const { sendNoteUpdate } = await import('./useOutboxDrain')
    let sent = null
    globalThis.fetch = vi.fn(async (_u, opts) => {
      sent = JSON.parse(opts.body)
      return { ok: true, json: async () => ({ note: { id: 'n1', updatedAt: 'T2' } }) }
    })

    await sendNoteUpdate({
      noteId: 'n1',
      baseUpdatedAt: 'T1',
      patch: {
        title: 't', subtitle: 's', bodyJson: doc('words'),
        heroImageUrl: null, ticker: 'NVDA', folderId: 'f9', tags: ['x'],
      },
    })

    expect(Object.keys(sent).sort()).toEqual(['baseUpdatedAt', 'bodyJson', 'subtitle', 'title'])
    expect(sent).not.toHaveProperty('heroImageUrl')
    expect(sent).not.toHaveProperty('ticker')
  })
})
