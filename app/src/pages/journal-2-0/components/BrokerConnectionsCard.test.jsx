import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import BrokerConnectionsCard from './BrokerConnectionsCard'

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ isPaid: true, startCheckout: vi.fn() }),
}))
vi.mock('../hooks/useBrokerWarming', () => ({
  default: () => ({ warming: false, broker: null }),
}))

const STATUS = {
  connected: true,
  snaptradeConfigured: true,
  accounts: [],
  dupFlagsPending: 0,
}

function mockFetch(routes) {
  global.fetch = vi.fn(async (url) => {
    for (const [match, resp] of routes) {
      if (String(url).includes(match)) {
        return {
          ok: resp.ok !== false,
          status: resp.status || (resp.ok === false ? 500 : 200),
          json: async () => resp.body ?? {},
        }
      }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
}

describe('BrokerConnectionsCard — Webull incident regressions (2026-07-15)', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/settings')
    vi.restoreAllMocks()
  })

  it('sends the portal back to the CONNECTIONS section (the return handler only mounts there)', async () => {
    const { fireEvent } = await import('@testing-library/react')
    mockFetch([
      ['/api/j2/broker/status', { body: { ...STATUS, connected: false } }],
      ['/api/j2/broker/connect', { body: { redirectUri: 'https://app.snaptrade.com/x' } }],
    ])
    render(<BrokerConnectionsCard />)
    fireEvent.click(await screen.findByText('Connect a brokerage'))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('Continue to broker login'))
    await vi.waitFor(() => {
      const call = global.fetch.mock.calls.find(c => String(c[0]).includes('/connect'))
      expect(call).toBeTruthy()
      const body = JSON.parse(call[1].body)
      expect(body.customRedirect).toContain('section=connections')
      expect(body.customRedirect).toContain('broker=connected')
    })
  })

  it('self-heals connected-but-zero-accounts by importing accounts on sight', async () => {
    // James's exact stranded state: SnapTrade connection exists, our side has
    // no mapped accounts, and no ?broker=connected param remains.
    mockFetch([
      ['/api/j2/broker/accounts/refresh', { body: { accounts: [] } }],
      ['/api/j2/broker/status', { body: STATUS }],
    ])
    render(<BrokerConnectionsCard />)
    await vi.waitFor(() => {
      const called = global.fetch.mock.calls.some(c =>
        String(c[0]).includes('/accounts/refresh'))
      expect(called).toBe(true)
    })
  })
})

describe('BrokerConnectionsCard — portal return path', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/settings?broker=connected')
  })
  afterEach(() => {
    window.history.replaceState({}, '', '/settings')
    vi.restoreAllMocks()
  })

  it('surfaces an accounts/refresh failure instead of swallowing it', async () => {
    mockFetch([
      ['/api/j2/broker/accounts/refresh', { ok: false, status: 409, body: { detail: 'Connection expired — please reconnect.' } }],
      ['/api/j2/broker/status', { body: STATUS }],
    ])
    render(<BrokerConnectionsCard />)
    expect(await screen.findByText(/connection expired/i)).toBeInTheDocument()
  })

  it('surfaces a first-sync failure instead of swallowing it', async () => {
    mockFetch([
      ['/api/j2/broker/accounts/refresh', { body: { accounts: [] } }],
      ['/api/j2/broker/sync', { ok: false, status: 502, body: { detail: 'Brokerage service rejected the request.' } }],
      ['/api/j2/broker/status', { body: STATUS }],
    ])
    render(<BrokerConnectionsCard />)
    expect(await screen.findByText(/rejected the request/i)).toBeInTheDocument()
  })
})

describe('BrokerConnectionsCard — account nicknames (2026-07-17)', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/settings')
    vi.restoreAllMocks()
  })

  const ACCT = {
    id: 'ba1', j2AccountId: 'j2-1', brokerageName: 'Schwab',
    accountNumberMasked: '••728', accountName: 'Schwab ••728',
    status: 'active', syncEnabled: true, lastSyncAt: null, warming: false,
  }

  it('renders the nickname and saves a rename via PUT /api/j2/accounts/{id}', async () => {
    const { fireEvent } = await import('@testing-library/react')
    mockFetch([
      ['/api/j2/broker/status', { body: { ...STATUS, accounts: [ACCT] } }],
      ['/api/j2/accounts/j2-1', { body: {} }],
    ])
    render(<BrokerConnectionsCard />)
    expect(await screen.findByText('Schwab ••728')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /rename schwab/i }))
    const input = screen.getByLabelText('Account nickname')
    fireEvent.change(input, { target: { value: 'Day Trading' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() => {
      const call = global.fetch.mock.calls.find(c =>
        String(c[0]).includes('/api/j2/accounts/j2-1'))
      expect(call).toBeTruthy()
      expect(call[1].method).toBe('PUT')
      expect(JSON.parse(call[1].body)).toEqual({ name: 'Day Trading' })
    })
  })

  it('shows a custom nickname with the broker identity in the meta line', async () => {
    mockFetch([
      ['/api/j2/broker/status', {
        body: { ...STATUS, accounts: [{ ...ACCT, accountName: 'Longs Book' }] },
      }],
    ])
    render(<BrokerConnectionsCard />)
    expect(await screen.findByText('Longs Book')).toBeInTheDocument()
    expect(screen.getByText(/Schwab ••728/)).toBeInTheDocument()
  })
})
