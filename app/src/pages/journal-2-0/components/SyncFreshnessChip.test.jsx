/**
 * SyncFreshnessChip — the small "Synced 12m ago · Sync now" broker pill.
 *
 * Asserts:
 *   - relative time renders from the broker status data
 *   - "Sync now" fires the manual-sync call (mocked fetch)
 *   - renders NOTHING for manual / non-broker accounts
 *   - no emoji
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Controllable SWR status payload + a mutate spy.
let statusData = null
const mutateMock = vi.fn(() => Promise.resolve())

vi.mock('swr', () => ({
  default: () => ({ data: statusData, mutate: mutateMock }),
}))

import SyncFreshnessChip from './SyncFreshnessChip'

beforeEach(() => {
  statusData = null
  mutateMock.mockClear()
})

describe('SyncFreshnessChip — relative time', () => {
  it('renders "Synced 12m ago" from the latest lastSyncAt', () => {
    const twelveMinAgo = new Date(Date.now() - 12 * 60 * 1000).toISOString()
    statusData = {
      connected: true,
      accounts: [{ brokerageName: 'Robinhood', status: 'active', lastSyncAt: twelveMinAgo }],
    }
    render(<SyncFreshnessChip />)
    expect(screen.getByText(/Synced 12m ago/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sync now/i })).toBeInTheDocument()
  })

  it('shows "Reconnect needed" when a connection is broken', () => {
    statusData = {
      connected: true,
      accounts: [{ brokerageName: 'Robinhood', status: 'broken', lastSyncAt: null }],
    }
    render(<SyncFreshnessChip />)
    expect(screen.getByText(/Reconnect needed/i)).toBeInTheDocument()
  })
})

describe('SyncFreshnessChip — Sync now', () => {
  it('fires the manual-sync call and revalidates', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    vi.stubGlobal('fetch', fetchMock)
    statusData = {
      connected: true,
      accounts: [{ brokerageName: 'Robinhood', status: 'active', lastSyncAt: new Date().toISOString() }],
    }
    const onSynced = vi.fn()
    render(<SyncFreshnessChip onSynced={onSynced} />)

    fireEvent.click(screen.getByRole('button', { name: /sync now/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/j2/broker/sync'),
      expect.objectContaining({ method: 'POST' }),
    )
    await waitFor(() => expect(onSynced).toHaveBeenCalled())
    expect(mutateMock).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('SyncFreshnessChip — manual accounts', () => {
  it('renders nothing when not broker-connected', () => {
    statusData = { connected: false, accounts: [] }
    const { container } = render(<SyncFreshnessChip />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByRole('button', { name: /sync now/i })).not.toBeInTheDocument()
  })

  it('renders nothing while status is still loading (no data)', () => {
    statusData = undefined
    const { container } = render(<SyncFreshnessChip />)
    expect(container.firstChild).toBeNull()
  })
})

describe('SyncFreshnessChip — no emoji', () => {
  it('renders no emoji glyphs', () => {
    statusData = {
      connected: true,
      accounts: [{ brokerageName: 'Robinhood', status: 'active', lastSyncAt: new Date().toISOString() }],
    }
    const { container } = render(<SyncFreshnessChip />)
    expect(/\p{Extended_Pictographic}/u.test(container.textContent || '')).toBe(false)
  })
})
