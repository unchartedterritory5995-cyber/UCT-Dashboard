import { renderWithProviders, screen } from '../../test-utils'
import { vi } from 'vitest'
import MorningWireIndexes from './MorningWireIndexes'

// The panel polls /api/snapshot through SWR; feed it a fixture instead.
const mockData = {
  futures: { BTC: { price: '96,000', chg: '+1.27%', css: 'pos' } },
  etfs: {
    QQQ: { price: '682.58', chg: '-0.24%', css: 'neg' },
    SPY: { price: '739.37', chg: '+0.06%', css: 'pos' },
    IWM: { price: '292.97', chg: '+0.61%', css: 'pos' },
    DIA: { price: '521.19', chg: '+0.48%', css: 'pos' },
    VIX: { price: '18.81', chg: '+1.24%', css: 'pos' },
  },
}

vi.mock('swr', () => ({
  default: () => ({ data: mockData, error: undefined }),
  useSWRConfig: () => ({ mutate: vi.fn() }),
  preload: vi.fn(),
}))

vi.mock('../../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(),
  prefetchBars: vi.fn(),
  prefetchBar: vi.fn(),
  default: vi.fn(),
}))

vi.mock('../StockChart', () => ({
  default: () => <div data-testid="stock-chart-stub" />,
}))

// 2026-07-27 (owner call): this panel showed index FUTURES (ES/NQ/YM/RTY).
// yfinance's futures previous_close is a session stale, so their day-change was
// measured off the wrong baseline — the wire published "NQ down 1.41%" against a
// real -0.29%. The panel now shows the index ETFs, which is also the layout this
// component's own header comment always described.
describe('MorningWireIndexes', () => {
  it('renders the index ETFs plus BTC and VIX', () => {
    renderWithProviders(<MorningWireIndexes />)
    for (const sym of ['SPY', 'QQQ', 'DIA', 'IWM', 'BTC', 'VIX']) {
      expect(screen.getByText(sym)).toBeInTheDocument()
    }
  })

  it('shows no index futures', () => {
    renderWithProviders(<MorningWireIndexes />)
    for (const sym of ['ES', 'NQ', 'YM', 'RTY']) {
      expect(screen.queryByText(sym)).toBeNull()
    }
  })

  it('reads prices from the right buckets — BTC from futures, the rest from etfs', () => {
    renderWithProviders(<MorningWireIndexes />)
    expect(screen.getByText('96,000')).toBeInTheDocument()   // futures.BTC
    expect(screen.getByText('682.58')).toBeInTheDocument()   // etfs.QQQ
    expect(screen.getByText('18.81')).toBeInTheDocument()    // etfs.VIX
  })

  it('renders the same six in grid mode', () => {
    renderWithProviders(<MorningWireIndexes grid />)
    for (const sym of ['SPY', 'QQQ', 'DIA', 'IWM', 'BTC', 'VIX']) {
      expect(screen.getByText(sym)).toBeInTheDocument()
    }
    expect(screen.queryByText('NQ')).toBeNull()
  })
})
