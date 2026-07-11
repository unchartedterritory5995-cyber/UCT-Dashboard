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
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Spies shared with the hoisted module mocks below.
const { mutateSpy, navigateSpy } = vi.hoisted(() => ({
  mutateSpy: vi.fn(),
  navigateSpy: vi.fn(),
}))

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
// Controls the isLoading flag of the three fetches behind useTodayState's
// zeroData signal — flip true to exercise the cold-cache loading gate (I1).
let loading = false

vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => market }))
vi.mock('../hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId, account, accounts: [account], setAccount: vi.fn(), isLoading: false }),
}))
vi.mock('../hooks/useJ2Positions', () => ({
  default: () => ({ positions, isLoading: loading, error: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useJ2OptionStrategies', () => ({
  default: () => ({ strategies: optionStrategies, isLoading: loading, error: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useJ2AccountComparison', () => ({
  default: () => ({ accounts: comparison, isLoading: loading, error: null, refresh: vi.fn() }),
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
// B2 CoachStrip is its own tested unit — stub it here so these routing tests
// stay about the lead-module state machine, not the coach-strip union sources.
vi.mock('../components/CoachStrip', () => ({
  default: () => <div data-testid="coach-strip-stub" />,
}))

// B3 secondary modules: the week strip + goals are their own units (WeekStrip
// has its own file; GoalProgress is pre-existing) — stub them so these tests
// assert TodaySurface's MOUNTING/GATING, not their internals. Quick actions are
// exercised for real (navigation + the log-trade shortcut).
vi.mock('./today/TodayWeekStrip', () => ({
  default: () => <div data-testid="today-week-strip" />,
}))
vi.mock('../components/accounts/GoalProgress', () => ({
  default: ({ account }) => <div data-testid="goal-progress">{account?.name}</div>,
}))

// Add-flow modals → stubs that expose a save button invoking `onSave`, so the
// B1 first-trade revalidation path is testable without the heavy real modals.
vi.mock('../components/AddTradeModal', () => ({
  default: ({ onSave }) => (
    <button type="button" data-testid="stub-save-trade" onClick={() => onSave({ symbol: 'NVDA', side: 'long' })}>
      save trade
    </button>
  ),
}))
vi.mock('../components/AddPositionModal', () => ({
  default: ({ onSave }) => (
    <button type="button" data-testid="stub-save-position" onClick={() => onSave({ symbol: 'NVDA', side: 'long' })}>
      save position
    </button>
  ),
}))

// Spy on the SWR global mutate (the B1 revalidation) + on router navigation
// (the quick-action shortcuts). Both keep the rest of each module real.
vi.mock('swr', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useSWRConfig: () => ({ mutate: mutateSpy }) }
})
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigateSpy }
})

import TodaySurface from './TodaySurface'

function renderToday() {
  return render(
    <MemoryRouter>
      <TodaySurface />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mutateSpy.mockClear()
  navigateSpy.mockClear()
  // Benign fetch stub — the B1 onSave posts a trade; the surface's other reads
  // are all mocked at the hook level.
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 't1', symbol: 'NVDA' }) }),
  )
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
  loading = false
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

describe('TodaySurface — B3 secondary modules (week strip / goals / quick actions)', () => {
  it('mounts the week strip + goals + quick actions for a concrete account', () => {
    // default beforeEach: concrete broker account, has data → not zero-data
    renderToday()
    expect(screen.getByTestId('today-week-strip')).toBeInTheDocument()
    expect(screen.getByTestId('goal-progress')).toBeInTheDocument()
    expect(screen.getByTestId('goal-progress')).toHaveTextContent('Default')
    expect(screen.getByTestId('qa-log-trade')).toBeInTheDocument()
    expect(screen.getByTestId('qa-open-journal')).toBeInTheDocument()
    expect(screen.getByTestId('qa-review-trade')).toBeInTheDocument()
  })

  it('hides GoalProgress on All-Accounts (needs a concrete account) but keeps the strip', () => {
    accountId = null
    account = null
    market = { isOpen: true, isPremarket: false, isExtended: false }
    renderToday()
    expect(screen.queryByTestId('goal-progress')).not.toBeInTheDocument()
    // the all-accounts lead already carries the "pick an account" affordance
    expect(screen.getByText(/select a single account/i)).toBeInTheDocument()
    // the week strip + quick actions still render (aggregate view)
    expect(screen.getByTestId('today-week-strip')).toBeInTheDocument()
    expect(screen.getByTestId('qa-log-trade')).toBeInTheDocument()
  })

  it('suppresses ALL secondary modules on the zero-data experience', () => {
    market = { isOpen: true, isPremarket: false, isExtended: false }
    positions = []
    optionStrategies = []
    comparison = [{ id: 'a1', tradeCount: 0 }]
    renderToday()
    expect(screen.getByTestId('today-zero-data')).toBeInTheDocument()
    expect(screen.queryByTestId('today-week-strip')).not.toBeInTheDocument()
    expect(screen.queryByTestId('goal-progress')).not.toBeInTheDocument()
    expect(screen.queryByTestId('qa-log-trade')).not.toBeInTheDocument()
  })

  it('quick action "Open Journal" navigates to /journal/journal', () => {
    renderToday()
    fireEvent.click(screen.getByTestId('qa-open-journal'))
    expect(navigateSpy).toHaveBeenCalledWith('/journal/journal')
  })

  it('quick action "Review a trade" navigates to the closed-trades segment', () => {
    renderToday()
    fireEvent.click(screen.getByTestId('qa-review-trade'))
    expect(navigateSpy).toHaveBeenCalledWith('/journal/trades?seg=closed')
  })

  it('quick action "Log trade" opens the add flow', () => {
    renderToday()
    expect(screen.queryByTestId('stub-save-trade')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('qa-log-trade'))
    expect(screen.getByTestId('stub-save-trade')).toBeInTheDocument()
  })
})

describe('TodaySurface — B1 first-trade revalidation fix', () => {
  it('mutates the comparison + overview SWR keys after AddTradeModal onSave', async () => {
    renderToday()
    // open the add flow, then invoke the modal's onSave via the stub
    fireEvent.click(screen.getByTestId('qa-log-trade'))
    fireEvent.click(screen.getByTestId('stub-save-trade'))

    await waitFor(() => expect(mutateSpy).toHaveBeenCalled())
    const predicates = mutateSpy.mock.calls.map((c) => c[0]).filter((f) => typeof f === 'function')
    // the comparison key (zero-data signal) is revalidated
    expect(predicates.some((f) => f('/api/j2/accounts/comparison'))).toBe(true)
    // the coach overview key (lead + coach strip source) is revalidated
    expect(predicates.some((f) => f('/api/j2/accounts/a1/coach/overview'))).toBe(true)
    // and the predicates are specific — comparison predicate must NOT also match
    // the overview key (and vice-versa)
    const comparisonPred = predicates.find((f) => f('/api/j2/accounts/comparison'))
    expect(comparisonPred('/api/j2/accounts/a1/coach/overview')).toBe(false)
  })

  it('mutates the comparison + overview SWR keys after AddPositionModal onSave', async () => {
    // A manual account in the market session lands on the no-sync lead, which
    // exposes a "Log a position" quick-entry → the AddPositionModal path.
    market = { isOpen: true, isPremarket: false, isExtended: false }
    account = { id: 'a1', name: 'Manual', balanceSource: 'manual' }
    renderToday()
    fireEvent.click(screen.getByRole('button', { name: /log a position/i }))
    fireEvent.click(screen.getByTestId('stub-save-position'))

    await waitFor(() => expect(mutateSpy).toHaveBeenCalled())
    const predicates = mutateSpy.mock.calls.map((c) => c[0]).filter((f) => typeof f === 'function')
    expect(predicates.some((f) => f('/api/j2/accounts/comparison'))).toBe(true)
    expect(predicates.some((f) => f('/api/j2/accounts/a1/coach/overview'))).toBe(true)
  })
})

describe('TodaySurface — I1 cold-cache loading gate', () => {
  it('shows a skeleton (NOT the zeroData checklist) while the fetches are loading', () => {
    // Cold SWR cache: hooks report loading AND default to empty — the pre-fix
    // bug would compute zeroData=true here and flash the fresh-account checklist
    // to an established broker user. The loading gate must win.
    loading = true
    positions = []
    optionStrategies = []
    comparison = []
    market = { isOpen: true, isPremarket: false, isExtended: false }
    renderToday()
    expect(screen.getByTestId('today-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('today-zero-data')).not.toBeInTheDocument()
    // and no lead / secondary modules leak through during the skeleton
    expect(screen.queryByTestId('broker-hero')).not.toBeInTheDocument()
    expect(screen.queryByTestId('today-week-strip')).not.toBeInTheDocument()
  })

  it('once settled with data, renders the real lead (no skeleton)', () => {
    loading = false
    market = { isOpen: true, isPremarket: false, isExtended: false }
    // default beforeEach data: concrete broker account with positions + trades
    renderToday()
    expect(screen.queryByTestId('today-loading')).not.toBeInTheDocument()
    expect(screen.getByTestId('broker-hero')).toBeInTheDocument()
  })

  it('once settled with a genuinely empty account, DOES show the zeroData checklist', () => {
    loading = false
    market = { isOpen: true, isPremarket: false, isExtended: false }
    positions = []
    optionStrategies = []
    comparison = [{ id: 'a1', tradeCount: 0 }]
    renderToday()
    expect(screen.queryByTestId('today-loading')).not.toBeInTheDocument()
    expect(screen.getByTestId('today-zero-data')).toBeInTheDocument()
  })
})

describe('TodaySurface — premarket lock is informational (no dead override)', () => {
  it('renders a read-only lock summary with NO Override button when locked', () => {
    market = { isOpen: false, isPremarket: true, isExtended: false }
    disciplineState = {
      locked: true,
      reasons: [{ type: 'daily_loss', message: 'Daily loss cap hit', unlockAt: null }],
    }
    renderToday()
    expect(screen.getByTestId('today-premarket')).toBeInTheDocument()
    expect(screen.getByTestId('premarket-lock-note')).toBeInTheDocument()
    expect(screen.getByText(/daily loss cap hit/i)).toBeInTheDocument()
    // the dead override affordance must be gone from Today's informational card
    expect(screen.queryByRole('button', { name: /override/i })).not.toBeInTheDocument()
  })

  it('renders no lock summary when discipline state is unlocked/absent', () => {
    market = { isOpen: false, isPremarket: true, isExtended: false }
    disciplineState = null
    renderToday()
    expect(screen.getByTestId('today-premarket')).toBeInTheDocument()
    expect(screen.queryByTestId('premarket-lock-note')).not.toBeInTheDocument()
  })
})
