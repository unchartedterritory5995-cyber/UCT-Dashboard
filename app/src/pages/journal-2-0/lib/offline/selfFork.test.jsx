/**
 * Wave Q1 — A SINGLE WRITER MUST NEVER FORK ITS OWN NOTE.
 *
 * ⚰️ THE DEFECT, 2026-09-10. One browser, one account, no second device, and
 * ~1 offline session in 5 came back as a `(conflicted copy)` while the app said
 * the note had "changed elsewhere". It had not.
 *
 * The supersede was never missing — `putNoteWithIntent` deletes every queued
 * entry for a note when the intent is null. It was MISSED: `markSynced` routes
 * through `writerRef.current` and does nothing once the editor has unmounted,
 * and the save resolves after the member navigates away. Navigating away is
 * exactly when the note leaves `excludeNoteId` and becomes the sweep's, so the
 * queue's most important moment was the one it could not settle.
 *
 * ⛔ TWO GUARDS, NEITHER REDUNDANT:
 *   `settleLandedSave` settles the queue whether or not the editor is mounted.
 *   The drain refuses to send an entry older than a save this browser landed —
 *   which closes the ordering where the drain claims the entry in the window
 *   between the unmount and the save resolving, before any settle could run.
 *
 * ⛔ `excludeNoteId` IS NOT THE FIX and is untouched. It protects the note while
 * it is OPEN. This protects a queued entry whose baseline the editor invalidated
 * before handing the note back. Two windows, two guards.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { putNoteWithIntent, listOutbox, getNote } from './notebookDb'
import { drainOutbox, FORKED, SENT, SUPERSEDED } from './outboxDrain'
import { useDurableNote, settleLandedSave } from './useDurableNote'
import { landedBaseline, isSupersededBaseline } from './baseline'
import { OFFLINE_FLAG_KEY } from './offlineFlag'

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const T1 = '2026-09-10T13:00:00.000000+00:00'
const T2 = '2026-09-10T13:00:09.000000+00:00'
const WORDS = 'online. offline.'
const state = (t = WORDS) => ({ title: 'note', subtitle: '', bodyJson: doc(t) })

let db

beforeEach(() => {
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  installKeyRange()
  db = createFakeDb()
  globalThis.indexedDB = { open: () => { throw new Error('injected') } }
})

/** The member typed offline: a durable record and a queued entry, both on T1. */
async function queueOfflineWork(text = WORDS) {
  await putNoteWithIntent(db, {
    noteId: 'n1', ...state(text), baseUpdatedAt: T1,
    generation: 2, sessionId: 's1', localSavedAt: 5, dirty: 1,
  }, {
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
    patch: state(text), baseUpdatedAt: T1, generation: 2, sessionId: 's1', queuedAt: 5,
  })
}

const connect = async () => db

describe('⭐⭐ THE FIX — the supersede survives unmount', () => {
  it('⭐ unmount, THEN the save resolves ⇒ the queue is settled and nothing forks', async () => {
    // This is the exact ordering that produced the member-visible defect.
    // §MUTATION: delete the `settleLandedSave` call in NoteEditorPage's save
    // path and the browser reproduces it again; delete the function body's
    // `putNoteWithIntent` and this goes red.
    await queueOfflineWork()
    const { result, unmount } = renderHook(() => useDurableNote({ accountId: 'a1', noteId: 'n1', connect }))
    unmount()
    await act(async () => {
      result.current.markSynced({ acked: state(), current: state(), updatedAt: T2 })  // does nothing: no writer
      await settleLandedSave({ accountId: 'a1', noteId: 'n1', acked: state(), current: state(), updatedAt: T2, connect })
      await settleIdb(4)
    })

    expect(await listOutbox(db)).toHaveLength(0)          // superseded
    const rec = await getNote(db, 'n1')
    expect(rec.baseUpdatedAt).toBe(T2)
    expect(rec.dirty).toBe(0)

    const fork = vi.fn()
    const results = await drainOutbox(db, { send: vi.fn(), fork })
    expect(fork).not.toHaveBeenCalled()
    expect(results).toHaveLength(0)
  })

  it('⛔ a settle with NO IDENTITY writes nothing — it cannot guess whose store', async () => {
    // ⚰️ THIS RAIL EXISTS BECAUSE A MUTATION FOUND NOTHING TO BREAK.
    // `settleLandedSave` opens the durable store BY ACCOUNT. Its guard is
    // `if (!accountId || !noteId || !landed) return null`, and the mutation
    // gauntlet reduced that to `if (!landed)` — every rail stayed green. Eleven
    // tests drove this function and every one of them passed a full identity,
    // so the half of the guard that keeps one member's save out of another
    // member's store was never exercised.
    //
    // ⛔ The dangerous direction is not "returns null". It is the WRITE that a
    // missing identity would let through: `connect(undefined)` resolves to some
    // store, and a save then lands in it under a note id of `undefined`. So the
    // assertion is that the connection is NEVER OPENED and the existing record
    // is untouched — not merely that the return value is null.
    await queueOfflineWork()
    const before = await getNote(db, 'n1')
    const opened = vi.fn(async () => db)

    for (const identity of [
      { noteId: 'n1' },                                // no accountId
      { accountId: 'a1' },                             // no noteId
      { accountId: '', noteId: 'n1' },                 // empty is not an identity
      { accountId: 'a1', noteId: '' },
      {},                                              // neither
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const out = await settleLandedSave({ ...identity, acked: state(), current: state(), updatedAt: T2, connect: opened })
      expect(out).toBeNull()
    }

    expect(opened).not.toHaveBeenCalled()              // ⛔ the store was never opened
    const after = await getNote(db, 'n1')
    expect(after).toEqual(before)                      // ...and nothing moved
    expect(await listOutbox(db)).toHaveLength(1)       // the member's queued work is still queued
  })

  it('⭐ still AHEAD of the server ⇒ the entry is REBASED, not deleted', async () => {
    // ⛔ Clearing the outbox on the strength of an ack for older words is how
    // offline systems lose the newest ones. The member kept typing; those words
    // survive, and they get a baseline that can actually succeed.
    await queueOfflineWork()
    await act(async () => {
      await settleLandedSave({
        accountId: 'a1', noteId: 'n1',
        acked: state('online. offline.'), current: state('online. offline. and more.'),
        updatedAt: T2, connect,
      })
      await settleIdb(4)
    })
    const queued = await listOutbox(db)
    expect(queued).toHaveLength(1)
    expect(queued[0].baseUpdatedAt).toBe(T2)                       // rebased
    expect(JSON.stringify(queued[0].patch)).toContain('and more')  // newest words kept
  })

  it('⭐ CONTROL: still mounted ⇒ the existing supersede already handles it', async () => {
    await queueOfflineWork()
    const { result } = renderHook(() => useDurableNote({ accountId: 'a1', noteId: 'n1', connect }))
    await act(async () => {
      result.current.markSynced({ acked: state(), current: state(), updatedAt: T2 })
      await settleIdb(6)
    })
    expect(await listOutbox(db)).toHaveLength(0)
  })
})

describe('⭐⭐ DEFENCE IN DEPTH — the drain refuses a superseded entry', () => {
  it('⭐ drain claims the entry BEFORE any settle ran ⇒ superseded, never sent', async () => {
    // The remaining ordering: the drain picks the entry up in the window between
    // the unmount and the save resolving. No settle could have run yet, so the
    // drain has to catch it itself.
    // §MUTATION: remove the drain's supersede branch and this forks.
    await queueOfflineWork()
    // the save landed — the record is clean on T2 — but the entry was missed
    const rec = await getNote(db, 'n1')
    await putNoteWithIntent(db, { ...rec, baseUpdatedAt: T2, dirty: 0 }, { ...(await listOutbox(db))[0] })

    const send = vi.fn()
    const fork = vi.fn()
    const results = await drainOutbox(db, { send, fork })
    await settleIdb()

    expect(results[0].outcome).toBe(SUPERSEDED)
    expect(send).not.toHaveBeenCalled()          // ⛔ never attempted
    expect(fork).not.toHaveBeenCalled()          // ⛔ therefore never forked
    expect(results[0].reason).toMatch(/newer than this entry's baseline/)
    expect(await listOutbox(db)).toHaveLength(0) // removed: nothing left to say
  })

  it('⛔ CONTROL: an entry on the CURRENT baseline is sent, not superseded', async () => {
    await putNoteWithIntent(db, {
      noteId: 'n1', ...state('words'), baseUpdatedAt: T2,
      generation: 3, sessionId: 's1', localSavedAt: 5, dirty: 1,
    }, {
      mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
      patch: state('words'), baseUpdatedAt: T2, generation: 3, sessionId: 's1', queuedAt: 5,
    })
    const send = vi.fn(async () => ({ id: 'n1', updatedAt: '2026-09-10T13:00:20+00:00' }))
    const results = await drainOutbox(db, { send, fork: vi.fn() })
    await settleIdb()
    expect(results[0].outcome).toBe(SENT)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('⛔⛔ CONTROL: a DIRTY record never vouches for itself', async () => {
    // A dirty record's baseline is what its next send will CLAIM, not what the
    // server acknowledged. If it counted as "landed", every queued entry would
    // supersede itself and the member's work would be deleted unsent.
    await queueOfflineWork()
    const send = vi.fn(async () => ({ id: 'n1', updatedAt: T2 }))
    const results = await drainOutbox(db, { send, fork: vi.fn() })
    await settleIdb()
    expect(results[0].outcome).toBe(SENT)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('⛔ a REAL conflict — another device moved the server — still forks', async () => {
    // The fix must not swallow the case the fork exists for.
    await queueOfflineWork()
    const conflict = Object.assign(new Error('conflict'), { status: 409 })
    const fork = vi.fn(async () => ({ id: 'n1', updatedAt: T2, bodyJson: doc('theirs') }))
    const results = await drainOutbox(db, {
      send: vi.fn(async () => { throw conflict }), fork,
    })
    await settleIdb()
    expect(results[0].outcome).toBe(FORKED)
    expect(fork).toHaveBeenCalledTimes(1)
  })
})

describe('⛔ THE ONE AUTHORITY for "a save this browser landed"', () => {
  it('only a CLEAN record witnesses a landed save', () => {
    expect(landedBaseline({ baseUpdatedAt: T2, dirty: 0 })).toBe(T2)
    expect(landedBaseline({ baseUpdatedAt: T2, dirty: 1 })).toBeNull()
    expect(landedBaseline(null)).toBeNull()
  })

  it('older ⇒ superseded; equal or newer ⇒ not', () => {
    expect(isSupersededBaseline(T1, T2)).toBe(true)
    expect(isSupersededBaseline(T2, T2)).toBe(false)
    expect(isSupersededBaseline(T2, T1)).toBe(false)
  })

  it('⛔⛔ it REFUSES on anything it cannot parse — this decision deletes work', () => {
    expect(isSupersededBaseline(null, T2)).toBe(false)
    expect(isSupersededBaseline('', T2)).toBe(false)
    expect(isSupersededBaseline(T1, null)).toBe(false)
    expect(isSupersededBaseline('not-a-date', T2)).toBe(false)
    expect(isSupersededBaseline(T1, 'not-a-date')).toBe(false)
  })

  it('⛔ compares INSTANTS, not strings — offsets must not decide', () => {
    // 12:00:00Z and 13:00:00+01:00 are the same instant. A lexicographic
    // comparison would call one older and delete a queued entry for it.
    expect(isSupersededBaseline('2026-09-10T12:00:00Z', '2026-09-10T13:00:00+01:00')).toBe(false)
    expect(isSupersededBaseline('2026-09-10T13:00:00+01:00', '2026-09-10T12:00:00Z')).toBe(false)
  })
})
