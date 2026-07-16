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
