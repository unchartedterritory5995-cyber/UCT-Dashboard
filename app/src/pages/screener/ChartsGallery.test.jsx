import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../../components/StockChart', () => ({
  default: ({ sym }) => <div>chart-{sym}</div>,
}))

import ChartsGallery from './ChartsGallery'

test('renders a card per row (first page)', () => {
  render(<ChartsGallery rows={[{ ticker: 'AAA', chg_pct_1d: 1 },
    { ticker: 'BBB', chg_pct_1d: -1 }]} livePrices={{}} />)
  expect(screen.getByText('chart-AAA')).toBeInTheDocument()
  expect(screen.getByText('chart-BBB')).toBeInTheDocument()
})
