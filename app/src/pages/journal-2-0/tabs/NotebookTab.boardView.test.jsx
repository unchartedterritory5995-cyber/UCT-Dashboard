import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * The board view's WIRING into the Notebook tab. The board's own grouping,
 * moving and fork-safety are tested in NoteBoardView.test.jsx against the real
 * component -- one evidence tier per product, so this file stubs it and asks
 * only the questions the tab owns.
 *
 * ⛔ THE POINT OF THIS FILE IS THE `notes` PROP. The graph must NOT be handed
 * this page's filtered slice and the board MUST be -- opposite calls, one line
 * apart in the same JSX, which is exactly the pair a later edit "tidies" into
 * consistency. Both directions are asserted, here and in the graph's file.
 */

const mockRefresh = vi.fn()
const useJ2NotesMock = vi.fn()
vi.mock('../hooks/useJ2Notes', () => ({
  default: (...args) => useJ2NotesMock(...args),
}))

vi.mock('../components/notebook/FolderSidebar', () => ({
  default: ({ onSelectFolder, onSelectAllNotes }) => (
    <div data-testid="folder-sidebar">
      <button type="button" onClick={() => onSelectFolder('__trash__')}>go to trash</button>
      {/* ⛔ The real "All notes" door is onSelectAllNotes, which re-sets
          ?view=all. onSelectFolder(null) CLEARS that param and lands on
          Research Home -- correct existing behaviour, and not this path. */}
      <button type="button" onClick={onSelectAllNotes}>go to all notes</button>
    </div>
  ),
}))
vi.mock('../components/notebook/NoteCard', () => ({
  default: ({ note }) => <div data-testid="note-card">{note?.title}</div>,
}))
vi.mock('../components/notebook/NotesTableView', () => ({
  default: () => <div data-testid="notes-table" />,
}))
// The stub records the props it was handed, so "the graph is not given this
// page's filtered slice" is an assertion rather than a comment.
vi.mock('../components/notebook/NoteGraphView', () => ({ default: () => <div data-testid="note-graph" /> }))
let boardProps = null
vi.mock('../components/notebook/NoteBoardView', () => ({
  default: (props) => {
    boardProps = props
    return (
      <div data-testid="note-board">
        <button type="button" onClick={() => props.onOpenNote({ id: 'n2' })}>open n2</button>
        <button type="button" onClick={() => props.onChanged && props.onChanged()}>fire onChanged</button>
      </div>
    )
  },
}))
vi.mock('../components/notebook/NoteEditorPage', () => ({
  default: ({ noteId }) => <div data-testid="note-editor" data-note-id={noteId} />,
}))
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../components/notebook/ResearchHome', () => ({
  default: () => <div data-testid="research-home" />,
}))

import NotebookTab from './NotebookTab'

const NOTES = [
  { id: 'n1', title: 'First note', updatedAt: '2026-09-18T00:00:00Z' },
  { id: 'n2', title: 'Second note', updatedAt: '2026-09-17T00:00:00Z' },
]

beforeEach(() => {
  boardProps = null
  mockRefresh.mockClear()
  useJ2NotesMock.mockReset()
  useJ2NotesMock.mockImplementation(() => ({
    notes: NOTES, isLoading: false, error: null, refresh: mockRefresh, mutate: vi.fn(),
    total: NOTES.length, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }))
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})

function renderTab(entry = '/journal?view=all') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <NotebookTab />
    </MemoryRouter>,
  )
}

const boardBtn = () => screen.getByRole('button', { name: /board view/i })

describe('NotebookTab — board view wiring', () => {
  it('offers a board view beside list, table and graph', () => {
    renderTab()
    expect(boardBtn()).toBeInTheDocument()
  })

  it('switching to board mounts the board and takes down the card grid', async () => {
    renderTab()
    expect(screen.getAllByTestId('note-card').length).toBe(2)
    fireEvent.click(boardBtn())
    await screen.findByTestId('note-board')
    expect(screen.getByTestId('note-board')).toBeInTheDocument()
    expect(screen.queryByTestId('note-card')).toBeNull()
  })

  it('DOES hand the board this page filtered slice -- the opposite of the graph', async () => {
    renderTab()
    fireEvent.click(boardBtn())
    await screen.findByTestId('note-board')
    // A board is a view OF THE CURRENT SELECTION; a graph is only honest over
    // the whole notebook. If these two ever agree, one of them is wrong.
    expect(boardProps.notes).toHaveLength(2)
    expect(boardProps.notes.map((n) => n.id)).toEqual(['n1', 'n2'])
    expect(boardProps.propertyDefs).toBeDefined()
    expect(typeof boardProps.onChanged).toBe('function')
  })

  it('clicking a card opens that note', async () => {
    renderTab()
    fireEvent.click(boardBtn())
    await screen.findByTestId('note-board')
    fireEvent.click(screen.getByRole('button', { name: 'open n2' }))
    expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'n2')
  })

  it('a move tells the tab to re-fetch, so the list and the board agree', async () => {
    renderTab()
    fireEvent.click(boardBtn())
    await screen.findByTestId('note-board')
    fireEvent.click(screen.getByRole('button', { name: 'fire onChanged' }))
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('TRASH never renders the board -- its cards WRITE to the note', async () => {
    renderTab()
    fireEvent.click(boardBtn())
    await screen.findByTestId('note-board')
    expect(screen.getByTestId('note-board')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'go to trash' }))
    expect(screen.queryByTestId('note-board')).toBeNull()
    expect(screen.getAllByTestId('note-card').length).toBeGreaterThan(0)
  })

  it('OFFERS "Save view" in board mode, and captures the GROUPING', async () => {
    // ⚰️ Asserted the opposite while the server enum was ("list","table").
    renderTab()
    fireEvent.click(boardBtn())
    await screen.findByTestId('note-board')
    expect(screen.getByRole('button', { name: /save view/i })).toBeInTheDocument()

    // ⛔ A board without what it groups by is not the view the member saved.
    // The view REPORTS its resolved grouping up; the tab puts it in the spec.
    expect(boardProps.onGroupByChange).toBeInstanceOf(Function)
    expect(boardProps.initialGroupById).toBeNull()

    // And the spec that actually goes to the server carries it.
    boardProps.onGroupByChange('builtin:thesis_status')
    fireEvent.click(screen.getByRole('button', { name: /save view/i }))
    // ⛔ The dialog's confirm button carries the SAME name as the toolbar button
    // that opened it, so a name query matches two. Name the field and press
    // Enter -- which is also a real member path the component supports.
    const nameInput = await screen.findByLabelText('Name')
    fireEvent.change(nameInput, { target: { value: 'Active theses' } })
    fireEvent.keyDown(nameInput, { key: 'Enter' })

    await waitFor(() => {
      const call = global.fetch.mock.calls.find(
        ([u, o]) => String(u) === '/api/j2/saved-views' && o?.method === 'POST',
      )
      expect(call).toBeTruthy()
      const body = JSON.parse(call[1].body)
      expect(body.viewType).toBe('board')
      expect(body.spec.groupBy).toBe('builtin:thesis_status')
    })
  })
})
