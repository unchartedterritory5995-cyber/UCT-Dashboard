// app/src/pages/journal-2-0/a11y/pageLayouts.a11y.test.jsx
//
// P4a Task 8: page layouts through 8A's axe harness. Task 1 found that no population covers Today or the
// trade page, so this file registers the recipes for the surfaces P4a adds and OUTSIDE_POPULATION_SURFACES
// (notebookSurfaces.js) names them. The trade page's recipe is in pageLayoutsTrade.a11y.test.jsx, its own file
// because it must replace SWR itself, which would change what these recipes render.
//
// Recipes, each proving its state is on screen BEFORE axe runs so an empty render cannot pass as a clean one:
//   * page-layout-editor-premarket / -market / -postclose -- the Customize sheet on Today, one per phase tab,
//     over a saved layout (rows reordered and one hidden), the live region and the footer included;
//   * page-layout-editor-trade                              -- the same sheet for the trade page (no tabs);
//   * today-page-layout-panels                              -- TodaySurface with the page-layouts switch ON and
//     a saved market layout that shows all five new panels (Regime first), with the Customize button;
//   * today-page-layout-panels-states                       -- the same five panels in the states the first
//     recipe does not reach: no rules, no notices, All Accounts selected (My rules' "Pick an account" line).
//
// The leads and the four panels that existed before P4a (coach strip, week strip, goal progress) are stubs
// here; Quick actions, the Customize button, and the five new panels are the real components, over the real
// hooks, with only the network faked.
import { describe, beforeEach, afterEach, vi, expect } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import { installFetch, Providers } from './fixtures'
import { axeSurface } from './surface'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import { DEFAULT_LAYOUT, LAYOUT_PREF } from '../lib/pageLayouts'
import { todayET } from '../lib/calendar'
import fx from '../lib/__fixtures__/notices.json'

const { acct } = vi.hoisted(() => ({ acct: { id: 'a1', all: false } }))

vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: true, isPremarket: false, isExtended: false }) }))
vi.mock('../hooks/useJ2SelectedAccount', () => ({
  default: () => {
    const account = { id: 'a1', name: 'Main', balanceSource: 'manual' }
    return acct.all
      ? { accountId: null, account: null, accounts: [account], isAllAccounts: true, isLoading: false, setAccount: () => {} }
      : { accountId: 'a1', account, accounts: [account], isAllAccounts: false, isLoading: false, setAccount: () => {} }
  },
}))
vi.mock('../hooks/useJournalRules', () => ({
  default: () => ({
    rules: [
      { id: 'r1', label: 'Wait 15 minutes', evidence: null, version: 2, changedAt: '2026-10-02T15:00:00+00:00', beforeEntry: true, status: 'active' },
    ],
    mutate: () => {},
  }),
}))
vi.mock('../hooks/useJ2Positions', () => ({
  default: () => ({ positions: [{ id: 'p1', symbol: 'NVDA', shares: 10, entryPrice: 100 }], isLoading: false, error: null, refresh: () => {} }),
}))
vi.mock('../hooks/useJ2OptionStrategies', () => ({ default: () => ({ strategies: [], isLoading: false, error: null, refresh: () => {} }) }))
vi.mock('../hooks/useJ2AccountComparison', () => ({
  default: () => ({ accounts: [{ id: 'a1', tradeCount: 12 }], isLoading: false, error: null, refresh: () => {} }),
}))
vi.mock('../hooks/useCompassOverview', () => ({
  default: () => ({ overview: { today: {}, regime: 'Uptrend', week_to_date: {} }, isLoading: false, error: null, refresh: () => {} }),
}))
vi.mock('../hooks/useScope', () => ({ default: () => ({ isActive: false, scope: {}, activeCount: 0 }) }))
vi.mock('../hooks/useJ2EODRecaps', () => ({
  default: () => ({ recaps: [], isLoading: false, error: null, generate: () => {}, refresh: () => {} }),
}))
vi.mock('../hooks/useJ2DisciplineState', () => ({ default: () => ({ state: null, isLoading: false, error: null, refresh: () => {} }) }))
vi.mock('../hooks/useFirstReport', () => ({ default: () => ({ show: false, dismiss: () => {} }) }))
vi.mock('../../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, isStreaming: false, isLoading: false, staleSymbols: [] }),
}))
// Not under test: the leads, the modals, and the panels that existed before P4a.
vi.mock('../components/BrokerAccountHero', () => ({ default: () => <div /> }))
vi.mock('../components/EODRecap', () => ({ default: () => <div /> }))
vi.mock('../components/HoldingsList', () => ({ default: () => <div /> }))
vi.mock('../components/SyncFreshnessChip', () => ({ default: () => null }))
vi.mock('../components/ImportCsvModal', () => ({ default: () => null }))
vi.mock('../components/AddTradeModal', () => ({ default: () => null }))
vi.mock('../components/AddPositionModal', () => ({ default: () => null }))
vi.mock('../components/CoachStrip', () => ({ default: () => <section aria-label="Coach notes"><p>Coach notes</p></section> }))
vi.mock('../surfaces/today/TodayWeekStrip', () => ({ default: () => <section aria-label="This week"><p>This week</p></section> }))
vi.mock('../components/accounts/GoalProgress', () => ({ default: () => <section aria-label="Goal progress"><p>Goal progress</p></section> }))

import PageLayoutEditor from '../components/layout/PageLayoutEditor'
import TodaySurface from '../surfaces/TodaySurface'

const clone = (v) => JSON.parse(JSON.stringify(v))
const TODAY = todayET()

// A saved layout the editor and Today both read: the market list shows all five new panels, Regime first.
function savedLayout() {
  const layout = clone(DEFAULT_LAYOUT)
  const market = layout.today.market
  for (const e of market) e.shown = true
  const regime = market.splice(market.findIndex((e) => e.id === 'regime'), 1)[0]
  market.unshift(regime)
  // The premarket list hides one panel and puts another first, so that tab renders a mixed list too.
  layout.today.premarket.find((e) => e.id === 'notices').shown = true
  layout.today.premarket.unshift(layout.today.premarket.splice(layout.today.premarket.findIndex((e) => e.id === 'weekStrip'), 1)[0])
  layout.today.postclose.find((e) => e.id === 'todayNote').shown = true
  layout.trade.unshift(layout.trade.splice(layout.trade.findIndex((e) => e.id === 'story'), 1)[0])
  layout.trade.find((e) => e.id === 'review').shown = false
  return layout
}

const DAY = {
  metrics: null, trades: [], strategies: { closed: [], expiring: [] },
  notes: {
    notes: '', prepNotes: '', midDayNotes: '', recapNotes: '', attachments: [],
    rules: [
      { id: 'c1', label: 'Waited for confirmation', checked: false },
      { id: 'c2', label: 'Sized at 1R', checked: true },
    ],
  },
}

function routes(extra = []) {
  return installFetch([
    ...extra,
    [/^\/api\/auth\/preferences$/, { [LAYOUT_PREF]: JSON.stringify(savedLayout()) }],
    [/^\/api\/j2\/regime$/, { regime: 'amber', score: 62, source: 'wire', asOf: `${TODAY}T00:00:00Z` }],
    [new RegExp(`^/api/j2/calendar/day/${TODAY}$`), DAY],
    [/^\/api\/alerts$/, fx.alertsBody],
    [/^\/api\/voice\/insights$/, fx.insightsBody],
  ])
}

const settle = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags({ journal_page_layouts_enabled: true })
  acct.all = false
})
afterEach(() => __resetNotebookFlags())

describe('the Customize editor', () => {
  const editor = async (page, initialPhase, tabName) => {
    routes()
    render(<Providers route="/journal"><PageLayoutEditor page={page} initialPhase={initialPhase} onClose={() => {}} onSaved={() => {}} /></Providers>)
    // The sheet is rebuilt once the preference has loaded (the loading sheet is a different element), so the
    // dialog is read AFTER the rows are there, never before.
    await screen.findAllByRole('checkbox', { name: /^Show / })
    const dialog = screen.getByRole('dialog', { name: page === 'trade' ? 'Customize trade page' : 'Customize Today' })
    expect(within(dialog).getAllByRole('checkbox').length).toBeGreaterThanOrEqual(9)
    if (tabName) expect(within(dialog).getByRole('button', { name: tabName }).getAttribute('aria-pressed')).toBe('true')
    else expect(within(dialog).queryByRole('button', { name: 'Premarket' })).toBeNull()
    within(dialog).getByRole('button', { name: 'Save' })
    within(dialog).getByRole('button', { name: 'Cancel' })
    within(dialog).getByRole('button', { name: 'Reset to default' })
    expect(within(dialog).getByRole('status').getAttribute('aria-live')).toBe('polite')
    return dialog
  }

  axeSurface('page-layout-editor-premarket', async () => {
    const dialog = await editor('today', 'premarket', 'Premarket')
    // The reordered premarket list: This week first.
    expect(within(dialog).getAllByRole('checkbox')[0].getAttribute('aria-label')).toBe('Show This week')
  })

  axeSurface('page-layout-editor-market', async () => {
    const dialog = await editor('today', 'market', 'Market')
    // Market regime first, and every panel shown.
    const boxes = within(dialog).getAllByRole('checkbox')
    expect(boxes[0].getAttribute('aria-label')).toBe('Show Market regime')
    expect(boxes.every((b) => b.checked)).toBe(true)
  })

  axeSurface('page-layout-editor-postclose', async () => {
    const dialog = await editor('today', 'postclose', 'After close')
    expect(within(dialog).getByRole('checkbox', { name: "Show Today's note" }).checked).toBe(true)
  })

  axeSurface('page-layout-editor-trade', async () => {
    const dialog = await editor('trade', undefined, null)
    const boxes = within(dialog).getAllByRole('checkbox')
    expect(boxes[0].getAttribute('aria-label')).toBe('Show The story')
    expect(within(dialog).getByRole('checkbox', { name: 'Show Compass review' }).checked).toBe(false)
  })
})

describe('Today with the five new panels shown', () => {
  axeSurface('today-page-layout-panels', async () => {
    routes()
    const { container } = render(<Providers route="/journal"><TodaySurface /></Providers>)

    // Each of the five, proved from what it renders (a panel that failed to load says so in a muted line).
    await screen.findByRole('button', { name: /Customize/ })
    await screen.findByText('Yellow')                                                       // Market regime
    await screen.findByLabelText('Waited for confirmation')                                  // Checklist for today
    await screen.findByText('Wait 15 minutes')                                               // My rules (the lazy chunk loaded)
    await screen.findByRole('button', { name: "Open today's note" })                         // Today's note
    await screen.findByText(/^Notices · \d+$/)                                               // Notices
    // Regime is first among the five, as the saved layout says (each panel is a named region).
    const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const regime = screen.getByRole('region', { name: 'Market regime' })
    const rules = screen.getByRole('region', { name: 'My rules' })
    const note = screen.getByRole('region', { name: "Today's note" })
    const checklist = screen.getByRole('region', { name: 'Checklist for today' })
    expect(before(regime, checklist) && before(checklist, rules) && before(rules, note)).toBe(true)
    await settle()
    return { root: container }
  })

  axeSurface('today-page-layout-panels-states', async () => {
    acct.all = true
    routes([[/^\/api\/j2\/regime$/, [503, {}]], [/^\/api\/alerts$/, []], [/^\/api\/voice\/insights$/, { insights: [] }]])
    const { container } = render(<Providers route="/journal"><TodaySurface /></Providers>)
    await screen.findByRole('button', { name: /Customize/ })
    // All Accounts: My rules says so (the checklist still shows: day notes belong to the member, P4a m4); the
    // regime read failed and says that; no notices, no box.
    await screen.findByText('Pick an account to see its rules.')
    await screen.findByText('Market regime is not available right now.')
    await settle()
    expect(screen.queryByText(/^Notices · /)).toBeNull()
    return { root: container }
  })
})
