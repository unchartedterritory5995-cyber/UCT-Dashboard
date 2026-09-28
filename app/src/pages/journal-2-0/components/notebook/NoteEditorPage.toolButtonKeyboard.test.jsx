import { render, waitFor, act, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// G-160 (wave 10 follow-up F4, amendment; found by lane 10E-1's path census): the editor
// toolbar's ToolButton ran its action on `mousedown` only, so Enter and Space -- which fire
// `click`, never `mousedown` -- did nothing. "Attach a file", "Insert link", "Insert image",
// Bold and the rest were dead to a keyboard member (WCAG 2.1.1).
//
// Asserted on the REAL page with the keyboard (user-event Enter / Space on the focused
// button), plus the property the mousedown path exists for: a pointer press runs the action
// ONCE (Bold toggled twice would read as not bold), and still keeps the editor's selection.

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const NOTES = {
  n1: { id: 'n1', title: 'Main note', subtitle: '', folderId: null, ticker: null,
    tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z', isFavorite: false,
    bodyJson: { type: 'doc', content: [P('Start of the note.')] } },
}

vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: (noteId) => ({ note: NOTES[noteId], isLoading: false, update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isPaid: false }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

async function mount() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const div = document.createElement('div')
  document.body.appendChild(div)
  render(
    <MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>,
    { container: div },
  )
  const pm = await waitFor(() => {
    const el = div.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el
  })
  const toolbar = within(div).getByRole('toolbar', { name: 'Editor toolbar' })
  return { editor: pm.editor, toolbar }
}

const boldButton = (toolbar) => within(toolbar).getAllByRole('button').find((b) => b.textContent === 'B')
const selectStart = (editor) => act(() => { editor.commands.setTextSelection({ from: 1, to: 6 }) })
const isBold = (editor) => editor.isActive('bold')
// A mark command ends in TipTap's `focus()`, which hands focus to the note on the NEXT frame
// (that is the product: after Bold, keep typing). Wait for it before pressing the button
// again, or the key lands in the note instead of on the button.
const settledInNote = (editor) => waitFor(() => expect(document.activeElement).toBe(editor.view.dom))

describe('ToolButton — a keyboard member can use the editor toolbar (G-160)', () => {
  it('Enter and Space on Bold run it', async () => {
    const user = userEvent.setup()
    const { editor, toolbar } = await mount()
    selectStart(editor)
    const bold = boldButton(toolbar)
    bold.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(isBold(editor)).toBe(true))
    await settledInNote(editor)
    bold.focus()
    await user.keyboard(' ')
    await waitFor(() => expect(isBold(editor)).toBe(false))
  }, 60000)   // the first test pays the page module's transform

  it('Enter on "Attach a file" and "Insert image" opens the file picker; Enter on "Insert link" asks for the URL', async () => {
    const user = userEvent.setup()
    const { toolbar } = await mount()
    const picks = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function () {})
    within(toolbar).getByRole('button', { name: 'Attach a file' }).focus()
    await user.keyboard('{Enter}')
    expect(picks).toHaveBeenCalledTimes(1)
    expect(picks.mock.contexts[0].type).toBe('file')
    within(toolbar).getByRole('button', { name: 'Insert image' }).focus()
    await user.keyboard(' ')
    expect(picks).toHaveBeenCalledTimes(2)
    const ask = vi.spyOn(window, 'prompt').mockReturnValue(null)
    within(toolbar).getByRole('button', { name: 'Insert link' }).focus()
    await user.keyboard('{Enter}')
    expect(ask).toHaveBeenCalledTimes(1)
  }, 60000)

  it('a pointer press still runs the action exactly ONCE, and keeps the selection', async () => {
    const user = userEvent.setup()
    const { editor, toolbar } = await mount()
    selectStart(editor)
    await user.click(boldButton(toolbar))   // mousedown ... click
    await waitFor(() => expect(isBold(editor)).toBe(true))   // twice would toggle it back off
    expect(editor.state.selection.from).toBe(1)
    expect(editor.state.selection.to).toBe(6)
    // and a keyboard activation right after a pointer press is not swallowed
    await settledInNote(editor)
    const bold = boldButton(toolbar)
    bold.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(isBold(editor)).toBe(false))
  }, 60000)

  it('a press that never became a click (dragged off) does not swallow the next keyboard activation', async () => {
    const user = userEvent.setup()
    const { editor, toolbar } = await mount()
    selectStart(editor)
    const bold = boldButton(toolbar)
    // pointer down on Bold, released somewhere else: the action ran once, and no click follows
    fireEvent.mouseDown(bold)
    await waitFor(() => expect(isBold(editor)).toBe(true))
    await settledInNote(editor)
    bold.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(isBold(editor)).toBe(false))
  }, 60000)
})
