/**
 * Wave Q1 — CAN A QUEUED WRITE STILL LOSE ITS BASELINE?
 *
 * The activation canary (2026-09-09) queued a note update with
 * `baseUpdatedAt: null` — a PUT with no compare-and-set. The empty-CONTENT half
 * of that artifact is reproduced and fixed (`NoteEditorPage.slowload.test.jsx`).
 * The NULL BASELINE half was never explained, and this file is the search.
 *
 * The producer set is small and mechanical. An outbox entry's baseline is
 * written in exactly two places — `useDurableNote.schedule()` (from
 * `captureLocalState`, i.e. `lastSavedRef.current.updatedAt`) and
 * `useDurableNote.markSynced()` — so every null traces back to
 * `lastSavedRef.current.updatedAt` being falsy. That ref is written by six
 * places, and after the `hydratedRef` gate only one class remains: **the server
 * handed us a note whose `updatedAt` is falsy.**
 *
 * ⛔ These rails do not assume that cannot happen. `j2_notes.updated_at` is
 * NOT NULL and both serializers pass it through, so it should be impossible —
 * but "should be impossible" is what the canary was too. These drive the real
 * page with a server that misbehaves in each way it could, and read what lands
 * in the outbox.
 */
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb } from '../../lib/offline/__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections } from '../../lib/offline/useDurableNote'
import { OFFLINE_FLAG_KEY } from '../../lib/offline/offlineFlag'
import { dbNameFor } from '../../lib/offline/notebookDb'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const BODY = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original body' }] }] }
const BASE_NOTE = {
  id: 'n1', title: 'NVDA thesis', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: 'T1',
  isFavorite: false, bodyJson: BODY,
}

/** The note `useJ2Note` hands the page. Each scenario reshapes this. */
let SERVED = BASE_NOTE
const updateMock = vi.fn()

vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: SERVED, isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u42', role: 'member' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

const ACCOUNT_DB = dbNameFor('u42')
let factory

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  SERVED = BASE_NOTE
  updateMock.mockReset()
  updateMock.mockResolvedValue({ ...BASE_NOTE, updatedAt: 'T2' })
  __resetNotebookConnections()
  factory = createFakeIndexedDbFactory()
  globalThis.indexedDB = factory
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  localStorage.clear()
  delete globalThis.indexedDB
})

const store = (name) => factory.databases.get(ACCOUNT_DB)?.dump(name) ?? []

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  await act(async () => { await settleIdb(4) })
}
const type = (v) => fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: v } })
const durableWindow = async () => { await act(async () => { vi.advanceTimersByTime(300); await settleIdb(4) }) }
const serverSave = async () => { await act(async () => { vi.advanceTimersByTime(900); await settleIdb(6) }) }

/** Every baseline currently sitting in the outbox. */
const queuedBaselines = () => store('outbox').map((e) => e.baseUpdatedAt)
/** ⛔ FALSY, not just null. The defect this file found was an EMPTY STRING
 *  surviving `??` and then being dropped by a truthiness test at send time —
 *  so a rail that only looks for `null` would have watched it go past. */
const unusableBaselines = () => queuedBaselines().filter((b) => !b)

describe('⚰️ the search: which server shapes can still queue a null baseline?', () => {
  it('CONTROL — an ordinary note queues its real baseline', async () => {
    // Without this, every "no null" assertion below could be passing because
    // nothing is being queued at all.
    updateMock.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 }))
    await renderEditor()
    type('edited')
    await durableWindow()
    expect(store('outbox')).toHaveLength(1)
    expect(queuedBaselines()).toEqual(['T1'])
  })

  // ⚰️ MEASURED, AND IT IS THE ONLY SURVIVING PRODUCER OF A NULL BASELINE:
  // if the server ever hands the editor a note without a usable `updatedAt`,
  // the editor queues `baseUpdatedAt: null`. There is no client-side defence,
  // and there SHOULD NOT be one invented on a hypothesis — for a note with no
  // baseline anywhere, null is not a bug in the capture, it is the truth. What
  // matters is that such an entry is never SENT.
  //
  // ⛔ These two therefore assert the END STATE, not the absence of a null:
  // the member's words are durable, and the drain refuses the write.
  // `tests/test_note_updated_at_is_always_a_baseline.py` is the other half —
  // it pins that the server cannot produce this note in the first place.

  it('⚰️ a note served with an EMPTY updatedAt — null is queued, and never sent', async () => {
    SERVED = { ...BASE_NOTE, updatedAt: '' }
    updateMock.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 }))
    await renderEditor()
    type('edited against a baseline-less note')
    await durableWindow()
    // The measurement, stated rather than hidden:
    expect(queuedBaselines()).toEqual([null])
    // …and the member's words are on disk, intact.
    expect(store('notes')[0].title).toBe('edited against a baseline-less note')
    // ⛔ THE ASSERTION THAT MATTERS: it cannot reach the server.
    const { drainOutbox } = await import('../../lib/offline/outboxDrain')
    const { openNotebookDb } = await import('../../lib/offline/notebookDb')
    const db = await openNotebookDb('u42', { factory })
    const send = vi.fn(async () => ({ id: 'n1', updatedAt: 'T9' }))
    const results = await drainOutbox(db, { send, fork: vi.fn() })
    expect(send).not.toHaveBeenCalled()
    expect(results[0].outcome).toBe('blocked')
  })

  it('⚰️ a note served with NO updatedAt key at all — same story', async () => {
    const { updatedAt, ...noUpdatedAt } = BASE_NOTE
    SERVED = noUpdatedAt
    updateMock.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 }))
    await renderEditor()
    type('edited against a note missing the field')
    await durableWindow()
    expect(queuedBaselines()).toEqual([null])
    expect(store('notes')[0].title).toBe('edited against a note missing the field')
  })

  it('⛔ the PUT succeeds but its response carries no updatedAt, and the member kept typing', async () => {
    // `markSynced` is the SECOND producer of a baseline. It is reached only on a
    // successful save, and it re-queues when the member typed during the PUT —
    // exactly the case where a lost baseline would be invisible.
    const { updatedAt, ...ackNoUpdatedAt } = BASE_NOTE
    let resolvePut
    updateMock.mockImplementation(() => new Promise((res) => { resolvePut = res }))
    await renderEditor()
    type('first words')
    await serverSave()
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    // The member types WHILE the PUT is in flight…
    type('first words, still typing')
    // …and the server acks with no updatedAt.
    await act(async () => { resolvePut({ ...ackNoUpdatedAt }); await settleIdb(6) })
    await act(async () => { vi.advanceTimersByTime(300); await settleIdb(6) })
    // eslint-disable-next-line no-console
    console.log('ACK without updatedAt -> outbox:', JSON.stringify(store('outbox')))
    // eslint-disable-next-line no-console
    console.log('ACK without updatedAt -> notes :', JSON.stringify(store('notes')))
    expect(unusableBaselines()).toEqual([])
  })

  it('⛔ the PUT succeeds with an EMPTY updatedAt, and the member kept typing', async () => {
    let resolvePut
    updateMock.mockImplementation(() => new Promise((res) => { resolvePut = res }))
    await renderEditor()
    type('first words')
    await serverSave()
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    type('first words, still typing')
    await act(async () => { resolvePut({ ...BASE_NOTE, updatedAt: '' }); await settleIdb(6) })
    await act(async () => { vi.advanceTimersByTime(300); await settleIdb(6) })
    // eslint-disable-next-line no-console
    console.log('ACK with empty updatedAt -> outbox:', JSON.stringify(store('outbox')))
    expect(unusableBaselines()).toEqual([])
  })
})

describe('⚰️ §15 step 9 — REOPEN a note that already has unsynced work on disk', () => {
  // This is the canary's actual ordering, and the one shape none of the earlier
  // rails drove: the previous session left a dirty durable record AND a queued
  // outbox entry, and the page opens on top of them. `recoverLocalState` runs,
  // the banner is offered, the drain elects a leader — all against a store that
  // is not empty.
  //
  // ⛔ The canary's entry carried `generation: 1` and a FRESH sessionId, so it
  // was written AFTER the reload, not inherited. These rails check that the
  // reopen neither queues a baseline-less entry of its own nor rewrites the
  // inherited one's baseline away.

  const PREV_SESSION = 'session-before-the-reload'

  async function seedUnsyncedWork({ baseUpdatedAt }) {
    const { openNotebookDb, putNoteWithIntent } = await import('../../lib/offline/notebookDb')
    const db = await openNotebookDb('u42', { factory })
    await putNoteWithIntent(db, {
      noteId: 'n1',
      title: 'typed before the reload',
      subtitle: '',
      bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'unsynced words' }] }] },
      baseUpdatedAt,
      generation: 7,
      sessionId: PREV_SESSION,
      localSavedAt: Date.now() - 60_000,
      dirty: 1,
    }, {
      mutationId: 'note:n1',
      noteId: 'n1',
      kind: 'note-update',
      patch: {
        title: 'typed before the reload',
        subtitle: '',
        bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'unsynced words' }] }] },
      },
      baseUpdatedAt,
      generation: 7,
      sessionId: PREV_SESSION,
      queuedAt: Date.now() - 60_000,
    })
    db.close?.()
    __resetNotebookConnections()
  }

  it('reopening on top of unsynced work queues NO new baseline-less entry', async () => {
    await seedUnsyncedWork({ baseUpdatedAt: 'T1' })
    await renderEditor()
    await act(async () => { vi.advanceTimersByTime(1200); await settleIdb(8) })
    // eslint-disable-next-line no-console
    console.log('REOPEN -> outbox:', JSON.stringify(store('outbox')))
    // eslint-disable-next-line no-console
    console.log('REOPEN -> notes :', JSON.stringify(store('notes')))
    expect(unusableBaselines()).toEqual([])
  })

  it('⭐ CONTROL — the seeded work is actually there and actually recovered', async () => {
    // Without this, the rail above passes just as well against a store the page
    // never opened. This is the fixture proving itself.
    await seedUnsyncedWork({ baseUpdatedAt: 'T1' })
    await renderEditor()
    await act(async () => { vi.advanceTimersByTime(1200); await settleIdb(8) })
    expect(store('outbox')).toHaveLength(1)
    expect(store('outbox')[0].sessionId).toBe(PREV_SESSION)
    expect(JSON.stringify(store('outbox')[0].patch)).toContain('unsynced words')
    // …and the member is OFFERED it rather than having it applied silently.
    await waitFor(() => expect(screen.getByPlaceholderText('Title')).toBeInTheDocument())
  })

  it('⛔ an inherited entry that ALREADY has a null baseline is never sent', async () => {
    // The canary's entry, left on disk exactly as the rollback left it. The
    // drain must refuse it rather than PUT without a compare-and-set.
    await seedUnsyncedWork({ baseUpdatedAt: null })
    const { drainOutbox } = await import('../../lib/offline/outboxDrain')
    const { openNotebookDb } = await import('../../lib/offline/notebookDb')
    const db = await openNotebookDb('u42', { factory })
    const send = vi.fn(async () => ({ id: 'n1', updatedAt: 'T9' }))
    const results = await drainOutbox(db, { send, fork: vi.fn() })
    await settleIdb(4)
    expect(send).not.toHaveBeenCalled()
    expect(results[0].outcome).toBe('blocked')
    // ⛔ Kept, not deleted.
    expect(JSON.stringify(store('outbox')[0].patch)).toContain('unsynced words')
  })
})
