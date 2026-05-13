import { renderWithProviders, screen, fireEvent } from '../../test-utils'
import { vi } from 'vitest'
import FuturesStrip from './FuturesStrip'

vi.mock('swr', () => ({
  default: () => ({ data: undefined, error: undefined }),
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
