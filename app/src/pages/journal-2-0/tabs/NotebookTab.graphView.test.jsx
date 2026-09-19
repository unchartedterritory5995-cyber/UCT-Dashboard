import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * The graph view's WIRING into the Notebook tab. The graph's own drawing,
 * hit-testing and layout are tested in NoteGraphView.test.jsx against the real
 * component -- one evidence tier per product, so this file stubs it and asks
 * only the questions the tab owns: is it reachable, is it kept out of Trash, and
 * is it handed the right data.
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
let graphProps = null
vi.mock('../components/notebook/NoteGraphView', () => ({
  default: (props) => {
    graphProps = props
    return (
      <div data-testid="note-graph">
        <button type="button" onClick={() => props.onOpenNote('n2')}>open n2</button>
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
  graphProps = null
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

const graphBtn = () => screen.getByRole('button', { name: /graph view/i })

describe('NotebookTab — graph view wiring', () => {
  it('offers a graph view beside list and table', () => {
    renderTab()
    expect(screen.getByRole('button', { name: /list view/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /table view/i })).toBeInTheDocument()
    expect(graphBtn()).toBeInTheDocument()
  })

  it('switching to graph mounts the graph and takes down the card grid', () => {
    renderTab()
    expect(screen.getAllByTestId('note-card').length).toBe(2)
    expect(screen.queryByTestId('note-graph')).toBeNull()

    fireEvent.click(graphBtn())

    expect(screen.getByTestId('note-graph')).toBeInTheDocument()
    expect(screen.queryByTestId('note-card')).toBeNull()
  })

  it('does NOT hand the graph this page filtered note slice', () => {
    renderTab()
    fireEvent.click(graphBtn())
    // ⛔ The graph reads the whole notebook from its own endpoint. Passing the
    // folder/tag/property-filtered page would draw edges to notes that are not
    // in the slice and silently drop the rest.
    expect(graphProps).toBeTruthy()
    expect(graphProps.notes).toBeUndefined()
    expect(typeof graphProps.onOpenNote).toBe('function')
  })

  it('clicking a node in the graph opens that note', () => {
    renderTab()
    fireEvent.click(graphBtn())
    fireEvent.click(screen.getByRole('button', { name: 'open n2' }))
    expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'n2')
  })

  it('TRASH never renders the graph, even when graph mode is selected', () => {
    renderTab()
    fireEvent.click(graphBtn())
    expect(screen.getByTestId('note-graph')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'go to trash' }))

    // ⛔ THE LOAD-BEARING ONE. /notes/graph filters `deleted_at IS NULL` on BOTH
    // ends of every edge, so a graph drawn under a Trash header would be a
    // picture of the member's LIVE notebook captioned as their deleted notes.
    expect(screen.queryByTestId('note-graph')).toBeNull()
    expect(screen.getAllByTestId('note-card').length).toBeGreaterThan(0)
  })

  it('returning from trash restores the graph the member had chosen', () => {
    renderTab()
    fireEvent.click(graphBtn())
    fireEvent.click(screen.getByRole('button', { name: 'go to trash' }))
    fireEvent.click(screen.getByRole('button', { name: 'go to all notes' }))
    expect(screen.getByTestId('note-graph')).toBeInTheDocument()
  })

  it('hides "Save this view" in graph mode, because the server would refuse it', () => {
    renderTab()
    // ⛔ create_saved_view rejects any view_type outside ("list", "table"), so
    // offering the control in graph mode offers a button that 400s.
    expect(screen.getByRole('button', { name: /save view/i })).toBeInTheDocument()
    fireEvent.click(graphBtn())
    expect(screen.queryByRole('button', { name: /save view/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /list view/i }))
    expect(screen.getByRole('button', { name: /save view/i })).toBeInTheDocument()
  })
})
