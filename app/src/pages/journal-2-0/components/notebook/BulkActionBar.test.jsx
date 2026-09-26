import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import BulkActionBar, { folderPathOptions, UNFILED_VALUE } from './BulkActionBar'

const FOLDERS = [
  { id: 'f2', name: 'Semis', parentId: 'f1' },
  { id: 'f1', name: 'Research', parentId: null },
]
vi.mock('../../hooks/useJ2NoteFolders', () => ({
  default: () => ({ folders: FOLDERS }),
}))

function setup(over = {}) {
  const props = {
    count: 2,
    totalInView: 5,
    allSelected: false,
    onSelectAll: vi.fn(),
    onClear: vi.fn(),
    selectedTags: ['earnings', 'swing'],
    tagNodes: [
      { path: 'earnings', key: 'earnings', own: 3, total: 3 },
      { path: 'research', key: 'research', own: 0, total: 2 },
      { path: 'research/semis', key: 'research/semis', own: 2, total: 2 },
    ],
    onMove: vi.fn(),
    onAddTag: vi.fn(),
    onRemoveTag: vi.fn(),
    onFavorite: vi.fn(),
    onUnfavorite: vi.fn(),
    onExport: vi.fn(),
    onTrash: vi.fn(),
    onRestore: vi.fn(),
    ...over,
  }
  render(<BulkActionBar {...props} />)
  return props
}

beforeEach(() => vi.clearAllMocks())

describe('folderPathOptions', () => {
  it('names nested folders by their full path, sorted', () => {
    expect(folderPathOptions(FOLDERS)).toEqual([
      { id: 'f1', path: 'Research' },
      { id: 'f2', path: 'Research / Semis' },
    ])
  })
})

describe('BulkActionBar', () => {
  it('is a labelled group that says how many are selected', () => {
    setup()
    const bar = screen.getByRole('group', { name: 'Actions for the selected notes' })
    expect(within(bar).getByText('2 selected')).toBeInTheDocument()
    // N4: a "toolbar" promises roving arrow-key focus this bar does not have.
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('offers select-all-in-view only while not everything is selected', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Select all 5 shown' }))
    expect(p.onSelectAll).toHaveBeenCalled()
  })

  it('hides select-all once everything in view is selected', () => {
    setup({ allSelected: true, count: 5 })
    expect(screen.queryByRole('button', { name: /Select all/ })).toBeNull()
  })

  it('Clear names its shortcut for a screen reader', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Clear the selection (Esc)' }))
    expect(p.onClear).toHaveBeenCalled()
  })

  const picker = () => screen.getByRole('combobox', { name: 'Folder to move the selected notes to' })
  const moveBtn = () => screen.getByRole('button', { name: 'Move' })

  it('moving to a folder passes the id AND the path the sentence will name', () => {
    const p = setup()
    fireEvent.change(picker(), { target: { value: 'f2' } })
    fireEvent.click(moveBtn())
    expect(p.onMove).toHaveBeenCalledTimes(1)
    expect(p.onMove).toHaveBeenCalledWith('f2', 'Research / Semis')
    expect(picker()).toHaveValue('')           // ready for the next choice
  })

  it('moving to Unfiled sends null, never the sentinel', () => {
    const p = setup()
    fireEvent.change(picker(), { target: { value: UNFILED_VALUE } })
    fireEvent.click(moveBtn())
    expect(p.onMove).toHaveBeenCalledWith(null, 'Unfiled')
  })

  it('B1: arrow keys, Enter and type-ahead on the picker never move a note', () => {
    // jsdom does not implement a closed <select>'s keyboard behaviour, so each
    // key is followed by the `change` a browser fires on the spot for it:
    // ↓ on Windows/Linux Chrome, Edge and Firefox, and type-ahead everywhere.
    const p = setup()
    const sel = picker()
    sel.focus()
    fireEvent.keyDown(sel, { key: 'ArrowDown' })
    fireEvent.change(sel, { target: { value: UNFILED_VALUE } })   // ↓ lands on "Unfiled"
    fireEvent.keyDown(sel, { key: 'ArrowDown' })
    fireEvent.change(sel, { target: { value: 'f1' } })            // ↓ again: "Research"
    fireEvent.keyDown(sel, { key: 'Enter' })
    fireEvent.keyDown(sel, { key: 'r' })
    fireEvent.change(sel, { target: { value: 'f2' } })            // type-ahead
    expect(p.onMove).not.toHaveBeenCalled()
    // The choice is kept and shown, and only the button acts on it.
    expect(sel).toHaveValue('f2')
    expect(moveBtn()).toBeEnabled()
    fireEvent.click(moveBtn())
    expect(p.onMove).toHaveBeenCalledTimes(1)
    expect(p.onMove).toHaveBeenCalledWith('f2', 'Research / Semis')
  })

  it('Move is disabled until a folder is chosen — no dead click', () => {
    setup()
    expect(moveBtn()).toBeDisabled()
  })

  it('the Tags button opens a panel: add a trimmed tag, or remove one the selection carries', () => {
    const p = setup()
    const btn = screen.getByRole('button', { name: 'Tags' })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    const input = screen.getByRole('combobox', { name: 'Tag to add to the selected notes' })
    const add = screen.getByRole('button', { name: 'Add tag' })
    expect(add).toBeDisabled()                 // no dead click on an empty tag
    fireEvent.change(input, { target: { value: '  research/semis  ' } })
    fireEvent.click(add)
    expect(p.onAddTag).toHaveBeenCalledWith('research/semis')
    fireEvent.click(screen.getByRole('button', { name: 'Remove the tag swing from the selected notes' }))
    expect(p.onRemoveTag).toHaveBeenCalledWith('swing')
  })

  it('says so when no selected note has a tag to remove', () => {
    setup({ selectedTags: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }))
    expect(screen.getByText('None of the selected notes has a tag yet.')).toBeInTheDocument()
  })

  it('every action button calls its handler', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Favorite' }))
    fireEvent.click(screen.getByRole('button', { name: 'Unfavorite' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export selected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(p.onFavorite).toHaveBeenCalled()
    expect(p.onUnfavorite).toHaveBeenCalled()
    expect(p.onExport).toHaveBeenCalled()
    expect(p.onTrash).toHaveBeenCalled()
  })

  it('in the Trash the only action is Restore', () => {
    const p = setup({ trashView: true })
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(p.onRestore).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Move to Trash' })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('while busy every action is disabled and it says so', () => {
    setup({ busy: true })
    expect(screen.getByRole('button', { name: 'Move to Trash' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export selected' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Folder to move the selected notes to' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Working…')
  })
})

describe('BulkActionBar — touch tier', () => {
  const css = readFileSync(
    join(process.cwd(), 'src/pages/journal-2-0/components/notebook/BulkActionBar.module.css'), 'utf8',
  ).replace(/\r\n/g, '\n')
  const touch = /@media\s*\(max-width:\s*1024px\)\s*\{([\s\S]*?)\n\}/.exec(css)

  it('a max-width:1024px block exists (non-vacuity)', () => {
    expect(touch).not.toBeNull()
  })

  it('every control class is floored to var(--tap-min) at the touch tier', () => {
    for (const cls of ['.action', '.moveSelect', '.tagChip', '.linkBtn']) {
      expect(touch[1], cls).toMatch(new RegExp(`\\${cls}[\\s,][\\s\\S]*min-height:\\s*var\\(--tap-min\\)`))
    }
  })
})
