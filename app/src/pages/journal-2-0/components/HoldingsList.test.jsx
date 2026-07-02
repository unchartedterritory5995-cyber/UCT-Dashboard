import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import HoldingsList from './HoldingsList'

const renderList = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)

vi.mock('../hooks/useHoldingsSparklines', () => ({
  default: () => ({ closes: { AAPL: [1, 2, 3], TSLA: [3, 2, 1] }, loading: false }),
}))
vi.mock('../../../components/CompanyLogo', () => ({
  default: ({ sym }) => <span data-testid={`logo-${sym}`} />,
}))
vi.mock('./OptionsBoard', () => ({
  default: ({ strategies }) => <div data-testid="options-board">{strategies.length}</div>,
}))

const positions = [
  { id: 1, symbol: 'AAPL', side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-01' },
  { id: 2, symbol: 'TSLA', side: 'Short', shares: 5, entryPrice: 200, entryDate: '2026-06-01' },
]
const prices = {
  AAPL: { price: 110, change_pct: 2, prev_close: 107.84 },
  TSLA: { price: 190, change_pct: -1, prev_close: 191.92 },
}
const strategies = [
  {
    id: 9, underlying: 'CRWV', strategyType: 'long_call', netEntry: 400,
    brokerCurrentValue: 600, legs: [{ qty: 2, strike: 110, expiration: '2026-10-16', entryPrice: 2 }],
  },
]

beforeEach(() => localStorage.clear())

describe('HoldingsList', () => {
  it('renders the Stocks & ETFs section with logo, ticker, shares and price pill', () => {
    renderList(<HoldingsList positions={positions} optionStrategies={[]} prices={prices} />)
    expect(screen.getByText('Stocks & ETFs')).toBeInTheDocument()
    expect(screen.getByTestId('logo-AAPL')).toBeInTheDocument()
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('10 shares')).toBeInTheDocument()
    expect(screen.getByText('$110.00')).toBeInTheDocument()
    expect(screen.getByText('Short 5')).toBeInTheDocument()
  })

  it('renders the OptionsBoard when strategies exist', () => {
    renderList(<HoldingsList positions={[]} optionStrategies={strategies} prices={{}} />)
    expect(screen.getByTestId('options-board')).toHaveTextContent('1')
    expect(screen.queryByText('Stocks & ETFs')).toBeNull()
  })

  it('defaults to Equity desc and re-sorts via the control', () => {
    renderList(<HoldingsList positions={positions} optionStrategies={[]} prices={prices} />)
    let syms = screen.getAllByTestId('holding-sym').map((el) => el.textContent)
    expect(syms).toEqual(['AAPL', 'TSLA'])          // 1100 > 950
    fireEvent.change(screen.getByLabelText('Sort holdings'), { target: { value: 'symbol' } })
    fireEvent.click(screen.getByRole('button', { name: /direction/i }))  // desc → asc
    syms = screen.getAllByTestId('holding-sym').map((el) => el.textContent)
    expect(syms).toEqual(['AAPL', 'TSLA'])
    expect(JSON.parse(localStorage.getItem('uct.j2.holdings.sort'))).toEqual({ key: 'symbol', dir: 'asc' })
  })

  it('equity rows link to the position detail page', () => {
    renderList(<HoldingsList positions={positions} optionStrategies={[]} prices={prices} />)
    const link = screen.getByRole('link', { name: 'AAPL position detail' })
    expect(link).toHaveAttribute('href', '/journal-2-0/position/AAPL')
  })

  it('flashes the price pill when a live tick moves the price', () => {
    const { rerender } = renderList(
      <HoldingsList positions={[positions[0]]} optionStrategies={[]} prices={prices} />,
    )
    const pill = screen.getByText('$110.00')
    expect(pill.className).not.toMatch(/flash/i)
    rerender(
      <MemoryRouter>
        <HoldingsList
          positions={[positions[0]]}
          optionStrategies={[]}
          prices={{ AAPL: { ...prices.AAPL, price: 111 } }}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('$111.00').className).toMatch(/flashUp/)
  })

  it('renders nothing when the book is empty', () => {
    const { container } = renderList(<HoldingsList positions={[]} optionStrategies={[]} prices={{}} />)
    expect(container.textContent).toBe('')
  })
})
