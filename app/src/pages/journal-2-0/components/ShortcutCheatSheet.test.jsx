import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShortcutCheatSheet from './ShortcutCheatSheet'

describe('ShortcutCheatSheet', () => {
  it('renders nothing when closed', () => {
    render(<ShortcutCheatSheet open={false} onClose={vi.fn()} />)
    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument()
  })

  it('renders title + the grouped sections when open', () => {
    render(<ShortcutCheatSheet open onClose={vi.fn()} />)
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
    expect(screen.getByText('Navigation')).toBeInTheDocument()
    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.getByText('Open Positions')).toBeInTheDocument()
    expect(screen.getByText('Trade Journal')).toBeInTheDocument()
  })

  it('documents every current g> navigation chord', () => {
    render(<ShortcutCheatSheet open onClose={vi.fn()} />)
    for (const label of [
      'Go to Today',
      'Go to Open Positions',
      'Go to Closed Trades',
      'Go to Calendar',
      'Go to Notebook',
      'Go to Insights',
      'Go to Accounts',
      'Go to Compass',
      'Go to Community',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('lists the cheat-sheet toggle + the in-tab actions', () => {
    render(<ShortcutCheatSheet open onClose={vi.fn()} />)
    expect(screen.getByText('Show this cheat sheet')).toBeInTheDocument()
    expect(screen.getByText('Add Position')).toBeInTheDocument()
    expect(screen.getByText('Add Trade')).toBeInTheDocument()
  })

  it('Wave B: documents the Notebook section (command palette + find-in-note)', () => {
    render(<ShortcutCheatSheet open onClose={vi.fn()} />)
    expect(screen.getByText('Notebook')).toBeInTheDocument()
    expect(screen.getByText(/Open command palette/)).toBeInTheDocument()
    expect(screen.getByText('Find in the current note')).toBeInTheDocument()
  })

  it('wave 5: documents the quick switcher (jump to any note by title)', () => {
    render(<ShortcutCheatSheet open onClose={vi.fn()} />)
    expect(screen.getByText('Jump to any note: type part of its title, then Enter')).toBeInTheDocument()
  })

  it('wave 5: documents selecting notes in bulk (Shift+click range, Esc clears)', () => {
    render(<ShortcutCheatSheet open onClose={vi.fn()} />)
    expect(screen.getByText('Select every note between the last one checked and this one')).toBeInTheDocument()
    expect(screen.getByText('Clear the selected notes')).toBeInTheDocument()
  })

  it('renders g-then-<key> keycaps for each navigation chord', () => {
    render(<ShortcutCheatSheet open onClose={vi.fn()} />)
    // Nine two-key nav chords → at least nine leading "g" keycaps + "then" links.
    expect(screen.getAllByText('g').length).toBeGreaterThanOrEqual(9)
    expect(screen.getAllByText('then').length).toBeGreaterThanOrEqual(9)
  })

  it('Esc closes', () => {
    const onClose = vi.fn()
    render(<ShortcutCheatSheet open onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('backdrop click closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { container } = render(<ShortcutCheatSheet open onClose={onClose} />)
    await user.click(container.firstChild)
    expect(onClose).toHaveBeenCalled()
  })
})

// A2R-04 (a11y second review, 2026-10-01): the dialog had no initial focus, no
// trap and no restore-on-close -- Tab walked straight out into the page
// behind it, and closing left focus wherever it fell (usually <body>). This
// mirrors ConfirmModal's own "keyboard (F4, A2R-05)" block, adapted for a
// component that stays mounted with `open` toggling rather than being
// conditionally rendered by its caller.
function Page() {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Open shortcuts</button>
      <button type="button">Something else on the page</button>
      <ShortcutCheatSheet open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

describe('ShortcutCheatSheet — keyboard (A2R-04)', () => {
  it('Enter on the opener button opens the dialog with focus on Close', async () => {
    const user = userEvent.setup()
    render(<Page />)
    screen.getByRole('button', { name: 'Open shortcuts' }).focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' })))
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('Tab and Shift+Tab stay on the dialog\'s one focusable control (the trap)', async () => {
    const user = userEvent.setup()
    render(<Page />)
    screen.getByRole('button', { name: 'Open shortcuts' }).focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })
    const closeBtn = screen.getByRole('button', { name: 'Close' })
    await waitFor(() => expect(document.activeElement).toBe(closeBtn))
    for (let i = 0; i < 3; i += 1) {
      await user.tab()
      expect(document.activeElement).toBe(closeBtn)
    }
    for (let i = 0; i < 3; i += 1) {
      await user.tab({ shift: true })
      expect(document.activeElement).toBe(closeBtn)
    }
  })

  it('Escape closes it and returns focus to the button that opened it', async () => {
    const user = userEvent.setup()
    render(<Page />)
    const opener = screen.getByRole('button', { name: 'Open shortcuts' })
    opener.focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it('the X button also closes it and restores focus to the opener', async () => {
    const user = userEvent.setup()
    render(<Page />)
    const opener = screen.getByRole('button', { name: 'Open shortcuts' })
    await user.click(opener)
    await screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it('a re-render of the page behind it does not pull focus back to Close', async () => {
    const onClose = vi.fn()
    // A real, focusable element outside the dialog to prove focus STAYS where
    // a caller (or the member) put it on purpose, across a re-render — the
    // dialog itself offers nothing else to Tab to.
    const elsewhere = document.createElement('button')
    elsewhere.textContent = 'elsewhere'
    document.body.appendChild(elsewhere)
    const { rerender } = render(<ShortcutCheatSheet open onClose={() => onClose()} />)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' })))
    // Nothing else focusable INSIDE the dialog to Tab to, but a stray
    // re-render with a FRESH onClose arrow (every real caller passes one)
    // must not re-run the open-transition effect and yank focus back.
    elsewhere.focus()
    expect(document.activeElement).toBe(elsewhere)
    rerender(<ShortcutCheatSheet open onClose={() => onClose()} />)
    rerender(<ShortcutCheatSheet open onClose={() => onClose()} />)
    expect(document.activeElement).toBe(elsewhere)
    // and Escape still reaches the LATEST onClose
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    elsewhere.remove()
  })
})

// Wave 5 fix round 1 (N8): the editor's chords are listed, for the member's
// own keyboard.
describe('ShortcutCheatSheet — Notebook editor chords, per platform', () => {
  const keysOf = (label) => within(screen.getByText(label).closest('li')).getAllByText((_, el) => el.tagName === 'KBD').map((k) => k.textContent)
  const setPlatform = (value) => Object.defineProperty(navigator, 'platform', { value, configurable: true })
  afterEach(() => { delete navigator.platform })

  it.each([
    ['MacIntel', { replace: ['Cmd', 'Option', 'F'], hl: ['Cmd', 'Shift', 'H'], heading: ['Cmd', 'Option', '1–6'], code: ['Cmd', 'Option', 'L'], find: ['Cmd', 'F'] }],
    ['Win32', { replace: ['Ctrl', 'H'], hl: ['Ctrl', 'Shift', 'H'], heading: ['Ctrl', 'Alt', '1–6'], code: ['Ctrl', 'Alt', 'L'], find: ['Ctrl', 'F'] }],
  ])('on %s', (platform, want) => {
    setPlatform(platform)
    render(<ShortcutCheatSheet open onClose={vi.fn()} />)
    expect(keysOf('Find and replace in the current note')).toEqual(want.replace)
    expect(keysOf('Highlight the selection')).toEqual(want.hl)
    expect(keysOf('Make the line a heading of that level (1–6)')).toEqual(want.heading)
    expect(keysOf("Choose a code block's language (inside a code block)")).toEqual(want.code)
    expect(keysOf('Find in the current note')).toEqual(want.find)
  })
})

// Wave 5 final round (review N9): keys pressed TOGETHER read "Ctrl + Shift + H";
// "then" is kept for true SEQUENCES (g, then o). The renderer put "then"
// between every key, so a chord read as a sequence.
describe('ShortcutCheatSheet — a chord reads as a chord, a sequence as a sequence', () => {
  const setPlatform = (value) => Object.defineProperty(navigator, 'platform', { value, configurable: true })
  afterEach(() => { delete navigator.platform })
  const keysText = (label) => {
    const li = screen.getByText(label).closest('li')
    return li.textContent.slice(label.length)
  }

  it('renders the rendered TEXT of chords and sequences', () => {
    setPlatform('Win32')
    render(<ShortcutCheatSheet open onClose={vi.fn()} />)
    expect(keysText('Highlight the selection')).toBe('Ctrl + Shift + H')
    expect(keysText('Capture the hovered chart to your Notebook inbox')).toBe('Ctrl + Alt + J')
    expect(keysText('Make the line a heading of that level (1–6)')).toBe('Ctrl + Alt + 1–6')
    expect(keysText('Find and replace in the current note')).toBe('Ctrl + H')
    expect(keysText('Select every note between the last one checked and this one')).toBe('Shift + Click')
    expect(keysText('Go to Today')).toBe('g then o')
    expect(keysText('Go to Community')).toBe('g then c')
    expect(keysText('Show this cheat sheet')).toBe('?')
  })

  it('"then" appears only between the keys of a sequence', () => {
    setPlatform('MacIntel')
    render(<ShortcutCheatSheet open onClose={vi.fn()} />)
    const thenRows = screen.getAllByText('then').map((el) => el.closest('li').textContent)
    expect(thenRows.length).toBe(9)                                   // the nine g-sequences
    expect(thenRows.every((t) => /^Go to .+g then [a-z]$/.test(t))).toBe(true)
    expect(keysText('Find and replace in the current note')).toBe('Cmd + Option + F')
  })
})

// Wave 8 (lane 8A, ruling D-A3): the graph canvas's keys are on the ONE list,
// in the member's own keyboard's words -- a Mac has no Home or End key.
describe('ShortcutCheatSheet -- the graph canvas keys', () => {
  const setPlatform = (value) => Object.defineProperty(navigator, 'platform', { value, configurable: true })
  afterEach(() => { delete navigator.platform })
  const keysText = (label) => {
    const li = screen.getByText(label).closest('li')
    return li.textContent.slice(label.length)
  }

  it.each([
    ['Win32', 'Home', 'End'],
    ['MacIntel', 'Fn + ←', 'Fn + →'],
  ])('on %s', (platform, home, end) => {
    setPlatform(platform)
    render(<ShortcutCheatSheet open onClose={vi.fn()} />)
    expect(keysText('Graph view: move to the nearest note in that direction')).toBe('Arrow keys')
    expect(keysText('Graph view: go to the first note by title')).toBe(home)
    expect(keysText('Graph view: go to the last note by title')).toBe(end)
    expect(keysText('Graph view: open the selected note')).toBe('Enter')
    expect(keysText('Graph view: clear the selected note')).toBe('Esc')
    // the way out of a table, in the member's own keyboard's words
    expect(keysText('In a table: move to the table toolbar (Esc returns to the cell)'))
      .toBe(platform === 'MacIntel' ? 'Option + F10' : 'Alt + F10')
  })
})
