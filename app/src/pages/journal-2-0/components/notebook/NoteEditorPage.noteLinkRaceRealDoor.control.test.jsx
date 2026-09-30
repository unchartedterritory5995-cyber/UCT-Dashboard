import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

/**
 * Lane FX5 — the CONTROL for `NoteEditorPage.noteLinkRaceRealDoor.test.jsx`.
 *
 * That sibling file asserts the `[[` popup survives a real autosave landing
 * mid-query, by querying the DOM (`popup()`, `screen.getByText`). A DOM query
 * that always finds what it looks for is not evidence of anything — this file
 * proves the SAME rig, the SAME assertions, can actually observe the popup
 * vanish, by forcing back the ONE thing lane LK's fix (`dcb7bfcb1`) changed:
 * `@tiptap/suggestion`'s `allowSpaces` on the `[[` menu specifically (never
 * touching SlashMenu's own `/`-triggered instance, which keeps `allowSpaces:
 * true` for an unrelated reason of its own).
 *
 * Product code is NOT edited to do this — `@tiptap/suggestion` itself is
 * mocked, keyed on `char === '[['`, so only the note-link menu's config is
 * forced back to the pre-fix shape.
 *
 * This is the automated counterpart to this lane's manual mutation proof
 * (temporarily editing `NoteLinkMenu.jsx`'s `allowSpaces: true` to `false`,
 * confirming lane LK's own `NoteEditorPage.noteLinkSuggest.test.jsx` goes red,
 * then restoring the file from the captured original bytes and verifying its
 * sha256 — see this lane's handback for the two hashes).
 */

vi.mock('@tiptap/suggestion', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    default: (config) => actual.default(
      config?.char === '[[' ? { ...config, allowSpaces: false } : config,
    ),
  }
})

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

async function typeSlowly(editor, text, delayMs = 90) {
  for (const ch of text) {
    act(() => { editor.commands.insertContent(ch) })
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await vi.advanceTimersByTimeAsync(delayMs) })
  }
}

const popup = () => document.querySelector('[class*="popupWrap"]')

describe('CONTROL — the `[[` rig can see the popup vanish once allowSpaces is forced off (lane FX5)', () => {
  it('loses the popup the instant a space is typed, with allowSpaces forced false', async () => {
    const editor = await renderEditor()

    await typeSlowly(editor, '[[Beta')
    expect(popup()).toBeTruthy()

    // The space after "Beta" is exactly what lane LK's fix protects against.
    // With allowSpaces forced off, `@tiptap/suggestion`'s match regex stops at
    // the whitespace and the plugin exits synchronously.
    act(() => { editor.commands.insertContent(' ') })
    await act(async () => { await vi.advanceTimersByTimeAsync(90) })

    expect(popup()).toBeFalsy()

    // And typing the rest of a realistic title never brings it back — this is
    // the exact shape DR-F's own capture showed (a `q=Beta`-only search GET,
    // never `q=Beta thesis AMD`).
    await typeSlowly(editor, 'thesis AMD')
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(popup()).toBeFalsy()
    expect(screen.queryByText('Background Thesis')).toBeNull()
  })
})
