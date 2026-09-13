import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import LayoutDock from './LayoutDock'
import {
  reconcilePins, arrangementSig, movePin, removePin, addPin, UCT_DEFAULT_ID,
} from './layoutDockPins'

// The dock owns the RAIL through usePreferences; the library comes in as props,
// so one prefs stub covers the whole component.
let mockPrefs = {}
const setPref = vi.fn((k, v) => { mockPrefs = { ...mockPrefs, [k]: v } })

vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, loading: false }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
}))

const ENTRIES = [
  { id: UCT_DEFAULT_ID, name: 'UCT Default', scope: 'global' },
  { id: 1, name: 'Main Trading', scope: 'user' },
  { id: 2, name: 'Breadth', scope: 'user' },
]

const dockPref = (o) => ({ charts_layout_dock: JSON.stringify(o) })
const RAIL = { pins: [UCT_DEFAULT_ID, 1, 2], known: [UCT_DEFAULT_ID, 1, 2], hidden: false }

const openLibrary = () => fireEvent.click(screen.getByLabelText('Layout library'))
const openMenu = (name) => fireEvent.contextMenu(screen.getByRole('button', { name }))

beforeEach(() => { mockPrefs = {}; setPref.mockClear() })

describe('rail bookkeeping', () => {
  it('seeds every layout on the first run, in list order', () => {
    expect(reconcilePins(null, ENTRIES)).toEqual({
      pins: [UCT_DEFAULT_ID, 1, 2], known: [UCT_DEFAULT_ID, 1, 2], hidden: false,
    })
  })

  it('drops a deleted layout from the rail', () => {
    const after = reconcilePins(RAIL, ENTRIES.filter(e => e.id !== 1))
    expect(after.pins).toEqual([UCT_DEFAULT_ID, 2])
  })

  it('appends a newly saved layout to the end of the rail', () => {
    const stored = { pins: [UCT_DEFAULT_ID, 1], known: [UCT_DEFAULT_ID, 1], hidden: false }
    expect(reconcilePins(stored, ENTRIES).pins).toEqual([UCT_DEFAULT_ID, 1, 2])
  })

  // `known` is why closing something off the rail sticks: the layout still
  // EXISTS in the library, so "append anything not on the rail" would put it
  // straight back on the next load.
  it('never re-adds a layout the user closed', () => {
    const stored = { pins: [UCT_DEFAULT_ID, 1], known: [UCT_DEFAULT_ID, 1, 2], hidden: false }
    expect(reconcilePins(stored, ENTRIES).pins).toEqual([UCT_DEFAULT_ID, 1])
  })

  it('preserves a user-chosen order rather than the list order', () => {
    const stored = { pins: [2, 1, UCT_DEFAULT_ID], known: [UCT_DEFAULT_ID, 1, 2], hidden: false }
    expect(reconcilePins(stored, ENTRIES).pins).toEqual([2, 1, UCT_DEFAULT_ID])
  })

  // The rail is positional: one layout may occupy several slots.
  it('keeps duplicate slots pointing at the same layout', () => {
    const stored = { pins: [1, 2, 1], known: [UCT_DEFAULT_ID, 1, 2], hidden: false }
    expect(reconcilePins(stored, ENTRIES).pins).toEqual([1, 2, 1])
  })

  it('moves, removes and adds BY SLOT, not by layout id', () => {
    expect(movePin([1, 2, 1], 2, -1)).toEqual([1, 1, 2])
    expect(removePin([1, 2, 1], 0)).toEqual([2, 1])       // only the first slot
    expect(addPin([1, 2], 1)).toEqual([1, 2, 1])          // duplicates allowed
    expect(movePin([1, 2], 0, -1)).toEqual([1, 2])        // off the end = no-op
    expect(removePin([1, 2], 9)).toEqual([1, 2])
  })
})

describe('arrangementSig', () => {
  const board = { cols: 24, widgets: [
    { id: 'a', type: 'chart', x: 0, y: 0, w: 12, h: 10 },
    { id: 'b', type: 'watchlist', x: 12, y: 0, w: 12, h: 10 },
  ] }

  it('ignores widget order', () => {
    const flipped = { ...board, widgets: [board.widgets[1], board.widgets[0]] }
    expect(arrangementSig(flipped)).toBe(arrangementSig(board))
  })

  // The false-dirty guard: everything a layout carries BESIDES the arrangement
  // is rewritten by ordinary use, so none of it may move the signature.
  it('ignores chart settings, columns and per-widget opts', () => {
    const noisy = {
      ...board,
      chartSettings: '{"candleUp":"#0f0"}',
      watchlistColumns: { mktcap: 1 },
      widgets: board.widgets.map(w => ({ ...w, color: 'B', opts: { tf: '5' } })),
    }
    expect(arrangementSig(noisy)).toBe(arrangementSig(board))
  })

  it('sees a moved widget, a resized widget and an added widget', () => {
    const moved = { ...board, widgets: [{ ...board.widgets[0], x: 4 }, board.widgets[1]] }
    const resized = { ...board, widgets: [{ ...board.widgets[0], h: 14 }, board.widgets[1]] }
    const added = { ...board, widgets: [...board.widgets, { id: 'c', type: 'news', x: 0, y: 10, w: 6, h: 6 }] }
    expect(arrangementSig(moved)).not.toBe(arrangementSig(board))
    expect(arrangementSig(resized)).not.toBe(arrangementSig(board))
    expect(arrangementSig(added)).not.toBe(arrangementSig(board))
  })

  it('survives a layout with no widgets', () => {
    expect(arrangementSig(null)).toBe('|')
    expect(arrangementSig({ cols: 24, widgets: [] })).toBe('24|')
  })
})

describe('LayoutDock — the rail', () => {
  it('renders its slots in stored order', () => {
    mockPrefs = dockPref({ pins: [2, 1, UCT_DEFAULT_ID], known: [UCT_DEFAULT_ID, 1, 2], hidden: false })
    render(<LayoutDock entries={ENTRIES} activeId={1} />)
    const names = screen.getAllByRole('button')
      .map(b => b.textContent.trim())
      .filter(t => ['Breadth', 'Main Trading', 'UCT Default'].includes(t))
    expect(names).toEqual(['Breadth', 'Main Trading', 'UCT Default'])
  })

  it('marks the open layout as current', () => {
    mockPrefs = dockPref(RAIL)
    render(<LayoutDock entries={ENTRIES} activeId={2} />)
    expect(screen.getByRole('button', { name: 'Breadth' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Main Trading' })).not.toHaveAttribute('aria-current')
  })

  it('opens a layout on click', () => {
    mockPrefs = dockPref(RAIL)
    const onOpen = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Breadth' }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  })

  // Re-opening the layout you are in would reload the board and throw away
  // whatever you changed since — the one click that must do nothing.
  it('does nothing when the open layout is clicked again', () => {
    mockPrefs = dockPref(RAIL)
    const onOpen = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Main Trading' }))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('renders nothing when the bar is hidden', () => {
    mockPrefs = dockPref({ ...RAIL, hidden: true })
    const { container } = render(<LayoutDock entries={ENTRIES} activeId={1} />)
    expect(container.firstChild).toBeNull()
  })

  it('persists the seeded rail on a first run', () => {
    render(<LayoutDock entries={ENTRIES} activeId={UCT_DEFAULT_ID} />)
    expect(setPref).toHaveBeenCalledWith('charts_layout_dock', JSON.stringify(RAIL))
  })

  // A write loop here would hammer the prefs queue on every render.
  it('does not rewrite the pref when nothing changed', () => {
    mockPrefs = dockPref(RAIL)
    render(<LayoutDock entries={ENTRIES} activeId={1} />)
    expect(setPref).not.toHaveBeenCalled()
  })
})

describe('LayoutDock — the layout library', () => {
  it('lists your layouts, and the prebuilt ones separately', () => {
    mockPrefs = dockPref(RAIL)
    render(<LayoutDock entries={ENTRIES} activeId={1} />)
    openLibrary()
    expect(screen.getByRole('menu', { name: 'Layout library' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Main Trading' })).toBeTruthy()
    expect(screen.getByText('Prebuilt')).toBeTruthy()
  })

  // The point of the library: put a layout on the bar. Adding one that is
  // ALREADY out there is allowed — the rail is positional, not a set.
  it('adds a layout to the bar even when it is already there', () => {
    mockPrefs = dockPref(RAIL)
    render(<LayoutDock entries={ENTRIES} activeId={1} onOpen={vi.fn()} />)
    openLibrary()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Breadth' }))
    expect(setPref).toHaveBeenCalledWith(
      'charts_layout_dock',
      JSON.stringify({ pins: [UCT_DEFAULT_ID, 1, 2, 2], known: [UCT_DEFAULT_ID, 1, 2], hidden: false }),
    )
  })

  it('opens the layout it just added', () => {
    mockPrefs = dockPref({ pins: [UCT_DEFAULT_ID], known: [UCT_DEFAULT_ID, 1, 2], hidden: false })
    const onOpen = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={UCT_DEFAULT_ID} onOpen={onOpen} />)
    openLibrary()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Breadth' }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  })

  it('makes a brand-new layout from the library, named inline', () => {
    mockPrefs = dockPref(RAIL)
    const onCreate = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} onCreate={onCreate} />)
    openLibrary()
    fireEvent.click(screen.getByRole('menuitem', { name: '＋ New layout' }))
    const input = screen.getByLabelText('New layout name')
    fireEvent.change(input, { target: { value: 'Earnings' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCreate).toHaveBeenCalledWith('Earnings')
    // and it is on the bar before the POST has come back
    expect(screen.getByRole('button', { name: 'Earnings' })).toBeTruthy()
  })

  it('hands the provisional name over to the real row without duplicating it', () => {
    mockPrefs = dockPref({ pins: [UCT_DEFAULT_ID], known: [UCT_DEFAULT_ID], hidden: false })
    const { rerender } = render(<LayoutDock entries={ENTRIES.slice(0, 1)} activeId={UCT_DEFAULT_ID} onCreate={vi.fn()} />)
    openLibrary()
    fireEvent.click(screen.getByRole('menuitem', { name: '＋ New layout' }))
    const input = screen.getByLabelText('New layout name')
    fireEvent.change(input, { target: { value: 'Earnings' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const withRow = [...ENTRIES.slice(0, 1), { id: 9, name: 'Earnings', scope: 'user' }]
    mockPrefs = dockPref({ pins: [UCT_DEFAULT_ID, 9], known: [UCT_DEFAULT_ID, 9], hidden: false })
    rerender(<LayoutDock entries={withRow} activeId={9} onCreate={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: 'Earnings' })).toHaveLength(1)
  })

  // ⭐ The library is the ONLY place a layout can be destroyed.
  it('deletes from the library, behind a confirm', () => {
    mockPrefs = dockPref(RAIL)
    const onDelete = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} onDelete={onDelete} />)
    openLibrary()
    fireEvent.click(screen.getByLabelText('Delete Breadth permanently'))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete?' }))
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  })

  it('offers no delete for a prebuilt layout', () => {
    mockPrefs = dockPref(RAIL)
    render(<LayoutDock entries={ENTRIES} activeId={1} onDelete={vi.fn()} />)
    openLibrary()
    expect(screen.queryByLabelText('Delete UCT Default permanently')).toBeNull()
  })
})

describe('LayoutDock — the rail menu', () => {
  // ⛔ THE CONTRACT: the rail can never destroy a layout. Closing a slot takes
  // it off the bar; the layout is still in the library.
  it('offers Close and never Delete', () => {
    mockPrefs = dockPref(RAIL)
    render(<LayoutDock entries={ENTRIES} activeId={1} />)
    openMenu('Main Trading')
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull()
  })

  it('closing a slot only takes it off the bar', () => {
    mockPrefs = dockPref(RAIL)
    const onDelete = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} onDelete={onDelete} />)
    openMenu('Breadth')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(setPref).toHaveBeenCalledWith(
      'charts_layout_dock',
      JSON.stringify({ pins: [UCT_DEFAULT_ID, 1], known: [UCT_DEFAULT_ID, 1, 2], hidden: false }),
    )
  })

  // With duplicate slots, closing must remove the SLOT you right-clicked.
  it('closes the slot you clicked, not every copy of that layout', () => {
    mockPrefs = dockPref({ pins: [1, 2, 1], known: [UCT_DEFAULT_ID, 1, 2], hidden: false })
    render(<LayoutDock entries={ENTRIES} activeId={2} />)
    const both = screen.getAllByRole('button', { name: 'Main Trading' })
    fireEvent.contextMenu(both[1])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close' }))
    expect(setPref).toHaveBeenCalledWith(
      'charts_layout_dock',
      JSON.stringify({ pins: [1, 2], known: [UCT_DEFAULT_ID, 1, 2], hidden: false }),
    )
  })

  it('moves a slot left', () => {
    mockPrefs = dockPref(RAIL)
    render(<LayoutDock entries={ENTRIES} activeId={1} />)
    openMenu('Main Trading')
    fireEvent.click(screen.getByRole('menuitem', { name: /Move left/ }))
    expect(setPref).toHaveBeenCalledWith(
      'charts_layout_dock',
      JSON.stringify({ pins: [1, UCT_DEFAULT_ID, 2], known: [UCT_DEFAULT_ID, 1, 2], hidden: false }),
    )
  })

  it('cannot move the first slot left or the last one right', () => {
    mockPrefs = dockPref(RAIL)
    render(<LayoutDock entries={ENTRIES} activeId={1} />)
    openMenu('UCT Default')
    expect(screen.getByRole('menuitem', { name: /Move left/ })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    openMenu('Breadth')
    expect(screen.getByRole('menuitem', { name: /Move right/ })).toBeDisabled()
  })

  it('saves the open layout to the library on demand', () => {
    mockPrefs = dockPref(RAIL)
    const onSave = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} onSave={onSave} />)
    openMenu('Main Trading')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save layout to library' }))
    expect(onSave).toHaveBeenCalled()
  })

  it('offers Save only for the layout you are actually in', () => {
    mockPrefs = dockPref(RAIL)
    render(<LayoutDock entries={ENTRIES} activeId={1} onSave={vi.fn()} />)
    openMenu('Breadth')
    expect(screen.queryByRole('menuitem', { name: 'Save layout to library' })).toBeNull()
  })

  it('duplicates a layout', () => {
    mockPrefs = dockPref(RAIL)
    const onDuplicate = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} onDuplicate={onDuplicate} />)
    openMenu('Breadth')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate layout' }))
    expect(onDuplicate).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  })

  it('renames in place', () => {
    mockPrefs = dockPref(RAIL)
    const onRename = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} onRename={onRename} />)
    openMenu('Main Trading')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename layout' }))
    const input = screen.getByLabelText('Rename Main Trading')
    expect(input.value).toBe('Main Trading')
    fireEvent.change(input, { target: { value: 'Day Trading' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith(1, 'Day Trading')
  })

  it('Escape leaves the name alone', () => {
    mockPrefs = dockPref(RAIL)
    const onRename = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} onRename={onRename} />)
    openMenu('Main Trading')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename layout' }))
    const input = screen.getByLabelText('Rename Main Trading')
    fireEvent.change(input, { target: { value: 'Nope' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Main Trading' })).toBeTruthy()
  })

  it('does not offer rename on a prebuilt to a member', () => {
    mockPrefs = dockPref(RAIL)
    render(<LayoutDock entries={ENTRIES} activeId={1} isAdmin={false} />)
    openMenu('UCT Default')
    expect(screen.queryByRole('menuitem', { name: 'Rename layout' })).toBeNull()
  })
})
