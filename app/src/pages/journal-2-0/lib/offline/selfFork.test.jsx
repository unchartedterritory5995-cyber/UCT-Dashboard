/**
 * Wave Q1 — WHY A SINGLE WRITER FORKS ITS OWN NOTE.
 *
 * Found 2026-09-10 by the compressed evidence set: one browser, one account, no
 * second device, and ~1 offline session in 5 came back as a `(conflicted copy)`
 * while the app said the note had "changed elsewhere". It had not.
 *
 * The supersede that should prevent this ALREADY EXISTS — `putNoteWithIntent`
 * deletes every queued entry for a note when the intent is null, and
 * `markSynced` passes null once the editor has caught up. So the question these
 * tests answer is not "is there a supersede" but "can the supersede be missed".
 *
 * ⛔ THE ANSWER IS THE MOUNT. `markSynced` routes through `writerRef.current`,
 * and returns null when the writer is gone. Navigating away is exactly when the
 * note leaves `excludeNoteId` and becomes the sweep's — so the one moment the
 * supersede is most needed is the one moment it cannot run.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { putNoteWithIntent, listOutbox, getNote } from './notebookDb'
import { drainOutbox, FORKED, SENT } from './outboxDrain'
import { useDurableNote } from './useDurableNote'
import { OFFLINE_FLAG_KEY } from './offlineFlag'

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const T1 = '2026-09-10T13:00:00.000000+00:00'
const T2 = '2026-09-10T13:00:09.000000+00:00'

let db

beforeEach(() => {
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  installKeyRange()
  db = createFakeDb()
  globalThis.indexedDB = { open: () => { throw new Error('injected') } }
})

/** The member typed offline: a durable record and a queued entry, both on T1. */
async function queueOfflineWork() {
  await putNoteWithIntent(db, {
    noteId: 'n1', title: 'note', subtitle: '', bodyJson: doc('online. offline.'),
    baseUpdatedAt: T1, generation: 2, sessionId: 's1', localSavedAt: 5, dirty: 1,
  }, {
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
    patch: { title: 'note', subtitle: '', bodyJson: doc('online. offline.') },
    baseUpdatedAt: T1, generation: 2, sessionId: 's1', queuedAt: 5,
  })
}

describe('⭐ THE DETERMINISTIC REPRODUCTION — every time, not 1 in 5', () => {
  it('⛔⛔ a queued entry SURVIVES the editor save when the editor has unmounted, and forks', async () => {
    await queueOfflineWork()

    // The editor's own save lands, moving the server T1 → T2 … but the member
    // has already navigated away, so the durable writer is gone.
    const { result, unmount } = renderHook(() => useDurableNote({
      accountId: 'acct1', noteId: 'n1', connect: async () => db,
    }))
    unmount()
    await act(async () => {
      result.current.markSynced({
        acked: { title: 'note', subtitle: '', bodyJson: doc('online. offline.') },
        current: { title: 'note', subtitle: '', bodyJson: doc('online. offline.') },
        updatedAt: T2,
      })
      await settleIdb(4)
    })

    // ⛔ The supersede did not run: the entry is still queued, still on T1.
    const queued = await listOutbox(db)
    expect(queued).toHaveLength(1)
    expect(queued[0].baseUpdatedAt).toBe(T1)

    // …and the sweep, which owns the note the moment it closed, now sends a
    // baseline the server has already moved past. 409. Fork.
    const conflict = Object.assign(new Error('conflict'), { status: 409 })
    const fork = vi.fn(async () => ({ id: 'n1', updatedAt: T2, bodyJson: doc('online. offline.') }))
    const results = await drainOutbox(db, {
      send: vi.fn(async () => { throw conflict }), fork, excludeNoteId: null,
    })
    await settleIdb()

    expect(results[0].outcome).toBe(FORKED)
    expect(fork).toHaveBeenCalledTimes(1)   // ← the member's duplicate note
  })

  it('⭐ CONTROL: while the editor is STILL MOUNTED the supersede runs and nothing forks', async () => {
    await queueOfflineWork()
    const { result } = renderHook(() => useDurableNote({
      accountId: 'acct1', noteId: 'n1', connect: async () => db,
    }))
    await act(async () => {
      result.current.markSynced({
        acked: { title: 'note', subtitle: '', bodyJson: doc('online. offline.') },
        current: { title: 'note', subtitle: '', bodyJson: doc('online. offline.') },
        updatedAt: T2,
      })
      await settleIdb(6)
    })

    expect(await listOutbox(db)).toHaveLength(0)      // superseded
    const fork = vi.fn()
    const results = await drainOutbox(db, { send: vi.fn(), fork })
    expect(fork).not.toHaveBeenCalled()
    expect(results).toHaveLength(0)
  })

  it('⭐ CONTROL: an entry carrying the CURRENT baseline sends cleanly', async () => {
    await putNoteWithIntent(db, {
      noteId: 'n1', title: 'note', subtitle: '', bodyJson: doc('words'),
      baseUpdatedAt: T2, generation: 3, sessionId: 's1', localSavedAt: 5, dirty: 1,
    }, {
      mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
      patch: { title: 'note', subtitle: '', bodyJson: doc('words') },
      baseUpdatedAt: T2, generation: 3, sessionId: 's1', queuedAt: 5,
    })
    const fork = vi.fn()
    const results = await drainOutbox(db, {
      send: vi.fn(async () => ({ id: 'n1', updatedAt: '2026-09-10T13:00:20+00:00' })), fork,
    })
    await settleIdb()
    expect(results[0].outcome).toBe(SENT)
    expect(fork).not.toHaveBeenCalled()
  })

  it('⛔ and the durable record is left claiming a baseline the server moved past', async () => {
    await queueOfflineWork()
    const rec = await getNote(db, 'n1')
    expect(rec.baseUpdatedAt).toBe(T1)
    expect(rec.dirty).toBe(1)
  })
})
