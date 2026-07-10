import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TradeDetailPage from './TradeDetailPage'

const navigateSpy = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigateSpy }
})

vi.mock('../../../../components/StockChart', () => ({
  default: ({ sym, tf }) => <div data-testid="chart">{sym}:{tf}</div>,
}))
vi.mock('../TradeReviewCard', () => ({ default: () => <div data-testid="review" /> }))
vi.mock('../../hooks/useTradeReview', () => ({
  default: () => ({
    review: null, isLoading: false, generate: vi.fn(), regenerate: vi.fn(),
    feedback: vi.fn(), forget: vi.fn(), reset: vi.fn(), error: null,
  }),
}))
vi.mock('../../../../context/AuthContext', () => ({ useIsPaid: () => false }))
vi.mock('../../hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId: 'a1', account: null, accounts: [] }),
}))
vi.mock('../../hooks/useJ2Settings', () => ({
  default: () => ({ settings: { setups: ['VCP', 'HTF'], mistakeTags: ['FOMO'], emotionTags: ['calm'] } }),
}))
vi.mock('../../hooks/useJ2Trades', () => ({
  default: () => ({
    trades: [
      { id: 't1', symbol: 'NVDA', side: 'Long', setup: 'VCP', entryDate: '2026-05-01' },
      { id: 't2', symbol: 'AMD', side: 'Long', setup: 'HTF', entryDate: '2026-05-02' },
    ],
    isLoading: false, error: null,
  }),
}))

const T1 = {
  id: 't1', symbol: 'NVDA', side: 'Long', shares: 100,
  entryPrice: 50, exitPrice: 56, originalStop: 50, rMultiple: null,
  pnlDollar: 600, pnlDollarNet: 588, pnlPercent: 0.12, holdDays: 3,
  result: 'Win', setup: 'VCP', entryDate: '2026-05-01', exitDate: '2026-05-04',
  notes: '', source: null, mistakeTags: [], emotionTags: [],
}

const swrData = {
  '/api/j2/trades/t1': { trade: T1, tradeRef: 'ref1', brokerActivities: [] },
  '/api/j2/trades/missing': null,
}

vi.mock('swr', () => ({
  default: (key) => ({
    data: key ? (swrData[key] ?? null) : null,
    isLoading: false,
    mutate: vi.fn(),
  }),
}))

beforeEach(() => {
  navigateSpy.mockClear()
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})

function renderPage(id = 't1') {
  return render(
    <MemoryRouter initialEntries={[`/journal-2-0/trade/${id}`]}>
      <Routes>
        <Route path="/journal-2-0/trade/:id" element={<TradeDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('TradeDetailPage', () => {
  it('renders the outcome header from the fixture trade', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'NVDA' })).toBeInTheDocument()
    expect(screen.getByText('LONG')).toBeInTheDocument()
    expect(screen.getByText('Win')).toBeInTheDocument()
    expect(screen.getByText('+$588.00')).toBeInTheDocument()   // pnlDollarNet, not gross
    expect(screen.getByText('+12.00%')).toBeInTheDocument()    // fraction convention
    expect(screen.getByText('3 days')).toBeInTheDocument()
    expect(screen.getByTestId('chart')).toHaveTextContent('NVDA:D')
  })

  it('shows the no-stop R label + an Add-stop affordance', () => {
    renderPage()
    expect(screen.getByText('R: — (no stop logged)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add stop' })).toBeInTheDocument()
  })

  it('renders the excursion-analysis placeholder copy', () => {
    renderPage()
    expect(
      screen.getByText('Excursion analysis coming — computed nightly from intraday bars'),
    ).toBeInTheDocument()
  })

  it('keeps the executions section collapsed by default', () => {
    renderPage()
    const summary = screen.getByText('Executions')
    expect(summary.closest('details')).not.toHaveAttribute('open')
  })

  it('ArrowRight navigates to the next trade in the filtered set', () => {
    renderPage()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(navigateSpy).toHaveBeenCalledWith('/journal-2-0/trade/t2')
  })

  it('renders the missing state for an unknown / option id', () => {
    renderPage('missing')
    expect(screen.getByText(/isn’t available/)).toBeInTheDocument()
  })
})
