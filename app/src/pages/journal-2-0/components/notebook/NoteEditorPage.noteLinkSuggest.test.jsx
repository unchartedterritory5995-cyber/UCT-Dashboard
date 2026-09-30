import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// jsdom has no layout (same guard as NoteEditorPage.wave6.test.jsx): a
// focus()-triggered scrollIntoView measures a Range, which jsdom doesn't
// implement.
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

// Lane LK — the real defect behind DR-F's "`[[Beta thesis AMD` never shows a
// result" finding, reproduced through the REAL editor + the REAL
// NoteLinkMenuExtension (no mocked TipTap, no mocked Suggestion plugin), with
// a REAL autosave landing mid-typing via a mocked `update()`.
//
// THE MECHANISM (see the comment beside `allowSpaces: true` in
// NoteLinkMenu.jsx): `@tiptap/suggestion`'s default `allowSpaces: false`
// breaks the match the instant a space is typed after the first word of a
// note title, and the plugin tears the popup down SYNCHRONOUSLY in that same
// transaction -- well before either the note-search GET or the editor's
// autosave PUT can land. The two requests still fire (DR-F's own capture
// shows both a GET and a PUT before the popup reads gone) but neither one is
// the cause; they are just adjacent in time to a match that was already lost.
//
// This file proves that with ONE test that types a REALISTIC three-word
// title with per-key delays, lets the search AND a real ~800ms-debounced
// autosave land WHILE the popup is still open, and then picks the result --
// asserting the noteLink node actually lands in the document. It must fail
// on the unfixed NoteLinkMenu.jsx (mutation-proved below) and pass once
// `allowSpaces: true` is set.

const NOTE = {
  id: 'n1', title: 'Original Title', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }] }] },
}

const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

beforeEach(() => {
  updateMock.mockReset()
  updateMock.mockResolvedValue({ updatedAt: '2026-01-01T00:05:00Z' })
  global.fetch = vi.fn((url) => {
    if (typeof url === 'string' && url.startsWith('/api/j2/notes?q=')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ notes: [{ id: 'target-1', title: 'Background Thesis', ticker: null }] }),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  const el = document.querySelector('.ProseMirror')
  return el.editor
}

/** One ProseMirror transaction per character, each separated by a real
 *  per-key delay -- the same shape a person's keystrokes produce (and the
 *  thing DR-F's `pg.keyboard.type()` with no delay did NOT reproduce). */
async function typeSlowly(editor, text, delayMs = 90) {
  for (const ch of text) {
    act(() => { editor.commands.insertContent(ch) })
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await vi.advanceTimersByTimeAsync(delayMs) })
  }
}

const popup = () => document.querySelector('[class*="popupWrap"]')

describe('NoteEditorPage — `[[` link suggestion survives a real multi-word title + a concurrent autosave (lane LK)', () => {
  it('keeps the popup open with results through the search debounce AND the autosave debounce, and inserts the picked noteLink', async () => {
    const editor = await renderEditor()

    // Type the trigger, then a REAL three-word title, at a human cadence.
    // Every keystroke re-arms the 800ms autosave debounce (NoteEditorPage's
    // own `scheduleAutosave`), so by the time typing is done the autosave
    // timer is freshly counting down from the LAST character -- exactly
    // DR-F's scenario, but with the debounce actually respected rather than
    // typed in one instantaneous burst.
    await typeSlowly(editor, '[[Beta thesis AMD')

    // The popup must still be there RIGHT AFTER typing finishes -- if
    // `allowSpaces` is missing, it died the instant the first space (after
    // "Beta") was typed, long before this point.
    expect(popup()).toBeTruthy()

    // Let the note-search's 150ms debounce land.
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    await waitFor(() => {
      const calls = global.fetch.mock.calls.map((c) => c[0])
      expect(calls.some((u) => typeof u === 'string' && u.includes('q=Beta%20thesis%20AMD'))).toBe(true)
    })
    await waitFor(() => expect(screen.getByText('Background Thesis')).toBeInTheDocument())
    expect(popup()).toBeTruthy()

    // Now let the ~800ms autosave debounce (counted from the LAST keystroke,
    // ~200ms of which has already elapsed above) land too, while the
    // suggestion session is still open with results on screen.
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    await waitFor(() => expect(updateMock).toHaveBeenCalled())

    // THE ASSERTION: an in-flight (now landed) autosave must not have
    // destroyed the open suggestion session.
    expect(popup()).toBeTruthy()
    expect(screen.getByText('Background Thesis')).toBeInTheDocument()

    // Pick it -- the same `onMouseDown` path a real click drives.
    const option = screen.getByRole('option', { name: /Background Thesis/ })
    act(() => { option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })) })

    // The noteLink node landed, replacing the typed `[[Beta thesis AMD` text.
    let found = null
    editor.state.doc.descendants((n) => { if (n.type.name === 'noteLink') found = n })
    expect(found?.attrs.noteId).toBe('target-1')
    expect(editor.state.doc.textContent).not.toContain('Beta thesis AMD')
    expect(popup()).toBeFalsy()

    // And the insert is itself an edit the autosave picks up -- the saved
    // body the member sees reflected back carries the link, not just the
    // in-memory document.
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    await waitFor(() => {
      const last = updateMock.mock.calls.at(-1)
      const body = JSON.stringify(last?.[0]?.bodyJson || {})
      expect(body).toContain('"noteLink"')
      expect(body).toContain('target-1')
    })
  })
})
