/**
 * ⛔⛔ D3 (wave 5) — THE SETTLE NEVER HIDES A SERVER APPEND FROM THE CLASSIFIER,
 * AND NEVER CALLS THE SERVER'S OWN APPEND A DISCARD.
 *
 * Two changes to `settleLandedSave` and the predicate it asks, both found by
 * widening `offlineWordsSurvive.property.test.jsx` with two orderings that put
 * a SECOND write after an append door. The property rail owns the behaviour;
 * this file owns the two decisions it rests on, so each can be mutation-proved
 * on its own and neither can quietly widen.
 *
 *   1. THE BASE. When the record keeps unsent work it keeps `prev`'s words and
 *      `prev`'s baseline, so its `serverBase` must stay the copy THOSE words were
 *      written on. It used to become `acked@landed` — a copy that already held
 *      the door's appended node — and the drain read the append as "no change"
 *      and re-sent the member's body over it. The node was gone.
 *
 *   2. THE PREDICATE. `discardsUnsentWork` answered "unsent work" whenever what
 *      landed differed from the record. What landed can be the record's words
 *      PLUS a block only the server appends (the editor merged it and saved).
 *      That is not a discard — and treating it as one left a stale entry queued
 *      that later forked the member's own note. The exception is PROVEN
 *      positionally, never inferred, and everything else still reads as a
 *      discard; the negative half of this file is the point of it.
 *
 * ⚠️ RESIDUAL, STATED RATHER THAN HIDDEN: `acked` is a CLAIM. A future caller
 * that passed LOCAL state as `acked` (the fix-4 lie) whose local state happened
 * to be the record plus a member-inserted widget/fact/excerpt at the very end
 * would now be read as caught up. No caller does — all three pass what the
 * server accepted (`commitSave`, `restoreDraft`) or returned
 * (`settleMetadataRevision`) — and `selfForkDoors.test.jsx`'s lie rail still
 * holds for every other shape.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { getNote, listOutbox, putNoteWithIntent } from './notebookDb'
import { settleLandedSave } from './useDurableNote'
import { discardsUnsentWork } from './recoverLocalState'
import { OFFLINE_FLAG_KEY } from './offlineFlag'

const T0 = '2026-09-23T10:00:00.000000+00:00'   // the member's words were written on this
const T2 = '2026-09-23T10:00:20.000000+00:00'   // a door (append, then metadata) moved it here

const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const WIDGET = { type: 'widgetEmbed', attrs: { widgetId: 'w-1', capturedAt: '2026-09-23T10:00:10Z', searchText: 'NVDA' } }
const FACT = { type: 'financialFact', attrs: { factId: 'f-1' } }
const EXCERPT = { type: 'documentExcerpt', attrs: { excerptId: 'x-1' } }
const body = (...blocks) => ({ type: 'doc', content: blocks })

const ONLINE = para('typed online.')
const MINE = para('typed online. typed offline - the sentence that must survive.')
const rec = (bodyJson, extra = {}) => ({ title: 'n', subtitle: '', bodyJson, dirty: 1, ...extra })

describe('THE PREDICATE — a server append on top of the record is not a discard', () => {
  it.each([['widgetEmbed', WIDGET], ['financialFact', FACT], ['documentExcerpt', EXCERPT]])(
    '⭐ the record plus a %s at the end holds everything the record held',
    (_t, node) => {
      expect(discardsUnsentWork(rec(body(MINE)), rec(body(MINE, node)))).toBe(false)
    },
  )

  it('⭐ several server-appended blocks at the end, still not a discard', () => {
    expect(discardsUnsentWork(rec(body(MINE)), rec(body(MINE, WIDGET, FACT, EXCERPT)))).toBe(false)
  })

  // ⛔⛔ THE NEGATIVE HALF. Every one of these still carries — or may carry —
  // words the record owes the server, so every one must still read as a discard.
  it('⛔ a MEMBER-typed paragraph at the end is still a discard', () => {
    expect(discardsUnsentWork(rec(body(MINE)), rec(body(MINE, para('a paragraph a person wrote'))))).toBe(true)
  })

  it('⛔ the member\'s paragraph CHANGED, even with an append beside it, is still a discard', () => {
    expect(discardsUnsentWork(rec(body(MINE)), rec(body(ONLINE, WIDGET)))).toBe(true)
  })

  it('⛔ an append in the MIDDLE is not one the server made, so it is still a discard', () => {
    const prev = rec(body(MINE, para('second')))
    expect(discardsUnsentWork(prev, rec(body(MINE, WIDGET, para('second'))))).toBe(true)
  })

  it('⛔ a TITLE or SUBTITLE change beside the append is authored content — still a discard', () => {
    expect(discardsUnsentWork(rec(body(MINE)), rec(body(MINE, WIDGET), { title: 'renamed' }))).toBe(true)
    expect(discardsUnsentWork(rec(body(MINE)), rec(body(MINE, WIDGET), { subtitle: 'added' }))).toBe(true)
  })

  it('⛔ a block the record HAD and the incoming copy lacks is still a discard', () => {
    expect(discardsUnsentWork(rec(body(MINE, WIDGET)), rec(body(MINE)))).toBe(true)
  })

  it('a CLEAN or absent record still owes nothing (unchanged)', () => {
    expect(discardsUnsentWork(rec(body(MINE), { dirty: 0 }), rec(body(ONLINE)))).toBe(false)
    expect(discardsUnsentWork(null, rec(body(ONLINE)))).toBe(false)
  })
})

describe('THE BASE — unsent work keeps the server copy it was written on', () => {
  let db
  const connect = async () => db
  beforeEach(() => {
    localStorage.setItem(OFFLINE_FLAG_KEY, '1')
    installKeyRange()
    db = createFakeDb()
    globalThis.indexedDB = { open: () => { throw new Error('injected') } }
  })

  const BASE_AT_T0 = { title: 'n', subtitle: '', bodyJson: body(ONLINE), updatedAt: T0 }

  async function queued(serverBase) {
    await putNoteWithIntent(db, {
      noteId: 'n1', title: 'n', subtitle: '', bodyJson: body(MINE),
      baseUpdatedAt: T0, generation: 1, sessionId: 's1', localSavedAt: 1, dirty: 1, serverBase,
    }, {
      mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
      patch: { title: 'n', subtitle: '', bodyJson: body(MINE) },
      baseUpdatedAt: T0, generation: 1, sessionId: 's1', queuedAt: 1,
    })
    await settleIdb(4)
  }

  it('⭐ a metadata door that settles after an append leaves the base at the words\' own revision', async () => {
    await queued(BASE_AT_T0)
    // The server's copy after an append door and then a folder move: it holds
    // the widget. The member's words are not in it.
    const serverAfter = { title: 'n', subtitle: '', bodyJson: body(ONLINE, WIDGET) }
    await settleLandedSave({
      accountId: 'a1', noteId: 'n1', acked: serverAfter,
      current: { title: 'n', subtitle: '', bodyJson: body(MINE) }, updatedAt: T2, connect,
    })
    await settleIdb(4)
    const after = await getNote(db, 'n1')
    // The unsent work is kept exactly as fix 4 keeps it…
    expect(after.dirty).toBe(1)
    expect(after.bodyJson).toEqual(body(MINE))
    expect(after.baseUpdatedAt).toBe(T0)
    expect(await listOutbox(db)).toHaveLength(1)
    // …and its base is the copy those words were written on, NOT the one that
    // already holds the widget — so the drain's diff still sees the append.
    expect(after.serverBase).toEqual(BASE_AT_T0)
  })

  it('a record with no base of its own still falls back to what landed (unchanged)', async () => {
    await queued(null)
    const serverAfter = { title: 'n', subtitle: '', bodyJson: body(ONLINE, WIDGET) }
    await settleLandedSave({
      accountId: 'a1', noteId: 'n1', acked: serverAfter,
      current: { title: 'n', subtitle: '', bodyJson: body(MINE) }, updatedAt: T2, connect,
    })
    await settleIdb(4)
    expect((await getNote(db, 'n1')).serverBase).toEqual({ ...serverAfter, updatedAt: T2 })
  })

  it('⭐ the editor merged the append and saved: the record settles CLEAN on what landed', async () => {
    await queued(BASE_AT_T0)
    // What the editor sent and the server accepted: the member's words plus the
    // server's own appended block. The durable record had not yet seen the merge.
    const sent = { title: 'n', subtitle: '', bodyJson: body(MINE, WIDGET) }
    await settleLandedSave({ accountId: 'a1', noteId: 'n1', acked: sent, current: sent, updatedAt: T2, connect })
    await settleIdb(4)
    const after = await getNote(db, 'n1')
    expect(after.dirty).toBe(0)
    expect(after.bodyJson).toEqual(body(MINE, WIDGET))
    expect(after.baseUpdatedAt).toBe(T2)
    expect(await listOutbox(db), 'nothing is owed — the server holds the words and the widget').toHaveLength(0)
  })

  it('⛔ CONTROL — what landed WITHOUT the member\'s words still keeps them queued', async () => {
    await queued(BASE_AT_T0)
    const serverEcho = { title: 'n', subtitle: '', bodyJson: body(ONLINE, WIDGET) }
    await settleLandedSave({
      accountId: 'a1', noteId: 'n1', acked: serverEcho, current: serverEcho, updatedAt: T2, connect,
    })
    await settleIdb(4)
    expect((await getNote(db, 'n1')).dirty).toBe(1)
    expect(await listOutbox(db)).toHaveLength(1)
  })
})
