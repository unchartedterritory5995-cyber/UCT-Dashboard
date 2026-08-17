import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
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
