// Notebook simplify, Task 2 (2026-11-11): the saved views moved from the folders panel to a "Saved views" group at the
// foot of the notes list's View menu. Every contract the panel section's rails held moved here with it (they were in
// FolderSidebar.test.jsx: Wave E, UX #1, wave 7 lane J's J5, competitive audit UX #6), restated for a menu: the rows
// are menu items, applying one closes the menu, renaming keeps it open.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { useMenuButton } from './NewNoteMenu'
import SavedViewsMenuGroup from './SavedViewsMenuGroup'

const VIEWS = [
  { id: 'v1', name: 'Active Theses', viewType: 'list' },
  { id: 'v2', name: 'Watching', viewType: 'board' },
]

/** The View menu's engine with only this group inside, opened. */
function Harness(props) {
  const menu = useMenuButton()
  return (
    <>
      <button type="button" {...menu.triggerProps}>View</button>
      {menu.open && (
        <div {...menu.menuProps} aria-label="View">
          <SavedViewsMenuGroup menu={menu} views={VIEWS} onSelectView={() => {}} onRenameView={() => {}}
            onDeleteView={() => {}} {...props} />
        </div>
      )}
    </>
  )
}
function openGroup(props = {}) {
  const handlers = { onSelectView: vi.fn(), onRenameView: vi.fn(), onDeleteView: vi.fn(), ...props }
  render(<Harness {...handlers} />)
  fireEvent.click(screen.getByRole('button', { name: 'View' }))
  return handlers
}
const menu = () => screen.queryByRole('menu', { name: 'View' })
const group = () => within(menu()).getByRole('group', { name: 'Saved views' })

describe('the group lists the saved views as menu items', () => {
  it('one menuitemradio per view, in a group named "Saved views", in the order served', () => {
    openGroup()
    expect(within(group()).getAllByRole('menuitemradio').map((el) => el.textContent.trim()))
      .toEqual(['Active Theses', 'Watching'])
  })

  it('choosing a view applies it and closes the menu', () => {
    const { onSelectView } = openGroup()
    fireEvent.click(within(group()).getByRole('menuitemradio', { name: 'Watching' }))
    expect(onSelectView).toHaveBeenCalledWith(VIEWS[1])
    expect(menu()).toBeNull()
  })

  it('the view in use is the checked one, and only it', () => {
    openGroup({ activeViewId: 'v2' })
    expect(within(group()).getByRole('menuitemradio', { name: 'Watching' })).toHaveAttribute('aria-checked', 'true')
    expect(within(group()).getByRole('menuitemradio', { name: 'Active Theses' })).toHaveAttribute('aria-checked', 'false')
  })

  it('the row icon follows each view\'s own type (VIEW_MODES), never a list/table binary', () => {
    render(<Harness views={[
      { id: 'a', name: 'A Board', viewType: 'board' },
      { id: 'b', name: 'A Calendar', viewType: 'calendar' },
      { id: 'c', name: 'A Graph', viewType: 'graph' },
      { id: 'd', name: 'A List', viewType: 'list' },
      { id: 'e', name: 'A Table', viewType: 'table' },
      { id: 'f', name: 'From a newer client', viewType: 'mystery' },
    ]} />)
    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    const iconFor = (name) => screen.getByTitle(name).querySelector('svg[data-view-icon]').getAttribute('data-view-icon')
    expect(iconFor('A Board')).toBe('board')
    expect(iconFor('A Calendar')).toBe('calendar')
    expect(iconFor('A Graph')).toBe('graph')
    expect(iconFor('A List')).toBe('rows')
    expect(iconFor('A Table')).toBe('columns')
    expect(iconFor('From a newer client')).toBe('rows')
  })
})

describe('rename and delete on each row (UX #1)', () => {
  it('the pencil opens a field holding the name; Enter saves through onRenameView and the menu stays open', async () => {
    const { onRenameView, onSelectView } = openGroup()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename Active Theses' }))
    const input = screen.getByRole('textbox', { name: 'Rename view Active Theses' })
    expect(input).toHaveValue('Active Theses')
    fireEvent.change(input, { target: { value: 'Renamed View' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRenameView).toHaveBeenCalledWith('v1', 'Renamed View')
    expect(onRenameView).toHaveBeenCalledTimes(1)
    expect(onSelectView).not.toHaveBeenCalled()
    expect(menu()).not.toBeNull()
    // focus goes back to that view's row, inside the open menu
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTitle('Active Theses')))
  })

  it('Escape cancels: no rename, and the menu is NOT closed by it', () => {
    const { onRenameView } = openGroup()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename Active Theses' }))
    const input = screen.getByRole('textbox', { name: 'Rename view Active Theses' })
    fireEvent.change(input, { target: { value: 'Should not save' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onRenameView).not.toHaveBeenCalled()
    expect(menu()).not.toBeNull()
    expect(screen.getByTitle('Active Theses')).toBeInTheDocument()
  })

  it('an empty name is a cancel, never an empty-named view', () => {
    const { onRenameView } = openGroup()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename Active Theses' }))
    const input = screen.getByRole('textbox', { name: 'Rename view Active Theses' })
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRenameView).not.toHaveBeenCalled()
  })

  it('leaving the field saves, once', () => {
    const { onRenameView } = openGroup()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename Watching' }))
    const input = screen.getByRole('textbox', { name: 'Rename view Watching' })
    fireEvent.change(input, { target: { value: 'Watching list' } })
    fireEvent.blur(input)
    expect(onRenameView).toHaveBeenCalledWith('v2', 'Watching list')
    expect(onRenameView).toHaveBeenCalledTimes(1)
  })

  it('the field keeps its own keys: an arrow typed in it does not move focus out of it', () => {
    openGroup()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename Active Theses' }))
    const input = screen.getByRole('textbox', { name: 'Rename view Active Theses' })
    input.focus()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(input)
  })

  it('Delete hands the id and name to onDeleteView WITHOUT applying the view, and closes the menu', () => {
    const { onDeleteView, onSelectView } = openGroup()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Active Theses' }))
    expect(onDeleteView).toHaveBeenCalledWith('v1', 'Active Theses')
    expect(onSelectView).not.toHaveBeenCalled()
    expect(menu()).toBeNull()
  })
})

describe('a row is three sibling buttons, never a button inside a button (J5)', () => {
  it('no button in the group holds another control', () => {
    openGroup()
    const buttons = [...group().querySelectorAll('button')]
    expect(buttons.length).toBe(VIEWS.length * 3)             // non-vacuity: every row's three controls
    const nested = buttons.filter((b) => b.querySelector(
      'button, a[href], input, select, textarea, [role="button"], [tabindex], [aria-label]'))
    expect(nested).toEqual([])
  })

  it('each has its own name; the apply row alone carries the view name as its title', () => {
    openGroup()
    expect(screen.getByRole('menuitemradio', { name: 'Active Theses' })).toHaveAttribute('title', 'Active Theses')
    expect(screen.getByRole('menuitem', { name: 'Rename Active Theses' })).toHaveAttribute('title', 'Rename view')
    expect(screen.getByRole('menuitem', { name: 'Delete Active Theses' })).toHaveAttribute('title', 'Delete view')
    expect(group().querySelectorAll('[title="Active Theses"]')).toHaveLength(1)
  })

  it('the menu\'s Down arrow reaches the row, then its Rename, then its Delete', async () => {
    render(<Harness onSelectView={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'View' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTitle('Active Theses')))
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    expect(document.activeElement).toHaveAccessibleName('Rename Active Theses')
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    expect(document.activeElement).toHaveAccessibleName('Delete Active Theses')
  })
})

describe('with no saved views', () => {
  it('the group offers "Add thesis starter views", which runs once and closes the menu', () => {
    const onAddStarterViews = vi.fn()
    render(<Harness views={[]} onAddStarterViews={onAddStarterViews} />)
    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    fireEvent.click(within(group()).getByRole('menuitem', { name: 'Add thesis starter views' }))
    expect(onAddStarterViews).toHaveBeenCalledTimes(1)
    expect(menu()).toBeNull()
  })

  it('without that door (the list is still loading, or failed) the group is not drawn at all', () => {
    render(<Harness views={[]} onAddStarterViews={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    expect(within(menu()).queryByRole('group', { name: 'Saved views' })).toBeNull()
  })

  it('CONTROL: with views, the starter door is not offered even when handed in', () => {
    openGroup({ onAddStarterViews: vi.fn() })
    expect(within(group()).queryByRole('menuitem', { name: 'Add thesis starter views' })).toBeNull()
  })
})
