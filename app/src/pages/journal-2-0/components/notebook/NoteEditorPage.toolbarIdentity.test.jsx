import { render, waitFor, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Wave 10 lane 10A (clause 4d, typing cost): the editor toolbar's buttons KEEP THEIR DOM NODES
// when the page re-renders.
//
// `ToolButton` was declared inside NoteEditorPage, so every render of the page made it a NEW
// component type and React unmounted and re-mounted all twelve buttons (and the SVG icons in
// them). The page renders on every keystroke, so every keystroke paid for it: in a traced
// Chromium keystroke at 2,000 paragraphs, ~12.6 buttons were torn down and rebuilt per key and
// `removeChild` / `insertBefore` were the largest self-time entries of the CPU profile
// (docs/notebook/perf-budgets.md §7). The rail is asserted on the DOM a member's browser holds:
// the same <button> element before and after a re-render the page really made.

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
afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = '' })

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
  return { editor: pm.editor, pm, root: div }
}

const boldButton = (toolbar) => within(toolbar).getAllByRole('button').find((b) => b.textContent === 'B')

describe('NoteEditorPage — the toolbar is reconciled, never re-mounted (wave 10, lane 10A)', () => {
  it('a button keeps its DOM node across a re-render the page really made', async () => {
    const { editor, root } = await mount()
    const toolbar = within(root).getByRole('toolbar', { name: 'Editor toolbar' })
    const link = within(toolbar).getByRole('button', { name: 'Insert link' })
    const bold = boldButton(toolbar)
    expect(bold).toBeTruthy()
    expect(bold.className).not.toMatch(/toolBtnActive/)

    // Select the text and make it bold: the page re-renders to light the Bold button.
    act(() => { editor.chain().setTextSelection({ from: 1, to: 6 }).toggleBold().run() })
    // Non-vacuity: the re-render happened (the Bold button now reads active) ...
    await waitFor(() => expect(boldButton(toolbar).className).toMatch(/toolBtnActive/))
    // ... and it was a reconcile: the SAME elements, updated in place.
    expect(boldButton(toolbar)).toBe(bold)
    expect(within(toolbar).getByRole('button', { name: 'Insert link' })).toBe(link)
    expect(link.isConnected && bold.isConnected).toBe(true)
  }, 60000)   // the first test pays the page module's transform

  it('typing keeps every toolbar button node', async () => {
    const { editor, root } = await mount()
    const toolbar = within(root).getByRole('toolbar', { name: 'Editor toolbar' })
    const before = within(toolbar).getAllByRole('button')
    expect(before.length).toBeGreaterThanOrEqual(10)
    for (const ch of 'typed') {
      act(() => { editor.view.dispatch(editor.state.tr.insertText(ch, editor.state.doc.content.size - 1)) })
    }
    await waitFor(() => expect(editor.getText()).toContain('typed'))
    const after = within(toolbar).getAllByRole('button')
    for (const b of before.filter((x) => /toolBtn/.test(x.className) && !/historyBtn/.test(x.className))) {
      expect(after).toContain(b)
    }
  }, 60000)
})
