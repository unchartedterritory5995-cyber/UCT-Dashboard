import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShortcutCheatSheet from './ShortcutCheatSheet'

describe('ShortcutCheatSheet', () => {
  it('renders nothing when closed', () => {
    render(<ShortcutCheatSheet open={false} onClose={vi.fn()} />)
    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument()
  })

  it('renders title + three sections when open', () => {
    render(<ShortcutCheatSheet open onClose={vi.fn()} />)
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
    expect(screen.getByText('Global')).toBeInTheDocument()
    expect(screen.getByText('Open Positions tab')).toBeInTheDocument()
    expect(screen.getByText('Trade Journal tab')).toBeInTheDocument()
  })

  it('shows tab navigation chords', () => {
    render(<ShortcutCheatSheet open onClose={vi.fn()} />)
    expect(screen.getByText('Go to Open Positions')).toBeInTheDocument()
    expect(screen.getByText('Go to Trade Journal')).toBeInTheDocument()
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
