import { renderWithProviders, screen, fireEvent } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

// Suppress prefetchBars side effects — the click handler kicks off SWR
// preloads against /api/bars/* that resolve to relative URLs jsdom can't fetch.
vi.mock('../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(),
  prefetchBars: vi.fn(),
  prefetchBar: vi.fn(),
  default: vi.fn(),
}))

// StockChart is lazy-loaded inside the modal; stub it so tests don't need to
// boot Lightweight Charts or hit /api/bars.
vi.mock('./StockChart', () => ({
  default: ({ sym, tf }) => <div data-testid={`stock-chart-${sym}-${tf}`}>chart {sym} {tf}</div>,
}))

import TickerPopup from './TickerPopup'

test('renders ticker text', () => {
  renderWithProviders(<TickerPopup sym="NVDA" />)
  expect(screen.getByText('NVDA')).toBeInTheDocument()
})

test('renders custom children', () => {
  renderWithProviders(<TickerPopup sym="NVDA">NVIDIA</TickerPopup>)
  expect(screen.getByText('NVIDIA')).toBeInTheDocument()
})

test('shows modal on click', () => {
  renderWithProviders(<TickerPopup sym="NVDA" />)
  fireEvent.click(screen.getByTestId('ticker-NVDA'))
  expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
})

test('closes modal on overlay click', () => {
  renderWithProviders(<TickerPopup sym="NVDA" />)
  fireEvent.click(screen.getByTestId('ticker-NVDA'))
  expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('chart-modal'))
  expect(screen.queryByTestId('chart-modal')).not.toBeInTheDocument()
})

test('modal shows tab buttons for all timeframes', async () => {
  // The modal was rebuilt around Lightweight Charts (StockChart). It now
  // exposes 8 timeframe tabs (1min through Monthly) instead of the old 5.
  const user = userEvent.setup()
  renderWithProviders(<TickerPopup sym="NVDA" />)
  await user.click(screen.getByTestId('ticker-NVDA'))
  expect(screen.getByRole('button', { name: '1min' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '5min' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '30min' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '1hr' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Daily' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Weekly' })).toBeInTheDocument()
})

test('modal renders stock chart for the active timeframe', async () => {
  // The TickerPopup modal no longer hosts a Finviz image or a TradingView
  // iframe — it embeds a single StockChart (Lightweight Charts v5). We stub
  // the chart and verify the right ticker/tf gets passed in.
  const user = userEvent.setup()
  renderWithProviders(<TickerPopup sym="NVDA" />)
  await user.click(screen.getByTestId('ticker-NVDA'))
  // Default tab on open is Daily → tf="D".
  expect(screen.getByTestId('stock-chart-NVDA-D')).toBeInTheDocument()
  // Switching to 5min triggers the chart to re-render with tf="5".
  await user.click(screen.getByRole('button', { name: '5min' }))
  expect(screen.getByTestId('stock-chart-NVDA-5')).toBeInTheDocument()
})
