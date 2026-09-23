import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Wave 5 — the editor-completeness features as the member reaches them, through
// the REAL NoteEditorPage (real editor mount; same convention as
// NoteEditorPage.waveB.test.jsx). Each feature's own behaviour is railed in its
// module's test file; this file rails the DOOR: that the page wires it.

const NOTE = {
  id: 'n1', title: 'Original Title', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false,
  bodyJson: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Thesis' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Margins widened sharply this quarter.' }] },
    { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Risks' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'China exposure and margins.' }] },
  ] },
}

vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

beforeEach(() => {
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
const selectWord = (editor, word) => {
  let from = null
  editor.state.doc.descendants((n, pos) => { if (from == null && n.isText && n.text.includes(word)) from = pos + n.text.indexOf(word) })
  editor.commands.setTextSelection({ from, to: from + word.length })
}

describe('NoteEditorPage — text colour + highlight door (Wave 5)', () => {
  it('the toolbar button opens the picker; a pick colours the selection and closes it', async () => {
    const editor = await renderEditor()
    selectWord(editor, 'widened')
    const toggle = screen.getByRole('button', { name: 'Text colour and highlight' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Red text' }))
    expect(document.querySelector('.ProseMirror span.uct-tc-red')?.textContent).toBe('widened')
    expect(screen.queryByRole('group', { name: 'Text colour and highlight' })).toBe(null)
  })
})

describe('NoteEditorPage — word count door (Wave 5)', () => {
  it('the toolbar reads the note\'s words and reading time', async () => {
    await renderEditor()
    expect(screen.getByTestId('note-stats').textContent).toBe('11 words · 1 min read')
  })
})

describe('NoteEditorPage — find AND replace door (Wave 5)', () => {
  it('Ctrl+H opens the find bar with the replace row; a replace-all edits the note', async () => {
    const editor = await renderEditor()
    fireEvent.keyDown(editor.view.dom, { key: 'h', code: 'KeyH', ctrlKey: true })
    const field = await screen.findByRole('textbox', { name: 'Replace with' })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in note' }), { target: { value: 'margins' } })
    fireEvent.change(field, { target: { value: 'spreads' } })
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }))
    expect(editor.state.doc.textContent).not.toMatch(/margins/i)
    expect(screen.getByText('Replaced 2 matches')).toBeInTheDocument()
  })

  it('Ctrl+F still opens find alone', async () => {
    const editor = await renderEditor()
    fireEvent.keyDown(editor.view.dom, { key: 'f', code: 'KeyF', ctrlKey: true })
    await screen.findByRole('searchbox', { name: 'Find in note' })
    expect(screen.queryByRole('textbox', { name: 'Replace with' })).toBeNull()
  })
})
