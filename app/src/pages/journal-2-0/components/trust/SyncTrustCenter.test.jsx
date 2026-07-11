import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// ── Mocks ────────────────────────────────────────────────────────────────────
// SyncTrustCenter reads the active account (for the manual-account hide) via
// useJ2SelectedAccount and self-fetches trust/sync-log/orphans via useSyncTrust.
// Mock both; keep everything else real.

let selected
let trustState
const reattach = vi.fn()

vi.mock('../../hooks/useJ2SelectedAccount', () => ({
  default: () => selected,
}))
vi.mock('../../hooks/useSyncTrust', () => ({
  default: () => trustState,
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

  it('lists orphans + a Reattach button that calls the endpoint', async () => {
    trustState = { ...trustState, orphans: [orphan()] }
    render(<SyncTrustCenter />)
    expect(screen.getByText(/AAPL long · 3 screenshots/i)).toBeInTheDocument()
    const input = screen.getByPlaceholderText(/trade id/i)
    fireEvent.change(input, { target: { value: 'trade-123' } })
    fireEvent.click(screen.getByRole('button', { name: /^reattach$/i }))
    await waitFor(() => {
      expect(reattach).toHaveBeenCalledWith('ext:abc', 'trade-123')
    })
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
