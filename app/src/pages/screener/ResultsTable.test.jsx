import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../../components/TickerPopup', () => ({
  default: ({ children, sym }) => <span>{children || sym}</span>,
}))
vi.mock('../../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ menu: null, closeMenu: () => {}, longPressProps: () => ({}) }),
}))

import ResultsTable from './ResultsTable'

const views = [{ key: 'overview', label: 'Overview' }, { key: 'technical', label: 'Technical' }]
const result = {
  total: 1, view: 'overview',
  view_columns: ['ticker', 'company', 'price', 'chg_pct_1d'],
  rows: [{ ticker: 'AAA', company: 'Alpha', price: 10, chg_pct_1d: 2.5 }],
  snapshot_date: '2026-06-19',
}

test('renders rows and swaps view', () => {
  const setView = vi.fn()
  render(<ResultsTable result={result} view="overview" setView={setView}
    views={views} sort={{}} setSort={() => {}} livePrices={{}} />)
  expect(screen.getByText('AAA')).toBeInTheDocument()
  expect(screen.getByText('Alpha')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Technical'))
  expect(setView).toHaveBeenCalledWith('technical')
})

test('live price overlays the snapshot value', () => {
  render(<ResultsTable result={result} view="overview" setView={() => {}}
    views={views} sort={{}} setSort={() => {}}
    livePrices={{ AAA: { price: 12.34, change_pct: 5 } }} />)
  expect(screen.getByText('$12.34')).toBeInTheDocument()
})
