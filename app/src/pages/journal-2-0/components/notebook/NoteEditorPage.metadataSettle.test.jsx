/**
 * Wave 6 lane D, fix round 1 — found while fixing I1: A METADATA DOOR MUST NEVER
 * QUEUE WORDS THE EDITOR NEVER SAW.
 *
 * `settleMetadataRevision` (the folder, ticker and tag doors, and now Unlock)
 * settles the durable copy onto the revision the door created, taking the
 * server's answer as `acked` and the editor as `current`. That is right when the
 * server's copy differs from what this editor last knew by metadata ONLY — the
 * door moved a field, nothing else. ⚰️ It was also run when the server's copy
 * held words this editor NEVER SAW (another device wrote them after this editor
 * loaded): `acked` ≠ `current`, so the settle read the editor's older body as
 * "unsent work", queued it ON THE NEW REVISION — and a drain after the note
 * closed sent it with a matching base, 200, over the other device's words. No
 * 409, no fork: a clobber. (The same happens to a block the SERVER appended —
 * a Send-to-Journal capture — which the queued body lacks.)
 *
 * ⭐ The fix asks the reconcile's own authority, `classifyServerChange`, before
 * settling: METADATA_ONLY settles; anything else records the landing only, and
 * the next save 409s into the reconcile, which merges or forks.
 */
import { render, screen, act, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb } from '../../lib/offline/__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections, connectNotebookDb } from '../../lib/offline/useDurableNote'
import { OFFLINE_FLAG_KEY } from '../../lib/offline/offlineFlag'
import { dbNameFor } from '../../lib/offline/notebookDb'
import { drainOutbox } from '../../lib/offline/outboxDrain'
import { landedKeyFor } from '../../lib/offline/inFlight'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const T1 = '2026-09-24T14:00:00.000000+00:00'
const T2 = '2026-09-24T14:05:00.000000+00:00'
const T3 = '2026-09-24T14:06:00.000000+00:00'
const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const baseNote = () => ({
  id: 'n1', title: 'NVDA thesis', subtitle: '', folderId: null,
  ticker: null, tags: ['earnings'], heroImageUrl: null, updatedAt: T1,
  isFavorite: false, bodyJson: doc('Original body'),
})

let NOTE
let server
const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u42', role: 'member' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

const ACCOUNT_DB = dbNameFor('u42')
let factory
const store = (name) => factory.databases.get(ACCOUNT_DB)?.dump(name) ?? []

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  NOTE = baseNote()
  server = { ...NOTE }
  updateMock.mockReset()
  // `update_note` for a METADATA patch: no baseline, so it lands on whatever the
  // server holds, and answers with the whole note at the new revision.
  updateMock.mockImplementation(async (patch) => {
    if (patch && 'baseUpdatedAt' in patch && patch.baseUpdatedAt !== server.updatedAt) {
      const err = new Error('conflict'); err.status = 409; throw err
    }
    const { baseUpdatedAt, ...fields } = patch || {}
    server = { ...server, ...fields, updatedAt: T3 }
    return { ...server }
  })
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url)
    const method = (opts.method || 'GET').toUpperCase()
    if (u === '/api/j2/notes/tags') return { ok: true, json: async () => ({ tags: [], tree: null }) }
    if (u === '/api/j2/notes/n1' && method === 'GET') return { ok: true, json: async () => ({ note: { ...server } }) }
    return { ok: true, json: async () => ({}) }
  })
  __resetNotebookConnections()
  factory = createFakeIndexedDbFactory()
  globalThis.indexedDB = factory
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

async function addTagAndSettle(value) {
  // HOTFIX VARIANT (master): the tag door is the header's comma-separated input,
  // committed on blur -> onTagsChange -> settleMetadataRevision. The wave-5/6
  // branch drives its combobox instead; the door behind both is the same.
  const input = screen.getByPlaceholderText('Tags (comma sep)')
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
  await waitFor(() => expect(updateMock.mock.calls.some(([p]) => p && 'tags' in p)).toBe(true))
  await act(async () => { await settleIdb(8) })
}

/** The drain a later page load runs once the note is closed: a compare-and-set send. */
async function drainAfterTheNoteCloses() {
  cleanup()
  const db = await connectNotebookDb('u42')
  return drainOutbox(db, {
    send: async (entry) => {
      if (entry.baseUpdatedAt !== server.updatedAt) { const e = new Error('conflict'); e.status = 409; throw e }
      server = { ...server, ...entry.patch, updatedAt: '2026-09-24T14:09:00.000000+00:00' }
      return { ...server }
    },
    fork: async () => ({ ...server }),
  })
}

describe('a metadata door never queues words the editor never saw', () => {
  it('another device wrote after this editor loaded; a tag change here must not put the old words back', async () => {
    await renderEditor()
    // Another device writes words this editor never sees.
    server = { ...server, bodyJson: doc('Another device wrote this'), updatedAt: T2 }
    await addTagAndSettle('mine')

    expect(
      store('outbox').filter((e) => e.baseUpdatedAt === T3),
      'the editor\'s old body was queued on the revision that holds the other device\'s words',
    ).toEqual([])
    // ⭐ The landing is still recorded: the tag change was ours.
    expect(store('meta').find((m) => m.name === landedKeyFor('n1'))?.value ?? []).toContain(T3)

    await drainAfterTheNoteCloses()
    expect(server.bodyJson, 'a drain overwrote the other device\'s words with no 409 and no fork')
      .toEqual(doc('Another device wrote this'))
  })

  it('CONTROL — when only metadata moved, the door settles the durable copy onto its revision as before', async () => {
    await renderEditor()
    await addTagAndSettle('mine')
    const rec = store('notes').find((r) => r.noteId === 'n1')
    expect(rec?.baseUpdatedAt).toBe(T3)
    expect(rec?.dirty).toBe(0)
    expect(store('outbox')).toEqual([])
  })
})
