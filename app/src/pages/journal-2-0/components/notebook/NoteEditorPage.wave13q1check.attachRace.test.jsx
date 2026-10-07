import { createElement, useEffect, useState } from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Wave 13, lane 13Q-Q1check -- controller follow-up #2 (unit rail).
 *
 * R-RAW measurement
 * (`docs/notebook/evidence/wave13-q1check/focus-hook-probe/results.json`,
 * commit a90976c005, 10/10 reps, both widths): at the exact moment the
 * 'body' openFocus `useLayoutEffect` used to call `editor.commands.focus('end')`,
 * `editor.view.dom.isConnected` was FALSE. `@tiptap/react`'s `EditorContent`
 * (a class component) attaches `editor.view.dom` into its own rendered
 * container in ITS OWN `componentDidMount`/`componentDidUpdate` -- a
 * separate commit from this effect's parent `useLayoutEffect` -- and the
 * same node was observed becoming connected 135-807ms later. `focus()` on a
 * disconnected node is a silent no-op: no `focusin`, no `activeElement`
 * change.
 *
 * HOW THIS REPRODUCES THE RACE WITH THE REAL LIBRARY, deterministically.
 * `useEditor` is untouched -- the editor it builds is real, and real tiptap
 * never attaches `editor.view.dom` into the live document on its own (no
 * `element` option is passed at `NoteEditorPage.jsx:2296`). What attaches it
 * is `EditorContent`'s own `componentDidMount`/`componentDidUpdate`
 * (`node_modules/@tiptap/react/dist/index.js`), so a governed stand-in that
 * renders NOTHING in `EditorContent`'s place leaves `editor.view.dom`
 * genuinely disconnected -- the same fact the real browser measured, not a
 * simulation of it. Flipping the governor to render the REAL `EditorContent`
 * is the real attach, on the real library's own timing, triggered by the
 * test rather than by a network race.
 *
 * RED BEFORE / GREEN AFTER (mutation-proof instructions at the bottom of
 * this file): reverting the retry loop in `NoteEditorPage.jsx` to the old
 * one-shot `editor.commands.focus('end')` call reds the first test below --
 * the one-shot effect fires while disconnected, consumes its one-shot claim,
 * and never retries once the real attach happens a tick later.
 */

let allowAttach = false
let setReadyRef = null
vi.mock('@tiptap/react', async (importOriginal) => {
  const real = await importOriginal()
  function GovernedEditorContent(props) {
    const [ready, setReady] = useState(allowAttach)
    useEffect(() => { setReadyRef = setReady }, [])
    if (!ready) return null
    return createElement(real.EditorContent, props)
  }
  return { ...real, EditorContent: GovernedEditorContent }
})

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const blankNote = () => ({
  id: 'n1', title: '', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false, locked: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph' }] },
})
let NOTE

vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: vi.fn(async (p) => ({ ...NOTE, ...p })), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

beforeEach(() => {
  NOTE = blankNote()
  allowAttach = false
  setReadyRef = null
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})
afterEach(() => vi.clearAllMocks())

async function renderHeldBack() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const onOpenFocused = vi.fn()
  render(
    <MemoryRouter>
      <NoteEditorPage noteId="n1" onBack={vi.fn()} showBack openFocus="body" onOpenFocused={onOpenFocused} />
    </MemoryRouter>,
  )
  await screen.findByPlaceholderText('Title')
  // The governor is withholding `EditorContent`, so `.ProseMirror` does not
  // exist yet -- the same observable fact the real browser measured
  // (`editor.view.dom.isConnected === false`), reached by a different route.
  expect(document.querySelector('.ProseMirror')).toBeNull()
  return { onOpenFocused }
}

async function releaseAttach() {
  await act(async () => {
    setReadyRef(true)
    await new Promise((r) => setTimeout(r, 0))
  })
  await waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor never attached')
  })
}

describe('13Q-Q1check follow-up #2: the body focus survives a disconnected-then-attached editor DOM', () => {
  it('fires onOpenFocused and lands the caret in .ProseMirror once the real attach happens, even though the editor DOM was disconnected when the effect first ran', async () => {
    const { onOpenFocused } = await renderHeldBack()
    await releaseAttach()
    await waitFor(() => {
      expect(document.activeElement?.closest('.ProseMirror')).toBeTruthy()
    })
    expect(onOpenFocused).toHaveBeenCalledTimes(1)
  })

  it('CONTROL: no race at all (attach allowed from the start) still focuses the body exactly once, unchanged (13Q-2)', async () => {
    allowAttach = true
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    const onOpenFocused = vi.fn()
    render(
      <MemoryRouter>
        <NoteEditorPage noteId="n1" onBack={vi.fn()} showBack openFocus="body" onOpenFocused={onOpenFocused} />
      </MemoryRouter>,
    )
    await screen.findByPlaceholderText('Title')
    await waitFor(() => {
      expect(document.activeElement?.closest('.ProseMirror')).toBeTruthy()
    })
    expect(onOpenFocused).toHaveBeenCalledTimes(1)
  })

  it('CONTROL: openFocus="title" is untouched by the retry loop -- the title still gets focus with no attach race in play', async () => {
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    const onOpenFocused = vi.fn()
    render(
      <MemoryRouter>
        <NoteEditorPage noteId="n1" onBack={vi.fn()} showBack openFocus="title" onOpenFocused={onOpenFocused} />
      </MemoryRouter>,
    )
    const titleInput = await screen.findByPlaceholderText('Title')
    await waitFor(() => { expect(document.activeElement).toBe(titleInput) })
    expect(onOpenFocused).toHaveBeenCalledTimes(1)
    // The body effect never got to claim the one-shot ref -- releasing the
    // attach afterwards must not retroactively steal focus from the title.
    await releaseAttach()
    await new Promise((r) => setTimeout(r, 50))
    expect(document.activeElement).toBe(titleInput)
  })

  it('never fires onOpenFocused while the editor DOM stays disconnected -- it waits quietly rather than firing on a detached node', async () => {
    const { onOpenFocused } = await renderHeldBack()
    // Hold the attach back well past the measured real-browser gap
    // (135-807ms) and confirm the retry loop is still correctly waiting --
    // no crash, no premature no-op focus call -- rather than firing against
    // the still-disconnected node the way the old one-shot code did.
    await new Promise((r) => setTimeout(r, 900))
    expect(onOpenFocused).not.toHaveBeenCalled()
    expect(document.querySelector('.ProseMirror')).toBeNull()
  })
})
