import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FolderSidebar, { buildFolderTree } from './FolderSidebar'

vi.mock('../../hooks/useJ2NoteFolders', () => ({
  default: () => ({
    folders: [
      { id: 'a', name: 'Trading', parentId: null, sortOrder: 0 },
      { id: 'b', name: 'Setups', parentId: 'a', sortOrder: 0 },
      { id: 'c', name: 'Journal', parentId: null, sortOrder: 1 },
    ],
    create: vi.fn(), rename: vi.fn(), remove: vi.fn(), refresh: vi.fn(),
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
  })
})
