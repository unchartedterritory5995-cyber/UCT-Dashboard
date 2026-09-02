import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
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

  it('Search mode filters notes by title/body and opening a result calls onOpenNote', () => {
    const onOpenNote = vi.fn()
    render(<FolderSidebar
      notes={[
        { id: 'n1', title: 'SNDK Investor Day', bodyPlain: 'memory names', folderId: 'a', tags: [] },
        { id: 'n2', title: 'AMD earnings', bodyPlain: 'chips', folderId: null, tags: [] },
      ]}
      activeFolderId={null} onSelectFolder={() => {}}
      activeTag={null} onSelectTag={() => {}} onOpenNote={onOpenNote} />)
    // Enter search mode → the folder tree is replaced by the search box.
    fireEvent.click(screen.getByLabelText('Search notes'))
    const input = screen.getByPlaceholderText(/search notes/i)
    fireEvent.change(input, { target: { value: 'sndk' } })
    expect(screen.getByText('SNDK Investor Day')).toBeInTheDocument()
    expect(screen.queryByText('AMD earnings')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('SNDK Investor Day'))
    expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }))
  })

  it('body-text search matches a note whose title does not', () => {
    render(<FolderSidebar
      notes={[{ id: 'n1', title: 'Untitled', bodyPlain: 'the semiconductor supercycle', folderId: null, tags: [] }]}
      activeFolderId={null} onSelectFolder={() => {}}
      activeTag={null} onSelectTag={() => {}} />)
    fireEvent.click(screen.getByLabelText('Search notes'))
    fireEvent.change(screen.getByPlaceholderText(/search notes/i), { target: { value: 'supercycle' } })
    expect(screen.getByText('1 result')).toBeInTheDocument()
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
