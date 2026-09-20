import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * The calendar view's WIRING into the Notebook tab. Its own date parsing and
 * month layout are tested in NoteCalendarView.test.jsx against the real
 * component.
 *
 * ⚠️ THERE ARE THREE NEAR-IDENTICAL WIRING FILES (graphView / boardView /
 * calendarView) AND THAT IS DELIBERATE, not a copy nobody noticed. `vi.mock`
 * is file-scoped, so each view must stub a different child to observe the
 * props IT is handed; one combined file cannot mock three children
 * independently. What each file uniquely pins:
 *   graph    — must NOT receive `notes` (it reads the whole notebook)
 *   board    — MUST receive `notes`, plus `onChanged` (it writes)
 *   calendar — MUST receive `notes` AND the write props (it reschedules)
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
vi.mock('../components/notebook/NoteBoardView', () => ({ default: () => <div data-testid="note-board" /> }))
let calProps = null
vi.mock('../components/notebook/NoteCalendarView', () => ({
  default: (props) => {
    calProps = props
    return (
      <div data-testid="note-calendar">
        <button type="button" onClick={() => props.onOpenNote({ id: 'n2' })}>open n2</button>
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
  calProps = null
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

const calBtn = () => screen.getByRole('button', { name: /calendar view/i })

describe('NotebookTab — calendar view wiring', () => {
  it('offers a calendar view among the five', () => {
    renderTab()
    for (const name of [/list view/i, /table view/i, /board view/i, /calendar view/i, /graph view/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('switching to calendar mounts it and takes down the card grid', () => {
    renderTab()
    fireEvent.click(calBtn())
    expect(screen.getByTestId('note-calendar')).toBeInTheDocument()
    expect(screen.queryByTestId('note-card')).toBeNull()
  })

  it('is handed the current slice, its property defs, AND the write props', () => {
    renderTab()
    fireEvent.click(calBtn())
    expect(calProps.notes.map((n) => n.id)).toEqual(['n1', 'n2'])
    expect(calProps.propertyDefs).toBeDefined()
    // ⚰️ This test asserted the OPPOSITE for one commit, when the calendar was
    // read-only: `onChanged`/`blockedNoteIds` had to be ABSENT so the view could
    // not advertise a write path with no settleNoteWrite behind it. Dragging a
    // note to another day is that write path now, it goes through
    // useOptimisticNoteProperty, and the props are required -- without
    // `blockedNoteIds` the view cannot refuse a note whose words have not
    // reached the server, and without `onChanged` the list never re-fetches.
    expect(typeof calProps.onChanged).toBe('function')
    expect(calProps.blockedNoteIds).toBeDefined()
  })

  it('clicking a day chip opens that note', () => {
    renderTab()
    fireEvent.click(calBtn())
    fireEvent.click(screen.getByRole('button', { name: 'open n2' }))
    expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'n2')
  })

  it('TRASH never renders the calendar', () => {
    renderTab()
    fireEvent.click(calBtn())
    fireEvent.click(screen.getByRole('button', { name: 'go to trash' }))
    expect(screen.queryByTestId('note-calendar')).toBeNull()
    expect(screen.getAllByTestId('note-card').length).toBeGreaterThan(0)
  })

  it('hides "Save view" in calendar mode', () => {
    renderTab()
    fireEvent.click(calBtn())
    expect(screen.queryByRole('button', { name: /save view/i })).toBeNull()
  })
})
