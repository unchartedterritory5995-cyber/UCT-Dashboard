/**
 * Wave Q1 round 2 — THE OTHER DOORS, GUARD 2's SECOND ARM, AND §21 INERTNESS.
 *
 * ⚰️ Three of these cases exist because a DERIVED rail found what reading did
 * not: `onFolderChange`, `onTickerChange` and `onTagsChange` advance the
 * server's `updatedAt` without carrying the member's body, so a queued entry
 * goes stale and its next send 409s. Three more doors to one defect — and
 * exactly the doors a hand-written list of "save paths" would never contain,
 * because they do not look like saves.
 *
 * ⛔ THE WIRE RAIL IS NOT A SUBSTITUTE FOR THESE. It proves the call EXISTS; it
 * cannot prove the call is CORRECT. A door that settled with the wrong
 * arguments — local state as `acked`, say — would satisfy the rail completely
 * and delete the member's queued work.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { putNoteWithIntent, getMeta, listOutbox } from './notebookDb'
import { drainOutbox, FORKED, SENT, SUPERSEDED } from './outboxDrain'
import { settleLandedSave, beginInFlightSave, endInFlightSave } from './useDurableNote'
import { markerKeyFor, landedKeyFor, withLanded, LANDED_RING } from './inFlight'
import { OFFLINE_FLAG_KEY } from './offlineFlag'

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const T1 = '2026-09-10T13:00:00.000000+00:00'
const T2 = '2026-09-10T13:00:09.000000+00:00'
const T3 = '2026-09-10T13:00:20.000000+00:00'
const WORDS = 'online. offline.'
const state = (t = WORDS) => ({ title: 'note', subtitle: '', bodyJson: doc(t) })

let db
const connect = async () => db

beforeEach(() => {
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  installKeyRange()
  db = createFakeDb()
  globalThis.indexedDB = { open: () => { throw new Error('injected') } }
})

async function queued(text = WORDS) {
  await putNoteWithIntent(db, {
    noteId: 'n1', ...state(text), baseUpdatedAt: T1,
    generation: 2, sessionId: 's1', localSavedAt: 5, dirty: 1,
  }, {
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
    patch: state(text), baseUpdatedAt: T1, generation: 2, sessionId: 's1', queuedAt: 5,
  })
}

describe('⭐ guard 2, SECOND ARM — the revision this browser recorded as landed', () => {
  // ⚰️ THIS ARM SHIPPED DEAD. `serverCopyIsOursDefault` accepted a
  // `landedRevisions` set and the drain called it with ONE argument, so the
  // condition could never fire and guard 2 recognised only byte-identical
  // bodies. That is precisely the case that does NOT cover the defect: a member
  // who kept typing after the save landed has a body that differs by
  // construction, and the revision is the only remaining evidence.
  it('⛔⛔ 409, revision is OURS but the body DIFFERS ⇒ REBASED AND RESENT, never removed', async () => {
    // ⚰️ THIS CASE ASSERTED THE OPPOSITE UNTIL 2026-09-10, AND THAT COST A
    // MEMBER THEIR WORDS. "Ours" was treated as authorisation to delete: a
    // folder change we made moved the revision, the ring said the copy was
    // ours, and the queued entry was discarded with the offline sentence unsent.
    //
    // ⛔ THE INVARIANT: a queued entry is never removed unless the server body
    // is PROVEN to contain its content. "Ours" tells us the revision is safe to
    // BUILD ON — nobody else wrote it — which is a reason to rebase, never a
    // reason to drop.
    await queued()
    await settleLandedSave({
      accountId: 'a1', noteId: 'n1',
      acked: state('online. offline.'),
      current: state('online. offline. and more.'),
      updatedAt: T2, connect,
    })
    await settleIdb(4)
    expect(await getMeta(db, landedKeyFor('n1'))).toContain(T2)   // the landing was recorded

    let attempt = 0
    const sent = []
    const send = vi.fn(async (e) => {
      attempt += 1
      sent.push(e.baseUpdatedAt)
      if (attempt === 1) { const err = new Error('conflict'); err.status = 409; throw err }
      return { updatedAt: T3 }        // the rebased send succeeds
    })
    const fork = vi.fn()
    const serverCopyIsOurs = async (entry, { landedRevisions } = {}) => (
      landedRevisions && landedRevisions.has(T2)
        ? { ours: true, identical: false, serverUpdatedAt: T2, why: 'ours, but the server does not hold these words' }
        : { ours: false, identical: false, why: 'differs' }
    )
    const results = await drainOutbox(db, { send, fork, serverCopyIsOurs })

    expect(fork).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(2)
    expect(sent[1]).toBe(T2)                                  // rebased onto OUR revision
    expect(results.map((r) => r.outcome)).toEqual([SENT])
    expect(results[0].reason).toMatch(/rebased onto/)
    expect(await listOutbox(db)).toHaveLength(0)              // sent, not discarded
    // ⭐ AND THE WORDS WENT: the resend carried the member's newest text.
    expect(JSON.stringify(send.mock.calls[1][0].patch)).toContain('and more')
  })

  it('⭐ CONTROL — byte-identical still REMOVES, so the rebase path is not universal', async () => {
    // Without this, "never remove" would become "always resend", and every
    // caught-up entry would cost a redundant PUT.
    await queued()
    const send = vi.fn(async () => { const e = new Error('conflict'); e.status = 409; throw e })
    const fork = vi.fn()
    const results = await drainOutbox(db, {
      send, fork,
      serverCopyIsOurs: async () => ({ ours: true, identical: true, serverUpdatedAt: T2, why: 'byte-identical' }),
    })
    expect(send).toHaveBeenCalledTimes(1)      // the first send only; no resend
    expect(fork).not.toHaveBeenCalled()
    expect(results.map((r) => r.outcome)).toEqual([SUPERSEDED])
  })

  it('⭐ CONTROL — a revision we never landed is NOT ours, and still forks', async () => {
    await queued()
    const send = vi.fn(async () => { const e = new Error('conflict'); e.status = 409; throw e })
    const fork = vi.fn(async () => ({ noteId: 'n1', updatedAt: 'someone-elses' }))
    const serverCopyIsOurs = async (entry, { landedRevisions } = {}) => (
      landedRevisions && landedRevisions.has('someone-elses')
        ? { ours: true, why: 'x' }
        : { ours: false, why: 'differs' }
    )
    const results = await drainOutbox(db, { send, fork, serverCopyIsOurs })
    expect(fork).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.outcome)).toEqual([FORKED])
  })

  it('the ring is newest-first, deduped, bounded, and refuses an unusable revision', () => {
    let ring = []
    for (const r of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) ring = withLanded(ring, r)
    expect(ring).toEqual(['r6', 'r5', 'r4', 'r3', 'r2'])
    expect(ring).toHaveLength(LANDED_RING)
    expect(withLanded(['a', 'b'], 'a')).toEqual(['a', 'b'])   // deduped and promoted
    expect(withLanded(['a'], '')).toEqual(['a'])              // '' is not a revision
    expect(withLanded(['a'], null)).toEqual(['a'])
  })
})

describe('⭐ R-B — the folder / ticker / tags doors reach the same defect', () => {
  for (const door of ['folder', 'ticker', 'tags']) {
    it('⛔ ' + door + ' changed while offline work is queued ⇒ REBASED, drain does not fork', async () => {
      await queued('online. offline.')
      // What the door produces: the server acknowledges the METADATA change and
      // returns a new revision. Its body is unchanged — the metadata PUT never
      // carried the member's queued words.
      const serverAfterDoor = { ...state('online. offline.'), updatedAt: T2 }
      await settleLandedSave({
        accountId: 'a1', noteId: 'n1',
        acked: serverAfterDoor,                        // ⛔ the SERVER's copy
        current: state('online. offline. and more.'),  // the member kept typing
        updatedAt: T2, connect,
      })
      await settleIdb(4)

      const q = await listOutbox(db)
      expect(q).toHaveLength(1)                                  // NOT discarded
      expect(q[0].baseUpdatedAt).toBe(T2)                         // rebased
      expect(JSON.stringify(q[0].patch)).toContain('and more')    // newest words kept

      const send = vi.fn(async () => ({ updatedAt: T3 }))
      const fork = vi.fn()
      const results = await drainOutbox(db, { send, fork })
      expect(fork).not.toHaveBeenCalled()
      expect(results.map((r) => r.outcome)).toEqual([SENT])
    })
  }

  it('⭐ CONTROL — a door that does NOT settle leaves the entry stale, and it forks', async () => {
    // The pre-fix behaviour, kept as the control: the metadata PUT lands and
    // nothing settles, so the queued baseline is stale and the send 409s.
    await queued('online. offline.')
    const send = vi.fn(async () => { const e = new Error('conflict'); e.status = 409; throw e })
    const fork = vi.fn(async () => ({ noteId: 'n1', updatedAt: T2 }))
    const results = await drainOutbox(db, { send, fork })
    expect(fork).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.outcome)).toEqual([FORKED])
  })

  it('⛔ a door must NOT pass local state as `acked` — that would delete queued work', async () => {
    // The failure a wire rail cannot see: the call exists, the arguments are
    // wrong, and the member's unsent words are gone.
    await queued('online. offline.')
    const local = state('online. offline. and more.')
    await settleLandedSave({
      accountId: 'a1', noteId: 'n1', acked: local, current: local, updatedAt: T2, connect,
    })
    await settleIdb(4)
    // ⛔ THIS IS THE WRONG OUTCOME, PINNED SO THE SHAPE IS UNMISTAKABLE: acked
    // === current reads as "caught up", so the queue is cleared. The doors pass
    // the SERVER's copy precisely to avoid this.
    expect(await listOutbox(db)).toHaveLength(0)
  })
})

describe('⛔⛔ R-F — §21: with the wave OFF, nothing touches the database', () => {
  it('the key UNSET and the shipped default false ⇒ no settle, no marker, no write', async () => {
    await queued()
    localStorage.removeItem(OFFLINE_FLAG_KEY)     // unset ⇒ the DEFAULT decides
    const before = JSON.stringify(await listOutbox(db))

    expect(await beginInFlightSave({ accountId: 'a1', noteId: 'n1', baseUpdatedAt: T1, connect })).toBeNull()
    expect(await endInFlightSave({ accountId: 'a1', noteId: 'n1', connect })).toBe(false)
    expect(await settleLandedSave({
      accountId: 'a1', noteId: 'n1', acked: state(), current: state(), updatedAt: T2, connect,
    })).toBeNull()
    await settleIdb(4)

    expect(await getMeta(db, markerKeyFor('n1'))).toBeNull()
    expect(await getMeta(db, landedKeyFor('n1'))).toBeNull()
    // ⛔ OFF STOPS PROCESSING — it has never been permission to delete or alter
    // what a member already wrote. The queued entry is exactly as it was.
    expect(JSON.stringify(await listOutbox(db))).toBe(before)
  })

  it('⭐ CONTROL — with the key SET the same calls DO write, so the gate is not an outage', async () => {
    await queued()
    localStorage.setItem(OFFLINE_FLAG_KEY, '1')
    expect(await beginInFlightSave({ accountId: 'a1', noteId: 'n1', baseUpdatedAt: T1, connect })).toBeTruthy()
    await settleIdb(4)
    expect(await getMeta(db, markerKeyFor('n1'))).toBeTruthy()
  })
})
