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

// Finish program, lane KEYS3 round 3: the sidebar's tags are ONE Tab stop. Every tag was two
// (its own button and its Rename), so a library with twenty tags put forty stops between the
// folder tree and the notes. Same model as the notes list and the Trades list
// (lib/useGridRoving.js): Down and Up move tag to tag, Right and Left reach a tag's Rename (and
// its disclosure arrow in a nested library), Home and End go to the ends, and a typed letter
// moves to the next tag that starts with it. A key the list takes does not reach the page's
// "g then letter" shortcuts (the rule of round 2).
describe('the tags are one Tab stop (lane KEYS3)', () => {
  const FLAT = {
    tagCounts: [{ tag: 'swing', count: 2 }, { tag: 'gaps', count: 1 }, { tag: 'thesis', count: 4 }],
    tagTree: [
      { path: 'swing', key: 'swing', own: 2, total: 2 },
      { path: 'gaps', key: 'gaps', own: 1, total: 1 },
      { path: 'thesis', key: 'thesis', own: 4, total: 4 },
    ],
    isLoading: false, error: null,
  }
  const rowsOf = () => [...document.querySelectorAll('[data-tag-row]')]
  const controls = () => rowsOf().flatMap((r) => [...r.querySelectorAll('button')])
  const select = (path) => rowsOf().find((r) => r.getAttribute('data-typeahead-label') === path).querySelector('button')
  const key = (k, opts = {}) => fireEvent.keyDown(document.activeElement, { key: k, ...opts })

  it('flat library: one control of all the tag rows is in the Tab order', () => {
    tagsHook.mockReturnValue(FLAT)
    renderSidebar({ onRenameTag: vi.fn() })
    expect(rowsOf()).toHaveLength(3)
    expect(controls()).toHaveLength(6)                                   // a tag button and a Rename, each
    const stops = controls().filter((b) => b.getAttribute('tabindex') === '0')
    expect(stops).toHaveLength(1)
    expect(controls().filter((b) => b.getAttribute('tabindex') === '-1')).toHaveLength(5)
  })

  it('Down, End and Home move tag to tag; Right reaches Rename; Enter still selects', () => {
    tagsHook.mockReturnValue(FLAT)
    const { onSelectTag } = renderSidebar({ onRenameTag: vi.fn() })
    const first = controls().find((b) => b.getAttribute('tabindex') === '0')
    first.focus()
    key('ArrowDown')
    const second = document.activeElement
    expect(second).not.toBe(first)
    expect(second.closest('[data-tag-row]')).toBe(rowsOf()[1])
    key('ArrowRight')
    expect(document.activeElement.getAttribute('aria-label')).toMatch(/^Rename /)
    key('ArrowLeft')
    key('End')
    expect(document.activeElement.closest('[data-tag-row]')).toBe(rowsOf()[2])
    key('Home')
    expect(document.activeElement).toBe(first)
    fireEvent.click(document.activeElement)
    expect(onSelectTag).toHaveBeenCalledTimes(1)
  })

  it('a typed letter moves to the tag that starts with it ("g" is gaps), and stays out of the page\'s shortcuts', () => {
    tagsHook.mockReturnValue(FLAT)
    renderSidebar({ onRenameTag: vi.fn() })
    controls().find((b) => b.getAttribute('tabindex') === '0').focus()
    const seen = vi.fn()
    document.addEventListener('keydown', seen)
    key('g')
    document.removeEventListener('keydown', seen)
    expect(document.activeElement).toBe(select('gaps'))
    expect(seen).not.toHaveBeenCalled()
  })

  it('nested library: still one stop, and a child row joins when its parent is opened', () => {
    tagsHook.mockReturnValue(NESTED)
    renderSidebar({ onRenameTag: vi.fn() })
    expect(controls().filter((b) => b.getAttribute('tabindex') === '0')).toHaveLength(1)
    const before = rowsOf().length
    fireEvent.click(screen.getByRole('button', { name: "Expand tag research" }))
    expect(rowsOf().length).toBeGreaterThan(before)
    expect(controls().filter((b) => b.getAttribute('tabindex') === '0')).toHaveLength(1)
  })
})
