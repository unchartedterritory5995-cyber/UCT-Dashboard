// Notebook simplify, Task 5 ("open on your notes"): the panel's "Today" row became "Daily brief". It sits directly
// under All notes (before the folders), opens the Daily brief (`?view=today`, the Notebook hands in the door as
// `onSelectToday`), and draws no weekday counter. A caller that hands in no door draws no row, as before.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import FolderSidebar from './FolderSidebar'

vi.mock('../../hooks/useJ2NoteFolders', () => ({
  default: () => ({
    folders: [{ id: 'f1', name: 'Theses', parentId: null, sortOrder: 0 }],
    create: vi.fn(), rename: vi.fn(), remove: vi.fn(), refresh: vi.fn(),
  }),
}))
vi.mock('../../hooks/useJ2Notes', () => ({
  default: () => ({ notes: [], isLoading: false, isValidating: false, error: null, total: 0 }),
  useJ2NoteFolderCounts: () => ({ counts: { f1: 0 }, unfiled: 0, total: 0, isLoading: false, error: null, refresh: vi.fn() }),
  useJ2NotesByFolders: () => ({ byFolder: {}, isLoading: false, error: null, refresh: vi.fn() }),
  useJ2Favorites: () => ({ notes: [], isLoading: false, error: null, refresh: vi.fn() }),
  useJ2Recents: () => ({ notes: [], isLoading: false, error: null, refresh: vi.fn() }),
  useJ2SectorThemeFacets: () => ({ sectors: [], themes: [], isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../../hooks/useJ2NoteTags', () => ({
  default: () => ({ tagCounts: [], tagTree: [], isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../../hooks/useDocumentSearch', () => ({ default: () => ({ results: [], isLoading: false, error: null }) }))
vi.mock('../../hooks/useExcerptSearch', () => ({ default: () => ({ results: [], isLoading: false, error: null }) }))
vi.mock('../../hooks/useReviewSearch', () => ({ default: () => ({ results: [], isLoading: false, error: null }) }))

function renderSidebar(props = {}) {
  return render(
    <MemoryRouter>
      <FolderSidebar notes={[]} notesTotal={4} activeFolderId={null} onSelectFolder={vi.fn()}
        activeTag={null} onSelectTag={vi.fn()} onRenameTag={vi.fn()} {...props} />
    </MemoryRouter>,
  )
}
const treeRows = () => Array.from(screen.getByRole('tree', { name: 'Folders' }).querySelectorAll('[role="treeitem"]'))
  .map((el) => el.getAttribute('aria-label'))

afterEach(() => { vi.restoreAllMocks() })

describe('the Daily brief row', () => {
  it('is labelled "Daily brief", directly under All notes and before the folders', () => {
    renderSidebar({ onSelectToday: vi.fn() })
    expect(treeRows().slice(0, 3)).toEqual(['All notes, 4', 'Daily brief', expect.stringMatching(/^Theses/)])
    expect(screen.queryByRole('button', { name: /^Today\b/ })).toBeNull()
  })

  it('opens the Daily brief (the door the Notebook hands in) and shows no weekday counter', () => {
    const onSelectToday = vi.fn()
    renderSidebar({ onSelectToday })
    const row = screen.getByRole('button', { name: 'Daily brief' })
    expect(row.textContent).toBe('Daily brief')
    fireEvent.click(row)
    expect(onSelectToday).toHaveBeenCalledTimes(1)
  })

  it('is lit while the Daily brief is on screen, and All notes is not', () => {
    renderSidebar({ onSelectToday: vi.fn(), isToday: true, isHome: true })
    expect(screen.getByRole('button', { name: 'Daily brief' }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('button', { name: /^All notes/ }).getAttribute('aria-current')).toBeNull()
  })

  it('CONTROL: without the door there is no row', () => {
    renderSidebar()
    expect(screen.queryByRole('button', { name: 'Daily brief' })).toBeNull()
    expect(treeRows()[0]).toBe('All notes, 4')
  })
})
