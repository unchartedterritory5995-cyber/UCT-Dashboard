import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChartContextMenu from './ChartContextMenu'

describe('ChartContextMenu', () => {
  const baseProps = {
    open: true,
    x: 100,
    y: 100,
    onReset: vi.fn(),
    onAddToPortfolio: vi.fn(),
    onOpenSettings: vi.fn(),
    onClose: vi.fn(),
  }

  it('renders all three menu items when open', () => {
    render(<ChartContextMenu {...baseProps} />)
    expect(screen.getByRole('menuitem', { name: 'Reset Chart View' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '+ Add to Portfolio' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Settings…' })).toBeInTheDocument()
  })

  it('does not render when open=false', () => {
    render(<ChartContextMenu {...baseProps} open={false} />)
    expect(screen.queryByRole('menuitem', { name: /Add to Portfolio/ })).not.toBeInTheDocument()
  })

  it('Add to Portfolio fires callback then closes', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const onClose = vi.fn()
    render(<ChartContextMenu {...baseProps} onAddToPortfolio={onAdd} onClose={onClose} />)
    await user.click(screen.getByRole('menuitem', { name: /Add to Portfolio/ }))
    expect(onAdd).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('Reset fires callback then closes', async () => {
    const user = userEvent.setup()
    const onReset = vi.fn()
    const onClose = vi.fn()
    render(<ChartContextMenu {...baseProps} onReset={onReset} onClose={onClose} />)
    await user.click(screen.getByRole('menuitem', { name: 'Reset Chart View' }))
    expect(onReset).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('Esc closes', () => {
    const onClose = vi.fn()
    render(<ChartContextMenu {...baseProps} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
