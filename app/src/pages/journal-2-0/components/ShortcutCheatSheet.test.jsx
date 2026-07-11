import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
