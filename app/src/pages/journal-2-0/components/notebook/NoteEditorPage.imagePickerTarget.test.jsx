import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Wave 6 lane E fix round 1, I5 — SlashMenu's "Image" item dispatched one
// untargeted `window` event and EVERY mounted editor answered it, so with
// two panes open (split view) an image picked from the side pane's Image
// item landed in the MAIN note. This rails the fix with TWO REAL mounted
// editors, firing from the second and asserting only the second's own file
// picker opens.

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })

const NOTES = {
  n1: { id: 'n1', title: 'Main note', subtitle: '', folderId: null, ticker: null,
    tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z', isFavorite: false,
    bodyJson: { type: 'doc', content: [P('Main body.')] } },
  n2: { id: 'n2', title: 'Side note', subtitle: '', folderId: null, ticker: null,
    tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z', isFavorite: false,
    bodyJson: { type: 'doc', content: [P('Side body.')] } },
}

vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: (noteId) => ({ note: NOTES[noteId], isLoading: false, update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})
afterEach(() => vi.clearAllMocks())

async function mountEditorInPane(pane, noteId) {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const div = document.createElement('div')
  div.setAttribute('data-pane', pane)
  document.body.appendChild(div)
  render(
    <MemoryRouter><NoteEditorPage noteId={noteId} onBack={vi.fn()} showBack /></MemoryRouter>,
    { container: div },
  )
  const editorEl = await waitFor(() => {
    const el = div.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el
  })
  return editorEl.editor
}

describe('NoteEditorPage — the Image slash item targets its OWN editor (wave 6 fix round 1, I5)', () => {
  it('firing Image from the side pane opens only the side pane\'s file picker', async () => {
    const mainEditor = await mountEditorInPane('main', 'n1')
    const sideEditor = await mountEditorInPane('side', 'n2')

    const mainInput = document.querySelector('[data-pane="main"] input[aria-label="Upload image"]')
    const sideInput = document.querySelector('[data-pane="side"] input[aria-label="Upload image"]')
    expect(mainInput).toBeTruthy()
    expect(sideInput).toBeTruthy()
    const mainClick = vi.spyOn(mainInput, 'click')
    const sideClick = vi.spyOn(sideInput, 'click')

    const { ITEMS } = await import('./SlashMenu')
    const imageItem = ITEMS.find((i) => i.title === 'Image')
    const from = sideEditor.state.selection.from
    act(() => { imageItem.command({ editor: sideEditor, range: { from, to: from } }) })

    expect(sideClick).toHaveBeenCalledTimes(1)
    expect(mainClick).not.toHaveBeenCalled()
  })

  it('CONTROL: firing Image from the main pane opens only the main pane\'s file picker', async () => {
    const mainEditor = await mountEditorInPane('main', 'n1')
    await mountEditorInPane('side', 'n2')

    const mainInput = document.querySelector('[data-pane="main"] input[aria-label="Upload image"]')
    const sideInput = document.querySelector('[data-pane="side"] input[aria-label="Upload image"]')
    const mainClick = vi.spyOn(mainInput, 'click')
    const sideClick = vi.spyOn(sideInput, 'click')

    const { ITEMS } = await import('./SlashMenu')
    const imageItem = ITEMS.find((i) => i.title === 'Image')
    const from = mainEditor.state.selection.from
    act(() => { imageItem.command({ editor: mainEditor, range: { from, to: from } }) })

    expect(mainClick).toHaveBeenCalledTimes(1)
    expect(sideClick).not.toHaveBeenCalled()
  })
})
