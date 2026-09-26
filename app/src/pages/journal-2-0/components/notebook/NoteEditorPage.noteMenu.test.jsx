import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import NoteMenuActions from './NoteMenuActions'

// Wave 6 lane E fix round 1, I1 — `NotebookTab.jsx` has passed `noteMenu` to
// `NoteEditorPage` since wave 6 landed, but the editor (lane D's file) never
// read it: Lock, Archive, Save as template and Open beside were all dead.
// This rails the DOOR through a REAL NoteEditorPage render (NoteMenuActions
// itself is unit-tested on its own, in NoteMenuActions.test.jsx).

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })

let NOTE
const baseNote = () => ({
  id: 'n1', title: 'Original Title', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false, locked: false,
  bodyJson: { type: 'doc', content: [P('Intro line.')] },
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
})
afterEach(() => vi.clearAllMocks())

function fetchRouter(overrides) {
  return vi.fn((url, opts) => {
    for (const [match, respond] of overrides) {
      if (typeof match === 'string' ? url === match : match(url, opts)) return respond(url, opts)
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
}

async function renderEditor(noteMenu) {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack noteMenu={noteMenu} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  await waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el
  })
}

describe('NoteEditorPage — the note menu door (wave 6 fix round 1, I1)', () => {
  it('renders the four organise-this-note actions in the header, wired to the REAL note', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    const onOpenBeside = vi.fn()
    await renderEditor((note, api) => (
      <NoteMenuActions note={note} onChanged={api.refresh} onOpenBeside={onOpenBeside} />
    ))
    expect(screen.getByRole('button', { name: 'Lock' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save as template' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open a note beside…' })).toBeTruthy()
  })

  it('Lock PATCHes /api/j2/notes/n1/lock and the settled note reaches the onChanged callback', async () => {
    global.fetch = fetchRouter([
      ['/api/j2/notes/n1/lock', (u, o) => {
        expect(o.method).toBe('PATCH')
        expect(JSON.parse(o.body)).toEqual({ locked: true })
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: { id: 'n1', locked: true, updatedAt: '2026-01-02T00:00:00Z' } }) })
      }],
    ])
    const onChanged = vi.fn()
    await renderEditor((note) => <NoteMenuActions note={note} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ id: 'n1', locked: true, updatedAt: '2026-01-02T00:00:00Z' }))
    expect(await screen.findByText('Locked. Editing is off until you unlock it.')).toBeTruthy()
  })

  it('Save as template POSTs /api/j2/note-templates and reports the template row it produced', async () => {
    global.fetch = fetchRouter([
      ['/api/j2/note-templates', (u, o) => {
        expect(o.method).toBe('POST')
        expect(JSON.parse(o.body)).toEqual({ noteId: 'n1', name: 'My template' })
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ template: { id: 't1', name: 'My template' } }) })
      }],
    ])
    await renderEditor((note) => <NoteMenuActions note={note} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }))
    const input = screen.getByLabelText('Template name')
    fireEvent.change(input, { target: { value: 'My template' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    expect(await screen.findByText(/Saved “My template” as a template/)).toBeTruthy()
  })

  it('Open a note beside… reveals the search picker, and picking a note calls onOpenBeside', async () => {
    global.fetch = fetchRouter([
      [(u) => String(u).startsWith('/api/j2/notes/switcher'), () => Promise.resolve({
        ok: true, json: () => Promise.resolve({ notes: [{ id: 'n2', title: 'Weekly review' }] }),
      })],
    ])
    const onOpenBeside = vi.fn()
    await renderEditor((note) => <NoteMenuActions note={note} onChanged={vi.fn()} onOpenBeside={onOpenBeside} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open a note beside…' }))
    const search = screen.getByLabelText('Find a note to open beside')
    fireEvent.change(search, { target: { value: 'weekly' } })
    const result = await screen.findByRole('button', { name: 'Weekly review' })
    fireEvent.click(result)
    expect(onOpenBeside).toHaveBeenCalledWith({ id: 'n2', title: 'Weekly review' })
  })
})
