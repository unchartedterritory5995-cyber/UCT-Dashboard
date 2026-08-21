import { render, screen, fireEvent } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'

vi.mock('../../components/StockChart', () => ({
  default: ({ sym }) => <div>chart-{sym}</div>,
}))

let clicked = null
vi.mock('../../components/TickerPopup', () => ({
  default: ({ sym, children }) => (
    <button data-popup={sym} onClick={() => { clicked = sym }}>{children}</button>
  ),
}))

import ChartsGallery from './ChartsGallery'

beforeEach(() => { clicked = null })

test('clicking the card body (the chart) reaches the TickerPopup trigger for that ticker', () => {
  render(<ChartsGallery rows={[
    { ticker: 'AAA', chg_pct_1d: 1 },
    { ticker: 'BBB', chg_pct_1d: -1 },
  ]} livePrices={{}} />)

  fireEvent.click(screen.getByText('chart-AAA'))
  expect(clicked).toBe('AAA')

  fireEvent.click(screen.getByText('chart-BBB'))
  expect(clicked).toBe('BBB')
})

test('the whole card (head + chart) lives inside the ticker popup trigger', () => {
  render(<ChartsGallery rows={[{ ticker: 'AAA', chg_pct_1d: 1 }]} livePrices={{}} />)

  const inner = screen.getByTestId('gallery-card-AAA')
  const trigger = inner.closest('[data-popup]')
  expect(trigger).toHaveAttribute('data-popup', 'AAA')
  expect(trigger).toContainElement(screen.getByText('chart-AAA'))
  expect(trigger).toContainElement(screen.getByText('AAA'))
})
