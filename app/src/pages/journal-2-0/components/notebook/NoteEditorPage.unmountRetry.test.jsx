/**
 * W8-R56 -- AN UNMOUNTED PAGE NEVER ARMS A RETRY.
 *
 * ⚰️ The defect (live on master and production at e9abce827a). The unmount cleanup cleared `retryTimerRef` and then
 * flushed the pending save. That save is async. When it FAILED, the catch armed a fresh backoff retry after the cleanup
 * had already run, so nothing ever cleared it. The dead page then kept PUTting from its stale baseline (1 s → 30 s, no
 * cap). On a 409 it ran `reconcileConflict`, which can fork a note the member has since reopened. It was found as a
 * cross-test leak: a retry armed by one test wrote inside the next one.
 *
 * ⭐ Why dropping that retry loses nothing: the durable working copy stays dirty, with its outbox entry, until a save
 * LANDS. A failed save marks nothing synced, so the words are still owed, and the next mount (or the drain) sends them.
 * The rails below prove all three halves on the real page with the real durable layer, over an in-memory IndexedDB.
 */
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb } from '../../lib/offline/__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections } from '../../lib/offline/useDurableNote'
import { OFFLINE_FLAG_KEY } from '../../lib/offline/offlineFlag'
import { dbNameFor } from '../../lib/offline/notebookDb'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const BODY = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original body' }] }] }
const NOTE = {
  id: 'n1', title: 'NVDA thesis', subtitle: '', folderId: null, ticker: null, tags: [], heroImageUrl: null,
  updatedAt: '2026-10-01T14:00:00.000000+00:00', isFavorite: false, bodyJson: BODY,
}
const LANDED = '2026-10-01T14:30:00.000000+00:00'

const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u42', role: 'member' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

const ACCOUNT_DB = dbNameFor('u42')
const offline = () => Object.assign(new TypeError('Failed to fetch'), { status: undefined })
let factory
let warn

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  updateMock.mockReset()
  __resetNotebookConnections()
  factory = createFakeIndexedDbFactory()
  globalThis.indexedDB = factory
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  vi.useFakeTimers({ shouldAdvanceTime: true })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warn.mockRestore()
  vi.useRealTimers()
  vi.clearAllMocks()
  localStorage.clear()
  delete globalThis.indexedDB
})

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const view = render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  await act(async () => { await settleIdb(4) })
  return view
}
const type = (value) => fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value } })
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); await settleIdb(6) })
const store = (name) => factory.databases.get(ACCOUNT_DB)?.dump(name) ?? []
const retryWarnings = () => warn.mock.calls.filter(([m]) => /autosave failed \(retry/.test(String(m)))

describe('CONTROL -- a MOUNTED page still retries a failed save (unchanged)', () => {
  it('the save fails, a retry is armed, and it sends again 1 s later', async () => {
    await renderEditor()
    updateMock.mockRejectedValue(offline())
    type('NVDA thesis, typed offline')
    await advance(900) // the 800 ms debounce: the first PUT, which fails
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(retryWarnings().map(([m]) => m)).toEqual(['autosave failed (retry 1 in 1000ms)'])
    await advance(1100) // the backoff retry
    expect(updateMock).toHaveBeenCalledTimes(2)
    expect(updateMock.mock.calls[1][0].title).toBe('NVDA thesis, typed offline')
  })
})

describe('⛔ W8-R56 -- unmount, then a failing save', () => {
  it('the unmount flush runs ONCE; its failure arms nothing, and no second PUT comes even 60 s later', async () => {
    const { unmount } = await renderEditor()
    updateMock.mockRejectedValue(offline())
    type('NVDA thesis, typed then left')
    await advance(300) // the durable window closes; the 800 ms server debounce is still pending
    expect(updateMock).not.toHaveBeenCalled()
    unmount() // "Save on unmount if dirty": the flush goes out now and fails after the cleanup has run
    await advance(50)
    expect(updateMock).toHaveBeenCalledTimes(1) // the flush ran, once
    expect(updateMock.mock.calls[0][0].title).toBe('NVDA thesis, typed then left')
    updateMock.mockReset()
    updateMock.mockResolvedValue({ ...NOTE, title: 'NVDA thesis, typed then left', updatedAt: LANDED }) // network back
    await advance(60_000) // past every backoff step (1, 2, 4, 8, 15, 30 s)
    expect(updateMock).not.toHaveBeenCalled() // no dead-page PUT, at any step
    expect(retryWarnings()).toEqual([]) // and no retry was ever armed
  })

  it('the unsent edit is still in the durable copy, owed to the server, and a fresh mount sends it', async () => {
    const first = await renderEditor()
    updateMock.mockRejectedValue(offline())
    type('NVDA thesis, typed then left')
    await advance(300)
    first.unmount()
    await advance(1_000)
    // The working copy still holds the words, dirty, with what we owe the server queued beside it.
    const notes = store('notes')
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toBe('NVDA thesis, typed then left')
    expect(notes[0].dirty).toBe(1)
    const outbox = store('outbox')
    expect(outbox).toHaveLength(1)
    expect(outbox[0].patch.title).toBe('NVDA thesis, typed then left')

    // A fresh mount, with the network back: the queued words reach the server from the LIVE page.
    updateMock.mockReset()
    updateMock.mockImplementation(async (patch) => ({ ...NOTE, ...patch, updatedAt: LANDED }))
    await renderEditor()
    await advance(2_000)
    expect(screen.getByPlaceholderText('Title').value).toBe('NVDA thesis, typed then left')
    const sentTitles = updateMock.mock.calls.map(([p]) => p.title)
    expect(sentTitles).toContain('NVDA thesis, typed then left')
  })
})
