// Terminal data wave 11 — seven LOCAL-ONLY capabilities over seven model-isolated kinds (MD-1 §4.20):
//   stock.groupRank ← groups.rank · stock.groupOwnership ← groups.crowding · stock.sectorEarnings ← earnings.seasonBySector ·
//   stock.estimatesBreadth ← estimates.revisionBreadth · stock.ivRankLeaders ← options.ivRankLeaders · stock.ipoUnlock ← ipo.lockups ·
//   stock.positionTypes ← cot.byTrader.
// Each is registered ONLY while the server serves its own kind, makes ONE read of it, is shown to the member only, says the
// DATA'S OWN date and when UCT worked it out, never calls a missing number 0, says when a list is cut and from which end, never
// calls "not held" or a failed read "none", marks every lockup date an estimate, never names a vendor, and never echoes an
// envelope note. Routing: the seven share ONE words-only group of their own (`marketTables`, the 53rd of the 56 the server
// keeps). Each capability's own words are armed only while it is registered, and they never name another capability's
// language: a stock's RS rank, the sectors' performance, one stock's short interest, insider buying or earnings, who reports
// tonight, one stock's estimate history, one symbol's IV, the IPO calendar, the legacy COT's commercials, alerts, navigation
// and what a term means. The Terminal codes' keywords are checked both ways.
// No model, no provider: /api/agent/config and /api/agent/data are stubbed with synthetic shapes (never market data).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getCapability, allCapabilityNames, manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import './terminalWaves'  // the Terminal data waves: registerServerGatedBuiltins() runs them only once this module has loaded (terminalWavesHook.js)
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
import {
  KINDS, CAPABILITIES, RANK_STATE_WORDS, RANK_DEFAULT_ROWS, RANK_MAX_ROWS, RANK_RECORD, RANK_LEFT_OUT, CROWDING_DEFAULT_ROWS, CROWDING_MAX_ROWS, CROWDING_LEFT_OUT,
  PART_STATE_WORDS, SEASON_RECORD, SEASON_LEFT_OUT, REVISIONS_LEFT_OUT, IVRANK_DEFAULT_ROWS, IVRANK_MAX_ROWS, IVRANK_RECORD,
  LOCKUPS_DEFAULT_ROWS, LOCKUPS_MAX_ROWS, LOCKUPS_RECORD, CHANGE_REASON_WORDS, COT_LEFT_OUT, COT_RECORD,
  answerFromRank, answerFromCrowding, answerFromSeason, answerFromRevisions, answerFromIvRank, answerFromLockups, answerFromCot, seasonOf, sideOf,
  registerTerminalWave11Capabilities, _resetTerminalWave11ForTest, WAVE11_ROUTE_WORDS, ROUTE_GROUP,
} from './capabilities/terminalDataWave11'

registerBuiltins()

const REPO = path.resolve(__dirname, '..', '..', '..')
const py = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n/g, '\n')
const adapter = (name) => py(`api/services/uct_agent/marketdata/${name}.py`)
const pyInt = (src, name) => Number(new RegExp(`^${name} = (\\d+)\\b`, 'm').exec(src)[1])
const pyKind = (src) => /^KIND = "([\w.]+)"/m.exec(src)[1]
const pyTuple = (src, name) => new RegExp(`^${name} = \\(([\\s\\S]+?)\\)`, 'm').exec(src)[1].match(/"[^"]+"/g).map(s => s.slice(1, -1))
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
const VENDORS = /\b(?:massive|polygon|finnhub|fmp|financial modeling prep|yahoo|yfinance|finviz)\b/i
/** every answer of this wave: no live / now wording, never an envelope note, never a vendor's name, and never the day of the
 *  read as the data's date (the day of the read, Jun 4, 2031, appears nowhere) */
function honest(a) {
  expect(a.text).not.toMatch(LIVE_WORDS)
  expect(a.text).not.toContain('987654')
  expect(a.text).not.toContain('8 data reads')
  expect(a.text).not.toMatch(VENDORS)
  expect(a.text).not.toMatch(/\bas of today\b|\btoday's\b|Jun 4, 2031|2031-06-04/i)
  return a
}
const lines = (a) => a.text.split('\n')

// ── groups.rank → stock.groupRank ──────────────────────────────────────────────────────────────────────────────────────
const pt = (position, of, n, median, date, change) => ({ position, of, n, median, date, ...(change === undefined ? {} : { change }) })
const measure = (now, w4, w13, w52, best, worst) => ({ now, w4, w13, w52, best, worst, weeks_ranked: 48 })
const grp = (name, members, m6) => ({ name, members, rank: { m6, m3: m6 } })
const rankData = (over = {}) => ({
  kind: 'sector', session: '2031-06-02', built_for: '2031-06-02', built_at: READ_AT,
  rank: { state: 'ok', weeks: 52, min_members: 5, measures: [{ id: 'm6', sessions: 126 }, { id: 'm3', sessions: 63 }], first_week: '2030-06-06' },
  universe: { symbols: 3500, mapped: 3400, not_mapped: 100 }, stale_for: [], left_out: ['weekly_line', 'fundamentals', 'breadth'],
  groups: [
    grp('Invented Tech', 380, measure(pt(1, 11, 376, 14.2, '2031-05-29'), pt(4, 11, 370, 6.0, '2031-05-01', 3), pt(7, 11, 360, 2.0, '2031-02-27', 6), pt(2, 11, 350, 9.0, '2030-05-30', 1),
      pt(1, 11, 376, 14.2, '2031-05-29'), pt(9, 11, 340, -8.0, '2030-10-31'))),
    grp('Invented Energy', 120, measure(pt(2, 11, 118, 9.9, '2031-05-29'), pt(1, 11, 118, 12.0, '2031-05-01', -1), null, pt(5, 11, 110, 1.0, '2030-05-30', 3),
      pt(1, 11, 118, 12.0, '2031-05-01'), pt(6, 11, 100, -1.0, '2030-09-26'))),
    grp('Invented Utilities', 3, measure(pt(null, 11, 3, null, '2031-05-29'), null, null, null, null, null)),
  ],
  groups_total: 11, ranked_now: 10,
  movers: { w4: { up: [{ name: 'Invented Tech', change: 3, from: pt(4, 11, 370, 6.0, '2031-05-01', 3), to: pt(1, 11, 376, 14.2, '2031-05-29') }], down: [], counted: 9 },
    w13: { up: [], down: [{ name: 'Invented Energy', change: -2, from: pt(1, 11, 100, 1.0, '2031-02-27', -2), to: pt(3, 11, 100, 2.0, '2031-05-29') }], counted: 9 } },
  ...over,
})
const rankEnv = (over = {}, envOver = {}) => envelope(KINDS.rank, rankData(over), envOver)

describe('stock.groupRank — the answer', () => {
  it('each group\'s place, the places moved 4, 13 and 52 weeks back, its best and worst, the cut and the movers, with the data\'s own date', () => {
    const a = honest(answerFromRank(rankEnv(), { kind: 'sector' }))
    const l = lines(a)
    expect(l[0]).toBe('Sectors by weekly rank as UCT holds it (each sector\'s place by the median 6-month price change of its stocks), from the stored closes through Mon, Jun 2, 2031:')
    expect(l[1]).toBe('• 1st of 11 Invented Tech: median +14.2% over 6 months on 376 stocks; 4 weeks ago 4th (climbed 3 places since); 13 weeks ago 7th (climbed 6 places since); '
      + '52 weeks ago 2nd (climbed 1 place since); best 1st (May 29, 2031), worst 9th (Oct 31, 2030).')
    expect(l[2]).toContain('13 weeks ago no such week held')                          // a week not held is said, never a place of 0
    expect(l[3]).toBe('• Invented Utilities: 3 stocks with a 6-month change, fewer than 5: no rank (never a rank of 0).')
    expect(a.text).toContain('11 sectors are held and the top 3 by rank are in this answer: the list is cut from the bottom of the ranking.')
    expect(a.text).toContain('Climbed the most over 4 weeks: Invented Tech (+3, 4th to 1st).')
    expect(a.text).toContain('Fell the most over 13 weeks: Invented Energy (-2, 1st to 3rd).')
    expect(a.text).toContain('No sector fell over 4 weeks.')
    expect(a.text).toContain(RANK_RECORD)
    expect(a.text).toContain(RANK_LEFT_OUT)
    expect(a.text).toMatch(/UCT worked these out at [^\n]*8:40 PM ET \(UCT's own time\)/)
    expect(a.facts).toMatchObject({ kind: 'sector', as_of: '2031-06-02', total: 11, shown: 3, stale: false })
    expect(a.facts.groups[2]).toEqual({ name: 'Invented Utilities', position: null, of: 11, n: 3, w4: null, w13: null, w52: null })
    expect(a.table.rows[0]).toEqual({ group: 'Invented Tech', rank: '1st of 11', moves: '+3 / +6 / +1', range: '1st / 9th' })
    expect(a.table.rows[2].rank).toBe('no rank')
  })
  it('one group in full, a name not in the table, a rank part not held and a stale answer are each said', () => {
    const one = honest(answerFromRank(rankEnv({ groups: undefined, groups_total: undefined, movers: undefined, found: true, name: 'Invented Tech', peers: 11, members: 380,
      group_rank: rankData().groups[0].rank }), { kind: 'sector', name: 'invented tech' }))
    expect(lines(one)[0]).toBe('Invented Tech\'s weekly rank among the sectors, as UCT holds it from the stored closes of its 380 stocks through Mon, Jun 2, 2031:')
    expect(one.text).toContain('• By the 6-month change: 1st of 11 (median +14.2% on 376 stocks); 4 weeks ago 4th (climbed 3 places since)')
    expect(one.facts).toMatchObject({ found: true, position: 1, of: 11 })
    const none = honest(answerFromRank(rankEnv({ groups: undefined, found: false, name: 'Invented Nothing', peers: 11 }), { kind: 'sector' }))
    expect(none.text).toContain('No sector named "Invented Nothing" is in UCT\'s table of 11 sectors')
    expect(none.text).toContain('not the same as a sector with no rank')
    const pending = honest(answerFromRank(rankEnv({ rank: { state: 'pending' }, groups: [], movers: null }), { kind: 'industry' }))
    expect(lines(pending)[0]).toBe(`Industries by weekly rank: ${RANK_STATE_WORDS.pending}`)
    const stale = honest(answerFromRank(rankEnv({ stale_for: ['earlier_evening'] }), {}))
    expect(stale.text).toContain('Stale: UCT worked these out for an earlier evening')
  })
  it('not held, refused and an unclean answer are never "no rank"', () => {
    expect(answerFromRank(UNAVAILABLE, {}).text).toBe('I couldn\'t read the sectors\' weekly rank: it is not held on the server yet (this answer never works it out), or the read failed. Open GRPS RANK in UCT, then ask again. No rank is stated. That is not the same as no rank.')
    expect(answerFromRank(REFUSED, { kind: 'industry' }).text).toContain(`the industries' weekly rank: ${REFUSED_WORDS}.`)
    expect(answerFromRank(rankEnv({ rank: null }), {}).text).toMatch(/did not answer cleanly/)
  })
  it('the limits are the kind\'s own (read from the adapter)', () => {
    const src = adapter('group_rank_read')
    expect(pyKind(src)).toBe(KINDS.rank)
    expect([pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([RANK_DEFAULT_ROWS, RANK_MAX_ROWS])
    expect(pyTuple(src, 'POINTS')).toEqual(['now', 'w4', 'w13', 'w52', 'best', 'worst'])
  })
})

// ── groups.crowding → stock.groupOwnership ─────────────────────────────────────────────────────────────────────────────
const sum = (n, median) => ({ n, median, q1: null, q3: null })
const crowdingData = (over = {}) => ({
  kind: 'sector', built_for: '2031-06-02', built_at: READ_AT, session: '2031-06-02',
  parts: { short: { state: 'ok', settlement_date: '2031-05-15', previous_settlement_date: '2031-04-30', covered: 3000, universe: 3400 },
    insider: { state: 'ok', from: '2031-05-04', to: '2031-06-02', complete: true, keep_days: 30 }, funds: { state: 'not_built' } },
  min_members: 5, top_n: 3, institutions: 'not_held', stale_for: [], left_out: ['institutions', 'rank', 'fundamentals', 'breadth'],
  groups: [
    { name: 'Invented Tech', members: 380, positioning: { short: { reported: 370, pct_float: sum(370, 4.2), days_to_cover: sum(370, 2.1), change: sum(360, 3.5),
      top: [{ sym: 'QZTA', pct_float: 31.5, days_to_cover: 6.2 }] }, insider: { members: 380, buyers: { n: 380, count: 22, share: 5.8 }, purchases: 40, value: 12500000, unpriced: 1, top: [] }, funds: null } },
    { name: 'Invented Utilities', members: 3, positioning: { short: { reported: 3, pct_float: sum(3, null), days_to_cover: sum(3, null), change: sum(3, null), top: [] },
      insider: { members: 3, buyers: { n: 3, count: 0, share: null }, purchases: 0, value: null, unpriced: 0, top: [] }, funds: null } },
  ],
  groups_total: 11, with_figure: 10, ...over,
})
const crowdingEnv = (over = {}, envOver = {}) => envelope(KINDS.crowding, crowdingData(over), { as_of: null, ...envOver })

describe('stock.groupOwnership — the answer', () => {
  it('each group\'s short interest, insider buying and funds, each part\'s date and state, the cut from the low end and the 13F left out', () => {
    const a = honest(answerFromCrowding(crowdingEnv(), {}))
    const l = lines(a)
    expect(l[0]).toBe('Sectors by positioning as UCT holds it, the highest median short interest first (UCT\'s default order):')
    expect(l[1]).toBe('• Invented Tech (380 stocks): median short interest 4.2% of float on 370, days to cover 2.1, change +3.5%; most shorted QZTA 31.5%; 22 of 380 bought on the open market (40 purchases, $12.5M); fund holdings not on hand.')
    expect(l[2]).toContain('• Invented Utilities (3 stocks): 3 in the short interest report, fewer than 5: no median')    // never 0
    expect(a.text).toContain('11 sectors are held and the first 2 are in this answer: the list is cut from the low end.')
    expect(a.text).toContain('Short interest: FINRA\'s report for settlement May 15, 2031, against the one for Apr 30, 2031; reported twice a month.')
    expect(a.text).toContain('Insider buying: open-market purchases (SEC Form 4) filed May 4, 2031 to Jun 2, 2031.')
    expect(a.text).toContain(`Fund holdings: not stated: ${PART_STATE_WORDS.not_built}. That is not the same as none.`)
    expect(a.text).toContain(CROWDING_LEFT_OUT)
    expect(a.facts).toMatchObject({ kind: 'sector', total: 11, shown: 2, parts: { short: 'ok', insider: 'ok', funds: 'not_built' } })
    expect(a.facts.groups[1]).toEqual({ name: 'Invented Utilities', short_median: null, adding_share: null })
  })
  it('one group\'s most shorted members, cut from the least shorted end', () => {
    const members = [{ sym: 'QZTA', pct_float: 31.5, days_to_cover: 6.2, buys: 2, funds_added: 4, funds_cut: 1 }, { sym: 'QZTB', pct_float: null, days_to_cover: null, buys: null, funds_added: null, funds_cut: null }]
    const a = honest(answerFromCrowding(crowdingEnv({ groups: undefined, found: true, name: 'Invented Tech', peers: 11, members: 380, positioning: crowdingData().groups[0].positioning,
      member_rows: members, member_total: 380 }), { name: 'invented tech' }))
    expect(lines(a)[0]).toBe('Invented Tech\'s positioning (380 stocks), as UCT holds it:')
    expect(a.text).toContain('  QZTA: 31.5% of float short, 6.2 days to cover, 2 insider purchases, 4 funds added and 1 cut')
    expect(a.text).toContain('  QZTB: no percent of float')
    expect(a.text).toContain('380 members are held and the 2 most shorted are in this answer: the list is cut from the least shorted end.')
  })
  it('not held, refused and an unclean answer are never "not crowded"', () => {
    expect(answerFromCrowding(UNAVAILABLE, { kind: 'industry' }).text).toMatch(/^I couldn't read the industries' positioning: .* That is not the same as no crowding\.$/)
    expect(answerFromCrowding(REFUSED, {}).text).toContain(REFUSED_WORDS)
    expect(answerFromCrowding(crowdingEnv({ parts: null }), {}).text).toMatch(/did not answer cleanly/)
    expect([pyInt(adapter('group_crowding_read'), 'DEFAULT_ROWS'), pyInt(adapter('group_crowding_read'), 'MAX_ROWS')]).toEqual([CROWDING_DEFAULT_ROWS, CROWDING_MAX_ROWS])
    expect(pyKind(adapter('group_crowding_read'))).toBe(KINDS.crowding)
  })
})

// ── earnings.seasonBySector → stock.sectorEarnings ─────────────────────────────────────────────────────────────────────
const msr = (n, beat, inl, miss, median) => ({ n, beat, in_line: inl, miss, none: 0, beat_pct: n >= 5 ? Math.round(beat / n * 1000) / 10 : null,
  in_line_pct: n >= 5 ? Math.round(inl / n * 1000) / 10 : null, miss_pct: n >= 5 ? Math.round(miss / n * 1000) / 10 : null, median: n >= 5 ? median : null, median_n: n })
const fig = (name, reported, eps, rev, move, yearAgo) => ({ ...(name ? { name, on_file: true } : {}), reported, to_report: 14, awaiting: 3, eps, rev,
  move: { n: reported, median: reported >= 5 ? move : null, rose: Math.floor(reported / 2), rose_pct: reported >= 5 ? 50.0 : null, not_settled: 0, not_measured: 0 }, year_ago: yearAgo })
const seasonData = (over = {}) => ({
  season: 'current',
  seasons: { current: { label: 'Q1 2031', from: '2031-04-01', to: '2031-06-30', through: '2031-06-03', complete: false },
    previous: { label: 'Q4 2030', from: '2031-01-01', to: '2031-03-31', through: '2031-03-31', complete: true }, year_ago: { label: 'Q1 2030', from: '2030-04-01', to: '2030-06-30', through: '2030-06-30', complete: true } },
  today: '2031-06-03', built_at: READ_AT,
  coverage: { universe: 3500, held: 3300, not_held: 200, no_sector: 12, oldest_copy: '2031-05-20', newest_copy: '2031-06-02', copies_old: 4, old_days: 7 },
  total: fig(null, 200, msr(200, 150, 20, 30, 4.2), msr(200, 120, 30, 50, 1.1), 1.0, fig(null, 180, msr(180, 120, 20, 40, 3.0), msr(180, 100, 30, 50, 0.8), 0.4)),
  sectors: [fig('Invented Tech', 40, msr(40, 32, 4, 4, 5.2), msr(40, 30, 5, 5, 1.8), 1.4, fig('Invented Tech', 38, msr(38, 25, 5, 8, 3.1), msr(38, 20, 8, 10, 0.9), 0.5)),
    fig('Invented Utilities', 3, msr(3, 2, 1, 0, 1.0), msr(3, 2, 1, 0, 0.4), 0.2, null)],
  count: 2, in_line_pct: 0.5, in_line_abs: 0.005, min_reporters: 5, season_rule: 'invented rule', stale_for: [], left_out: ['reporters', 'upcoming', 'late'], ...over,
})
const seasonEnv = (over = {}, envOver = {}) => envelope(KINDS.season, seasonData(over), envOver)

describe('stock.sectorEarnings — the answer', () => {
  it('coverage first, the season, each sector\'s beat / in line / miss with the median surprise and move, and the year-earlier line', () => {
    const a = honest(answerFromSeason(seasonEnv(), {}))
    const l = lines(a)
    expect(l[0]).toBe('Only the stocks UCT holds earnings results for: 3,300 of the 3,500 stocks in its universe, not every company that reports.')
    expect(l[1]).toMatch(/^The Q1 2031 season: reports dated .* so far through Jun 3, 2031\.$/)
    expect(a.text).toContain('200 stocks reported, 14 still to report later in the season, 3 past their report date with the result not in UCT\'s copy yet.')
    expect(a.text).toContain('All reporters: 75% beat, 10% in line, 15% missed the EPS consensus (150, 20 and 30 of 200 with a consensus)')
    expect(a.text).toContain('• Invented Tech (40 reported, 14 to come, 3 pending): 80% beat, 10% in line, 10% missed; median surprise +5.2%; median move +1.4%; a year earlier 66% beat.')
    expect(a.text).toContain('• Invented Utilities (3 reported, 14 to come, 3 pending): 3 with a consensus, fewer than 5: no share; median surprise not stated; median move not stated.')
    expect(a.text).toMatch(/^A year earlier \(Q1 2030\): 67% beat/m)
    expect(a.text).toContain('4 held copies are more than 7 days old')
    expect(a.text).toContain(SEASON_RECORD)
    expect(a.text).toContain(SEASON_LEFT_OUT)
    expect(a.facts).toMatchObject({ season: 'current', metric: 'eps', as_of: '2031-06-02', held: 3300, universe: 3500 })
    expect(a.facts.sectors[1]).toEqual({ name: 'Invented Utilities', reported: 3, beat_pct: null, median: null, move: null })
    const rev = honest(answerFromSeason(seasonEnv(), { metric: 'sales' }))
    expect(rev.text).toContain('By sector, the highest revenue beat share first:')
    expect(rev.facts.metric).toBe('revenue')
  })
  it('the season words, nothing reported yet, a stale answer, not held, refused and an unclean answer', () => {
    expect(['current', 'previous', 'last quarter', 'year ago', 'last year', null].map(seasonOf)).toEqual(['current', 'previous', 'previous', 'year_ago', 'year_ago', 'current'])
    const empty = fig(null, 0, msr(0, 0, 0, 0, null), msr(0, 0, 0, 0, null), null, null)
    const none = honest(answerFromSeason(seasonEnv({ total: { ...empty, to_report: 0, awaiting: 0 }, sectors: [] }), {}))
    expect(none.text).toContain('No stock UCT holds results for has reported in this season yet, and none is due.')
    expect(honest(answerFromSeason(seasonEnv({ stale_for: ['earlier_day'] }), {})).text).toContain('Stale: UCT added these up on an earlier day')
    expect(answerFromSeason(UNAVAILABLE, {}).text).toMatch(/That is not the same as no reports\.$/)
    expect(answerFromSeason(REFUSED, {}).text).toContain(REFUSED_WORDS)
    expect(answerFromSeason(seasonEnv({ sectors: null }), {}).text).toMatch(/did not answer cleanly/)
    expect(pyKind(adapter('sector_earnings_read'))).toBe(KINDS.season)
  })
})

// ── estimates.revisionBreadth → stock.estimatesBreadth ─────────────────────────────────────────────────────────────────
const cnt = (name, up, down, held, net, raises = [], cuts = []) => ({ ...(name ? { name, on_file: true } : {}), members: up + down + held + 2, counted: up + down + held, up, down, held,
  not_counted: { collecting: 1, gap: 1, not_comparable: 0 }, net, raises, cuts })
const revisionsData = (over = {}) => ({
  metric: 'eps', window: 30, asof: '2031-06-02', covers_from: '2031-01-05', built_at: READ_AT, tracked: { n: 520, cap: 600, origins: { sp500: 500, viewed: 20 }, no_sector: 3 },
  tolerance_pct: 0.5, slack_days: 4, min_counted: 5, top_n: 3, total: cnt(null, 300, 100, 80, 41.7),
  sectors: [cnt('Invented Tech', 40, 10, 6, 53.6, [{ symbol: 'QZRA', pct: 12.5 }], [{ symbol: 'QZRB', pct: -3.0 }]), cnt('Invented Utilities', 1, 1, 1, null)],
  count: 2, left_out: ['symbols'], ...over,
})
const revisionsEnv = (over = {}, envOver = {}) => envelope(KINDS.revisions, revisionsData(over), envOver)

describe('stock.estimatesBreadth — the answer', () => {
  it('the population first (never the whole market), the window, the net breadth per sector with the largest raises and cuts', () => {
    const a = honest(answerFromRevisions(revisionsEnv(), {}))
    const l = lines(a)
    expect(l[0]).toBe('Among the 520 stocks UCT tracks (the S&P 500 list and stocks members have looked at), not the whole market.')
    expect(l[1]).toMatch(/^Next-quarter EPS estimates, the change over .*Jun 2, 2031 \(the newest snapshot\)\.$/)
    expect(a.text).toContain('All tracked stocks: net +42% (300 raised, 100 cut, 80 held; 480 counted).')
    expect(a.text).toContain('• Invented Tech: net +54% (40 raised, 10 cut, 6 held; 56 counted); largest raises QZRA +12.5%; largest cuts QZRB')
    expect(a.text).toContain('• Invented Utilities: 3 stocks counted, fewer than 5, so no net figure.')     // never a net of 0
    expect(a.text).toContain(REVISIONS_LEFT_OUT)
    expect(a.facts).toMatchObject({ metric: 'eps', window: 30, as_of: '2031-06-02', tracked: 520 })
    expect(a.facts.sectors[1].net).toBeNull()
  })
  it('collecting, not held, refused and an unclean answer are never "no revisions"', () => {
    const c = honest(answerFromRevisions(revisionsEnv({ total: cnt(null, 0, 0, 0, null), sectors: [] }), { window: 7 }))
    expect(c.text).toContain('Snapshots began on')
    expect(answerFromRevisions(UNAVAILABLE, {}).text).toMatch(/the estimate history is switched off on this server, or the read failed\. Open EEHSC in UCT, then ask again\. No count is stated\. That is not the same as no revisions\.$/)
    expect(answerFromRevisions(REFUSED, {}).text).toContain(REFUSED_WORDS)
    expect(answerFromRevisions(revisionsEnv({ tracked: null }), {}).text).toMatch(/did not answer cleanly/)
    expect(pyKind(adapter('revision_breadth_read'))).toBe(KINDS.revisions)
  })
})

// ── options.ivRankLeaders → stock.ivRankLeaders ────────────────────────────────────────────────────────────────────────
const ivRow = (symbol, rank, pctile, iv, low, high) => ({ symbol, atm_iv: iv, iv_rank: rank, iv_percentile: pctile, rank_word: rank >= 50 ? 'high' : 'low', low, high, sessions: 180, atm_dte: 30, open_interest: 150000 })
const ivData = (over = {}) => ({
  side: 'both', session: '2031-06-02', built_at: '2031-06-03T00:45:00Z', data_basis: 'end-of-day snapshot', logging_began: '2030-09-30', sessions_logged: 170, rankable_sessions: 168,
  legacy_sessions: [], unread_sessions: [], missing_sessions: ['2031-01-15'], missing_total: 1,
  counts: { ranked: 4100, below_min: 300, flat: 12, not_in_latest: 40, latest_rows: 4500, latest_no_atm_iv: 60, symbols_logged: 4452 },
  high: [ivRow('QZHA', 98, 97, 0.82, 0.35, 0.84), ivRow('QZHB', 95, 99, 0.6, 0.2, 0.61)], low: [ivRow('QZLA', 1, 2, 0.15, 0.14, 0.6)],
  rank_min_sessions: 20, rank_window: 252, max_per_side: 100, next_run: '2031-06-05T20:45-04:00', last_run: { ok: true, at: '2031-06-03T00:45:00Z' }, stale_for: [], ...over,
})
const ivEnv = (over = {}, envOver = {}) => envelope(KINDS.ivrank, ivData(over), envOver)

describe('stock.ivRankLeaders — the answer', () => {
  it('both ends of the list, each symbol\'s rank, percentile and ATM IV, the cut from the middle and every left-out count', () => {
    const a = honest(answerFromIvRank(ivEnv(), {}))
    expect(lines(a)[0]).toBe('The highest IV rank across UCT\'s own options log (options rich against each symbol\'s own logged year), the Mon, Jun 2, 2031 session:')
    expect(lines(a)[1]).toMatch(/^• QZHA: IV rank 98 \(high\), IV percentile 97, ATM IV 82\.0% \(its range 35\.0% to 84\.0%\), over 180 sessions, open interest /)
    expect(a.text).toContain('The lowest IV rank across UCT\'s own options log (options cheap against each symbol\'s own logged year)')
    expect(a.text).toContain('Showing the 2 highest of 4,100; the list is cut from the middle of the ranking.')
    expect(a.text).toContain('Showing the 1 lowest of 4,100; the list is cut from the middle of the ranking.')
    expect(a.text).toMatch(/300 symbols have fewer than 20 logged sessions and are left out\./)
    expect(a.text).toContain('a missed day is a gap, never filled in')
    expect(a.text).toContain(IVRANK_RECORD)
    expect(a.facts).toMatchObject({ side: 'both', as_of: '2031-06-02', stale: false })
    expect(a.facts.high.map(r => r.symbol)).toEqual(['QZHA', 'QZHB'])
    const low = honest(answerFromIvRank(ivEnv({ high: [] }), { side: 'cheap' }))
    expect(low.text).not.toContain('The highest IV rank')
    expect(['rich', 'cheapest', 'HIGH', 'both', null].map(sideOf)).toEqual(['high', 'low', 'high', 'both', 'both'])
  })
  it('a stale list, not built, refused and an unclean answer are never "no rich options"', () => {
    expect(honest(answerFromIvRank(ivEnv({ stale_for: ['behind'] }), {})).text).toContain('Stale: the list read an earlier session')
    expect(answerFromIvRank(UNAVAILABLE, {}).text).toMatch(/the option screener is switched off on this server, or the read failed\. .* That is not the same as no rich or cheap options\.$/)
    expect(answerFromIvRank(REFUSED, {}).text).toContain(REFUSED_WORDS)
    expect(answerFromIvRank(ivEnv({ high: null }), {}).text).toMatch(/did not answer cleanly/)
    const src = adapter('iv_rank_leaders_read')
    expect([pyKind(src), pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([KINDS.ivrank, IVRANK_DEFAULT_ROWS, IVRANK_MAX_ROWS])
  })
})

// ── ipo.lockups → stock.ipoUnlock ──────────────────────────────────────────────────────────────────────────────────────
const lockRow = (symbol, company, listing, expiry, days, pct, reason) => ({ symbol, company, listing_date: listing, listing_source: 'first_bar', estimated_expiry: expiry, days_to_go: days,
  basis: 'estimated', change_since_listing: { pct, first_close: pct === null ? null : 10.0, first_date: pct === null ? null : listing, last_close: pct === null ? null : 12.34, last_date: pct === null ? null : '2031-06-02', reason } })
const lockupData = (over = {}) => ({
  today: '2031-06-03', window: { from: '2031-05-27', to: '2031-07-03', behind_days: 7, ahead_days: 30 }, lockup_days: 180, basis: 'estimated',
  basis_words: 'estimated: 180 days after listing; the prospectus sets the actual date', built_at: READ_AT, listings_as_of: '2031-06-02T23:58:00Z',
  counts: { listings: 140, with_listing_date: 138, without_listing_date: 2, in_window: 5, by_source: { first_bar: 5, relisting: 0, reference: 0, unknown: 0 } },
  rows: [lockRow('QZIB', null, '2030-11-29', '2031-05-30', -4, null, 'no_first_day'), lockRow('QZIA', 'Invented Robotics Inc', '2030-12-05', '2031-06-03', 0, 23.4, null),
    lockRow('QZIC', null, '2030-12-26', '2031-06-24', 21, -8.1, null)],
  stale_for: [], ...over,
})
const lockupEnv = (over = {}, envOver = {}) => envelope(KINDS.lockups, lockupData(over), envOver)

describe('stock.ipoUnlock — the answer', () => {
  it('every row an estimate, soonest first, the days to go counted from the list\'s own day, the change or why there is none, and the cut', () => {
    const a = honest(answerFromLockups(lockupEnv()))
    const l = lines(a)
    expect(l[0]).toMatch(/^5 estimated IPO lockup expiries fall from .* \(the past 7 days and the next 30\), as UCT holds them from the stocks listed in the last year:$/)
    expect(l[1]).toBe('The days to go are counted from Tue, Jun 3, 2031.')
    expect(l[2]).toMatch(/^• .* \(4 days ago\), estimated: QZIB, listed .*; /)
    expect(l[2]).toContain(CHANGE_REASON_WORDS.no_first_day)                         // never a change of 0
    expect(l[3]).toMatch(/\(today\), estimated: QZIA \(Invented Robotics Inc\), listed .*; \+23\.4% since its first close$/)
    expect(a.text).toContain('5 estimated expiries fall in the window and the 3 soonest are in this answer: the list is cut from the far end.')
    expect(a.text).toContain('2 listed stocks have no listing date')
    expect(a.text).toContain(LOCKUPS_RECORD)
    expect(a.facts.rows.every(r => r.basis === 'estimated')).toBe(true)
    expect(a.facts).toMatchObject({ as_of: '2031-06-02T23:58:00Z', today: '2031-06-03', total: 5, shown: 3, stale: false })
    expect(a.table.rows[0].expiry).toMatch(/\(est\.\)$/)
  })
  it('an empty window, a stale list, not held, refused and an unclean answer are never "no lockups"', () => {
    const none = honest(answerFromLockups(lockupEnv({ rows: [], counts: { ...lockupData().counts, in_window: 0 } })))
    expect(lines(none)[0]).toMatch(/^No estimated IPO lockup expiry falls from /)
    expect(honest(answerFromLockups(lockupEnv({ stale_for: ['earlier_day'] }))).text).toContain('Stale: UCT worked this list out on an earlier day')
    expect(answerFromLockups(UNAVAILABLE).text).toMatch(/That is not the same as no lockups\.$/)
    expect(answerFromLockups(REFUSED).text).toContain(REFUSED_WORDS)
    expect(answerFromLockups(lockupEnv({ rows: null })).text).toMatch(/did not answer cleanly/)
    const src = adapter('ipo_lockups_read')
    expect([pyKind(src), pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([KINDS.lockups, LOCKUPS_DEFAULT_ROWS, LOCKUPS_MAX_ROWS])
  })
})

// ── cot.byTrader → stock.positionTypes ─────────────────────────────────────────────────────────────────────────────────
const side = (long, short, spread) => ({ long, short, spread, traders_long: 40, traders_short: 30, traders_spread: spread === null ? null : 10 })
const CLASS_KEYS = ['dealer', 'asset_manager', 'leveraged_funds', 'other_reportable', 'nonreportable']
const cotWeek = (date, oi, lev, dealerLong = 100000) => ({ date, open_interest: oi, traders_total: 500, classes: { dealer: side(dealerLong, 400000, 20000), asset_manager: side(900000, 200000, 30000),
  leveraged_funds: lev, other_reportable: side(150000, 120000, 5000), nonreportable: { long: 80000, short: 90000, spread: null, traders_long: null, traders_short: null, traders_spread: null } } })
const CREDIT = 'Source: CFTC Commitments of Traders (Traders in Financial Futures / Disaggregated), as of the Tuesday it covers, published the following Friday.'
const cotData = (over = {}) => ({
  market: 'ES', name: 'E-mini S&P 500', report: 'tff', report_name: 'Traders in Financial Futures', watch: 'leveraged_funds',
  classes: CLASS_KEYS.map(key => ({ key, cftc: 'invented', spread: key !== 'nonreportable', traders: key !== 'nonreportable' })),
  rows: [cotWeek('2031-05-27', 1990000, side(310000, 480000, 9000)), cotWeek('2031-06-03', 2000000, side(300000, 500000, 10000), null)],
  records: [{ cftc_code: '000000', market_name: 'INVENTED INDEX - INVENTED EXCHANGE', match: 'code', first: '2031-05-27', last: '2031-06-03' }],
  concentration: { date: '2031-06-03', gross_4_long: 21.7, gross_4_short: 18.0, gross_8_long: 30.1, gross_8_short: 27.2, net_4_long: 15.0, net_4_short: 12.0, net_8_long: 22.0, net_8_short: 19.0 },
  credit: CREDIT, stale_for: [], left_out: ['range'], ...over,
})
const boardData = (over = {}) => ({
  market: null, watch: { tff: 'leveraged_funds', disaggregated: 'managed_money' },
  markets: { ES: { report: 'tff', watch: 'leveraged_funds', name: 'E-mini S&P 500', date: '2031-06-03', open_interest: 2000000, long: 300000, short: 500000, spread: 10000,
    previous: { date: '2031-05-27', open_interest: 1990000, long: 310000, short: 480000, spread: 9000 } },
  GC: { report: 'disaggregated', watch: 'managed_money', name: 'Gold', date: '2031-06-03', open_interest: 500000, long: 200000, short: 50000, spread: 20000, previous: null } },
  no_record: ['ZZ'], newest: '2031-06-03', credit: CREDIT, stale_for: [], left_out: ['range'], ...over,
})
const cotEnv = (data, envOver = {}) => envelope(KINDS.cot, data, { as_of: '2031-06-03T04:00:00Z', ...envOver })

describe('stock.positionTypes — the answer', () => {
  it('one market: every class\'s net, its week\'s change and share of open interest, the watched class, concentration and the CFTC\'s credit', () => {
    const a = honest(answerFromCot(cotEnv(cotData()), { market: 'es' }))
    const l = lines(a)
    expect(l[0]).toMatch(/^E-mini S&P 500 \(ES\) positioning by trader type, from the CFTC's Traders in Financial Futures report as UCT stores it \(futures only\), the week of .*2031:$/)
    expect(a.text).toMatch(/• Leveraged funds \(the class traders watch most in this report\): net -200(?:\.0)?K \(300(?:\.0)?K long, 500(?:\.0)?K short\), -30(?:\.0)?K on the week, -10\.0% of open interest/)
    expect(a.text).toMatch(/• Dealers: net n\/a \(n\/a long, 400(?:\.0)?K short\), no week's change stated, no share of open interest stated/)    // the CFTC printed none: never 0
    expect(a.text).toContain('The largest 4 traders hold 21.7% of the long side and 18.0% of the short side')
    expect(a.text).toContain(CREDIT)
    expect(a.text).toContain(COT_LEFT_OUT)
    expect(a.text).toContain(COT_RECORD)
    expect(a.facts).toMatchObject({ market: 'ES', report: 'tff', watch: 'leveraged_funds', as_of: '2031-06-03', stale: false })
    expect(a.facts.classes.find(c => c.key === 'dealer')).toEqual({ key: 'dealer', net: null, wow: null, pct_oi: null })
  })
  it('the board: the watched class most net long and most net short as a share of open interest, the markets with no record', () => {
    const a = honest(answerFromCot(cotEnv(boardData()), {}))
    expect(lines(a)[0]).toMatch(/^The watched class in each futures market UCT stores .* the week of .*2031:$/)
    expect(a.text).toMatch(/Most net long, as a share of open interest:\n• Gold \(GC\): Managed money net \+150(?:\.0)?K, \+30\.0% of open interest, no week's change stated/)
    expect(a.text).toMatch(/Most net short, as a share of open interest:\n• E-mini S&P 500 \(ES\): Leveraged funds net -200(?:\.0)?K, -10\.0% of open interest, -30(?:\.0)?K on the week/)
    expect(a.text).toContain('1 listed market has no record in the finer reports UCT holds.')
    expect(a.facts.markets.map(m => m.code)).toEqual(['ES', 'GC'])
  })
  it('a stale report, not stored, refused and an unclean answer are never "no positions"', () => {
    expect(honest(answerFromCot(cotEnv(cotData({ stale_for: ['behind_schedule'] })), {})).text).toContain('Stale: the newest stored report is older than the one the CFTC should have published')
    expect(answerFromCot(UNAVAILABLE, { market: 'gold' }).text).toMatch(/^I couldn't read gold's positioning by trader type: .* That is not the same as no positions\.$/)
    expect(answerFromCot(REFUSED, {}).text).toContain(REFUSED_WORDS)
    expect(answerFromCot(cotEnv(cotData({ rows: [] })), {}).text).toMatch(/did not answer cleanly/)
    expect(pyKind(adapter('cot_finer_read'))).toBe(KINDS.cot)
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
  _resetHistoryForTest(); _resetDescribeForTest() }

describe('served vs dark', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the seven kinds and the seven capabilities, by name', () => {
    expect(KINDS).toEqual({ rank: 'groups.rank', crowding: 'groups.crowding', season: 'earnings.seasonBySector', revisions: 'estimates.revisionBreadth', ivrank: 'options.ivRankLeaders', lockups: 'ipo.lockups', cot: 'cot.byTrader' })
    expect(CAPABILITIES).toEqual({ rank: 'stock.groupRank', crowding: 'stock.groupOwnership', season: 'stock.sectorEarnings', revisions: 'stock.estimatesBreadth', ivrank: 'stock.ivRankLeaders', lockups: 'stock.ipoUnlock', cot: 'stock.positionTypes' })
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'quotes', 'themes', 'earnings', 'cot.positioning', 'calendar.ipos', 'options.ivHistory', 'short.list', 'stock.stats'], 'other kinds only']])('dark (%j, %s): none of the seven is registered', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    expect(registerTerminalWave11Capabilities()).toEqual([])
    registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames(), n).not.toContain(n)
  })

  it.each(PAIRS)('served %s alone: only %s is registered, once, and it unregisters cleanly', async (kind, capability) => {
    wire([kind])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([capability])
    expect(registerTerminalWave11Capabilities()).toEqual([])            // idempotent
    reset()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([])
  })

  it('all seven served: local-only on BOTH sides, never a plain data read, no enum, inside the manifest text limits', async () => {
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
      for (const p of Object.values(cap.args.properties)) expect(p.enum, name).toBeUndefined()   // an enum's values would join the typo lexicon
      expect(handshake.isolated_kinds, kind).toContain(kind)          // all seven kinds of this wave are model-isolated
      expect(handshake.local_only_actions, name).toContain(name)      // turn.LOCAL_ONLY_ACTIONS, via the generated handshake
      expect(dataReads.includes(`"${name}"`), name).toBe(false)       // the two server sets are disjoint
    }
  })

  it('each answer makes ONE read of its own kind, with the member\'s arguments normalised (rows clamped to the kind\'s own limits)', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KINDS.rank] = () => rankEnv()
    ENVS[KINDS.crowding] = () => crowdingEnv()
    ENVS[KINDS.season] = () => seasonEnv()
    ENVS[KINDS.revisions] = () => revisionsEnv()
    ENVS[KINDS.ivrank] = () => ivEnv()
    ENVS[KINDS.lockups] = () => lockupEnv()
    ENVS[KINDS.cot] = (p) => cotEnv(p.market ? cotData() : boardData())
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    expect((await run(CAPABILITIES.rank, { kind: null, name: null, rows: null })).text).toMatch(/^Sectors by weekly rank/)
    expect((await run(CAPABILITIES.rank, { kind: 'Industries', name: ' invented   tech ', rows: 999 })).text).toBeTruthy()
    expect((await run(CAPABILITIES.crowding, { kind: 'sectors', name: null, rows: 0 })).text).toMatch(/^Sectors by positioning/)
    expect((await run(CAPABILITIES.season, { season: 'last year', metric: 'revenue' })).text).toMatch(/^Only the stocks UCT holds earnings results for/)
    expect((await run(CAPABILITIES.revisions, { metric: 'sales', window: 7 })).text).toMatch(/^Among the 520 stocks/)
    expect((await run(CAPABILITIES.ivrank, { side: 'cheapest', rows: 500 })).text).toBeTruthy()
    expect((await run(CAPABILITIES.lockups, { rows: null })).text).toMatch(/estimated IPO lockup expiries/)
    expect((await run(CAPABILITIES.cot, { market: ' gold ', rows: null })).text).toBeTruthy()
    expect((await run(CAPABILITIES.cot, { market: null, rows: 3 })).text).toMatch(/^The watched class/)
    expect(reads().map(r => [r.kind, r.params, r.purpose])).toEqual([
      [KINDS.rank, { kind: 'sector', name: null, rows: 10 }, 'answer'],
      [KINDS.rank, { kind: 'industry', name: 'invented tech', rows: 50 }, 'answer'],
      [KINDS.crowding, { kind: 'sector', name: null, rows: 1 }, 'answer'],
      [KINDS.season, { season: 'year_ago' }, 'answer'],
      [KINDS.revisions, { metric: 'revenue', window: 7 }, 'answer'],
      [KINDS.ivrank, { side: 'low', rows: 100 }, 'answer'],
      [KINDS.lockups, { rows: 10 }, 'answer'],
      [KINDS.cot, { market: 'gold' }, 'answer'],
      [KINDS.cot, { market: null }, 'answer'],
    ])
  })

  it('no read without a turn, and a refusal is answered in fixed words', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    for (const name of ALL) expect((await getCapability(name).answer(null, {}, null)).text, name).toMatch(/needs the Agent's turn/)
    expect(reads()).toEqual([])
    for (const name of ALL) {                                           // the stub refuses every kind
      const a = await inTurn(() => getCapability(name).answer(null, {}, null))
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
const wordKeys = namedBy(WAVE11_ROUTE_WORDS)
/** plain member asks, by the capability whose words must name them (and no earlier wave's words) */
const ASKS = {
  rank: ['show me the sectors by weekly rank', 'industry group rank', 'top ranked industries', 'sector rank this week', 'which sectors climbed the most in the weekly rank',
    'weekly rank of every industry', 'industry rankings', 'group rank history'],
  crowding: ['sector crowding', 'most crowded industries', 'insider buying by sector', 'crowding by industry', 'positioning by industry', 'insider purchases across sectors'],
  season: ['earnings by sector', 'which sector is beating', 'sector beat rates', 'beat rates by sector', 'sector earnings surprises', 'beats and misses by sector'],
  revisions: ['estimate revisions by sector', 'revision breadth', 'earnings revisions by sector', 'estimate breadth', 'sector revisions', 'eps revisions across sectors'],
  ivrank: ['richest options', 'cheapest options', 'most expensive options in the market', 'which options are the cheapest'],
  lockups: ['IPO lockups', 'upcoming lockup expirations', 'IPO unlocks this month', 'lockups ending soon', 'lock-up expiry dates', 'insider unlocks', 'IPO LOCKUP'],
  cot: ['futures by trader type', 'what are leveraged funds doing', 'swap dealers and asset managers in futures', 'the traders in financial futures report',
    'asset managers net long', 'disaggregated report for corn'],
}
/** asks a neighbour's words ALSO name: both groups ride along, and the model is offered both capabilities */
const SHARED = [['earnings season by sector', 'season', WAVE4_GROUP], ['short interest by sector', 'crowding', WAVE5_GROUP], ['most shorted sectors', 'crowding', WAVE5_GROUP],
  ['highest IV rank', 'ivrank', WAVE7_GROUP], ['lowest IV rank', 'ivrank', WAVE7_GROUP], ['IV rank leaders', 'ivrank', WAVE7_GROUP], ['COT by trader type', 'cot', 'cot'],
  ['managed money in gold', 'cot', 'cot'], ['leading industries', 'rank', 'rs']]
/** another capability's language: none of the seven's words may name these */
const NOT_OURS = [
  'NVDA RS rank', 'relative strength ranking of sectors', 'sector ranking', 'show me the sector rankings',              // SCTR's words: sector funds by performance
  'NVDA composite rating', 'sector performance this week', 'best performing sectors today', 'which themes are rotating in',
  'sector rotation', 'what sector is NVDA in', 'stocks in the software industry', 'sector breadth', 'industry breadth', 'sector fundamentals', 'sector valuation', 'market breadth',
  'short interest on NVDA', 'most shorted stocks', 'NVDA days to cover', 'insider buying in NVDA', 'insider cluster buys', 'which funds hold NVDA', 'hedge funds holding NVDA',
  'NVDA earnings', 'did NVDA beat', 'who reports tonight', 'earnings season today', 'earnings this week', 'earnings reactions for yesterday', 'NVDA beat rate', 'beat rate',
  'NVDA estimate revisions', 'estimate history for AAPL', 'what got upgraded today', 'analyst ratings for NVDA', 'revisions',
  'NVDA IV rank', 'IV rank for NVDA', 'NVDA implied volatility', 'NVDA IV history', 'stocks with high IV', 'scan for high IV rank', 'options flow on NVDA', 'options contracts for NVDA',
  'IPO calendar', 'upcoming IPOs', 'recent IPOs', 'IPOs this week', 'lock the layout', 'unlock the chart', 'lock the drawing',
  'COT for gold', 'commercials in crude', 'large speculators in the S&P', 'commitments of traders for gold', 'cftc data', 'futures positioning', 'what are the dealers saying',
  'what is IV rank', 'explain revision breadth', 'what are lockups', 'define leveraged funds', 'what is short interest', 'what is crowding',
  'GRPS RANK', 'open GRPS for sectors', 'ERNSC', 'EEHSC', 'OSCR RICH', 'OSCR CHEAP', 'go to the IPO LOCKUP panel', 'COT GOLD', 'open the COT panel for gold',
  'rank', 'sectors', 'industries', 'crowding', 'beat', 'breadth', 'iv', 'options', 'unlock', 'cot', 'funds', 'dealers',
  'add NVDA to my watchlist', 'alert me when a lockup expires', 'scan for stocks near lockup expiry', 'show me my positions',
]
/** asks the earlier waves' words name (their own tests hold the full lists): this wave's words must not */
const EARLIER_ASKS = ['what got upgraded today', 'new highs today', 'top gainers over 60 days', 'dark pool levels on NVDA', 'recent IPOs', 'which themes are rotating in',
  'what is on the confluence board', 'expected move for NVDA earnings', 'gamma levels for NVDA', 'show me the top flow picks', 'earnings reactions for yesterday', 'earnings season today',
  'call themes this month', 'short interest on NVDA', 'NVDA days to cover', 'NVDA seasonality', 'market tide history', 'open interest change on NVDA', 'treasury yields', 'the 10-year yield',
  'what is the market regime', 'confirmed setups on NVDA', 'NVDA events timeline', 'the UCT 20', 'NVDA IV history', 'NVDA dilution', 'NVDA corporate actions', 'IPO calendar',
  'upcoming IPOs', 'next ex-dividend date for KO', 'split history for AAPL', 'treasury auctions', 'real yields', 'fed watch', 'what changed in the FOMC statement',
  'NVDA stock stats', 'pocket pivots on NVDA', 'NVDA factor exposure', 'NVDA setup history', 'clinical trials for LLY', 'which funds hold NVDA']
const EARLIER_WORDS = [TERMINAL_ROUTE_WORDS, WAVE2_ROUTE_WORDS, WAVE3_ROUTE_WORDS, WAVE4_ROUTE_WORDS, WAVE5_ROUTE_WORDS, WAVE6_ROUTE_WORDS, WAVE7_ROUTE_WORDS, WAVE8_ROUTE_WORDS,
  WAVE9_ROUTE_WORDS, WAVE10_ROUTE_WORDS, { cot: COT_ROUTE_WORDS }].map(namedBy)
/** the Terminal's own keywords for the functions this wave backs that ITS words name, by code (functions.js); every other
 *  keyword of those codes stays with its owner, said: 'beat rate' could be one stock's, and COT's are the legacy report's */
const TERMINAL_KEYWORDS = {
  GRPS: { rank: ['industry rank', 'group rank', 'industry group rank', 'industry ranking', 'group rank history', 'leading industries'], crowding: ['sector short interest', 'industry short interest', 'sector crowding', 'industry crowding'] },
  ERNSC: { season: ['earnings by sector', 'sector earnings', 'earnings season by sector', 'season by sector', 'which sector is beating'] },
  EEHSC: { revisions: ['revision breadth', 'estimate revisions by sector', 'revisions by sector', 'sector revisions', 'earnings revisions by sector', 'estimate breadth'] },
  IPO: { lockups: ['lockup', 'lockups', 'ipo lockup', 'ipo lockups'] },
  COT: {},
  OSCR: {},
}
const NOT_NAMED = { GRPS: ['sector fundamentals', 'industry fundamentals', 'sector breadth', 'industry breadth', 'sector valuation', 'sector margins', 'group fundamentals', 'sector table',
  'industry table'], ERNSC: ['beat rate', 'beat rates', 'earnings beat rate'] }

describe('routing words', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the group is words-only and never a filler, routing.js lists the seven by action with no word of its own, and it is the 53rd of the 56 the server keeps', () => {
    const g = ownGroup()
    expect(g.wordsOnly && g.fillLast).toBe(true)
    expect(g.words).toEqual([])                                      // server-armed: empty until a capability registers
    expect([...g.actions].sort()).toEqual([...ALL].sort())
    expect(g.domains).toEqual([])
    expect(g.id).toMatch(/^[a-z][a-zA-Z]{1,23}$/)
    expect(g.title.length).toBeLessThanOrEqual(160)                  // the server cuts a group title at 160 characters (turn.py validate_routing)
    // the server keeps only MAX_GROUPS groups (56 since the integrator's wave 7 build); this wave's is the 53rd, and the cap is
    // not changed here. A later wave's group comes after it.
    const max = Number(/^MAX_GROUPS\s*=\s*(\d+)\s*$/m.exec(py('api/services/uct_agent/turn.py'))[1])
    expect([GROUPS.map(x => x.id).indexOf(ROUTE_GROUP) + 1, max, GROUPS.length <= max]).toEqual([53, 56, true])
    expect(GROUPS.map(x => x.id).slice(45, 53)).toEqual([WAVE4_GROUP, WAVE5_GROUP, WAVE6_GROUP, WAVE7_GROUP, WAVE8_GROUP, WAVE9_GROUP, WAVE10_GROUP, ROUTE_GROUP])
    expect(new Set(GROUPS.map(x => x.id)).size).toBe(GROUPS.length)
    for (const other of GROUPS.filter(x => x.id !== ROUTE_GROUP)) for (const n of ALL) expect(other.actions || [], `${other.id}: ${n}`).not.toContain(n)
    expect([WAVE7_GROUP, WAVE9_GROUP, WAVE10_GROUP].map(id => GROUPS.find(x => x.id === id).actions.length)).toEqual([6, 3, 6])
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'quotes', 'themes', 'earnings', 'cot.positioning', 'calendar.ipos', 'options.ivHistory'], 'other kinds only']])('dark (%j, %s): the group has no words, and the data group keeps exactly routing.js\'s', async (kinds) => {
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
    expect(ownGroup().words).toEqual(WAVE11_ROUTE_WORDS[key])
    expect(groupWords('data')).toEqual(DATA_BASE)
    expect([WAVE4_GROUP, WAVE5_GROUP, WAVE6_GROUP, WAVE7_GROUP, WAVE8_GROUP, WAVE9_GROUP, WAVE10_GROUP, 'cot'].map(groupWords)).toEqual([[], [], [], [], [], [], [], []])
    for (const [other, asks] of Object.entries(ASKS)) if (other !== key) for (const q of asks) expect(wordsSelect(ROUTE_GROUP, q), `${key} alone: ${q}`).toBe(false)
    registerTerminalWave11Capabilities()                               // idempotent: never armed twice
    expect(ownGroup().words).toHaveLength(WAVE11_ROUTE_WORDS[key].length)
    reset()
    expect(ownGroup().words).toEqual([])
  })

  it('every capability has words, and each ask is named by its own capability\'s words and by no other of this wave', () => {
    expect(Object.keys(WAVE11_ROUTE_WORDS).sort()).toEqual([...KEYS].sort())
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
    wire([...PAIRS.map(p => p[0]), 'options.ivHistory', 'short.interest', 'short.list', 'earnings.season', 'cot.positioning', 'calendar.ipos', 'rs.leadership', 'quotes', 'quote', 'earnings',
      'bars.daily', 'news.company', 'instrument.resolve', 'sectors.performance'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    expect(allCapabilityNames()).toEqual(expect.arrayContaining(['stock.ivHistory', 'stock.shortList', 'stock.earningsSeason', 'stock.ipoCalendar']))   // non-vacuity
    for (const [q, key, group] of SHARED) {
      const sel = selectGroups(q).selected
      expect(sel, q).toContain(ROUTE_GROUP)
      expect(sel, q).toContain(group)
      expect(routeManifest(full, q, ROUTE_OPTS()).manifest.map(c => c.name), q).toContain(CAPABILITIES[key])
    }
    for (const [q, group] of [['NVDA IV history', WAVE7_GROUP], ['short interest on NVDA', WAVE5_GROUP], ['earnings season today', WAVE4_GROUP], ['upcoming IPOs', WAVE8_GROUP], ['COT for gold', 'cot']]) {
      expect(selectGroups(q).selected, q).toContain(group)
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
    for (const q of ['rank', 'sectors', 'beat', 'breadth', 'options', 'unlock', 'funds']) expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
  })

  it('served: the fill for a message nothing recognised never carries the words-only group', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const q of ['flip to AMD', 'lose the gridlines', 'any articles on RIVN lately', 'both', 'hmm', 'rank', 'sectors', 'options']) {
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

  it('the typo lexicon: registering the seven adds no word and changes no correction of any OTHER capability\'s capreg corpus phrasing', async () => {
    // A name's, a summary's and a hint's lowercase words join the typo lexicon (nl/lexicon.js). This wave's own phrasings are left out.
    wire([])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const texts = [...new Set(allPhrasings().filter(p => !ALL.includes(p.intent.id)).map(p => p.ph.text)), 'show me the leeders', 'chnage the theme', 'the bord', 'rnak', 'sectr', 'grup',
      'ownershp', 'earnigs', 'estimtes', 'breath', 'leders', 'unlok', 'lockup', 'positon', 'tyeps', 'secotr', 'industy', 'crowdng', 'revison', 'cheep', 'rich', 'traders']
    const fix = (t, lex) => JSON.stringify((correctTypos(t, lex) || []).map(v => v.text))
    const read = () => { const lex = lexiconFor(null); return texts.map(t => fix(t, lex)) }
    const before = read()
    const known = new Set(lexiconFor(null).words)
    _resetAgentConfig(); wire(PAIRS.map(p => p[0])); await loadAgentConfig(); registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames()).toContain(n)
    const after = read()
    expect(texts.length).toBeGreaterThan(500)
    expect(texts.map((t, i) => (before[i] !== after[i] ? `${t}: ${before[i]} -> ${after[i]}` : null)).filter(Boolean)).toEqual([])
    // the seven add NO word to the lexicon: every word of a name is already known, and every other word of a summary and a
    // hint is either already known or written in CAPITALS, which the lexicon skips
    expect([...lexiconFor(null).words].filter(w => !known.has(w)).sort()).toEqual([])
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
    expect(mine).toHaveLength(28)
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
