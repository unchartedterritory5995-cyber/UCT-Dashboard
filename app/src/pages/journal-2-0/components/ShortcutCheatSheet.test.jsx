import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
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
