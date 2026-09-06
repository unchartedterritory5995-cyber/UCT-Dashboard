// Phase 4D-4C.2 — "Save trade to notebook" explicit capture action.
// isPaid is stubbed false throughout: the button is NOT an AI-cost feature
// and must work identically regardless of the (unrelated) Compass gate.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TradeDrawer from './TradeDrawer'

vi.mock('../../../context/AuthContext', () => ({ useIsPaid: () => false }))
vi.mock('../../../hooks/useBreakpoint', () => ({ useIsPhone: () => false }))
vi.mock('../hooks/useTradeReview', () => ({
  default: () => ({
    review: null, isLoading: false, generate: vi.fn(), regenerate: vi.fn(),
    feedback: vi.fn(), forget: vi.fn(), reset: vi.fn(), error: null,
  }),
}))
vi.mock('../../../hooks/useMobileSWR', () => ({ default: () => ({ data: null }) }))

const sendCaptureToJournal = vi.fn(async () => 'New entry started — “TQQQ trade”')
vi.mock('../lib/sendToJournal', () => ({
  sendCaptureToJournal: (...args) => sendCaptureToJournal(...args),
}))

beforeEach(() => { sendCaptureToJournal.mockClear() })

const EQUITY_TRADE = {
  id: 't1', symbol: 'TQQQ', side: 'Long', result: 'Win',
  entryPrice: 50, exitPrice: 55, entryDate: '2026-06-24', exitDate: '2026-06-25',
  shares: 100, pnlDollar: 500, pnlPercent: 0.1, tradeRef: 'id:t1',
}

const OPTION_TRADE = {
  id: 's1', isOption: true, symbol: 'SPY Oct 16 $110C', underlying: 'SPY',
  side: 'Long Call', result: 'Win', entryPrice: 5, exitPrice: 7,
  entryDate: '2026-06-24', exitDate: '2026-06-25', shares: 1,
  pnlDollar: 200, pnlPercent: 0.4, tradeRef: 'id:s1',
}

describe('TradeDrawer — Save trade to notebook (explicit capture)', () => {
  it('renders the button for a closed equity trade', () => {
    render(<TradeDrawer trade={EQUITY_TRADE} accountId="a1" onClose={() => {}} />)
    expect(screen.getByText('Save trade to notebook')).toBeInTheDocument()
  })

  it('clicking it captures the REAL trade symbol + its explicit tradeRef — never inferred', async () => {
    render(<TradeDrawer trade={EQUITY_TRADE} accountId="a1" onClose={() => {}} />)
    fireEvent.click(screen.getByText('Save trade to notebook'))
    await waitFor(() => expect(sendCaptureToJournal).toHaveBeenCalledTimes(1))
    const [widgetId, capture, opts] = sendCaptureToJournal.mock.calls[0]
    expect(widgetId).toBe('chart')
    expect(capture).toMatchObject({ symbol: 'TQQQ', tf: 'D', to: '2026-06-25' })
    expect(opts.extra.tradeRef).toBe('id:t1')
    expect(opts.target).toBe('newNote')
  })

  it('an option trade captures the REAL underlying, never the synthesized display label', async () => {
    render(<TradeDrawer trade={OPTION_TRADE} accountId="a1" onClose={() => {}} />)
    fireEvent.click(screen.getByText('Save trade to notebook'))
    await waitFor(() => expect(sendCaptureToJournal).toHaveBeenCalledTimes(1))
    const [, capture, opts] = sendCaptureToJournal.mock.calls[0]
    expect(capture.symbol).toBe('SPY')            // NOT 'SPY Oct 16 $110C'
    expect(opts.extra.tradeRef).toBe('id:s1')      // the option strategy's OWN ref
  })

  it('a trade with no tradeRef yet sends null, never a fabricated one', async () => {
    render(<TradeDrawer trade={{ ...EQUITY_TRADE, tradeRef: undefined }} accountId="a1" onClose={() => {}} />)
    fireEvent.click(screen.getByText('Save trade to notebook'))
    await waitFor(() => expect(sendCaptureToJournal).toHaveBeenCalledTimes(1))
    const [, , opts] = sendCaptureToJournal.mock.calls[0]
    expect(opts.extra.tradeRef).toBeNull()
  })

  it('shows the returned toast line after a successful capture', async () => {
    render(<TradeDrawer trade={EQUITY_TRADE} accountId="a1" onClose={() => {}} />)
    fireEvent.click(screen.getByText('Save trade to notebook'))
    await waitFor(() => expect(screen.getByText('New entry started — “TQQQ trade”')).toBeInTheDocument())
  })

  it('does NOT fire the capture merely because the drawer is open (explicit intent only)', () => {
    render(<TradeDrawer trade={EQUITY_TRADE} accountId="a1" onClose={() => {}} />)
    expect(sendCaptureToJournal).not.toHaveBeenCalled()
  })
})
