/**
 * ⭐⭐ Follow-up D (2026-11-13), F1 — THE DRAIN SETTLES A RECORD PROVEN EQUAL TO THE SERVER.
 *
 * ⚰️ THE DEFECT. A save reached the server (200) but the page navigated before it saw the
 * answer. The device kept the record `dirty: 1`, its entry, and a marker from a dead tab. The
 * drain then asked the server, found exactly those words, and removed the ENTRY only. The
 * record stayed dirty for good: trash, bulk trash, tag rename, sample removal and the other
 * `noteHasUnsentWork` doors refused with "has changes that have not finished saving".
 *
 * ⛔ What each case asserts is the member-facing fact (`noteHasUnsentWork`) and the store, and
 * every settle has a control where the proof is missing and nothing is marked clean.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { getMeta, getNote, listOutbox, putMeta, putNoteWithIntent } from './notebookDb'
import { drainOutbox, settleIfServerHolds, SUPERSEDED, SKIPPED, KEPT } from './outboxDrain'
import { markerFor, markerKeyFor, landedKeyFor } from './inFlight'
import { noteHasUnsentWork } from './noteHasUnsentWork'
import { serverCopyIsOursDefault } from './useOutboxDrain'
import { OFFLINE_FLAG_KEY } from './offlineFlag'

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const S0 = '2026-11-13T10:00:00.000000+00:00'
const S1 = '2026-11-13T10:00:06.000000+00:00'
const SAVED = 'the words the PUT carried, and the server applied'
const words = (t = SAVED) => ({ title: 'Thesis', subtitle: '', bodyJson: doc(t) })
const LANDED_BEFORE = ['2026-11-13T09:00:00.000000+00:00']

let db
const connect = async () => db
const unsent = () => noteHasUnsentWork('n1', { accountId: 'a1', connect })

beforeEach(async () => {
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  installKeyRange()
  globalThis.indexedDB = { open: () => { throw new Error('injected') } }
  db = createFakeDb()
})

/** What `commitSave` leaves when the page dies after the PUT went out: record and entry
 *  holding C on S0, a marker from a tab that is gone, and a landed ring without S1. */
async function landedUnseen({ record = SAVED, entry = SAVED, marker = true } = {}) {
  await putNoteWithIntent(db, {
    noteId: 'n1', ...words(record), baseUpdatedAt: S0, generation: 4, sessionId: 'gone',
    localSavedAt: 5, dirty: 1, serverBase: { ...words('before'), updatedAt: S0 },
  }, {
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update', patch: words(entry),
    baseUpdatedAt: S0, generation: 4, sessionId: 'gone', queuedAt: 5,
  })
  if (marker) await putMeta(db, markerKeyFor('n1'), markerFor({ sessionId: 'gone', baseUpdatedAt: S0 }))
  await putMeta(db, landedKeyFor('n1'), LANDED_BEFORE)
  await settleIdb(4)
}

const identicalAt = (at) => vi.fn(async () => ({ ours: true, identical: true, serverUpdatedAt: at, why: 'byte-identical' }))
const conflict = () => { const e = new Error('note changed'); e.status = 409; return e }

describe('⭐ F1 (a): dirty record + one entry equal to the server ⇒ clean, entry gone, no send', () => {
  it('pre-send branch (a dead tab\'s marker), through the REAL server check', async () => {
    await landedUnseen()
    expect((await unsent()).unsent).toBe(true)   // the false hold, before the fix runs
    globalThis.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ note: { id: 'n1', ...words(), updatedAt: S1 } }),
    }))
    const send = vi.fn(); const fork = vi.fn()
    const results = await drainOutbox(db, { send, fork, holders: new Set(), serverCopyIsOurs: serverCopyIsOursDefault })
    await settleIdb(4)

    expect(send).not.toHaveBeenCalled()
    expect(fork).not.toHaveBeenCalled()
    expect(results.map((r) => r.outcome)).toEqual([SUPERSEDED])
    expect(await listOutbox(db)).toEqual([])
    const rec = await getNote(db, 'n1')
    expect(rec).toMatchObject({ dirty: 0, baseUpdatedAt: S1, serverBase: null, ...words() })
    // ⛔ identical content is not proof THIS browser wrote S1: the ring is untouched
    expect(await getMeta(db, landedKeyFor('n1'))).toEqual(LANDED_BEFORE)
    expect(await unsent()).toEqual({ unsent: false, why: null })
  })

  it('409 branch (no marker: the send 409s, the server holds the words)', async () => {
    await landedUnseen({ marker: false })
    const send = vi.fn(async () => { throw conflict() }); const fork = vi.fn()
    const results = await drainOutbox(db, { send, fork, serverCopyIsOurs: identicalAt(S1) })
    await settleIdb(4)

    expect(send).toHaveBeenCalledTimes(1)
    expect(fork).not.toHaveBeenCalled()
    expect(results.map((r) => r.outcome)).toEqual([SUPERSEDED])
    expect(await listOutbox(db)).toEqual([])
    expect(await getNote(db, 'n1')).toMatchObject({ dirty: 0, baseUpdatedAt: S1, serverBase: null })
    expect(await getMeta(db, landedKeyFor('n1'))).toEqual(LANDED_BEFORE)
    expect((await unsent()).unsent).toBe(false)
  })

  it('⛔ control: the RECORD holds other words than the entry ⇒ it stays dirty; the proven entry goes, as before', async () => {
    await landedUnseen({ record: `${SAVED} and more typed after` })
    await drainOutbox(db, { send: vi.fn(), fork: vi.fn(), holders: new Set(), serverCopyIsOurs: identicalAt(S1) })
    await settleIdb(4)
    const rec = await getNote(db, 'n1')
    expect(rec).toMatchObject({ dirty: 1, baseUpdatedAt: S0, ...words(`${SAVED} and more typed after`) })
    expect(await listOutbox(db)).toEqual([])
    expect((await unsent()).why).toBe('dirty')
  })

  it('⛔ control: no usable server revision ⇒ nothing is marked clean (absence of proof keeps)', async () => {
    await landedUnseen()
    await drainOutbox(db, { send: vi.fn(), fork: vi.fn(), holders: new Set(), serverCopyIsOurs: identicalAt(null) })
    await settleIdb(4)
    expect((await getNote(db, 'n1')).dirty).toBe(1)
    expect(await listOutbox(db)).toEqual([])
  })
})

describe('⭐ F1 (b): two entries for the note, one differing ⇒ only the identical one goes', () => {
  it('the record stays dirty, the differing entry stays queued with its words', async () => {
    await landedUnseen()
    await putNoteWithIntent(db, await getNote(db, 'n1'), {
      mutationId: 'legacy:n1', noteId: 'n1', kind: 'note-update', patch: words('older words, never sent'),
      baseUpdatedAt: S0, generation: 2, sessionId: 'gone', queuedAt: 3,
    })
    await settleIdb(4)
    const serverCopyIsOurs = vi.fn(async (entry) => (entry.mutationId === 'note:n1'
      ? { ours: true, identical: true, serverUpdatedAt: S1, why: 'byte-identical' }
      : { ours: false, identical: false, serverUpdatedAt: S1, why: 'differs' }))
    const send = vi.fn(async () => { throw new Error('offline again') })
    const results = await drainOutbox(db, { send, fork: vi.fn(), holders: new Set(), serverCopyIsOurs })
    await settleIdb(4)

    expect(Object.fromEntries(results.map((r) => [r.mutationId, r.outcome])))
      .toEqual({ 'note:n1': SUPERSEDED, 'legacy:n1': KEPT })
    expect((await getNote(db, 'n1')).dirty).toBe(1)
    const left = await listOutbox(db)
    expect(left.map((e) => e.mutationId)).toEqual(['legacy:n1'])
    expect(left[0].patch).toEqual(words('older words, never sent'))
  })
})

describe('⭐ F1 (c): the store moved between the drain\'s read and its transaction ⇒ nothing marked clean', () => {
  it('a newer capture (record AND entry rewritten) lands while the server is asked: both survive', async () => {
    await landedUnseen()
    const NEWER = 'typed in another tab while the drain was asking'
    const serverCopyIsOurs = vi.fn(async () => {
      await putNoteWithIntent(db, {
        noteId: 'n1', ...words(NEWER), baseUpdatedAt: S0, generation: 9, sessionId: 'other', localSavedAt: 9, dirty: 1,
      }, {
        mutationId: 'note:n1', noteId: 'n1', kind: 'note-update', patch: words(NEWER),
        baseUpdatedAt: S0, generation: 9, sessionId: 'other', queuedAt: 9,
      })
      return { ours: true, identical: true, serverUpdatedAt: S1, why: 'byte-identical (to the OLD entry)' }
    })
    const send = vi.fn(); const fork = vi.fn()
    const results = await drainOutbox(db, { send, fork, holders: new Set(), serverCopyIsOurs })
    await settleIdb(4)

    expect(send).not.toHaveBeenCalled()
    expect(results.map((r) => r.outcome)).toEqual([SKIPPED])
    expect(await getNote(db, 'n1')).toMatchObject({ dirty: 1, ...words(NEWER) })
    // ⛔ the clear by id alone deleted these words' entry before follow-up D
    const left = await listOutbox(db)
    expect(left).toHaveLength(1)
    expect(left[0].patch).toEqual(words(NEWER))
  })

  it('the helper itself: a record that is not dirty, or not equal, is never written clean', async () => {
    await landedUnseen()
    expect(await settleIfServerHolds(db, 'n1', words('something else'), S1)).toBe(null)
    expect(await settleIfServerHolds(db, 'n1', words(), null)).toBe(null)
    await settleIdb(4)
    expect((await getNote(db, 'n1')).dirty).toBe(1)
    expect(await listOutbox(db)).toHaveLength(1)
    expect(await settleIfServerHolds(db, 'n1', words(), S1)).toBe('settled')
    await settleIdb(4)
    expect((await getNote(db, 'n1')).dirty).toBe(0)
    expect(await listOutbox(db)).toEqual([])
  })
})
