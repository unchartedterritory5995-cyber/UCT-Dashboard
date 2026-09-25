import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FolderSidebar from './FolderSidebar'

/**
 * Wave 6 lane E fix round 1, I4 — item 8's rename was server-only (the
 * batch `renameTag` op + `GET /notes/tag-members?tag=` existed with no
 * client caller). This builds the door: the tag tree's own "Rename"
 * affordance, previewing who a rename touches before it runs.
 *
 * Same hook-mock harness as FolderSidebar.tags.test.jsx. Scoped to the
 * NESTED tree render path (`TagNode`) — the flat-library and
 * filtered-search tag rows do not carry this affordance yet (see the
 * fix-round report's Concerns section).
 */

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
vi.mock('../../hooks/useJ2NoteTags', () => ({
  default: () => ({
    tagCounts: [{ tag: 'research/semis', count: 2 }, { tag: 'research', count: 1 }],
    tagTree: [
      { path: 'research', key: 'research', own: 1, total: 3 },
      { path: 'research/semis', key: 'research/semis', own: 2, total: 3 },
    ],
    isLoading: false,
    error: null,
  }),
}))
vi.mock('../../hooks/useDocumentSearch', () => ({ default: () => ({ results: [], isLoading: false, error: null }) }))
vi.mock('../../hooks/useExcerptSearch', () => ({ default: () => ({ results: [], isLoading: false, error: null }) }))
vi.mock('../../hooks/useReviewSearch', () => ({ default: () => ({ results: [], isLoading: false, error: null }) }))

function renderSidebar(props = {}) {
  const onRenameTag = vi.fn().mockResolvedValue(undefined)
  render(
    <FolderSidebar
      notes={[]}
      activeFolderId={null}
      onSelectFolder={vi.fn()}
      activeTag={null}
      onSelectTag={vi.fn()}
      onRenameTag={onRenameTag}
      {...props}
    />,
  )
  return { onRenameTag }
}

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      notes: [{ id: 'n1', title: 'NVDA thesis' }, { id: 'n2', title: 'Semis rotation' }, { id: 'n3', title: 'Sector notes' }],
      total: 3,
    }),
  }))
})

describe('FolderSidebar — tag rename (wave 6 fix round 1, I4)', () => {
  it('shows who a rename touches, fetched from GET /notes/tag-members', async () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Rename research' }))
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/notes/tag-members?tag=research', expect.anything())
    expect(await screen.findByText(/will affect 3 notes/)).toBeTruthy()
    expect(screen.getByText(/NVDA thesis/)).toBeTruthy()
  })

  it('submitting calls onRenameTag with the from/to spelling and the touched note ids', async () => {
    const { onRenameTag } = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Rename research' }))
    await screen.findByText(/will affect 3 notes/)
    const input = screen.getByLabelText('Rename tag research')
    fireEvent.change(input, { target: { value: 'sector-research' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await waitFor(() => expect(onRenameTag).toHaveBeenCalledWith('research', 'sector-research', ['n1', 'n2', 'n3']))
  })

  it('Cancel closes the panel without calling onRenameTag', async () => {
    const { onRenameTag } = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Rename research' }))
    await screen.findByText(/will affect 3 notes/)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Rename tag research')).toBeNull()
    expect(onRenameTag).not.toHaveBeenCalled()
  })

  it('a tag nobody carries yet still previews honestly, and Rename stays disabled at zero', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [], total: 0 }) }))
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Rename research' }))
    expect(await screen.findByText(/No live notes carry #research/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled()
  })
})
