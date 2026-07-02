import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import OptionsBoard from './OptionsBoard'

vi.mock('../hooks/useJ2OptionStrategies', () => ({
  default: () => ({
    strategies: [
      { id: 'c1', closedAt: '2026-05-01', pnlDollar: -40 },
      { id: 'c2', closedAt: '2026-06-01', pnlDollar: 100 },
    ],
    isLoading: false,
  }),
}))

const open = [
  {
    id: 9, underlying: 'CRWV', strategyType: 'long_call', netEntry: 400,
    brokerCurrentValue: 600,
    legs: [{ qty: 2, strike: 110, expiration: '2099-10-16', entryPrice: 2 }],
  },
  {
    id: 10, underlying: 'AAPL', strategyType: 'long_put', netEntry: 200,
    brokerCurrentValue: null,
    legs: [{ qty: 1, strike: 150, expiration: '2099-09-18', entryPrice: 2 }],
  },
]

describe('OptionsBoard', () => {
  it('renders contract cards with mark, return, contracts and DTE', () => {
    render(<OptionsBoard strategies={open} />)
    expect(screen.getByText('Options')).toBeInTheDocument()
    expect(screen.getByText(/2 contracts/)).toBeInTheDocument()
    expect(screen.getByText('$600.00')).toBeInTheDocument()
    expect(screen.getByText(/\+\$200\.00 \(\+50\.0%\)/)).toBeInTheDocument()
    expect(screen.getByText('broker mark pending')).toBeInTheDocument()  // null-mark card
  })

  it('shows the net-options-performance chart when history exists', () => {
    const { container } = render(<OptionsBoard strategies={open} />)
    expect(screen.getByText('Net options P&L')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders nothing with no open strategies', () => {
    const { container } = render(<OptionsBoard strategies={[]} />)
    expect(container.textContent).toBe('')
  })
})
