import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'
import { ChartsSymContext } from './ChartsSymContext'
import ChartTab from './ChartTab'

// Mock StockChart — it pulls in lightweight-charts + ~30 hooks; we only
// need to verify the props we pass down.
vi.mock('../../components/StockChart', () => ({
  default: ({ sym, onSymbolChange }) => (
    <div>
      <span data-testid="chart-sym">{sym}</span>
      <button onClick={() => onSymbolChange && onSymbolChange('NVDA')}>change</button>
    </div>
  ),
}))

test('ChartTab defaults to SPY when context sym is null', () => {
  function Wrapper() {
    const [sym, setSym] = useState(null)
    return (
      <ChartsSymContext.Provider value={{ sym, setSym }}>
        <ChartTab />
      </ChartsSymContext.Provider>
    )
  }
  render(<Wrapper />)
  expect(screen.getByTestId('chart-sym').textContent).toBe('SPY')
})

test('ChartTab renders context sym when provided', () => {
  const value = { sym: 'AAPL', setSym: vi.fn() }
  render(
    <ChartsSymContext.Provider value={value}>
      <ChartTab />
    </ChartsSymContext.Provider>,
  )
  expect(screen.getByTestId('chart-sym').textContent).toBe('AAPL')
})

test('ChartTab writes back to context when StockChart fires onSymbolChange', () => {
  const setSym = vi.fn()
  render(
    <ChartsSymContext.Provider value={{ sym: 'SPY', setSym }}>
      <ChartTab />
    </ChartsSymContext.Provider>,
  )
  screen.getByText('change').click()
  expect(setSym).toHaveBeenCalledWith('NVDA')
})
