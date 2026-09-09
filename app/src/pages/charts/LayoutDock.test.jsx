import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import LayoutDock from './LayoutDock'
import { reconcilePins, arrangementSig, UCT_DEFAULT_ID } from './layoutDockPins'

// The dock owns its pin order through usePreferences; everything else about it
// is driven by props, so one prefs stub covers the whole component.
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

beforeEach(() => { mockPrefs = {}; setPref.mockClear() })

describe('reconcilePins', () => {
  it('seeds every layout on the first run, in list order', () => {
    expect(reconcilePins(null, ENTRIES)).toEqual({
      pins: [UCT_DEFAULT_ID, 1, 2], known: [UCT_DEFAULT_ID, 1, 2], hidden: false,
    })
  })

  it('drops a deleted layout from both lists', () => {
    const stored = { pins: [UCT_DEFAULT_ID, 1, 2], known: [UCT_DEFAULT_ID, 1, 2], hidden: false }
    const after = reconcilePins(stored, ENTRIES.filter(e => e.id !== 1))
    expect(after.pins).toEqual([UCT_DEFAULT_ID, 2])
    expect(after.known).toEqual([UCT_DEFAULT_ID, 2])
  })

  it('appends a newly saved layout to the end of the bar', () => {
    const stored = { pins: [UCT_DEFAULT_ID, 1], known: [UCT_DEFAULT_ID, 1], hidden: false }
    expect(reconcilePins(stored, ENTRIES).pins).toEqual([UCT_DEFAULT_ID, 1, 2])
  })

  // The whole point of `known`: an unpinned layout still EXISTS, so without it
  // "append anything not pinned" would silently re-pin it on the next load.
  it('never re-pins a layout the user unpinned', () => {
    const stored = { pins: [UCT_DEFAULT_ID, 1], known: [UCT_DEFAULT_ID, 1, 2], hidden: false }
    expect(reconcilePins(stored, ENTRIES).pins).toEqual([UCT_DEFAULT_ID, 1])
  })

  it('preserves a user-chosen order rather than the list order', () => {
    const stored = { pins: [2, 1, UCT_DEFAULT_ID], known: [UCT_DEFAULT_ID, 1, 2], hidden: false }
    expect(reconcilePins(stored, ENTRIES).pins).toEqual([2, 1, UCT_DEFAULT_ID])
  })
})

describe('LayoutDock', () => {
  it('renders pinned layouts in stored order', () => {
    mockPrefs = dockPref({ pins: [2, 1, UCT_DEFAULT_ID], known: [UCT_DEFAULT_ID, 1, 2], hidden: false })
    render(<LayoutDock entries={ENTRIES} activeId={1} />)
    const names = screen.getAllByRole('button')
      .map(b => b.textContent.trim())
      .filter(t => ['Breadth', 'Main Trading', 'UCT Default'].includes(t))
    expect(names).toEqual(['Breadth', 'Main Trading', 'UCT Default'])
  })

  it('marks the open layout as current', () => {
    mockPrefs = dockPref({ pins: [UCT_DEFAULT_ID, 1, 2], known: [UCT_DEFAULT_ID, 1, 2], hidden: false })
    render(<LayoutDock entries={ENTRIES} activeId={2} />)
    expect(screen.getByRole('button', { name: 'Breadth' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Main Trading' })).not.toHaveAttribute('aria-current')
  })

  it('opens a layout on click', () => {
    mockPrefs = dockPref({ pins: [UCT_DEFAULT_ID, 1, 2], known: [UCT_DEFAULT_ID, 1, 2], hidden: false })
    const onOpen = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Breadth' }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  })

  // Re-opening the layout you are in would reload the board and throw away
  // whatever you changed since — the one click that must do nothing.
  it('does nothing when the open layout is clicked again', () => {
    mockPrefs = dockPref({ pins: [UCT_DEFAULT_ID, 1, 2], known: [UCT_DEFAULT_ID, 1, 2], hidden: false })
    const onOpen = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Main Trading' }))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('creates a layout from the inline name field', () => {
    mockPrefs = dockPref({ pins: [UCT_DEFAULT_ID], known: [UCT_DEFAULT_ID], hidden: false })
    const onCreate = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={UCT_DEFAULT_ID} onCreate={onCreate} />)
    fireEvent.click(screen.getByLabelText('New layout'))
    const input = screen.getByLabelText('New layout name')
    fireEvent.change(input, { target: { value: 'Earnings' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCreate).toHaveBeenCalledWith('Earnings')
  })

  it('abandons the name on Escape without creating anything', () => {
    mockPrefs = dockPref({ pins: [UCT_DEFAULT_ID], known: [UCT_DEFAULT_ID], hidden: false })
    const onCreate = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={UCT_DEFAULT_ID} onCreate={onCreate} />)
    fireEvent.click(screen.getByLabelText('New layout'))
    const input = screen.getByLabelText('New layout name')
    fireEvent.change(input, { target: { value: 'Scratch' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('New layout name')).toBeNull()
  })

  it('reaches an unpinned layout through the ⋯ browser', () => {
    mockPrefs = dockPref({ pins: [UCT_DEFAULT_ID, 1], known: [UCT_DEFAULT_ID, 1, 2], hidden: false })
    const onOpen = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} onOpen={onOpen} />)
    expect(screen.queryByRole('button', { name: 'Breadth' })).toBeNull()
    fireEvent.click(screen.getByLabelText('All layouts'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Breadth' }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  })

  it('renders nothing when the bar is hidden', () => {
    mockPrefs = dockPref({ pins: [UCT_DEFAULT_ID, 1], known: [UCT_DEFAULT_ID, 1], hidden: true })
    const { container } = render(<LayoutDock entries={ENTRIES} activeId={1} />)
    expect(container.firstChild).toBeNull()
  })

  it('persists the seeded pin order on a first run', () => {
    render(<LayoutDock entries={ENTRIES} activeId={UCT_DEFAULT_ID} />)
    expect(setPref).toHaveBeenCalledWith(
      'charts_layout_dock',
      JSON.stringify({ pins: [UCT_DEFAULT_ID, 1, 2], known: [UCT_DEFAULT_ID, 1, 2], hidden: false }),
    )
  })

  // A write loop here would hammer the prefs queue on every render.
  it('does not rewrite the pref when nothing changed', () => {
    mockPrefs = dockPref({ pins: [UCT_DEFAULT_ID, 1, 2], known: [UCT_DEFAULT_ID, 1, 2], hidden: false })
    render(<LayoutDock entries={ENTRIES} activeId={1} />)
    expect(setPref).not.toHaveBeenCalled()
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

  // The false-dirty guard: everything a template carries BESIDES the arrangement
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

describe('LayoutDock — new layout appears instantly', () => {
  // The POST + its round-trip used to happen before the name could show up,
  // which read as the app being slow. The typed name is rendered immediately.
  it('shows the typed name before the API has returned the row', () => {
    mockPrefs = dockPref({ pins: [UCT_DEFAULT_ID], known: [UCT_DEFAULT_ID], hidden: false })
    const onCreate = vi.fn()
    render(<LayoutDock entries={ENTRIES.slice(0, 1)} activeId={UCT_DEFAULT_ID} onCreate={onCreate} />)
    fireEvent.click(screen.getByLabelText('New layout'))
    const input = screen.getByLabelText('New layout name')
    fireEvent.change(input, { target: { value: 'Earnings' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCreate).toHaveBeenCalledWith('Earnings')
    expect(screen.getByRole('button', { name: 'Earnings' })).toBeTruthy()
  })

  it('hands over to the real row once it arrives, without duplicating it', () => {
    mockPrefs = dockPref({ pins: [UCT_DEFAULT_ID], known: [UCT_DEFAULT_ID], hidden: false })
    const { rerender } = render(<LayoutDock entries={ENTRIES.slice(0, 1)} activeId={UCT_DEFAULT_ID} onCreate={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('New layout'))
    const input = screen.getByLabelText('New layout name')
    fireEvent.change(input, { target: { value: 'Earnings' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const withRow = [...ENTRIES.slice(0, 1), { id: 9, name: 'Earnings', scope: 'user' }]
    mockPrefs = dockPref({ pins: [UCT_DEFAULT_ID, 9], known: [UCT_DEFAULT_ID, 9], hidden: false })
    rerender(<LayoutDock entries={withRow} activeId={9} onCreate={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: 'Earnings' })).toHaveLength(1)
  })
})

describe('LayoutDock — right-click menu', () => {
  const pinned = { pins: [UCT_DEFAULT_ID, 1, 2], known: [UCT_DEFAULT_ID, 1, 2], hidden: false }
  const openMenu = (name) => fireEvent.contextMenu(screen.getByRole('button', { name }))

  it('opens on right-click with the move / duplicate / delete actions', () => {
    mockPrefs = dockPref(pinned)
    render(<LayoutDock entries={ENTRIES} activeId={1} />)
    openMenu('Main Trading')
    expect(screen.getByRole('menu', { name: 'Main Trading actions' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Move left/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Move right/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Duplicate layout' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Delete layout' })).toBeTruthy()
  })

  it('moves a layout left in the bar and persists the order', () => {
    mockPrefs = dockPref(pinned)
    render(<LayoutDock entries={ENTRIES} activeId={1} />)
    openMenu('Main Trading')
    fireEvent.click(screen.getByRole('menuitem', { name: /Move left/ }))
    expect(setPref).toHaveBeenCalledWith(
      'charts_layout_dock',
      JSON.stringify({ pins: [1, UCT_DEFAULT_ID, 2], known: [UCT_DEFAULT_ID, 1, 2], hidden: false }),
    )
  })

  it('moves a layout right', () => {
    mockPrefs = dockPref(pinned)
    render(<LayoutDock entries={ENTRIES} activeId={1} />)
    openMenu('Main Trading')
    fireEvent.click(screen.getByRole('menuitem', { name: /Move right/ }))
    expect(setPref).toHaveBeenCalledWith(
      'charts_layout_dock',
      JSON.stringify({ pins: [UCT_DEFAULT_ID, 2, 1], known: [UCT_DEFAULT_ID, 1, 2], hidden: false }),
    )
  })

  it('cannot move the first layout left or the last one right', () => {
    mockPrefs = dockPref(pinned)
    render(<LayoutDock entries={ENTRIES} activeId={1} />)
    openMenu('UCT Default')
    expect(screen.getByRole('menuitem', { name: /Move left/ })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    openMenu('Breadth')
    expect(screen.getByRole('menuitem', { name: /Move right/ })).toBeDisabled()
  })

  it('duplicates a layout', () => {
    mockPrefs = dockPref(pinned)
    const onDuplicate = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} onDuplicate={onDuplicate} />)
    openMenu('Breadth')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate layout' }))
    expect(onDuplicate).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  })

  // A stray click must never destroy a layout.
  it('needs two clicks to delete', () => {
    mockPrefs = dockPref(pinned)
    const onDelete = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} onDelete={onDelete} />)
    openMenu('Breadth')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete layout' }))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Click again to delete' }))
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  })

  it('offers Save only for the layout you are actually in', () => {
    mockPrefs = dockPref(pinned)
    render(<LayoutDock entries={ENTRIES} activeId={1} onSave={vi.fn()} />)
    openMenu('Breadth')
    expect(screen.queryByRole('menuitem', { name: 'Save layout' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    openMenu('Main Trading')
    expect(screen.getByRole('menuitem', { name: 'Save layout' })).toBeTruthy()
  })

  // A prebuilt row is what every member sees; the frozen default is not a row.
  it('will not offer to delete a prebuilt layout to a member', () => {
    const withPrebuilt = [...ENTRIES, { id: 7, name: 'Firm Board', scope: 'global' }]
    mockPrefs = dockPref({ pins: [UCT_DEFAULT_ID, 1, 2, 7], known: [UCT_DEFAULT_ID, 1, 2, 7], hidden: false })
    render(<LayoutDock entries={withPrebuilt} activeId={1} isAdmin={false} />)
    openMenu('Firm Board')
    expect(screen.queryByRole('menuitem', { name: 'Delete layout' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Duplicate layout' })).toBeTruthy()
  })

  it('will not offer to delete the frozen UCT Default', () => {
    mockPrefs = dockPref(pinned)
    render(<LayoutDock entries={ENTRIES} activeId={1} isAdmin />)
    openMenu('UCT Default')
    expect(screen.queryByRole('menuitem', { name: 'Delete layout' })).toBeNull()
  })
})
