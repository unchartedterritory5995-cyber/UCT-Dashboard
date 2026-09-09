/**
 * ⚰️⚰️ WAVE Q1 ENTRY GATE — THE 409 THAT OVERWROTE THE SERVER'S PROSE.
 *
 * `PUT /api/j2/notes/{id}` is a compare-and-set: the client sends the
 * `baseUpdatedAt` it last saw and the server 409s if it has moved on. That part
 * has always worked. What the CLIENT did with the 409 did not:
 *
 *   reconcileConflict()  →  GET the fresh note
 *                        →  append ONLY the widgetEmbed nodes it is missing
 *                        →  advance the local baseline to the server's
 *                        →  retry the PUT with the LOCAL document
 *
 * So any newer server change that is not a widgetEmbed — the member's prose,
 * their title, their subtitle — was replaced by the local copy on the retry.
 * The code is honest about where it came from (the comment calls it "the
 * appends rail", built for the Send-to-Journal server-side append), and against
 * that one case it is correct. Against two humans it is last-write-wins.
 *
 * ⛔ AND IT HAD NO RAIL. The only 409 test in the Notebook was on version
 * RESTORE. This file is the missing one, and it is a Wave Q entry gate: an
 * offline outbox manufactures the stale-baseline case on purpose, so a handler
 * that can still turn a 409 into an overwrite cannot be its foundation.
 *
 * The contract these rails pin:
 *   · a server change that is PROVABLY an append-only widgetEmbed merge → merge
 *   · anything else → preserve BOTH. The server keeps its version, the local
 *     version becomes a "(conflicted copy)" sibling tagged `sync-conflict`.
 */
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const BASE_BODY = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original body' }] }],
}
const NOTE = {
  id: 'n1', title: 'NVDA thesis', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: 'T1',
  isFavorite: false, bodyJson: BASE_BODY,
}

// What the SERVER looks like after somebody else moved it on. Title AND body:
// §24 treats body/title/subtitle as one coherent authored state, so losing the
// title is the same defect as losing the prose.
const SERVER_PROSE_CHANGED = {
  ...NOTE, updatedAt: 'T2',
  title: 'NVDA thesis — revised on another device',
  bodyJson: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body edited on another device' }] }],
  },
}
// The one case the old handler was actually built for: the server APPENDED a
// widget embed and changed nothing else.
const SERVER_APPENDED_EMBED = {
  ...NOTE, updatedAt: 'T2',
  bodyJson: {
    type: 'doc',
    content: [
      ...BASE_BODY.content,
      { type: 'widgetEmbed', attrs: { widgetId: 'w1', capturedAt: 'C1', searchText: 'SPY' } },
    ],
  },
}

const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

function conflict() {
  const e = new Error('note changed — refresh and retry')
  e.status = 409
  return e
}

let fetchMock
let serverNote

beforeEach(() => {
  localStorage.clear()
  updateMock.mockReset()
  serverNote = SERVER_PROSE_CHANGED
  fetchMock = vi.fn((url, opts) => {
    const u = String(url)
    if (u === '/api/j2/notes/n1' && (!opts || !opts.method || opts.method === 'GET')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: serverNote }) })
    }
    if (u === '/api/j2/notes' && opts?.method === 'POST') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: { id: 'fork1', title: 'x' } }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
  global.fetch = fetchMock
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  localStorage.clear()
})

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
}

/** A real edit through the real control, on the real editor — the same lever
 *  every other NoteEditorPage rail uses. */
const LOCAL_TITLE = 'NVDA thesis — my offline edit'
async function editLocallyAndLetAutosaveFire() {
  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: LOCAL_TITLE } })
  await act(async () => { vi.advanceTimersByTime(900) })
}

const postedNotes = () =>
  fetchMock.mock.calls.filter(([u, o]) => String(u) === '/api/j2/notes' && o?.method === 'POST')

describe('a 409 must never overwrite the server', () => {
  it('does NOT re-send the local body after the server prose moved on', async () => {
    updateMock.mockRejectedValue(conflict())
    await renderEditor()
    await editLocallyAndLetAutosaveFire()
    await act(async () => { vi.advanceTimersByTime(200) })

    // ⛔ THE DEFECT, STATED AS A RULE: exactly ONE PUT, and it was rejected.
    // The old handler advanced its baseline to the server's revision and
    // retried with the LOCAL patch — which is what discarded
    // "NVDA thesis — revised on another device".
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock.mock.calls[0][0].baseUpdatedAt).toBe('T1')
  })

  it('preserves the local version as a "(conflicted copy)" sibling', async () => {
    updateMock.mockRejectedValue(conflict())
    await renderEditor()
    await editLocallyAndLetAutosaveFire()
    await act(async () => { vi.advanceTimersByTime(200) })

    await waitFor(() => expect(postedNotes().length).toBe(1))
    const body = JSON.parse(postedNotes()[0][1].body)
    expect(body.title).toContain('conflicted copy')
    // ⛔ The SAME vocabulary the connectors already gave members, not a second
    // offline-only conflict system.
    expect(body.tags).toContain('sync-conflict')
    // And it must carry the member's work, not an empty shell.
    expect(body.title).toContain(LOCAL_TITLE)
  })

  it('tells the member, and does not pretend the save succeeded', async () => {
    updateMock.mockRejectedValue(conflict())
    await renderEditor()
    await editLocallyAndLetAutosaveFire()
    await act(async () => { vi.advanceTimersByTime(200) })
    await waitFor(() => expect(screen.getByText(/conflict/i)).toBeInTheDocument())
  })

  it('leaves the SERVER version in the editor afterwards', async () => {
    updateMock.mockRejectedValue(conflict())
    await renderEditor()
    await editLocallyAndLetAutosaveFire()
    await act(async () => { vi.advanceTimersByTime(200) })
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Title').value)
        .toBe('NVDA thesis — revised on another device'))
  })
})

describe('the append-only case the handler was built for still merges', () => {
  it('a server-appended widgetEmbed is merged and retried, not forked', async () => {
    // ⭐ THE CONTROL. Without it the fix could be a blanket refusal, which
    // would break Send-to-Journal — the reason reconcileConflict exists.
    serverNote = SERVER_APPENDED_EMBED
    updateMock
      .mockRejectedValueOnce(conflict())
      .mockResolvedValue({ ...NOTE, updatedAt: 'T3' })
    await renderEditor()
    await editLocallyAndLetAutosaveFire()
    await act(async () => { vi.advanceTimersByTime(200) })

    await waitFor(() => expect(updateMock.mock.calls.length).toBeGreaterThan(1))
    expect(postedNotes().length).toBe(0)          // no fork
    const retry = updateMock.mock.calls[updateMock.mock.calls.length - 1][0]
    expect(retry.baseUpdatedAt).toBe('T2')        // retried against the server's revision
    expect(retry.title).toBe(LOCAL_TITLE)         // the member's edit survived
    expect(JSON.stringify(retry.bodyJson)).toContain('widgetEmbed')  // and so did the append
  })
})
