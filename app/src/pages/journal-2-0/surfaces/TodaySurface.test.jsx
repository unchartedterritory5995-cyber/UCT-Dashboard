/**
 * TodaySurface (B1) — state-routing tests.
 *
 * The Today surface is the flagship `/journal` landing. It routes to ONE of a
 * small set of experiences keyed on `useTodayState()`:
 *   - zeroData  → the guided checklist (fresh account)
 *   - allAccounts → the overview lead + "pick an account" affordance
 *   - concrete account → the SESSION lead (premarket readiness / market hero /
 *     post-close EOD recap), with a manual-account fallback for the market lead
 *   - active scope → a muted "not applied on Today" note (always, when scoped)
 *
 * These tests exercise the STATE ROUTING, not the heavy leaf components — the
 * broker hero + EOD recap + holdings list are stubbed so a session flip lands on
 * the right module deterministically.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── controllable hook state ──────────────────────────────────────────────────
let market = { isOpen: false, isPremarket: false, isExtended: false }
let account = { id: 'a1', name: 'Default', balanceSource: 'broker' }
let accountId = 'a1'
let positions = []
let optionStrategies = []
let comparison = [{ id: 'a1', tradeCount: 12 }]
let overview = {
  today: { date: '2026-07-10', trade_count: 3, net_pnl_dollar: 250, has_eod_recap: false },
  regime: 'Uptrend',
  week_to_date: { trade_count: 8, net_pnl_dollar: 900 },
  this_weeks_focus: 'Cut losers faster',
}
let recaps = []
let disciplineState = null
let scopeActive = false

vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => market }))
vi.mock('../hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId, account, accounts: [account], setAccount: vi.fn(), isLoading: false }),
}))
vi.mock('../hooks/useJ2Positions', () => ({
  default: () => ({ positions, isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useJ2OptionStrategies', () => ({
  default: () => ({ strategies: optionStrategies, isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useJ2AccountComparison', () => ({
  default: () => ({ accounts: comparison, isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useCompassOverview', () => ({
  default: () => ({ overview, isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useScope', () => ({
  default: () => ({ isActive: scopeActive, scope: {}, activeCount: scopeActive ? 1 : 0 }),
}))
vi.mock('../hooks/useJ2EODRecaps', () => ({
  default: () => ({ recaps, isLoading: false, error: null, generate: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('../hooks/useJ2DisciplineState', () => ({
  default: () => ({ state: disciplineState, isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, isStreaming: false, isLoading: false, staleSymbols: [] }),
}))

// heavy leaf children → stubs so tests are about routing, not the components
vi.mock('../components/BrokerAccountHero', () => ({
  default: () => <div data-testid="broker-hero" />,
}))
vi.mock('../components/EODRecap', () => ({
  default: () => <div data-testid="eod-recap" />,
}))
vi.mock('../components/HoldingsList', () => ({
  default: () => <div data-testid="holdings-list" />,
}))

import TodaySurface from './TodaySurface'

function renderToday() {
  return render(
    <MemoryRouter>
      <TodaySurface />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  market = { isOpen: false, isPremarket: false, isExtended: false }
  account = { id: 'a1', name: 'Default', balanceSource: 'broker' }
  accountId = 'a1'
  positions = [{ id: 'p1', symbol: 'NVDA', shares: 10, entryPrice: 100 }]
  optionStrategies = []
  comparison = [{ id: 'a1', tradeCount: 12 }]
  overview = {
    today: { date: '2026-07-10', trade_count: 3, net_pnl_dollar: 250, has_eod_recap: false },
    regime: 'Uptrend',
    week_to_date: { trade_count: 8, net_pnl_dollar: 900 },
    this_weeks_focus: 'Cut losers faster',
  }
  recaps = []
  disciplineState = null
  scopeActive = false
})

describe('TodaySurface — session leads (concrete account with data)', () => {
  it('premarket → the readiness lead renders (not the hero)', () => {
    market = { isOpen: false, isPremarket: true, isExtended: false }
    renderToday()
    expect(screen.getByTestId('today-premarket')).toBeInTheDocument()
    expect(screen.queryByTestId('broker-hero')).not.toBeInTheDocument()
  })

  it('market (broker account) → the BrokerAccountHero lead renders', () => {
    market = { isOpen: true, isPremarket: false, isExtended: false }
    renderToday()
    expect(screen.getByTestId('broker-hero')).toBeInTheDocument()
    expect(screen.queryByTestId('today-premarket')).not.toBeInTheDocument()
  })

  it('post-close → the EOD recap lead renders with a Generate CTA when no recap', () => {
    market = { isOpen: false, isPremarket: false, isExtended: false }
    recaps = []
    renderToday()
    expect(screen.getByTestId('today-postclose')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /generate today.s recap/i })).toBeInTheDocument()
  })

  it('post-close → the recap renders when one exists for today', () => {
    market = { isOpen: false, isPremarket: false, isExtended: false }
    recaps = [{ id: 'r1', day: '2026-07-10', body: 'Solid day.' }]
    renderToday()
    expect(screen.getByTestId('eod-recap')).toBeInTheDocument()
  })
})

describe('TodaySurface — zero-data / no-sync / all-accounts variants', () => {
  it('zeroData (0 positions + 0 options + 0 trades) → the guided checklist, NOT the hero', () => {
    market = { isOpen: true, isPremarket: false, isExtended: false }
    positions = []
    optionStrategies = []
    comparison = [{ id: 'a1', tradeCount: 0 }]
    renderToday()
    expect(screen.getByTestId('today-zero-data')).toBeInTheDocument()
    expect(screen.getByText(/import csv/i)).toBeInTheDocument()
    expect(screen.queryByTestId('broker-hero')).not.toBeInTheDocument()
  })

  it('no-sync manual account (market session) → manual day-P&L fallback, not the broker hero', () => {
    market = { isOpen: true, isPremarket: false, isExtended: false }
    account = { id: 'a1', name: 'Manual', balanceSource: 'manual' }
    renderToday()
    expect(screen.getByTestId('today-no-sync')).toBeInTheDocument()
    expect(screen.queryByTestId('broker-hero')).not.toBeInTheDocument()
  })

  it('all-accounts (accountId null) → the overview lead + "select an account" affordance', () => {
    accountId = null
    account = null
    market = { isOpen: true, isPremarket: false, isExtended: false }
    renderToday()
    expect(screen.getByTestId('today-all-accounts')).toBeInTheDocument()
    expect(screen.getByText(/select a single account/i)).toBeInTheDocument()
    expect(screen.queryByTestId('broker-hero')).not.toBeInTheDocument()
  })
})

describe('TodaySurface — scope note', () => {
  it('renders a muted "not applied on Today" note when a scope is active', () => {
    scopeActive = true
    renderToday()
    expect(screen.getByText(/scope filter isn't applied on today/i)).toBeInTheDocument()
  })

  it('renders no scope note when no scope is active', () => {
    scopeActive = false
    renderToday()
    expect(screen.queryByText(/scope filter isn't applied on today/i)).not.toBeInTheDocument()
  })
})
