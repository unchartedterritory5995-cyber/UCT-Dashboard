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

describe('LayoutDock — unsaved changes', () => {
  const pinned = { pins: [UCT_DEFAULT_ID, 1, 2], known: [UCT_DEFAULT_ID, 1, 2], hidden: false }

  it('shows the dot only on the active layout, and only when dirty', () => {
    mockPrefs = dockPref(pinned)
    const { rerender } = render(<LayoutDock entries={ENTRIES} activeId={1} dirty={false} />)
    expect(screen.queryByLabelText(/^Save changes to/)).toBeNull()
    rerender(<LayoutDock entries={ENTRIES} activeId={1} dirty />)
    expect(screen.getByLabelText('Save changes to Main Trading')).toBeTruthy()
    expect(screen.queryByLabelText('Save changes to Breadth')).toBeNull()
  })

  it('saves when the dot is clicked, without switching layouts', () => {
    mockPrefs = dockPref(pinned)
    const onSave = vi.fn(); const onOpen = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} dirty onSave={onSave} onOpen={onOpen} />)
    fireEvent.click(screen.getByLabelText('Save changes to Main Trading'))
    expect(onSave).toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('holds the switch behind a confirm when the board is dirty', () => {
    mockPrefs = dockPref(pinned)
    const onOpen = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} dirty onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Breadth' }))
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText(/has unsaved changes/)).toBeTruthy()
  })

  it('Save & switch saves first, then opens the layout', () => {
    mockPrefs = dockPref(pinned)
    const calls = []
    const onSave = vi.fn(() => calls.push('save'))
    const onOpen = vi.fn(() => calls.push('open'))
    render(<LayoutDock entries={ENTRIES} activeId={1} dirty onSave={onSave} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Breadth' }))
    fireEvent.click(screen.getByRole('button', { name: /Save & switch/ }))
    expect(calls).toEqual(['save', 'open'])
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  })

  it('Discard switches without saving', () => {
    mockPrefs = dockPref(pinned)
    const onSave = vi.fn(); const onOpen = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} dirty onSave={onSave} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Breadth' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  })

  it('Cancel keeps you where you are', () => {
    mockPrefs = dockPref(pinned)
    const onOpen = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} dirty onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Breadth' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  // A prebuilt layout is not writable by a member, so the confirm must not
  // offer to save into one.
  it('offers no save path for a layout the user cannot write', () => {
    mockPrefs = dockPref(pinned)
    render(<LayoutDock entries={ENTRIES} activeId={1} dirty canSave={false} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Breadth' }))
    expect(screen.queryByRole('button', { name: /Save & switch/ })).toBeNull()
    expect(screen.getByText(/can’t be overwritten/)).toBeTruthy()
  })

  it('switches straight through when the board is clean', () => {
    mockPrefs = dockPref(pinned)
    const onOpen = vi.fn()
    render(<LayoutDock entries={ENTRIES} activeId={1} dirty={false} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Breadth' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  })
})
