/**
 * Wave 6 item 7 — the editor's half of lane F's telemetry (lib/notebookTelemetry.js):
 * save_failed and conflict_forked {door:'editor'}, fired from the real save and
 * fork paths, with the sanitised props only (no text, no ids). note_open_ms is
 * railed in NoteEditorPage.wave6.test.jsx with the ?task= door it reports.
 */
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const NOTE = {
  id: 'n1', title: 'NVDA thesis', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: 'T1', isFavorite: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original body' }] }] },
}
const SERVER_MOVED_ON = {
  ...NOTE, updatedAt: 'T2', title: 'Revised on another device',
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Edited elsewhere' }] }] },
}

const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

const httpError = (status, message = String(status)) => Object.assign(new Error(message), { status })

let fetchMock
beforeEach(() => {
  localStorage.clear()
  updateMock.mockReset()
  fetchMock = vi.fn((url, opts) => {
    const u = String(url)
    if (u === '/api/j2/notes/n1' && (!opts || !opts.method || opts.method === 'GET')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: SERVER_MOVED_ON }) })
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
async function editAndLetAutosaveFire() {
  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'My local title' } })
  await act(async () => { vi.advanceTimersByTime(900) })
}
const sent = (event) => fetchMock.mock.calls
  .filter(([u, o]) => u === '/api/j2/telemetry' && o?.method === 'POST')
  .map(([, o]) => JSON.parse(o.body))
  .filter((b) => b.event === event)

describe('save_failed', () => {
  it('a save that gives up (a 4xx) is reported once, as http, not retrying', async () => {
    updateMock.mockRejectedValue(httpError(404))
    await renderEditor()
    await editAndLetAutosaveFire()
    await waitFor(() => expect(sent('save_failed')).toHaveLength(1))
    expect(sent('save_failed')[0].props).toEqual({ status: 404, reason: 'http', offline: false, retrying: false })
  })

  it('a retry streak (network) is reported ONCE when it begins, never per backoff attempt', async () => {
    updateMock.mockRejectedValue(new Error('Failed to fetch'))
    await renderEditor()
    await editAndLetAutosaveFire()
    await waitFor(() => expect(updateMock.mock.calls.length).toBeGreaterThanOrEqual(1))
    for (let i = 0; i < 4; i += 1) await act(async () => { vi.advanceTimersByTime(20000) })
    expect(updateMock.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(sent('save_failed')).toHaveLength(1)
    expect(sent('save_failed')[0].props).toEqual({ status: 0, reason: 'network', offline: false, retrying: true })
  })

  it('a save that lands reports nothing', async () => {
    updateMock.mockResolvedValue({ ...NOTE, updatedAt: 'T9' })
    await renderEditor()
    await editAndLetAutosaveFire()
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(sent('save_failed')).toEqual([])
  })
})

describe('conflict_forked', () => {
  it('the editor\'s fork is counted once, door "editor", with no text or ids', async () => {
    updateMock.mockRejectedValue(httpError(409, 'note changed'))
    await renderEditor()
    await editAndLetAutosaveFire()
    await act(async () => { vi.advanceTimersByTime(200) })
    await waitFor(() => expect(sent('conflict_forked')).toHaveLength(1))
    expect(sent('conflict_forked')[0].props).toEqual({ door: 'editor', queued: false })
    expect(JSON.stringify(sent('conflict_forked')[0])).not.toMatch(/NVDA|local title|n1|fork1/)
  })
})
