// Follow-up A: a press on a left-panel row sends exactly ONE `panel_row_used` with its row id, never a folder's name.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import FolderSidebar from './FolderSidebar'

vi.mock('../../hooks/useJ2NoteFolders', () => ({
  default: () => ({
    folders: [{ id: 'f1', name: 'NVDA theses', parentId: null, sortOrder: 0 }],
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

let spy
function renderSidebar() {
  spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) })
  return render(
    <MemoryRouter>
      <FolderSidebar notes={[]} notesTotal={4} activeFolderId={null} onSelectFolder={vi.fn()}
        activeTag={null} onSelectTag={vi.fn()} onRenameTag={vi.fn()} onSelectToday={vi.fn()} />
    </MemoryRouter>,
  )
}
const sent = () => spy.mock.calls.filter(([u]) => u === '/api/j2/telemetry').map(([, i]) => JSON.parse(i.body))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('panel_row_used', () => {
  it('All notes sends one {row: all_notes}', () => {
    renderSidebar()
    fireEvent.click(document.querySelector('[data-all-notes-row]'))
    expect(sent()).toEqual([{ event: 'panel_row_used', props: { row: 'all_notes' } }])
  })

  it("a folder sends one {row: folder} and never the folder's name", () => {
    renderSidebar()
    fireEvent.click(document.querySelector('[data-folder-row="f1"]'))
    expect(sent()).toEqual([{ event: 'panel_row_used', props: { row: 'folder' } }])
    expect(JSON.stringify(sent())).not.toContain('NVDA')
  })

  it('the Daily brief and the Search tab each send their own id', () => {
    renderSidebar()
    fireEvent.click(document.querySelector('[data-today-row]'))
    fireEvent.click(screen.getByRole('tab', { name: 'Search notes' }))
    expect(sent()).toEqual([
      { event: 'panel_row_used', props: { row: 'daily_brief' } },
      { event: 'panel_row_used', props: { row: 'search_tab' } },
    ])
  })

  it('CONTROL: a press on the panel that is not a row (hide the panel) sends nothing', () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Hide folders panel' }))
    expect(sent()).toEqual([])
  })
})
