// The RS screens as the SERVER SERVES THEM (unit U6, 2026-11-14). Nothing about an RS starter
// is typed here: the five screens and the seven hidden starters are READ from the two files the
// server's own suite pins against its routes, so a server change moves these tests in the same
// commit and the two halves cannot drift apart silently.
//
//   tests/fixtures/rs_screens_starters.json   the five, GET /api/screener/saved-screens
//                                             (pinned by tests/test_rs_screens_u4_starters.py)
//   tests/fixtures/rs_screens_served.json     the hidden seven, the Setup words, the method page,
//                                             the registry entries and views the five use
//                                             (pinned by tests/test_rs_screens_u6_golden.py)
//
// ⚰️ Until U6 this file was a hand-typed copy of the contract. It agreed with the server on the
// day it was written, and nothing would have said so on the day it stopped.
// tests/test_rs_screens_u6_golden.py fails if an RS starter is typed here again.
//
// Two more files join the halves in the other direction (both in tests/fixtures/):
//   rs_screens_scan_requests.json   what THIS client asks the scan route, captured from the
//                                   mounted page (rsScanRequests.test.jsx) and replayed by the
//                                   server's end-to-end test
//   rs_screens_rows.json            the rows the route answered those requests with, over a
//                                   synthetic market (tests/test_rs_screens_u6_e2e.py), read by
//                                   rsServedRows.test.jsx
//
// Hand-written on purpose: PLAIN_STARTERS (starters that carry none of the new fields; the RS
// screens read nothing of theirs) and RS_ROWS (sample rows, one per caption and tag rule; every
// key is a column the server has, held by rsServedRows.test.jsx).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The house idiom for reaching `tests/fixtures/` (BuilderSheet.endzone.test.jsx):
// `app/src/pages/screener/focus/__tests__/` is SIX levels below the repo root.
const HERE = path.dirname(fileURLToPath(import.meta.url))
export const SERVER_FIXTURES = path.join(HERE, '..', '..', '..', '..', '..', '..', 'tests', 'fixtures')
export const readServerFixture = name => JSON.parse(readFileSync(path.join(SERVER_FIXTURES, name), 'utf8'))

// Frozen all the way down: these objects are shared by every test of a file, and a test that
// edited one would change what the next test calls "the server's payload".
const freeze = v => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v) }
  return v
}

// The five, in the payload's order inside the "Relative strength" group.
export const RS_STARTERS = freeze(readServerFixture('rs_screens_starters.json'))
const byId = id => {
  const hit = RS_STARTERS.find(s => s.id === id)
  if (!hit) throw new Error(`rs_screens_starters.json no longer serves ${id}`)
  return hit
}
export const TOP_RATING = byId('starter_rs_top_rating')
export const NEW_HIGHS = byId('starter_rs_new_high')
export const BEFORE_PRICE = byId('starter_rs_nh_before_price')
export const LEADERS = byId('starter_rs_leaders')
export const EXIT_WARNINGS = byId('starter_rs_exit_warning_5')

// What is served around the five (see the header): `hidden`, `words`, `method`.
export const SERVED = freeze(readServerFixture('rs_screens_served.json'))
// `hidden: true` while the flag is on: out of the picker's groups and search, still resolvable by id.
export const HIDDEN_STARTERS = SERVED.hidden
export const HIDDEN_IDS = HIDDEN_STARTERS.map(s => s.id)

// Starters that carry NONE of the new fields: today's product.
const gte = (key, min) => ({ key, op: 'gte', min })
const STOCKS_ONLY = { key: 'security_type', op: 'not_in', values: ['ETF'] }
export const PLAIN_STARTERS = [
  { id: 'starter_power_play', name: 'Power plays', group: 'Momentum leaders', description: 'Up big on volume',
    spec: { filters: [gte('rs_rank', 85), STOCKS_ONLY], sort: { key: 'rs_rank', dir: 'desc' } } },
  { id: 'starter_tight_base', name: 'Tight bases', group: 'Bases & chart patterns', description: 'Tight closes',
    spec: { filters: [gte('rs_rank', 75), STOCKS_ONLY], sort: { key: 'rs_rank', dir: 'desc' } } },
  { id: 'starter_three_weeks_tight', name: '3 weeks tight', group: 'Bases & chart patterns', description: 'Three tight weekly closes',
    spec: { filters: [gte('rs_rank', 65), STOCKS_ONLY], sort: { key: 'rs_rank', dir: 'desc' } } },
]

// The whole starters payload with the flag on, in the payload's own order: the core starters
// ("Leaders (RS >= 90)" among them, hidden), then the five together, then the six hidden RS
// lists (tests/test_rs_screens_u6_golden.py holds that order against the server).
const HIDDEN_CORE = HIDDEN_STARTERS.filter(s => s.group !== 'Relative strength')
const HIDDEN_RS = HIDDEN_STARTERS.filter(s => s.group === 'Relative strength')
export const STARTERS_ON = [...HIDDEN_CORE, ...PLAIN_STARTERS, ...RS_STARTERS, ...HIDDEN_RS]

// Sample rows carrying the contract's section 1 columns. Values chosen so each caption part and
// each tag rule has a row that fires it and a row that does not.
const row = (ticker, over = {}) => ({
  ticker, company: `${ticker} Corp`, price: 100, chg_pct_1d: 1.2, base_render: 'Flat Base', vol_ratio: 1,
  industry: 'Semiconductors', sector: 'Technology', rs_rank: 97, rs_rating_session: '2026-11-13',
  rs_rating_score: 88.4, rs_rating_pos: 14, rs_rating_pos_n: 1931, rs_rating_pos_prev20: 41, rs_rating_chg_5: 3,
  rs_setup: 'at_pivot', rs_tight: 0, rs_flag: null, rs_near_buy: 1,
  rs_nh_bars_ago: 0, rs_nh_red_bars_ago: null, rs_nhbp_age: null, px_below_high_pct: -0.2,
  ...over,
})
export const RS_ROWS = [
  row('NVDA'),
  row('MU', { rs_rank: 91, rs_rating_pos: 120, rs_rating_pos_prev20: 120, rs_rating_chg_5: -4, rs_setup: 'extended',
    rs_nh_bars_ago: 3, rs_nh_red_bars_ago: 3, px_below_high_pct: -6.4, rs_nhbp_age: 3, sector: 'Technology' }),
  row('LLY', { rs_rank: 84, rs_rating_pos: 300, rs_rating_pos_prev20: null, rs_rating_chg_5: 0, rs_setup: 'uptrend', rs_tight: 1,
    rs_nh_bars_ago: 1, px_below_high_pct: -12, industry: 'Drug makers', sector: 'Healthcare', rs_flag: 'new_issue' }),
  row('XOM', { rs_rank: 80, rs_rating_pos: 380, rs_rating_pos_prev20: null, rs_rating_chg_5: null, rs_setup: 'pullback_21',
    rs_nh_bars_ago: null, px_below_high_pct: null, industry: 'Oil and gas', sector: 'Energy', rs_flag: 'buyout_pending' }),
  row('AMD', { rs_rank: 89, rs_rating_pos: 200, rs_setup: 'below_50', rs_tight: 1, rs_nh_bars_ago: 7, px_below_high_pct: -3,
    rs_nhbp_age: 2, rs_flag: 'one_day_move' }),
]
