/**
 * Wave Q1 — THE WIRE, not the parts.
 *
 * `useDurableNote.test.jsx` proves the durable layer behaves. It cannot prove
 * the editor is CONNECTED to it: a component test mocks the seam it should be
 * exercising, and this repo has shipped eight features that were "built, tested,
 * green and connected to nothing". So this file drives the real editor through
 * the real control, with the real adapter running against an in-memory
 * IndexedDB, and reads what lands in the store.
 *
 * ⛔ The pipeline being pinned (§6):
 *     KEYSTROKE → synchronous localStorage draft
 *               → coalesced ~200ms IndexedDB working copy + its sync intent
 *               → the existing ~800ms server PUT
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

const BASE_BODY = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original body' }] }] }
const NOTE = {
  id: 'n1', title: 'NVDA thesis', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: 'T1',
  isFavorite: false, bodyJson: BASE_BODY,
}

const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
let currentUser = { id: 'u42', role: 'member' }
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: currentUser }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

const ACCOUNT_DB = dbNameFor('u42')
let factory

beforeEach(() => {
  localStorage.clear()
  // ⛔ Wave Q1 ships DARK: the offline layer is off until the §32 browser
  // matrix is reported. These rails opt this browser in, the same way
  // certification does.
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  updateMock.mockReset()
  updateMock.mockResolvedValue({ ...NOTE, updatedAt: 'T2' })
  currentUser = { id: 'u42', role: 'member' }
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

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  await act(async () => { await settleIdb(4) })
}

/** The real control, on the real editor — the lever every NoteEditorPage rail uses. */
function type(value) {
  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value } })
}

/** Past the ~200ms durable window but INSIDE the 800ms server debounce. */
async function letTheDurableWindowClose() {
  await act(async () => { vi.advanceTimersByTime(300); await settleIdb(4) })
}
async function letTheServerSaveFire() {
  await act(async () => { vi.advanceTimersByTime(900); await settleIdb(6) })
}

const store = (name) => factory.databases.get(ACCOUNT_DB)?.dump(name) ?? []

describe('a keystroke reaches BOTH local layers', () => {
  it('writes the synchronous draft immediately and the durable copy after the window', async () => {
    await renderEditor()
    type('NVDA thesis — offline edit')

    // ⛔ The draft is synchronous: it exists before any timer has run, because
    // it is what owns the crash window the durable debounce opens.
    const raw = localStorage.getItem('uct.j2.notedraft.n1')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw).title).toBe('NVDA thesis — offline edit')
    // …and nothing is in IndexedDB yet.
    expect(store('notes')).toEqual([])

    await letTheDurableWindowClose()
    const notes = store('notes')
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toBe('NVDA thesis — offline edit')
    expect(notes[0].dirty).toBe(1)
    // The working copy and what we still owe the server, together.
    const outbox = store('outbox')
    expect(outbox).toHaveLength(1)
    expect(outbox[0].patch.title).toBe('NVDA thesis — offline edit')
    expect(outbox[0].baseUpdatedAt).toBe('T1')
  })

  it('⭐ coalesces a burst — ONE durable write, not one per keystroke', async () => {
    await renderEditor()
    type('a')
    type('ab')
    type('abc')
    await letTheDurableWindowClose()
    const notes = store('notes')
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toBe('abc')
    // ⛔ Measured, not preferred: IndexedDB's p95 in Chrome 152 is ~800ms for a
    // realistic note. A write per keystroke would queue faster than it commits.
    expect(notes[0].generation).toBe(3)
  })
})

describe('⛔ cross-account isolation is a release blocker', () => {
  it('the account is part of the DATABASE NAME, so another member has another store', async () => {
    await renderEditor()
    type('member 42 research')
    await letTheDurableWindowClose()
    expect([...factory.databases.keys()]).toEqual(['uct_notebook_u42'])
    expect(factory.databases.get('uct_notebook_u42').dump('notes')).toHaveLength(1)
    // A wrong name yields NO data. A forgotten predicate would have yielded
    // this member's research to the next one.
    expect(factory.databases.get('uct_notebook_u7')).toBeUndefined()
  })
})

describe('the server ack and the local intent', () => {
  it('a successful save clears the queued intent and marks the copy clean', async () => {
    await renderEditor()
    type('saved for real')
    await letTheServerSaveFire()
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    await act(async () => { await settleIdb(6) })

    expect(store('outbox')).toEqual([])
    expect(store('notes')[0].dirty).toBe(0)
    // Re-based on the revision the save just created.
    expect(store('notes')[0].baseUpdatedAt).toBe('T2')
  })

  it('⛔ a failed save leaves the work durable, queued, and HONESTLY labelled', async () => {
    const boom = new Error('network down')
    updateMock.mockRejectedValue(boom)
    await renderEditor()
    type('written while offline')
    await letTheServerSaveFire()
    await act(async () => { await settleIdb(6) })

    expect(store('notes')[0].dirty).toBe(1)
    expect(store('outbox')).toHaveLength(1)
    // PERMANENT RULE: SAVED ON THIS DEVICE ≠ SYNCED TO UCT — and the surface
    // says so only after the write COMMITTED. jsdom exposes no
    // `navigator.storage`, so `persisted()` is unknown and the honest noun is
    // the narrow one.
    await waitFor(() => expect(screen.getByText(/Saved in this browser/i)).toBeInTheDocument())
    expect(screen.getByText(/waiting to sync/i)).toBeInTheDocument()
    expect(screen.queryByText(/Saved on this device/i)).toBeNull()
  })
})

describe('close and reopen', () => {
  it('offers a durable copy from a previous session even with no localStorage draft', async () => {
    // ⭐ The step localStorage alone could never take: the draft is cleared by
    // a successful save and capped by a browser's ~5MB string quota, and a
    // private-window/quota loss took the whole safety net with it.
    factory.open(ACCOUNT_DB)
    await act(async () => { await settleIdb(2) })
    factory.databases.get(ACCOUNT_DB).seed('notes', {
      noteId: 'n1', title: 'work from a previous session', subtitle: '',
      bodyJson: BASE_BODY, dirty: 1, generation: 6,
      sessionId: 's-previous', localSavedAt: 1000, baseUpdatedAt: 'T1',
    })

    await renderEditor()
    await act(async () => { await settleIdb(6) })
    await waitFor(() => expect(screen.getByText(/Unsaved changes from a previous session/i)).toBeInTheDocument())
    expect(localStorage.getItem('uct.j2.notedraft.n1')).toBeNull()
  })

  it('⭐ and stays quiet when the durable copy is CLEAN — the server is newer, not us', async () => {
    // THE CONTROL. dirty:0 means the server already had this content, so a
    // server copy that differs is newer by construction. Offering the local one
    // back invites a member to push yesterday's words over today's.
    factory.open(ACCOUNT_DB)
    await act(async () => { await settleIdb(2) })
    factory.databases.get(ACCOUNT_DB).seed('notes', {
      noteId: 'n1', title: 'what this device synced last week', subtitle: '',
      bodyJson: BASE_BODY, dirty: 0, generation: 6,
      sessionId: 's-previous', localSavedAt: 1000, baseUpdatedAt: 'T0',
    })

    await renderEditor()
    await act(async () => { await settleIdb(6) })
    expect(screen.queryByText(/Unsaved changes from a previous session/i)).toBeNull()
  })
})

describe('no durable store here', () => {
  it('the editor still works when IndexedDB is unavailable', async () => {
    // A private window, an old browser. ⛔ The product degrades truthfully —
    // the draft and the network save are untouched, and nothing claims the
    // work is safe on this device.
    delete globalThis.indexedDB
    __resetNotebookConnections()
    await renderEditor()
    type('still typing')
    // The synchronous draft is untouched by any of this — it is the layer
    // that never needed IndexedDB.
    expect(JSON.parse(localStorage.getItem('uct.j2.notedraft.n1')).title).toBe('still typing')

    await letTheServerSaveFire()
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    // The network path is unchanged, and the draft is retired the moment the
    // server actually has the content.
    expect(updateMock.mock.calls[0][0].title).toBe('still typing')
    expect(localStorage.getItem('uct.j2.notedraft.n1')).toBeNull()
    // ⛔ And nothing ever claimed anything was held locally.
    expect(screen.queryByText(/Saved on this device/i)).toBeNull()
    expect(screen.queryByText(/Saved in this browser/i)).toBeNull()
  })
})

describe('⛔ the one-line rollback — OFF still means inert', () => {
  it('with the wave switched off, nothing is written to IndexedDB and the Notebook is unchanged', async () => {
    // The §32 gate is closed and the wave is ON by default as of 2026-09-09.
    // This rail now guards the ROLLBACK: an explicit opt-out must still take the
    // whole layer out of the path. "Reversible" is a claim about a RUN, and the
    // only way to keep it honest is to check the artifact.
    localStorage.setItem(OFFLINE_FLAG_KEY, '0')
    __resetNotebookConnections()
    await renderEditor()
    type('typed with the wave switched off')
    await letTheServerSaveFire()

    expect(factory.databases.size).toBe(0)          // not even a database was opened
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(updateMock.mock.calls[0][0].title).toBe('typed with the wave switched off')
    // The pre-Q1 behaviour, exactly: the draft is written and then retired by a
    // successful save.
    expect(localStorage.getItem('uct.j2.notedraft.n1')).toBeNull()
    expect(screen.queryByText(/Saved on this device/i)).toBeNull()
  })

  it('⭐ and the same keystroke DOES reach the store by DEFAULT', async () => {
    // The control, and it now also pins the activation itself: with nothing set
    // at all, the durable layer runs. Without it the rail above would pass just
    // as well against a layer that was broken rather than switched off.
    localStorage.removeItem(OFFLINE_FLAG_KEY)
    await renderEditor()
    type('typed with the wave switched on')
    await letTheDurableWindowClose()
    expect(factory.databases.size).toBe(1)
    expect(store('notes')[0].title).toBe('typed with the wave switched on')
  })
})

describe('⛔ the noun narrows when the platform will not promise retention', () => {
  const withPersisted = (value) => {
    Object.defineProperty(globalThis.navigator, 'storage', {
      configurable: true,
      value: { persisted: async () => value, estimate: async () => ({ quota: 1e9, usage: 1 }) },
    })
  }
  afterEach(() => {
    try { Object.defineProperty(globalThis.navigator, 'storage', { configurable: true, value: undefined }) } catch { /* jsdom */ }
  })

  async function typeOfflineAndRead() {
    updateMock.mockRejectedValue(new Error('network down'))
    await renderEditor()
    type('written while the server was gone')
    await letTheServerSaveFire()
    await act(async () => { await settleIdb(6) })
  }

  it('⭐ says "on this device" ONLY when persisted() was actually granted', async () => {
    withPersisted(true)
    await typeOfflineAndRead()
    await waitFor(() => expect(screen.getByText(/Saved on this device/i)).toBeInTheDocument())
    expect(screen.queryByText(/Saved in this browser/i)).toBeNull()
  })

  it('says "in this browser" when it was not — and does NOT call that private mode', async () => {
    // ⛔ `persisted() === false` is equally true of a brand-new ordinary
    // profile. It means persistent-storage protection has not been positively
    // granted, and NOTHING here may read it as a browsing mode.
    withPersisted(false)
    await typeOfflineAndRead()
    await waitFor(() => expect(screen.getByText(/Saved in this browser/i)).toBeInTheDocument())
    expect(screen.queryByText(/Saved on this device/i)).toBeNull()
    expect(screen.queryByText(/private/i)).toBeNull()
    expect(screen.queryByText(/incognito/i)).toBeNull()
    // ⛔ And it changes NOTHING else: the work is still durable and queued.
    expect(store('notes')[0].dirty).toBe(1)
    expect(store('outbox')).toHaveLength(1)
  })

  it('⛔ a refused persist() never blocks offline editing or raises an error', async () => {
    withPersisted(false)
    await typeOfflineAndRead()
    expect(store('notes')[0].title).toBe('written while the server was gone')
    // The only problem surfaced is the SERVER one, which is real.
    expect(screen.queryByText(/quota|storage is full|could not store/i)).toBeNull()
  })
})

describe('⛔ §21 — switching the wave OFF must never discard queued member work', () => {
  it('leaves an existing durable copy and its outbox entry untouched while the editor works normally', async () => {
    // The activation is reversible. Darkening the feature stops PROCESSING; it
    // has never been permission to delete what a member already wrote.
    factory.open(ACCOUNT_DB)
    await act(async () => { await settleIdb(2) })
    const db = factory.databases.get(ACCOUNT_DB)
    db.seed('notes', {
      noteId: 'n1', title: 'work written before the flag was switched off', subtitle: '',
      bodyJson: BASE_BODY, dirty: 1, generation: 4, sessionId: 's-old',
      localSavedAt: 1000, baseUpdatedAt: 'T1',
    })
    db.seed('outbox', {
      mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
      patch: { title: 'work written before the flag was switched off', subtitle: '', bodyJson: BASE_BODY },
      baseUpdatedAt: 'T1', permanent: false, queuedAt: 1000,
    })

    localStorage.setItem(OFFLINE_FLAG_KEY, '0')   // the rollback
    __resetNotebookConnections()
    await renderEditor()
    type('and the member keeps typing with the wave off')
    await letTheServerSaveFire()
    await act(async () => { await settleIdb(6) })

    // ⛔ Byte for byte where it was: no drain, no clear, no delete.
    expect(store('notes')).toHaveLength(1)
    expect(store('notes')[0].title).toBe('work written before the flag was switched off')
    expect(store('notes')[0].dirty).toBe(1)
    expect(store('outbox')).toHaveLength(1)
    expect(store('outbox')[0].patch.title).toBe('work written before the flag was switched off')
    // …and the editor behaved exactly as it did before Wave Q1 throughout.
    expect(updateMock.mock.calls[0][0].title).toBe('and the member keeps typing with the wave off')
  })
})
