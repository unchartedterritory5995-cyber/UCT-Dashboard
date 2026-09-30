import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// jsdom has no layout (same guard as NoteEditorPage.wave6.test.jsx / lane LK's
// NoteEditorPage.noteLinkSuggest.test.jsx): a focus()-triggered scrollIntoView
// measures a Range, which jsdom doesn't implement.
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

/**
 * Lane FX5 — DR-F's `[[` link-menu-vs-autosave finding
 * (`docs/notebook/design-review-2.md`, "D-7 / D-8 / D-9 follow-up" section;
 * raw capture `docs/notebook/proof/drf-d165ab9f1/link-menu-debug/debug_log.txt`)
 * re-investigated from source and closed with a real-write-door proof.
 *
 * THE MECHANISM (confirmed, not assumed — see the mutation proof in this
 * lane's handback): DR-F's own capture shows the note-search GET landing as
 * `q=Beta` — a SINGLE word — although the member typed the three-word title
 * `Beta thesis AMD`. That is only possible if the suggestion match was already
 * lost the instant the space after "Beta" was typed, which is exactly
 * `@tiptap/suggestion`'s documented behaviour when `allowSpaces` is unset
 * (`NoteLinkMenu.jsx`, the comment beside `allowSpaces: true` at ~line 167).
 * Lane LK (`dcb7bfcb1`, already an ancestor of this branch) named and fixed
 * that mechanism and proved it with a mocked-hook test
 * (`NoteEditorPage.noteLinkSuggest.test.jsx`). The autosave PUT in DR-F's own
 * capture landed AFTER the match was already dead — adjacent in time, not
 * causal.
 *
 * WHAT THIS FILE ADDS, because LK's test mocks `useJ2Notes` (`update` is a
 * `vi.fn()` that never touches SWR): it re-runs the same race through the
 * REAL write door (`app/src/pages/journal-2-0/hooks/useJ2Notes.js::useJ2Note`
 * — only `fetch` is mocked), so the autosave's `settleNoteWrite` call and its
 * `mutate({note: body.note}, {revalidate:false})` (which swaps in a BRAND NEW
 * `note` object, JSON round-tripped through the mocked server response, not
 * the same reference the editor produced) both actually run. A single-word
 * query ("Beta", no space) is used on purpose, so `allowSpaces` is not the
 * variable under test here — this file isolates the autosave/SWR-identity
 * question LK's coarser mock could not exercise.
 *
 * Asserts on RENDERED DOM (`popup()`, `screen.getByText`), never on internal
 * state, per this lane's brief.
 */

const NOTE = {
  id: 'n1', title: 'Original Title', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }] }] },
}

vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

beforeEach(() => {
  // Only `fetch` is mocked — `useJ2Notes.js::useJ2Note` runs for real, so its
  // `update()` really does PUT, really does call `settleNoteWrite`, and
  // really does `mutate({note: body.note}, {revalidate: false})`.
  global.fetch = vi.fn((url, opts) => {
    if (typeof url === 'string' && url.startsWith('/api/j2/notes?q=')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ notes: [{ id: 'target-1', title: 'Background Thesis', ticker: null }] }),
      })
    }
    if (typeof url === 'string' && url === `/api/j2/notes/${NOTE.id}` && opts?.method === 'PUT') {
      const patch = JSON.parse(opts.body)
      // A real server round trip: the PUT response's bodyJson is a FRESH
      // object (JSON parsed), never the same reference the editor produced —
      // this is what lets `mutate` swap `note` to a genuinely new identity.
      const merged = {
        ...NOTE,
        ...patch,
        bodyJson: patch.bodyJson ? JSON.parse(JSON.stringify(patch.bodyJson)) : NOTE.bodyJson,
        updatedAt: '2026-01-01T00:05:00Z',
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: merged }) })
    }
    if (typeof url === 'string' && url === `/api/j2/notes/${NOTE.id}`) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: NOTE }) })
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

async function typeSlowly(editor, text, delayMs = 90) {
  for (const ch of text) {
    act(() => { editor.commands.insertContent(ch) })
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await vi.advanceTimersByTimeAsync(delayMs) })
  }
}

const popup = () => document.querySelector('[class*="popupWrap"]')

describe('NoteEditorPage — `[[` link suggestion survives a REAL autosave write door (lane FX5)', () => {
  it('keeps the popup open with results and the typed query intact through a real PUT + SWR note-identity swap', async () => {
    const editor = await renderEditor()

    await typeSlowly(editor, '[[Beta')
    expect(popup()).toBeTruthy()
    expect(editor.getText()).toContain('Beta')

    // Let the note-search's 150ms debounce land.
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    await waitFor(() => {
      const calls = global.fetch.mock.calls.map((c) => c[0])
      expect(calls.some((u) => typeof u === 'string' && u.includes('q=Beta'))).toBe(true)
    })
    await waitFor(() => expect(screen.getByText('Background Thesis')).toBeInTheDocument())
    expect(popup()).toBeTruthy()

    // Let the real ~800ms-debounced autosave land: a real fetch PUT, a real
    // `settleNoteWrite`, and a real SWR `mutate` that swaps `note` for a new
    // object.
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    await waitFor(() => {
      const calls = global.fetch.mock.calls
      expect(calls.some((c) => c[1]?.method === 'PUT')).toBe(true)
    })
    // Flush whatever re-render the landed mutate triggers.
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })

    // THE ASSERTION: the landed autosave (real write door, real SWR identity
    // swap) must not have destroyed the open suggestion session, and the
    // typed query must not have been lost.
    expect(popup()).toBeTruthy()
    expect(screen.getByText('Background Thesis')).toBeInTheDocument()
    expect(editor.getText()).toContain('Beta')

    // Pick it — the same `onMouseDown` path a real click drives.
    const option = screen.getByRole('option', { name: /Background Thesis/ })
    act(() => { option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })) })

    let found = null
    editor.state.doc.descendants((n) => { if (n.type.name === 'noteLink') found = n })
    expect(found?.attrs.noteId).toBe('target-1')
    expect(popup()).toBeFalsy()
  })
})
