/**
 * Wave Q1 — THE SLOW-FETCH WINDOW.
 *
 * The activation canary (2026-09-09) found all three local layers holding an
 * EMPTY note after a reload, and the outbox holding that empty patch with
 * `baseUpdatedAt: null` — a queued PUT with no compare-and-set at all.
 *
 * The artifact said `generation: 1`, a fresh session id and a null baseline, so
 * the snapshot was scheduled BEFORE the note finished loading. Every previous
 * rail in this suite tests a note that is ALREADY LOADED — `useJ2Note` returns
 * it on the first render — so none of them can see this window at all.
 *
 * This file opens that window and holds it open: the note fetch resolves on a
 * timer the test controls, exactly as a slow pod does.
 *
 * ⛔ The detector is deliberately NOT a spy on anything in NoteEditorPage.
 * `scheduleAutosave` is the ONLY caller of `saveDraftLocally`, and it writes
 * the localStorage draft SYNCHRONOUSLY. So "a draft key exists for this note
 * while `note` is still null" is an exact, source-untouched observation that
 * the autosave path ran against an unloaded note.
 */
import React from 'react'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb } from '../../lib/offline/__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections } from '../../lib/offline/useDurableNote'
import { OFFLINE_FLAG_KEY } from '../../lib/offline/offlineFlag'
import { dbNameFor } from '../../lib/offline/notebookDb'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const BASE_BODY = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Real prose the member wrote' }] }],
}
const NOTE = {
  id: 'n1', title: 'NVDA thesis', subtitle: 'Q3 setup', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: 'T1',
  isFavorite: false, bodyJson: BASE_BODY,
}
/** A note the member created but never put words in — its SERVER body is empty.
 *  This is the canary's note: created, typed into, reloaded before the PUT landed.
 *  ⛔ `bodyJson` is `{doc, []}`, NOT null — that is the exact shape the server
 *  sends for a note whose `body_json` column is empty (`notes.py`:
 *  `json.loads(row["body_json"] or '{"type":"doc","content":[]}')`), and it is
 *  TRUTHY, which changes which code paths run. */
const EMPTY_NOTE = {
  ...NOTE, title: '', subtitle: '', bodyJson: { type: 'doc', content: [] },
}
let SERVED = NOTE

/** How long the note fetch takes. The canary ran against a two-minute-old pod. */
const FETCH_MS = 1500

const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  // A genuine slow fetch: null while in flight, exactly like SWR's `data`
  // before it resolves, and a real state update when it lands.
  useJ2Note: () => {
    const [note, setNote] = React.useState(null)
    React.useEffect(() => {
      const t = setTimeout(() => setNote(SERVED), FETCH_MS)
      return () => clearTimeout(t)
    }, [])
    return { note, isLoading: !note, error: null, update: updateMock, refresh: vi.fn() }
  },
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
let currentUser = { id: 'u42', role: 'member' }
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: currentUser }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

const ACCOUNT_DB = dbNameFor('u42')
const DRAFT_KEY = 'uct.j2.notedraft.n1'
let factory
/** Every localStorage draft write, with the stack that caused it. */
let draftWrites

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  updateMock.mockReset()
  updateMock.mockResolvedValue({ ...NOTE, updatedAt: 'T2' })
  currentUser = { id: 'u42', role: 'member' }
  SERVED = NOTE
  __resetNotebookConnections()
  factory = createFakeIndexedDbFactory()
  globalThis.indexedDB = factory
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  draftWrites = []
  const realSetItem = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
    if (key === DRAFT_KEY) draftWrites.push({ value, stack: new Error('draft write').stack })
    return realSetItem.call(this, key, value)
  })
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  localStorage.clear()
  delete globalThis.indexedDB
})

const store = (name) => factory.databases.get(ACCOUNT_DB)?.dump(name) ?? []

async function mountWhileTheFetchIsStillInFlight() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>)
  // Let mount effects, the prefs fetch and the offline layer's IndexedDB open
  // all settle — WITHOUT letting the note fetch land.
  await act(async () => { vi.advanceTimersByTime(FETCH_MS - 500); await settleIdb(8) })
}

async function letTheNoteLand() {
  await act(async () => { vi.advanceTimersByTime(600); await settleIdb(8) })
  await screen.findByPlaceholderText('Title')
  // Past both the ~200ms durable coalesce and the 800ms server debounce.
  await act(async () => { vi.advanceTimersByTime(1000); await settleIdb(8) })
}

describe('the note fetch is slow — nothing may be persisted before the note is hydrated', () => {
  it('⛔ writes NO localStorage draft while `note` is still null', async () => {
    await mountWhileTheFetchIsStillInFlight()
    if (draftWrites.length) {
      // The reproduction: say WHO wrote it, not just that something did.
      // eslint-disable-next-line no-console
      console.log('DRAFT WRITTEN DURING LOAD:', draftWrites[0].value, '\n', draftWrites[0].stack)
    }
    expect(draftWrites).toHaveLength(0)
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('⛔ queues NO outbox entry, and no durable record, while `note` is still null', async () => {
    await mountWhileTheFetchIsStillInFlight()
    expect(store('outbox')).toEqual([])
    expect(store('notes')).toEqual([])
  })

  it('⛔⛔ never queues a write with a null baseline — a PUT with no compare-and-set', async () => {
    await mountWhileTheFetchIsStillInFlight()
    await letTheNoteLand()
    const queued = store('outbox')
    expect(queued.filter((e) => !e.baseUpdatedAt)).toEqual([])
  })

  it('⛔ the member’s prose survives the slow load — no empty document replaces it', async () => {
    await mountWhileTheFetchIsStillInFlight()
    await letTheNoteLand()
    await waitFor(() => expect(screen.getByPlaceholderText('Title')).toHaveValue('NVDA thesis'))
    for (const rec of store('notes')) {
      expect(JSON.stringify(rec.bodyJson)).toContain('Real prose the member wrote')
    }
    const raw = localStorage.getItem(DRAFT_KEY)
    if (raw) expect(JSON.stringify(JSON.parse(raw).bodyJson)).toContain('Real prose the member wrote')
  })
})

describe('⚰️ THE CANARY — a note the SERVER still holds empty', () => {
  // ⛔ This is the shape that went red in production on 2026-09-09: the member
  // creates a note, types into it, and reloads before the PUT lands — so the
  // server's copy is still `{title:"", subtitle:"", bodyJson:{doc,[]}}`.
  // `useEditor` is keyed on `[note?.id]`, so it REBUILDS the editor when that
  // note arrives, and rebuilds it EMPTY. ProseMirror repairs the schema-invalid
  // empty doc with an appended transaction, TipTap emits `update`, and the page
  // autosaved a document nobody wrote.

  it('⛔ writes NOTHING anywhere for a note the member never touched', async () => {
    SERVED = EMPTY_NOTE
    await mountWhileTheFetchIsStillInFlight()
    await letTheNoteLand()
    if (draftWrites.length) {
      // eslint-disable-next-line no-console
      console.log('UNPROVOKED WRITE:', draftWrites[0].value, draftWrites[0].stack)
    }
    expect(draftWrites).toHaveLength(0)
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(store('notes')).toEqual([])
    expect(store('outbox')).toEqual([])
  })

  it('⛔ …and queues nothing even when the save cannot land', async () => {
    SERVED = EMPTY_NOTE
    // A two-minute-old pod: the note fetch is slow AND the save does not land,
    // so a queued entry would SURVIVE to be drained on the next reconnect.
    updateMock.mockRejectedValue(Object.assign(new Error('network'), { status: 0 }))
    await mountWhileTheFetchIsStillInFlight()
    await letTheNoteLand()
    expect(store('outbox')).toEqual([])
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('⭐ CONTROL — the same harness DOES see a real keystroke', async () => {
    // Without this the four refusals above could all be passing because the
    // detector is blind. It is not: one keystroke, and every layer moves.
    SERVED = EMPTY_NOTE
    await mountWhileTheFetchIsStillInFlight()
    await letTheNoteLand()
    const before = draftWrites.length
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'typed' } })
    expect(draftWrites.length).toBeGreaterThan(before)
    await act(async () => { vi.advanceTimersByTime(300); await settleIdb(6) })
    expect(store('notes')).toHaveLength(1)
    expect(store('notes')[0].title).toBe('typed')
  })

  it('⭐ CONTROL — a note with a BODY still loads, and still saves', async () => {
    // The gate must not be reachable by making the product read-only. This is
    // the ordinary path, through the same slow fetch.
    await mountWhileTheFetchIsStillInFlight()
    await letTheNoteLand()
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'NVDA thesis v2' } })
    await act(async () => { vi.advanceTimersByTime(300); await settleIdb(6) })
    const notes = store('notes')
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toBe('NVDA thesis v2')
    expect(JSON.stringify(notes[0].bodyJson)).toContain('Real prose the member wrote')
    expect(notes[0].baseUpdatedAt).toBe('T1')
  })
})
