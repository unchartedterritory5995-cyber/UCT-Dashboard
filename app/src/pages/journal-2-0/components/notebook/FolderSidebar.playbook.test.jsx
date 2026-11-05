// S13 (audit 2026-11-05, detail #67): My Playbook from the Notebook's own sidebar. It opens INSIDE the Journal shell
// (`/journal/notebook/playbook`: the Journal tabs stay, "Back to Notebook"), its data the same read as Insights'.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import FolderSidebar from './FolderSidebar'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { PLAYBOOK_IN_NOTEBOOK_PATH } from '../../lib/myPlaybookLink'

vi.mock('../../hooks/useJ2NoteFolders', () => ({
  default: () => ({ folders: [], create: vi.fn(), rename: vi.fn(), remove: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('../../hooks/useJ2Notes', () => ({
  default: () => ({ notes: [], isLoading: false, isValidating: false, error: null }),
  useJ2NoteFolderCounts: () => ({ counts: {}, unfiled: 0, total: 0, isLoading: false, error: null, refresh: vi.fn() }),
  useJ2NotesByFolders: () => ({ byFolder: {}, isLoading: false, error: null, refresh: vi.fn() }),
  useJ2Favorites: () => ({ notes: [], isLoading: false, error: null, refresh: vi.fn() }),
  useJ2Recents: () => ({ notes: [], isLoading: false, error: null, refresh: vi.fn() }),
  useJ2SectorThemeFacets: () => ({ sectors: [], themes: [], isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../../hooks/useJ2NoteTags', () => ({ default: () => ({ tagCounts: [], tagTree: [], isLoading: false, error: null }) }))
vi.mock('../../hooks/useDocumentSearch', () => ({ default: () => ({ results: [], isLoading: false, error: null }) }))
vi.mock('../../hooks/useExcerptSearch', () => ({ default: () => ({ results: [], isLoading: false, error: null }) }))
vi.mock('../../hooks/useReviewSearch', () => ({ default: () => ({ results: [], isLoading: false, error: null }) }))

afterEach(() => __resetNotebookFlags())

const renderSidebar = () => render(
  <MemoryRouter initialEntries={['/journal/notebook']}>
    <Routes>
      <Route path="/journal/notebook" element={
        <FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={vi.fn()} activeTag={null} onSelectTag={vi.fn()} />} />
      <Route path={PLAYBOOK_IN_NOTEBOOK_PATH} element={<p>the playbook page</p>} />
    </Routes>
  </MemoryRouter>,
)

describe('My Playbook in the Notebook sidebar (S13)', () => {
  it('with its gate on: a "My Playbook" link to the page inside the Journal shell, and it goes there', async () => {
    latchNotebookFlags({ notebook_playbook_enabled: true })
    renderSidebar()
    const link = screen.getByRole('link', { name: 'My Playbook' })
    expect(link).toHaveAttribute('href', '/journal/notebook/playbook')
    link.click()
    expect(await screen.findByText('the playbook page')).toBeInTheDocument()
  })

  it('with its gate off: no link (a door that is not there gets no entry)', () => {
    latchNotebookFlags({ notebook_playbook_enabled: false })
    renderSidebar()
    expect(screen.queryByRole('link', { name: 'My Playbook' })).toBeNull()
  })

  it('the route sits INSIDE the Journal shell (a child of /journal in App.jsx), beside the setups board', () => {
    const app = readFileSync(join(process.cwd(), 'src', 'App.jsx'), 'utf8')
    const shell = app.slice(app.indexOf('<Route path="/journal" element={<JournalShellSelector />}>'))
    const block = shell.slice(0, shell.indexOf('</Route>'))
    expect(block).toMatch(/<Route path="notebook\/playbook" element=\{<J2MyPlaybook \/>\} \/>/)
    expect(`/journal/notebook/playbook`).toBe(PLAYBOOK_IN_NOTEBOOK_PATH)
  })
})
