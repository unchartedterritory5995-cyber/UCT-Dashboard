/**
 * Wave Q1 — WHAT DOES A MEMBER SEE WHEN THE DRAIN BLOCKS THEIR WRITE?
 *
 * The drain refuses to send an entry with no baseline: kept, not deleted, not
 * retried. That is the right posture for the SERVER's sake — a write that
 * cannot prove it is not clobbering must not go out. It says nothing about the
 * member, and "we quietly stopped saving and did not say so" is a worse product
 * defect than the one the refusal prevents.
 *
 * ⛔ This file MEASURES the consequence rather than reasoning about it. Every
 * assertion below is a fact about behaviour that already ships; where the answer
 * is bad, the test says so out loud rather than asserting the bad thing is fine.
 */
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb, installKeyRange, createFakeDb } from './__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections } from './useDurableNote'
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import { dbNameFor, getNote, listOutbox, putNoteWithIntent, openNotebookDb } from './notebookDb'
import { drainOutbox, BLOCKED, SENT, summarize } from './outboxDrain'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

const entryFor = (noteId, text, base) => ({
  mutationId: `note:${noteId}`,
  noteId,
  kind: 'note-update',
  patch: { title: `${noteId} title`, subtitle: '', bodyJson: doc(text) },
  baseUpdatedAt: base,
  generation: 3,
  queuedAt: 10,
})

async function seed(db, noteId, text, base) {
  const entry = entryFor(noteId, text, base)
  await putNoteWithIntent(db, {
    noteId, title: entry.patch.title, subtitle: '', bodyJson: entry.patch.bodyJson,
    baseUpdatedAt: base, generation: 3, sessionId: 's1', localSavedAt: 20, dirty: 1,
  }, entry)
  return entry
}

describe('the words themselves', () => {
  let db
  beforeEach(() => { installKeyRange(); db = createFakeDb() })

  it('⭐ a blocked entry keeps EVERY word, on disk, still marked unsynced', async () => {
    await seed(db, 'n1', 'three hours of research', null)
    await drainOutbox(db, { send: vi.fn(), fork: vi.fn() })
    await settleIdb()

    const rec = await getNote(db, 'n1')
    expect(JSON.stringify(rec.bodyJson)).toContain('three hours of research')
    // ⛔ Still dirty: the record does not start claiming the server has it.
    expect(rec.dirty).toBe(1)
    const queued = await listOutbox(db)
    expect(queued).toHaveLength(1)
    expect(JSON.stringify(queued[0].patch)).toContain('three hours of research')
  })

  it('⭐ the block is RECORDED on the entry, with a readable reason', async () => {
    // Whether anything renders it is a separate question (below) — but the
    // fact has to exist before any surface could show it.
    await seed(db, 'n1', 'words', null)
    await drainOutbox(db, { send: vi.fn(), fork: vi.fn() })
    await settleIdb()
    const [e] = await listOutbox(db)
    expect(e.permanent).toBe(true)
    expect(String(e.lastError)).toMatch(/baseline|compare-and-set/i)
  })
})

describe('does one blocked entry wedge anything else?', () => {
  let db
  beforeEach(() => { installKeyRange(); db = createFakeDb() })

  it('⭐ ANOTHER note still syncs — the queue is not stuck behind it', async () => {
    await seed(db, 'n1', 'baseline-less', null)
    await seed(db, 'n2', 'perfectly fine', 'T1')
    const send = vi.fn(async () => ({ id: 'n2', updatedAt: 'T2' }))
    const results = await drainOutbox(db, { send, fork: vi.fn() })
    await settleIdb()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].noteId).toBe('n2')
    expect(summarize(results)).toMatchObject({ blocked: 1, sent: 1 })
  })

  it('⭐⭐ a LATER edit of the SAME note un-blocks it — the hold is not a dead end', async () => {
    // The outbox is keyed `note:<id>`, one entry per note, so a fresh durable
    // write REPLACES the blocked entry — and the replacement carries no
    // `permanent` flag. This is the recovery path, and it is the difference
    // between "held" and "lost".
    await seed(db, 'n1', 'blocked words', null)
    await drainOutbox(db, { send: vi.fn(), fork: vi.fn() })
    await settleIdb()
    expect((await listOutbox(db))[0].permanent).toBe(true)

    // The member edits the note again, and this time there is a baseline.
    await seed(db, 'n1', 'edited again, with a baseline', 'T1')
    const send = vi.fn(async () => ({ id: 'n1', updatedAt: 'T2' }))
    const results = await drainOutbox(db, { send, fork: vi.fn() })
    await settleIdb()

    expect(send).toHaveBeenCalledTimes(1)
    expect(results[0].outcome).toBe(SENT)
    expect(JSON.stringify(send.mock.calls[0][0].patch)).toContain('edited again, with a baseline')
  })

  it('⛔ but WITHOUT a new edit it never retries — that is the whole point', async () => {
    await seed(db, 'n1', 'blocked words', null)
    await drainOutbox(db, { send: vi.fn(), fork: vi.fn() })
    await settleIdb()
    const send = vi.fn(async () => ({ id: 'n1', updatedAt: 'T2' }))
    const results = await drainOutbox(db, { send, fork: vi.fn() })
    expect(send).not.toHaveBeenCalled()
    expect(results[0].outcome).toBe(BLOCKED)
  })
})

/* ────────────────────────────────────────────────────────────────────────── */

const updateMock = vi.fn()
const NOTE = {
  id: 'n1', title: 'NVDA thesis', subtitle: '', folderId: null, ticker: null,
  tags: [], heroImageUrl: null, updatedAt: 'T1', isFavorite: false,
  bodyJson: doc('Original body'),
}
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u42', role: 'member' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

describe('⛔ WHAT THE MEMBER IS TOLD', () => {
  let factory
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(OFFLINE_FLAG_KEY, '1')
    updateMock.mockReset()
    __resetNotebookConnections()
    factory = createFakeIndexedDbFactory()
    globalThis.indexedDB = factory
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers(); vi.clearAllMocks(); localStorage.clear(); delete globalThis.indexedDB
  })

  async function renderEditor() {
    const NoteEditorPage = (await import('../../components/notebook/NoteEditorPage')).default
    render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>)
    await screen.findByPlaceholderText('Title')
    await act(async () => { await settleIdb(4) })
  }

  it('⭐ the OPEN note says so honestly when the server does not have the work', async () => {
    // The note the member is looking at is never drained by the sweep
    // (`excludeNoteId`), so its truth comes from the editor's own save path.
    updateMock.mockRejectedValue(Object.assign(new Error('network down'), { status: 0 }))
    await renderEditor()
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'typed while offline' } })
    await act(async () => { vi.advanceTimersByTime(900); await settleIdb(6) })

    // ⛔ The words are on the screen and on the disk…
    expect(screen.getByPlaceholderText('Title')).toHaveValue('typed while offline')
    // …and the header SAYS the server does not have them. Asserted as rendered
    // TEXT, never as state — a status nobody can read is not a status.
    await waitFor(() => expect(screen.getByText(/waiting to sync/i)).toBeInTheDocument())
    expect(screen.getByText(/Saved (on this device|in this browser)/i)).toBeInTheDocument()
  })

  it('⛔⛔ THE FINDING: a blocked entry for a note the member is NOT looking at is SILENT', async () => {
    // There is no consumer of `summarize()` anywhere in the app, and the string
    // BLOCKED appears in no component. The only "waiting to sync" surface is the
    // OPEN note's header, driven by that note's own save status.
    //
    // ⛔ So a note blocked by the sweep — the member has navigated away, or it
    // was recovered from a previous session — holds its words safely and tells
    // nobody. This test PINS that gap so it cannot be discovered twice, and it
    // fails the day someone builds the surface (which is the point: then this
    // assertion gets replaced by one that reads the surface).
    const componentsSrc = await import('./outboxDrain')
    expect(typeof componentsSrc.summarize).toBe('function')

    const db = await openNotebookDb('u42', { factory })
    await seed(db, 'n2', 'work the member cannot see', null)
    const results = await drainOutbox(db, { send: vi.fn(), fork: vi.fn(), excludeNoteId: 'n1' })
    expect(summarize(results)).toMatchObject({ blocked: 1 })

    await renderEditor()
    await act(async () => { vi.advanceTimersByTime(1200); await settleIdb(8) })

    // Nothing on screen mentions it. Not a badge, not a count, not a warning.
    expect(screen.queryByText(/blocked/i)).toBeNull()
    expect(screen.queryByText(/could not sync/i)).toBeNull()
    expect(screen.queryByText(/n2/i)).toBeNull()
  })
})
