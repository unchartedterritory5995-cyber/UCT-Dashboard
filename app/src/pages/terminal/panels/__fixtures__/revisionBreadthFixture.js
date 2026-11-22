// GET /api/research/estimate-history?metric=&window= answers (api/services/estimate_revisions.py `get_breadth`), in the
// route's real shape. Every ticker, count, estimate and date here is INVENTED (the tickers are not stocks the site
// follows: functions.revisionBreadth.test.js checks them against its universe).

const ASOF = '2031-03-14'
const FROM30 = '2031-02-12'
const FROM7 = '2031-03-07'
const PE = '2031-03-31'

/** One stock's result. */
export function sym(symbol, state, pct = null, from = null, to = null, { window = 30, reason = null } = {}) {
  const counted = state === 'up' || state === 'down' || state === 'held'
  return {
    symbol, state, pct, from, to, from_date: counted ? (window === 7 ? FROM7 : FROM30) : null, to_date: ASOF,
    period_end: counted ? PE : null, reason,
  }
}

const notCounted = (syms) => ({
  collecting: syms.filter((s) => s.state === 'collecting').length,
  gap: syms.filter((s) => s.state === 'gap').length,
  not_comparable: syms.filter((s) => s.state === 'not_comparable').length,
})

/** A sector row worked out from its stocks, as the server does (net needs 5 counted). */
export function sector(name, symbols, { onFile = true } = {}) {
  const up = symbols.filter((s) => s.state === 'up')
  const down = symbols.filter((s) => s.state === 'down')
  const held = symbols.filter((s) => s.state === 'held')
  const counted = up.length + down.length + held.length
  return {
    name, on_file: onFile, members: symbols.length, counted, up: up.length, down: down.length, held: held.length,
    not_counted: notCounted(symbols), net: counted >= 5 ? Math.round(((up.length - down.length) / counted) * 1000) / 10 : null,
    raises: [...up].sort((a, b) => b.pct - a.pct).slice(0, 3).map((s) => ({ symbol: s.symbol, pct: s.pct })),
    cuts: [...down].sort((a, b) => a.pct - b.pct).slice(0, 3).map((s) => ({ symbol: s.symbol, pct: s.pct })),
    symbols,
  }
}

const TECH = sector('Technology', [
  sym('ZQTA', 'up', 20.0, 1.0, 1.2), sym('ZQTB', 'up', 15.0, 2.0, 2.3), sym('ZQTC', 'up', 5.0, 1.0, 1.05),
  sym('ZQTD', 'up', 2.5, 4.0, 4.1), sym('ZQTE', 'held', 0.1, 1.0, 1.001), sym('ZQTF', 'down', -10.0, 1.0, 0.9),
  sym('ZQTG', 'collecting', null, null, null, { reason: 'snapshots begin 2031-03-02; a 30-day change needs one from 2031-02-12 or before' }),
])
const HEALTH = sector('Healthcare', [
  sym('ZQHA', 'up', 3.0, 1.0, 1.03), sym('ZQHB', 'up', 1.2, 2.5, 2.53), sym('ZQHC', 'held', -0.2, 3.0, 2.994),
  sym('ZQHD', 'held', 0.0, 0.8, 0.8), sym('ZQHE', 'down', -4.0, 1.25, 1.2),
  sym('ZQHF', 'gap', null, null, null, { reason: 'no snapshot between 2031-02-08 and 2031-02-12' }),
])
const ENERGY = sector('Energy', [
  sym('ZQEA', 'down', -20.0, 3.0, 2.4), sym('ZQEB', 'down', -12.5, 0.8, 0.7), sym('ZQEC', 'down', -2.0, 1.0, 0.98),
  sym('ZQED', 'down', -1.0, 2.0, 1.98), sym('ZQEE', 'up', 4.0, 1.0, 1.04),
  sym('ZQEF', 'not_comparable', null, null, null, { reason: 'the estimate was zero on 2031-02-12, so a change has no percent' }),
])
const UTIL = sector('Utilities', [sym('ZQUA', 'up', 1.0, 1.0, 1.01), sym('ZQUB', 'held', 0.0, 1.0, 1.0)])
const NONE = sector('Sector not on file', [sym('ZQXA', 'up', 8.0, 0.5, 0.54), sym('ZQXB', 'collecting', null, null, null, { reason: 'no snapshot yet: the daily job adds one each weekday evening' })], { onFile: false })

const SECTORS = [TECH, HEALTH, ENERGY, UTIL, NONE]

function totalOf(sectors) {
  const all = sectors.flatMap((s) => s.symbols)
  const t = sector('all', all)
  return { members: t.members, counted: t.counted, up: t.up, down: t.down, held: t.held, not_counted: t.not_counted, net: t.net }
}

export const COMMON = {
  status: 'ok', v: 1, built_at: '2031-03-15T01:10:00+00:00', asof: ASOF, covers_from: '2031-01-05',
  source: 'FMP /stable/analyst-estimates (period=quarter), snapshotted daily by UCT',
  map: 'the sector and industry each company\'s details name (the map GRP and PCHG group by)',
  tolerance_pct: 0.5, slack_days: 4, min_counted: 5, top_n: 3, windows: [7, 30], metrics: ['eps', 'revenue'],
  tracked: { n: 23, cap: 600, origins: { sp500: 18, viewed: 5 }, no_sector: 2 }, check: null,
}

/** The EPS, 30-day answer. */
export const EPS_30 = { ...COMMON, metric: 'eps', window: 30, total: totalOf(SECTORS), sectors: SECTORS }

/** The revenue, 7-day answer: one sector, revenue in billions. */
const REV_TECH = sector('Technology', [
  sym('ZQTA', 'up', 4.0, 2.5e9, 2.6e9, { window: 7 }), sym('ZQTB', 'up', 1.0, 1.0e10, 1.01e10, { window: 7 }),
  sym('ZQTC', 'held', 0.2, 5.0e8, 5.01e8, { window: 7 }), sym('ZQTD', 'held', 0.0, 3.0e9, 3.0e9, { window: 7 }),
  sym('ZQTF', 'down', -2.0, 1.0e9, 9.8e8, { window: 7 }),
])
export const REV_7 = { ...COMMON, metric: 'revenue', window: 7, total: totalOf([REV_TECH]), sectors: [REV_TECH] }

/** Nothing spans 30 days yet. */
export const COLLECTING_30 = {
  ...COMMON, covers_from: '2031-03-02', metric: 'eps', window: 30, tracked: { ...COMMON.tracked, n: 3, origins: { viewed: 3 }, no_sector: 0 },
  total: totalOf([sector('Technology', [sym('ZQTA', 'collecting'), sym('ZQTB', 'collecting'), sym('ZQTC', 'collecting')])]),
  sectors: [sector('Technology', [sym('ZQTA', 'collecting'), sym('ZQTB', 'collecting'), sym('ZQTC', 'collecting')])],
}

export const EMPTY = { ...COMMON, asof: null, covers_from: null, metric: 'eps', window: 30, tracked: { n: 0, cap: 600, origins: {}, no_sector: 0 },
  total: totalOf([]), sectors: [] }

export const COMPUTING = { status: 'computing', metric: 'eps', window: 30 }
export const FAILED = { status: 'failed', reason: 'error', http_status: null, metric: 'eps', window: 30 }

/** Every invented ticker above. */
export const FIXTURE_TICKERS = [...new Set([...SECTORS, REV_TECH].flatMap((s) => s.symbols.map((x) => x.symbol)))]
