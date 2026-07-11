import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// ── Mocks ────────────────────────────────────────────────────────────────────
// SyncTrustCenter reads the active account (for the manual-account hide) via
// useJ2SelectedAccount, self-fetches trust/sync-log/orphans via useSyncTrust,
// and pulls the closed-trade list for the reattach picker via useJ2Trades.
// Mock all three; keep everything else real.

let selected
let trustState
const reattach = vi.fn()

vi.mock('../../hooks/useJ2SelectedAccount', () => ({
  default: () => selected,
}))
vi.mock('../../hooks/useSyncTrust', () => ({
  default: () => trustState,
}))
vi.mock('../../hooks/useJ2Trades', () => ({
  // A couple of closed trades — the picker's options carry the real j2_trades
  // row UUIDs (option value = trade.id), which is what the backend reattach
  // expects. Defined inside the factory (vi.mock is hoisted above imports).
  default: () => ({
    trades: [
      { id: 'trade-123', symbol: 'AAPL', exitDate: '2026-06-10', pnlDollarNet: 250 },
      { id: 'trade-456', symbol: 'NVDA', exitDate: '2026-06-12', pnlDollarNet: -80 },
    ],
  }),
}))

import SyncTrustCenter from './SyncTrustCenter'

const RECENT = new Date(Date.now() - 5 * 60_000).toISOString()

const okAccount = () => ({
  brokerAccountId: 'ba1',
  j2AccountId: 'a1',
  brokerageName: 'Robinhood',
  accountNumberMasked: '••1234',
  status: 'active',
  lastSyncAt: RECENT,
  lastSyncStatus: 'ok',
  lastError: null,
  syncEnabled: true,
  warming: false,
  importedActivityCount: 128,
  tradeCount: 42,
  positionCount: 7,
  tokenState: 'ok',
})

const syncRow = () => ({
  startedAt: RECENT,
  finishedAt: RECENT,
  tradesImported: 3,
  positionsUpserted: 2,
  optionsImported: 1,
  status: 'ok',
  error: null,
})

const orphan = () => ({
  tradeRef: 'ext:abc',
  kind: 'screenshot',
  summary: 'AAPL long · 3 screenshots',
})

beforeEach(() => {
  reattach.mockReset()
  reattach.mockResolvedValue({ moved: 1 })
  selected = { accountId: 'a1', account: { id: 'a1', name: 'RH', balanceSource: 'broker' }, accounts: [] }
  trustState = {
    trust: { anyBroker: true, accounts: [okAccount()] },
    syncLog: [syncRow()],
    orphans: [],
    reattach,
    isLoading: false,
  }
})

describe('SyncTrustCenter', () => {
  it('hides entirely for a manual account (renders one muted line, no health panel)', () => {
    selected = { accountId: 'm1', account: { id: 'm1', name: 'Manual', balanceSource: 'manual' }, accounts: [] }
    render(<SyncTrustCenter />)
    expect(screen.getByText(/Manual account/i)).toBeInTheDocument()
    // No health panel / brokerage badge.
    expect(screen.queryByLabelText(/Sync Trust/i)).toBeNull()
    expect(screen.queryByText('Robinhood')).toBeNull()
  })

  it('renders the health badge + counts for a broker account', () => {
    render(<SyncTrustCenter />)
    expect(screen.getByLabelText(/Sync Trust/i)).toBeInTheDocument()
    expect(screen.getByText(/Robinhood/)).toBeInTheDocument()
    // "synced Xm ago" from lastSyncAt.
    expect(screen.getByText(/synced .*ago/i)).toBeInTheDocument()
    // Imported-vs-broker counts.
    expect(screen.getByText('128')).toBeInTheDocument() // broker ledger
    expect(screen.getByText('42')).toBeInTheDocument()  // trades
    expect(screen.getByText('7')).toBeInTheDocument()   // positions
  })

  it('keeps the sync audit log collapsed by default', () => {
    render(<SyncTrustCenter />)
    const toggle = screen.getByRole('button', { name: /sync activity/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // Expanding reveals the recent rows.
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/3 trades/i)).toBeInTheDocument()
  })

  it('shows a reconnect banner + Settings link when the token is broken', () => {
    const acct = { ...okAccount(), tokenState: 'broken', status: 'broken' }
    trustState = { ...trustState, trust: { anyBroker: true, accounts: [acct] } }
    render(<SyncTrustCenter />)
    expect(screen.getByRole('alert')).toHaveTextContent(/reconnect/i)
    const link = screen.getByRole('link', { name: /settings/i })
    expect(link).toHaveAttribute('href', '/settings')
  })

  it('lists orphans + a trade picker whose Reattach calls the endpoint with the chosen trade id', async () => {
    trustState = { ...trustState, orphans: [orphan()] }
    render(<SyncTrustCenter />)
    expect(screen.getByText(/AAPL long · 3 screenshots/i)).toBeInTheDocument()
    // The reattach control is now a <select> of the user's closed trades.
    const select = screen.getByRole('combobox', { name: /reattach .* to a trade/i })
    // Options are the real closed trades (option value = j2_trades UUID).
    expect(within(select).getByRole('option', { name: /AAPL/ })).toBeInTheDocument()
    // Reattach is disabled until a trade is chosen.
    expect(screen.getByRole('button', { name: /^reattach$/i })).toBeDisabled()
    fireEvent.change(select, { target: { value: 'trade-123' } })
    fireEvent.click(screen.getByRole('button', { name: /^reattach$/i }))
    await waitFor(() => {
      expect(reattach).toHaveBeenCalledWith('ext:abc', 'trade-123')
    })
    // Clean move (no excursionConflict) → the plain "Reattached" confirmation.
    expect(await screen.findByText(/^Reattached$/)).toBeInTheDocument()
  })

  it('shows an honest "left in place" message when the reattach hits an excursion conflict', async () => {
    reattach.mockResolvedValue({ moved: 3, excursionConflict: true })
    trustState = { ...trustState, orphans: [orphan()] }
    render(<SyncTrustCenter />)
    const select = screen.getByRole('combobox', { name: /reattach .* to a trade/i })
    fireEvent.change(select, { target: { value: 'trade-456' } })
    fireEvent.click(screen.getByRole('button', { name: /^reattach$/i }))
    await waitFor(() => {
      expect(
        screen.getByText(/already has excursion data, so that was left in place/i),
      ).toBeInTheDocument()
    })
    // NOT the plain "Reattached ✓" success — the orphan actually persisted.
    expect(screen.queryByText(/^Reattached$/)).toBeNull()
  })

  it('renders no orphan section when there are 0 orphans', () => {
    render(<SyncTrustCenter />) // beforeEach → orphans: []
    expect(screen.queryByText(/orphan/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /^reattach$/i })).toBeNull()
  })

  it('renders no emoji (all iconography via UIcon)', () => {
    trustState = { ...trustState, orphans: [orphan()] }
    const { container } = render(<SyncTrustCenter />)
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
