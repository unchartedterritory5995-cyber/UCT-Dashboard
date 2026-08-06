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
  // The popup now mounts ChartPane — the same chart /charts renders — so the
  // timeframe row is ChartPane's, not this component's. Same intent as before
  // (every timeframe reachable from the popup); the labels are the workspace's
  // canonical ones (1m/5m/…/1D/1W) instead of the old bespoke 1min/5min/Daily.
  const user = userEvent.setup()
  renderWithProviders(<TickerPopup sym="NVDA" />)
  await user.click(screen.getByTestId('ticker-NVDA'))
  // Wait on the chart stub FIRST. ChartPane is a lazy chunk and a heavier one
  // than bare StockChart was, so under full-suite parallel load the Suspense
  // fallback can still be up when a findByRole for a button times out. Once the
  // stub is present the pane has mounted, so its timeframe bar is present too
  // and the rest can be synchronous.
  await screen.findByTestId('stock-chart-NVDA-D')
  for (const label of ['1m', '5m', '30m', '1h', '1D', '1W']) {
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
  }
})

test('modal renders stock chart for the active timeframe', async () => {
  // The TickerPopup modal no longer hosts a Finviz image or a TradingView
  // iframe — it embeds a single StockChart (Lightweight Charts v5). We stub
  // the chart and verify the right ticker/tf gets passed in.
  const user = userEvent.setup()
  renderWithProviders(<TickerPopup sym="NVDA" />)
  await user.click(screen.getByTestId('ticker-NVDA'))
  // Default tab on open is Daily → tf="D". findBy (not getBy) waits for the heavy
  // chart mount to render the stub — getBy raced under full-suite parallel load.
  // The StockChart mock still applies: ChartPane imports the very same module.
  expect(await screen.findByTestId('stock-chart-NVDA-D')).toBeInTheDocument()
  // Switching timeframe on ChartPane's bar must still reach StockChart's tf, so
  // the popup's tab state and the pane stay in lockstep.
  await user.click(await screen.findByRole('button', { name: '5m' }))
  expect(await screen.findByTestId('stock-chart-NVDA-5')).toBeInTheDocument()
})
