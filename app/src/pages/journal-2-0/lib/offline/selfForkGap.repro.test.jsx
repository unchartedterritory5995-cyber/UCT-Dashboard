/**
 * ⛔⛔ REPRODUCTION ONLY — NOT A RAIL, NOT PART OF THE GATE.
 *
 * This file exists to prove ONE claim about deploy #4's fix, deterministically,
 * without another reproduction on the live canary account. It asserts the
 * CURRENT behaviour, so it is GREEN today and must be DELETED (or inverted) by
 * whatever fix lands. ⛔ Do not read it as a guard. A test that pins a defect is
 * a measurement with an expiry date.
 *
 * THE CLAIM. `outboxDrain.js` says of its supersede refusal:
 *
 *     "This closes the remaining ordering: the drain claims the entry in the
 *      window between the unmount and the save resolving, so no settle could
 *      have run yet. Both are needed; neither is redundant."
 *
 * It cannot. The refusal asks `landedBaseline(noteRec)`, and `landedBaseline`
 * returns null for a DIRTY record — deliberately, and correctly, because a
 * dirty record's baseline is what its next send will CLAIM, not what the server
 * has acknowledged. But in exactly the window the comment describes, nothing
 * has settled yet, so the record IS still dirty. `landed` is null,
 * `isSupersededBaseline` refuses on a null side, and the drain SENDS. The
 * server has moved on, so the PUT 409s, and a 409 forks.
 *
 * ⭐ THE DEEPER POINT: the browser does not locally KNOW a save landed until
 * `settleLandedSave` writes it. That knowledge lives in an in-flight promise.
 * So the second guard is not defence in depth for this window — it is a
 * FOLLOW-UP CHECK that can only fire after the first guard has already won.
 * Two guards that share a precondition are one guard.
 *
 * This is consistent with what was measured on 2026-09-10 after deploy #4 went
 * live: runs 2 and 3 both started already opted in, run 2 was clean and run 3
 * forked — intermittent, because it turns on whether the settle beats the drain.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { putNoteWithIntent, listOutbox, getNote } from './notebookDb'
import { drainOutbox, FORKED, SENT, SUPERSEDED } from './outboxDrain'
import { landedBaseline, isSupersededBaseline } from './baseline'
import { OFFLINE_FLAG_KEY } from './offlineFlag'

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const T1 = '2026-09-10T13:00:00.000000+00:00'   // what the queued entry claims
const T2 = '2026-09-10T13:00:09.000000+00:00'   // what the server actually holds now
const WORDS = 'online. offline.'
const state = (t = WORDS) => ({ title: 'note', subtitle: '', bodyJson: doc(t) })

let db
beforeEach(() => {
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  installKeyRange()
  db = createFakeDb()
  globalThis.indexedDB = { open: () => { throw new Error('injected') } }
})

/**
 * The state at the instant the drain claims: the member's words are queued on
 * T1, a save carrying them has ALREADY LANDED on the server at T2, and
 * `settleLandedSave` has NOT run yet — so the record is still dirty and still
 * says T1. This is the window the drain's comment claims to close.
 */
async function theWindow() {
  await putNoteWithIntent(db, {
    noteId: 'n1', ...state(), baseUpdatedAt: T1,
    generation: 2, sessionId: 's1', localSavedAt: 5, dirty: 1,
  }, {
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
    patch: state(), baseUpdatedAt: T1, generation: 2, sessionId: 's1', queuedAt: 5,
  })
}

describe('⛔ the supersede refusal cannot fire in the window it was written for', () => {
  it('the authority itself: a DIRTY record yields no landed baseline, so nothing is superseded', async () => {
    await theWindow()
    const rec = await getNote(db, 'n1')

    expect(rec.dirty).toBe(1)
    expect(landedBaseline(rec)).toBeNull()                    // by design, and correct
    // ...and therefore the drain's question can only ever answer "no":
    expect(isSupersededBaseline(T1, landedBaseline(rec))).toBe(false)
    // The control, so this is not passing for the wrong reason — the SAME entry
    // against a CLEAN record on T2 is correctly recognised as superseded:
    expect(isSupersededBaseline(T1, landedBaseline({ dirty: 0, baseUpdatedAt: T2 }))).toBe(true)
  })

  it('⛔ end to end: the drain SENDS the stale entry and the note FORKS', async () => {
    await theWindow()

    // The server has moved past T1 because this browser's own save landed there.
    const send = vi.fn(async () => { const e = new Error('conflict'); e.status = 409; throw e })
    const fork = vi.fn(async () => ({ noteId: 'n2', title: 'note (conflicted copy)' }))

    const results = await drainOutbox(db, { send, fork })
    await settleIdb(4)

    // ⛔ The refusal never fires...
    expect(results.map((r) => r.outcome)).not.toContain(SUPERSEDED)
    // ...the send is attempted with the baseline the server has already passed...
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].baseUpdatedAt).toBe(T1)
    // ...and the member gets a duplicate of their own note, one device, no one else.
    expect(fork).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.outcome)).toContain(FORKED)
  })

  it('⭐ and it is fixed the moment the settle wins the race — the guards share a precondition', async () => {
    await theWindow()
    // Exactly what `settleLandedSave` writes when it wins: clean record on T2.
    const prev = await getNote(db, 'n1')
    await putNoteWithIntent(db, { ...prev, baseUpdatedAt: T2, dirty: 0 }, null)
    await settleIdb(4)

    const send = vi.fn()
    const fork = vi.fn()
    const results = await drainOutbox(db, { send, fork })

    expect(send).not.toHaveBeenCalled()
    expect(fork).not.toHaveBeenCalled()
    expect(results).toHaveLength(0)      // putNoteWithIntent(_, null) already cleared it
    // ⛔ THE POINT: the ONLY thing standing between the member and a duplicate
    // is whether the settle beat the drain. That is a race, not a guard.
  })
})
