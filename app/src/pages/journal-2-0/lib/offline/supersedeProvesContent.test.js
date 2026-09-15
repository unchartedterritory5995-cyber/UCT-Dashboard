/**
 * ⛔⛔ AN ENTRY IS NEVER CLEARED AS SUPERSEDED UNLESS THE LANDED SAVE IS PROVEN
 * TO CONTAIN ITS CONTENT. A timestamp is never sufficient.
 *
 * ⚰️ THE MECHANISM, traced from a production RED on 2026-09-13 and reproduced
 * here at unit level before the rig could confirm it.
 *
 * `outboxDrain.js` clears a queued entry when
 * `isSupersededBaseline(entry.baseUpdatedAt, landedBaseline(noteRec))` — a
 * purely TEMPORAL test, `ta < tb` on two parsed timestamps. It never asks
 * whether that landed save contains the entry's words, and it reports the
 * outcome as *"a save this browser landed at T2 is newer than this entry's
 * baseline T1"*, which reads as **the server already has these words**.
 *
 * ⭐ WHAT NORMALLY PROTECTS IT: `landedBaseline` refuses a DIRTY record, so
 * while the editor is mounted and the queued entry is its own pending state the
 * invariant holds. The protection disappears the moment the record is
 * reconciled CLEAN at a newer revision — which is exactly what happens when the
 * member leaves the note and comes back while work is queued: the editor
 * remounts from the server copy, `sameAuthoredContent(acked, current)` is true,
 * and `useDurableNote` writes the record clean at the server's newer baseline.
 *
 * ⛔ THIS IS THE SAME SHAPE AS Q1 FIX 3, ONE GUARD EARLIER. Fix 3 stopped the
 * landed ring from DECIDING before the diff was read. This guard still decides
 * before anything is read at all.
 *
 * MODE: these cases DRIVE the defect. The first one is expected to FAIL against
 * today's drain — that failure is the finding, not a broken test.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { getNote, listOutbox, putNoteWithIntent } from './notebookDb'
import { drainOutbox, SENT, SUPERSEDED } from './outboxDrain'

const T1 = '2026-09-13T17:22:35.000000+00:00'   // the entry's baseline
const T2 = '2026-09-13T17:22:43.000000+00:00'   // the door moved the revision here

const SENTENCE = 'the member typed this offline and it must survive'

const doc = (...paras) => ({
  type: 'doc',
  content: paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })),
})

/** The state a remount leaves behind: the record CLEAN at the server's newer
 *  revision, carrying the SERVER's body — and the member's entry still queued. */
async function seedRemounted(db, { recordBody, entryBody }) {
  const entry = {
    mutationId: 'note:n1',
    noteId: 'n1',
    kind: 'note-update',
    patch: { title: 'n1', subtitle: '', bodyJson: entryBody },
    baseUpdatedAt: T1,
    generation: 3,
    queuedAt: 10,
  }
  await putNoteWithIntent(db, {
    noteId: 'n1', title: 'n1', subtitle: '', bodyJson: recordBody,
    baseUpdatedAt: T2, generation: 3, sessionId: 's1', localSavedAt: 20,
    dirty: 0,                       // ⭐ CLEAN — the remount reconciled it
  }, entry)
  await settleIdb(4)
  return entry
}

let db
beforeEach(async () => {
  installKeyRange()
  db = createFakeDb()
})

describe('supersede must prove content, not compare clocks', () => {
  it('⛔⛔ DOES NOT discard the member\'s words when the landed save lacks them', async () => {
    // The record was reconciled to the SERVER's body — which has the appended
    // block from the door and NOT the member's offline sentence.
    const entry = await seedRemounted(db, {
      recordBody: doc('baseline', 'an appended widget'),
      entryBody: doc('baseline', SENTENCE),
    })
    const sends = []
    const res = await drainOutbox(db, {
      send: async (e) => { sends.push(e); return { id: 'n1', updatedAt: '2026-09-13T17:23:00.000000+00:00' } },
      fork: async () => ({ id: 'fork', updatedAt: 'T9' }),
    })
    await settleIdb()
    const outcome = res.find((r) => r.mutationId === entry.mutationId)?.outcome

    // ⭐ The assertion is about the MEMBER'S WORDS, not about which branch ran.
    // Any outcome is acceptable except losing them: sent, kept, forked — all
    // preserve the sentence. Only a silent supersede destroys it.
    expect(outcome, 'the entry was discarded as superseded although the landed '
      + 'save does not contain its words').not.toBe(SUPERSEDED)
    const stillQueued = (await listOutbox(db)).some((e) => e.mutationId === entry.mutationId)
    const wentOut = sends.some((e) => JSON.stringify(e.patch.bodyJson).includes(SENTENCE))
    expect(wentOut || stillQueued,
      'the sentence neither went to the server nor stayed in the queue').toBe(true)
  })

  it('⭐ CONTROL — a GENUINELY superseded entry is still cleared', async () => {
    // Same shape, one difference that decides everything: the landed save DOES
    // contain the entry's words. Nothing is left to send, and clearing is right.
    // ⛔ Without this control the fix could be "never supersede", which would
    // re-queue work the server already has and 409 forever.
    const entry = await seedRemounted(db, {
      recordBody: doc('baseline', SENTENCE),
      entryBody: doc('baseline', SENTENCE),
    })
    const res = await drainOutbox(db, {
      send: async () => ({ id: 'n1', updatedAt: 'T9' }),
      fork: async () => ({ id: 'fork', updatedAt: 'T9' }),
    })
    await settleIdb()
    expect(res.find((r) => r.mutationId === entry.mutationId)?.outcome).toBe(SUPERSEDED)
    expect((await listOutbox(db)).length).toBe(0)
  })

  it('⭐ CONTROL — a DIRTY record is not a landed save, so nothing is superseded', async () => {
    // The protection that holds while the editor stays mounted. If this ever
    // goes red, the defect above has spread to the ordinary typing path.
    const entry = {
      mutationId: 'note:n2',
      noteId: 'n2',
      kind: 'note-update',
      patch: { title: 'n2', subtitle: '', bodyJson: doc('baseline', SENTENCE) },
      baseUpdatedAt: T1,
      generation: 3,
      queuedAt: 10,
    }
    await putNoteWithIntent(db, {
      noteId: 'n2', title: 'n2', subtitle: '', bodyJson: doc('baseline', SENTENCE),
      baseUpdatedAt: T2, generation: 3, sessionId: 's1', localSavedAt: 20,
      dirty: 1,                     // ⭐ DIRTY — its baseline is a claim, not an ack
    }, entry)
    await settleIdb(4)
    const sends = []
    const res = await drainOutbox(db, {
      send: async (e) => { sends.push(e); return { id: 'n2', updatedAt: 'T9' } },
      fork: async () => ({ id: 'fork', updatedAt: 'T9' }),
    })
    await settleIdb()
    expect(res.find((r) => r.mutationId === entry.mutationId)?.outcome).toBe(SENT)
    expect(sends.length).toBe(1)
  })
})
