import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TradeDrawer from './TradeDrawer'

const navigateMock = vi.fn()
const { sendCaptureMock } = vi.hoisted(() => ({
  sendCaptureMock: vi.fn(() => Promise.resolve('NVDA sent to “Tuesday”')),
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }))
vi.mock('../lib/sendToJournal', () => ({
  sendCaptureToJournal: (...a) => sendCaptureMock(...a),
}))
// The canonical SymbolSearch component has its own dedicated coverage
// elsewhere; stub it here exactly as TickerPopup.test.jsx does so the Compare
// action can be exercised without its real dropdown/fetch machinery. The
// stub deliberately hands back a LOWERCASE comparator so these tests pin the
// drawer's own uppercasing, not SymbolSearch's.
vi.mock('../../../components/chart/SymbolSearch', () => ({
  default: ({ sym, onSymbolChange, displayLabel }) => (
    <button onClick={() => onSymbolChange('amd')}>{displayLabel || sym || 'search'}</button>
  ),
}))
vi.mock('../../../hooks/useMobileSWR', () => ({ default: () => ({ data: null }) }))
vi.mock('../../../hooks/useBreakpoint', () => ({ useIsPhone: () => false, useIsTouch: () => false }))
vi.mock('../../../context/AuthContext', () => ({ useIsPaid: () => false }))
vi.mock('../hooks/useTradeReview', () => ({
  default: () => ({
    review: null, isLoading: false, generate: vi.fn(), regenerate: vi.fn(),
    feedback: vi.fn(), forget: vi.fn(), reset: vi.fn(), error: null,
  }),
}))

const TRADE = {
  id: 'strat_7', symbol: 'NVDA', side: 'Long', result: 'Win',
  entryPrice: 50, exitPrice: 56, entryDate: '2026-05-01', exitDate: '2026-05-04',
  shares: 100, setup: 'VCP', pnlDollar: 600, pnlDollarNet: 588, pnlPercent: 0.12,
  rMultiple: 2,
  // Wave 3 regression rail: `tradeRef` here is the SEPARATE stable broker/
  // annotation-reference (trade_refs.py, id:/ext: prefixed) — deliberately
  // NOT what Notebook capture should send. If a future edit "simplifies"
  // CaptureMenu's prop back to `trade.tradeRef`, this value's mismatch with
  // the bare `id` below is what makes the capture assertion fail.
  tradeRef: 'id:some-stable-reference',
}

beforeEach(() => {
  sendCaptureMock.mockClear()
  navigateMock.mockClear()
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
})

describe('TradeDrawer — Save to Notebook (Wave 1, P1-1: tradeRef)', () => {
  it('captures this trade\'s chart, framed to the holding window, tagged with tradeRef', async () => {
    render(<TradeDrawer trade={TRADE} accountId="a1" onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: /save to notebook/i }))
    fireEvent.click(await screen.findByText('Notebook inbox'))

    await waitFor(() => expect(sendCaptureMock).toHaveBeenCalledTimes(1))
    const [widgetId, capture, opts] = sendCaptureMock.mock.calls[0]
    expect(widgetId).toBe('chart')
    expect(capture.symbol).toBe('NVDA')
    expect(capture.tf).toBe('D')
    // Framed around the holding window, not "now" — a closed trade's chart
    // should show the setup, not whatever the market is doing today.
    expect(capture.from).toBeLessThan(Date.parse('2026-05-01') / 1000)
    expect(capture.to).toBeGreaterThan(Date.parse('2026-05-04') / 1000)
    expect(opts.target).toBe('inbox')
    // Wave 3 (Thesis-Trade Link) regression rail: Notebook capture must send
    // the AUTHORITATIVE DB ROW ID + explicit type -- never the SEPARATE
    // stable broker/annotation-reference (TRADE.tradeRef, deliberately a
    // different-looking value above). A future "simplification" back to
    // `trade.tradeRef` fails this assertion.
    expect(opts.tradeRef).toBe('strat_7')
    expect(opts.tradeRefType).toBe('equity_trade')
  })

  it('tags an OPTION STRATEGY capture with tradeRefType "option_strategy", never the stable reference', async () => {
    const STRATEGY = { ...TRADE, id: 'strat_9', isOption: true, tradeRef: 'id:some-other-stable-reference' }
    render(<TradeDrawer trade={STRATEGY} accountId="a1" onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: /save to notebook/i }))
    fireEvent.click(await screen.findByText('Notebook inbox'))

    await waitFor(() => expect(sendCaptureMock).toHaveBeenCalledTimes(1))
    const [, , opts] = sendCaptureMock.mock.calls[0]
    expect(opts.tradeRef).toBe('strat_9')
    expect(opts.tradeRefType).toBe('option_strategy')
  })

  it('renders nothing when no trade is selected', () => {
    const { container } = render(<TradeDrawer trade={null} accountId="a1" onClose={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('TradeDrawer — Research trigger (Full Research / Ask AI / Compare)', () => {
  it('opens the dropdown without disturbing Save-to-Notebook / Close', () => {
    render(<TradeDrawer trade={TRADE} accountId="a1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Research actions' }))
    expect(screen.getByRole('button', { name: 'Full Research' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ask ai about nvda/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /compare nvda with/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save to notebook/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close drawer' })).toBeInTheDocument()
  })

  it('Full Research navigates to the canonical /research/:sym route and closes the menu', () => {
    render(<TradeDrawer trade={TRADE} accountId="a1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Research actions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Full Research' }))
    expect(navigateMock).toHaveBeenCalledWith('/research/NVDA')
    expect(screen.queryByRole('button', { name: 'Full Research' })).not.toBeInTheDocument()
  })

  it('Ask AI navigates to the same route with ?section=ai', () => {
    render(<TradeDrawer trade={TRADE} accountId="a1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Research actions' }))
    fireEvent.click(screen.getByRole('button', { name: /ask ai about nvda/i }))
    expect(navigateMock).toHaveBeenCalledWith('/research/NVDA?section=ai')
  })

  it('Compare reveals the "+ Compare" picker, and a comparator navigates to the exact canonical compare route (uppercased)', () => {
    render(<TradeDrawer trade={TRADE} accountId="a1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Research actions' }))
    fireEvent.click(screen.getByRole('button', { name: /compare nvda with/i }))
    fireEvent.click(screen.getByRole('button', { name: '+ Compare' }))
    expect(navigateMock).toHaveBeenCalledWith('/research/NVDA/compare/AMD')
    expect(screen.queryByRole('button', { name: 'Full Research' })).not.toBeInTheDocument()
  })
})
