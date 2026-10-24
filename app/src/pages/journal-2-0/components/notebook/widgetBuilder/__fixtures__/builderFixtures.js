// Wave 8 (Task 8.15): test fixtures for the widget builder — a small catalog in the server's shape
// (`GET /api/j2/widget-definitions/vocabulary`, router `_static_vocabulary`) and a fetch router.
// Tests only; nothing in the product imports this file.
import { vi } from 'vitest'

export const REASONS = {
  view_one_number: 'This view shows one number. Remove the split to use it.',
  view_bar: 'A bar chart needs a split.',
  view_line: 'A line needs a split by day or month.',
  view_heat: 'A calendar heat map needs a split by day.',
  view_scatter: 'A scatter plot needs two measures and no split.',
  view_scatter_trades: 'A scatter plot works for closed trades only.',
  view_list: 'A list shows each row. Remove the split to use it.',
  view_progress: 'A progress bar needs a target.',
  positions_no_compare: 'Open positions are a snapshot of right now, so there is no earlier period to compare.',
  no_earlier: 'Comparing with the period before needs a date range, not all time or a number of trades.',
  then_table_only: 'A second split only works in a table.',
  too_many_measures: 'Pick up to 3 measures.',
  one_overridable: 'Only one filter can be changed from the note.',
  too_many_filters: 'Use up to 8 filters.',
  start_after_end: 'The start date is after the end date.',
  low_above_high: 'The low value is above the high value.',
  needs_value: 'Pick at least one value for this filter.',
  target: 'The target must be a number.',
  top_range: 'Top N must be between 1 and 40.',
  no_measure: 'Pick at least one measure.',
}

const f = (key, label, type, ops, split = false, extra = {}) => ({ key, label, type, ops, split, ...extra })
const NUM = ['eq', 'gt', 'gte', 'lt', 'lte', 'between']

export const CATALOG = {
  sources: [
    {
      key: 'closed_trades', label: 'Closed trades', description: 'Every trade you have closed.', unit: 'trades',
      rightNow: false,
      fields: [
        f('day', 'Day', 'day', NUM, true),
        f('symbol', 'Symbol', 'text', ['in', 'contains'], true),
        f('setup', 'Setup', 'enum', ['in', 'not_in'], true),
        f('hold_days', 'Hold days', 'number', NUM),
        f('hold_bucket', 'Hold time', 'enum', ['in', 'not_in'], true, {
          values: [{ value: 'Same day', label: 'Same day' }, { value: '1 day', label: '1 day' }],
        }),
        f('had_stop', 'Had a stop', 'bool', ['is'], true, {
          values: [{ value: true, label: 'Had a stop' }, { value: false, label: 'No stop set' }],
        }),
        f('hold_minutes', 'Hold minutes', 'number', NUM, false, { needsTimes: true }),
      ],
      measures: ['expectancy_r', 'net_pnl', 'trades', 'win_rate'],
    },
    {
      key: 'open_positions', label: 'Open positions', description: 'What you hold right now.', unit: 'positions',
      rightNow: true,
      fields: [f('symbol', 'Symbol', 'text', ['in', 'contains'], true)],
      measures: ['open_positions'],
    },
    {
      key: 'trading_days', label: 'Trading days', description: 'One row per market session.', unit: 'days',
      rightNow: false,
      fields: [f('day', 'Day', 'day', NUM, true)],
      measures: ['avg_day_pnl'],
    },
  ],
  measures: [
    { key: 'net_pnl', label: 'Net P&L', theme: 'results', meaning: 'Money made or lost after fees.', unit: 'trades', kind: 'sum', needs: [], sources: ['closed_trades'] },
    { key: 'trades', label: 'Trades', theme: 'results', meaning: 'How many closed trades.', unit: 'trades', kind: 'count', needs: [], sources: ['closed_trades'] },
    { key: 'win_rate', label: 'Win rate', theme: 'winloss', meaning: 'Share of wins among wins and losses.', unit: 'decisive', kind: 'rate', needs: [], sources: ['closed_trades'] },
    { key: 'expectancy_r', label: 'Expectancy (R)', theme: 'risk', meaning: 'Average R per trade, over the trades whose R is known.', unit: 'trades', kind: 'average', needs: ['r'], sources: ['closed_trades'] },
    { key: 'open_positions', label: 'Open positions', theme: 'risk', meaning: 'How many positions are open.', unit: 'positions', kind: 'count', needs: [], sources: ['open_positions'] },
    { key: 'avg_day_pnl', label: 'Average day P&L', theme: 'time', meaning: 'Average net P&L of a day with trades.', unit: 'days', kind: 'average', needs: [], sources: ['trading_days'] },
  ],
  views: ['number', 'compare', 'table', 'bar', 'line', 'scatter', 'heat', 'list', 'progress'],
  ranges: [
    { token: 'today', label: 'today' }, { token: 'last_30d', label: 'last 30 days' },
    { token: 'last_90d', label: 'last 90 days' }, { token: 'ytd', label: 'year to date' },
    { token: 'all', label: 'all time' }, { token: 'last_20_trades', label: 'last 20 trades' },
  ],
  accents: ['gold', 'green', 'red'],
  timeFields: ['day', 'month'],
  reasons: REASONS,
  maxMeasures: 3,
  maxFilters: 8,
  topMax: 40,
}

export const SUMMARY = 'Net P&L for closed trades in the last 90 days, all accounts. 47 trades.'

/** A preview / run payload in the server's shape (widget_engine/payload.py), Number view. */
export function payload(over = {}) {
  return {
    asOf: '2026-10-24T14:00:00Z', source: 'manual', sourceKey: 'closed_trades', view: 'number',
    title: 'Net P&L, last 90 days', summary: SUMMARY, defId: null, defRev: null, latestRev: null,
    def: { v: 1, source: 'closed_trades' }, scopeLabel: 'All accounts', rangeLabel: 'Last 90 days',
    range: null, accountId: null, filter: null, count: 47, capped: false, sample: false, notice: null,
    truncated: 0, measures: [{ label: 'Net P&L', unit: 'trades', kind: 'sum', fmt: 'money' }],
    value: { v1: 2140, n1: 47, s1: '' }, compare: null, compareLabel: null, rows: [], series: [], points: [],
    cells: [], coverage: [null], footnotes: [], empty: null, defaultName: 'Net P&L, last 90 days',
    sourceDetail: 'Your closed trades in the Journal.',
    ...over,
  }
}

/** A fetch answer the client reads (`ok`, `status`, `json()`). */
export const answer = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data })
export const refusal = (status, code, message = '') => answer({ detail: { code, message } }, status)

/** A deferred answer: `.promise` for fetch, `.resolve(data, status)` later. */
export function deferred() {
  let res
  const promise = new Promise((r) => { res = r })
  return { promise, resolve: (data, status = 200) => res({ ok: status < 400, status, json: async () => data }) }
}

/**
 * A fetch router: `routes` is a list of `[method, test(url), reply(url, init)]`, consulted first to last after the
 * per-test ones. Every call is recorded on `fetchSpy.mock.calls`.
 */
export function installFetch(extra = []) {
  const routes = [
    ...extra,
    ['GET', (u) => u.endsWith('/vocabulary'), () => answer(CATALOG)],
    ['GET', (u) => u.includes('/vocabulary?field=setup'), () => answer({ field: 'setup', values: ['Flag', 'VCP', '__proto__'] })],
    ['GET', (u) => u === '/api/j2/accounts', () => answer({ accounts: [{ id: 'a1', name: 'Swing' }] })],
    ['POST', (u) => u.endsWith('/preview'), () => answer(payload())],
  ]
  const spy = vi.fn((url, init = {}) => {
    const method = init.method || 'GET'
    const u = String(url)
    const hit = routes.find(([m, test]) => m === method && test(u))
    return hit ? hit[2](u, init) : refusal(500, 'failed')
  })
  vi.stubGlobal('fetch', spy)
  return { spy, routes }
}

export const callsTo = (spy, method, test) => spy.mock.calls.filter(([u, init = {}]) => (init.method || 'GET') === method && test(String(u)))
export const bodyOf = (call) => JSON.parse(call[1].body)
