/**
 * ⭐⭐ D3b (wave 6) — THE PER-NOTE OWNER LOCK: a note open in an editor in ONE
 * tab is not sent by the sweep of ANOTHER.
 *
 * ⚰️ The defect (`wave5-A-report.md` concern 2, `f5-fixes-2026-09-23.md` §B.5):
 * `excludeNoteId` is per mount. With the note open in tab A and tab B holding the
 * sync-leader lock, B's sweep sent A's queued words while A's editor — which
 * adopts and sends those words itself (F5P-1) — was still their writer. Two
 * writers on one note.
 *
 * Two tabs here are two CLIENTS of one lock manager (`fakeWebLocks.js`), which is
 * what two tabs of one origin are: a lock tab A holds is visible to tab B's
 * `navigator.locks.query()`. The drain is the real `drainOutbox` over the real
 * adapter and an in-memory IndexedDB.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { createLockManager } from './__fixtures__/fakeWebLocks'
import { putNoteWithIntent, putMeta, listOutbox } from './notebookDb'
import { drainOutbox, SENT, SKIPPED } from './outboxDrain'
import { markerFor, markerKeyFor, landedKeyFor, withLanded, IN_FLIGHT_TTL_MS } from './inFlight'
import {
  holdNoteOwnerLock, isNoteOwned, noteOwnerLockName, ownedNoteIds,
} from './noteOwnerLock'

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const T0 = '2026-09-23T09:00:00.000000+00:00'
const T1 = '2026-09-23T09:05:00.000000+00:00'
const tick = async (n = 4) => { for (let i = 0; i < n; i += 1) await Promise.resolve() }  // eslint-disable-line no-await-in-loop

let db
beforeEach(() => {
  installKeyRange()
  db = createFakeDb()
})

async function queue(noteId, words, { baseUpdatedAt = T0 } = {}) {
  await putNoteWithIntent(db, {
    noteId, title: 'note', subtitle: '', bodyJson: doc(words), baseUpdatedAt,
    generation: 1, sessionId: 's1', localSavedAt: 5, dirty: 1,
    serverBase: { title: 'note', subtitle: '', bodyJson: doc('online'), updatedAt: baseUpdatedAt },
  }, {
    mutationId: `note:${noteId}`, noteId, kind: 'note-update',
    patch: { title: 'note', subtitle: '', bodyJson: doc(words) },
    baseUpdatedAt, generation: 1, sessionId: 's1', queuedAt: 5,
  })
  await settleIdb(4)
}

describe('holdNoteOwnerLock — the claim, as every tab sees it', () => {
  it('⭐ holds `uct-note-owner:<account>:<note>` and ANOTHER tab’s query sees it; release frees it', async () => {
    const mgr = createLockManager()
    const release = holdNoteOwnerLock('a1', 'n1', { locks: mgr.client('A'), target: null })
    await tick()
    expect(mgr.heldNames()).toEqual([noteOwnerLockName('a1', 'n1')])
    expect(noteOwnerLockName('a1', 'n1')).toBe('uct-note-owner:a1:n1')
    expect(await isNoteOwned('a1', 'n1', { locks: mgr.client('B') })).toBe(true)
    expect(await isNoteOwned('a1', 'n2', { locks: mgr.client('B') })).toBe(false)
    release()
    await tick()
    expect(mgr.heldNames()).toEqual([])
    expect(await isNoteOwned('a1', 'n1', { locks: mgr.client('B') })).toBe(false)
    release()            // idempotent
  })

  it('⭐ the same note open in a SECOND tab queues behind the first — and still reads as owned', async () => {
    const mgr = createLockManager()
    const releaseA = holdNoteOwnerLock('a1', 'n1', { locks: mgr.client('A'), target: null })
    const releaseB = holdNoteOwnerLock('a1', 'n1', { locks: mgr.client('B'), target: null })
    await tick()
    expect(mgr.pendingNames()).toEqual([noteOwnerLockName('a1', 'n1')])
    releaseA()
    await tick(8)
    expect(await isNoteOwned('a1', 'n1', { locks: mgr.client('C') }), 'B still has it open').toBe(true)
    expect(mgr.heldNames()).toEqual([noteOwnerLockName('a1', 'n1')])
    releaseB()
    await tick(8)
    expect(await isNoteOwned('a1', 'n1', { locks: mgr.client('C') })).toBe(false)
  })

  it('⛔ a release while still QUEUED cancels the request, and the rejection is never unhandled', async () => {
    const mgr = createLockManager()
    const unhandled = vi.fn()
    const proc = globalThis.process
    proc.on('unhandledRejection', unhandled)
    try {
      const releaseA = holdNoteOwnerLock('a1', 'n1', { locks: mgr.client('A'), target: null })
      const releaseB = holdNoteOwnerLock('a1', 'n1', { locks: mgr.client('B'), target: null })
      await tick()
      releaseB()                        // unmounted before it was ever granted
      await tick(8)
      expect(mgr.pendingNames()).toEqual([])
      releaseA()
      await tick(8)
      expect(mgr.heldNames(), 'nothing claims the note once both editors are gone').toEqual([])
      await new Promise((r) => setTimeout(r, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      proc.off('unhandledRejection', unhandled)
    }
  })

  it('⭐ `pagehide` releases it; a `pageshow` that RESTORES the page takes it again', async () => {
    const mgr = createLockManager()
    const target = new EventTarget()
    const release = holdNoteOwnerLock('a1', 'n1', { locks: mgr.client('A'), target })
    await tick()
    expect(mgr.heldNames()).toHaveLength(1)
    target.dispatchEvent(new Event('pagehide'))
    await tick(8)
    expect(mgr.heldNames(), 'a page in the back-forward cache still claimed the note').toEqual([])
    const notRestored = new Event('pageshow')
    notRestored.persisted = false
    target.dispatchEvent(notRestored)
    await tick(8)
    expect(mgr.heldNames()).toEqual([])
    const restored = new Event('pageshow')
    restored.persisted = true
    target.dispatchEvent(restored)
    await tick(8)
    expect(mgr.heldNames(), 'the restored page is the note’s editor again').toHaveLength(1)
    release()
    await tick(8)
    expect(mgr.heldNames()).toEqual([])
    target.dispatchEvent(restored)      // after release, lifecycle events do nothing
    await tick(8)
    expect(mgr.heldNames()).toEqual([])
  })

  it('⛔ NO WEB LOCKS (an old engine, an insecure context): nothing is taken, nothing throws, and the answer is UNKNOWN', async () => {
    expect(() => holdNoteOwnerLock('a1', 'n1', { locks: undefined, target: null })()).not.toThrow()
    expect(() => holdNoteOwnerLock('a1', 'n1', { locks: {}, target: null })()).not.toThrow()
    expect(await ownedNoteIds('a1', { locks: undefined })).toBeNull()
    expect(await ownedNoteIds('a1', { locks: { request: () => {} } }), 'request without query is still unknown').toBeNull()
    expect(await isNoteOwned('a1', 'n1', { locks: undefined })).toBeNull()
  })

  it('⛔ a request or a query that THROWS is no lock and no answer — never a crash', async () => {
    const throwing = {
      request: () => { throw new Error('SecurityError') },
      query: async () => { throw new Error('SecurityError') },
    }
    expect(() => holdNoteOwnerLock('a1', 'n1', { locks: throwing, target: null })()).not.toThrow()
    expect(await ownedNoteIds('a1', { locks: throwing })).toBeNull()
    const rejecting = { request: () => Promise.reject(new Error('refused')) }
    expect(() => holdNoteOwnerLock('a1', 'n1', { locks: rejecting, target: null })()).not.toThrow()
  })

  it('⭐ only THIS account’s owner locks count — not another account’s, not the sync or session locks', async () => {
    const mgr = createLockManager()
    holdNoteOwnerLock('a1', 'n1', { locks: mgr.client('A'), target: null })
    holdNoteOwnerLock('a2', 'n9', { locks: mgr.client('A'), target: null })
    mgr.client('A').request('uct.nb.sync.a1', { ifAvailable: true }, () => new Promise(() => {}))
    mgr.client('A').request('uct.nb.session.s1', () => new Promise(() => {}))
    await tick(8)
    expect([...await ownedNoteIds('a1', { locks: mgr.client('B') })]).toEqual(['n1'])
    expect([...await ownedNoteIds('a2', { locks: mgr.client('B') })]).toEqual(['n9'])
  })
})

describe('⭐⭐ two tabs — the leader skips the note open in the other tab, and sends everything else', () => {
  const server = () => {
    const sent = []
    return {
      sent,
      send: vi.fn(async (entry) => { sent.push(entry.noteId); return { updatedAt: T1 } }),
      fork: vi.fn(async () => { throw new Error('nothing here should fork') }),
    }
  }
  // Tab B leads; it has nothing open, so its own `excludeNoteId` is null.
  const sweepOfTabB = (mgr, s, extra = {}) => drainOutbox(db, {
    send: s.send, fork: s.fork, noteIsOwned: (id) => isNoteOwned('a1', id, { locks: mgr.client('B') }), ...extra,
  })

  it('⭐ the leader skips the OWNED note and sends an unowned one', async () => {
    await queue('n1', 'queued in tab A, which has the note open')
    await queue('n2', 'queued for a note nobody has open')
    const mgr = createLockManager()
    holdNoteOwnerLock('a1', 'n1', { locks: mgr.client('A'), target: null })
    await tick()
    const s = server()
    const results = await sweepOfTabB(mgr, s)
    await settleIdb(4)
    expect(s.sent, 'tab B sent the note tab A is editing').toEqual(['n2'])
    expect(results.find((r) => r.noteId === 'n1')?.outcome).toBe(SKIPPED)
    expect(results.find((r) => r.noteId === 'n2')?.outcome).toBe(SENT)
    expect((await listOutbox(db)).map((e) => e.noteId), 'the owned note’s words wait for its owner').toEqual(['n1'])
  })

  it('⭐ owner released (the note closed): the NEXT sweep sends it', async () => {
    await queue('n1', 'queued in tab A')
    const mgr = createLockManager()
    const release = holdNoteOwnerLock('a1', 'n1', { locks: mgr.client('A'), target: null })
    await tick()
    const s = server()
    await sweepOfTabB(mgr, s)
    expect(s.sent).toEqual([])
    release()
    await tick(8)
    await sweepOfTabB(mgr, s)
    await settleIdb(4)
    expect(s.sent).toEqual(['n1'])
    expect(await listOutbox(db)).toHaveLength(0)
  })

  it('⛔ NO WEB LOCKS: byte-identical to before — the answer is unknown, `excludeNoteId` alone decides, and the note is sent', async () => {
    await queue('n1', 'queued')
    await queue('n2', 'queued too')
    const withOption = await (async () => {
      const s = server()
      const r = await drainOutbox(db, {
        send: s.send, fork: s.fork, noteIsOwned: (id) => isNoteOwned('a1', id, { locks: undefined }),
      })
      return { r, sent: s.sent }
    })()
    await settleIdb(4)
    // the same fixture again, drained exactly as before D3b (no option at all)
    db = createFakeDb()
    await queue('n1', 'queued')
    await queue('n2', 'queued too')
    const s2 = server()
    const without = await drainOutbox(db, { send: s2.send, fork: s2.fork })
    expect(withOption.r).toEqual(without)
    expect(withOption.sent).toEqual(s2.sent)
    expect(withOption.sent).toEqual(['n1', 'n2'])
  })

  it('⛔ a `noteIsOwned` that THROWS or answers null is unknown — never "owned", never a crash', async () => {
    await queue('n1', 'queued')
    const s = server()
    await drainOutbox(db, { send: s.send, fork: s.fork, noteIsOwned: async () => { throw new Error('boom') } })
    await settleIdb(4)
    expect(s.sent).toEqual(['n1'])
    await queue('n2', 'queued')
    await drainOutbox(db, { send: s.send, fork: s.fork, noteIsOwned: async () => null })
    expect(s.sent).toEqual(['n1', 'n2'])
  })

  it('⛔ the FIRST check: an owned note is never touched — no server question, no rebase of its entry', async () => {
    // An expired in-flight marker would send the drain to ask the server and,
    // on a ring-vouched revision, REBASE the entry before sending. An owned
    // note must not get that far: it is its owner's to send.
    await queue('n1', 'queued in tab A')
    await putMeta(db, markerKeyFor('n1'), markerFor({
      sessionId: 'gone', baseUpdatedAt: T0, now: Date.now() - (IN_FLIGHT_TTL_MS + 5000),
    }))
    await putMeta(db, landedKeyFor('n1'), withLanded([], T1))
    await settleIdb(4)
    const mgr = createLockManager()
    holdNoteOwnerLock('a1', 'n1', { locks: mgr.client('A'), target: null })
    await tick()
    const serverCopyIsOurs = vi.fn(async () => ({
      ours: true, identical: false, serverUpdatedAt: T1,
      serverNote: { title: 'note', subtitle: '', bodyJson: doc('online'), updatedAt: T1 }, why: 'ours',
    }))
    const s = server()
    await sweepOfTabB(mgr, s, { serverCopyIsOurs })
    await settleIdb(4)
    expect(serverCopyIsOurs, 'the sweep worked on a note another tab owns').not.toHaveBeenCalled()
    expect((await listOutbox(db))[0].baseUpdatedAt, 'the owned note’s entry was rebased by the sweep').toBe(T0)
    expect(s.sent).toEqual([])
  })

  it('⛔ the LAST check: a note opened while the sweep was deciding is not sent after all', async () => {
    await queue('n1', 'queued')
    // not owned when the sweep reaches it; owned by the time it would send
    const noteIsOwned = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const s = server()
    const results = await drainOutbox(db, { send: s.send, fork: s.fork, noteIsOwned })
    expect(noteIsOwned).toHaveBeenCalledTimes(2)
    expect(s.sent, 'sent after the note had been opened in an editor').toEqual([])
    expect(results[0].outcome).toBe(SKIPPED)
  })
})
