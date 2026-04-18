import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddTradeModal from './AddTradeModal'

const SETTINGS = {
  setups: ['VCP', 'Breakout'],
  journalColumns: { marketNavIndex: 'NYA', breadthMetric: 'NASI RSI' },
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

  it('historical context section is collapsed by default (A2)', () => {
    render(<AddTradeModal settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)
    // Toggle button visible
    expect(screen.getByRole('button', { name: /Historical Market Context/ })).toBeInTheDocument()
    // Context inputs NOT visible until expanded
    expect(screen.queryByText(/Nav Count/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Rally Day/)).not.toBeInTheDocument()
  })

  it('expanding context section reveals the optional fields (A2)', async () => {
    const user = userEvent.setup()
    render(<AddTradeModal settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Historical Market Context/ }))
    expect(screen.getByText('Nav Count')).toBeInTheDocument()
    expect(screen.getByText('Rally Day')).toBeInTheDocument()
    expect(screen.getByText('Power Trend')).toBeInTheDocument()
    expect(screen.getByText('IG Rank')).toBeInTheDocument()
    expect(screen.getByText('RS Rating')).toBeInTheDocument()
    // Breadth label uses the LIVE settings metric name
    expect(screen.getByText(/NASI RSI Value/)).toBeInTheDocument()
  })

  it('submits with all context nulls when user skips expansion', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    // numberInput order: shares, originalStop, entryPrice, exitPrice,
    // + possibly nav/breadth/etc. inside collapsed ctx but those aren't
    // in the DOM. We'll use labels to be explicit.
    const sharesInput = screen.getByLabelText(/Shares \*/)
    await user.type(sharesInput, '100')
    const entryPriceInput = screen.getByLabelText(/Entry Price \*/)
    await user.type(entryPriceInput, '29.57')
    const exitPriceInput = screen.getByLabelText(/Exit Price \*/)
    await user.type(exitPriceInput, '34.50')

    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.symbol).toBe('NVDA')
    expect(payload.contextAtEntry).toEqual({
      navCount: null,
      rallyDay: null,
      powerTrend: null,
      breadthValue: null,
      igRank: null,
      rsRating: null,
    })
  })

  it('submits filled context when user expands and enters values (A2)', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'YSS')
    await user.type(screen.getByLabelText(/Shares \*/), '100')
    await user.type(screen.getByLabelText(/Entry Price \*/), '29.57')
    await user.type(screen.getByLabelText(/Exit Price \*/), '34.50')

    // Expand + fill context
    await user.click(screen.getByRole('button', { name: /Historical Market Context/ }))
    await user.type(screen.getByLabelText(/^Nav Count$/), '5')
    await user.type(screen.getByLabelText(/^Rally Day$/), 'D7')
    await user.click(screen.getByRole('button', { name: 'On', pressed: false }))
    await user.type(screen.getByLabelText(/NASI RSI Value/), '62.5')
    await user.type(screen.getByLabelText(/^IG Rank$/), '42')
    await user.type(screen.getByLabelText(/^RS Rating$/), '88')

    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    const payload = onSave.mock.calls[0][0]
    expect(payload.contextAtEntry).toEqual({
      navCount: 5,
      rallyDay: 'D7',
      powerTrend: 'On',
      breadthValue: 62.5,
      igRank: 42,
      rsRating: 88,
    })
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

  it('shows live preview of P&L and R-multiple (§14.7 YSS partial close)', async () => {
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
