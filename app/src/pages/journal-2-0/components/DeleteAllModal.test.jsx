import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DeleteAllModal from './DeleteAllModal'

describe('DeleteAllModal', () => {
  it('mounts with trade count in warning', () => {
    render(<DeleteAllModal tradeCount={42} onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/Delete all trades\?/)).toBeInTheDocument()
    expect(screen.getByText(/42/)).toBeInTheDocument()
  })

  it('primary button is disabled initially', () => {
    render(<DeleteAllModal tradeCount={5} onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Delete All Trades/ })).toBeDisabled()
  })

  it('primary button stays disabled for partial match', async () => {
    const user = userEvent.setup()
    render(<DeleteAllModal tradeCount={5} onConfirm={vi.fn()} onClose={vi.fn()} />)
    await user.type(screen.getByRole('textbox'), 'DELET')
    expect(screen.getByRole('button', { name: /Delete All Trades/ })).toBeDisabled()
  })

  it('primary button stays disabled for lowercase', async () => {
    const user = userEvent.setup()
    render(<DeleteAllModal tradeCount={5} onConfirm={vi.fn()} onClose={vi.fn()} />)
    await user.type(screen.getByRole('textbox'), 'delete')
    expect(screen.getByRole('button', { name: /Delete All Trades/ })).toBeDisabled()
  })

  it('primary button enables when user types DELETE exactly', async () => {
    const user = userEvent.setup()
    render(<DeleteAllModal tradeCount={5} onConfirm={vi.fn()} onClose={vi.fn()} />)
    await user.type(screen.getByRole('textbox'), 'DELETE')
    expect(screen.getByRole('button', { name: /Delete All Trades/ })).not.toBeDisabled()
  })

  it('clicking Delete fires onConfirm', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue()
    render(<DeleteAllModal tradeCount={5} onConfirm={onConfirm} onClose={vi.fn()} />)

    await user.type(screen.getByRole('textbox'), 'DELETE')
    await user.click(screen.getByRole('button', { name: /Delete All Trades/ }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('Cancel does NOT confirm', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<DeleteAllModal tradeCount={5} onConfirm={onConfirm} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: /Cancel/ }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('Esc closes the modal', () => {
    const onClose = vi.fn()
    render(<DeleteAllModal tradeCount={5} onConfirm={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
