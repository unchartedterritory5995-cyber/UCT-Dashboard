import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FolderSidebar, { buildFolderTree, renderSnippetMarks, matchReasonFor } from './FolderSidebar'

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
// P0-2 fix: the honest per-folder counts. Default mimics "still loading"
// (`counts: undefined`) so most tests exercise the page-derived fallback,
// same convention as the other hooks below — tests proving the fix itself
// override this explicitly with real (loaded) counts.
const useJ2NoteFolderCountsMock = vi.fn(() => ({
  counts: undefined, unfiled: undefined, total: undefined, isLoading: true, error: null, refresh: vi.fn(),
}))
const useJ2NotesByFoldersMock = vi.fn(() => ({ byFolder: {}, isLoading: false, error: null, refresh: vi.fn() }))
vi.mock('../../hooks/useJ2Notes', () => ({
  default: (...args) => useJ2NotesMock(...args),
  useJ2NoteFolderCounts: (...args) => useJ2NoteFolderCountsMock(...args),
  useJ2NotesByFolders: (...args) => useJ2NotesByFoldersMock(...args),
}))

// The tag cloud's honest, whole-library counts (final-review C5). Default
// (empty) mimics the real hook's shape before its first response resolves,
// so the component's page-derived fallback is what most tests exercise —
// tests that care about the SERVER numbers override this explicitly.
const useJ2NoteTagsMock = vi.fn(() => ({ tagCounts: [], isLoading: false, error: null }))
vi.mock('../../hooks/useJ2NoteTags', () => ({
  default: (...args) => useJ2NoteTagsMock(...args),
}))

beforeEach(() => {
  useJ2NotesMock.mockReset()
  useJ2NotesMock.mockImplementation(() => ({ notes: [], isLoading: false, isValidating: false, error: null }))
  useJ2NoteTagsMock.mockReset()
  useJ2NoteTagsMock.mockImplementation(() => ({ tagCounts: [], isLoading: false, error: null }))
  useJ2NoteFolderCountsMock.mockReset()
  useJ2NoteFolderCountsMock.mockImplementation(() => ({
    counts: undefined, unfiled: undefined, total: undefined, isLoading: true, error: null, refresh: vi.fn(),
  }))
  useJ2NotesByFoldersMock.mockReset()
  useJ2NotesByFoldersMock.mockImplementation(() => ({ byFolder: {}, isLoading: false, error: null, refresh: vi.fn() }))
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

describe('search panel — the true total, not the length of the loaded page (B2)', () => {
  // C2 made a real `total` available on the payload; the panel never read it
  // and printed `serverSearchResults.length` (the SEARCH_RESULT_LIMIT=100
  // page) as though it were the answer. A member with 340 matches was told
  // there were 100 — the exact silent-truncation defect C2 was raised to fix,
  // reopened one layer up. The fix follows NotebookTab's own pattern: an
  // honest "Showing N of M" line + a "Load more" affordance fed by the same
  // `total`/`hasMore`/`loadMore` shape `useJ2Notes` already returns.
  const settle = () => act(() => { vi.advanceTimersByTime(300) })

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function typeQuery(value) {
    fireEvent.click(screen.getByLabelText('Search notes'))
    fireEvent.change(screen.getByPlaceholderText(/search notes/i), { target: { value } })
  }

  it('renders the server TOTAL, not the length of the loaded page, when a migrated library has more matches than fit on one page', () => {
    const results = Array.from({ length: 100 }, (_, i) => ({
      id: `s${i}`, title: `Match ${i}`, bodyPlain: '', folderId: null, tags: [],
    }))
    useJ2NotesMock.mockImplementation((opts) => {
      if (!opts?.enabled) return { notes: [], isLoading: false, isValidating: false, error: null }
      return {
        notes: results, isLoading: false, isValidating: false, error: null,
        total: 340, hasMore: true, loadMore: vi.fn(), isLoadingMore: false,
      }
    })
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    typeQuery('sndk')
    settle()

    expect(screen.getByText('Showing 100 of 340 notes')).toBeInTheDocument()
    // The exact string the defect renders today — must be gone.
    expect(screen.queryByText('100 results')).not.toBeInTheDocument()
  })

  it('offers a way to fetch the rest, mirroring the notebook archive\'s own Load-more control', () => {
    const loadMore = vi.fn()
    useJ2NotesMock.mockImplementation((opts) => {
      if (!opts?.enabled) return { notes: [], isLoading: false, isValidating: false, error: null }
      return {
        notes: [{ id: 's1', title: 'Match', bodyPlain: '', folderId: null, tags: [] }],
        isLoading: false, isValidating: false, error: null,
        total: 340, hasMore: true, loadMore, isLoadingMore: false,
      }
    })
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    typeQuery('sndk')
    settle()

    const btn = screen.getByRole('button', { name: /load more/i })
    fireEvent.click(btn)
    expect(loadMore).toHaveBeenCalled()
  })

  it('shows no Load-more control once every match is already on screen', () => {
    useJ2NotesMock.mockImplementation((opts) => {
      if (!opts?.enabled) return { notes: [], isLoading: false, isValidating: false, error: null }
      return {
        notes: [{ id: 's1', title: 'Match', bodyPlain: '', folderId: null, tags: [] }],
        isLoading: false, isValidating: false, error: null,
        total: 1, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
      }
    })
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    typeQuery('sndk')
    settle()
    expect(screen.getByText('Showing 1 of 1 note')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
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

  it('"Unfiled" falls back to counting the loaded page while the server total is still loading', () => {
    // Final-review C2: the REAL shape `useJ2Notes` emits before its first
    // response resolves is `isLoading: true` (SWR's own signal for "no data
    // yet") paired with `total: undefined` — never `total: 0`, and never
    // `isLoading: false` with `total` simply absent. The old version of this
    // test used that second, hook-structurally-IMPOSSIBLE shape (default
    // mock: `isLoading: false`, no `total` key) — it passed, but proved
    // nothing about the fallback firing against the real hook, because the
    // real (pre-fix) hook could never actually hand FolderSidebar an
    // undefined `total` in the first place (it coerced to `0`, which is a
    // defined number `??` treats as present). Mocking the true in-flight
    // shape is what makes this test able to fail against that old bug.
    useJ2NotesMock.mockImplementation((opts) => {
      if (opts?.folderId === '__unfiled__') {
        return { notes: [], isLoading: true, isValidating: true, error: null, total: undefined }
      }
      return { notes: [], isLoading: false, isValidating: false, error: null, total: 0 }
    })
    render(<FolderSidebar notes={onePageOfNotes} activeFolderId={null}
                          onSelectFolder={() => {}} activeTag={null} onSelectTag={() => {}} />)
    const unfiledRow = screen.getByText('Unfiled').closest('button')
    expect(within(unfiledRow).getByText('1')).toBeInTheDocument()
  })
})

describe('tag counts read the whole library, not the loaded page (final-review C5)', () => {
  // The bug this closes: Task 11 gave "All notes" an honest whole-library
  // total, which made a page-derived tag cloud visibly self-contradict it —
  // 5,000 notes up top, tag counts summing to at most 100 twelve lines
  // below. `notes` here stands in for that one loaded page: just 2 notes,
  // whose tags would derive to {alpha: 1, beta: 1} if counted client-side.
  const onePageOfNotes = [
    { id: 'n1', title: 'One', folderId: null, tags: ['alpha'] },
    { id: 'n2', title: 'Two', folderId: null, tags: ['alpha', 'beta'] },
  ]

  it('renders the SERVER-computed whole-library counts, not counts derived from the loaded page', () => {
    useJ2NoteTagsMock.mockImplementation(() => ({
      tagCounts: [{ tag: 'alpha', count: 3200 }, { tag: 'beta', count: 900 }],
      isLoading: false,
      error: null,
    }))
    render(<FolderSidebar notes={onePageOfNotes} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    const alphaRow = screen.getByText('#alpha').closest('button')
    const betaRow = screen.getByText('#beta').closest('button')
    expect(within(alphaRow).getByText('3200')).toBeInTheDocument()
    expect(within(betaRow).getByText('900')).toBeInTheDocument()
    // Would read '2' / '1' if it fell back to counting the loaded page —
    // this is exactly what today's code (pre-C5) renders instead.
    expect(within(alphaRow).queryByText('2')).not.toBeInTheDocument()
    expect(within(betaRow).queryByText('1')).not.toBeInTheDocument()
  })

  it('falls back to counting the loaded page only while the server total is unknown', () => {
    // Default mock (from beforeEach): tagCounts: [] — the real hook's shape
    // before its first response resolves.
    render(<FolderSidebar notes={onePageOfNotes} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    const alphaRow = screen.getByText('#alpha').closest('button')
    const betaRow = screen.getByText('#beta').closest('button')
    expect(within(alphaRow).getByText('2')).toBeInTheDocument()
    expect(within(betaRow).getByText('1')).toBeInTheDocument()
  })
})

describe('P0-2: honest per-folder counts, not derived from one capped page', () => {
  // The bug: a folder's disclosure arrow used to come from grouping `notes`
  // (one page, sorted by title across the WHOLE library) by folderId. A
  // folder whose notes all sorted past that page's cutoff rendered with NO
  // arrow — independent of that folder's own real size. 'c' (Journal) here
  // stands in for exactly that: the loaded page carries ZERO notes for it,
  // but the honest server count says it holds 150.
  it('shows a disclosure arrow for a folder with real notes even when none of them are on the loaded page', () => {
    useJ2NoteFolderCountsMock.mockImplementation(() => ({
      counts: { c: 150 }, unfiled: 0, total: 150, isLoading: false, error: null, refresh: vi.fn(),
    }))
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    // Would NOT be in the document against the old page-derived logic — the
    // loaded page (`notes={[]}`) has nothing for folder 'c'.
    expect(screen.getByLabelText('Expand Journal')).toBeInTheDocument()
  })

  it('a folder truly empty per the honest server count gets no arrow, even if it once appeared on a stale loaded page', () => {
    useJ2NoteFolderCountsMock.mockImplementation(() => ({
      counts: {}, unfiled: 0, total: 0, isLoading: false, error: null, refresh: vi.fn(),
    }))
    // A stale page still lists a note under 'c' (e.g. it was just deleted
    // and the page hasn't refetched yet) — the honest, loaded count (absent
    // key = 0) must win once it has actually arrived.
    render(<FolderSidebar notes={[{ id: 'n1', title: 'Stale', folderId: 'c', tags: [] }]}
                          activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    expect(screen.queryByLabelText('Expand Journal')).not.toBeInTheDocument()
  })

  it('while the honest counts are still loading, falls back to the page-derived guess (no arrow flicker to "wrong" first)', () => {
    // Default mock (beforeEach): counts: undefined, isLoading: true.
    render(<FolderSidebar notes={[{ id: 'n1', title: 'Commentary', folderId: 'c', tags: [] }]}
                          activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    expect(screen.getByLabelText('Expand Journal')).toBeInTheDocument()
  })

  it('expanding a folder renders its real per-folder note list, not the one capped page', () => {
    useJ2NoteFolderCountsMock.mockImplementation(() => ({
      counts: { c: 2 }, unfiled: 0, total: 2, isLoading: false, error: null, refresh: vi.fn(),
    }))
    useJ2NotesByFoldersMock.mockImplementation(() => ({
      byFolder: { c: [
        { id: 'real1', title: 'Real Note One' },
        { id: 'real2', title: 'Real Note Two' },
      ] },
      isLoading: false, error: null, refresh: vi.fn(),
    }))
    const onOpenNote = vi.fn()
    // The loaded page carries a DIFFERENT note for 'c' — proves the honest
    // per-folder fetch wins over it once expanded, not merely alongside it.
    render(<FolderSidebar notes={[{ id: 'stale1', title: 'Stale Page Note', folderId: 'c', tags: [] }]}
                          activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} onOpenNote={onOpenNote} />)
    fireEvent.click(screen.getByLabelText('Expand Journal'))
    expect(screen.getByText('Real Note One')).toBeInTheDocument()
    expect(screen.getByText('Real Note Two')).toBeInTheDocument()
    expect(screen.queryByText('Stale Page Note')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Real Note One'))
    expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'real1' }))
  })

  it('asks for exactly the expanded folder ids, sorted (stable cache key regardless of click order)', () => {
    useJ2NoteFolderCountsMock.mockImplementation(() => ({
      counts: { a: 1, c: 1 }, unfiled: 0, total: 2, isLoading: false, error: null, refresh: vi.fn(),
    }))
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    fireEvent.click(screen.getByLabelText('Expand Journal')) // 'c'
    fireEvent.click(screen.getByLabelText('Expand Trading'))  // 'a'
    const lastCall = useJ2NotesByFoldersMock.mock.calls.at(-1)
    expect(lastCall[0]).toEqual(['a', 'c'])
  })
})

describe('Wave 0 trash: a "Trash" entry in the sidebar', () => {
  it('renders a Trash row with the honest server count and routes selection through the __trash__ sentinel', () => {
    useJ2NotesMock.mockImplementation((opts) => {
      if (opts?.deleted) return { notes: [], isLoading: false, isValidating: false, error: null, total: 7 }
      return { notes: [], isLoading: false, isValidating: false, error: null }
    })
    const onSelectFolder = vi.fn()
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={onSelectFolder}
                          activeTag={null} onSelectTag={() => {}} />)
    const trashRow = screen.getByText('Trash').closest('button')
    expect(within(trashRow).getByText('7')).toBeInTheDocument()
    fireEvent.click(trashRow)
    expect(onSelectFolder).toHaveBeenCalledWith('__trash__')
  })

  it('shows no count badge while the trash total is still unknown, rather than a false zero', () => {
    useJ2NotesMock.mockImplementation((opts) => {
      if (opts?.deleted) return { notes: [], isLoading: true, isValidating: true, error: null, total: undefined }
      return { notes: [], isLoading: false, isValidating: false, error: null }
    })
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    const trashRow = screen.getByText('Trash').closest('button')
    expect(within(trashRow).queryByText('0')).not.toBeInTheDocument()
  })

  it('highlights the Trash row as active when it is the selected view', () => {
    render(<FolderSidebar notes={[]} activeFolderId="__trash__" onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    const trashRow = screen.getByText('Trash').closest('button')
    expect(trashRow.className).toMatch(/rowActive/)
  })
})

// ── Wave 4 (Search Evolution I) — date/sector/theme filters, relevance
// sort, and query-aware snippet rendering. ──────────────────────────────────

describe('renderSnippetMarks (Wave 4 Slice 2)', () => {
  it('splits a snippet() string into text + <mark> React children, never dangerouslySetInnerHTML', () => {
    render(<div data-testid="out">{renderSnippetMarks('the <mark>capex</mark> thesis')}</div>)
    const out = screen.getByTestId('out')
    expect(out.querySelector('mark').textContent).toBe('capex')
    expect(out.textContent).toBe('the capex thesis')
  })

  it('returns null for an empty/absent snippet', () => {
    expect(renderSnippetMarks('')).toBeNull()
    expect(renderSnippetMarks(undefined)).toBeNull()
  })

  it('a member\'s own literal "<" or ">" text renders as plain text, never as markup', () => {
    // No <mark> delimiters at all here -- the whole string is untrusted
    // member content and must render verbatim, as text.
    render(<div data-testid="out">{renderSnippetMarks('if x < y and y > 0')}</div>)
    expect(screen.getByTestId('out').textContent).toBe('if x < y and y > 0')
    expect(screen.getByTestId('out').querySelector('script')).toBeNull()
  })
})

describe('matchReasonFor (Wave 4 Slice 2)', () => {
  it('explains an exact ticker match, stripping a leading cashtag like the backend fix does', () => {
    expect(matchReasonFor({ ticker: 'NVDA', tags: [] }, '$NVDA')).toBe('Matched ticker: NVDA')
    expect(matchReasonFor({ ticker: 'NVDA', tags: [] }, 'NVDA')).toBe('Matched ticker: NVDA')
  })

  it('explains an exact tag match', () => {
    expect(matchReasonFor({ ticker: null, tags: ['thesis'] }, 'thesis')).toBe('Matched tag: thesis')
  })

  it('returns null when neither ticker nor tag matches (an FTS-only match)', () => {
    expect(matchReasonFor({ ticker: 'AMD', tags: ['other'] }, 'NVDA')).toBeNull()
  })

  it('returns null for an empty query', () => {
    expect(matchReasonFor({ ticker: 'NVDA', tags: [] }, '')).toBeNull()
  })
})

describe('search panel — Wave 4 date/sector/theme filters', () => {
  const settle = () => act(() => { vi.advanceTimersByTime(300) })
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function openSearch() {
    fireEvent.click(screen.getByLabelText('Search notes'))
  }

  it('filters are collapsed by default -- a plain search never shows them', () => {
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    openSearch()
    expect(screen.queryByText('Note created from')).not.toBeInTheDocument()
  })

  it('the filter toggle reveals date/sector/theme inputs', () => {
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    openSearch()
    fireEvent.click(screen.getByLabelText('Search filters'))
    expect(screen.getByText('Note created from')).toBeInTheDocument()
    expect(screen.getByText('Sector')).toBeInTheDocument()
    expect(screen.getByText('Theme')).toBeInTheDocument()
  })

  it('setting a date filter alone (no typed query) enables the search fetch with dateFrom/dateTo and no q', () => {
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    openSearch()
    fireEvent.click(screen.getByLabelText('Search filters'))
    // Select the date-from input by its wrapping label text.
    const fromInput = screen.getByText('Note created from').parentElement.querySelector('input')
    fireEvent.change(fromInput, { target: { value: '2026-03-01' } })
    settle()
    const call = useJ2NotesMock.mock.calls.filter(([opts]) => opts && 'dateFrom' in opts).at(-1)[0]
    expect(call.enabled).toBe(true)
    expect(call.dateFrom).toBe('2026-03-01')
    expect(call.q).toBeUndefined()
  })

  it('the search fetch requests sort="relevance"', () => {
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    openSearch()
    fireEvent.change(screen.getByPlaceholderText(/search notes/i), { target: { value: 'nvda' } })
    settle()
    const call = useJ2NotesMock.mock.calls.filter(([opts]) => opts?.q === 'nvda').at(-1)[0]
    expect(call.sort).toBe('relevance')
  })

  it('Clear filters resets all four fields and is only shown while a filter is active', () => {
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    openSearch()
    fireEvent.click(screen.getByLabelText('Search filters'))
    expect(screen.queryByText('Clear filters')).not.toBeInTheDocument()
    const sectorInput = screen.getByPlaceholderText('e.g. Technology')
    fireEvent.change(sectorInput, { target: { value: 'Technology' } })
    expect(screen.getByText('Clear filters')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Clear filters'))
    expect(screen.getByPlaceholderText('e.g. Technology')).toHaveValue('')
    expect(screen.queryByText('Clear filters')).not.toBeInTheDocument()
  })

  it('a result with a body snippet renders the highlighted excerpt, never the old naive 120-char slice', () => {
    useJ2NotesMock.mockImplementation((opts) => {
      if (opts?.q === 'capex') {
        return {
          notes: [{ id: 'n1', title: 'Thesis', bodySnippet: 'accelerating <mark>capex</mark> spend', ticker: null, tags: [] }],
          isLoading: false, isValidating: false, error: null, total: 1,
        }
      }
      return { notes: [], isLoading: false, isValidating: false, error: null }
    })
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    openSearch()
    fireEvent.change(screen.getByPlaceholderText(/search notes/i), { target: { value: 'capex' } })
    settle()
    expect(screen.getByText('capex').tagName).toBe('MARK')
  })

  it('a tag/ticker-only match (no snippet) shows the "why matched" label instead of a blank excerpt', () => {
    useJ2NotesMock.mockImplementation((opts) => {
      if (opts?.q === 'NVDA') {
        return {
          notes: [{ id: 'n1', title: 'Position note', ticker: 'NVDA', tags: [] }],
          isLoading: false, isValidating: false, error: null, total: 1,
        }
      }
      return { notes: [], isLoading: false, isValidating: false, error: null }
    })
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    openSearch()
    fireEvent.change(screen.getByPlaceholderText(/search notes/i), { target: { value: 'NVDA' } })
    settle()
    expect(screen.getByText('Matched ticker: NVDA')).toBeInTheDocument()
  })
})
