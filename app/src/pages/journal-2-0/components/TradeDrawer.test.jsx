import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TradeDrawer from './TradeDrawer'

const { sendCaptureMock } = vi.hoisted(() => ({
  sendCaptureMock: vi.fn(() => Promise.resolve('NVDA sent to “Tuesday”')),
}))

vi.mock('../lib/sendToJournal', () => ({
  sendCaptureToJournal: (...a) => sendCaptureMock(...a),
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
}

beforeEach(() => { sendCaptureMock.mockClear() })

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
    expect(opts.tradeRef).toBe('strat_7')
  })

  it('renders nothing when no trade is selected', () => {
    const { container } = render(<TradeDrawer trade={null} accountId="a1" onClose={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
