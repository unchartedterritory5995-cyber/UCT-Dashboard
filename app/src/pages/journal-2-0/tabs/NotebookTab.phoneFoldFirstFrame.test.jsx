// Tier 2 (production check of Tier 1b, 390 x 844): the phone Notebook's CLS was 0.30 -- ONE layout shift of 0.3035,
// its source the notes pane (`.main`). Root cause: on a phone the folders panel is a drawer that folds on arrival, but
// it was SEEDED open from the stored choice (`uct.j2.nb.sidebarOpen` = '1', the default) and folded by an effect, so
// the first frame could paint the whole folder tree above the notes and the fold then moved the pane up by its
// height. The seed now applies the same rule (`phoneArrivalFolds`), so no frame ever holds the panel open.
//
// The rail watches the panel's box from its FIRST commit (a MutationObserver records every class it ever had), so
// "folded by a later effect" and "never open" are told apart -- jsdom lays nothing out, but the class that makes the
// phone rule fold the box (`.wrap.collapsed .sidebarSlot { height: 0 }`) is what this reads.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const NOTES = [
  { id: 'n1', title: 'Alpha thesis', updatedAt: '2026-09-27T10:00:00Z' },
  { id: 'n2', title: 'Beta review', updatedAt: '2026-09-26T10:00:00Z' },
]
const mockRefresh = vi.fn()
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: NOTES, isLoading: false, error: null, refresh: mockRefresh, mutate: vi.fn(),
    total: NOTES.length, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
}))
vi.mock('../components/notebook/FolderSidebar', () => ({
  // A folder choice goes through the tab's own `onSelectFolder` -- the same door the real panel uses.
  default: ({ onSelectFolder }) => (
    <div data-testid="folder-sidebar">
      <button type="button" onClick={() => onSelectFolder?.('f-swing')}>Pick Swing ideas</button>
      {/* the real panel's search anchor (FolderSidebar.jsx data-tour="search") */}
      <input aria-label="Search notes" data-tour="search" />
    </div>
  ),
}))
// A card is a button that opens its note through the tab's own `onOpen` (openNote) --
// the same door the real NoteCard uses.
vi.mock('../components/notebook/NoteCard', () => ({
  default: ({ note, onOpen }) => (
    <button type="button" data-note-card-id={note.id} onClick={() => onOpen(note)}>{note.title}</button>
  ),
}))
// The editor stand-in pushes the SAME-NOTE entries the real one does
// (NoteEditorPage.jsx): a review citation (`?note=A&review=R`, a push) and an Ask
// citation into this note's own PDF (`&doc=D&page=N`, a push, then a replace that
// strips doc/page).
vi.mock('../components/notebook/NoteEditorPage', async () => {
  const { useSearchParams } = await import('react-router-dom')
  return {
    default: function EditorStandIn({ noteId }) {
      const [, setSearchParams] = useSearchParams()
      const edit = (fn, replace) => setSearchParams((prev) => { const n = new URLSearchParams(prev); fn(n); return n }, { replace })
      return (
        <div data-testid="note-editor" data-note-id={noteId}>
          <button type="button" onClick={() => edit((n) => n.set('review', 'r1'), false)}>review citation</button>
          <button type="button" onClick={() => edit((n) => { n.set('doc', 'd1'); n.set('page', '3') }, false)}>ask citation</button>
          <button type="button" onClick={() => edit((n) => { n.delete('doc'); n.delete('page') }, true)}>strip doc</button>
        </div>
      )
    },
  }
})
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
// D-7's own tests below switch view mode -- NotesTableView (an icon-row mode) and
// NoteTasksView (reached by its own `?view=tasks` URL too) stand in for the six
// content-first modes so switching doesn't try to lazy-load and render the real
// ones (NoteBoardView.test.jsx etc. already cover their own content).
vi.mock('../components/notebook/NotesTableView', () => ({
  default: () => <div data-testid="notes-table" />,
}))
vi.mock('../components/notebook/NoteTasksView', () => ({
  default: () => <div data-testid="note-tasks" />,
}))

import NotebookTab, { SORT_OPTIONS, phoneArrivalFolds } from './NotebookTab'
import { OPEN_JOURNAL_TOOLS_EVENT, journalToolsDoorMounted } from '../lib/journalToolsDoor'

let realWidth
beforeEach(() => {
  realWidth = window.innerWidth
  localStorage.setItem('uct.j2.nb.sidebarOpen', '1')        // the stored choice: open (also the default)
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})
afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: realWidth, configurable: true })
  localStorage.removeItem('uct.j2.nb.sidebarOpen')
})
const width = (w) => Object.defineProperty(window, 'innerWidth', { value: w, configurable: true })

/** Every class the Notebook's wrap had, from the moment it was inserted. */
function renderWatching(entry) {
  const seen = []
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue
          const w = n.matches?.('[style*="--nb-sb-w"]') ? n : n.querySelector?.('[style*="--nb-sb-w"]')
          if (w) seen.push(w.getAttribute('class'))
        }
      } else if (r.type === 'attributes' && r.target.matches?.('[style*="--nb-sb-w"]')) {
        seen.push(r.oldValue, r.target.getAttribute('class'))
      }
    }
  })
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true })
  const out = render(<MemoryRouter initialEntries={[entry]}><NotebookTab /></MemoryRouter>)
  return { ...out, seen, stop: () => mo.disconnect() }
}

describe('the phone folders panel never paints open on arrival (CLS)', () => {
  it('390 px, the list: every class the wrap ever had is the folded one', async () => {
    width(390)
    const { seen, stop } = renderWatching('/journal/notebook?view=all')
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    stop()
    expect(screen.getByTestId('folder-sidebar')).toBeInTheDocument()
    expect(seen.length, 'the observer saw the wrap').toBeGreaterThan(0)
    for (const cls of seen) expect(cls, 'a frame held the panel OPEN').toMatch(/collapsed/)
  })

  it('CONTROL: at 1200 px the stored choice (open) is honoured from the first frame', async () => {
    width(1200)
    const { seen, stop } = renderWatching('/journal/notebook?view=all')
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    stop()
    expect(seen.length).toBeGreaterThan(0)
    for (const cls of seen) expect(cls).not.toMatch(/collapsed/)
  })

  it('the rule: folds on a phone list or Home, never in a note or on the #search door, never above 640 px', () => {
    width(390)
    expect(phoneArrivalFolds(null, '')).toBe(true)
    expect(phoneArrivalFolds('n1', '')).toBe(false)
    expect(phoneArrivalFolds(null, '#search')).toBe(false)
    width(820)
    expect(phoneArrivalFolds(null, '')).toBe(false)
  })
})

// Tier 2 fix round 1 (review Important 1): the list's ⋯ carries "Journal tools" (a phone row), and the list offers that
// door only while its toolbar is on screen -- an open note does not, so the header's own toggle is never stranded.
describe('"Journal tools" is a row of the list ⋯ menu (Tier 2 fix round 1)', () => {
  it('the list offers the door; its row opens the Journal header tools; an open note withdraws it', async () => {
    width(390)
    const seen = vi.fn()
    window.addEventListener(OPEN_JOURNAL_TOOLS_EVENT, seen)
    const { unmount } = render(<MemoryRouter initialEntries={['/journal/notebook?view=all']}><NotebookTab /></MemoryRouter>)
    expect(journalToolsDoorMounted()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'More notebook actions' }))
    const menu = screen.getByRole('menu', { name: 'More notebook actions' })
    // Simplify pass 2 (A9): "Trade journal tools", so it is not read as a sibling of "My tools".
    expect(within(menu).queryByRole('menuitem', { name: 'Journal tools' })).toBeNull()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Trade journal tools' }))
    expect(seen).toHaveBeenCalledTimes(1)
    unmount()
    expect(journalToolsDoorMounted()).toBe(false)
    render(<MemoryRouter initialEntries={['/journal/notebook?note=n1']}><NotebookTab /></MemoryRouter>)
    expect(journalToolsDoorMounted()).toBe(false)
    window.removeEventListener(OPEN_JOURNAL_TOOLS_EVENT, seen)
  })
})


// Tier 2 fix round 1 (review minor 12): compact sort words on a phone only; wider screens keep the full words.
describe('the sort words', () => {
  it('the full words where the screen is wide', () => {
    width(1200)
    render(<MemoryRouter initialEntries={['/journal/notebook?view=all']}><NotebookTab /></MemoryRouter>)
    const sel = screen.getByRole('combobox', { name: 'Sort notes' })
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Recently updated', 'Recently created', 'Title'])
  })
  it('the table of words', () => {
    expect(SORT_OPTIONS.map((o) => o.short)).toEqual(['Updated', 'Created', 'Title'])
  })
})
