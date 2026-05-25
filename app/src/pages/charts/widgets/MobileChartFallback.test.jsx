import { render, screen, act } from '@testing-library/react'
import { vi } from 'vitest'
import MobileChartFallback from './MobileChartFallback'

vi.mock('../../../components/StockChart', () => ({
  default: ({ sym, onSymbolChange }) => (
    <div>
      <span data-testid="m-sym">{sym}</span>
      <button onClick={() => onSymbolChange('NVDA')}>change</button>
    </div>
  ),
}))

beforeEach(() => { localStorage.clear() })

test('defaults to SPY when no localStorage entry', () => {
  render(<MobileChartFallback />)
  expect(screen.getByTestId('m-sym').textContent).toBe('SPY')
})

test('restores ticker from localStorage', () => {
  localStorage.setItem('charts_mobile_sym', 'AAPL')
  render(<MobileChartFallback />)
  expect(screen.getByTestId('m-sym').textContent).toBe('AAPL')
})

test('persists ticker changes to localStorage', () => {
  render(<MobileChartFallback />)
  act(() => { screen.getByText('change').click() })
  expect(localStorage.getItem('charts_mobile_sym')).toBe('NVDA')
})
