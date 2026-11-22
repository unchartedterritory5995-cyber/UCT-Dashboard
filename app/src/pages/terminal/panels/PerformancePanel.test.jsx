// PERF: the member's own trading stats from the Journal. Rails:
//   * the pure shaping: which account (typed here, else the Journal's own pick, else the first),
//     the URLs, the headline stats with the sample beside every ratio, the by-setup rows (best
//     expectancy first), the equity points and the line drawn from them;
//   * PERSONAL DATA: every read is one of the member's own `/api/j2/` routes, and an account is
//     written into the command by its place in the list, never by its id;
//   * HONEST STATES: loading; a failed read (error with Retry); locked (402, 404); signed out
//     (401); no journal account; an account with no closed trades; a ratio the server withholds
//     says "Not enough trades yet (n of m)", never 0 or a dash; a small sample is marked; trades
//     with no stop say how many use True R and how many have no R at all;
//   * the two data reads fail apart: one failing never blanks the other, and never reads as zero;
//   * the account picker switches the reads and writes itself into the command only where the
//     registry takes the word.
// The fixtures are the routes' real shapes (api/services/journal_two/accounts.py,
// metrics_registry.py, analytics.py), with made-up accounts, setups and numbers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import PerformancePanel, {
  ACCOUNTS_URL, ALL_ACCOUNTS, ANALYTICS_URL, CONFIDENCE_MIN, HEADLINE_CARD, HEADLINE_NUMBERS, JOURNAL_ACCOUNT_KEY, METRICS_REGISTRY_URL,
  METRICS_URL, PERFORMANCE_CODE, accountsRead, analyticsRead, analyticsUrl, curveGeometry, equityCurve, headlineStats, metricsRead,
  metricsRequest, metricsUrl, parsePerformanceAccount, performanceCommandArgs, pickAccount, rSourcesSentence, registryRead, sampleText,
  setupRows, statValueText,
} from './PerformancePanel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { allThemes, auditCss } from '../a11y/__tests__/terminalContrast'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SOURCE = 'Your journal'
const account = (id, name, extra = {}) => ({
  id, userId: 'u-test', name, color: 'gold', broker: null, startingBalance: 100000.0, goals: {}, compassEnabled: true,
  balanceSource: 'manual', brokerTotalEquity: null, brokerCash: null, brokerBuyingPower: null, brokerMarketValue: null,
  brokerBalanceSyncedAt: null, createdAt: '2026-01-05T15:00:00+00:00', updatedAt: '2026-01-05T15:00:00+00:00', ...extra,
})
const ONE_ACCOUNT = { accounts: [account('acc-1', 'Default')] }
const TWO_ACCOUNTS = {
  accounts: [account('acc-1', 'Default'), account('acc-2', 'Broker account', { broker: 'Example Broker', balanceSource: 'broker', brokerTotalEquity: 52000.5 })],
}
const VOCABULARY = ['net_pnl', 'gross_pnl', 'fees', 'trades', 'wins', 'losses', 'win_rate', 'avg_win', 'avg_loss', 'payoff', 'profit_factor',
  'expectancy', 'days_traded', 'profitable_days', 'avg_true_r', 'max_drawdown']
const REGISTRY = [
  { key: 'consistency', title: 'Consistency', description: 'Profitable-day %, daily P&L volatility.', category: 'discipline' },
  { key: 'payoff_kelly', title: 'Payoff & Kelly', description: 'Average win vs average loss.', category: 'risk' },
  { key: 'custom', title: 'Custom KPI', description: `Your own formula over: ${VOCABULARY.join(', ')}`, category: 'custom', vocabulary: VOCABULARY },
]
const kpi = (name, value, error = null) => ({ name, expr: name, value, error })
const METRICS = {
  metrics: { payoff_kelly: { decisive: 23, minDecisive: 20, avgWin: 420.5, avgLoss: 180.25, payoff: 2.333, winRate: 0.6087, kelly: 0.441, halfKelly: 0.2205 } },
  custom: [kpi('wins', 14), kpi('losses', 9), kpi('profit_factor', 3.6289), kpi('expectancy', 177.7917)],
  unknownKeys: [],
  tradeCount: 24,
  rSources: { stop: 15, trueR: 6, none: 3 },
}
const setup = (name, totalPnl, winRate, avgR, n) => ({ setup: name, totalPnl, winRate, avgR, tradeCount: n, sampleSize: n, lowConfidence: n < 10 })
const ANALYTICS = {
  tradeCount: 24,
  strategyCount: 0,
  dateRange: { from: null, to: null },
  rSources: { stop: 15, trueR: 6, none: 3 },
  equity: {
    kpis: { peakPnl: 4250.0, maxDrawdown: -450.0, maxDrawdownPct: -0.004489, currentDrawdown: 0.0, longestUnderwaterDays: 1 },
    curve: [
      { date: '2026-09-01', equity: 100250.0, drawdown: 0.0 }, { date: '2026-09-15', equity: 99800.0, drawdown: -450.0 },
      { date: '2026-10-20', equity: 102400.0, drawdown: 0.0 }, { date: '2026-11-13', equity: 104250.0, drawdown: 0.0 },
    ],
  },
  attribution: {
    // the server's order is total profit first; the panel's is expectancy first
    bySetup: [setup('Breakout', 3600.0, 0.6667, 0.85, 12), setup('Pullback', 900.0, 0.5, null, 2), setup('Earnings gap', -400.0, 0.25, -0.3, 4)],
    bySymbol: [],
    rollingWinRate: { windows: {} },
  },
  edgeScore: { score: 1.2345, components: { winRate: 0.6087, profitFactor: 3.629, rConsistency: 0.5589, tradeCount: 24 }, trend: [] },
  risk: {
    coverageReady: true, tradeCount: 24, decisiveCount: 23, noRCount: 3, rHistogram: [], expectancyR: 0.412,
    drawdown: { maxDrawdownDollar: 450.0, currentDrawdownDollar: 0.0, peakDate: '2026-09-01', troughDate: '2026-09-15' },
    streaks: { longestWin: 5, longestLoss: 2, current: { type: 'win', length: 2 } },
    lossStreakOdds: { winRate: 0.6087, k: 5, perYear: 1.4 },
  },
}
/** Six closed trades, every one a broker import with no stop: the server withholds what it withholds. */
const METRICS_FEW = {
  metrics: { payoff_kelly: { decisive: 6, minDecisive: 20, avgWin: 300.0, avgLoss: 150.0, payoff: 2.0, winRate: 0.6667, kelly: null, halfKelly: null } },
  custom: [kpi('wins', 4), kpi('losses', 2), kpi('profit_factor', 4.0), kpi('expectancy', 150.0)],
  unknownKeys: [],
  tradeCount: 6,
  rSources: { stop: 0, trueR: 4, none: 2 },
}
const ANALYTICS_FEW = {
  ...ANALYTICS,
  tradeCount: 6,
  rSources: { stop: 0, trueR: 4, none: 2 },
  equity: { kpis: ANALYTICS.equity.kpis, curve: [{ date: '2026-11-13', equity: 52900.0, drawdown: 0.0 }] },
  attribution: { bySetup: [], bySymbol: [], rollingWinRate: { windows: {} } },
  edgeScore: { score: null, components: { winRate: 0.6667, profitFactor: 4.0, rConsistency: 0.8, tradeCount: 6 }, trend: [] },
  risk: { coverageReady: false, tradeCount: 6, decisiveCount: 6, noRCount: 2, rHistogram: null, expectancyR: null, drawdown: null, streaks: null, lossStreakOdds: null },
}
const METRICS_NONE = {
  metrics: { payoff_kelly: { decisive: 0, minDecisive: 20, avgWin: null, avgLoss: null, payoff: null, winRate: null, kelly: null, halfKelly: null } },
  custom: [kpi('wins', 0), kpi('losses', 0), kpi('profit_factor', null), kpi('expectancy', null)],
  unknownKeys: [],
  tradeCount: 0,
  rSources: { stop: 0, trueR: 0, none: 0 },
}
const ANALYTICS_NONE = {
  ...ANALYTICS,
  tradeCount: 0,
  strategyCount: 0,
  rSources: { stop: 0, trueR: 0, none: 0 },
  equity: { kpis: { peakPnl: 0.0, maxDrawdown: 0.0, maxDrawdownPct: 0.0, currentDrawdown: 0.0, longestUnderwaterDays: 0 }, curve: [] },
  attribution: { bySetup: [], bySymbol: [], rollingWinRate: { windows: {} } },
  edgeScore: { score: null, components: null, trend: [] },
  risk: { coverageReady: false, tradeCount: 0, decisiveCount: 0, noRCount: 0, rHistogram: null, expectancyR: null, drawdown: null, streaks: null, lossStreakOdds: null },
}

const M1 = metricsUrl({ accountId: 'acc-1', registry: registryRead(REGISTRY) })
const A1 = analyticsUrl({ accountId: 'acc-1' })
const M2 = metricsUrl({ accountId: 'acc-2', registry: registryRead(REGISTRY) })
const A2 = analyticsUrl({ accountId: 'acc-2' })
const M_ALL = metricsUrl({ registry: registryRead(REGISTRY) })
const A_ALL = analyticsUrl()
const BASE = { [ACCOUNTS_URL]: ONE_ACCOUNT, [METRICS_REGISTRY_URL]: REGISTRY }
const FULL = { ...BASE, [M1]: METRICS, [A1]: ANALYTICS }

const fail = (status) => Object.assign(new Error(`http ${status}`), { status })
const PENDING = Symbol('pending')
/** Serves each URL its body (an Error is thrown, PENDING never answers); anything else is a 500. */
function serve(routes) {
  jsonFetcher.mockImplementation((url) => {
    if (!(url in routes)) return Promise.reject(fail(500))
    const hit = routes[url]
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => jsonFetcher.mock.calls.map(([url]) => url)

function renderPanel(props = {}, { open = vi.fn(), rerun = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const body = <PerformancePanel {...props} />
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run: vi.fn(), rerun, publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { open, rerun, setFreshness }
}
const statText = (key) => screen.getByTestId(`terminal-perf-stat-${key}`).textContent
const statState = (key) => screen.getByTestId(`terminal-perf-stat-${key}`).getAttribute('data-state')
const setupCells = () => screen.getAllByTestId('terminal-perf-setup-row').map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))
const HERE = path.dirname(fileURLToPath(import.meta.url))
const byKey = (stats) => Object.fromEntries(stats.map((s) => [s.key, s]))

beforeEach(() => { jsonFetcher.mockReset(); window.localStorage.clear() })
afterEach(cleanup)

describe('PERF pure shaping: the account and the URLs', () => {
  it('the four routes are the member\'s own Journal routes', () => {
    expect(PERFORMANCE_CODE).toBe('PERF')
    expect([ACCOUNTS_URL, METRICS_REGISTRY_URL, METRICS_URL, ANALYTICS_URL])
      .toEqual(['/api/j2/accounts', '/api/j2/metrics/registry', '/api/j2/metrics', '/api/j2/analytics'])
    expect(JOURNAL_ACCOUNT_KEY).toBe('uct.j2.selectedAccountId')
    expect(ALL_ACCOUNTS).toBe('_all_')
    expect(CONFIDENCE_MIN).toBe(10)
    expect(M1).toBe('/api/j2/metrics?keys=payoff_kelly&kpi=wins%3Awins&kpi=losses%3Alosses&kpi=profit_factor%3Aprofit_factor&kpi=expectancy%3Aexpectancy&account_id=acc-1')
    expect(A1).toBe('/api/j2/analytics?account_id=acc-1')
    expect(M_ALL).toBe('/api/j2/metrics?keys=payoff_kelly&kpi=wins%3Awins&kpi=losses%3Alosses&kpi=profit_factor%3Aprofit_factor&kpi=expectancy%3Aexpectancy')
    expect(A_ALL).toBe('/api/j2/analytics')
    expect(analyticsUrl({ accountId: 'a b&c' })).toBe('/api/j2/analytics?account_id=a%20b%26c')
  })

  it('an account is typed and written back by its place in the list, never by its id', () => {
    for (const [raw, want] of [['ALL', 'all'], ['all', 'all'], [' All ', 'all'], ['1', 1], ['2', 2], [3, 3], ['07', 7], ['99', 99]]) {
      expect(parsePerformanceAccount(raw), String(raw)).toBe(want)
    }
    for (const bad of [null, undefined, '', '0', '-1', '100', '1.5', 'acc-1', 'two', 'toString', {}]) expect(parsePerformanceAccount(bad), String(bad)).toBeNull()
    expect(performanceCommandArgs({ account: 'all' })).toEqual(['ALL'])
    expect(performanceCommandArgs({ account: 2 })).toEqual(['2'])
    expect(performanceCommandArgs({ account: 'acc-2' })).toEqual([])
    expect(performanceCommandArgs()).toEqual([])
    // every token the picker writes is a word the reader gives back as the same choice
    for (const choice of ['all', 1, 2, 12]) expect(parsePerformanceAccount(performanceCommandArgs({ account: choice })[0])).toBe(choice)
  })

  it('accountsRead keeps what the panel needs, and says when the answer is not an accounts list', () => {
    const out = accountsRead(TWO_ACCOUNTS)
    expect(out).toEqual({
      state: 'ok',
      accounts: [
        { id: 'acc-1', name: 'Default', broker: null, brokerLinked: false, anchored: false },
        { id: 'acc-2', name: 'Broker account', broker: 'Example Broker', brokerLinked: true, anchored: true },
      ],
    })
    // a broker account whose balance has not synced is linked, but its curve is not anchored
    expect(accountsRead({ accounts: [account('x', '', { balanceSource: 'broker' }), { name: 'no id' }, null] }).accounts)
      .toEqual([{ id: 'x', name: 'Account 1', broker: null, brokerLinked: true, anchored: false }])
    expect(accountsRead({ accounts: [] })).toEqual({ state: 'ok', accounts: [] })
    for (const body of [undefined, null, [], 'x', {}, { accounts: 'none' }, { detail: 'Not authenticated' }]) expect(accountsRead(body).state).toBe('failed')
  })

  it('pickAccount: what was typed here, else the Journal\'s own pick, else the first account', () => {
    const { accounts } = accountsRead(TWO_ACCOUNTS)
    expect(pickAccount(accounts)).toMatchObject({ mode: 'one', ordinal: 1, missing: null, account: { id: 'acc-1' } })
    expect(pickAccount(accounts, { stored: 'acc-2' })).toMatchObject({ mode: 'one', ordinal: 2, account: { id: 'acc-2' } })
    expect(pickAccount(accounts, { stored: ALL_ACCOUNTS })).toMatchObject({ mode: 'all', account: null, ordinal: null })
    expect(pickAccount(accounts, { stored: 'deleted-account' })).toMatchObject({ mode: 'one', ordinal: 1 })
    // a choice made here wins over the Journal's pick
    expect(pickAccount(accounts, { choice: 1, stored: 'acc-2' })).toMatchObject({ mode: 'one', ordinal: 1 })
    expect(pickAccount(accounts, { choice: 'all', stored: 'acc-2' })).toMatchObject({ mode: 'all' })
    expect(pickAccount(accounts, { choice: '2' })).toMatchObject({ mode: 'one', ordinal: 2 })
    // a place the list does not have falls back to the Journal's pick, and says which was asked
    expect(pickAccount(accounts, { choice: 5, stored: 'acc-2' })).toMatchObject({ mode: 'one', ordinal: 2, missing: 5 })
    expect(pickAccount(accounts, { choice: 5, stored: ALL_ACCOUNTS })).toMatchObject({ mode: 'all', missing: 5 })
    expect(pickAccount([], { choice: 'all' })).toEqual({ mode: null, account: null, ordinal: null, missing: null })
    expect(pickAccount(null)).toEqual({ mode: null, account: null, ordinal: null, missing: null })
  })

  it('the metrics request asks only for what the registry offers, and for everything when it is unread', () => {
    const reg = registryRead(REGISTRY)
    expect(reg.state).toBe('ok')
    expect(reg.cards.map((c) => c.key)).toEqual(['consistency', 'payoff_kelly'])
    expect(reg.cards[1]).toEqual({ key: 'payoff_kelly', title: 'Payoff & Kelly', description: 'Average win vs average loss.', category: 'risk' })
    expect(reg.vocabulary).toEqual(VOCABULARY)
    expect([HEADLINE_CARD, [...HEADLINE_NUMBERS]]).toEqual(['payoff_kelly', ['wins', 'losses', 'profit_factor', 'expectancy']])
    expect(metricsRequest(reg)).toEqual({ keys: ['payoff_kelly'], numbers: ['wins', 'losses', 'profit_factor', 'expectancy'] })
    const older = registryRead([{ key: 'consistency', title: 'Consistency' }, { key: 'custom', vocabulary: ['wins', 'losses', 'expectancy'] }])
    expect(metricsRequest(older)).toEqual({ keys: [], numbers: ['wins', 'losses', 'expectancy'] })
    expect(metricsUrl({ accountId: 'acc-1', registry: older })).toBe('/api/j2/metrics?keys=&kpi=wins%3Awins&kpi=losses%3Alosses&kpi=expectancy%3Aexpectancy&account_id=acc-1')
    for (const body of [undefined, null, {}, 'x', { detail: 'nope' }]) {
      expect(registryRead(body).state).toBe('failed')
      expect(metricsRequest(registryRead(body))).toEqual({ keys: ['payoff_kelly'], numbers: ['wins', 'losses', 'profit_factor', 'expectancy'] })
    }
    expect(metricsUrl({ accountId: 'acc-1' })).toBe(M1)
  })
})

describe('PERF pure shaping: the numbers', () => {
  it('metricsRead and analyticsRead cut the payloads to what the panel states', () => {
    const m = metricsRead(METRICS)
    expect(m).toMatchObject({ state: 'ok', trades: 24, card: { decisive: 23, winRate: 0.6087, avgWin: 420.5, avgLoss: 180.25 }, rSources: { stop: 15, trueR: 6, none: 3 } })
    expect(m.numbers).toEqual({
      wins: { value: 14, error: null }, losses: { value: 9, error: null }, profit_factor: { value: 3.6289, error: null }, expectancy: { value: 177.7917, error: null },
    })
    const a = analyticsRead(ANALYTICS)
    expect(a).toMatchObject({
      state: 'ok', trades: 24, strategies: 0, untagged: 6, rSources: { stop: 15, trueR: 6, none: 3 },
      edge: { score: 1.2345, tradeCount: 24, hasParts: true }, risk: { ready: true, decisive: 23, noR: 3, expectancyR: 0.412 },
    })
    expect(a.curve).toHaveLength(4)
    for (const body of [undefined, null, [], 'x', {}, { metrics: {} }, { tradeCount: 3 }, { detail: 'Not authenticated' }]) expect(metricsRead(body).state).toBe('failed')
    for (const body of [undefined, null, [], 'x', {}, { tradeCount: 'many' }, { detail: 'Not authenticated' }]) expect(analyticsRead(body).state).toBe('failed')
    // a payload with no by-setup list cannot say how many trades are untagged
    expect(analyticsRead({ tradeCount: 3 })).toMatchObject({ state: 'ok', trades: 3, untagged: null, setups: [], curve: [], edge: null, risk: null })
  })

  it('headlineStats: every ratio carries its sample, and a small one is marked', () => {
    const s = byKey(headlineStats({ metrics: metricsRead(METRICS), analytics: analyticsRead(ANALYTICS) }))
    expect(Object.keys(s)).toEqual(['trades', 'winRate', 'avgWin', 'avgLoss', 'expectancy', 'expectancyR', 'profitFactor', 'edge'])
    expect(s.trades).toMatchObject({ state: 'ok', value: 24, kind: 'count', from: 'either' })
    expect(s.winRate).toMatchObject({ state: 'ok', n: 23, min: 10, of: 'wins and losses', kind: 'pct', from: 'metrics' })
    expect(s.winRate.value).toBeCloseTo(60.87, 6)
    expect(s.avgWin).toMatchObject({ state: 'ok', value: 420.5, n: 14, of: 'wins', kind: 'usd' })
    // nine losing trades is under the Journal's confidence line of ten: shown, and marked
    expect(s.avgLoss).toMatchObject({ state: 'thin', value: -180.25, n: 9, min: 10, of: 'losses', kind: 'usd' })
    expect(s.expectancy).toMatchObject({ state: 'ok', value: 177.7917, n: 24, of: 'trades', kind: 'signedUsd' })
    expect(s.expectancyR).toMatchObject({ state: 'ok', value: 0.412, n: 21, of: 'trades with a known R', kind: 'r', from: 'analytics' })
    expect(s.profitFactor).toMatchObject({ state: 'ok', value: 3.6289, n: 23, of: 'wins and losses', kind: 'ratio' })
    expect(s.edge).toMatchObject({ state: 'ok', value: 1.2345, n: 24, of: 'trades', kind: 'score', from: 'analytics' })
    expect(Object.values(s).map((x) => statValueText(x))).toEqual(['24', '60.9%', '$420.50', '-$180.25', '+$177.79', '+0.41R', '3.63', '1.23'])
    expect(Object.values(s).map((x) => sampleText(x))).toEqual([
      '', 'From 23 wins and losses.', 'From 14 wins.', 'Small sample: 9 losses, 10 needed.', 'From 24 trades.', 'From 21 trades with a known R.',
      'From 23 wins and losses.', 'From 24 trades.',
    ])
  })

  it('headlineStats: what the server withholds is "not enough trades yet (n of m)", never a zero', () => {
    const s = byKey(headlineStats({ metrics: metricsRead(METRICS_FEW), analytics: analyticsRead(ANALYTICS_FEW) }))
    expect(s.expectancyR).toMatchObject({ state: 'short', value: null, n: 6, min: 10 })
    expect(s.edge).toMatchObject({ state: 'short', value: null, n: 6, min: 10 })
    expect(sampleText(s.expectancyR)).toBe('Not enough trades yet (6 of 10).')
    expect(sampleText(s.edge)).toBe('Not enough trades yet (6 of 10).')
    expect(statValueText(s.expectancyR)).toBeNull()
    expect(statValueText(s.edge)).toBeNull()
    // the server does send these from six trades: shown with the sample, marked small
    expect(s.winRate).toMatchObject({ state: 'thin', n: 6 })
    expect(sampleText(s.winRate)).toBe('Small sample: 6 wins and losses, 10 needed.')
    expect(sampleText(s.avgWin)).toBe('Small sample: 4 wins, 10 needed.')
    expect(sampleText(s.avgLoss)).toBe('Small sample: 2 losses, 10 needed.')
    expect(sampleText({ state: 'thin', n: 1, min: 10, of: 'wins and losses' })).toBe('Small sample: 1 win or loss, 10 needed.')
    expect(sampleText({ state: 'ok', n: 1, min: 10, of: 'trades with a known R' })).toBe('From 1 trade with a known R.')
    expect(sampleText({ state: 'short', n: 1234, min: 10 }, (n) => `<${n}>`)).toBe('Not enough trades yet (<1234> of <10>).')
    expect(sampleText(null)).toBe('')
    // ten trades but fewer than two known R values: a different reason, said as one
    const noR = analyticsRead({ ...ANALYTICS, edgeScore: { score: null, components: { winRate: 0.5, profitFactor: 1.2, rConsistency: null, tradeCount: 12 }, trend: [] }, risk: { ...ANALYTICS.risk, expectancyR: null, noRCount: 24 } })
    const t = byKey(headlineStats({ metrics: metricsRead(METRICS), analytics: noR }))
    expect(t.edge).toMatchObject({ state: 'none', why: 'It needs at least 2 trades with a known R.' })
    expect(t.expectancyR).toMatchObject({ state: 'none', why: 'No trade has a known R yet.' })
  })

  it('headlineStats: nothing to work a number out from says what is missing; an unread source says so', () => {
    const s = byKey(headlineStats({ metrics: metricsRead(METRICS_NONE), analytics: analyticsRead(ANALYTICS_NONE) }))
    expect(s.trades).toMatchObject({ state: 'ok', value: 0 })
    expect(s.winRate).toMatchObject({ state: 'none', why: 'No winning or losing trades yet.' })
    expect(s.avgWin).toMatchObject({ state: 'none', why: 'No winning trades yet.' })
    expect(s.avgLoss).toMatchObject({ state: 'none', why: 'No losing trades yet.' })
    expect(s.expectancy).toMatchObject({ state: 'none', why: 'No closed trades yet.' })
    expect(s.profitFactor).toMatchObject({ state: 'none', why: 'No losing trades yet, so there is no profit factor.' })
    expect(s.edge).toMatchObject({ state: 'none', why: 'No winning or losing trades yet.' })
    expect(s.expectancyR).toMatchObject({ state: 'short', n: 0, min: 10 })
    for (const x of Object.values(s)) if (x.key !== 'trades') expect(statValueText(x), x.key).toBeNull()
    // a number the server does not know, and a card it did not send, are "not served", never zero
    const older = metricsRead({ ...METRICS, metrics: {}, custom: [kpi('profit_factor', null, "unknown variable 'profit_factor'")] })
    const o = byKey(headlineStats({ metrics: older, analytics: analyticsRead(ANALYTICS) }))
    for (const key of ['winRate', 'avgWin', 'avgLoss', 'expectancy', 'profitFactor']) {
      expect(o[key], key).toMatchObject({ state: 'none', value: null, why: 'This server does not serve this number.' })
    }
    // one read missing: its stats are unread, the other read's stats stand
    const half = byKey(headlineStats({ metrics: null, analytics: analyticsRead(ANALYTICS) }))
    expect(half.trades).toMatchObject({ state: 'ok', value: 24 })
    expect(half.edge.state).toBe('ok')
    for (const key of ['winRate', 'avgWin', 'avgLoss', 'expectancy', 'profitFactor']) expect(half[key].state, key).toBe('unread')
    expect(sampleText(half.winRate)).toBe('Could not be read.')
    const other = byKey(headlineStats({ metrics: metricsRead(METRICS), analytics: { state: 'failed' } }))
    expect([other.trades.value, other.winRate.state, other.expectancyR.state, other.edge.state]).toEqual([24, 'ok', 'unread', 'unread'])
    expect(headlineStats().every((x) => x.state === 'unread' && x.value === null)).toBe(true)
  })

  it('rSourcesSentence says how many trades use a logged stop, True R, or have no R at all', () => {
    expect(rSourcesSentence({ stop: 15, trueR: 6, none: 3 })).toBe(
      'R is known for 21 of 24 trades. 15 trades use the stop you logged. 6 trades had no stop logged (a broker import carries none), so their R is '
      + "True R: the result against the trade's own worst drawdown. 3 trades have no R at all (no stop logged and no True R worked out yet), so they "
      + 'are left out of every R number, never counted as zero.',
    )
    expect(rSourcesSentence({ stop: 1, trueR: 1, none: 1 })).toBe(
      'R is known for 2 of 3 trades. 1 trade uses the stop you logged. 1 trade had no stop logged (a broker import carries none), so its R is '
      + "True R: the result against the trade's own worst drawdown. 1 trade has no R at all (no stop logged and no True R worked out yet), so it is "
      + 'left out of every R number, never counted as zero.',
    )
    expect(rSourcesSentence({ stop: 8, trueR: 0, none: 0 })).toBe('R is known for 8 of 8 trades. 8 trades use the stop you logged.')
    expect(rSourcesSentence({ stop: 0, trueR: 0, none: 0 })).toBe('')
    expect(rSourcesSentence(null)).toBe('')
  })

  it('setupRows: best expectancy first, the sample kept beside it, a missing ratio left missing', () => {
    const rows = setupRows(ANALYTICS)
    expect(rows.map((r) => [r.setup, r.trades, r.expectancy, r.lowConfidence])).toEqual([
      ['Pullback', 2, 450, true], ['Breakout', 12, 300, false], ['Earnings gap', 4, -100, true],
    ])
    expect(rows[0]).toMatchObject({ winRatePct: 50, avgR: null, totalPnl: 900 })
    expect(rows[1].winRatePct).toBeCloseTo(66.67, 6)
    expect(rows[2]).toMatchObject({ winRatePct: 25, avgR: -0.3, totalPnl: -400 })
    expect(new Set(rows.map((r) => r.key)).size).toBe(3)
    const odd = setupRows({ attribution: { bySetup: [
      { setup: 'Zero', totalPnl: 0, winRate: null, avgR: null, tradeCount: 0 }, { setup: '  ', totalPnl: 5, tradeCount: 1 }, null,
      { setup: 'Tie B', totalPnl: 100, winRate: 1, tradeCount: 2 }, { setup: 'Tie A', totalPnl: 250, winRate: 1, tradeCount: 5 }, { setup: 'Tie B', totalPnl: 9999, tradeCount: 1 },
    ] } })
    // equal expectancy: the larger sample first; a setup with no trades has no expectancy and sinks last
    expect(odd.map((r) => [r.setup, r.expectancy, r.winRatePct, r.lowConfidence])).toEqual([['Tie A', 50, 100, true], ['Tie B', 50, 100, true], ['Zero', null, null, true]])
    for (const body of [undefined, null, {}, { attribution: {} }, { attribution: { bySetup: 'none' } }]) expect(setupRows(body)).toEqual([])
  })

  it('equityCurve and curveGeometry: the points as sent, and a line only from two or more', () => {
    const pts = equityCurve(ANALYTICS)
    expect(pts).toEqual([
      { date: '2026-09-01', equity: 100250 }, { date: '2026-09-15', equity: 99800 }, { date: '2026-10-20', equity: 102400 }, { date: '2026-11-13', equity: 104250 },
    ])
    expect(equityCurve({ equity: { curve: [{ date: 'soon', equity: 5 }, { date: '2026-11-13', equity: null }, null, { date: '2026-11-13T00:00:00', equity: '7.5' }] } }))
      .toEqual([{ date: '2026-11-13', equity: 7.5 }])
    for (const body of [undefined, null, {}, { equity: {} }, { equity: { curve: 'none' } }]) expect(equityCurve(body)).toEqual([])
    const g = curveGeometry(pts)
    expect(g).toMatchObject({ width: 300, height: 80, low: 99800, high: 104250, change: 4000, first: pts[0], last: pts[3] })
    // the lowest point sits on the bottom edge of the padded box and the highest on the top one
    expect(g.points).toBe('4,68.7 101.3,76 198.7,33.9 296,4')
    expect(curveGeometry([{ equity: 100 }, { equity: 200 }], { width: 100, height: 50, pad: 0 }).points).toBe('0,50 100,0')
    // a flat line is drawn through the middle, never a division by zero
    expect(curveGeometry([{ equity: 5 }, { equity: 5 }, { equity: 5 }], { width: 100, height: 50, pad: 0 }).points).toBe('0,25 50,25 100,25')
    for (const few of [[], [pts[0]], null, undefined]) expect(curveGeometry(few)).toBeNull()
  })

  it('statValueText prints each kind through the shared formatters, and nothing for a missing value', () => {
    expect(statValueText({ kind: 'count', value: 1234 })).toBe('1,234')
    expect(statValueText({ kind: 'pct', value: 50 })).toBe('50.0%')
    expect(statValueText({ kind: 'usd', value: 1234.5 })).toBe('$1,234.50')
    expect(statValueText({ kind: 'signedUsd', value: -42 })).toBe('-$42.00')
    expect(statValueText({ kind: 'signedUsd', value: 0 })).toBe('$0.00')
    expect(statValueText({ kind: 'r', value: -1.256 })).toBe('-1.26R')
    // a result that rounds to zero is zero, with no sign
    expect(statValueText({ kind: 'r', value: -0.001 })).toBe('0.00R')
    expect(statValueText({ kind: 'ratio', value: 2 })).toBe('2.00')
    for (const none of [null, undefined, { kind: 'usd', value: null }, { kind: 'r' }]) expect(statValueText(none)).toBeNull()
  })
})

describe('PERF panel states', () => {
  it('shows a loading skeleton while the accounts are read, and while the numbers are', async () => {
    serve({ [ACCOUNTS_URL]: PENDING, [METRICS_REGISTRY_URL]: REGISTRY })
    renderPanel()
    expect(screen.getByTestId('terminal-perf-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-perf-stats')).toBeNull()
    cleanup()
    serve({ ...BASE, [M1]: PENDING, [A1]: PENDING })
    renderPanel()
    await waitFor(() => expect(asked()).toContain(M1))
    expect(screen.getByTestId('terminal-perf-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-perf-empty')).toBeNull()
  })

  it('a failed accounts read (500) is an error with Retry, never "no trades"', async () => {
    serve({})
    renderPanel({}, { code: 'PERX' })
    const err = await screen.findByTestId('terminal-perf-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('Your journal could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no trades. Retry, or run PERX again.')
    expect(screen.queryByTestId('terminal-perf-empty')).toBeNull()
    expect(screen.queryByTestId('terminal-perf-no-account')).toBeNull()
    serve(FULL)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-perf-stats')).toBeTruthy()
  })

  it('a 402 says paid plan and a 404 says not switched on, both locked with no Retry', async () => {
    serve({ [ACCOUNTS_URL]: fail(402), [METRICS_REGISTRY_URL]: fail(402) })
    renderPanel()
    const paid = await screen.findByTestId('terminal-perf-error')
    expect(paid.getAttribute('data-kind')).toBe('locked')
    expect(paid.textContent).toContain('Your journal needs a paid plan.')
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()
    serve({ [ACCOUNTS_URL]: fail(404), [METRICS_REGISTRY_URL]: fail(404) })
    renderPanel()
    const off = await screen.findByTestId('terminal-perf-error')
    expect(off.getAttribute('data-kind')).toBe('locked')
    expect(off.textContent).toContain('Your journal is not switched on for this server yet.')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('a 401 says signed out, and no number is asked for', async () => {
    serve({ [ACCOUNTS_URL]: fail(401), [METRICS_REGISTRY_URL]: fail(401) })
    renderPanel()
    const out = await screen.findByTestId('terminal-perf-error')
    expect(out.textContent).toContain('You are signed out, so your journal cannot be read. Sign in again.')
    expect(asked().some((url) => url.startsWith(METRICS_URL + '?') || url.startsWith(ANALYTICS_URL))).toBe(false)
  })

  it('no journal account yet says so, offers the Journal, and reads no numbers', async () => {
    serve({ [ACCOUNTS_URL]: { accounts: [] }, [METRICS_REGISTRY_URL]: REGISTRY })
    const { open } = renderPanel()
    const none = await screen.findByTestId('terminal-perf-no-account')
    expect(none.getAttribute('data-kind')).toBe('empty')
    expect(none.textContent).toContain('You have no journal account yet.')
    expect(none.textContent).toContain('Your trading stats show here once the Journal has an account with closed trades.')
    fireEvent.click(screen.getByTestId('panel-command-JRNL'))
    expect(open).toHaveBeenCalledWith('JRNL')
    expect(asked().some((url) => url.startsWith(METRICS_URL + '?') || url.startsWith(ANALYTICS_URL))).toBe(false)
    // an answer that is not an accounts list is an error, not "no account"
    cleanup()
    serve({ [ACCOUNTS_URL]: { detail: 'something else' }, [METRICS_REGISTRY_URL]: REGISTRY })
    renderPanel()
    const err = await screen.findByTestId('terminal-perf-error')
    expect(err.textContent).toContain('Your journal could not be read just now.')
    expect(screen.queryByTestId('terminal-perf-no-account')).toBeNull()
  })

  it('an account with no closed trades says so: no stat is drawn as zero', async () => {
    serve({ ...BASE, [M1]: METRICS_NONE, [A1]: { ...ANALYTICS_NONE, strategyCount: 3 } })
    const { setFreshness } = renderPanel()
    const empty = await screen.findByTestId('terminal-perf-empty')
    expect(empty.getAttribute('data-kind')).toBe('empty')
    expect(empty.textContent).toContain('No closed trades in Default yet.')
    await waitFor(() => expect(screen.getByTestId('terminal-perf-empty').textContent)
      .toContain('Open positions are not counted, and neither are option strategies (3 here; they are in the Journal). Log a closed trade in the Journal (JRNL).'))
    expect(screen.queryByTestId('terminal-perf-stats')).toBeNull()
    expect(screen.queryByTestId('terminal-perf-setup-table')).toBeNull()
    expect(screen.queryByTestId('terminal-perf-curve')).toBeNull()
    expect(screen.getByTestId('terminal-perf-account').textContent).toBe('Account: Default.')
    // the read answered, so the header still says where the answer came from
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: SOURCE })))
  })

  it('both data reads failing is an error with Retry, never an empty account', async () => {
    serve(BASE)
    renderPanel({}, { code: 'PERX' })
    const err = await screen.findByTestId('terminal-perf-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('Your journal could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no trades. Retry, or run PERX again.')
    expect(screen.queryByTestId('terminal-perf-empty')).toBeNull()
    serve(FULL)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-perf-setup-table')).toBeTruthy()
    // answers that are not the routes' shapes are the same error, not zero trades
    cleanup()
    serve({ ...BASE, [M1]: { detail: 'x' }, [A1]: [] })
    renderPanel()
    expect((await screen.findByTestId('terminal-perf-error')).textContent).toContain('Your trading stats could not be read just now.')
    expect(screen.queryByTestId('terminal-perf-empty')).toBeNull()
  })
})

describe('PERF panel, populated', () => {
  it('the headline row, the setup table and the equity curve, each with its sample', async () => {
    serve(FULL)
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-perf-setup-table')
    expect(statText('trades')).toBe('Closed trades24')
    expect(statText('winRate')).toBe('Win rate60.9%From 23 wins and losses.')
    expect(statText('avgWin')).toBe('Average win$420.50From 14 wins.')
    expect(statText('avgLoss')).toBe('Average loss-$180.25Small sample: 9 losses, 10 needed.')
    expect(statText('expectancy')).toBe('Expectancy per trade+$177.79From 24 trades.')
    expect(statText('expectancyR')).toBe('Expectancy in R+0.41RFrom 21 trades with a known R.')
    expect(statText('profitFactor')).toBe('Profit factor3.63From 23 wins and losses.')
    expect(statText('edge')).toBe('Edge score1.23From 24 trades.')
    expect(statState('avgLoss')).toBe('thin')
    expect(screen.getByTestId('terminal-perf-r-sources').textContent).toContain('R is known for 21 of 24 trades. 15 trades use the stop you logged. 6 trades had no stop logged')
    // the table: best expectancy first, the sample in every row
    expect(setupCells()).toEqual([
      ['Pullback', '2 (small sample, 10 needed)', '50.0%', '+$450.00', 'R not known', '+$900.00'],
      ['Breakout', '12', '66.7%', '+$300.00', '+0.85R', '+$3,600.00'],
      ['Earnings gap', '4 (small sample, 10 needed)', '25.0%', '-$100.00', '-0.30R', '-$400.00'],
    ])
    expect(screen.getByRole('table', { name: 'Your results by setup, best expectancy first, 3 setups' })).toBeTruthy()
    expect(screen.getByTestId('terminal-perf-untagged').textContent).toBe('6 closed trades have no setup tag and are not in this table.')
    // the curve: an inline SVG polyline, and the same numbers in words
    const svg = screen.getByTestId('terminal-perf-curve')
    expect(svg.tagName.toLowerCase()).toBe('svg')
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe('Closed-trade equity from 2026-09-01 to 2026-11-13: $100,250.00 to $104,250.00')
    expect(svg.querySelector('polyline').getAttribute('points')).toBe('4,68.7 101.3,76 198.7,33.9 296,4')
    expect(document.querySelector('canvas')).toBeNull()
    expect(screen.getByTestId('terminal-perf-curve-words').textContent)
      .toBe('From $100,250.00 at the end of 2026-09-01 to $104,250.00 at the end of 2026-11-13: +$4,000.00. Lowest $99,800.00, highest $104,250.00, over 4 days that closed a trade.')
    expect(screen.getByTestId('terminal-perf-curve-method').textContent)
      .toBe("One point per day that closed a trade, after fees; open positions are not in it. It runs from the account's starting balance.")
    // one account: named, no picker
    expect(screen.getByTestId('terminal-perf-account').textContent).toBe('Account: Default.')
    expect(screen.queryByTestId('terminal-perf-account-pick')).toBeNull()
    // the header says "Your journal" and when it was read
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: SOURCE, age: expect.any(Object), observedAt: expect.any(String) })))
    const method = screen.getByTestId('terminal-perf-method').textContent
    expect(method).toContain('These are your own numbers, read from your Journal: closed stock trades only')
    expect(method).toContain('the Journal does not work out an average win or loss in R.')
    expect(method).toContain('A number from fewer than 10 trades is marked a small sample.')
    expect(method).toMatch(/Read at \d{1,2}:\d{2} [AP]M ET\./)
    expect(document.body.textContent).not.toMatch(/[—–]/)
  })

  it('PERSONAL DATA: only the member\'s own Journal routes are read, and none is given a member id', async () => {
    serve(FULL)
    renderPanel()
    await screen.findByTestId('terminal-perf-setup-table')
    expect([...new Set(asked())].sort()).toEqual([ACCOUNTS_URL, A1, M1, METRICS_REGISTRY_URL].sort())
    for (const url of asked()) {
      expect(url.startsWith('/api/j2/'), url).toBe(true)
      expect(url, url).not.toMatch(/user|member|email/i)
    }
    // the numbers are read once: nothing here polls
    expect(asked().filter((url) => url === M1)).toHaveLength(1)
    expect(asked().filter((url) => url === A1)).toHaveLength(1)
  })

  it('too few trades: the server\'s withheld numbers say "Not enough trades yet (n of m)", never 0 or a dash', async () => {
    serve({ [ACCOUNTS_URL]: TWO_ACCOUNTS, [METRICS_REGISTRY_URL]: REGISTRY, [M2]: METRICS_FEW, [A2]: ANALYTICS_FEW })
    window.localStorage.setItem(JOURNAL_ACCOUNT_KEY, 'acc-2')
    renderPanel()
    await screen.findByTestId('terminal-perf-stats')
    expect(statText('expectancyR')).toBe('Expectancy in RNot enough trades yet (6 of 10).')
    expect(statText('edge')).toBe('Edge scoreNot enough trades yet (6 of 10).')
    expect([statState('expectancyR'), statState('edge')]).toEqual(['short', 'short'])
    // what the server does send from six trades is shown with the sample, marked small
    expect(statText('winRate')).toBe('Win rate66.7%Small sample: 6 wins and losses, 10 needed.')
    expect(statText('avgWin')).toBe('Average win$300.00Small sample: 4 wins, 10 needed.')
    expect(statText('profitFactor')).toBe('Profit factor4.00Small sample: 6 wins and losses, 10 needed.')
    const stats = screen.getByTestId('terminal-perf-stats').textContent
    expect(stats).not.toMatch(/n\/a/)
    expect(stats).not.toMatch(/(^|[^\d.,$])0(\.0+)?(R|%)?(?![\d.,])/)
    // broker-imported trades with no stop: R is True R where there is one, and unknown otherwise
    expect(screen.getByTestId('terminal-perf-r-sources').textContent).toBe(
      'R is known for 4 of 6 trades. 4 trades had no stop logged (a broker import carries none), so their R is True R: the result against the '
      + "trade's own worst drawdown. 2 trades have no R at all (no stop logged and no True R worked out yet), so they are left out of every R number, "
      + 'never counted as zero.',
    )
    expect(screen.getByTestId('terminal-perf-account').textContent).toBe('Showing Broker account. It is linked to your broker.')
    // no setup tag on any trade, one equity point: both said in words
    expect(screen.getByTestId('terminal-perf-setups-none').textContent).toContain('None of these closed trades carries a setup tag yet.')
    expect(screen.queryByTestId('terminal-perf-setup-table')).toBeNull()
    expect(screen.queryByTestId('terminal-perf-curve')).toBeNull()
    expect(screen.getByTestId('terminal-perf-curve-words').textContent).toBe('One day has closed a trade so far: $52,900.00 at the end of 2026-11-13. The line draws once there are two.')
    expect(screen.getByTestId('terminal-perf-curve-method').textContent).toContain("This account is linked to a broker, so the line is set to end at the broker's account value.")
  })

  it('the two data reads fail apart: the numbers failing leaves the table and the curve, and Retry reads them', async () => {
    serve({ ...BASE, [A1]: ANALYTICS })
    renderPanel()
    await screen.findByTestId('terminal-perf-setup-table')
    const note = await screen.findByTestId('terminal-perf-numbers-error')
    expect(note.textContent).toContain('The headline numbers could not be read just now. That is not the same as no trades.')
    // a stat whose read failed says so; the stats of the read that answered stand
    expect(statText('winRate')).toBe('Win rateCould not be read.')
    expect(statState('winRate')).toBe('unread')
    expect(statText('trades')).toBe('Closed trades24')
    expect(statText('edge')).toBe('Edge score1.23From 24 trades.')
    expect(screen.getByTestId('terminal-perf-curve')).toBeTruthy()
    expect(screen.queryByTestId('terminal-perf-tables-error')).toBeNull()
    serve(FULL)
    fireEvent.click(within(note).getByRole('button', { name: 'Retry the headline numbers' }))
    await waitFor(() => expect(statText('winRate')).toBe('Win rate60.9%From 23 wins and losses.'))
    expect(screen.queryByTestId('terminal-perf-numbers-error')).toBeNull()
  })

  it('the table and curve failing leaves the headline numbers, and a locked read offers no Retry', async () => {
    serve({ ...BASE, [M1]: METRICS, [A1]: fail(402) })
    renderPanel()
    const note = await screen.findByTestId('terminal-perf-tables-error')
    expect(note.textContent).toContain('Your journal needs a paid plan. That is not the same as no trades.')
    expect(within(note).queryByRole('button')).toBeNull()
    expect(statText('winRate')).toBe('Win rate60.9%From 23 wins and losses.')
    expect(statText('expectancyR')).toBe('Expectancy in RCould not be read.')
    expect(statText('edge')).toBe('Edge scoreCould not be read.')
    expect(statText('trades')).toBe('Closed trades24')
    expect(screen.queryByTestId('terminal-perf-setups')).toBeNull()
    expect(screen.queryByTestId('terminal-perf-equity')).toBeNull()
    expect(screen.queryByTestId('terminal-perf-empty')).toBeNull()
    expect(screen.getByTestId('terminal-perf-r-sources').textContent).toContain('R is known for 21 of 24 trades.')
  })

  it('a registry that cannot be read does not blank the panel: the full set is asked for', async () => {
    serve({ [ACCOUNTS_URL]: ONE_ACCOUNT, [METRICS_REGISTRY_URL]: fail(500), [M1]: METRICS, [A1]: ANALYTICS })
    renderPanel()
    await screen.findByTestId('terminal-perf-setup-table')
    expect(asked()).toContain(M1)
    expect(statText('profitFactor')).toBe('Profit factor3.63From 23 wins and losses.')
  })
})

describe('PERF account picker', () => {
  const BOTH = {
    [ACCOUNTS_URL]: TWO_ACCOUNTS, [METRICS_REGISTRY_URL]: REGISTRY, [M1]: METRICS, [A1]: ANALYTICS, [M2]: METRICS_FEW, [A2]: ANALYTICS_FEW,
    [M_ALL]: { ...METRICS, tradeCount: 30 }, [A_ALL]: { ...ANALYTICS, tradeCount: 30 },
  }

  it('several accounts: says which one, starts on the first, and the picker switches the reads', async () => {
    serve(BOTH)
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-perf-setup-table')
    expect(screen.getByTestId('terminal-perf').getAttribute('data-account')).toBe('1')
    expect(screen.getByTestId('terminal-perf-account').textContent).toBe('Showing Default.')
    const picker = screen.getByTestId('terminal-perf-account-pick')
    expect(screen.getByRole('combobox', { name: /^Account/ })).toBe(picker)
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Default', 'Broker account', 'All accounts together'])
    expect(picker.value).toBe('1')
    expect(asked()).not.toContain(M2)
    fireEvent.change(picker, { target: { value: '2' } })
    await waitFor(() => expect(statText('trades')).toBe('Closed trades6'))
    expect(screen.getByTestId('terminal-perf').getAttribute('data-account')).toBe('2')
    expect(screen.getByTestId('terminal-perf-account').textContent).toBe('Showing Broker account. It is linked to your broker.')
    expect(asked()).toEqual(expect.arrayContaining([M2, A2]))
    fireEvent.change(screen.getByTestId('terminal-perf-account-pick'), { target: { value: 'ALL' } })
    await waitFor(() => expect(statText('trades')).toBe('Closed trades30'))
    expect(screen.getByTestId('terminal-perf').getAttribute('data-account')).toBe('all')
    expect(screen.getByTestId('terminal-perf-account').textContent).toBe('Showing All accounts together.')
    expect(screen.getByTestId('terminal-perf-curve-method').textContent).toContain('All your accounts together start from the sum of their starting balances.')
    expect(asked()).toEqual(expect.arrayContaining([M_ALL, A_ALL]))
    // outside a registered panel nothing is written back, and the Journal's own pick is never written
    expect(rerun).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(JOURNAL_ACCOUNT_KEY)).toBeNull()
  })

  it('starts on the Journal\'s own pick: an account, or all accounts', async () => {
    window.localStorage.setItem(JOURNAL_ACCOUNT_KEY, 'acc-2')
    serve(BOTH)
    renderPanel()
    await waitFor(() => expect(statText('trades')).toBe('Closed trades6'))
    expect(screen.getByTestId('terminal-perf-account-pick').value).toBe('2')
    expect(asked()).not.toContain(M1)
    cleanup()
    jsonFetcher.mockClear()
    window.localStorage.setItem(JOURNAL_ACCOUNT_KEY, ALL_ACCOUNTS)
    renderPanel()
    await waitFor(() => expect(statText('trades')).toBe('Closed trades30'))
    expect(screen.getByTestId('terminal-perf-account-pick').value).toBe('ALL')
    expect(asked()).not.toContain(M1)
    expect(window.localStorage.getItem(JOURNAL_ACCOUNT_KEY)).toBe(ALL_ACCOUNTS)
  })

  it('the account prop seeds the picker, and a place the list does not have says so', async () => {
    serve(BOTH)
    renderPanel({ account: 'ALL' })
    await waitFor(() => expect(statText('trades')).toBe('Closed trades30'))
    expect(screen.queryByTestId('terminal-perf-missing')).toBeNull()
    cleanup()
    renderPanel({ account: 2 })
    await waitFor(() => expect(statText('trades')).toBe('Closed trades6'))
    cleanup()
    renderPanel({ account: '5' })
    await screen.findByTestId('terminal-perf-setup-table')
    expect(screen.getByTestId('terminal-perf-missing').textContent).toBe('You have no account number 5 (2 in your Journal), so this shows Default.')
    expect(screen.getByTestId('terminal-perf').getAttribute('data-account')).toBe('1')
  })

  it('inside a panel whose code takes the word, the picker writes itself into the command', async () => {
    // MON is an existing code whose market variant takes a list number (and not ALL).
    serve(BOTH)
    const { rerun } = renderPanel({}, { code: 'MON' })
    await screen.findByTestId('terminal-perf-setup-table')
    fireEvent.change(screen.getByTestId('terminal-perf-account-pick'), { target: { value: '2' } })
    expect(rerun).toHaveBeenLastCalledWith('MON 2')
    // a word the code does not take is not written back, and the picker still switches
    fireEvent.change(screen.getByTestId('terminal-perf-account-pick'), { target: { value: 'ALL' } })
    expect(rerun).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(statText('trades')).toBe('Closed trades30'))
    // the command carries a place in the list, never an account id
    expect(rerun.mock.calls.flat().join(' ')).not.toContain('acc-')
  })
})

describe('PERF follows the member\'s theme', () => {
  it('the panel, its model and its stylesheet hold no hard-coded color', () => {
    for (const f of ['PerformancePanel.jsx', 'performanceModel.js', 'performancePanel.module.css']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })

  it('the curve is drawn with theme tokens, and signed numbers never use the candle hues as text', () => {
    const css = fs.readFileSync(path.join(HERE, 'performancePanel.module.css'), 'utf8')
    expect(css).toMatch(/\.curve polyline \{[^}]*stroke: var\(--accent\)/)
    expect(css).not.toMatch(/var\(--(gain|loss)\)/)
    expect(css).not.toMatch(/infinite/)
  })

  it('every text color in the stylesheet clears WCAG AA on every theme and surface', () => {
    const css = fs.readFileSync(path.join(HERE, 'performancePanel.module.css'), 'utf8')
    const rows = auditCss('pages/terminal/panels/performancePanel.module.css', css, allThemes())
    expect(new Set(rows.map((r) => r.selector))).toEqual(new Set(['.filter', '.filter select', '.stat dt', '.value', '.reason', '.sample']))
    expect(rows.filter((r) => !r.pass).map((r) => `${r.selector} ${r.theme} on ${r.surface}: ${r.ratio.toFixed(2)} < ${r.bar}`)).toEqual([])
  })
})

describe('PERF accessibility', () => {
  it('the populated panel and the thin-sample panel pass axe (WCAG A and AA)', async () => {
    serve({ [ACCOUNTS_URL]: TWO_ACCOUNTS, [METRICS_REGISTRY_URL]: REGISTRY, [M1]: METRICS, [A1]: ANALYTICS, [M2]: METRICS_FEW, [A2]: ANALYTICS_FEW })
    renderPanel()
    await screen.findByTestId('terminal-perf-setup-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    fireEvent.change(screen.getByTestId('terminal-perf-account-pick'), { target: { value: '2' } })
    await waitFor(() => expect(statText('trades')).toBe('Closed trades6'))
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 20_000)
})
