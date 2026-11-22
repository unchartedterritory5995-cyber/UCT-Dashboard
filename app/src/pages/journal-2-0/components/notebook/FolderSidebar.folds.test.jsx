// Notebook simplify, Task 2 (2026-11-11): the left panel is for finding notes.
//
// Top to bottom: Favorites (when any), Recents (when any), All notes, the folder tree, "+ New folder", a "More" fold
// (Unfiled, Archived, Trash, My Playbook) and a "Tags" fold (the tag list, unchanged). Both folds start closed and are
// remembered in this browser (`uct.notebook.sidebar.moreOpen` / `.tagsOpen`, '1' or absent). A fold is held open while
// what it holds is the list on screen. A shelf counter of 0 is not drawn. The saved views are not in the panel at all
// any more (they are the View menu's "Saved views" group, SavedViewsMenuGroup.test.jsx).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import FolderSidebar, { MORE_FOLD_KEY, TAGS_FOLD_KEY } from './FolderSidebar'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

vi.mock('../../hooks/useJ2NoteFolders', () => ({
  default: () => ({
    folders: [{ id: 'f1', name: 'Theses', parentId: null, sortOrder: 0 }],
    create: vi.fn(), rename: vi.fn(), remove: vi.fn(), refresh: vi.fn(),
  }),
}))
// The three shelf badges are each their own list's `total` (limit: 1 reads); a test sets them per sentinel.
const totals = { unfiled: 0, archived: 0, trash: 0 }
vi.mock('../../hooks/useJ2Notes', () => ({
  default: (args = {}) => {
    const total = args.folderId === '__unfiled__' ? totals.unfiled
      : args.folderId === '__archived__' ? totals.archived
        : args.deleted ? totals.trash : undefined
    return { notes: [], isLoading: false, isValidating: false, error: null, total }
  },
  useJ2NoteFolderCounts: () => ({ counts: { f1: 0 }, unfiled: 0, total: 0, isLoading: false, error: null, refresh: vi.fn() }),
  useJ2NotesByFolders: () => ({ byFolder: {}, isLoading: false, error: null, refresh: vi.fn() }),
  useJ2Favorites: () => ({ notes: [{ id: 'fav1', title: 'Favorite one' }], isLoading: false, error: null, refresh: vi.fn() }),
  useJ2Recents: () => ({ notes: [{ id: 'rec1', title: 'Recent one' }], isLoading: false, error: null, refresh: vi.fn() }),
  useJ2SectorThemeFacets: () => ({ sectors: [], themes: [], isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../../hooks/useJ2NoteTags', () => ({
  default: () => ({
    tagCounts: [{ tag: 'swing', count: 3 }, { tag: 'earnings', count: 1 }],
    tagTree: [
      { path: 'swing', key: 'swing', own: 3, total: 3 },
      { path: 'earnings', key: 'earnings', own: 1, total: 1 },
    ],
    isLoading: false, error: null, refresh: vi.fn(),
  }),
}))
vi.mock('../../hooks/useDocumentSearch', () => ({ default: () => ({ results: [], isLoading: false, error: null }) }))
vi.mock('../../hooks/useExcerptSearch', () => ({ default: () => ({ results: [], isLoading: false, error: null }) }))
vi.mock('../../hooks/useReviewSearch', () => ({ default: () => ({ results: [], isLoading: false, error: null }) }))

function renderSidebar(props = {}) {
  const onSelectFolder = vi.fn()
  const onSelectTag = vi.fn()
  const out = render(
    <MemoryRouter>
      <FolderSidebar notes={[]} notesTotal={4} activeFolderId={null} onSelectFolder={onSelectFolder}
        activeTag={null} onSelectTag={onSelectTag} onRenameTag={vi.fn()} {...props} />
    </MemoryRouter>,
  )
  return { ...out, onSelectFolder, onSelectTag }
}
const foldBtn = (label) => screen.getByRole('button', { name: label })
const shelfRow = (name) => screen.queryByRole('treeitem', { name: new RegExp(`^${name}\\b`) })

beforeEach(() => {
  window.localStorage.removeItem(MORE_FOLD_KEY)
  window.localStorage.removeItem(TAGS_FOLD_KEY)
  Object.assign(totals, { unfiled: 0, archived: 0, trash: 0 })
})
afterEach(() => {
  window.localStorage.removeItem(MORE_FOLD_KEY)
  window.localStorage.removeItem(TAGS_FOLD_KEY)
  __resetNotebookFlags()
  vi.restoreAllMocks()
})

describe('the folds start closed', () => {
  it('"More" and "Tags" are closed buttons; none of their rows is drawn', () => {
    latchNotebookFlags({ notebook_playbook_enabled: true })
    renderSidebar()
    expect(foldBtn('More')).toHaveAttribute('aria-expanded', 'false')
    expect(foldBtn('Tags')).toHaveAttribute('aria-expanded', 'false')
    for (const name of ['Unfiled', 'Archived', 'Trash']) expect(shelfRow(name), name).toBeNull()
    expect(screen.queryByRole('link', { name: 'My Playbook' })).toBeNull()
    expect(screen.queryByText('#swing')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Rename swing' })).toBeNull()
  })

  it('CONTROL: the rows outside the folds are drawn (All notes and the folder tree)', () => {
    renderSidebar()
    expect(screen.getByRole('treeitem', { name: 'All notes, 4' })).toBeInTheDocument()
    expect(screen.getByRole('treeitem', { name: 'Theses' })).toBeInTheDocument()
  })
})

describe('opening a fold, and remembering it', () => {
  it('"More" opens to Unfiled, Archived, Trash and My Playbook, and stores "1"', () => {
    latchNotebookFlags({ notebook_playbook_enabled: true })
    renderSidebar()
    fireEvent.click(foldBtn('More'))
    expect(foldBtn('More')).toHaveAttribute('aria-expanded', 'true')
    const more = screen.getByRole('tree', { name: 'More' })
    expect(within(more).getAllByRole('treeitem').map((el) => el.getAttribute('aria-label')))
      .toEqual(['Unfiled', 'Archived', 'Trash', 'My Playbook'])
    expect(within(more).getByRole('link', { name: 'My Playbook' })).toBeInTheDocument()
    expect(window.localStorage.getItem(MORE_FOLD_KEY)).toBe('1')
  })

  it('"Tags" opens to the tag list, filter-free and unchanged, and stores "1"', () => {
    renderSidebar()
    fireEvent.click(foldBtn('Tags'))
    expect(screen.getByText('#swing')).toBeInTheDocument()
    expect(screen.getByText('#earnings')).toBeInTheDocument()
    expect(window.localStorage.getItem(TAGS_FOLD_KEY)).toBe('1')
  })

  it('closing removes the key (absent, never "0")', () => {
    renderSidebar()
    fireEvent.click(foldBtn('More'))
    fireEvent.click(foldBtn('More'))
    expect(foldBtn('More')).toHaveAttribute('aria-expanded', 'false')
    expect(window.localStorage.getItem(MORE_FOLD_KEY)).toBeNull()
  })

  it('a new mount reads what was stored: each fold on its own key', () => {
    window.localStorage.setItem(TAGS_FOLD_KEY, '1')
    renderSidebar()
    expect(foldBtn('Tags')).toHaveAttribute('aria-expanded', 'true')
    expect(foldBtn('More')).toHaveAttribute('aria-expanded', 'false')
    cleanup()
    window.localStorage.removeItem(TAGS_FOLD_KEY)
    window.localStorage.setItem(MORE_FOLD_KEY, '1')
    renderSidebar()
    expect(foldBtn('More')).toHaveAttribute('aria-expanded', 'true')
    expect(foldBtn('Tags')).toHaveAttribute('aria-expanded', 'false')
  })

  it('storage that refuses (a private window) leaves the folds working, closed by default', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    renderSidebar()
    expect(foldBtn('More')).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(foldBtn('More'))
    expect(foldBtn('More')).toHaveAttribute('aria-expanded', 'true')
    expect(shelfRow('Trash')).not.toBeNull()
  })
})

describe('a fold is held open while what it holds is on screen', () => {
  it.each(['__unfiled__', '__archived__', '__trash__'])('"More" is open while the list is %s, and says it stays', (id) => {
    renderSidebar({ activeFolderId: id })
    const btn = foldBtn('More')
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(btn).toHaveAttribute('aria-disabled', 'true')
    const active = screen.getByRole('tree', { name: 'More' }).querySelector('[aria-selected="true"]')
    expect(active.querySelector('[data-shelf-row]').getAttribute('data-shelf-row')).toBe(id)
    fireEvent.click(btn)                                       // pressing it does nothing
    expect(foldBtn('More')).toHaveAttribute('aria-expanded', 'true')
    expect(window.localStorage.getItem(MORE_FOLD_KEY)).toBeNull()
  })

  it('CONTROL: a folder of the tree does not hold "More" open', () => {
    renderSidebar({ activeFolderId: 'f1' })
    expect(foldBtn('More')).toHaveAttribute('aria-expanded', 'false')
    expect(foldBtn('More')).not.toHaveAttribute('aria-disabled')
  })

  it('"Tags" is open while a tag is the filter, with that tag marked current', () => {
    renderSidebar({ activeTag: 'swing' })
    expect(foldBtn('Tags')).toHaveAttribute('aria-expanded', 'true')
    expect(foldBtn('Tags')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('#swing').closest('button')).toHaveAttribute('aria-current', 'true')
  })

  it('once the selection moves off, the fold goes back to what was stored (closed)', () => {
    const { rerender, onSelectFolder, onSelectTag } = renderSidebar({ activeFolderId: '__trash__' })
    expect(shelfRow('Trash')).not.toBeNull()
    rerender(
      <MemoryRouter>
        <FolderSidebar notes={[]} notesTotal={4} activeFolderId={null} onSelectFolder={onSelectFolder}
          activeTag={null} onSelectTag={onSelectTag} onRenameTag={vi.fn()} />
      </MemoryRouter>,
    )
    expect(foldBtn('More')).toHaveAttribute('aria-expanded', 'false')
    expect(shelfRow('Trash')).toBeNull()
  })
})

describe('a counter of 0 is not drawn', () => {
  it('Unfiled, Archived and Trash at 0 carry no badge and no ", 0" in their names', () => {
    window.localStorage.setItem(MORE_FOLD_KEY, '1')
    renderSidebar()
    for (const id of ['__unfiled__', '__archived__', '__trash__']) {
      const btn = document.querySelector(`[data-shelf-row="${id}"]`)
      expect(btn.textContent.trim(), id).toMatch(/^(Unfiled|Archived|Trash)$/)
      expect(btn.closest('[role="treeitem"]').getAttribute('aria-label')).not.toMatch(/,/)
    }
  })

  it('CONTROL: a count above 0 is drawn and named', () => {
    Object.assign(totals, { unfiled: 2, archived: 5, trash: 1 })
    window.localStorage.setItem(MORE_FOLD_KEY, '1')
    renderSidebar()
    expect(screen.getByRole('treeitem', { name: 'Unfiled, 2' })).toHaveTextContent('2')
    expect(screen.getByRole('treeitem', { name: 'Archived, 5' })).toHaveTextContent('5')
    expect(screen.getByRole('treeitem', { name: 'Trash, 1' })).toHaveTextContent('1')
  })

  it('a shelf row still selects its list', () => {
    window.localStorage.setItem(MORE_FOLD_KEY, '1')
    const { onSelectFolder, onSelectTag } = renderSidebar()
    fireEvent.click(document.querySelector('[data-shelf-row="__trash__"]'))
    expect(onSelectFolder).toHaveBeenCalledWith('__trash__')
    expect(onSelectTag).toHaveBeenCalledWith(null)
  })
})

describe('the order, top to bottom', () => {
  it('Favorites, Recents, All notes, the folder tree, + New folder, More, Tags', () => {
    renderSidebar()
    const marks = [
      screen.getByText('Favorites'),
      screen.getByText('Recents'),
      screen.getByRole('treeitem', { name: 'All notes, 4' }),
      screen.getByRole('treeitem', { name: 'Theses' }),
      screen.getByRole('button', { name: '+ New folder' }),
      foldBtn('More'),
      foldBtn('Tags'),
    ]
    for (let i = 1; i < marks.length; i += 1) {
      expect(marks[i - 1].compareDocumentPosition(marks[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${i}`).toBeTruthy()
    }
  })
})

describe('the saved views are not in the panel', () => {
  it('no Saved Views section and no "Add thesis starter views", even when the old props are handed in', () => {
    renderSidebar({
      savedViews: [{ id: 'v1', name: 'Active Theses', viewType: 'list' }],
      onAddStarterViews: vi.fn(),
      onSelectView: vi.fn(),
    })
    expect(screen.queryByText(/saved views/i)).toBeNull()
    expect(screen.queryByText('Active Theses')).toBeNull()
    expect(screen.queryByText('Add thesis starter views')).toBeNull()
  })
})

describe('the tag rename pencil shows on hover and focus, always on touch (stylesheet)', () => {
  // jsdom applies no stylesheet: the rules themselves are read.
  const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/FolderSidebar.module.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  /** Declarations of every rule whose selector list holds `sel`, within `scope` (the whole sheet or one @media body). */
  const decls = (scope, sel) => [...scope.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, sels]) => sels.split(',').map((x) => x.trim()).includes(sel))
    .map(([, , body]) => body)
  const mediaBody = (cond) => {
    const at = css.indexOf(`@media ${cond}`)
    if (at < 0) return ''
    let i = css.indexOf('{', at) + 1
    const start = i
    for (let depth = 1; depth > 0; i += 1) { if (css[i] === '{') depth += 1; else if (css[i] === '}') depth -= 1 }
    return css.slice(start, i - 1)
  }
  const outsideMedia = css.replace(/@media[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')

  it('at rest it is hidden (opacity 0) outside any media query', () => {
    expect(decls(outsideMedia, '.renameTagBtn').join(';')).toMatch(/opacity:\s*0\b/)
  })
  it.each(['.rowWrap:hover > .renameTagBtn', '.rowWrap:focus-within > .renameTagBtn', '.renameTagBtn:focus-visible'])(
    '%s shows it', (sel) => {
      expect(decls(outsideMedia, sel).join(';')).toMatch(/opacity:\s*1\b/)
    })
  it('on the touch tier (<=1024px) and with no hover it is always shown', () => {
    const touch = [...css.matchAll(/@media \(max-width: 1024px\)/g)].length
    expect(touch).toBeGreaterThan(0)
    const touchBodies = []
    let at = css.indexOf('@media (max-width: 1024px)')
    while (at >= 0) {
      let i = css.indexOf('{', at) + 1
      const start = i
      for (let depth = 1; depth > 0; i += 1) { if (css[i] === '{') depth += 1; else if (css[i] === '}') depth -= 1 }
      touchBodies.push(css.slice(start, i - 1))
      at = css.indexOf('@media (max-width: 1024px)', i)
    }
    expect(touchBodies.flatMap((b) => decls(b, '.renameTagBtn')).join(';')).toMatch(/opacity:\s*1\b/)
    expect(decls(mediaBody('(hover: none)'), '.renameTagBtn').join(';')).toMatch(/opacity:\s*1\b/)
  })
})
