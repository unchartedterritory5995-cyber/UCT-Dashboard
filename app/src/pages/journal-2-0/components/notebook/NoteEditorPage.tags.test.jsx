/**
 * Wave 6 items 9 + 12 — the note's tags in the editor: suggestions from the
 * member's own tags (TagSuggestInput), and every change sent as a DELTA applied
 * to the list the SERVER holds at that moment.
 *
 * ⚰️ The field used to PUT its whole comma list on blur — the list loaded when
 * the note opened — which undid a bulk tag change made in another tab.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const NOTE = {
  id: 'n1', title: 'NVDA thesis', subtitle: '', folderId: null,
  ticker: null, tags: ['earnings'], heroImageUrl: null, updatedAt: 'T1', isFavorite: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] },
}

const updateMock = vi.fn()
const refreshMock = vi.fn()
const patchTagsMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({
    note: NOTE, isLoading: false, error: null, update: updateMock, refresh: refreshMock, patchTags: patchTagsMock,
  }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

let serverTags
let serverReachable
beforeEach(() => {
  serverTags = ['earnings', 'bulk-added-in-another-tab']
  serverReachable = true
  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => ({ ...NOTE, ...patch, updatedAt: 'T2' }))
  patchTagsMock.mockReset()
  patchTagsMock.mockImplementation(async () => ({ ...NOTE, updatedAt: 'T2' }))
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u === '/api/j2/notes/tags') {
      return { ok: true, json: async () => ({ tags: [{ tag: 'research/semis', count: 3 }], tree: null }) }
    }
    if (u === '/api/j2/notes/n1') {
      if (!serverReachable) throw new TypeError('Failed to fetch')
      return { ok: true, json: async () => ({ note: { ...NOTE, tags: serverTags } }) }
    }
    return { ok: true, json: async () => ({}) }
  })
})
afterEach(() => vi.clearAllMocks())

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
}
const addTag = (value) => {
  const input = screen.getByRole('combobox', { name: 'Add a tag to this note' })
  fireEvent.change(input, { target: { value } })
  fireEvent.submit(input.closest('form'))
}
const tagPuts = () => updateMock.mock.calls.map(([patch]) => patch).filter((p) => 'tags' in p)
const tagPatches = () => patchTagsMock.mock.calls

describe('the tag field sends DELTAS', () => {
  it('the old comma field is gone; the note\'s tags are chips', async () => {
    await renderEditor()
    expect(screen.queryByPlaceholderText('Tags (comma sep)')).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove tag earnings' })).toBeTruthy()
  })

  // ⛔ Wave 7 (M14): the delta itself goes to PATCH /notes/{id}/tags, which
  // applies it to the stored list inside ONE transaction -- so a second
  // device's tag change landing between this page's read and its write is
  // kept, not overwritten by a list computed before it existed. A PUT of a
  // whole list could not promise that, however fresh the read.
  it('an ADD sends the DELTA to the tag door — never a whole list — at the revision it read', async () => {
    await renderEditor()
    addTag('mine')
    await waitFor(() => expect(tagPatches()).toHaveLength(1))
    expect(tagPatches()[0]).toEqual([{ add: ['mine'] }, { readAt: 'T1' }])
    expect(tagPuts()).toEqual([])
  })

  it('a REMOVE sends only that tag as the delta', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag earnings' }))
    await waitFor(() => expect(tagPatches()).toHaveLength(1))
    expect(tagPatches()[0]).toEqual([{ remove: ['earnings'] }, { readAt: 'T1' }])
    expect(tagPuts()).toEqual([])
  })

  it('a refused delta says so and changes nothing on the page', async () => {
    patchTagsMock.mockImplementation(async () => { const e = new Error('400'); e.status = 400; throw e })
    await renderEditor()
    addTag('mine')
    expect(await screen.findByText('Couldn\'t update tags — try again')).toBeTruthy()
  })

  it('a change that changes nothing sends nothing (adding a tag the server already has)', async () => {
    await renderEditor()
    addTag('Bulk-Added-In-Another-Tab')
    await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => u === '/api/j2/notes/n1')).toBe(true))
    await new Promise((r) => setTimeout(r, 20))
    expect(tagPuts()).toEqual([])
    expect(tagPatches()).toEqual([])
  })

  // ⛔ M14 (wave 6 fix round 1): the no-op still LEARNED something -- the
  // server's list differs from the one on screen (the member added a tag the
  // chips did not show). The page re-reads the note so the chips show it.
  it('…but the chips are brought up to date with the server list it just read', async () => {
    await renderEditor()
    refreshMock.mockClear()
    addTag('Bulk-Added-In-Another-Tab')
    await waitFor(() => expect(refreshMock).toHaveBeenCalled())
    expect(tagPuts()).toEqual([])
    expect(tagPatches()).toEqual([])
  })

  it('when the server\'s list cannot be read, NOTHING is written (an unchecked list is never sent)', async () => {
    serverReachable = false
    await renderEditor()
    addTag('mine')
    await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => u === '/api/j2/notes/n1')).toBe(true))
    await new Promise((r) => setTimeout(r, 20))
    expect(tagPuts()).toEqual([])
    expect(tagPatches()).toEqual([])
    expect(await screen.findByText('Couldn\'t update tags — try again')).toBeTruthy()
  })

  it('suggestions come from the member\'s own tags', async () => {
    await renderEditor()
    const input = screen.getByRole('combobox', { name: 'Add a tag to this note' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'sem' } })
    expect(await screen.findByRole('option', { name: 'research / semis' })).toBeTruthy()
  })
})
