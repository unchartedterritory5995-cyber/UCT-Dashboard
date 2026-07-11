import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

// ── mocks (mock-prefixed so vi.mock hoisting can reference them) ──────────────
let mockAccountId = null
let mockAccount = null
const mockSetAccount = vi.fn()
let mockAccounts = []

vi.mock('../hooks/useJ2SelectedAccount', () => ({
  default: () => ({
    accountId: mockAccountId,
    account: mockAccount,
    accounts: mockAccounts,
    setAccount: mockSetAccount,
    isLoading: false,
  }),
}))

// EquitySection + RiskExitsSection deps — only mount when tradeCount > 0, but
// stub defensively so the tab's own wiring is what's under test.
vi.mock('../hooks/useJ2Positions', () => ({
  default: () => ({ positions: [], isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, isStreaming: false }),
}))
vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))
vi.mock('../components/PerformancePanel', () => ({ default: () => null }))

// ScopeBar stubbed — asserts the tab mounts it with the right props (the real
// ScopeBar has its own test).
vi.mock('../components/scope/ScopeBar', () => ({
  default: ({ surface, dateApplies }) => (
    <div
      data-testid="scope-bar"
      data-surface={surface}
      data-dateapplies={String(dateApplies)}
    />
  ),
}))

import AnalyticsTab from './AnalyticsTab'

// Capture the SWR fetch URL + drive the analytics response.
let capturedUrl = null
let mockData = { tradeCount: 0, strategyCount: 0 }

beforeEach(() => {
  mockAccountId = null
  mockAccount = null
  mockSetAccount.mockClear()
  mockAccounts = [{ id: 'acc1', name: 'Robinhood' }]
  capturedUrl = null
  mockData = { tradeCount: 0, strategyCount: 0 }
  global.fetch = vi.fn((url) => {
    capturedUrl = String(url)
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockData) })
  })
})

function renderTab({ route = '/journal' } = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={[route]}>
        <AnalyticsTab />
      </MemoryRouter>
    </SWRConfig>,
  )
}

describe('AnalyticsTab — ScopeBar replaces the Range pill row', () => {
  it('renders <ScopeBar surface="analytics"> and NOT the old Range pills', async () => {
    renderTab()
    const bar = await screen.findByTestId('scope-bar')
    expect(bar).toHaveAttribute('data-surface', 'analytics')
    // Analytics HONORS the date facet (unlike Calendar) — default dateApplies.
    expect(bar).not.toHaveAttribute('data-dateapplies', 'false')
    // Old Range chrome is gone.
    expect(screen.queryByText('Range')).not.toBeInTheDocument()
    expect(screen.queryByText('All time')).not.toBeInTheDocument()
    expect(screen.queryByText('Last 30d')).not.toBeInTheDocument()
  })
})

describe('AnalyticsTab — Scope-driven fetch', () => {
  it('threads the scope apiParams into the analytics fetch URL (setups)', async () => {
    renderTab({ route: '/journal?sc_setup=VCP&sc_v=1' })
    await screen.findByTestId('scope-bar')
    expect(capturedUrl).toContain('/api/j2/analytics?')
    expect(capturedUrl).toContain('setups=VCP')
  })

  it('threads a symbol facet into the analytics fetch URL', async () => {
    renderTab({ route: '/journal?sc_sym=AAPL&sc_v=1' })
    await screen.findByTestId('scope-bar')
    expect(capturedUrl).toContain('symbol=AAPL')
  })

  it('carries the Scope DATE facet into analytics (date_from/date_to — analytics honors it)', async () => {
    renderTab({ route: '/journal?sc_from=2026-01-01&sc_to=2026-06-30&sc_v=1' })
    await screen.findByTestId('scope-bar')
    expect(capturedUrl).toContain('date_from=2026-01-01')
    expect(capturedUrl).toContain('date_to=2026-06-30')
  })

  it('single-encodes a literal comma in a setup name (%2C survives as %252C on the wire)', async () => {
    // sc_setup=A%252CB → codec decodes to ONE setup "A,B" → apiParams.setups
    // "A%2CB" → URLSearchParams re-encodes the % once → "setups=A%252CB".
    renderTab({ route: '/journal?sc_setup=A%252CB&sc_v=1' })
    await screen.findByTestId('scope-bar')
    expect(capturedUrl).toContain('setups=A%252CB')
  })
})

describe('AnalyticsTab — Insights hub above the classic accordion', () => {
  it('mounts <InsightsHub> and keeps the accordion below under "More analytics"', async () => {
    mockData = {
      tradeCount: 5,
      strategyCount: 0,
      equity: {
        kpis: {
          peakPnl: 100,
          maxDrawdown: -50,
          maxDrawdownPct: -0.1,
          currentDrawdown: 0,
          longestUnderwaterDays: 2,
        },
        curve: [],
      },
    }
    renderTab()
    // Hub is present (its sub-nav) once the analytics data loads.
    expect(await screen.findByRole('button', { name: 'Exit Quality' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regime' })).toBeInTheDocument()
    // The classic accordion is kept below the hub under a "More analytics" divider.
    expect(screen.getByText('More analytics')).toBeInTheDocument()
    expect(screen.getByText('Closed-Trade Equity')).toBeInTheDocument()
  })
})
