/**
 * Wave Q1 round 2 — THE SLOW-PUT ORDERING, where the answer CHANGES mid-drain.
 *
 * ⚰️ THE ORDERING, and it needs no second device and no unusual browser — only
 * a PUT slower than the staleness threshold:
 *
 *   1. the editor raises the marker and issues a PUT
 *   2. the PUT takes longer than IN_FLIGHT_TTL_MS (measured 10 s; a cold pod or
 *      hotel wifi will do it)
 *   3. the drain runs, sees an EXPIRED marker, and asks the server: the slow
 *      PUT has not landed yet, so the server is UNMOVED ⇒ not ours ⇒ send
 *   4. the slow PUT lands FIRST
 *   5. the drain's send 409s
 *
 * ⛔ If step 5 forks, a member with one device gets a `(conflicted copy)` of
 * their own note and is told it "changed elsewhere" — the original defect,
 * reached purely by being slow.
 *
 * ⭐ WHY TWO PASSES AND NOT ONE. The server's answer is not stable across the
 * send: it is "no" at step 3 and "yes" at step 5, because the slow PUT landed in
 * between. A single consultation — at either end — gets one of the two wrong.
 * That is the whole reason guard 2 is asked before the send AND on the 409.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { putNoteWithIntent, putMeta, getMeta, listOutbox } from './notebookDb'
import { drainOutbox, FORKED, SENT, SUPERSEDED } from './outboxDrain'
import { markerFor, markerKeyFor, landedKeyFor, withLanded, IN_FLIGHT_TTL_MS } from './inFlight'
import { OFFLINE_FLAG_KEY } from './offlineFlag'

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const T1 = '2026-09-10T13:00:00.000000+00:00'   // the queued entry's baseline
const T2 = '2026-09-10T13:00:09.000000+00:00'   // where the slow PUT lands
const WORDS = 'online. offline.'
const state = (t = WORDS) => ({ title: 'note', subtitle: '', bodyJson: doc(t) })

let db
beforeEach(() => {
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  installKeyRange()
  db = createFakeDb()
  globalThis.indexedDB = { open: () => { throw new Error('injected') } }
})

/** Queued offline work, and a marker that aged out while its PUT was still on the wire. */
async function slowPutInFlight() {
  await putNoteWithIntent(db, {
    noteId: 'n1', ...state(), baseUpdatedAt: T1,
    generation: 2, sessionId: 's1', localSavedAt: 5, dirty: 1,
  }, {
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
    patch: state(), baseUpdatedAt: T1, generation: 2, sessionId: 's1', queuedAt: 5,
  })
  await putMeta(db, markerKeyFor('n1'), markerFor({
    sessionId: 'the-saving-tab', baseUpdatedAt: T1,
    now: Date.now() - (IN_FLIGHT_TTL_MS + 5_000),   // slower than the threshold
  }))
  await settleIdb(4)
}

describe('⛔⛔ a PUT slower than the TTL must not cost the member a duplicate', () => {
  it('⭐ the server answer CHANGES mid-drain: "no" before the send, "yes" on the 409', async () => {
    await slowPutInFlight()

    // The slow PUT is still on the wire when the drain asks the first time.
    let slowPutHasLanded = false
    const asked = []
    const serverCopyIsOurs = vi.fn(async (entry, { landedRevisions } = {}) => {
      asked.push(slowPutHasLanded)
      return slowPutHasLanded && landedRevisions?.has(T2)
        ? { ours: true, why: `the server revision ${T2} is one this browser recorded as landed` }
        : { ours: false, why: 'the server is unmoved' }
    })

    // Sending is what makes the race resolve: by the time the server answers
    // our PUT, the slow one has landed and recorded itself.
    const send = vi.fn(async () => {
      slowPutHasLanded = true
      await putMeta(db, landedKeyFor('n1'), withLanded(await getMeta(db, landedKeyFor('n1')), T2))
      const e = new Error('conflict'); e.status = 409; throw e
    })
    const fork = vi.fn()

    const results = await drainOutbox(db, {
      send, fork, serverCopyIsOurs, holders: new Set(['someone-else']),
    })

    // ⛔ Asked TWICE, and the two answers differ — that is the point.
    expect(serverCopyIsOurs).toHaveBeenCalledTimes(2)
    expect(asked).toEqual([false, true])
    expect(send).toHaveBeenCalledTimes(1)          // the first answer permitted the send
    expect(fork).not.toHaveBeenCalled()            // the second prevented the fork
    expect(results.map((r) => r.outcome)).toEqual([SUPERSEDED])
    expect(results[0].reason).toMatch(/recorded as landed/)
    expect(await listOutbox(db)).toHaveLength(0)
  })

  it('⭐⭐ CONTROL — a genuinely FOREIGN 409 in the same ordering still forks', async () => {
    // Identical timing, identical expired marker. The only difference is that
    // the server copy is somebody else's — and that must still be preserved.
    await slowPutInFlight()
    const serverCopyIsOurs = vi.fn(async () => ({ ours: false, why: 'the server copy differs and is not one of ours' }))
    const send = vi.fn(async () => { const e = new Error('conflict'); e.status = 409; throw e })
    const fork = vi.fn(async () => ({ noteId: 'n1', updatedAt: 'theirs', bodyJson: doc('someone else') }))

    const results = await drainOutbox(db, { send, fork, serverCopyIsOurs, holders: new Set(['x']) })

    expect(serverCopyIsOurs).toHaveBeenCalledTimes(2)   // asked both times
    expect(fork).toHaveBeenCalledTimes(1)               // and still forked
    expect(results.map((r) => r.outcome)).toEqual([FORKED])
  })

  it('⛔ the PRE-SEND pass alone resolves it when the slow PUT already landed', async () => {
    // The same expiry, but the drain arrives after the PUT landed. Nothing
    // should be sent at all — a send that cannot succeed must not be attempted.
    await slowPutInFlight()
    await putMeta(db, landedKeyFor('n1'), withLanded([], T2))
    await settleIdb(4)

    const send = vi.fn()
    const fork = vi.fn()
    const serverCopyIsOurs = vi.fn(async (entry, { landedRevisions } = {}) => (
      landedRevisions?.has(T2) ? { ours: true, why: 'recorded as landed' } : { ours: false, why: 'no' }
    ))
    const results = await drainOutbox(db, { send, fork, serverCopyIsOurs, holders: new Set(['x']) })

    expect(send).not.toHaveBeenCalled()
    expect(fork).not.toHaveBeenCalled()
    expect(results.map((r) => r.outcome)).toEqual([SUPERSEDED])
    expect(results[0].reason).toMatch(/expired in-flight save turned out to have landed/)
  })

  it('⛔ a pre-send check that THROWS falls through to the send, never to a discard', async () => {
    await slowPutInFlight()
    let calls = 0
    const serverCopyIsOurs = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('offline again')
      return { ours: false, why: 'differs' }
    })
    const send = vi.fn(async () => ({ updatedAt: T2 }))
    const results = await drainOutbox(db, { send, fork: vi.fn(), serverCopyIsOurs, holders: new Set(['x']) })
    expect(send).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.outcome)).toEqual([SENT])
  })

  it('⭐ CONTROL — with NO marker at all the pre-send pass does not fire', async () => {
    // The expiry path must be reached by an EXPIRED marker, not by every entry.
    // Without this, the drain would make a GET per entry per sweep.
    await putNoteWithIntent(db, {
      noteId: 'n1', ...state(), baseUpdatedAt: T1, generation: 2, sessionId: 's1', localSavedAt: 5, dirty: 1,
    }, {
      mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
      patch: state(), baseUpdatedAt: T1, generation: 2, sessionId: 's1', queuedAt: 5,
    })
    await settleIdb(4)
    const serverCopyIsOurs = vi.fn()
    const send = vi.fn(async () => ({ updatedAt: T2 }))
    await drainOutbox(db, { send, fork: vi.fn(), serverCopyIsOurs })
    expect(serverCopyIsOurs).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
  })
})
