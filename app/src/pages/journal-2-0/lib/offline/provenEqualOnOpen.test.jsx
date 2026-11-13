/**
 * ⭐⭐ Follow-up D (2026-11-13), F2 — OPENING THE NOTE MAKES "OPEN IT SO IT CAN FINISH SAVING" TRUE.
 *
 * The device holds what a save whose answer the page never saw leaves behind: a dirty
 * record (and its entry) holding exactly the words the server already has. Before follow-up
 * D, opening the note decided "nothing to recover" and wrote nothing, so the record stayed
 * dirty and every `noteHasUnsentWork` door kept refusing. The real editor runs here against
 * an in-memory IndexedDB; nobody types.
 *
 * ⛔ Controls: a record whose words differ is untouched and the banner path is unchanged; an
 * entry whose words differ is never deleted.
 */
import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb } from './__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections, connectNotebookDb } from './useDurableNote'
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import { dbNameFor } from './notebookDb'
import { noteHasUnsentWork } from './noteHasUnsentWork'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const T0 = '2026-11-13T10:00:00.000000+00:00'
const T1 = '2026-11-13T10:00:06.000000+00:00'
const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const doc = (...blocks) => ({ type: 'doc', content: blocks })
const SAVED = doc(para('the words the server applied, answer never seen'))
const OTHER = doc(para('words the server never received'))

const SERVER = {
  id: 'n1', title: 'Thesis', subtitle: '', folderId: null, ticker: null, tags: [],
  heroImageUrl: null, isFavorite: false, bodyJson: SAVED, updatedAt: T1,
}
const update = vi.fn(async () => { throw new Error('nobody typed: nothing may be sent') })
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: SERVER, isLoading: false, error: null, update, refresh: vi.fn() }),
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
  update.mockClear()
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

const store = () => factory.databases.get(ACCOUNT_DB)
const record = () => store().dump('notes').find((r) => r.noteId === 'n1') || null
const queue = () => store().dump('outbox')
const unsent = () => noteHasUnsentWork('n1', { accountId: 'u42', connect: connectNotebookDb })

/** What the device holds after the unseen landing: a dirty record (+ entries) on T0. */
async function leftOnDevice({ body = SAVED, entries = [SAVED] } = {}) {
  factory.open(ACCOUNT_DB)
  await act(async () => { await settleIdb(2) })
  store().seed('notes', {
    noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: body, dirty: 1, generation: 4,
    sessionId: 'gone', localSavedAt: 1000, baseUpdatedAt: T0,
    serverBase: { title: 'Thesis', subtitle: '', bodyJson: doc(para('before')), updatedAt: T0 },
  })
  entries.forEach((b, i) => store().seed('outbox', {
    mutationId: i === 0 ? 'note:n1' : `legacy${i}:n1`, noteId: 'n1', kind: 'note-update',
    patch: { title: 'Thesis', subtitle: '', bodyJson: b }, baseUpdatedAt: T0, generation: 4, sessionId: 'gone', queuedAt: 1000,
  }))
}

const indicator = () => document.querySelector('[data-save-indicator]')

async function openTheNote() {
  const mod = await import('../../components/notebook/NoteEditorPage')
  render(<MemoryRouter><mod.default noteId="n1" onBack={() => {}} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
}
async function sit(rounds = 6) {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { vi.advanceTimersByTime(500); await settleIdb(6) })
  }
}

describe('⭐ F2 (d): a dirty record equal to the server is settled on open', () => {
  it('with its queued entry: clean at the server revision, entry gone, nothing sent', async () => {
    await leftOnDevice()
    expect((await unsent()).unsent).toBe(true)
    await openTheNote()
    await sit()

    expect(update).not.toHaveBeenCalled()
    expect(record()).toMatchObject({ dirty: 0, baseUpdatedAt: T1, serverBase: null, bodyJson: SAVED })
    expect(queue()).toEqual([])
    expect(await unsent()).toEqual({ unsent: false, why: null })
    expect(screen.queryByText(/Unsaved changes from a previous session/)).toBeNull()
  })

  it('with no entry left (the drain already removed it): still settled', async () => {
    await leftOnDevice({ entries: [] })
    await openTheNote()
    await sit()
    expect(record()).toMatchObject({ dirty: 0, baseUpdatedAt: T1 })
    expect((await unsent()).unsent).toBe(false)
  })

  it('⛔ control: a second queued entry holding other words is never deleted, and the record stays dirty', async () => {
    await leftOnDevice({ entries: [SAVED, OTHER] })
    await openTheNote()
    await sit()
    expect(update).not.toHaveBeenCalled()
    expect(record()).toMatchObject({ dirty: 1, baseUpdatedAt: T0 })
    expect(queue().map((e) => e.patch.bodyJson)).toEqual([SAVED, OTHER])
    expect((await unsent()).unsent).toBe(true)
  })
})

describe('⛔ F2 (e): a dirty record that differs from the server is untouched', () => {
  it('no entry: the Restore/Discard banner is offered exactly as before, and the record keeps its words', async () => {
    await leftOnDevice({ body: OTHER, entries: [] })
    await openTheNote()
    await sit()
    await screen.findByText(/Unsaved changes from a previous session/)
    expect(update).not.toHaveBeenCalled()
    expect(record()).toMatchObject({ dirty: 1, baseUpdatedAt: T0, bodyJson: OTHER })
    expect((await unsent()).why).toBe('dirty')
  })
})
