import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TextSelection } from '@tiptap/pm/state'

// Wave 6 (editor lane D) — the new editor content as the member reaches it,
// through the REAL NoteEditorPage (real editor mount; the wave-5 file's
// convention). Each feature's own behaviour is railed in its module's test
// file; this file rails the DOOR: that the page wires it.

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const cell = (t, type = 'tableCell') => ({ type, content: [P(t)] })
const row = (...c) => ({ type: 'tableRow', content: c })

let NOTE
const baseNote = () => ({
  id: 'n1', title: 'Original Title', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false,
  bodyJson: { type: 'doc', content: [
    P('Intro line.'),
    { type: 'table', content: [row(cell('Sym', 'tableHeader'), cell('R', 'tableHeader')), row(cell('NVDA'), cell('2.1'))] },
  ] },
})

vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: vi.fn(), refresh: vi.fn() }),
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

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  const dom = await waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el
  })
  return dom.editor
}
const caretIn = (editor, text) => {
  let at = null
  editor.state.doc.descendants((n, pos) => { if (at == null && n.isText && n.text === text) at = pos + 1 })
  act(() => { editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at))) })
}

describe('NoteEditorPage — table toolbar door (wave 6 item 1)', () => {
  it('the toolbar appears while the caret is in a table and edits THIS note', async () => {
    const editor = await renderEditor()
    caretIn(editor, 'Intro line.')
    expect(screen.queryByRole('toolbar', { name: 'Table' })).toBeNull()
    caretIn(editor, 'NVDA')
    fireEvent.click(await screen.findByRole('button', { name: 'Add a row below' }))
    let rows = 0
    editor.state.doc.descendants((n) => { if (n.type.name === 'tableRow') rows += 1 })
    expect(rows).toBe(3)
  })
})
