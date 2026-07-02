import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import PositionDetailPage, { combinePositions } from './PositionDetailPage'

vi.mock('../../../../components/StockChart', () => ({
  default: ({ sym, tf }) => <div data-testid="chart">{sym}:{tf}</div>,
}))
vi.mock('../../../../components/CompanyLogo', () => ({
  default: ({ sym }) => <span data-testid={`logo-${sym}`} />,
}))
vi.mock('../../../../hooks/useFundamentalSnapshot', () => ({
  default: () => ({
    data: {
      name: 'Apple Inc.',
      sector: 'Technology',
      industry: 'Consumer Electronics',
      about: 'Apple designs consumer electronics.',
      composite: 92,
      metrics: { market_cap: '$3.30T', pe_forward: 28.5, div_yield_pct: 0.5, week52_high: 260, week52_low: 164 },
    },
    isLoading: false,
  }),
}))
vi.mock('../../../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: { AAPL: { price: 110, change_pct: 2, prev_close: 107.84 } }, isStreaming: true }),
}))
vi.mock('../../../../hooks/useEarningsTable', () => ({
  default: () => ({
    data: {
      quarterly: [
        { label: 'Q1 26', eps_actual: 2.4, eps_estimate: 2.2, eps_surprise_pct: 9.1 },
      ],
    },
  }),
}))
vi.mock('../../hooks/useJ2Positions', () => ({
  default: () => ({
    positions: [
      { id: 1, symbol: 'AAPL', side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-01' },
      { id: 7, symbol: 'MSFT', side: 'Long', shares: 3, entryPrice: 400, entryDate: '2026-06-01' },
    ],
    isLoading: false, error: null, refresh: vi.fn(),
  }),
}))
vi.mock('../../hooks/useJ2Trades', () => ({
  default: () => ({
    trades: [
      {
        id: 't1', symbol: 'AAPL', side: 'Long', shares: 5, entryPrice: 90, exitPrice: 95,
        entryDate: '2026-05-01', exitDate: '2026-05-10', pnlDollar: 25, setup: 'VCP',
      },
      { id: 't2', symbol: 'MSFT', side: 'Long', shares: 1, entryPrice: 1, exitPrice: 2, pnlDollar: 1 },
    ],
    isLoading: false, error: null,
  }),
}))
vi.mock('../../hooks/useJ2SelectedAccount', () => ({
  default: () => ({
    accountId: 'a1',
    account: { id: 'a1', balanceSource: 'broker', brokerTotalEquity: 11000 },
    accounts: [{ id: 'a1', balanceSource: 'broker', brokerTotalEquity: 11000 }],
  }),
}))

const swrData = {
  '/api/bars/AAPL?tf=D&bars=30': {
    bars: [
      { t: 1, o: 100, h: 105, l: 99, c: 104, v: 1_000_000 },
      { t: 2, o: 104, h: 111, l: 103, c: 110, v: 2_000_000 },
    ],
  },
  '/api/chart-news/AAPL?days=30': {
    news: [{ headline: 'Apple ships widget', source: 'CNBC', url: 'https://x.test/a', time_published: 1750000000 }],
  },
  '/api/earnings/analyst-grades/AAPL': {
    consensus: { strongBuy: 12, buy: 8, hold: 5, sell: 3, strongSell: 2, total: 30, label: 'Buy' },
    price_target: { consensus: 250 },
  },
}
vi.mock('swr', () => ({
  default: (key) => ({ data: key ? swrData[key] ?? null : null }),
}))

function renderPage(sym = 'AAPL') {
  return render(
    <MemoryRouter initialEntries={[`/journal-2-0/position/${sym}`]}>
      <Routes>
        <Route path="/journal-2-0/position/:sym" element={<PositionDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('combinePositions', () => {
  it('merges same-side rows into total shares + weighted avg cost', () => {
    const rows = combinePositions([
      { id: 1, side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-05' },
      { id: 2, side: 'Long', shares: 10, entryPrice: 200, entryDate: '2026-06-01' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].shares).toBe(20)
    expect(rows[0].entryPrice).toBe(150)
    expect(rows[0].entryDate).toBe('2026-06-01')
  })

  it('keeps long and short separate', () => {
    const rows = combinePositions([
      { id: 1, side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-01' },
      { id: 2, side: 'Short', shares: 5, entryPrice: 200, entryDate: '2026-06-01' },
    ])
    expect(rows).toHaveLength(2)
  })
})

describe('PositionDetailPage', () => {
  it('renders header, chart, and every RH section for the symbol', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'AAPL' })).toBeInTheDocument()
    expect(screen.getByText('Apple Inc.')).toBeInTheDocument()
    expect(screen.getByText('$110.00')).toBeInTheDocument()
    expect(screen.getByTestId('chart')).toHaveTextContent('AAPL:D')
    expect(screen.getByText('Your Position')).toBeInTheDocument()
    expect(screen.getByText('About')).toBeInTheDocument()
    expect(screen.getByText('Stats')).toBeInTheDocument()
    expect(screen.getByText('News')).toBeInTheDocument()
    expect(screen.getByText('Analyst Ratings')).toBeInTheDocument()
    expect(screen.getByText('Earnings')).toBeInTheDocument()
    expect(screen.getByText('History')).toBeInTheDocument()
  })

  it('Your Position shows the six figures from the open AAPL position only', () => {
    renderPage()
    expect(screen.getByText('Market value')).toBeInTheDocument()
    expect(screen.getByText('$1,100.00')).toBeInTheDocument()      // 10 × 110
    expect(screen.getByText('Average cost')).toBeInTheDocument()
    expect(screen.getByText('10.00%')).toBeInTheDocument()          // 1100 / 11000 diversity
  })

  it('History lists only this symbol: the open entry + the AAPL closed trade', () => {
    renderPage()
    expect(screen.getByText('OPEN')).toBeInTheDocument()
    expect(screen.getByText(/90\.00.*95\.00/)).toBeInTheDocument()
    expect(screen.queryByText(/1\.00.*2\.00/)).toBeNull()           // MSFT trade filtered out
  })

  it('analyst bar reflects RH bucketing', () => {
    renderPage()
    expect(screen.getByText(/of 30 analysts rate it Buy/)).toBeInTheDocument()
    expect(screen.getByText('UCT Rating 92')).toBeInTheDocument()
  })
})
