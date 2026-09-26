/**
 * Wave 6 lane D, fix round 1 — M6: A LOCKED NOTE IS NOT WRITTEN BY THE EDITOR.
 *
 * The lock is `editable = false`, never a transaction filter (lib/lockedNote.js
 * says why). But a few surfaces change the DOCUMENT on a locked note without the
 * member editing anything: a table-of-contents or Outline jump opens the
 * collapsed toggle around its heading, and a toggle's own chevron flips `open`.
 * ⚰️ Each fired `onUpdate` → the autosave → a PUT, so a note the member had
 * locked was written. And an Ask answer picked for a locked note was TAKEN from
 * its pending slot and then refused — gone — while a capture simply waits.
 *
 * ⭐ Now: while the note is locked, the editor's own document changes do not
 * schedule a save (a save already on its way still lands — words typed before a
 * lock arrived are never stranded), and an Ask answer waits for Unlock exactly
 * as a capture does.
 */
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writePendingAskInsert, clearPendingAskInsert, PENDING_ASK_INSERT_KEY } from '../../lib/askInsert'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const T1 = '2026-09-24T14:00:00.000000+00:00'
const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const H = (t) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t }] })
const BODY = { type: 'doc', content: [
  P('Intro.'),
  { type: 'tableOfContents' },
  { type: 'toggle', attrs: { open: false }, content: [
    { type: 'toggleSummary', content: [{ type: 'text', text: 'Details' }] },
    { type: 'toggleContent', content: [H('Plan'), P('Inside.')] },
  ] },
] }
const ASK_NODE = {
  type: 'askInsert', attrs: { insertedAt: '2026-09-24T12:00:00.000Z', scope: 'notebook', question: 'q' },
  content: [P('Inserted answer text.')],
}

let NOTE
const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

beforeEach(() => {
  localStorage.clear()
  clearPendingAskInsert()
  NOTE = {
    id: 'n1', title: 'NVDA thesis', subtitle: '', folderId: null, ticker: null, tags: [],
    heroImageUrl: null, updatedAt: T1, isFavorite: false, locked: true, bodyJson: BODY,
  }
  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => ({ ...NOTE, ...patch, updatedAt: '2026-09-24T14:09:00.000000+00:00' }))
  global.fetch = vi.fn(async (url, opts = {}) => {
    if (String(url) === '/api/j2/notes/n1/lock' && (opts.method || '').toUpperCase() === 'PATCH') {
      return { ok: true, status: 200, json: async () => ({ note: { ...NOTE, locked: false, updatedAt: '2026-09-24T14:05:00.000000+00:00' } }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  clearPendingAskInsert()
  localStorage.clear()
})

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  return waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el.editor
  })
}
const toggleOpen = (editor) => { let open = null; editor.state.doc.descendants((n) => { if (n.type.name === 'toggle') open = n.attrs.open }); return open }
const bodyPuts = () => updateMock.mock.calls.map(([p]) => p).filter((p) => p && 'bodyJson' in p)
async function jumpToPlan() {
  const link = await waitFor(() => {
    const b = [...document.querySelectorAll('.ProseMirror nav.uctToc button.uctTocLink')].find((x) => x.textContent === 'Plan')
    if (!b) throw new Error('no toc link')
    return b
  })
  fireEvent.click(link)
  await act(async () => { vi.advanceTimersByTime(2000) })
}

describe('M6 — a locked note is not written by the editor', () => {
  it('a TOC jump into a collapsed toggle opens it on screen and saves NOTHING while the note is locked', async () => {
    const editor = await renderEditor()
    expect(editor.isEditable).toBe(false)
    await jumpToPlan()
    expect(toggleOpen(editor), 'the jump did not open the toggle around its heading').toBe(true)
    expect(bodyPuts(), 'a locked note was written').toEqual([])
  })

  it('CONTROL — the same jump on an UNLOCKED note is an ordinary edit and saves', async () => {
    NOTE = { ...NOTE, locked: false }
    const editor = await renderEditor()
    await jumpToPlan()
    expect(toggleOpen(editor)).toBe(true)
    expect(bodyPuts().length).toBeGreaterThan(0)
  })

  it('an Ask answer picked for a locked note WAITS — it is neither taken nor refused — and lands on Unlock', async () => {
    writePendingAskInsert('n1', ASK_NODE)
    const editor = await renderEditor()
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(sessionStorage.getItem(PENDING_ASK_INSERT_KEY), 'the answer was taken from its slot').not.toBeNull()
    expect(screen.queryByText(/wasn't inserted/), 'the answer was refused and lost').toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await waitFor(() => expect(editor.isEditable).toBe(true))
    await waitFor(() => {
      let found = false
      editor.state.doc.descendants((n) => { if (n.type.name === 'askInsert') found = true })
      expect(found, 'the answer never landed after Unlock').toBe(true)
    })
    expect(sessionStorage.getItem(PENDING_ASK_INSERT_KEY)).toBeNull()
  })
})
