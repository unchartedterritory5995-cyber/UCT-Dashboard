import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SWRConfig } from 'swr'
import BrokerSyncStatus from './BrokerSyncStatus'

const status = (accounts) => ({ connected: true, accounts })

function mockStatus(payload) {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => payload }))
}

// Fresh SWR cache per render — the component keys on a fixed URL, so the
// default global cache would leak the first test's payload into the rest.
const renderIsolated = (ui) =>
  render(<SWRConfig value={{ provider: () => new Map() }}>{ui}</SWRConfig>)

const baseAccount = {
  brokerageName: 'Webull',
  status: 'active',
  lastSyncAt: new Date().toISOString(),
}

describe('BrokerSyncStatus — positions-as-of stamp', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('shows the holdings snapshot age when the broker reports one', async () => {
    mockStatus(status([{ ...baseAccount, holdingsSyncedAt: '2026-07-16T07:16:00Z' }]))
    renderIsolated(<BrokerSyncStatus />)
    expect(await screen.findByText(/positions as of .*balances live/i)).toBeInTheDocument()
  })

  it('uses the OLDEST snapshot across accounts (never overclaims)', async () => {
    mockStatus(status([
      { ...baseAccount, holdingsSyncedAt: '2026-07-16T07:16:00Z' },
      { ...baseAccount, holdingsSyncedAt: '2026-07-14T07:16:00Z' },
    ]))
    renderIsolated(<BrokerSyncStatus />)
    const el = await screen.findByText(/positions as of/i)
    expect(el.textContent).toMatch(/Jul 14/i)
  })

  it('omits the stamp when no snapshot time is known', async () => {
    mockStatus(status([{ ...baseAccount }]))
    renderIsolated(<BrokerSyncStatus />)
    await screen.findByText(/synced/i)
    expect(screen.queryByText(/positions as of/i)).not.toBeInTheDocument()
  })

  it('omits the stamp when the connection is broken', async () => {
    mockStatus(status([{
      ...baseAccount, status: 'broken', holdingsSyncedAt: '2026-07-16T07:16:00Z',
    }]))
    renderIsolated(<BrokerSyncStatus />)
    await screen.findByText(/needs reconnect/i)
    expect(screen.queryByText(/positions as of/i)).not.toBeInTheDocument()
  })
})
