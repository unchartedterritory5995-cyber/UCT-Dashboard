import { render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { vi } from 'vitest'
import ResultList from '../ResultList'

const rows = [
  { ticker: 'MU', price: 956.12, chg_pct_1d: -3.7, base_render: 'Flat Base', vol_ratio: 0.8 },
  { ticker: 'APLS', price: 41.03, chg_pct_1d: 0, base_render: '3 Weeks Tight', vol_ratio: 0 },
  { ticker: 'DAWN', price: null, chg_pct_1d: null, base_render: null, vol_ratio: 1 },
]
const base = { rows, index: 0, onSelect: vi.fn(), onKeyDown: vi.fn(), livePrices: {}, radar: new Set(['MU']), sortLabel: 'RS rank', total: 214, hasMore: true, onLoadMore: vi.fn(), isLoading: false }

test('renders a listbox with the selected option', () => {
  render(<ResultList {...base} />)
  expect(screen.getByRole('listbox', { name: 'Screen results' })).toBeInTheDocument()
  expect(screen.getByTestId('focus-row-MU')).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByText('1 of 214')).toBeInTheDocument()
})
test('zero-volume row says no trades and shows a dash for change', () => {
  render(<ResultList {...base} />)
  const r = screen.getByTestId('focus-row-APLS')
  expect(r).toHaveTextContent('No trades today')
  expect(r).toHaveTextContent('—')
  expect(r).not.toHaveTextContent('+0.0%')
})
test('null price shows a dash, never NaN', () => {
  render(<ResultList {...base} />)
  const r = screen.getByTestId('focus-row-DAWN')
  expect(r).toHaveTextContent('Not enough history for a base')
  expect(r.textContent).not.toMatch(/NaN/)
})
test('live price overrides the snapshot price', () => {
  render(<ResultList {...base} livePrices={{ MU: { price: 960.5, change_pct: -3.3 } }} />)
  expect(screen.getByTestId('focus-row-MU')).toHaveTextContent('960.50')
  expect(screen.getByTestId('focus-row-MU')).toHaveTextContent('−3.3%')
})
test('radar dot is labelled for screen readers', () => {
  render(<ResultList {...base} />)
  expect(screen.getByTestId('focus-row-MU').querySelector('[aria-label="On your radar"]')).not.toBeNull()
})
test('click selects', () => {
  render(<ResultList {...base} />)
  fireEvent.click(screen.getByTestId('focus-row-DAWN'))
  expect(base.onSelect).toHaveBeenCalledWith(2)
})
test('keys go to onKeyDown', () => {
  render(<ResultList {...base} />)
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
  expect(base.onKeyDown).toHaveBeenCalled()
})
test('exposes scrollToIndex', () => {
  const ref = createRef()
  render(<ResultList {...base} ref={ref} />)
  expect(typeof ref.current.scrollToIndex).toBe('function')
  ref.current.scrollToIndex(2)
})
