// Terminal data wave 5 — the two local-only capabilities over `short.interest` and `short.list` (FINRA short interest):
// the member's answer (the report's SETTLEMENT DATE with the time UCT read it, never today, never live / now; FINRA's own
// cautions said where they apply; an answer that is not held, a data plan that refuses it and a read that failed never said as
// "no short interest"; a number that does not exist never as 0: no days to cover, no change, no float, no percent of float, no
// short volume ratio; an envelope's notes never echoed), served vs dark (each registers only while the server lists ITS
// kind), local-only on both sides, the manifest text limits, the one read each answer makes with the member's arguments (a
// rank read by the SHRTS panel's own word map), and the cross-file facts read from the other file (never retyped).
// Routing: the two have their OWN words-only group (`shortInterest`, the 47th of the 48 the server keeps). Each capability's
// own words are on that group only while it is registered (a dark server's routing is routing.js's own), every plain ask
// reaches its capability under v1 and v2, the group never rides the fill, and the words stay off other capabilities'
// language: a bare "short" (the bearish side: the confluence board's SHORT, a short setup, net short futures), "short float"
// and screens with a condition (the Screener), a short squeeze, open interest, alerts, watchlists, and what a term means.
// No model, no provider: /api/agent/config and /api/agent/data are stubbed with synthetic shapes (never market data).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
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
import { shortDataRead, REPORTS_SHOWN, REPORTS_MORE, VOLUME_DAYS_SHOWN } from '../pages/terminal/panels/shortInterestModel'
import { SHORT_RANKS, SHORT_RANK_ARG_WORDS, DEFAULT_SHORT_RANK, shortListRead } from '../pages/terminal/panels/shortListModel'
import { LIVE_WORDS } from './capabilities/terminalDataFormat'
import { _resetTerminalDataForTest } from './capabilities/terminalData'
import { _resetTerminalLocalForTest, TERMINAL_ROUTE_WORDS } from './capabilities/terminalDataLocal'
import { _resetTerminalWave2ForTest, WAVE2_ROUTE_WORDS, CAPABILITIES as WAVE2_CAPABILITIES } from './capabilities/terminalDataWave2'
import { _resetTerminalWave3ForTest, WAVE3_ROUTE_WORDS } from './capabilities/terminalDataWave3'
import { _resetTerminalWave4ForTest, WAVE4_ROUTE_WORDS, ROUTE_GROUP as WAVE4_GROUP } from './capabilities/terminalDataWave4'
import {
  KINDS, CAPABILITIES, REPORT_LAG, VOLUME_CAUTION, FLOAT_CAUTION, DTC_MEANING,
  INTEREST_DEFAULT_REPORTS, INTEREST_MAX_REPORTS, INTEREST_DEFAULT_DAYS, INTEREST_MAX_DAYS, LIST_RANK_KEYS, LIST_MAX_ROWS,
  answerFromInterest, answerFromList, rankOf,
  registerTerminalWave5Capabilities, _resetTerminalWave5ForTest, WAVE5_ROUTE_WORDS, ROUTE_GROUP,
} from './capabilities/terminalDataWave5'

registerBuiltins()

const REPO = path.resolve(__dirname, '..', '..', '..')
const py = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const adapter = (name) => py(`api/services/uct_agent/marketdata/${name}.py`)
const pyInt = (src, name) => Number(new RegExp(`^${name} = (\\d+)\\b`, 'm').exec(src)[1])
const pyTuple = (src, name) => new RegExp(`^${name} = \\(([^)]+)\\)`, 'm').exec(src)[1].match(/"[^"]+"/g).map(s => s.slice(1, -1))
const FETCHED = '2026-11-17T15:30:00Z'               // 10:30 AM ET, a Tuesday
const READ_AT = '2026-11-17T14:05:00Z'               // 9:05 AM ET, the same day
const NOTE = 'a provider note that must never be echoed 987654'
const envelope = (kind, data, over = {}) => ({
  contract: 'MD-1.0', kind, params_echo: {}, status: 'ok', freshness: 'historical', as_of: '2026-10-30T04:00:00Z', fetched_at: FETCHED, delay_s: null,
  stale: false, source: 'fixture', coverage: null, notes: [NOTE], provider_calls: 0, isolated: true, data: { ...data, isolated: true }, ...over,
})
const REFUSED = { status: 'refused', data: null, notes: ['this turn already made 8 data reads'] }
const UNAVAILABLE = { status: 'unavailable', data: null, notes: [NOTE] }
const SOURCE_LINE = "Source: FINRA short interest, read through UCT's market-data vendor. Descriptive only: nothing here is a prediction."
const LAG_LINE = `${REPORT_LAG} By FINRA's schedule this one was published on Nov 10, 2026 (an estimate: the publication day is not in the data).`
const READ_LINE = "Read by UCT from the data vendor at 9:05 AM ET (UCT's own time)."
/** every answer of this wave: no live / now wording, never an envelope note, and never the day of the read as the data's date */
function honest(a) {
  expect(a.text).not.toMatch(LIVE_WORDS)
  expect(a.text).not.toContain('987654')
  expect(a.text).not.toContain('8 data reads')
  expect(a.text).not.toMatch(/\bas of today\b|\btoday's short interest\b|settlement date (?:Tue, )?Nov 17/i)
  return a
}

// ── short.interest → stock.shortInterest ───────────────────────────────────────────────────────────────────────────────
const report = (day, short, change, changePct, o = {}) => ({ settlement_date: day, short_interest: short, avg_daily_volume: 1000000, days_to_cover: 6, change_shares: change, change_pct: changePct, isolated: true, ...o })
const REPORTS = () => [report('2026-10-30', 3000000, 1000000, 50), report('2026-10-15', 2000000, 1000000, 100, { days_to_cover: 4 }),
  report('2026-09-30', 1000000, null, null, { days_to_cover: null, avg_daily_volume: null })]
const vday = (date, short, total, ratio) => ({ date, short_volume: short, total_volume: total, short_volume_ratio: ratio, isolated: true })
const DAYS = () => [vday('2026-11-13', 400000, null, null), vday('2026-11-12', 300000, 1000000, 30), vday('2026-11-11', 500000, 1000000, 50)]
const interestEnv = (over = {}, envOver = {}) => envelope(KINDS.interest, {
  sym: 'NVDA', settlement_date: '2026-10-30', latest: REPORTS()[0], publication_estimate: '2026-11-10', read_at: READ_AT, held: 'fresh',
  interest: { state: 'ok', reason: null, http_status: 200, reports: REPORTS(), count: 3, shown: 3, cut: false, first_date: '2026-09-30', isolated: true },
  volume: { state: 'ok', reason: null, http_status: 200, days: DAYS(), count: 12, shown: 3, window_days: 60, isolated: true },
  float: { shares: 10000000, pct_float: 30, withheld: false, state: 'ok', source: 'fixture', isolated: true }, source: 'fixture', ...over,
}, envOver)

describe('stock.shortInterest — the answer', () => {
  it('the newest report by its settlement date, its change, percent of float, the reports and the short volume, with FINRA\'s cautions', () => {
    const a = honest(answerFromInterest(interestEnv(), 'NVDA'))
    expect(a.text.split('\n')).toEqual([
      "NVDA short interest, FINRA's report for settlement date Fri, Oct 30, 2026: 3,000,000 shares short, 6.00 days to cover (average daily volume 1,000,000 shares).",
      'Change from the report before (Oct 15, 2026): +1,000,000 shares (+50.00%).',
      'Percent of float: 30.00%, against a float of 10,000,000 shares.',
      'All 3 reports the server holds, newest first:',
      '• Oct 30, 2026: 3,000,000 shares, +50.00% from the report before, 6.00 days to cover',
      '• Oct 15, 2026: 2,000,000 shares, +100.00% from the report before, 4.00 days to cover',
      '• Sep 30, 2026: 1,000,000 shares, nothing earlier to compare with',
      DTC_MEANING,
      'Daily short volume, the newest 3 days of the 12 the server holds: on average 40.0% of the reported volume was sold short (low 30.0%, high 50.0%, over 2 days with a ratio); the newest day is Fri, Nov 13, 2026, 400,000 shares sold short, its share of volume not given.',
      VOLUME_CAUTION,
      LAG_LINE,
      FLOAT_CAUTION,
      READ_LINE,
      SOURCE_LINE,
    ])
    // the date the answer states is the settlement date; the read time stands beside it and is never the data's date
    expect(a.facts).toMatchObject({ symbol: 'NVDA', settlement_date: '2026-10-30', settlement_day: 'Fri, Oct 30, 2026', publication_estimate: '2026-11-10', read: '9:05 AM ET', held: 'fresh', stale: false,
      interest_state: 'ok', volume_state: 'ok', reports_held: 3, reports_shown: 3, days_held: 12, days_shown: 3, history_cut: false })
    expect(a.facts.latest).toEqual({ settlement_date: '2026-10-30', shares_short: 3000000, shares_text: '3,000,000 shares', average_daily_volume: 1000000, days_to_cover: 6, days_to_cover_text: '6.00',
      change_shares: 1000000, change_shares_text: '+1,000,000 shares', change_pct: 50, change_pct_text: '+50.00%' })
    // null, never 0: the oldest report has no change, no days to cover and no average volume; the newest day has no total and no ratio
    expect(a.facts.reports[2]).toMatchObject({ change_shares: null, change_shares_text: null, change_pct: null, change_pct_text: null, days_to_cover: null, days_to_cover_text: null, average_daily_volume: null })
    expect(a.facts.volume_days[0]).toEqual({ date: '2026-11-13', short_volume: 400000, total_volume: null, ratio_pct: null, ratio_text: null })
    expect(a.facts.volume_ratio).toEqual({ n: 2, avg: 40, low: 30, high: 50 })
    expect(a.facts.float).toEqual({ shares: 10000000, pct: 30, pct_text: '30.00%', withheld: false, state: 'ok' })
    expect(a.table.rows[0]).toEqual({ date: 'Oct 30, 2026', shares: '3,000,000', change: '+1,000,000 shares', change_pct: '+50.00%', dtc: '6.00', adv: '1,000,000' })
    expect(a.table.rows[2]).toEqual({ date: 'Sep 30, 2026', shares: '1,000,000', change: 'not given', change_pct: 'not given', dtc: 'not given', adv: 'not given' })
    expect(a.present.items.map(i => `${i.label} ${i.value}`)).toEqual(['Shares short 3,000,000', 'Days to cover 6.00', 'Percent of float 30.00%', 'Change +50.00%'])
    expect(a.text).not.toMatch(/\b0\.00%|\b0 shares/)                    // no missing number became a zero
    expect(shortDataRead({ ...interestEnv().data, status: 'ok' }).state).toBe('ok')      // the kind's data IS the shape the SHINT panel reads
  })
  it('a cut, a float that is missing or withheld, a report with nothing before it and a stale answer are each said', () => {
    const cut = honest(answerFromInterest(interestEnv({ interest: { ...interestEnv().data.interest, reports: REPORTS().slice(0, 2), count: 40, shown: 2, cut: true, first_date: '2017-12-29' } }), 'NVDA'))
    expect(cut.text).toContain('The newest 2 of the 40 reports the server holds (the older ones are left out), newest first:')
    expect(cut.text).toContain('The server read only the newest reports: the history here stops at Dec 29, 2017, and older reports exist.')
    const noFloat = honest(answerFromInterest(interestEnv({ float: { shares: null, pct_float: null, withheld: false, state: 'missing', source: 'x' } }), 'NVDA'))
    expect(noFloat.text).toContain('Percent of float is not stated: no float is on file for this stock. That is not 0%.')
    expect(noFloat.text).not.toContain(FLOAT_CAUTION)
    expect(noFloat.facts.float).toMatchObject({ shares: null, pct: null, pct_text: null })
    const withheld = honest(answerFromInterest(interestEnv({ float: { shares: 1000000, pct_float: null, withheld: true, state: 'ok', source: 'x' } }), 'NVDA'))
    expect(withheld.text).toContain('Percent of float is withheld: short interest is more than one and a half times the float on file, so the two figures do not describe the same share count (a split or an offering since the settlement date).')
    expect(withheld.facts.float).toMatchObject({ pct: null, pct_text: null, withheld: true })
    expect(withheld.present.items.map(i => i.label)).not.toContain('Percent of float')
    const oldFloat = honest(answerFromInterest(interestEnv({ float: { shares: 10000000, pct_float: 30, withheld: false, state: 'stale', source: 'x' } }), 'NVDA'))
    expect(oldFloat.text).toContain('Percent of float: 30.00%, against a float of 10,000,000 shares (the float on file is older than usual).')
    const first = honest(answerFromInterest(interestEnv({ interest: { ...interestEnv().data.interest, reports: REPORTS().slice(2), count: 1, shown: 1 }, latest: REPORTS()[2], settlement_date: '2026-09-30' }), 'NVDA'))
    expect(first.text.split('\n').slice(0, 2)).toEqual([
      "NVDA short interest, FINRA's report for settlement date Wed, Sep 30, 2026: 1,000,000 shares short, days to cover not given.",
      'There is no earlier report here to compare with, so no change is stated.'])
    expect(first.text).not.toMatch(/reports the server holds/)
    const stale = honest(answerFromInterest(interestEnv({ held: 'last_good', read_at: null }, { stale: true }), 'NVDA'))
    expect(stale.text).toContain('The answer carries no read time, so I cannot say how old it is.')
    expect(stale.text).toContain('Stale: this is the last good answer for that stock, so a report or a day of short volume published since is missing.')
  })
  it('one dataset refused or failed is said and never as none; a stock the vendor has nothing for is a normal answer', () => {
    const noVolume = honest(answerFromInterest(interestEnv({ volume: { state: 'unavailable', reason: 'refused', http_status: 403, days: [], count: 0, shown: 0, window_days: null } }, { status: 'partial' }), 'NVDA'))
    expect(noVolume.text).toContain("Daily short volume is not stated: the data vendor refused it for this site's data plan when the server last asked. That is not the same as none.")
    expect(noVolume.text).not.toContain(VOLUME_CAUTION)
    expect(noVolume.text).toMatch(/^NVDA short interest, FINRA's report for settlement date Fri, Oct 30, 2026/)
    const noKey = honest(answerFromInterest(interestEnv({ volume: { state: 'unavailable', reason: 'not_configured', http_status: null, days: [], count: 0, shown: 0 } }, { status: 'partial' }), 'NVDA'))
    expect(noKey.text).toContain('Daily short volume is not stated: this server has no key for the data vendor. That is not the same as none.')
    const noInterest = honest(answerFromInterest(interestEnv({ settlement_date: null, latest: null, publication_estimate: null,
      interest: { state: 'failed', reason: 'rate_limited', http_status: 429, reports: [], count: 0, shown: 0, cut: false, first_date: null } }, { status: 'partial', as_of: null }), 'NVDA'))
    expect(noInterest.text.split('\n')[0]).toBe("Short interest is not stated: the server's last read of it failed. That is not the same as none.")
    expect(noInterest.text).toContain('Daily short volume, the newest 3 days of the 12 the server holds')
    expect(noInterest.text).not.toContain(REPORT_LAG)
    expect(noInterest.table).toBeUndefined()
    expect(noInterest.facts).toMatchObject({ settlement_date: null, latest: null, interest_state: 'failed', volume_state: 'ok' })
    const none = honest(answerFromInterest(interestEnv({ settlement_date: null, latest: null, publication_estimate: null,
      interest: { state: 'none', reason: null, http_status: 200, reports: [], count: 0, shown: 0, cut: false, first_date: null },
      volume: { state: 'none', reason: null, http_status: 200, days: [], count: 0, shown: 0, window_days: null },
      float: { shares: null, pct_float: null, withheld: false, state: 'missing', source: 'x' } }, { as_of: null }), 'QQQQ'))
    expect(none.text.split('\n')).toEqual([
      'The data vendor holds no FINRA short interest report for QQQQ. That is a normal answer, not a failed read, and it is not zero shares short.',
      'The data vendor holds no daily short volume for QQQQ. That is a normal answer, not a failed read.',
      READ_LINE,
      SOURCE_LINE,
    ])
  })
  it('an answer that is not held, a refused plan and a failed read are never "no short interest"', () => {
    const u = honest(answerFromInterest(UNAVAILABLE, 'NVDA'))
    expect(u.text).toMatch(/^I couldn't read NVDA's short interest: none is held on the server at the moment .*never starts a read from the data vendor\), or the data plan does not include it, or the server's last read of it failed\. Open NVDA's Short interest panel, then ask again\. No figure is stated\. That is not the same as no short interest\.$/)
    expect(u.text).not.toMatch(/holds no FINRA short interest report|zero shares/)
    expect(u.facts).toBeUndefined()
    expect(honest(answerFromInterest(REFUSED, 'NVDA')).text).toBe("I couldn't read NVDA's short interest: that request wasn't allowed for this question, so nothing was read. No figure is stated. That is not the same as no short interest.")
    expect(honest(answerFromInterest(interestEnv({ interest: null, volume: null }), 'NVDA')).text).toMatch(/^I couldn't read NVDA's short interest: UCT's data did not answer cleanly\./)
  })
  it('the bounds and every field the answer reads are the kind\'s own and the SHINT panel\'s own (read from both files, never retyped)', () => {
    const src = adapter('short_interest')
    expect([pyInt(src, 'DEFAULT_REPORTS'), pyInt(src, 'MAX_REPORTS'), pyInt(src, 'DEFAULT_DAYS'), pyInt(src, 'MAX_DAYS')]).toEqual([INTEREST_DEFAULT_REPORTS, INTEREST_MAX_REPORTS, INTEREST_DEFAULT_DAYS, INTEREST_MAX_DAYS])
    expect([INTEREST_DEFAULT_REPORTS, INTEREST_MAX_REPORTS, INTEREST_DEFAULT_DAYS]).toEqual([REPORTS_SHOWN, REPORTS_MORE, VOLUME_DAYS_SHOWN])
    expect(pyInt(py('api/services/short_data.py'), 'SV_DAYS')).toBe(INTEREST_MAX_DAYS)
    expect(/^REPORT_FIELDS = \(([\s\S]+?)\)$/m.exec(src)[1].match(/"\w+"/g).map(s => s.slice(1, -1))).toEqual(Object.keys(report('2026-10-30', 1, 1, 1)).filter(k => k !== 'isolated'))
    expect(pyTuple(src, 'DAY_FIELDS')).toEqual(Object.keys(vday('2026-11-13', 1, 1, 1)).filter(k => k !== 'isolated'))
    expect(pyTuple(src, 'FLOAT_FIELDS')).toEqual(Object.keys(interestEnv().data.float).filter(k => k !== 'isolated'))
    // "one and a half times the float" is the service's own bound, and "a few hours" its own freshness
    expect(py('api/services/short_data.py')).toMatch(/^PCT_FLOAT_MAX = 150\.0\b/m)
    expect(py('api/services/short_data.py')).toMatch(/^STOCK_FRESH_S = 4 \* 3600\.0\b/m)
  })
})

// ── short.list → stock.shortList ───────────────────────────────────────────────────────────────────────────────────────
const lrow = (sym, short, dtc, prev, o = {}) => ({ sym, short_interest: short, avg_daily_volume: 1000000, days_to_cover: dtc, prev_short_interest: prev, change_shares: prev == null ? null : short - prev,
  change_pct: prev == null ? null : Math.round((short - prev) / prev * 1000) / 10, float_shares: 10000000, pct_float: short / 100000, isolated: true, ...o })
const LIST_ROWS = () => [lrow('CCC', 900000, 9, null, { float_shares: null, pct_float: null }), lrow('AAA', 3000000, 6, 2000000), lrow('DDD', 2000000, 3, 100000, { float_shares: 1000000, pct_float: null }),
  lrow('BBB', 600000, 1.2, 1000000)]
const listEnv = (over = {}, envOver = {}) => envelope(KINDS.list, {
  rank: 'dtc', settlement_date: '2026-10-30', previous_settlement_date: '2026-10-15', newer_report_landing: null, newer_report_due: null, publication_estimate: '2026-11-10', read_at: READ_AT, held: 'held',
  count: 2900, universe: 3742, ranked: 4, limit: 25, shown: 4, cut: false, rows: LIST_ROWS(), floor_shares: null, float: { state: 'ok', with_float: 2, withheld: 1, source: 'fixture', isolated: true }, check: null,
  source: 'fixture', ...over,
}, envOver)

describe('stock.shortList — the answer', () => {
  it('the report by its settlement date, the ranked rows with the ranked number first, and a number that does not exist said as missing', () => {
    const a = honest(answerFromList(listEnv()))
    expect(a.text.split('\n')).toEqual([
      "Short interest list, FINRA's report for settlement date Fri, Oct 30, 2026 (the report before it: Oct 15, 2026): 2,900 of the 3,742 stocks UCT follows are in the report; 4 have days to cover.",
      'All 4, most days to cover first:',
      '• CCC: 9.00 days to cover; 900,000 shares short; no previous report to compare with; percent of float not given',
      '• AAA: 6.00 days to cover; 3,000,000 shares short; +50.00% from the report before; 30.00% of float',
      '• DDD: 3.00 days to cover; 2,000,000 shares short; +1900.00% from the report before; percent of float not given',
      '• BBB: 1.20 days to cover; 600,000 shares short; −40.00% from the report before; 6.00% of float',
      `${DTC_MEANING} A stock with none is not ranked, never ranked as 0.`,
      LAG_LINE,
      READ_LINE,
      SOURCE_LINE,
    ])
    expect(a.facts).toMatchObject({ rank: 'dtc', order: SHORT_RANKS.dtc.words, settlement_date: '2026-10-30', settlement_day: 'Fri, Oct 30, 2026', previous_settlement_date: '2026-10-15', read: '9:05 AM ET',
      stale: false, in_report: 2900, followed: 3742, ranked: 4, shown: 4, cut: false, floor_shares: null, newer_report_landing: null, newer_report_due: null, check_failed: false })
    // null, never 0: no previous report, no float on file, a withheld percent
    expect(a.facts.rows[0]).toMatchObject({ symbol: 'CCC', previous_shares_short: null, change_shares: null, change_pct: null, change_pct_text: null, float_shares: null, pct_float: null, pct_float_text: null })
    expect(a.facts.rows[2]).toMatchObject({ symbol: 'DDD', float_shares: 1000000, pct_float: null, pct_float_text: null })
    expect(a.table.rows[0]).toEqual({ symbol: 'CCC', shares: '900,000', dtc: '9.00', change: 'not given', float: 'not given', adv: '1,000,000' })
    expect(a.present.items.map(i => `${i.label} ${i.value}`)).toEqual(['CCC 9.00', 'AAA 6.00', 'DDD 3.00', 'BBB 1.20'])
    expect(a.text).not.toMatch(/\b0\.00%/)
    expect(shortListRead({ ...listEnv().data, status: 'ok' }).state).toBe('ok')           // the kind's data IS the shape the SHRTS panel reads
  })
  it('each order is the panel\'s own words; a cut names the end left out; the floor and the float rules are said', () => {
    const up = honest(answerFromList(listEnv({ rank: 'up', rows: [LIST_ROWS()[1]], ranked: 31, shown: 1, cut: true, limit: 1, floor_shares: 500000 })))
    expect(up.text.split('\n').slice(0, 4)).toEqual([
      "Short interest list, FINRA's report for settlement date Fri, Oct 30, 2026 (the report before it: Oct 15, 2026): 2,900 of the 3,742 stocks UCT follows are in the report; 31 rose from a previous report big enough to rank.",
      `The first 1 of the 31, ${SHORT_RANKS.up.words} (the lowest ranked are left out):`,
      '• AAA: +50.00% from the report before; 3,000,000 shares short; 6.00 days to cover; 30.00% of float',
      'A percent change is ranked only for stocks whose previous report was at least 500,000 shares, so a tiny base cannot top the list.'])
    expect(up.facts).toMatchObject({ rank: 'up', ranked: 31, shown: 1, cut: true, floor_shares: 500000 })
    const down = honest(answerFromList(listEnv({ rank: 'down', rows: [LIST_ROWS()[3]], ranked: 1, shown: 1, floor_shares: 500000 })))
    expect(down.text.split('\n').slice(1, 3)).toEqual([`The 1 stock, ${SHORT_RANKS.down.words}:`, '• BBB: −40.00% from the report before; 600,000 shares short; 1.20 days to cover; 6.00% of float'])
    const float = honest(answerFromList(listEnv({ rank: 'float', rows: [LIST_ROWS()[1], LIST_ROWS()[3]], ranked: 2, shown: 2 })))
    expect(float.text.split('\n').slice(1, 5)).toEqual([`All 2, ${SHORT_RANKS.float.words}:`,
      '• AAA: 30.00% of float; 3,000,000 shares short; +50.00% from the report before; 6.00 days to cover',
      '• BBB: 6.00% of float; 600,000 shares short; −40.00% from the report before; 1.20 days to cover',
      `${FLOAT_CAUTION} A stock with no float on file is not ranked, and 1 stock whose short interest is more than one and a half times its float is withheld as a mismatch.`])
    expect(float.present.items.map(i => `${i.label} ${i.value} ${i.note}`)).toEqual(['AAA 30.00% of float', 'BBB 6.00% of float'])
    for (const key of LIST_RANK_KEYS) expect(honest(answerFromList(listEnv({ rank: key, floor_shares: key === 'up' || key === 'down' ? 500000 : null }))).text, key).toContain(`, ${SHORT_RANKS[key].words}:`)
  })
  it('nothing ranked, no float file, no previous report, a report still arriving, a failed look and a report that is due are each said', () => {
    const none = honest(answerFromList(listEnv({ rank: 'float', rows: [], ranked: 0, shown: 0, float: { state: 'missing', with_float: 0, withheld: 0, source: 'x' } })))
    expect(none.text.split('\n').slice(1, 3)).toEqual([
      `No stock in the report has the number this order needs (${SHORT_RANKS.float.words}). That is a statement about the report the server holds, not a failed read.`,
      'The screener export the float comes from could not be read when the list was put together, so no percent of float is stated. That is not the same as no stock being short.'])
    expect(none.table).toBeUndefined()
    const first = honest(answerFromList(listEnv({ rank: 'up', rows: [], ranked: 0, shown: 0, previous_settlement_date: null, floor_shares: 500000 })))
    expect(first.text.split('\n')[0]).toBe("Short interest list, FINRA's report for settlement date Fri, Oct 30, 2026: 2,900 of the 3,742 stocks UCT follows are in the report; 0 rose from a previous report big enough to rank.")
    expect(first.text).toContain('The server holds no previous report, so no change is stated: that is not a change of 0.')
    const landing = honest(answerFromList(listEnv({ settlement_date: '2026-10-15', previous_settlement_date: '2026-09-30', newer_report_landing: '2026-10-30' })))
    expect(landing.text).toContain('A newer report, for settlement date Oct 30, 2026, is still arriving at the data vendor, so this list is the report before it.')
    expect(landing.text).toMatch(/^Short interest list, FINRA's report for settlement date Thu, Oct 15, 2026 /)
    const check = honest(answerFromList(listEnv({ check: { state: 'unavailable', reason: 'refused', http_status: 403, at: '2026-11-17T12:00:00Z' } }, { stale: true })))
    expect(check.text).toContain("Stale: the server's last look for a newer report did not go well, so this is the last report it read and a newer one may exist.")
    expect(check.facts).toMatchObject({ stale: true, check_failed: true })
    const due = honest(answerFromList(listEnv({ newer_report_due: '2026-11-13' }, { stale: true })))
    expect(due.text).toContain("Stale: by FINRA's schedule the report for settlement date Nov 13, 2026 has been published and the server has not read it, so this list may be one report behind.")
    expect(due.facts).toMatchObject({ newer_report_due: '2026-11-13', settlement_date: '2026-10-30' })
    expect(honest(answerFromList(listEnv({ read_at: null, publication_estimate: null }, { stale: true }))).text.split('\n').slice(-3)).toEqual([REPORT_LAG, 'The answer carries no read time, so I cannot say how old it is.', SOURCE_LINE])
  })
  it('a list that is not held, a refused plan and a failed read are never "no stock is short"', () => {
    const u = honest(answerFromList(UNAVAILABLE))
    expect(u.text).toMatch(/^I couldn't read the short interest list: none is held on the server at the moment .*never starts a read from the data vendor\), or the data plan does not include it, or the server's last read of it failed\. Open the Short interest list panel, then ask again\. No figure is stated\. That is not the same as no stock being short\.$/)
    expect(u.text).not.toMatch(/No stock in the report/)
    expect(honest(answerFromList(REFUSED)).text).toBe("I couldn't read the short interest list: that request wasn't allowed for this question, so nothing was read. No figure is stated. That is not the same as no stock being short.")
    expect(honest(answerFromList(listEnv({ rank: 'banana' }))).text).toMatch(/^I couldn't read the short interest list: UCT's data did not answer cleanly\./)
    expect(honest(answerFromList(listEnv({ settlement_date: 'today' }))).text).toMatch(/^I couldn't read the short interest list: UCT's data did not answer cleanly\./)
  })
  it('a rank is read by the SHRTS panel\'s own word map, never a second one', () => {
    for (const [word, key] of Object.entries(SHORT_RANK_ARG_WORDS)) {
      expect(rankOf(word), word).toBe(key)
      expect(rankOf(word.toLowerCase()), word).toBe(key)
    }
    for (const key of Object.keys(SHORT_RANKS)) expect(rankOf(key)).toBe(key)
    expect([rankOf(null), rankOf(undefined), rankOf('')]).toEqual([DEFAULT_SHORT_RANK, DEFAULT_SHORT_RANK, DEFAULT_SHORT_RANK])
    expect([rankOf('banana'), rankOf('short'), rankOf(3), rankOf('constructor'), rankOf('toString')]).toEqual([null, null, null, null, null])
    // the module holds no rank word of its own: every word it accepts is the panel's
    const own = fs.readFileSync(path.join(__dirname, 'capabilities', 'terminalDataWave5.js'), 'utf8')
    for (const word of ['INCREASE', 'COVERING', 'BUILDING', 'FALLING', 'PCT']) expect(own.includes(`${word}:`), word).toBe(false)
  })
  it('the ranks, their words, the limits and every field the answer reads are the kind\'s own and the SHRTS panel\'s own (read from both files, never retyped)', () => {
    const src = adapter('short_list')
    expect(pyTuple(src, 'RANKS')).toEqual(LIST_RANK_KEYS)
    expect(LIST_RANK_KEYS).toEqual(Object.keys(SHORT_RANKS))
    expect(/^DEFAULT_RANK = "(\w+)"/m.exec(src)[1]).toBe(DEFAULT_SHORT_RANK)
    const words = Object.fromEntries([.../^RANK_WORDS = \{([\s\S]+?)\}$/m.exec(src)[1].matchAll(/"(\w+)": "([^"]+)"/g)].map(m => [m[1], m[2]]))
    expect(words).toEqual(Object.fromEntries(Object.entries(SHORT_RANKS).map(([k, v]) => [k, v.words])))
    expect([pyInt(src, 'MAX_LIMIT'), pyInt(src, 'DEFAULT_LIMIT')]).toEqual([LIST_MAX_ROWS, 25])
    expect(/^ROW_FIELDS = \(([\s\S]+?)\)$/m.exec(src)[1].match(/"\w+"/g).map(s => s.slice(1, -1))).toEqual(Object.keys(lrow('AAA', 1, 1, 1)).filter(k => k !== 'isolated'))
    expect(pyTuple(src, 'FLOAT_FIELDS')).toEqual(Object.keys(listEnv().data.float).filter(k => k !== 'isolated'))
    expect(pyTuple(src, 'CHECK_FIELDS')).toEqual(['state', 'reason', 'http_status', 'at'])
    expect(py('api/services/short_data.py')).toMatch(/^FLOOR_SHARES = 500_000\b/m)
  })
})

// ── served vs dark, isolation on both sides, the manifest limits, the read each answer makes ───────────────────────────
let calls, ENVS
function wire(kinds) {
  calls = []; ENVS = {}
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
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
const reset = () => { _resetAgentConfig(); _resetTurns(); _resetTerminalDataForTest(); _resetTerminalLocalForTest(); _resetTerminalWave2ForTest(); _resetTerminalWave3ForTest(); _resetTerminalWave4ForTest(); _resetTerminalWave5ForTest() }

describe('served vs dark', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'themes', 'earnings', 'earnings.season', 'group.drill', 'levels.darkpool', 'confluence.board'], 'other kinds only']])('dark (%j, %s): neither is registered', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    expect(registerTerminalWave5Capabilities()).toEqual([])
    registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames(), n).not.toContain(n)
  })

  it.each(PAIRS)('served %s alone: only %s is registered, once, and it unregisters cleanly', async (kind, capability) => {
    wire([kind])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([capability])
    expect(registerTerminalWave5Capabilities()).toEqual([])            // idempotent
    reset()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([])
  })

  it('both served: local-only on BOTH sides, never a plain data read, inside the manifest text limits', async () => {
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
      expect(cap.hints, name).toMatch(/SETTLEMENT DATE, weeks old: never today/)                 // the planner is told what the date is
      expect(handshake.isolated_kinds, kind).toContain(kind)          // both kinds of this wave are model-isolated
      expect(handshake.local_only_actions, name).toContain(name)      // turn.LOCAL_ONLY_ACTIONS, via the generated handshake
      expect(dataReads.includes(`"${name}"`), name).toBe(false)       // the two server sets are disjoint
    }
  })

  it('each answer makes ONE read of its own kind, with the member\'s arguments (a rank word read by the panel\'s map)', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KINDS.interest] = (p) => interestEnv({ sym: p.symbol })
    ENVS[KINDS.list] = (p) => listEnv({ rank: p.rank, floor_shares: p.rank === 'up' || p.rank === 'down' ? 500000 : null })
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    expect((await run(CAPABILITIES.interest, { symbol: '$nvda', reports: 500, days: null })).text).toMatch(/^NVDA short interest, FINRA's report for settlement date Fri, Oct 30, 2026/)
    expect((await run(CAPABILITIES.interest, { symbol: 'brk.b', reports: null, days: 3 })).text).toMatch(/^BRK-B short interest/)
    expect((await run(CAPABILITIES.list, { rank: null, limit: null })).text).toMatch(/^Short interest list, FINRA's report for settlement date Fri, Oct 30, 2026/)
    expect((await run(CAPABILITIES.list, { rank: 'INCREASE', limit: 500 })).text).toContain(`, ${SHORT_RANKS.up.words}`)
    expect((await run(CAPABILITIES.list, { rank: 'float', limit: 1 })).text).toContain(`, ${SHORT_RANKS.float.words}`)
    expect(reads().map(r => [r.kind, r.params, r.purpose])).toEqual([
      [KINDS.interest, { symbol: 'NVDA', reports: 24, days: 10 }, 'answer'],
      [KINDS.interest, { symbol: 'BRK-B', reports: 12, days: 3 }, 'answer'],
      [KINDS.list, { rank: 'dtc', limit: 25 }, 'answer'],
      [KINDS.list, { rank: 'up', limit: 50 }, 'answer'],
      [KINDS.list, { rank: 'float', limit: 1 }, 'answer'],
    ])
  })

  it('no read without a turn or without a usable argument, and a refusal is answered in fixed words', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    for (const [name, args] of [[CAPABILITIES.interest, { symbol: 'NVDA', reports: null, days: null }], [CAPABILITIES.list, { rank: null, limit: null }]]) {
      expect((await getCapability(name).answer(null, args, null)).text, name).toMatch(/needs the Agent's turn/)
    }
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    for (const symbol of ['', 'the market', 'I:SPX', 'TOOLONGX', null]) {
      expect((await run(CAPABILITIES.interest, { symbol, reports: null, days: null })).text, String(symbol)).toMatch(/^Which stock's short interest should I read\? Give me one ticker\. No figure is stated\.$/)
    }
    expect((await run(CAPABILITIES.list, { rank: 'banana', limit: null })).text).toBe('Which order should I rank the short interest list by? Days to cover, Biggest increase, Biggest decrease, Percent of float. No figure is stated.')
    expect(reads()).toEqual([])
    const a = await run(CAPABILITIES.list, { rank: null, limit: null })   // the stub refuses
    expect(a.text).toMatch(/^I couldn't read the short interest list: that request wasn't allowed for this question/)
    expect(reads()).toHaveLength(1)
  })
})

// ── routing: the wave's own words-only group, armed only while a capability is registered ───────────────────────────────
const ownGroup = () => GROUPS.find(g => g.id === ROUTE_GROUP)
const groupWords = (id) => GROUPS.find(g => g.id === id).words
const DATA_BASE = [...groupWords('data')]              // read before anything is served: routing.js's own lists
const SCREENER_BASE = [...groupWords('screener')]
const ROUTE_OPTS = () => ({ enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold })
const namedBy = (words) => (text) => Object.keys(words).filter(k => words[k].some(re => re.test(String(text).toLowerCase())))
const wordKeys = namedBy(WAVE5_ROUTE_WORDS)
/** plain member asks, by the capability whose words must name them */
const ASKS = {
  interest: ['short interest on NVDA', 'what is the short interest on TSLA', "what's AAPL's short interest", 'how heavily shorted is GME', 'how shorted is PLTR', 'NVDA days to cover', 'short volume for AMD',
    'how many shares of GME are sold short', 'is TSLA heavily shorted'],
  list: ['most shorted stocks', 'which stocks have the highest short interest', 'short interest list', 'highest days to cover', 'biggest increase in short interest', 'top short interest names',
    'the most heavily shorted names in the market', 'biggest decrease in short interest across the market'],
}
/** another capability's language: neither of the two's words may name these */
const NOT_OURS = [
  'short NVDA here', 'should I go short TSLA', 'show me short setups', 'best short ideas today', 'the short side of the trade', 'short-term trend on AAPL', 'make the chart shorter',     // "short" = the bearish side, or a size
  'what is on the confluence board', 'bearish confluence names', 'confluence board short', 'short confluence names',                                                                            // stock.confluenceBoard (CONFL takes SHORT)
  'are specs net short gold', 'how short are commercials in crude', 'net short positioning in the S&P futures',                                                                             // cot.positioning
  'open interest on NVDA calls', 'interest rates today', 'put call ratio for SPY',                                                                                                           // options, macro
  'short squeeze candidates', 'find short squeezes', 'stocks with short float above 20%', 'short float on NVDA', 'high short float names',                                                  // the Screener's field and its screens
  'find stocks with high short interest', 'scan for the most shorted stocks', 'screen for short interest above 15%', 'stocks with short interest over 20%', 'filter by days to cover',      // screens with a condition
  'alert me when short interest rises on GME', 'notify me if days to cover jumps', 'add the most shorted stocks to my watchlist', 'short interest on my watchlist',                        // alerts, the member's own lists
  'open the short interest panel', 'add a short interest widget', 'go to the short interest page',                                                                                          // navigation
  'what is short interest', "what's days to cover", 'explain days to cover', 'what does short interest mean', 'how is short interest calculated', 'define short volume',                   // what a term means (the guide)
  'volume on NVDA today', 'unusual volume today', 'relative volume leaders', 'NVDA float', 'who owns NVDA',                                                                                 // volume, float, ownership
  'dark pool levels on NVDA', 'gamma levels for NVDA', 'show me the top flow picks', 'earnings season today', 'what are CEOs saying', 'stocks in the technology sector',                   // waves 1 to 4
  'any news on TSLA', 'switch to weekly', 'what got upgraded today', 'which stocks made new 52-week highs', 'most active stocks today', 'top gainers today',
]
/** asks the earlier waves' words name (their own tests hold the full lists): this wave's words must not */
const EARLIER_ASKS = ['what got upgraded today', 'new highs today', 'top gainers over 60 days', 'dark pool levels on NVDA', 'which stocks made new 52-week highs', 'which themes are rotating in',
  'what is on the confluence board', 'bearish confluence names', 'expected move for NVDA earnings', 'search earnings calls for pricing power', 'gamma levels for NVDA', 'show me the top flow picks',
  "what is the flow record's win rate", 'earnings reactions for yesterday', 'earnings season today', 'call themes this month', 'drill into XLK', 'stocks in the semiconductors industry']

describe('routing words', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the group is words-only and never a filler, routing.js lists the two by action with no word of its own, and it is the 47th group under the cap', () => {
    const g = ownGroup()
    expect(g.wordsOnly && g.fillLast).toBe(true)
    expect(g.words).toEqual([])                                      // server-armed: empty until a capability registers
    expect([...g.actions].sort()).toEqual([...ALL].sort())
    expect(g.domains).toEqual([])
    expect(g.title.length).toBeLessThanOrEqual(160)                  // the server cuts a group title at 160 characters (turn.py validate_routing)
    // the server keeps only MAX_GROUPS groups: this wave's is the 47th of 48 (how many are left is pinned by the wave that took
    // the last one, agentTerminalDataWave6.test.js)
    const max = Number(/^MAX_GROUPS\s*=\s*(\d+)\s*$/m.exec(py('api/services/uct_agent/turn.py'))[1])
    expect([max, GROUPS.length <= max]).toEqual([48, true])
    expect(GROUPS.map(x => x.id).slice(45, 47)).toEqual([WAVE4_GROUP, ROUTE_GROUP])
    expect(new Set(GROUPS.map(x => x.id)).size).toBe(GROUPS.length)
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'themes', 'earnings', 'earnings.season', 'group.drill'], 'other kinds only']])('dark (%j, %s): the group has no words, and the data and screener groups keep exactly routing.js\'s', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(ownGroup().words).toEqual([])
    expect(groupWords('data')).toEqual(DATA_BASE)
    expect(groupWords('screener')).toEqual(SCREENER_BASE)
    for (const asks of Object.values(ASKS)) for (const q of asks) expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
  })

  it.each(KEYS)('served %s alone: only its own words are armed, no other group\'s words change, and they are taken back', async (key) => {
    wire([KINDS[key]])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(ownGroup().words).toEqual(WAVE5_ROUTE_WORDS[key])
    expect(groupWords('data')).toEqual(DATA_BASE)
    expect(groupWords('screener')).toEqual(SCREENER_BASE)
    expect(groupWords(WAVE4_GROUP)).toEqual([])
    registerTerminalWave5Capabilities()                                // idempotent: never armed twice
    expect(ownGroup().words).toHaveLength(WAVE5_ROUTE_WORDS[key].length)
    reset()
    expect(ownGroup().words).toEqual([])
  })

  it('every capability has words, and each ask is named by its own capability\'s words and by no other of this wave', () => {
    expect(Object.keys(WAVE5_ROUTE_WORDS).sort()).toEqual([...KEYS].sort())
    for (const [key, asks] of Object.entries(ASKS)) for (const q of asks) expect(wordKeys(q), q).toEqual([key])
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

  it('the nearest neighbours keep their own asks: the Screener\'s short float, the confluence board\'s bearish side, a bare "short"', async () => {
    wire([...PAIRS.map(p => p[0]), 'confluence.board', 'screen.run'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    // the Screener's own words still name its asks, and this wave's group does not ride with them
    for (const q of ['stocks with short float above 20%', 'find stocks with high short interest', 'screen for short interest above 15%', 'scan for short squeeze candidates']) {
      expect(selectGroups(q).selected, q).toContain('screener')
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
    // routing only ADDS: "short interest" is also the Screener's word, so the Screener still rides beside this wave's group
    for (const q of ['short interest on NVDA', 'which stocks have the highest short interest']) {
      expect(selectGroups(q).selected, q).toEqual(expect.arrayContaining(['screener', ROUTE_GROUP]))
    }
    // the confluence board's bearish asks reach the board, never the short interest list
    for (const q of ['bearish confluence names', 'what is on the confluence board']) {
      for (const route of [routeManifest, routeManifestV2]) {
        const names = route(full, q, ROUTE_OPTS()).manifest.map(c => c.name)
        expect(names, `${route.name}: ${q}`).toContain(WAVE2_CAPABILITIES.confluence)
      }
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
    // "short" alone (a side, never FINRA's term) selects nothing of this wave under v1
    for (const q of ['short', 'go short', 'short it', 'SHORT', 'shorts']) expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
  })

  it('served: the fill for a message nothing recognised never carries the words-only group', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const q of ['flip to AMD', 'lose the gridlines', 'any articles on RIVN lately', 'show me the leaders', 'both', 'hmm', 'short']) {
      for (const route of [routeManifest, routeManifestV2]) {
        const names = route(full, q, ROUTE_OPTS()).manifest.map(c => c.name)
        for (const n of ALL) expect(names, `${route.name}: ${q}`).not.toContain(n)
      }
    }
  })

  it('the typo lexicon: registering the two changes no correction of any OTHER capability\'s capreg corpus phrasing', async () => {
    // A summary's and a hint's lowercase words join the typo lexicon (nl/lexicon.js). This wave's own phrasings are left out.
    wire([])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const texts = [...new Set(allPhrasings().filter(p => !ALL.includes(p.intent.id)).map(p => p.ph.text)), 'walk me through the setup on NVDA', 'wipe the Momentum list', 'sort ascending by change', 'ascending order',
      'show me the leeders', 'chnage the theme', 'make it shorter', 'the shortest one', 'sorted results', 'sort it by change', 'hover over it', 'recover the layout', 'floating window', 'covers the whole screen',
      'settle the layout', 'rank them', 'interesting names today', 'whats the reprot date', 'shrot list', 'the newst one', 'shoretd']
    const read = () => { const lex = lexiconFor(null); return texts.map(t => JSON.stringify((correctTypos(t, lex) || []).map(v => v.text))) }
    const before = read()
    _resetAgentConfig(); wire(PAIRS.map(p => p[0])); await loadAgentConfig(); registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames()).toContain(n)
    const after = read()
    expect(texts.length).toBeGreaterThan(500)
    expect(texts.map((t, i) => (before[i] !== after[i] ? `${t}: ${before[i]} -> ${after[i]}` : null)).filter(Boolean)).toEqual([])
  })

  it('no OTHER capability\'s capreg corpus phrasing is named by these words (armed, the group rides with none of them)', () => {
    // every corpus phrasing but this wave's own: production's and the dark ones (the corpus runs them with every kind on)
    const others = [...new Set(allPhrasings().filter(p => !ALL.includes(p.intent.id)).map(p => p.ph.text))]
    expect(others.length).toBeGreaterThan(500)
    expect(others.filter(t => wordKeys(t).length)).toEqual([])
  })

  it('the earlier waves\' words name none of this wave\'s asks, and these words name none of theirs', () => {
    const earlier = [namedBy(TERMINAL_ROUTE_WORDS), namedBy(WAVE2_ROUTE_WORDS), namedBy(WAVE3_ROUTE_WORDS), namedBy(WAVE4_ROUTE_WORDS)]
    for (const asks of Object.values(ASKS)) for (const q of asks) expect(earlier.flatMap(f => f(q)), q).toEqual([])
    for (const q of EARLIER_ASKS) {
      expect(earlier.flatMap(f => f(q)).length, q).toBeGreaterThan(0)    // non-vacuity: an earlier wave really names it
      expect(wordKeys(q), q).toEqual([])
    }
  })

  it('no row of the routing-collision table is named by these words (every row belongs to another group)', () => {
    // baseline/routingCollisions.json is asserted under production's kinds, where these words are not armed: this holds it armed
    expect(collisions.rows.length).toBeGreaterThan(10)
    const stolen = collisions.rows.filter(r => r.owner !== ROUTE_GROUP && !(r.also || []).includes(ROUTE_GROUP) && wordKeys(r.text).length).map(r => `${r.text} (${r.owner})`)
    expect(stolen).toEqual([])
  })
})
