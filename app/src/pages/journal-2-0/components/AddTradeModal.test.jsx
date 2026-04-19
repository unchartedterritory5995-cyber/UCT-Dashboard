import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddTradeModal from './AddTradeModal'

const SETTINGS = {
  setups: ['VCP', 'Breakout'],
}

describe('AddTradeModal', () => {
  it('mounts with title', () => {
    render(<AddTradeModal settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Add Trade' })).toBeInTheDocument()
  })

  it('requires a symbol', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/Symbol is required/)
  })

  it('submits with empty contextAtEntry', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    await user.type(screen.getByLabelText(/Shares \*/), '100')
    await user.type(screen.getByLabelText(/Entry Price \*/), '29.57')
    await user.type(screen.getByLabelText(/Exit Price \*/), '34.50')

    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.symbol).toBe('NVDA')
    expect(payload.contextAtEntry).toEqual({})
  })

  it('rejects exit date before entry date', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'X')
    await user.type(screen.getByLabelText(/Shares \*/), '10')
    await user.type(screen.getByLabelText(/Entry Price \*/), '100')
    await user.type(screen.getByLabelText(/Exit Price \*/), '110')
    const entryDateInput = screen.getByLabelText(/Entry Date \*/)
    const exitDateInput = screen.getByLabelText(/Exit Date \*/)
    fireEvent.change(entryDateInput, { target: { value: '2026-04-10' } })
    fireEvent.change(exitDateInput, { target: { value: '2026-04-09' } })

    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot be before entry/)
  })

  it('shows live preview of P&L and R-multiple', async () => {
    const user = userEvent.setup()
    render(<AddTradeModal settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'YSS')
    await user.type(screen.getByLabelText(/Shares \*/), '100')
    await user.type(screen.getByLabelText(/Entry Price \*/), '29.57')
    await user.type(screen.getByLabelText(/Exit Price \*/), '34.50')
    await user.type(screen.getByLabelText(/Original Stop/), '27.90')

    expect(screen.getByText(/\+\$493.00/)).toBeInTheDocument()
    expect(screen.getByText(/\+3.0R/)).toBeInTheDocument()
  })
})
