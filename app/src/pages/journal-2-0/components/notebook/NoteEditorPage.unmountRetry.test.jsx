/**
 * W8-R56 -- AN UNMOUNTED PAGE ARMS NO RETRY *WHEN THE DURABLE COPY OWNS THE WORDS*.
 *
 * ⚰️ The defect (live on master and production at e9abce827a). The unmount cleanup cleared `retryTimerRef` and then
 * flushed the pending save. That save is async. When it FAILED, the catch armed a fresh backoff retry after the cleanup
 * had already run, so nothing ever cleared it. The dead page then kept PUTting from its stale baseline (1 s → 30 s, no
 * cap). On a 409 it ran `reconcileConflict`, which can fork a note the member has since reopened.
 *
 * ⭐ When dropping that retry loses nothing: ONLY when the offline layer is on (`useDurableNote`'s own `supported`) and
 * its writer has not FAILED. Then the working copy stays dirty, with its outbox entry, until a save lands, and the next
 * mount (or the drain) sends it.
 *
 * ⛔ I1 (round 2): with the layer OFF -- the member opted out, the kill switch is set, or there is no IndexedDB -- or a
 * store whose writes fail, nothing durable holds the words. Their only other home is the localStorage draft, which
 * another tab on the same note overwrites and clears. So the dead page keeps the OLD retry there: a conflicted copy
 * beats a loss. Both branches are railed below.
 *
 * ⛔⛔ W8-R58/R59 (round 4): the decision reads the STORE at the moment of the catch, never the last render. A
 * durable write refused AT the unmount flush never re-renders a dead page, so a render-time read saw the pre-flush
 * status and dropped the retry while the store held older words (reproduced, then railed below). The retry is
 * dropped ONLY when the stored record is dirty and holds exactly what the save sent; every doubt keeps it.
 */
import { StrictMode } from 'react'
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
const T2 = '2026-10-01T14:20:00.000000+00:00'
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
const conflict = () => Object.assign(new Error('note changed — refresh and retry'), { status: 409 })
let factory
let warn
let fresh // what GET /api/j2/notes/n1 answers during a reconcile
let fetchLog

// ⛔ `serialize: true` models IndexedDB's queuing: a transaction created after a readwrite on the same store runs
// after it. The dead page's store read depends on exactly that to see the durable flush's own write; without it the
// fake would answer the read out of order and the rails would be testing a store no browser has.
function installStore(opts = {}) {
  __resetNotebookConnections()
  factory = createFakeIndexedDbFactory({ serialize: true, ...opts })
  globalThis.indexedDB = factory
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  updateMock.mockReset()
  installStore()
  fresh = null
  fetchLog = []
  global.fetch = vi.fn((url, init = {}) => {
    const method = init.method || 'GET'
    fetchLog.push([method, String(url)])
    if (method === 'GET' && /\/api\/j2\/notes\/n1$/.test(String(url)) && fresh) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ note: fresh }) })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  })
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

async function renderEditor({ strict = false } = {}) {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const tree = <MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>
  const view = render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  await screen.findByPlaceholderText('Title')
  await act(async () => { await settleIdb(4) })
  return view
}
const type = (value) => fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value } })
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); await settleIdb(6) })
const store = (name) => factory.databases.get(ACCOUNT_DB)?.dump(name) ?? []
const accountDb = () => factory.databases.get(ACCOUNT_DB)
/** Make the notes store misbehave from now on: `kind` is 'refuse-writes', 'throw-reads' or 'hang-reads'. */
function sabotageNotes(kind) {
  const db = accountDb()
  const realTx = db.transaction.bind(db)
  db.transaction = (names, mode = 'readonly') => {
    const list = Array.isArray(names) ? names : [names]
    if (list.includes('notes')) {
      if (kind === 'refuse-writes' && mode === 'readwrite') throw new Error('fake: notes refused the write (armed at flush)')
      if (kind === 'throw-reads' && mode === 'readonly') throw new Error('fake: notes read failed')
      if (kind === 'hang-reads' && mode === 'readonly') {
        return { objectStore: () => ({ get: () => ({}) }) } // the request never answers
      }
    }
    return realTx(names, mode)
  }
}
const retryWarnings = () => warn.mock.calls.filter(([m]) => /autosave failed \(retry/.test(String(m)))
const networkBack = () => {
  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => ({ ...NOTE, ...patch, updatedAt: LANDED }))
}

/** Type, let the durable window close, unmount (the flush goes out and fails offline), then bring the network back. */
async function typeLeaveOffline(words, { seed = null, sabotage = null } = {}) {
  const { unmount } = await renderEditor()
  updateMock.mockRejectedValue(offline())
  type(words)
  await advance(300) // the durable window closes; the 800 ms server debounce is still pending
  expect(updateMock).not.toHaveBeenCalled()
  if (seed) accountDb().seed('notes', seed(store('notes')[0]))
  if (sabotage) sabotageNotes(sabotage)
  unmount() // "Save on unmount if dirty": the flush goes out now and fails after the cleanup has run
  await advance(50)
  expect(updateMock).toHaveBeenCalledTimes(1) // the flush ran, once
  expect(updateMock.mock.calls[0][0].title).toBe(words)
  networkBack()
}

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

  it('⛔ I2: under <StrictMode> (mount, unmount, mount) the LIVE page still retries -- the re-raise is load-bearing', async () => {
    await renderEditor({ strict: true })
    updateMock.mockRejectedValue(offline())
    type('typed under strict mode')
    await advance(900)
    const first = updateMock.mock.calls.length
    expect(first).toBeGreaterThanOrEqual(1)
    await advance(1100)
    expect(updateMock.mock.calls.length).toBeGreaterThan(first)
    expect(updateMock.mock.calls.at(-1)[0].title).toBe('typed under strict mode')
  })
})

describe('⛔ W8-R56, offline layer ON -- the durable copy owns the words, so the dead page arms nothing', () => {
  it('the unmount flush runs ONCE; its failure arms nothing, and no second PUT comes even 60 s later', async () => {
    await typeLeaveOffline('NVDA thesis, typed then left')
    await advance(60_000) // past every backoff step (1, 2, 4, 8, 15, 30 s)
    expect(updateMock).not.toHaveBeenCalled() // no dead-page PUT, at any step
    expect(retryWarnings()).toEqual([]) // and no retry was ever armed
  })

  it('the unsent edit is still in the durable copy, owed to the server, and a fresh mount sends it', async () => {
    await typeLeaveOffline('NVDA thesis, typed then left')
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
    await renderEditor()
    await advance(2_000)
    expect(screen.getByPlaceholderText('Title').value).toBe('NVDA thesis, typed then left')
    expect(updateMock.mock.calls.map(([p]) => p.title)).toContain('NVDA thesis, typed then left')
  })

  it('⛔ I2: the unmount flush 409s on a METADATA-ONLY move -- it reconciles once and arms no 50 ms re-PUT', async () => {
    const { unmount } = await renderEditor()
    fresh = { ...NOTE, ticker: 'NVDA', updatedAt: T2 } // the server moved, but not its words: the plan is RETRY
    updateMock.mockRejectedValueOnce(conflict())
    updateMock.mockImplementation(async (p) => ({ ...NOTE, ...p, updatedAt: LANDED }))
    type('typed then left (meta)')
    await advance(300)
    unmount()
    await advance(60_000)
    // The reconcile ran (it read the server), and the one PUT is the flush: no re-PUT from the dead page.
    expect(fetchLog.some(([m, u]) => m === 'GET' && /\/api\/j2\/notes\/n1$/.test(u))).toBe(true)
    expect(updateMock).toHaveBeenCalledTimes(1)
  })
})

describe('⛔ W8-R56 I1, nothing durable holds the words -- the dead page KEEPS its retry (the old behaviour)', () => {
  it('offline layer OFF (the member opted out): the failed unmount flush is retried, and the words reach the server', async () => {
    localStorage.setItem(OFFLINE_FLAG_KEY, '0')
    await typeLeaveOffline('typed with the offline layer off')
    expect(store('notes')).toEqual([]) // control: nothing durable holds these words
    await advance(1_100) // the 1 s backoff step
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock.mock.calls[0][0].title).toBe('typed with the offline layer off')
  })

  it('offline layer ON but every durable write FAILED: the failed unmount flush is retried too', async () => {
    installStore({ failStore: 'notes' }) // the working copy cannot be written
    await typeLeaveOffline('typed while the store refuses writes')
    expect(store('notes')).toEqual([]) // control: the durable copy really holds nothing
    await advance(1_100)
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock.mock.calls[0][0].title).toBe('typed while the store refuses writes')
  })
})

describe('⛔ W8-R59 -- the dead page reads the STORE, live, and only proof drops the retry', () => {
  it('the durable write is REFUSED at the unmount flush: the retry is kept and the words reach the server', async () => {
    const { unmount } = await renderEditor()
    updateMock.mockRejectedValue(offline())
    type('first words')
    await advance(300) // committed: the last render saw a healthy writer
    expect(store('notes')[0].title).toBe('first words')
    type('second words, never on disk')
    sabotageNotes('refuse-writes') // armed at flush time: the unmount flush's durable write is refused
    unmount()
    await advance(50)
    expect(store('notes').map((r) => r.title)).toEqual(['first words']) // control: the store does NOT hold them
    networkBack()
    await advance(1_100)
    expect(updateMock.mock.calls.map(([p]) => p.title)).toContain('second words, never on disk')
  })

  it('the store read THROWS: doubt keeps the retry', async () => {
    await typeLeaveOffline('typed, then the store read fails', { sabotage: 'throw-reads' })
    await advance(1_100)
    expect(updateMock.mock.calls.map(([p]) => p.title)).toContain('typed, then the store read fails')
  })

  it('the store read never answers: the bounded read TIMES OUT, and doubt keeps the retry', async () => {
    await typeLeaveOffline('typed, then the store hangs', { sabotage: 'hang-reads' })
    await advance(2_000 + 1_100) // the read's bound, then the 1 s backoff
    expect(updateMock.mock.calls.map(([p]) => p.title)).toContain('typed, then the store hangs')
  })

  it('the record holds NEWER content (another write landed): the retry is kept, and the newer words stay stored', async () => {
    await typeLeaveOffline('my older words', {
      seed: (rec) => ({ ...rec, title: 'newer words from tab B', dirty: 1 }),
    })
    await advance(1_100)
    expect(updateMock.mock.calls.map(([p]) => p.title)).toContain('my older words') // kept: the dead page sends its own
    expect(store('notes')[0].title).toBe('newer words from tab B') // and nothing it did touched the newer record
  })

  it('the layer is switched OFF mid-session over an exact dirty record: no drain will send it, so the retry is kept', async () => {
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    const onBack = vi.fn()
    const tree = () => <MemoryRouter><NoteEditorPage noteId="n1" onBack={onBack} /></MemoryRouter>
    const view = render(tree())
    await screen.findByPlaceholderText('Title')
    await act(async () => { await settleIdb(4) })
    updateMock.mockRejectedValue(offline())
    type('typed, then the layer went off')
    await advance(300) // the record now holds exactly these words, dirty
    expect(store('notes')[0]).toMatchObject({ title: 'typed, then the layer went off', dirty: 1 })
    localStorage.setItem(OFFLINE_FLAG_KEY, '0') // the member switches the layer off: nothing will drain that record
    view.rerender(tree()) // a fresh element, so the page renders and reads the switch (the same one would bail out)
    await act(async () => { await settleIdb(4) })
    view.unmount()
    await advance(50)
    networkBack()
    await advance(1_100)
    expect(updateMock.mock.calls.map(([p]) => p.title)).toContain('typed, then the layer went off')
  })

  it('the record holds exactly these words but is CLEAN (nothing owed): doubt keeps the retry', async () => {
    await typeLeaveOffline('typed, record says synced', { seed: (rec) => ({ ...rec, dirty: 0 }) })
    await advance(1_100)
    expect(updateMock.mock.calls.map(([p]) => p.title)).toContain('typed, record says synced')
  })
})

