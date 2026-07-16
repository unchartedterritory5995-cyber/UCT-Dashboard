import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../../components/StockChart', () => ({
  default: ({ sym }) => <div>chart-{sym}</div>,
}))
vi.mock('../../components/TickerPopup', () => ({
  default: ({ children, sym }) => <span>{children || sym}</span>,
}))

import ChartsGallery from './ChartsGallery'

test('renders a card per row (first page)', () => {
  render(<ChartsGallery rows={[{ ticker: 'AAA', chg_pct_1d: 1 },
    { ticker: 'BBB', chg_pct_1d: -1 }]} livePrices={{}} />)
  expect(screen.getByText('chart-AAA')).toBeInTheDocument()
  expect(screen.getByText('chart-BBB')).toBeInTheDocument()
})

test('snaps back to page 1 when the match set shrinks below the current page', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ ticker: `T${i}`, chg_pct_1d: 1 }))
  const { rerender } = render(<ChartsGallery rows={many} livePrices={{}} />)
  fireEvent.click(screen.getByText('Next ›'))
  expect(screen.getByText('chart-T29')).toBeInTheDocument()
  // Filter change shrinks the rows to a single page — the gallery must not
  // strand the user on a now-empty page 2.
  rerender(<ChartsGallery rows={many.slice(0, 3)} livePrices={{}} />)
  expect(screen.getByText('chart-T0')).toBeInTheDocument()
})
