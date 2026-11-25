// Terminal data wave 12 — six LOCAL-ONLY capabilities over six model-isolated kinds (MD-1 §4.21, §4.4):
//   stock.uctRating ← ratings · stock.estimatesHistory ← estimates.history · stock.consensusRating ← analyst.ratings ·
//   stock.revenueSplit ← company.segments · stock.failsToDeliver ← stock.failsToDeliver · stock.companyDeals ← company.deals.
// Each is registered ONLY while the server serves its own kind, makes ONE read of it, is shown to the member only, says the
// DATA'S OWN date, never calls a missing number 0, says when a list is cut and from which end, never calls "not held" or a
// failed read "none", says "no record matched" for a part with no row, never names a vendor, and never echoes an envelope
// note. Routing: the six share ONE words-only group of their own (`stockResearch`, the 54th of the 56 the server keeps). Each
// capability's own words are armed only while it is registered, and they never name another capability's language: the RS
// rating, the market's upgrades and target changes, the revisions by sector, this quarter's estimate, a stock's revenue, a
// follow-through day, short interest, the market's latest deals and index changes, alerts, navigation and what a term means.
// The Terminal codes' keywords are checked both ways.
// No model, no provider: /api/agent/config and /api/agent/data are stubbed with synthetic shapes (never market data).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import './terminalWaves'                       // the Terminal waves register through registerServerGatedBuiltins() (PR #2677)
import { getCapability, allCapabilityNames, manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { turnStart, turnEnd, _resetTurns } from './trace'
import { GROUPS, groupOfAction, routeManifest, selectGroups, wordsSelect } from './routing'
import { routeManifestV2 } from './nlm1/routingV2'
import { correctTypos, lexiconFor } from './nl/lexicon'
import { allPhrasings } from './qa/capabilityRegression/testing/corpus'
import collisions from './qa/capabilityRegression/baseline/routingCollisions.json'
import handshake from './__fixtures__/program/isolation.json'
import { FUNCTIONS } from '../pages/terminal/functions'
import { LIVE_WORDS } from './capabilities/terminalDataFormat'
import { _resetCotForTest, COT_ROUTE_WORDS } from './capabilities/cot'
import { _resetHistoryForTest } from './capabilities/history'
import { _resetDescribeForTest } from './capabilities/chartDescribe'
import { _resetTerminalDataForTest } from './capabilities/terminalData'
import { _resetTerminalLocalForTest, TERMINAL_ROUTE_WORDS } from './capabilities/terminalDataLocal'
import { _resetTerminalWave2ForTest, WAVE2_ROUTE_WORDS } from './capabilities/terminalDataWave2'
import { _resetTerminalWave3ForTest, WAVE3_ROUTE_WORDS } from './capabilities/terminalDataWave3'
import { _resetTerminalWave4ForTest, WAVE4_ROUTE_WORDS, ROUTE_GROUP as WAVE4_GROUP } from './capabilities/terminalDataWave4'
import { _resetTerminalWave5ForTest, WAVE5_ROUTE_WORDS, ROUTE_GROUP as WAVE5_GROUP } from './capabilities/terminalDataWave5'
import { _resetTerminalWave6ForTest, WAVE6_ROUTE_WORDS, ROUTE_GROUP as WAVE6_GROUP } from './capabilities/terminalDataWave6'
import { _resetTerminalWave7ForTest, WAVE7_ROUTE_WORDS, ROUTE_GROUP as WAVE7_GROUP } from './capabilities/terminalDataWave7'
import { _resetTerminalWave8ForTest, WAVE8_ROUTE_WORDS, ROUTE_GROUP as WAVE8_GROUP } from './capabilities/terminalDataWave8'
import { _resetTerminalWave9ForTest, WAVE9_ROUTE_WORDS, ROUTE_GROUP as WAVE9_GROUP } from './capabilities/terminalDataWave9'
import { _resetTerminalWave10ForTest, WAVE10_ROUTE_WORDS, ROUTE_GROUP as WAVE10_GROUP } from './capabilities/terminalDataWave10'
import { _resetTerminalWave11ForTest, WAVE11_ROUTE_WORDS, ROUTE_GROUP as WAVE11_GROUP } from './capabilities/terminalDataWave11'
import {
  KINDS, CAPABILITIES, RATING_RECORD, RATING_LEFT_OUT, ESTIMATES_RECORD, ESTIMATES_LEFT_OUT, ANALYSTS_DEFAULT_ROWS, ANALYSTS_MAX_ROWS, ANALYSTS_RECORD,
  SEGMENTS_DEFAULT_ROWS, SEGMENTS_MAX_ROWS, FTD_DEFAULT_ROWS, FTD_MAX_ROWS, FTD_LAG, FTD_RECORD, DEALS_DEFAULT_ROWS, DEALS_MAX_ROWS, SEARCH_WORDS,
  answerFromRating, answerFromEstimates, answerFromAnalysts, answerFromSegments, answerFromFtd, answerFromDeals,
  registerTerminalWave12Capabilities, _resetTerminalWave12ForTest, WAVE12_ROUTE_WORDS, ROUTE_GROUP,
} from './capabilities/terminalDataWave12'

registerBuiltins()

const REPO = path.resolve(__dirname, '..', '..', '..')
const py = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n/g, '\n')
const adapter = (name) => py(`api/services/uct_agent/marketdata/${name}.py`)
const pyInt = (src, name) => Number(new RegExp(`^${name} = (\\d+)\\b`, 'm').exec(src)[1])
const pyKind = (src) => /^KIND = "([\w.]+)"/m.exec(src)[1]
const FETCHED = '2031-06-04T15:30:00Z'               // 11:30 AM ET, a Wednesday: the day of the read
const READ_AT = '2031-06-03T00:40:00Z'               // 8:40 PM ET the evening before
const NOTE = 'a provider note that must never be echoed 987654'
const envelope = (kind, data, over = {}) => ({
  contract: 'MD-1.0', kind, params_echo: {}, status: 'ok', freshness: 'periodic', as_of: '2031-06-02T20:00:00Z', fetched_at: FETCHED, delay_s: null,
  stale: false, source: 'fixture', coverage: null, notes: [NOTE], provider_calls: 0, isolated: true, data: { ...data, isolated: true }, ...over,
})
const REFUSED = { status: 'refused', data: null, notes: ['this turn already made 8 data reads'] }
const UNAVAILABLE = { status: 'unavailable', data: null, notes: [NOTE] }
const REFUSED_WORDS = "that request wasn't allowed for this question, so nothing was read"
/** the data's vendors: an answer never names them (FMP's terms forbid naming it as a source: register row T-46) */
const VENDORS = /\b(?:massive|polygon|finnhub|fmp|financial modeling prep|yahoo|yfinance|finviz|nscc)\b/i
function honest(a) {
  expect(a.text).not.toMatch(LIVE_WORDS)
  expect(a.text).not.toContain('987654')
  expect(a.text).not.toContain('8 data reads')
  expect(a.text).not.toMatch(VENDORS)
  expect(a.text).not.toMatch(/\bas of today\b|\btoday's\b|Jun 4, 2031|2031-06-04/i)
  return a
}

// ── ratings → stock.uctRating ──────────────────────────────────────────────────────────────────────────────────────────
const ratingData = (over = {}) => ({ symbol: 'QZRT', composite: 82, components: { eps: 90, rs: 77, growth: 70, value: null, smr: 'B', accdis: 'B+', sponsorship: 60 },
  checkup: [{ label: 'Made-up check one', status: 'pass' }, { label: 'Made-up check two', status: 'fail' }, { label: 'Made-up check three', status: 'neutral' }],
  method: 'made-up', basis: 'percentile', coverage: null, universe_n: 3700, sector: 'Made-up Sector', group_rs: 71, price_as_of: '2031-06-02', complete: true, ...over })
describe('stock.uctRating — the answer', () => {
  it('the composite, every component by the panel\'s name, the checkup and the price data\'s own session; a missing component is never 0', () => {
    const a = honest(answerFromRating(envelope(KINDS.rating, ratingData()), 'QZRT'))
    expect(a.text).toContain("QZRT's UCT composite rating as UCT holds it: 82 of 99 (higher is stronger).")
    expect(a.text).toContain('Components: EPS Strength 90, Relative Strength 77, Growth 70, Value not stated, SMR B, Acc / Dis B+, Sponsorship 60.')
    expect(a.text).toContain('Stock checkup: 1 check passes, 1 fails, 1 cannot be judged.')
    expect(a.text).toContain('The price inputs end with the session of Mon, Jun 2, 2031')
    expect(a.text).toContain(RATING_RECORD)
    expect(a.text).toContain(RATING_LEFT_OUT)
    expect(a.facts).toMatchObject({ symbol: 'QZRT', as_of: '2031-06-02', composite: 82, passed: 1, failed: 1 })
    expect(a.facts.components.value).toBeNull()
    const partial = honest(answerFromRating(envelope(KINDS.rating, ratingData({ complete: false }), { status: 'partial', stale: true }), 'QZRT'))
    expect(partial.text).toContain('One or more inputs could not be read')
    expect(partial.text).toContain('Stale: the price inputs end before the last completed session')
  })
  it('not held, refused and an unclean answer are never "no rating"', () => {
    expect(answerFromRating(UNAVAILABLE, 'QZRT').text).toBe("I couldn't read QZRT's UCT composite rating: it is not held on the server yet (this answer never works it out), QZRT is a fund, or the read failed. Open RTG for QZRT in UCT, then ask again. No rating is stated. That is not the same as a low rating.")
    expect(answerFromRating(REFUSED, 'QZRT').text).toContain(REFUSED_WORDS)
    expect(answerFromRating(envelope(KINDS.rating, ratingData({ composite: null })), 'QZRT').text).toMatch(/did not answer cleanly/)
  })
})

// ── estimates.history → stock.estimatesHistory ─────────────────────────────────────────────────────────────────────────
const mv = (state, pct, reason = null) => ({ state, reason, pct, from: null, to: null, from_date: null, to_date: null })
const estimatesData = (over = {}) => ({ symbol: 'QZRT', state: 'ok', covers_from: '2031-02-03', last_snapshot: '2031-06-02', store_newest: '2031-06-02', snapshot_days: 80,
  currency: null, tracked: { origin: 'sp500', count: 510, cap: 600 }, windows: [7, 30, 90], tolerance_pct: 0.5, slack_days: 4,
  periods: [{ period_end: '2031-06-30', n: 80, first_snapshot: '2031-02-03', upcoming: true,
    newest: { snap_date: '2031-06-02', eps_avg: 2.4, eps_low: 2.2, eps_high: 2.7, n_eps: 12, rev_avg: 1.04e9, rev_low: null, rev_high: null, n_rev: 10 },
    moves: { eps: { 7: mv('up', 4.36), 30: mv('held', 0.2), 90: mv('collecting', null, 'made-up reason') }, revenue: { 7: mv('down', -1.5), 30: mv('gap', null), 90: mv('not_comparable', null) } } }],
  failed_days: 2, failed_newest: ['2031-05-20'], left_out: ['points', 'year'], ...over })
describe('stock.estimatesHistory — the answer', () => {
  it('each upcoming quarter\'s newest consensus and its 7 / 30 / 90-day moves by the EEHSC rule, the tracked origin, the gaps; a move it cannot give is never 0', () => {
    const a = honest(answerFromEstimates(envelope(KINDS.estimates, estimatesData()), 'QZRT'))
    expect(a.text).toContain("QZRT's consensus estimates as UCT snapshots them, Feb 3, 2031 to Jun 2, 2031 (80 snapshot days):")
    expect(a.text).toContain('• The quarter ending Jun 30, 2031: EPS $2.40 ($2.20 to $2.70) from 12 analysts; over 7 / 30 / 90 days raised +4.4% / held +0.2% / too new to say.')
    expect(a.text).toContain('over 7 / 30 / 90 days cut -1.5% / a snapshot is missing / not comparable.')
    expect(a.text).toContain("QZRT is in the population UCT snapshots because it is on the S&P 500 list UCT's daily job seeds (510 of at most 600 stocks are tracked).")
    expect(a.text).toContain('2 snapshot days failed to read for QZRT')
    expect(a.text).toContain(ESTIMATES_RECORD)
    expect(a.text).toContain(ESTIMATES_LEFT_OUT)
    expect(a.facts.periods[0].eps_moves).toEqual({ 7: 4.36, 30: 0.2, 90: null })
    const stale = honest(answerFromEstimates(envelope(KINDS.estimates, estimatesData({ store_newest: '2031-06-03' })), 'QZRT'))
    expect(stale.text).toContain("Stale: QZRT's newest snapshot (Jun 2, 2031) is older than the store's newest (Jun 3, 2031)")
    const none = honest(answerFromEstimates(envelope(KINDS.estimates, estimatesData({ periods: [] })), 'QZRT'))
    expect(none.text).toContain('No upcoming quarter is held for QZRT, so no estimate is stated. That is not the same as no estimates.')
  })
  it('not held (or not tracked), refused and an unclean answer are never "no estimates"', () => {
    expect(answerFromEstimates(UNAVAILABLE, 'QZRT').text).toContain('QZRT is not among the stocks UCT snapshots')
    expect(answerFromEstimates(UNAVAILABLE, 'QZRT').text).toMatch(/That is not the same as no estimates\.$/)
    expect(answerFromEstimates(REFUSED, 'QZRT').text).toContain(REFUSED_WORDS)
    expect(answerFromEstimates(envelope(KINDS.estimates, estimatesData({ periods: null })), 'QZRT').text).toMatch(/did not answer cleanly/)
  })
})

// ── analyst.ratings → stock.consensusRating ────────────────────────────────────────────────────────────────────────────
const analystsData = (over = {}) => ({ symbol: 'QZRT', covered: true, outage: false, actions_total: 9,
  consensus: { strongBuy: 3, buy: 9, hold: 4, sell: 1, strongSell: 0, total: 17, label: 'Buy', observed_at: '2031-06-02T12:00:00Z' },
  price_target: { high: 300, low: 150, median: 220, consensus: 230, last_month: { count: 4, avg: 240 }, last_quarter: { count: 0, avg: null }, last_year: { count: 20, avg: 205 }, observed_at: '2031-06-02T12:00:00Z' },
  upside: { target: 'consensus', target_value: 230, close: 200, close_date: '2031-06-02', pct: 15, basis: 'stored_close' },
  recent_actions: Array.from({ length: 7 }, (_, i) => ({ date: `2031-05-2${8 - i}`, company: `Made-up Firm ${i}`, action: 'upgrade', from_grade: 'Hold', to_grade: 'Buy' })),
  left_out: ['trend', 'revisions'], ...over })
describe('stock.consensusRating — the answer', () => {
  it('the counts by rating, the consensus, the target, the upside from the stored close (not the last trade), the actions cut from the old end', () => {
    const a = honest(answerFromAnalysts(envelope(KINDS.analysts, analystsData(), { as_of: '2031-06-02T12:00:00Z' }), 'QZRT'))
    expect(a.text).toContain("QZRT's analyst consensus as UCT holds it: Buy from 17 analysts (3 Strong Buy, 9 Buy, 4 Hold, 1 Sell, 0 Strong Sell).")
    expect(a.text).toContain('Price target (USD): consensus $230.00, median $220.00, from $150.00 to $300.00.')
    expect(a.text).toContain('Average targets: last month $240.00 (4 targets); last year $205.00 (20 targets).')   // a window with no target is left out
    expect(a.text).toContain('Upside to the consensus target: +15.0% from the close of Mon, Jun 2, 2031 ($200.00), not the last trade.')
    expect(a.text).toContain('• May 28, 2031: Made-up Firm 0 upgrade (Hold to Buy)')
    expect(a.text).toContain('1 more is in the table.')
    expect(a.text).toContain('9 recent actions are held and the newest 7 are in this answer: the list is cut from the old end.')
    expect(a.text).toContain(ANALYSTS_RECORD)
    expect(a.facts).toMatchObject({ covered: true, consensus: 'Buy', total: 17, target: 230, upside_pct: 15, actions: 7 })
    const noUp = honest(answerFromAnalysts(envelope(KINDS.analysts, analystsData({ upside: null })), 'QZRT'))
    expect(noUp.text).toContain('No upside is stated: the target or a stored close is missing (that is not an upside of 0).')
    const out = honest(answerFromAnalysts(envelope(KINDS.analysts, analystsData({ outage: true }), { status: 'partial' }), 'QZRT'))
    expect(out.text).toContain('a missing section is not the same as none')
    const none = honest(answerFromAnalysts(envelope(KINDS.analysts, analystsData({ covered: false, consensus: null, price_target: null, upside: null, recent_actions: [] }), { as_of: null }), 'QZRT'))
    expect(none.text).toContain('No analyst coverage is on file for QZRT')
    expect(none.text).toContain('carries no time the source observed it')
  })
  it('not held, refused and an unclean answer are never "no coverage"', () => {
    expect(answerFromAnalysts(UNAVAILABLE, 'QZRT').text).toMatch(/^I couldn't read QZRT's analyst ratings: they are not held on the server yet .*That is not the same as no coverage\.$/)
    expect(answerFromAnalysts(REFUSED, 'QZRT').text).toContain(REFUSED_WORDS)
    expect(answerFromAnalysts(envelope(KINDS.analysts, analystsData({ covered: undefined })), 'QZRT').text).toMatch(/did not answer cleanly/)
  })
  it('the limits are the kind\'s own (read from the adapter)', () => {
    const src = adapter('analyst_ratings_read')
    expect(pyKind(src)).toBe(KINDS.analysts)
    expect([pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([ANALYSTS_DEFAULT_ROWS, ANALYSTS_MAX_ROWS])
    expect([pyInt(adapter('revenue_segments_read'), 'DEFAULT_ROWS'), pyInt(adapter('revenue_segments_read'), 'MAX_ROWS')]).toEqual([SEGMENTS_DEFAULT_ROWS, SEGMENTS_MAX_ROWS])
    expect([pyInt(adapter('ftd_read'), 'DEFAULT_ROWS'), pyInt(adapter('ftd_read'), 'MAX_ROWS')]).toEqual([FTD_DEFAULT_ROWS, FTD_MAX_ROWS])
    expect([pyInt(adapter('company_deals_read'), 'DEFAULT_ROWS'), pyInt(adapter('company_deals_read'), 'MAX_ROWS')]).toEqual([DEALS_DEFAULT_ROWS, DEALS_MAX_ROWS])
    expect([pyKind(adapter('estimate_history_read')), pyKind(adapter('revenue_segments_read')), pyKind(adapter('ftd_read')), pyKind(adapter('company_deals_read'))])
      .toEqual([KINDS.estimates, KINDS.segments, KINDS.ftd, KINDS.deals])
    expect(/^SOURCE = "uct-ratings"$/m.test(adapter('ratings'))).toBe(true)
  })
})

// ── company.segments → stock.revenueSplit ──────────────────────────────────────────────────────────────────────────────
const leg = (label, date, segs, prior) => ({ state: 'ok', latest: { date, label, currency: 'USD', total: 1000, segments: segs, segments_total: segs.length + 1, cut: true }, prior })
const segmentsData = (over = {}) => ({ symbol: 'QZRT', rows: 8, growth_basis: 'a year earlier, from held periods', left_out: ['earlier_periods'],
  splits: { annual: { state: 'held', read_at: READ_AT,
    product: leg('FY2031', '2031-01-31', [{ name: 'Made-up Chips', revenue: 600000000, share: 60, prior: 400000000, growth_pct: 50 }, { name: 'Made-up Boards', revenue: 4000000, share: 0.4, prior: null, growth_pct: null }], { date: '2030-01-31', label: 'FY2030' }),
    region: { state: 'not_in_plan', latest: null, prior: null } },
  quarter: { state: 'not_held' } }, ...over })
describe('stock.revenueSplit — the answer', () => {
  it('each held split\'s segments with revenue, share and growth on a year earlier, the cut, a leg the source did not give and a period not held', () => {
    const a = honest(answerFromSegments(envelope(KINDS.segments, segmentsData(), { as_of: '2031-01-31T05:00:00Z' }), 'QZRT'))
    expect(a.text).toContain('The fiscal year FY2031 by product (ended Jan 31, 2031, against FY2030):')
    expect(a.text).toContain('• Made-up Chips: $600.0M, 60.0% of the segments listed, +50.0% on a year earlier')
    expect(a.text).toContain('• Made-up Boards: $4.0M, 0.4% of the segments listed, no year-earlier figure')          // never a growth of 0
    expect(a.text).toContain('3 segments are held and the largest 2 are in this answer: the smallest are cut.')
    expect(a.text).toContain("The year's split by region is not stated: the site's plan with the source does not include it. That is not the same as no segments.")
    expect(a.text).toContain("The newest quarter's split is not held on the server yet (this answer never builds it): open SEG QUARTERLY for QZRT in UCT, then ask again.")
    expect(a.facts).toMatchObject({ symbol: 'QZRT', as_of: '2031-01-31', splits: { annual: 'held', quarter: 'not_held' } })
    expect(a.table.rows[1].growth).toBe('n/a')
  })
  it('not held, refused and an unclean answer are never "no segments"', () => {
    expect(answerFromSegments(UNAVAILABLE, 'QZRT').text).toMatch(/That is not the same as no segments\.$/)
    expect(answerFromSegments(REFUSED, 'QZRT').text).toContain(REFUSED_WORDS)
    expect(answerFromSegments(envelope(KINDS.segments, segmentsData({ splits: null })), 'QZRT').text).toMatch(/did not answer cleanly/)
  })
})

// ── stock.failsToDeliver → stock.failsToDeliver ────────────────────────────────────────────────────────────────────────
const pt = (d, q, price) => ({ settle_date: d, quantity: q, price, value: price === null ? null : q * price })
const ftdData = (over = {}) => ({ symbol: 'QZRT', state: 'ok', window: { from: '2030-12-01', through: '2031-05-15' }, basis: 'made-up basis words',
  latest: pt('2031-05-14', 90000, 12.5), trend: { previous: pt('2031-05-13', 45000, null), change: 45000, peak: pt('2031-03-03', 120000, 10), latest_vs_peak_pct: 75 },
  days_reported: 9, rows: [pt('2031-05-14', 90000, 12.5), pt('2031-05-13', 45000, null)], files_ingested: 11, mismatched_files: ['cnsfails203103a'], newest_file: 'cnsfails203105a', ...over })
describe('stock.failsToDeliver — the answer', () => {
  it('the newest balance with its value, the change and the peak, the rows newest first, the cut, the lag; a row with no price has no value (never 0)', () => {
    const a = honest(answerFromFtd(envelope(KINDS.ftd, ftdData()), 'QZRT'))
    expect(a.text).toContain("QZRT's fails to deliver as UCT holds them from the SEC's files for Dec 1, 2030 to May 15, 2031: 90,000 shares on May 14, 2031 ($1.1M).")
    expect(a.text).toContain('The reported day before (May 13, 2031): 45,000 shares, a change of +45,000 shares.')
    expect(a.text).toContain("The window's peak: 120,000 shares on Mar 3, 2031; the newest is 75.0% of it.")
    expect(a.text).toContain('• May 13, 2031: 45,000 shares, no value')
    expect(a.text).toContain('9 days are reported and the newest 2 are in this answer: the list is cut from the old end.')
    expect(a.text).toContain('1 file did not reconcile with its own row count and is kept, marked.')
    expect(a.text).toContain(FTD_LAG)
    expect(a.text).toContain(FTD_RECORD)
    expect(a.facts).toMatchObject({ as_of: '2031-05-14', latest: 90000, change: 45000, days: 9 })
    const none = honest(answerFromFtd(envelope(KINDS.ftd, ftdData({ state: 'none_reported', latest: null, trend: null, rows: [], days_reported: 0, mismatched_files: [] })), 'QZRT'))
    expect(none.text).toContain('No fails-to-deliver row for QZRT is in the SEC files UCT holds for Dec 1, 2030 to May 15, 2031. No record matched; that is not the same as no fails ever.')
  })
  it('not held, refused and an unclean answer are never "no fails"', () => {
    expect(answerFromFtd(UNAVAILABLE, 'QZRT').text).toMatch(/That is not the same as no fails\.$/)
    expect(answerFromFtd(REFUSED, 'QZRT').text).toContain(REFUSED_WORDS)
    expect(answerFromFtd(envelope(KINDS.ftd, ftdData({ window: null })), 'QZRT').text).toMatch(/did not answer cleanly/)
  })
})

// ── company.deals → stock.companyDeals ─────────────────────────────────────────────────────────────────────────────────
const dealsData = (over = {}) => ({ symbol: 'QZRT',
  deals: { state: 'held', read_at: READ_AT, search: 'ok', name: 'Made-up Rt Inc', total: 2, cut: false, other_companies: 1, from_latest: 1,
    deals: [{ date: '2031-04-10', accepted_at: null, role: 'target', acquirer: { sym: 'QZOT', name: 'Made-up Other Corp' }, target: { sym: 'QZRT', name: 'Made-up Rt Inc' }, link: 'https://www.sec.gov/made-up' },
      { date: '2031-03-02', accepted_at: null, role: 'acquirer', acquirer: { sym: 'QZRT', name: 'Made-up Rt Inc' }, target: { sym: null, name: 'Made-up Tiny Co' }, link: null }] },
  index_changes: { state: 'held', read_at: READ_AT, indexes: { sp500: 'ok', nasdaq100: 'none', dow: 'not_in_plan' }, total: 1, cut: false,
    changes: [{ index: 'sp500', index_name: 'S&P 500', date: '2031-03-20', side: 'added', added: { sym: 'QZRT', name: 'Made-up Rt Inc' }, removed: { sym: 'QZOLD', name: 'Made-up Old Co' }, reason: 'Made-up reason words.' }] },
  ...over })
describe('stock.companyDeals — the answer', () => {
  it('both parts with their own read time, the role, the filing, the index and what it replaced, the index list not read', () => {
    const a = honest(answerFromDeals(envelope(KINDS.deals, dealsData(), { as_of: null }), 'QZRT'))
    expect(a.text).toContain(`Mergers and acquisitions naming QZRT (Made-up Rt Inc), newest first (${SEARCH_WORDS.ok}):`)
    expect(a.text).toContain('• Apr 10, 2031: Made-up Other Corp (QZOT) acquiring Made-up Rt Inc (QZRT) (QZRT the target), with its SEC filing')
    expect(a.text).toContain('• Mar 2, 2031: Made-up Rt Inc (QZRT) acquiring Made-up Tiny Co (QZRT the acquirer)')
    expect(a.text).toContain('1 more deal matched the name search but name a different company; not in this answer.')
    expect(a.text).toContain('• Mar 20, 2031: added to the S&P 500, replacing Made-up Old Co (QZOLD) (Made-up reason words.)')
    expect(a.text).toContain('The Dow 30 list was not read when UCT last asked, so its changes are not stated.')
    expect(a.text).toMatch(/UCT read them from the source: deals at [^;]*8:40 PM ET; index changes at [^(]*8:40 PM ET \(UCT's own time\)/)
    expect(a.facts).toEqual({ symbol: 'QZRT', deals: 2, index_changes: 1, search: 'ok' })
  })
  it('no row is "no record matched", never "none exist"; a part not held, only the latest list, refused and unclean are each said', () => {
    const none = honest(answerFromDeals(envelope(KINDS.deals, dealsData({ deals: { ...dealsData().deals, deals: [], total: 0, other_companies: 0 },
      index_changes: { ...dealsData().index_changes, changes: [], total: 0 } }), { as_of: null }), 'QZRT'))
    expect(none.text).toContain(`No deal in what UCT holds matched QZRT (${SEARCH_WORDS.ok}). No record matched; that is not the same as a company with no deals.`)
    expect(none.text).toContain('No addition to or removal from the S&P 500, the Nasdaq 100 or the Dow 30 in what UCT holds matched QZRT. No record matched; that is not the same as a stock never in an index.')
    const part = honest(answerFromDeals(envelope(KINDS.deals, dealsData({ deals: { ...dealsData().deals, state: 'latest_only', search: 'not_run' }, index_changes: { state: 'not_held' } }), { as_of: null }), 'QZRT'))
    expect(part.text).toContain(SEARCH_WORDS.not_run)
    expect(part.text).toContain("QZRT's index changes are not held on the server yet (this answer never builds them): open IDXC for QZRT in UCT, then ask again.")
    expect(part.facts.index_changes).toBeNull()
    expect(answerFromDeals(UNAVAILABLE, 'QZRT').text).toMatch(/That is not the same as none\.$/)
    expect(answerFromDeals(REFUSED, 'QZRT').text).toContain(REFUSED_WORDS)
    expect(answerFromDeals(envelope(KINDS.deals, dealsData({ deals: null })), 'QZRT').text).toMatch(/did not answer cleanly/)
  })
})

// ── served vs dark ─────────────────────────────────────────────────────────────────────────────────────────────────────
let calls = []
const ENVS = {}
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
function wire(kinds) {
  calls = []
  for (const k of Object.keys(ENVS)) delete ENVS[k]
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push([u, body])
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: kinds !== null, scan: false, data_kinds: kinds || [] })
    if (u === '/api/agent/data') { const e = ENVS[body.kind]; return json((typeof e === 'function' ? e(body.params) : e) || { status: 'refused', data: null, notes: ['refused'] }) }
    return json({}, 404)
  })
}
const reads = () => calls.filter(c => c[0] === '/api/agent/data').map(c => c[1])
async function inTurn(fn) { turnStart('send'); try { return await fn() } finally { turnEnd() } }
const KEYS = Object.keys(KINDS)
const ALL = Object.values(CAPABILITIES)
const PAIRS = KEYS.map(k => [KINDS[k], CAPABILITIES[k]])
const reset = () => { _resetAgentConfig(); _resetTurns(); _resetCotForTest(); _resetTerminalDataForTest(); _resetTerminalLocalForTest(); _resetTerminalWave2ForTest(); _resetTerminalWave3ForTest(); _resetTerminalWave4ForTest();
  _resetTerminalWave5ForTest(); _resetTerminalWave6ForTest(); _resetTerminalWave7ForTest(); _resetTerminalWave8ForTest(); _resetTerminalWave9ForTest(); _resetTerminalWave10ForTest(); _resetTerminalWave11ForTest();
  _resetTerminalWave12ForTest(); _resetHistoryForTest(); _resetDescribeForTest() }

describe('served vs dark', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the six kinds and the six capabilities, by name', () => {
    expect(KINDS).toEqual({ rating: 'ratings', estimates: 'estimates.history', analysts: 'analyst.ratings', segments: 'company.segments', ftd: 'stock.failsToDeliver', deals: 'company.deals' })
    expect(CAPABILITIES).toEqual({ rating: 'stock.uctRating', estimates: 'stock.estimatesHistory', analysts: 'stock.consensusRating', segments: 'stock.revenueSplit', ftd: 'stock.failsToDeliver', deals: 'stock.companyDeals' })
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'quotes', 'themes', 'earnings', 'fundamentals', 'analyst.actions', 'estimates.revisionBreadth', 'short.interest', 'stock.stats'], 'other kinds only']])('dark (%j, %s): none of the six is registered', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    expect(registerTerminalWave12Capabilities()).toEqual([])
    registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames(), n).not.toContain(n)
  })

  it.each(PAIRS)('served %s alone: only %s is registered, once, and it unregisters cleanly', async (kind, capability) => {
    wire([kind])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([capability])
    expect(registerTerminalWave12Capabilities()).toEqual([])            // idempotent
    reset()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([])
  })

  it('all six served: local-only on BOTH sides, never a plain data read, no enum, inside the manifest text limits', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const turnPy = py('api/services/uct_agent/turn.py')
    const dataReads = /^DATA_READ_ACTIONS = frozenset\(\{([\s\S]*?)^\}\)/m.exec(turnPy)[1]
    for (const [kind, name] of PAIRS) {
      const cap = getCapability(name)
      expect(cap, name).toBeTruthy()
      expect(cap.query, name).toBe(true)
      expect(cap.localOnly, name).toBe(true)
      expect(groupOfAction(name), name).toBe(ROUTE_GROUP)            // the wave's own group, by action: never the stock data group
      expect(cap.summary.length, name).toBeLessThanOrEqual(MANIFEST_CONTRACT.limits.maxSummary)
      expect(cap.hints.length, name).toBeLessThanOrEqual(MANIFEST_CONTRACT.limits.maxHints)
      expect(cap.hints, name).toMatch(/never today/)
      expect(cap.hints, name).toMatch(/reply: one short line, no figures\.$/)
      expect(cap.args.required, name).toContain('symbol')
      for (const p of Object.values(cap.args.properties)) expect(p.enum, name).toBeUndefined()   // an enum's values would join the typo lexicon
      expect(handshake.isolated_kinds, kind).toContain(kind)          // all six kinds are model-isolated
      expect(handshake.local_only_actions, name).toContain(name)      // turn.LOCAL_ONLY_ACTIONS, via the generated handshake
      expect(dataReads.includes(`"${name}"`), name).toBe(false)       // the two server sets are disjoint
    }
  })

  it('each answer makes ONE read of its own kind, with the member\'s symbol normalised and rows clamped to the kind\'s own limits', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KINDS.rating] = () => envelope(KINDS.rating, ratingData())
    ENVS[KINDS.estimates] = () => envelope(KINDS.estimates, estimatesData())
    ENVS[KINDS.analysts] = () => envelope(KINDS.analysts, analystsData())
    ENVS[KINDS.segments] = () => envelope(KINDS.segments, segmentsData())
    ENVS[KINDS.ftd] = () => envelope(KINDS.ftd, ftdData())
    ENVS[KINDS.deals] = () => envelope(KINDS.deals, dealsData(), { as_of: null })
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    expect((await run(CAPABILITIES.rating, { symbol: ' $qzrt ' })).text).toMatch(/^QZRT's UCT composite rating/)
    expect((await run(CAPABILITIES.estimates, { symbol: 'brk.b' })).text).toBeTruthy()
    expect((await run(CAPABILITIES.analysts, { symbol: 'QZRT', rows: 999 })).text).toMatch(/^QZRT's analyst consensus/)
    expect((await run(CAPABILITIES.segments, { symbol: 'QZRT', rows: 0 })).text).toMatch(/^QZRT's revenue by segment/)
    expect((await run(CAPABILITIES.ftd, { symbol: 'QZRT', rows: null })).text).toMatch(/^QZRT's fails to deliver/)
    expect((await run(CAPABILITIES.deals, { symbol: 'QZRT', rows: 7 })).text).toBeTruthy()
    expect(reads().map(r => [r.kind, r.params, r.purpose])).toEqual([
      [KINDS.rating, { symbol: 'QZRT' }, 'answer'],
      [KINDS.estimates, { symbol: 'BRK-B' }, 'answer'],
      [KINDS.analysts, { symbol: 'QZRT', rows: 12 }, 'answer'],
      [KINDS.segments, { symbol: 'QZRT', rows: 1 }, 'answer'],
      [KINDS.ftd, { symbol: 'QZRT', rows: 10 }, 'answer'],
      [KINDS.deals, { symbol: 'QZRT', rows: 7 }, 'answer'],
    ])
  })

  it('no ticker asks for one, no read without a turn, and a refusal is answered in fixed words', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    for (const name of ALL) expect((await inTurn(() => getCapability(name).answer(null, { symbol: 'not a ticker' }, null))).text, name).toMatch(/^Which stock's .* Give me one ticker\./)
    for (const name of ALL) expect((await getCapability(name).answer(null, { symbol: 'QZRT' }, null)).text, name).toMatch(/needs the Agent's turn/)
    expect(reads()).toEqual([])
    for (const name of ALL) {                                           // the stub refuses every kind
      const a = await inTurn(() => getCapability(name).answer(null, { symbol: 'QZRT' }, null))
      expect(a.text, name).toMatch(/^I couldn't read .*: that request wasn't allowed for this question, so nothing was read\./)
      expect(a.facts, name).toBeUndefined()
    }
    expect(reads()).toHaveLength(ALL.length)
  })
})

// ── routing: the wave's own words-only group, armed only while a capability is registered ───────────────────────────────
const ownGroup = () => GROUPS.find(g => g.id === ROUTE_GROUP)
const groupWords = (id) => GROUPS.find(g => g.id === id).words
const DATA_BASE = [...groupWords('data')]              // read before anything is served: routing.js's own lists
const ROUTE_OPTS = () => ({ enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold })
const namedBy = (words) => (text) => Object.keys(words).filter(k => words[k].some(re => re.test(String(text).toLowerCase())))
const wordKeys = namedBy(WAVE12_ROUTE_WORDS)
/** plain member asks, by the capability whose words must name them (and no earlier wave's words) */
const ASKS = {
  rating: ['NVDA UCT rating', "what is AMD's composite rating", 'uct score for TSLA', 'show me the stock checkup for AAPL', 'the uct composite score on MSFT'],
  estimates: ['NVDA estimate history', "how have AAPL's estimates changed", 'eps estimate revisions for MSFT', 'the revenue estimate trend for AMZN', 'estimate history on CRM'],
  analysts: ['price target for NVDA', "AMD's price target", "what's the consensus target on AAPL", 'consensus rating on TSLA', 'how many analysts rate MSFT a buy',
    'buy hold sell count for AMZN', 'upside to the price target for NFLX', 'street target for META'],
  segments: ['NVDA revenue by segment', 'AAPL revenue by region', 'segment revenue for MSFT', 'where does AMZN make its money', 'revenue breakdown for GOOGL', 'geographic revenue of TSLA'],
  ftd: ['NVDA fails to deliver', 'fails-to-deliver for GME', 'failures to deliver in AMC', 'show me the fail to deliver data for TSLA'],
  deals: ['mergers involving NVDA', 'has WBA been acquired', 'when was TSLA added to the S&P 500', 'acquisitions by MSFT', 'was XOM removed from the dow', 'index history for AAPL'],
}
/** asks a neighbour's words ALSO name: both groups ride along, and the model is offered both capabilities */
const SHARED = [['analyst ratings for NVDA', 'analysts', 'data'], ['analyst price targets for NVDA', 'analysts', 'data']]
/** another capability's language: none of the six's words may name these */
const NOT_OURS = [
  'NVDA RS rating', 'relative strength rating for AMD', 'what got upgraded today', 'upgrades and downgrades', 'price target changes today', 'analysts raised price targets on NVDA',
  'estimate revisions by sector', 'revision breadth', 'eps revisions across sectors', 'NVDA earnings estimates', 'what is the eps estimate for NVDA', 'NVDA earnings', 'NVDA revenue',
  'NVDA income statement', 'NVDA fundamentals', 'follow through day', 'was there a follow-through day', 'short interest on NVDA', 'NVDA days to cover', 'which funds hold NVDA',
  'latest mergers', 'recent acquisitions', 'mergers this week', 'index changes', 'stocks added to the S&P 500 recently', 'upcoming index changes', 'IPO calendar',
  'screen for uct composite above 80', 'scan for stocks with a composite rating over 90', 'alert me when NVDA price target changes', 'add NVDA to my watchlist',
  'what is a composite rating', 'what are fails to deliver', 'explain the uct rating', 'define price target', 'what is a price target',
  'RTG', 'EEH', 'ANR', 'SEG', 'FTD', 'MNA', 'IDXC', 'open RTG for NVDA', 'NVDA SEG', 'NVDA MNA', 'IDXC NASDAQ100', 'NVDA PEER', 'NVDA peers', 'competitors of NVDA',
  'rating', 'score', 'estimates', 'segments', 'deals', 'mergers', 'acquired', 'target', 'consensus', 'analyst ratings', 'analysts',
]
/** asks the earlier waves' words name (their own tests hold the full lists): this wave's words must not */
const EARLIER_ASKS = ['what got upgraded today', 'new highs today', 'top gainers over 60 days', 'dark pool levels on NVDA', 'recent IPOs', 'which themes are rotating in',
  'expected move for NVDA earnings', 'gamma levels for NVDA', 'earnings season today', 'short interest on NVDA', 'NVDA seasonality', 'treasury yields', 'the market regime',
  'confirmed setups on NVDA', 'NVDA events timeline', 'NVDA IV history', 'NVDA dilution', 'NVDA corporate actions', 'IPO calendar', 'treasury auctions', 'fed watch',
  'NVDA stock stats', 'pocket pivots on NVDA', 'NVDA factor exposure', 'NVDA setup history', 'clinical trials for LLY', 'which funds hold NVDA',
  'industry group rank', 'sector crowding', 'earnings by sector', 'estimate revisions by sector', 'richest options', 'IPO lockups', 'futures by trader type']
const EARLIER_WORDS = [TERMINAL_ROUTE_WORDS, WAVE2_ROUTE_WORDS, WAVE3_ROUTE_WORDS, WAVE4_ROUTE_WORDS, WAVE5_ROUTE_WORDS, WAVE6_ROUTE_WORDS, WAVE7_ROUTE_WORDS, WAVE8_ROUTE_WORDS,
  WAVE9_ROUTE_WORDS, WAVE10_ROUTE_WORDS, WAVE11_ROUTE_WORDS, { cot: COT_ROUTE_WORDS }].map(namedBy)
/** the Terminal's own keywords for the functions this wave backs that ITS words name, by code (functions.js); every other
 *  keyword of those codes stays with its owner, said: a bare 'rating' or 'segments' could be anything, ANR's 'upgrades' are
 *  wave 1's, and the MNA / IDXC keywords name the market's lists, which these words leave to the panels */
const TERMINAL_KEYWORDS = {
  RTG: {}, ANR: {}, MNA: {}, IDXC: {},
  EEH: { estimates: ['estimate revisions'] },
  SEG: { segments: ['revenue by segment', 'segment revenue', 'product revenue', 'revenue by product', 'revenue by region', 'geographic revenue', 'revenue mix'] },
  FTD: { ftd: ['fails to deliver'] },
}
const NOT_NAMED = { RTG: ['rating', 'score'], ANR: ['analysts', 'upgrades', 'downgrades', 'price target'], SEG: ['segments', 'business segments'],
  MNA: ['mergers', 'acquisitions', 'm&a', 'takeover', 'acquired'], IDXC: ['index changes', 'added to the s&p', 'index history'], EEH: ['revisions'] }

describe('routing words', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the group is words-only and never a filler, routing.js lists the six by action with no word of its own, and it is the 54th of the 56 the server keeps', () => {
    const g = ownGroup()
    expect(g.wordsOnly && g.fillLast).toBe(true)
    expect(g.words).toEqual([])                                      // server-armed: empty until a capability registers
    expect([...g.actions].sort()).toEqual([...ALL].sort())
    expect(g.domains).toEqual([])
    expect(g.id).toMatch(/^[a-z][a-zA-Z]{1,23}$/)
    expect(g.title.length).toBeLessThanOrEqual(160)                  // the server cuts a group title at 160 characters (turn.py validate_routing)
    const max = Number(/^MAX_GROUPS\s*=\s*(\d+)\s*$/m.exec(py('api/services/uct_agent/turn.py'))[1])
    expect([GROUPS.map(x => x.id).indexOf(ROUTE_GROUP) + 1, max, GROUPS.length <= max]).toEqual([54, 56, true])
    expect(GROUPS.map(x => x.id).slice(51, 54)).toEqual([WAVE10_GROUP, WAVE11_GROUP, ROUTE_GROUP])
    expect(new Set(GROUPS.map(x => x.id)).size).toBe(GROUPS.length)
    for (const other of GROUPS.filter(x => x.id !== ROUTE_GROUP)) for (const n of ALL) expect(other.actions || [], `${other.id}: ${n}`).not.toContain(n)
    expect([WAVE10_GROUP, WAVE11_GROUP].map(id => GROUPS.find(x => x.id === id).actions.length)).toEqual([6, 7])   // held at their sizes
  })

  // (analyst.actions is not among the other kinds here: served, wave 1 arms its own words on the data group)
  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'quotes', 'themes', 'earnings', 'fundamentals', 'stock.stats', 'estimates.revisionBreadth'], 'other kinds only']])('dark (%j, %s): the group has no words, and the data group keeps exactly routing.js\'s', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(ownGroup().words).toEqual([])
    expect(groupWords('data')).toEqual(DATA_BASE)
    for (const asks of Object.values(ASKS)) for (const q of asks) expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
  })

  it.each(KEYS)('served %s alone: only its own words are armed, no other group\'s words change, and they are taken back', async (key) => {
    wire([KINDS[key]])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(ownGroup().words).toEqual(WAVE12_ROUTE_WORDS[key])
    expect(groupWords('data')).toEqual(DATA_BASE)
    expect([WAVE4_GROUP, WAVE5_GROUP, WAVE6_GROUP, WAVE7_GROUP, WAVE8_GROUP, WAVE9_GROUP, WAVE10_GROUP, WAVE11_GROUP, 'cot'].map(groupWords)).toEqual([[], [], [], [], [], [], [], [], []])
    for (const [other, asks] of Object.entries(ASKS)) if (other !== key) for (const q of asks) expect(wordsSelect(ROUTE_GROUP, q), `${key} alone: ${q}`).toBe(false)
    registerTerminalWave12Capabilities()                               // idempotent: never armed twice
    expect(ownGroup().words).toHaveLength(WAVE12_ROUTE_WORDS[key].length)
    reset()
    expect(ownGroup().words).toEqual([])
  })

  it('every capability has words, and each ask is named by its own capability\'s words and by no other of this wave', () => {
    expect(Object.keys(WAVE12_ROUTE_WORDS).sort()).toEqual([...KEYS].sort())
    for (const [key, asks] of Object.entries(ASKS)) for (const q of asks) expect(wordKeys(q), q).toEqual([key])
    for (const [q, key] of SHARED) expect(wordKeys(q), q).toEqual([key])
  })

  it('served: each ask routes its capability under v1 and v2, and the budget never cuts the group', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const [key, asks] of Object.entries(ASKS)) {
      for (const q of asks) {
        expect(wordsSelect(ROUTE_GROUP, q), q).toBe(true)
        expect(selectGroups(q).selected, q).toContain(ROUTE_GROUP)
        for (const route of [routeManifest, routeManifestV2]) {
          const r = route(full, q, ROUTE_OPTS())
          expect(r.manifest.map(c => c.name), `${route.name}: ${q}`).toContain(CAPABILITIES[key])
          expect(r.overBudget || [], `${route.name}: ${q}`).not.toContain(ROUTE_GROUP)
        }
      }
    }
  })

  it('served: the words never name another capability\'s language, and v1 does not send the group for it either', async () => {
    for (const q of NOT_OURS) expect(wordKeys(q), q).toEqual([])
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    for (const q of NOT_OURS) expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
  })

  it('the nearest neighbours keep their own asks, and a shared ask offers both capabilities', async () => {
    wire([...PAIRS.map(p => p[0]), 'analyst.actions', 'estimates.revisionBreadth', 'short.interest', 'earnings', 'fundamentals', 'quote', 'quotes', 'bars.daily', 'news.company',
      'instrument.resolve', 'rs.leadership'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    expect(allCapabilityNames()).toEqual(expect.arrayContaining(['stock.analystActions', 'stock.estimatesBreadth', 'stock.earnings']))   // non-vacuity
    for (const [q, key, group] of SHARED) {
      const sel = selectGroups(q).selected
      expect(sel, q).toContain(ROUTE_GROUP)
      expect(sel, q).toContain(group)
      expect(routeManifest(full, q, ROUTE_OPTS()).manifest.map(c => c.name), q).toContain(CAPABILITIES[key])
    }
    for (const [q, group] of [['what got upgraded today', 'data'], ['estimate revisions by sector', WAVE11_GROUP], ['short interest on NVDA', WAVE5_GROUP]]) {
      expect(selectGroups(q).selected, q).toContain(group)
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
  })

  it('served: the fill for a message nothing recognised never carries the words-only group', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const q of ['flip to AMD', 'lose the gridlines', 'any articles on RIVN lately', 'both', 'hmm', 'rating', 'segments', 'deals']) {
      for (const route of [routeManifest, routeManifestV2]) {
        const names = route(full, q, ROUTE_OPTS()).manifest.map(c => c.name)
        for (const n of ALL) expect(names, `${route.name}: ${q}`).not.toContain(n)
      }
    }
  })

  it('the Terminal codes\' keywords, both ways: this wave names exactly the pinned keywords of the codes it backs, and no keyword of any other code', () => {
    const byCode = Object.fromEntries(FUNCTIONS.map(f => [f.code, (f.keywords || []).map(k => String(k).toLowerCase())]))
    for (const [code, want] of Object.entries(TERMINAL_KEYWORDS)) {
      expect(byCode[code], code).toBeTruthy()
      const named = {}
      for (const kw of byCode[code]) for (const key of wordKeys(kw)) (named[key] = named[key] || []).push(kw)
      expect(named, code).toEqual(want)
      for (const kws of Object.values(want)) for (const kw of kws) expect(byCode[code], `${code}: ${kw}`).toContain(kw)    // the keyword is the Terminal's own
      const left = byCode[code].filter(kw => !wordKeys(kw).length)
      for (const kw of NOT_NAMED[code] || []) expect(left, `${code}: ${kw}`).toContain(kw)
    }
    const others = FUNCTIONS.filter(f => !Object.prototype.hasOwnProperty.call(TERMINAL_KEYWORDS, f.code)).flatMap(f => (f.keywords || []).map(k => `${f.code}: ${k}`))
    expect(others.length).toBeGreaterThan(100)
    expect(others.filter(x => wordKeys(x.split(': ')[1]).length)).toEqual([])
  })

  it('the typo lexicon: registering the six changes no correction of any OTHER capability\'s capreg corpus phrasing, and adds only the pinned name words', async () => {
    wire([])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const texts = [...new Set(allPhrasings().filter(p => !ALL.includes(p.intent.id)).map(p => p.ph.text)), 'show me the leeders', 'chnage the theme', 'the bord', 'ratng', 'scroe',
      'estimtes', 'histroy', 'consensu', 'revenu', 'splt', 'dela', 'compnay', 'segmnt', 'targt', 'deeds']
    // the REACH of the three new name words, pinned: a misspelling one edit from "fails", "deliver" or "deals" gains that word as
    // a candidate (and keeps every candidate it had). No corpus phrasing is among them (the list above stays unchanged).
    const REACH = {
      fail: ['["tail","rail"]', '["tail","rail","fails"]'], fials: ['["fills"]', '["fills","fails"]'], delivr: ['[]', '["deliver"]'],
      deal: ['["teal","real"]', '["teal","real","deals"]'], dels: ['[]', '["deals"]'], 'fials to delivr': ['[]', '["fills to deliver","fails to deliver"]'],
    }
    const fix = (t, lex) => JSON.stringify((correctTypos(t, lex) || []).map(v => v.text))
    const read = (xs) => { const lex = lexiconFor(null); return xs.map(t => fix(t, lex)) }
    const before = read(texts)
    const reachBefore = read(Object.keys(REACH))
    const known = new Set(lexiconFor(null).words)
    _resetAgentConfig(); wire(PAIRS.map(p => p[0])); await loadAgentConfig(); registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames()).toContain(n)
    const after = read(texts)
    expect(texts.length).toBeGreaterThan(500)
    expect(texts.map((t, i) => (before[i] !== after[i] ? `${t}: ${before[i]} -> ${after[i]}` : null)).filter(Boolean)).toEqual([])
    expect(Object.fromEntries(Object.keys(REACH).map((t, i) => [t, [reachBefore[i], read([t])[0]]]))).toEqual(REACH)
    // the six add only their own name words the production catalog does not know; every other word of a summary and a hint is
    // either already known or written in CAPITALS, which the lexicon skips
    expect([...lexiconFor(null).words].filter(w => !known.has(w)).sort()).toEqual(['deals', 'deliver', 'fails'])
  })

  it('no OTHER capability\'s capreg corpus phrasing is named by these words (armed, the group rides with none of them)', () => {
    const others = [...new Set(allPhrasings().filter(p => !ALL.includes(p.intent.id)).map(p => p.ph.text))]
    expect(others.length).toBeGreaterThan(500)
    expect(others.filter(t => wordKeys(t).length)).toEqual([])
  })

  it('this wave\'s own corpus phrasings are each named by their own capability\'s words (four dark phrasings each)', () => {
    for (const key of KEYS) {
      const mine = allPhrasings().filter(p => p.intent.id === CAPABILITIES[key]).map(p => p.ph.text)
      expect(mine.length, key).toBeGreaterThanOrEqual(4)
      for (const q of mine) expect(wordKeys(q), q).toEqual([key])
    }
  })

  it('the earlier waves\' words (and the COT group\'s) name none of this wave\'s asks or phrasings, and these words name none of theirs', () => {
    for (const asks of Object.values(ASKS)) for (const q of asks) expect(EARLIER_WORDS.flatMap(f => f(q)), q).toEqual([])
    const mine = allPhrasings().filter(p => ALL.includes(p.intent.id)).map(p => p.ph.text)
    expect(mine).toHaveLength(24)
    for (const q of mine) expect(EARLIER_WORDS.flatMap(f => f(q)), q).toEqual([])
    for (const q of EARLIER_ASKS) {
      expect(EARLIER_WORDS.flatMap(f => f(q)).length, q).toBeGreaterThan(0)    // non-vacuity: an earlier wave really names it
      expect(wordKeys(q), q).toEqual([])
    }
  })

  it('no row of the routing-collision table is named by these words (every row belongs to another group)', () => {
    expect(collisions.rows.length).toBeGreaterThan(10)
    const stolen = collisions.rows.filter(r => r.owner !== ROUTE_GROUP && !(r.also || []).includes(ROUTE_GROUP) && wordKeys(r.text).length).map(r => `${r.text} (${r.owner})`)
    expect(stolen).toEqual([])
  })
})
