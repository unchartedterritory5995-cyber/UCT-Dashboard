import { renderWithProviders, screen, fireEvent } from '../../test-utils'
import { vi } from 'vitest'
import FuturesStrip from './FuturesStrip'

// ⛔ `mutate` AND `isLoading` ARE NOT DECORATION — leaving them off made this file
// exit 1 while reporting "1 passed". `usePreferences.js:92` destructures
// `{ data, mutate, isLoading }` off useSWR's return, and FuturesStrip reaches
// `setPref`, which calls `mutate(...)` inside an async function nobody awaits. A
// missing `mutate` therefore surfaced as an UNHANDLED REJECTION —
// `TypeError: mutate is not a function` — which vitest counts toward the process
// exit code but NOT toward the failure count.
//
// ⭐ That is why this one line mattered: `npx vitest run` was exiting 1 across the
// whole suite with 0 failed tests, so every "the frontend is green, exit 0" claim
// was being read off a runner whose exit code did not mean what it said. vitest
// warns in its own output that unhandled errors "may cause false positives" — the
// same 1 can hide a real failure just as easily as it invented this one.
//
// ⚠️ A mock is a hand-written copy of another module's contract, and it drifts like
// any other copy. Mirror what the consumer DESTRUCTURES, not what today's assertions
// happen to read.
vi.mock('swr', () => ({
  default: () => ({ data: undefined, error: undefined, mutate: vi.fn(), isLoading: false }),
  useSWRConfig: () => ({ mutate: vi.fn() }),
  preload: vi.fn(),
}))

// FuturesStrip's clickable cells embed TickerPopup, whose onClick handler
// prefetches bars via SWR's preload. Stub the helper out so we don't fire
// /api/bars/* fetches under jsdom.
vi.mock('../../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(),
  prefetchBars: vi.fn(),
  prefetchBar: vi.fn(),
  default: vi.fn(),
}))

// StockChart is lazily imported inside the modal; stub it to avoid booting
// Lightweight Charts in tests.
vi.mock('../StockChart', () => ({
  default: () => <div data-testid="stock-chart-stub" />,
}))

const mockData = {
  futures: {
    BTC: { price: '67,105', chg: '+1.20%', css: 'pos' },
  },
  etfs: {
    QQQ: { price: '495.79', chg: '+0.50%', css: 'pos' },
    SPY: { price: '580.00', chg: '+0.40%', css: 'pos' },
    IWM: { price: '210.00', chg: '+0.10%', css: 'pos' },
    DIA: { price: '430.00', chg: '+0.20%', css: 'pos' },
    VIX: { price: '19.62',  chg: '-3.30%', css: 'neg' },
  }
}

test('renders all 6 symbols', () => {
  renderWithProviders(<FuturesStrip data={mockData} />)
  expect(screen.getByText('QQQ')).toBeInTheDocument()
  expect(screen.getByText('SPY')).toBeInTheDocument()
  expect(screen.getByText('IWM')).toBeInTheDocument()
  expect(screen.getByText('DIA')).toBeInTheDocument()
  expect(screen.getByText('BTC')).toBeInTheDocument()
  expect(screen.getByText('VIX')).toBeInTheDocument()
})

test('renders prices', () => {
  renderWithProviders(<FuturesStrip data={mockData} />)
  expect(screen.getByText('495.79')).toBeInTheDocument()
  expect(screen.getByText('+0.50%')).toBeInTheDocument()
  expect(screen.getByText('67,105')).toBeInTheDocument()
})

test('renders loading when no data', () => {
  renderWithProviders(<FuturesStrip data={null} />)
  expect(screen.getByText(/loading/i)).toBeInTheDocument()
})

test('clicking QQQ cell opens chart modal', () => {
  renderWithProviders(<FuturesStrip data={mockData} />)
  fireEvent.click(screen.getByTestId('ticker-QQQ'))
  expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
})

test('clicking BTC cell opens chart modal', () => {
  renderWithProviders(<FuturesStrip data={mockData} />)
  fireEvent.click(screen.getByTestId('ticker-BTC'))
  expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
})
