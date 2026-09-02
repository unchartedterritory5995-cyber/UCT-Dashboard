import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FolderSidebar, { buildFolderTree } from './FolderSidebar'

const removeMock = vi.fn()

vi.mock('../../hooks/useJ2NoteFolders', () => ({
  default: () => ({
    folders: [
      { id: 'a', name: 'Trading', parentId: null, sortOrder: 0 },
      { id: 'b', name: 'Setups', parentId: 'a', sortOrder: 0 },
      { id: 'c', name: 'Journal', parentId: null, sortOrder: 1 },
    ],
    create: vi.fn(), rename: vi.fn(), remove: removeMock, refresh: vi.fn(),
  }),
}))

// The panel's search view is wired to this hook (Task 7 — server-backed
// search over the FULL note body, not a client-side filter over one loaded,
// SQL-truncated page). Mocked so every test controls exactly what "the
// server" returns and can inspect what FolderSidebar actually asked for.
const useJ2NotesMock = vi.fn(() => ({ notes: [], isLoading: false, isValidating: false, error: null }))
vi.mock('../../hooks/useJ2Notes', () => ({
  default: (...args) => useJ2NotesMock(...args),
}))

beforeEach(() => {
  useJ2NotesMock.mockReset()
  useJ2NotesMock.mockImplementation(() => ({ notes: [], isLoading: false, isValidating: false, error: null }))
})

describe('folder tree', () => {
  it('buildFolderTree nests children under parents (orphans become roots)', () => {
    const tree = buildFolderTree([
      { id: 'a', name: 'A', parentId: null },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'x', name: 'X', parentId: 'gone' },
    ])
    expect(tree.map((n) => n.id)).toEqual(['a', 'x'])
    expect(tree[0].children[0].id).toBe('b')
  })

  it('renders nested folder and expands/collapses it', () => {
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    expect(screen.getByText('Trading')).toBeInTheDocument()
    // children hidden until the parent is expanded
    expect(screen.queryByText('Setups')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Expand Trading'))
    expect(screen.getByText('Setups')).toBeInTheDocument()
    // collapsing again hides the child once more
    fireEvent.click(screen.getByLabelText('Collapse Trading'))
    expect(screen.queryByText('Setups')).not.toBeInTheDocument()
  })

  it('a folder with only notes still gets a disclosure arrow that reveals + opens its notes', () => {
    const onOpenNote = vi.fn()
    // 'Journal' (c) has no child folders — only a note. It must still expand.
    render(<FolderSidebar
      notes={[{ id: 'n1', title: 'Commentary', folderId: 'c', tags: [] }]}
      activeFolderId={null} onSelectFolder={() => {}}
      activeTag={null} onSelectTag={() => {}} onOpenNote={onOpenNote} />)
    expect(screen.queryByText('Commentary')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Expand Journal'))
    const noteBtn = screen.getByText('Commentary')
    expect(noteBtn).toBeInTheDocument()
    fireEvent.click(noteBtn)
    expect(onOpenNote).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'n1', folderId: 'c' }),
    )
  })
})

describe('header toolbar — collapse + search mode', () => {
  it('the collapse button calls onToggleSidebar', () => {
    const onToggle = vi.fn()
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} onToggleSidebar={onToggle} />)
    fireEvent.click(screen.getByLabelText('Hide folders panel'))
    expect(onToggle).toHaveBeenCalled()
  })

  it('entering search mode with no query never fetches (gated — no redundant request)', () => {
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    fireEvent.click(screen.getByLabelText('Search notes'))
    // The hook is still invoked every render (React's rule — hooks can't be
    // called conditionally), but the SEARCH call — identified by its `q` key;
    // FolderSidebar also calls this hook, unconditionally, for the honest
    // unfiled-folder total (Task 11) — must never be asked to fetch while
    // there is nothing to search for.
    const searchCalls = useJ2NotesMock.mock.calls.filter(([opts]) => opts && 'q' in opts)
    expect(searchCalls.length).toBeGreaterThan(0)
    for (const [opts] of searchCalls) {
      expect(opts?.enabled).toBe(false)
    }
  })
})

describe('search panel — server-backed (Task 7: migrated-scale correctness)', () => {
  const settle = () => act(() => { vi.advanceTimersByTime(300) })

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function typeQuery(value) {
    fireEvent.click(screen.getByLabelText('Search notes'))
    fireEvent.change(screen.getByPlaceholderText(/search notes/i), { target: { value } })
  }

  it('debounces the query ~250ms before asking the server, and gates the call while nothing is pending', () => {
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    typeQuery('sndk')

    // Immediately after typing (debounce still pending) the hook must not yet
    // be enabled for THIS query — firing on every keystroke is exactly the
    // per-render redundant request the gate exists to prevent.
    const beforeDebounce = useJ2NotesMock.mock.calls.at(-1)[0]
    expect(beforeDebounce.enabled).toBe(false)

    act(() => { vi.advanceTimersByTime(249) })
    expect(useJ2NotesMock.mock.calls.at(-1)[0].enabled).toBe(false)

    act(() => { vi.advanceTimersByTime(2) }) // crosses the 250ms mark
    const afterDebounce = useJ2NotesMock.mock.calls.at(-1)[0]
    expect(afterDebounce.enabled).toBe(true)
    expect(afterDebounce.q).toBe('sndk')
  })

  it('shows "Searching…" while the debounce is pending — never a bare "no results" moment', () => {
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    typeQuery('sndk')
    // Debounce hasn't fired yet — nothing resolved, so this must read as
    // "still working", not as an answer of zero.
    expect(screen.getByRole('status').textContent).toBe('Searching…')
    expect(screen.queryByText(/No notes match/)).not.toBeInTheDocument()
  })

  it('shows "Searching…" while the server request itself is in flight, after the debounce settles', () => {
    useJ2NotesMock.mockImplementation((opts) => ({
      notes: [],
      isLoading: Boolean(opts?.enabled),
      isValidating: false,
      error: null,
    }))
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    typeQuery('sndk')
    settle()
    expect(screen.getByRole('status').textContent).toBe('Searching…')
    expect(screen.queryByText(/No notes match/)).not.toBeInTheDocument()
  })

  it('renders the SERVER result, not a client-side filter over the loaded page — would fail if the panel still filtered `notes` locally', () => {
    // The loaded page (`notes` prop) holds a note whose VISIBLE bodyPlain does
    // NOT contain the search term — a client-side filter over this array can
    // never match it. The mocked "server" returns a wholly different note
    // that DOES contain the term (standing in for text past the 400-char SQL
    // truncation of `bodyPlain`, findable only through the real FTS5 index).
    const localNote = { id: 'local1', title: 'Local Only Note', bodyPlain: 'nothing to do with the term', folderId: null, tags: [] }
    const serverNote = { id: 'server1', title: 'Server Only Note', bodyPlain: 'deep-cycle content containing zzterm', folderId: null, tags: [] }

    useJ2NotesMock.mockImplementation((opts) => {
      if (!opts?.enabled) return { notes: [], isLoading: false, isValidating: false, error: null }
      return { notes: [serverNote], isLoading: false, isValidating: false, error: null }
    })

    const onOpenNote = vi.fn()
    render(<FolderSidebar notes={[localNote]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} onOpenNote={onOpenNote} />)
    typeQuery('zzterm')
    settle()

    expect(screen.getByText('Server Only Note')).toBeInTheDocument()
    expect(screen.queryByText('Local Only Note')).not.toBeInTheDocument()

    // Assert on the mock's call record directly (outside any fetch/json
    // callback) — the wiring itself, not a value read back through a promise
    // whose rejection a `.catch` would otherwise swallow.
    const calls = useJ2NotesMock.mock.calls
    expect(calls.some(([opts]) => opts?.enabled === true && opts?.q === 'zzterm')).toBe(true)

    fireEvent.click(screen.getByText('Server Only Note'))
    expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'server1' }))
  })

  it('requests the limit the panel displays', () => {
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    typeQuery('sndk')
    settle()
    // Scope to the SEARCH call (`q` key) — FolderSidebar's other, always-on
    // useJ2Notes call (the honest unfiled-folder total, Task 11) is also
    // enabled and has its own, unrelated `limit`.
    const enabledCall = useJ2NotesMock.mock.calls.find(([opts]) => opts?.enabled && 'q' in opts)
    expect(enabledCall[0].limit).toBe(100)
  })

  it('says so when nothing matches, once the query has actually settled', () => {
    useJ2NotesMock.mockImplementation((opts) => {
      if (!opts?.enabled) return { notes: [], isLoading: false, isValidating: false, error: null }
      return { notes: [], isLoading: false, isValidating: false, error: null }
    })
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    typeQuery('nothingmatchesthis')
    settle()
    expect(screen.getByText(/No notes match/)).toBeInTheDocument()
  })

  it('leaving search mode without a query never enables the fetch', () => {
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    fireEvent.click(screen.getByLabelText('Search notes'))
    settle()
    // Scope to the SEARCH call — see the note above.
    const searchCalls = useJ2NotesMock.mock.calls.filter(([opts]) => opts && 'q' in opts)
    for (const [opts] of searchCalls) {
      expect(opts?.enabled).toBe(false)
    }
  })
})

describe('folder delete error surfacing', () => {
  beforeEach(() => {
    removeMock.mockReset()
  })

  it('alerts with the server-provided detail when deleting a folder fails, instead of an unhandled rejection', async () => {
    const detail = 'cannot delete: a folder named \'Setups\' already exists at the destination — rename it first'
    removeMock.mockRejectedValueOnce(new Error(detail))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})

    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)

    const journalButton = screen.getByText('Journal').closest('button')
    fireEvent.click(within(journalButton).getByTitle('Delete folder'))

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(detail))
    expect(removeMock).toHaveBeenCalledWith('c')
  })
})

describe('tag cloud cap for migrated libraries', () => {
  // Tag `t{i}` ends up in count = (120 - i) notes: note j (0..119) carries
  // tags t0..tj, so tag ti appears in every note j >= i. That gives 120
  // distinct tags with strictly descending counts (t0=120 highest, t119=1
  // lowest) — the shape a decade of Evernote tags lands on one page as, and
  // exactly the sort order tagCounts already used before this change.
  function buildNotesWithManyTags() {
    const notes = []
    for (let j = 0; j < 120; j += 1) {
      const tags = []
      for (let i = 0; i <= j; i += 1) tags.push(`t${i}`)
      notes.push({ id: `n${j}`, title: `Note ${j}`, folderId: null, tags })
    }
    return notes
  }

  it('caps the tag list to the top 40 by count and reveals the rest via "Show all tags"', async () => {
    const user = userEvent.setup()
    const notes = buildNotesWithManyTags()
    render(<FolderSidebar notes={notes} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)

    // t0 (count 120, the highest) is within the cap; t119 (count 1, the
    // lowest) is capped out until "Show all tags" is used.
    expect(screen.getByText('#t0')).toBeInTheDocument()
    expect(screen.queryByText('#t119')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /show all tags/i }))

    expect(screen.getByText('#t119')).toBeInTheDocument()
    // Once every tag renders, the "show all" affordance itself goes away.
    expect(screen.queryByRole('button', { name: /show all tags/i })).not.toBeInTheDocument()
  })

  it('the filter input reaches a specific low-frequency tag without expanding the whole cloud', async () => {
    const user = userEvent.setup()
    const notes = buildNotesWithManyTags()
    render(<FolderSidebar notes={notes} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)

    expect(screen.queryByText('#t119')).not.toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/filter tags/i), 't119')

    expect(screen.getByText('#t119')).toBeInTheDocument()
    // The filter narrows to matches only.
    expect(screen.queryByText('#t0')).not.toBeInTheDocument()
  })

  it('a tag set at or under the cap renders with no cap affordances', () => {
    const notes = [
      { id: 'n1', title: 'One', folderId: null, tags: ['alpha', 'beta'] },
      { id: 'n2', title: 'Two', folderId: null, tags: ['alpha'] },
    ]
    render(<FolderSidebar notes={notes} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    expect(screen.getByText('#alpha')).toBeInTheDocument()
    expect(screen.getByText('#beta')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /show all tags/i })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/filter tags/i)).not.toBeInTheDocument()
  })
})

describe('honest badges for a migrated library (Task 11)', () => {
  // A member with 5,000 notes only ever gets ONE page (100) handed down as
  // the `notes` prop — this is exactly the shape a migrated account renders
  // with. Both badges below would read "1" against today's code (the length
  // of this one-note page) if they still derived from `notes.length`.
  const onePageOfNotes = [{ id: 'n1', title: 'Loaded page note', folderId: null, tags: [] }]

  it('"All notes" renders the true total (`notesTotal`), not the loaded page length', () => {
    render(<FolderSidebar notes={onePageOfNotes} notesTotal={5000} activeFolderId={null}
                          onSelectFolder={() => {}} activeTag={null} onSelectTag={() => {}} />)
    const allNotesRow = screen.getByText('All notes').closest('button')
    expect(within(allNotesRow).getByText('5000')).toBeInTheDocument()
    expect(within(allNotesRow).queryByText('1')).not.toBeInTheDocument()
  })

  it('"All notes" falls back to the page length only when no honest total is supplied', () => {
    render(<FolderSidebar notes={onePageOfNotes} activeFolderId={null}
                          onSelectFolder={() => {}} activeTag={null} onSelectTag={() => {}} />)
    const allNotesRow = screen.getByText('All notes').closest('button')
    expect(within(allNotesRow).getByText('1')).toBeInTheDocument()
  })

  it('"Unfiled" renders the server-computed true total, not a client count over the loaded page', () => {
    useJ2NotesMock.mockImplementation((opts) => {
      if (opts?.folderId === '__unfiled__') {
        return { notes: [], isLoading: false, isValidating: false, error: null, total: 4321 }
      }
      return { notes: [], isLoading: false, isValidating: false, error: null }
    })
    render(<FolderSidebar notes={onePageOfNotes} activeFolderId={null}
                          onSelectFolder={() => {}} activeTag={null} onSelectTag={() => {}} />)
    const unfiledRow = screen.getByText('Unfiled').closest('button')
    expect(within(unfiledRow).getByText('4321')).toBeInTheDocument()
    expect(within(unfiledRow).queryByText('1')).not.toBeInTheDocument()
  })

  it('"Unfiled" falls back to counting the loaded page when the server total is unavailable', () => {
    // Default mock (from beforeEach) returns no `total` field at all.
    render(<FolderSidebar notes={onePageOfNotes} activeFolderId={null}
                          onSelectFolder={() => {}} activeTag={null} onSelectTag={() => {}} />)
    const unfiledRow = screen.getByText('Unfiled').closest('button')
    expect(within(unfiledRow).getByText('1')).toBeInTheDocument()
  })
})
