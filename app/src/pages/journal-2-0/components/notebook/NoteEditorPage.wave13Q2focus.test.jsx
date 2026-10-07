import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Wave 13, lane 13Q-2 (the click-by-click usability fixes). Q1's budget
// ("new blank note, cursor in body") measured the real cost of a fresh BLANK
// note landing in the TITLE (I-1's rule for every fresh note) and the member
// then having to reach the body by hand: 1 extra click (mouse/taps) or 4 real
// Tab presses (keys) -- `docs/notebook/evidence/wave13-13q2/before-run1`.
// NotebookTab now computes `blank = !title && !bodyJson` at the ONE place a
// note is created (NotebookTab.jsx::createNote) and passes `openFocus="body"`
// through for that case only; this file proves NoteEditorPage, given that
// prop, actually lands the caret in the ProseMirror body -- and that a
// non-blank open (a template, or an existing note) is UNCHANGED, so I-1's own
// rule survives this change rather than being silently widened.

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
let NOTE
const baseNote = () => ({
  id: 'n1', title: '', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false, locked: false,
  // A genuinely blank note's body is an EMPTY paragraph node with no `content`
  // key at all -- NOT `P('')`, which is a text node holding the empty string.
  // ProseMirror rejects that shape outright ("Empty text nodes are not
  // allowed"), the doc fails to parse, and `editor.commands.focus('end')` then
  // has no real position to land on -- which read as THIS fix doing nothing
  // the first time this file was written, when the bug was the fixture.
  bodyJson: { type: 'doc', content: [{ type: 'paragraph' }] },
})
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: vi.fn(async (p) => ({ ...NOTE, ...p })), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

beforeEach(() => {
  NOTE = baseNote()
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})
afterEach(() => vi.clearAllMocks())

async function renderEditor(openFocus) {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const onOpenFocused = vi.fn()
  render(
    <MemoryRouter>
      <NoteEditorPage noteId="n1" onBack={vi.fn()} showBack openFocus={openFocus} onOpenFocused={onOpenFocused} />
    </MemoryRouter>,
  )
  await screen.findByPlaceholderText('Title')
  await waitFor(() => {
    if (!document.querySelector('.ProseMirror')?.editor) throw new Error('editor not mounted')
  })
  return { onOpenFocused }
}

describe('13Q-2: openFocus="body" lands the caret in the note body', () => {
  it('focuses the ProseMirror body, not the title', async () => {
    const { onOpenFocused } = await renderEditor('body')
    await waitFor(() => {
      expect(document.activeElement?.closest('.ProseMirror')).toBeTruthy()
    })
    expect(document.activeElement).not.toBe(screen.getByPlaceholderText('Title'))
    expect(onOpenFocused).toHaveBeenCalledTimes(1)
  })

  // Non-vacuity + regression control: the SAME harness, the ONLY difference is
  // the prop -- proving 'body' actually did something (an instrument that
  // always lands on the body regardless of the prop would pass the test above
  // for the wrong reason) and that I-1's own 'title' rule is untouched.
  it('CONTROL: openFocus="title" still focuses the title input, unchanged (I-1)', async () => {
    await renderEditor('title')
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByPlaceholderText('Title'))
    })
    expect(document.activeElement?.closest('.ProseMirror')).toBeFalsy()
  })

  it('CONTROL: openFocus="landmark" (an existing note reopened) never lands in the title or the body', async () => {
    NOTE = { ...baseNote(), title: 'Existing note', bodyJson: { type: 'doc', content: [P('Already written.')] } }
    await renderEditor('landmark')
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('data-note-landmark')).not.toBeNull()
    })
    expect(document.activeElement).not.toBe(screen.getByPlaceholderText('Title'))
    expect(document.activeElement?.closest('.ProseMirror')).toBeFalsy()
  })

  it('a null openFocus (not an explicit open) places no focus at all', async () => {
    const { onOpenFocused } = await renderEditor(null)
    expect(onOpenFocused).not.toHaveBeenCalled()
  })
})
