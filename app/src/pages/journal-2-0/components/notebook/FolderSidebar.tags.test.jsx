import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import FolderSidebar from './FolderSidebar'

/**
 * Wave 5 nested tags in the sidebar. Same hook-mock harness as
 * FolderSidebar.test.jsx, reduced to what the tag section reads.
 *
 * ⛔ The first describe is the CONTROL: a library whose tags have no `/`
 * must draw exactly the rows it always drew — no disclosure buttons, no tree
 * group, the same `#tag` + count, the same click. Everything below it is new
 * behaviour that only a `/` can switch on.
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
const tagsHook = vi.fn()
vi.mock('../../hooks/useJ2NoteTags', () => ({ default: (...a) => tagsHook(...a) }))
vi.mock('../../hooks/useDocumentSearch', () => ({ default: () => ({ results: [], isLoading: false, error: null }) }))
vi.mock('../../hooks/useExcerptSearch', () => ({ default: () => ({ results: [], isLoading: false, error: null }) }))
vi.mock('../../hooks/useReviewSearch', () => ({ default: () => ({ results: [], isLoading: false, error: null }) }))

const NESTED = {
  tagCounts: [
    { tag: 'research/semis', count: 2 },
    { tag: 'swing', count: 2 },
    { tag: 'research', count: 1 },
    { tag: 'research/semis/nvda', count: 1 },
  ],
  // server truth: "research" subtree holds 3 DISTINCT notes, not 1+2+1=4
  tagTree: [
    { path: 'research', key: 'research', own: 1, total: 3 },
    { path: 'research/semis', key: 'research/semis', own: 2, total: 3 },
    { path: 'swing', key: 'swing', own: 2, total: 2 },
    { path: 'research/semis/nvda', key: 'research/semis/nvda', own: 1, total: 1 },
  ],
  isLoading: false,
  error: null,
}

function renderSidebar(props = {}) {
  const onSelectTag = vi.fn()
  const onSelectFolder = vi.fn()
  render(
    <FolderSidebar
      notes={[]}
      activeFolderId={null}
      onSelectFolder={onSelectFolder}
      activeTag={null}
      onSelectTag={onSelectTag}
      {...props}
    />,
  )
  return { onSelectTag, onSelectFolder }
}

beforeEach(() => {
  tagsHook.mockReset()
})

describe('⛔ CONTROL — a library with no nested tags draws exactly as before', () => {
  beforeEach(() => {
    tagsHook.mockImplementation(() => ({
      tagCounts: [{ tag: 'swing', count: 5 }, { tag: 'earnings', count: 2 }],
      tagTree: [
        { path: 'swing', key: 'swing', own: 5, total: 5 },
        { path: 'earnings', key: 'earnings', own: 2, total: 2 },
      ],
      isLoading: false,
      error: null,
    }))
  })

  it('same rows, same counts, same order — and no tree machinery', () => {
    renderSidebar()
    const swing = screen.getByText('#swing').closest('button')
    const earnings = screen.getByText('#earnings').closest('button')
    expect(within(swing).getByText('5')).toBeInTheDocument()
    expect(within(earnings).getByText('2')).toBeInTheDocument()
    expect(swing.compareDocumentPosition(earnings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Tags' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Expand tag/ })).toBeNull()
    // the row carries no new accessible name: it is still read as "#swing 5"
    expect(swing).not.toHaveAttribute('aria-label')
  })

  it('clicking a flat tag selects that tag, as before', () => {
    const { onSelectTag, onSelectFolder } = renderSidebar()
    fireEvent.click(screen.getByText('#earnings'))
    expect(onSelectTag).toHaveBeenCalledWith('earnings')
    expect(onSelectFolder).toHaveBeenCalledWith(null)
  })
})

describe('nested tags — the tree', () => {
  beforeEach(() => { tagsHook.mockImplementation(() => NESTED) })

  it('draws top-level tags with a disclosure, children hidden until expanded', () => {
    renderSidebar()
    const group = screen.getByRole('group', { name: 'Tags' })
    expect(within(group).getByRole('button', { name: /^Tag research,/ })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: /^Tag swing,/ })).toBeInTheDocument()
    expect(within(group).queryByRole('button', { name: /^Tag research\/semis,/ })).toBeNull()
    const expand = screen.getByRole('button', { name: 'Expand tag research' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(expand)
    expect(screen.getByRole('button', { name: 'Collapse tag research' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /^Tag research\/semis,/ })).toBeInTheDocument()
  })

  it('a parent counts DISTINCT notes in its subtree (the server total), never a sum', () => {
    renderSidebar()
    const research = screen.getByRole('button', { name: /^Tag research,/ })
    expect(within(research).getByText('3')).toBeInTheDocument()
    expect(research).toHaveAccessibleName('Tag research, 3 notes including the tags below it')
  })

  it('a flat tag beside nested ones has no disclosure and reads as a leaf', () => {
    renderSidebar()
    expect(screen.queryByRole('button', { name: 'Expand tag swing' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Tag swing, 2 notes' })).toBeInTheDocument()
  })

  it('choosing a parent selects the parent path; choosing a child selects its FULL path', () => {
    const { onSelectTag } = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: /^Tag research,/ }))
    expect(onSelectTag).toHaveBeenLastCalledWith('research')
    fireEvent.click(screen.getByRole('button', { name: 'Expand tag research' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand tag research/semis' }))
    fireEvent.click(screen.getByRole('button', { name: /^Tag research\/semis\/nvda,/ }))
    expect(onSelectTag).toHaveBeenLastCalledWith('research/semis/nvda')
  })

  it('a child shows its own level, not the whole path again', () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Expand tag research' }))
    const semis = screen.getByRole('button', { name: /^Tag research\/semis,/ })
    expect(semis.textContent).toBe('semis3')
  })

  it('the tag being browsed is on screen: its parents open with it', () => {
    renderSidebar({ activeTag: 'Research/Semis/NVDA' })
    const nvda = screen.getByRole('button', { name: /^Tag research\/semis\/nvda,/ })
    expect(nvda).toHaveAttribute('aria-current', 'true')
  })

  it('without a server tree (an older answer) the tree is still drawn from the flat counts', () => {
    tagsHook.mockImplementation(() => ({ ...NESTED, tagTree: null }))
    renderSidebar()
    // fallback: a parent's count is the SUM of its subtree (an upper bound)
    const research = screen.getByRole('button', { name: /^Tag research,/ })
    expect(within(research).getByText('4')).toBeInTheDocument()
  })
})

describe('nested tags — filtering a long tag list', () => {
  it('the filter reaches a deep tag by any level and lists it by its full path', () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ path: `t${i}`, key: `t${i}`, own: 50 - i, total: 50 - i }))
    tagsHook.mockImplementation(() => ({
      tagCounts: many.map((n) => ({ tag: n.path, count: n.own })).concat([{ tag: 'macro/rates/fed', count: 1 }]),
      tagTree: many.concat([
        { path: 'macro', key: 'macro', own: 0, total: 1 },
        { path: 'macro/rates', key: 'macro/rates', own: 0, total: 1 },
        { path: 'macro/rates/fed', key: 'macro/rates/fed', own: 1, total: 1 },
      ]),
      isLoading: false,
      error: null,
    }))
    const { onSelectTag } = renderSidebar()
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter tags' }), { target: { value: 'fed' } })
    fireEvent.click(screen.getByText('#macro/rates/fed'))
    expect(onSelectTag).toHaveBeenCalledWith('macro/rates/fed')
  })
})
