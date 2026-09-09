/**
 * Wave Q1 — the durable working copy as the editor will actually use it.
 *
 * These rails run the REAL adapter (`notebookDb.js`) against an in-memory
 * IndexedDB stand-in, because jsdom implements none of it. The first describe
 * block proves the stand-in can tell a one-transaction write from two — without
 * that control, the atomicity rail below would pass for any implementation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createFakeDb, settleIdb, installKeyRange } from './fakeIndexedDb'
import { putNoteWithIntent, getNote, listOutbox } from './notebookDb'
import { useDurableNote, outboxIdFor, __resetNotebookConnections, UNAVAILABLE } from './useDurableNote'
import { DURABLE, FAILED, PENDING } from './durableWriter'

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const SERVER = { title: 'Thesis', subtitle: '', bodyJson: doc('server'), updatedAt: 'T1' }

beforeEach(() => {
  installKeyRange()
  __resetNotebookConnections()
  // The hook asks the PLATFORM whether a durable store is possible at all;
  // jsdom answers no. The store it then uses is injected, so this stub only
  // needs to exist, never to work.
  if (!globalThis.indexedDB) globalThis.indexedDB = { open: () => { throw new Error('injected in tests') } }
})

describe('⭐ the control: the stand-in enforces the transaction', () => {
  it('an aborting write leaves NEITHER the note nor its intent', async () => {
    const db = createFakeDb({ failStore: 'outbox' })
    await expect(putNoteWithIntent(
      db,
      { noteId: 'n1', title: 'work', dirty: 1 },
      { mutationId: 'm1', noteId: 'n1' },
    )).rejects.toBeTruthy()
    await settleIdb()
    // ⛔ If the fake wrote straight through, the note would be here and only
    // the outbox row missing — and the atomicity rail below would prove
    // nothing about the adapter.
    expect(db.dump('notes')).toEqual([])
    expect(db.dump('outbox')).toEqual([])
  })

  it('and a healthy write commits both', async () => {
    const db = createFakeDb()
    await putNoteWithIntent(db, { noteId: 'n1', title: 'work', dirty: 1 }, { mutationId: 'm1', noteId: 'n1' })
    expect(db.dump('notes')).toHaveLength(1)
    expect(db.dump('outbox')).toHaveLength(1)
  })
})

function mount(db, extra = {}) {
  const connect = vi.fn(async () => db)
  const view = renderHook(() => useDurableNote({
    accountId: 'acct1', noteId: 'n1', debounceMs: 0, connect, ...extra,
  }))
  return { ...view, connect }
}

describe('a burst of keystrokes', () => {
  it('lands ONE durable record carrying the newest state, and ONE intent', async () => {
    const db = createFakeDb()
    const { result } = mount(db)
    await act(async () => {
      for (const text of ['a', 'ab', 'abc']) {
        result.current.schedule({ title: 'Thesis', subtitle: '', bodyJson: doc(text), baseUpdatedAt: 'T1' })
      }
      await settleIdb()
    })
    const notes = db.dump('notes')
    const outbox = db.dump('outbox')
    expect(notes).toHaveLength(1)
    expect(notes[0].bodyJson).toEqual(doc('abc'))
    expect(notes[0].dirty).toBe(1)
    // ⛔ One queued update per note — the outbox holds what we still owe the
    // server, not a transcript of what was typed.
    expect(outbox).toHaveLength(1)
    expect(outbox[0].mutationId).toBe(outboxIdFor('n1'))
    expect(outbox[0].patch.bodyJson).toEqual(doc('abc'))
    expect(outbox[0].baseUpdatedAt).toBe('T1')
  })

  it('says PENDING before the write commits and DURABLE only after', async () => {
    const db = createFakeDb()
    const { result } = mount(db)
    act(() => { result.current.schedule({ title: 'x', bodyJson: doc('x') }) })
    // ⛔ §13 — nothing may claim "Saved on this device" here.
    expect(result.current.status).toBe(PENDING)
    expect(result.current.unsynced).toBe(false)
    await act(async () => { await settleIdb() })
    expect(result.current.status).toBe(DURABLE)
    expect(result.current.unsynced).toBe(true)
  })

  it('the record and its intent are written in ONE transaction', async () => {
    // The adapter opens exactly one readwrite transaction spanning both stores;
    // the control above shows the stand-in would expose two.
    const db = createFakeDb()
    const spy = vi.spyOn(db, 'transaction')
    const { result } = mount(db)
    await act(async () => {
      result.current.schedule({ title: 't', bodyJson: doc('t') })
      await settleIdb()
    })
    const writes = spy.mock.calls.filter((c) => c[1] === 'readwrite')
    expect(writes).toHaveLength(1)
    expect(writes[0][0]).toEqual(expect.arrayContaining(['notes', 'outbox']))
  })
})

describe('⛔ a server ack only clears what the server actually has', () => {
  it('clears the intent when the editor has not moved on', async () => {
    const db = createFakeDb()
    const { result } = mount(db)
    const state = { title: 'Thesis', subtitle: '', bodyJson: doc('one'), baseUpdatedAt: 'T1' }
    await act(async () => { result.current.schedule(state); await settleIdb() })
    expect(db.dump('outbox')).toHaveLength(1)

    await act(async () => {
      result.current.markSynced({ acked: state, current: state, updatedAt: 'T2' })
      await settleIdb()
    })
    expect(await listOutbox(db)).toEqual([])
    const rec = await getNote(db, 'n1')
    expect(rec.dirty).toBe(0)
    expect(rec.baseUpdatedAt).toBe('T2')
    expect(result.current.unsynced).toBe(false)
  })

  it('⭐ KEEPS the intent when the member kept typing during the save', async () => {
    // THE CONTROL for the rail above. The server acked "one"; the editor holds
    // "one two". Clearing the outbox on that ack would drop the newest words
    // with every check still green.
    const db = createFakeDb()
    const { result } = mount(db)
    const acked = { title: 'Thesis', subtitle: '', bodyJson: doc('one'), baseUpdatedAt: 'T1' }
    const current = { title: 'Thesis', subtitle: '', bodyJson: doc('one two'), baseUpdatedAt: 'T1' }
    await act(async () => { result.current.schedule(current); await settleIdb() })

    await act(async () => {
      result.current.markSynced({ acked, current, updatedAt: 'T2' })
      await settleIdb()
    })
    const outbox = await listOutbox(db)
    expect(outbox).toHaveLength(1)
    expect(outbox[0].patch.bodyJson).toEqual(doc('one two'))
    // …and re-based on the revision the server just created, so the retry is a
    // compare-and-set against the right baseline rather than a stale 409.
    expect(outbox[0].baseUpdatedAt).toBe('T2')
    expect((await getNote(db, 'n1')).dirty).toBe(1)
    expect(result.current.unsynced).toBe(true)
  })
})

describe('⛔ a failed durable write never reads as saved', () => {
  it('reports FAILED and leaves `unsynced` false', async () => {
    const db = createFakeDb({ failStore: 'notes' })
    const { result } = mount(db)
    await act(async () => {
      result.current.schedule({ title: 'work', bodyJson: doc('work') })
      await settleIdb()
    })
    expect(result.current.status).toBe(FAILED)
    expect(result.current.error).toBeTruthy()
    // ⛔ NOT durable, so the surface has nothing true to claim.
    expect(result.current.unsynced).toBe(false)
    expect(db.dump('notes')).toEqual([])
  })
})

describe('reopen recovery', () => {
  it('offers a dirty durable copy', async () => {
    const db = createFakeDb()
    await putNoteWithIntent(db, {
      noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: doc('offline work'),
      dirty: 1, generation: 4, sessionId: 's-old', localSavedAt: 10, baseUpdatedAt: 'T1',
    }, null)
    const { result } = mount(db)
    let recovery
    await act(async () => { recovery = await result.current.recover({ server: SERVER }) })
    expect(recovery.source).toBe('idb')
    expect(recovery.unsynced).toBe(true)
    expect(recovery.state.bodyJson).toEqual(doc('offline work'))
  })

  it('⛔ does NOT offer a CLEAN copy the server has since moved past', async () => {
    // The record says dirty:0 — the server already had this content, so a
    // server copy that now differs is NEWER, written by another device.
    // Offering the local one back invites pushing yesterday over today.
    const db = createFakeDb()
    await putNoteWithIntent(db, {
      noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: doc('what device A synced'),
      dirty: 0, generation: 9, sessionId: 's-old', localSavedAt: 10, baseUpdatedAt: 'T0',
    }, null)
    const { result } = mount(db)
    let recovery
    await act(async () => { recovery = await result.current.recover({ server: SERVER }) })
    expect(recovery.source).toBe('server')
    expect(recovery.unsynced).toBe(false)
  })

  it('still recovers a legacy localStorage draft when there is no durable copy', async () => {
    const db = createFakeDb()
    const { result } = mount(db)
    let recovery
    await act(async () => {
      recovery = await result.current.recover({
        server: SERVER,
        lsDraft: { title: 'Thesis', subtitle: '', bodyJson: doc('crash window'), savedAt: 99 },
      })
    })
    expect(recovery.source).toBe('localStorage')
    expect(recovery.baseUpdatedAt).toBe('T1')
  })
})

describe('no durable store here', () => {
  it('degrades truthfully instead of pretending', async () => {
    const db = createFakeDb()
    const { result } = mount(db, { accountId: null })
    expect(result.current.supported).toBe(false)
    expect(result.current.status).toBe(UNAVAILABLE)
    // ⛔ A no-op, not a throw: offline storage being impossible must never take
    // the editor down with it.
    let gen
    act(() => { gen = result.current.schedule({ title: 'x' }) })
    expect(gen).toBeNull()
    expect(result.current.unsynced).toBe(false)
  })
})
