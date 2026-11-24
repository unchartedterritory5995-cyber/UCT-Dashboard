// Terminal data wave 4 — the three local-only capabilities over `earnings.season`, `earnings.callThemes` and `group.drill`:
// the member's answer (the data's own time or why there is none; never live / now; a day, lists or a ranking that are not
// held each said in their own words, never as "nothing"; a number that does not exist never as 0: no priced move, no past
// move, no stock move, no RS rank, no place on the board; an envelope's notes never echoed), served vs dark (each registers
// only while the server lists ITS kind), local-only on both sides, the manifest text limits, the reads each answer makes
// (one, or for a group the names and then the group, resolved by the GRP panel's own resolver), and the cross-file facts read
// from the other file (never retyped).
// Routing: the three have their OWN words-only group (`marketViews`; the data group has no room under the routing budget and
// wave 3's group is held at its four). Each capability's own words are on that group only while it is registered (a dark
// server's routing is routing.js's own, and neither the data group's nor wave 3's words ever change), every plain ask reaches
// its capability under v1 and v2, the group never rides the fill, and the words stay off other capabilities' language (who
// reports, one stock's expected move, how a day's reporters moved, a phrase searched in the calls, UCT's stock themes, the
// Screener, watchlists, the sector ranking).
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
import * as seasonModel from '../pages/terminal/panels/earningsSeasonModel'
import { CALL_THEME_LISTS, BOTH_ROWS, callThemesRead } from '../pages/terminal/panels/callThemesModel'
import { PERIOD_RANGES, DEFAULT_PERIOD_RANGE } from '../pages/terminal/panels/periodChangeModel'
import * as groupModel from '../pages/terminal/panels/groupDrillModel'
import { LIVE_WORDS } from './capabilities/terminalDataFormat'
import { _resetTerminalDataForTest } from './capabilities/terminalData'
import { _resetTerminalLocalForTest, TERMINAL_ROUTE_WORDS } from './capabilities/terminalDataLocal'
import { _resetTerminalWave2ForTest, WAVE2_ROUTE_WORDS } from './capabilities/terminalDataWave2'
import { _resetTerminalWave3ForTest, WAVE3_ROUTE_WORDS, ROUTE_GROUP as WAVE3_GROUP } from './capabilities/terminalDataWave3'
import {
  KINDS, CAPABILITIES, PRICED_MEANING, PAST_MEANING, SEASON_MOVE_TODAY, SEASON_MOVE_PAST, THEMES_COUNTING, THEMES_NO_TEXT, GROUP_PCT_MEANING, RS_MEANING, FLOW_MEANING,
  SEASON_SESSION_KEYS, SEASON_MAX_ROWS, THEME_LIST_KEYS, THEMES_MAX_ROWS, GROUP_KIND_KEYS, GROUP_RANGE_KEYS, GROUP_SORT_KEYS, GROUP_DIR_KEYS, GROUP_MAX_ROWS,
  answerFromSeason, answerFromThemes, answerFromGroup, groupLists, groupAsk, kindFirst, resolveAsked,
  registerTerminalWave4Capabilities, _resetTerminalWave4ForTest, WAVE4_ROUTE_WORDS, ROUTE_GROUP,
} from './capabilities/terminalDataWave4'

registerBuiltins()

const REPO = path.resolve(__dirname, '..', '..', '..')
const py = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const adapter = (name) => py(`api/services/uct_agent/marketdata/${name}.py`)
const pyInt = (src, name) => Number(new RegExp(`^${name} = (\\d+)\\b`, 'm').exec(src)[1])
const pyTuple = (src, name) => new RegExp(`^${name} = \\(([^)]+)\\)`, 'm').exec(src)[1].match(/"[^"]+"/g).map(s => s.slice(1, -1))
const FETCHED = '2026-11-17T15:30:00Z'               // 10:30 AM ET, a Tuesday
const NOTE = 'a provider note that must never be echoed 987654'
const envelope = (kind, data, over = {}) => ({
  contract: 'MD-1.0', kind, params_echo: {}, status: 'ok', freshness: 'periodic', as_of: null, fetched_at: FETCHED, delay_s: null,
  stale: false, source: 'fixture', coverage: null, notes: [NOTE], provider_calls: 0, isolated: true, data: { ...data, isolated: true }, ...over,
})
const REFUSED = { status: 'refused', data: null, notes: ['this turn already made 8 data reads'] }
const UNAVAILABLE = { status: 'unavailable', data: null, notes: [NOTE] }
/** every answer of this wave: no live / now wording, and never an envelope note */
function honest(a) {
  expect(a.text).not.toMatch(LIVE_WORDS)
  expect(a.text).not.toContain('987654')
  expect(a.text).not.toContain('8 data reads')
  return a
}

// ── earnings.season → stock.earningsSeason ─────────────────────────────────────────────────────────────────────────────
const srow = (sym, session, mc, o = {}) => ({
  sym, name: `${sym} Corp`, session, mc_b: mc, eps_est: 1, eps_act: null, rev_est: 100, rev_act: null, reported: false, verdict: null,
  priced: null, past: null, past_state: 'not_held', move: null, move_state: null, isolated: true, ...o,
})
const SEASON_ROWS = () => ({
  bmo: [srow('BIG', 'bmo', 900, { eps_act: 1.5, rev_act: 120, reported: true, verdict: 'beat', priced: { pct: 6.2, dollar: 12.4, captured_at: '2026-11-16T16:35:04-05:00', expiry: '2026-11-20', isolated: true },
    past: { moves: [{ date: '2026-08-18', pct: 3.1, isolated: true }, { date: '2026-05-19', pct: -2, isolated: true }], avg_abs: 2.55, n: 2, isolated: true }, past_state: 'ok', move: 3.21, move_state: 'live' }),
  srow('MID', 'bmo', 50, { eps_act: 0.8, rev_act: 90, reported: true, verdict: 'miss', past_state: 'not_measured', move: -4.5, move_state: 'live' }),
  srow('NOCAP', 'bmo', null)],
  amc: [srow('EVE', 'amc', 300, { eps_act: 2, reported: true, move_state: 'next_close' })],
  tbd: [srow('LATE', 'tbd', 1, { name: null })],
  isolated: true,
})
const seasonEnv = (over = {}, envOver = {}) => envelope(KINDS.season, {
  date: '2026-11-17', today: '2026-11-17', day_kind: 'today', default: false, session: 'all', sessions: SEASON_ROWS(), count: 5, shown: 5, scheduled: 5,
  counts: { scheduled: 5, reported: 3, priced: 1, priced_withheld: 1, with_past: 1, past_not_held: 3, moved: 2, isolated: true }, priced_state: 'read', moves_state: 'live',
  calendar_as_of: '2026-11-17T14:00:00Z', built_at: '2026-11-17T14:05:00Z', capture: { hour_et: 16, minute_et: 35, isolated: true }, range: { from: '2026-11-09', to: '2026-11-27', isolated: true },
  held: 'fresh', no_day: false, ...over,
}, envOver)

describe('stock.earningsSeason — the answer', () => {
  it('each company with what was priced, its result, its move and its past reports; a number that does not exist is said as missing', () => {
    const a = honest(answerFromSeason(seasonEnv(), seasonModel))
    expect(a.text.split('\n')).toEqual([
      "Earnings season for Tue, Nov 17, 2026: 5 companies on UCT's earnings calendar; 3 with a result on record, 1 with a priced move stored.",
      'All 5, biggest company first in each part of the day:',
      '• BIG (BIG Corp, before the open): options priced a move of 6.20% ($12.40); EPS $1.50 against $1.00 expected, a beat; stock +3.21% so far in the session, within what was priced; 2 past reports measured, average size 2.55%',
      '• MID (MID Corp, before the open): no priced move stored; EPS $0.80 against $1.00 expected, a miss; stock −4.50% so far in the session; no past move measured',
      '• NOCAP (NOCAP Corp, before the open): no priced move stored; no result on record yet; past moves not held',
      '• EVE (EVE Corp, after the close): no priced move stored; EPS $2.00 against $1.00 expected; its move is measured at the next close; past moves not held',
      '• LATE (time not confirmed): no priced move stored; no result on record yet; past moves not held',
      PRICED_MEANING,
      "1 stored priced move is left out: not from UCT's own option chain read, or without a usable percent.",
      PAST_MEANING,
      '3 companies of the 5 have no past moves held on the server. That is not the same as no past report.',
      SEASON_MOVE_TODAY,
      "Put together by UCT at 9:05 AM ET (UCT's own time; the calendar carries only the day it is for).",
      "Source: UCT's earnings calendar (third-party results and estimates as UCT holds them), UCT's stored option captures and UCT's own move arithmetic. Descriptive only: nothing here is a prediction.",
    ])
    const [big, mid, nocap, eve] = a.facts.rows
    expect(big).toMatchObject({ symbol: 'BIG', session: 'bmo', reported: true, verdict: 'beat', move: 3.21, move_state: 'live', against: 'within', market_cap_billions: 900 })
    expect(big.priced).toEqual({ pct: 6.2, text: '6.20%', dollars: 12.4, dollars_text: '$12.40', captured: '2026-11-16' })
    expect(big.past).toMatchObject({ n: 2, average_size: 2.55, moves: [{ day: '2026-08-18', pct: 3.1, text: '+3.10%' }, { day: '2026-05-19', pct: -2, text: '−2.00%' }] })
    // null, never 0: no priced move, no past move, no market cap, no result, no move
    expect(mid).toMatchObject({ priced: null, past: null, past_state: 'not_measured', move: -4.5 })
    expect(nocap).toMatchObject({ priced: null, past: null, market_cap_billions: null, eps: null, move: null, move_text: null, move_words: null, reported: false })
    expect(eve).toMatchObject({ move: null, move_state: 'next_close', move_words: 'its move is measured at the next close' })
    expect(a.table.rows[0]).toEqual({ symbol: 'BIG', name: 'BIG Corp', session: 'Before the open', priced: '6.20%', eps: '$1.50', eps_expected: '$1.00', result: 'a beat', move: '+3.21%', past: '2 measured, average size 2.55%' })
    expect(a.table.rows[2]).toMatchObject({ symbol: 'NOCAP', priced: 'none stored', eps: '—', result: 'not on record', move: '—', past: 'not held' })
    expect(a.table.rows[3]).toMatchObject({ symbol: 'EVE', result: 'reported', move: 'its move is measured at the next close' })
    expect(a.present.items.map(i => `${i.label} ${i.value}`)).toEqual(['BIG 6.20%'])
    expect(a.link).toEqual({ href: '/calendar', label: 'Open the Calendar' })
    expect(a.facts).toMatchObject({ date: '2026-11-17', day_kind: 'today', scheduled: 5, count: 5, shown: 5, reported: 3, priced: 1, priced_withheld: 1, past_not_held: 3, held: 'fresh', stale: false })
    expect(a.text).not.toMatch(/\b0\.00%/)                             // no missing number became a zero
    expect(seasonModel.earningsSeasonRead({ ...seasonEnv().data, status: 'ok' }).state).toBe('ok')     // the kind's data IS the shape the ERNS panel reads
  })
  it('a part of the day, a cut and the bare read are each named; a past day says what its move is and what is not held', () => {
    const rows = SEASON_ROWS()
    const cut = honest(answerFromSeason(seasonEnv({ session: 'bmo', sessions: { ...rows, bmo: rows.bmo.slice(0, 2), amc: [], tbd: [] }, count: 3, shown: 2, default: true }), seasonModel))
    expect(cut.text.split('\n').slice(0, 2)).toEqual([
      "Earnings season for Tue, Nov 17, 2026 (the next day with a reporter): 5 companies on UCT's earnings calendar; 3 with a result on record, 1 with a priced move stored.",
      'The 2 biggest of the 3 reporting before the open by market cap:'])
    const none = honest(answerFromSeason(seasonEnv({ session: 'amc', sessions: { bmo: [], amc: [], tbd: [] }, count: 0, shown: 0 }), seasonModel))
    expect(none.text.split('\n')[0]).toBe("5 companies are on UCT's earnings calendar for Tue, Nov 17, 2026, none of them reporting after the close.")
    expect(none.table).toBeUndefined()
    const blank = { ...rows, bmo: rows.bmo.map(r => ({ ...r, move: null, move_state: r.reported ? 'not_held' : null })), amc: rows.amc.map(r => ({ ...r, move_state: 'not_held' })) }
    const past = honest(answerFromSeason(seasonEnv({ date: '2026-11-16', day_kind: 'past', sessions: blank, moves_state: 'not_held', held: 'last_good', priced_state: 'failed' },
      { status: 'partial', freshness: 'historical', stale: true }), seasonModel))
    expect(past.text).toContain(SEASON_MOVE_PAST)
    expect(past.text).not.toContain(SEASON_MOVE_TODAY)
    expect(past.text).toContain('The stock moves for that day are not held on the server at the moment, and this answer never starts price reads, so no move is stated. That is not the same as no move.')
    expect(past.text).toContain('The stored priced moves could not be read when this answer was put together, so none is stated. That is not the same as none priced.')
    expect(past.text).toContain('Stale: this is the last good answer for that day, so a result or a move that landed since is missing.')
    expect(past.text).toContain('• BIG (BIG Corp, before the open): options priced a move of 6.20% ($12.40); EPS $1.50 against $1.00 expected, a beat; its move is not held; 2 past reports measured, average size 2.55%')
    expect(past.text).not.toMatch(/so far in the session|[+−]\d+\.\d+% so far/)
    const failed = honest(answerFromSeason(seasonEnv({ moves_state: 'failed', built_at: null }, { status: 'partial', stale: true }), seasonModel))
    expect(failed.text).toContain('The price read for the stock moves failed when this answer was put together, so no move is stated. That is not the same as no move.')
    expect(failed.text).toContain('The answer carries no build time, so I cannot say how old it is.')
  })
  it('nobody reporting and a day the calendar does not carry are normal answers; a day that is not held is never that', () => {
    const empty = honest(answerFromSeason(seasonEnv({ sessions: { bmo: [], amc: [], tbd: [] }, count: 0, shown: 0, scheduled: 0, counts: {}, moves_state: null }), seasonModel))
    expect(empty.text.split('\n')[0]).toBe("No company is on UCT's earnings calendar for Tue, Nov 17, 2026. That is a normal answer, not a failed read.")
    expect(empty.table).toBeUndefined()
    const holiday = honest(answerFromSeason(seasonEnv({ date: '2026-11-26', no_day: true, sessions: { bmo: [], amc: [], tbd: [] }, count: 0, shown: 0, scheduled: 0 }), seasonModel))
    expect(holiday.text).toBe("Thu, Nov 26, 2026 is not a day UCT's earnings calendar carries in the week it holds (a market holiday). That is a normal answer, not a failed read.")
    const weekend = honest(answerFromSeason(seasonEnv({ date: '2026-11-21', no_day: true }), seasonModel))
    expect(weekend.text).toBe('Sat, Nov 21, 2026 is a weekend day, so no company reports. That is a normal answer, not a failed read.')
    const u = honest(answerFromSeason(UNAVAILABLE, seasonModel, '2026-11-17'))
    expect(u.text).toMatch(/^I couldn't read the earnings season for Tue, Nov 17, 2026: no answer for that day is held on the server at the moment .*never starts that work\)\. .*No figure is stated\. That is not the same as nobody reporting\.$/)
    expect(u.text).not.toMatch(/No company is on UCT's earnings calendar/)
    expect(honest(answerFromSeason(REFUSED, seasonModel)).text).toBe("I couldn't read the earnings season: that request wasn't allowed for this question, so nothing was read. No figure is stated. That is not the same as nobody reporting.")
    expect(honest(answerFromSeason(seasonEnv({ sessions: null }), seasonModel)).text).toMatch(/^I couldn't read the earnings season for Tue, Nov 17, 2026: UCT's data did not answer cleanly\./)
  })
  it('the sessions, the limit and every field the answer reads are the kind\'s own and the ERNS panel\'s own (read from both files, never retyped)', () => {
    const src = adapter('earnings_season')
    expect(pyTuple(src, 'SESSION_CHOICES')).toEqual(SEASON_SESSION_KEYS)
    expect(pyTuple(src, 'SESSION_CHOICES')).toEqual(Object.keys(seasonModel.EARNINGS_SESSIONS))
    expect(pyTuple(src, 'SESSIONS')).toEqual([...seasonModel.SESSION_ORDER])
    expect(pyInt(src, 'MAX_LIMIT')).toBe(SEASON_MAX_ROWS)
    expect(/^ROW_FIELDS = \(([\s\S]+?)\)$/m.exec(src)[1].match(/"\w+"/g).map(s => s.slice(1, -1))).toEqual(Object.keys(srow('AAA', 'bmo', 1)).filter(k => k !== 'isolated'))
    expect(pyTuple(src, 'PRICED_FIELDS')).toEqual(Object.keys(SEASON_ROWS().bmo[0].priced).filter(k => k !== 'isolated'))
    expect(pyTuple(src, 'PAST_FIELDS')).toEqual(Object.keys(SEASON_ROWS().bmo[0].past).filter(k => k !== 'isolated'))
    expect(pyTuple(src, 'COUNT_FIELDS')).toEqual(Object.keys(seasonEnv().data.counts).filter(k => k !== 'isolated'))
  })
})

// ── earnings.callThemes → stock.callThemes ─────────────────────────────────────────────────────────────────────────────
const phrase = (text, calls, share, base, o = {}) => ({
  phrase: text, words: text.split(' ').length, calls, pct: share, companies: calls - 2, base_calls: Math.round(base * 4), base_pct: base, base_raw_pct: base + 0.3,
  rise: Math.round((share - base) * 10) / 10, ratio: base >= 0.05 ? Math.round(share / base * 10) / 10 : null, related: [], examples: ['AAA', 'BBB', 'CCC'], isolated: true, ...o,
})
const themesEnv = (over = {}, envOver = {}) => envelope(KINDS.themes, {
  month: '2026-11', months: ['2026-11', '2026-10'], list: 'both', calls: 300, companies: 290,
  baseline: { months: ['2026-08', '2026-09', '2026-10'], calls: 410, matched_pct: 87.5, isolated: true }, floor: { calls: 8, companies: 6, isolated: true },
  new: [phrase('agentic commerce', 40, 13.3, 0, { related: ['agentic checkout'] }), phrase('sovereign compute', 31, 10.3, 0.4)], rising: [phrase('pricing power', 90, 30, 18.5)],
  qualified: { new: 44, rising: 1, isolated: true }, shown: { new: 2, rising: 1, isolated: true }, built_at: '2026-11-17T11:00:00Z', refreshing: false,
  corpus: { calls: 520, oldest: '2026-08-20', newest: '2026-11-16', isolated: true }, rules: { isolated: true }, ...over,
}, { as_of: '2026-11-16T05:00:00Z', ...envOver })

describe('stock.callThemes — the answer', () => {
  it('both lists as the service ranks them, what each number is set against, no transcript text, and both times', () => {
    const a = honest(answerFromThemes(themesEnv()))
    expect(a.text.split('\n')).toEqual([
      'What was said on earnings calls in Nov 2026: phrases whose share of calls rose the most, across 300 calls from 290 companies, against 410 earlier calls (Aug 2026 to Oct 2026).',
      'New this month (near absent before), most-said first (the first 2 of the 44 that passed; the weakest are left out):',
      '• "agentic commerce": 40 calls (13.3% of the month\'s), 38 companies; said most by AAA, BBB, CCC; with it: agentic checkout',
      '• "sovereign compute": 31 calls (10.3% of the month\'s), 29 companies; said most by AAA, BBB, CCC',
      'Rising (said before, clearly more this month), biggest rise first:',
      '• "pricing power": 30.0% of calls, up from 18.5% (+11.5 points, 1.6 times); 90 calls; said most by AAA, BBB, CCC',
      THEMES_COUNTING,
      "The earlier share is like for like: the earlier calls are weighted to this month's mix of industries (87.5% of this month's calls could be matched).",
      THEMES_NO_TEXT,
      'As of calls through Mon, Nov 16, 2026, the newest call these lists were worked out from.',
      "Worked out by UCT at 6:00 AM ET (UCT's own time), once a day after the call index updates.",
      "Source: UCT's call themes (UCT's own counting over third-party earnings call transcripts). Descriptive only: nothing here is a prediction.",
    ])
    // nothing earlier said it: no ratio, which is not 0 times
    expect(a.facts.lists.new.rows[0]).toMatchObject({ phrase: 'agentic commerce', calls: 40, share: 13.3, earlier_share: 0, times: null, times_text: null })
    expect(a.facts.lists.new.passed).toBe(44)
    expect(a.facts.lists.rising.rows[0]).toMatchObject({ rise_points: 11.5, rise_text: '+11.5 points', times: 1.6, times_text: '1.6 times' })
    expect(a.table.rows.map(r => `${r.list}: ${r.phrase}`)).toEqual(['New: agentic commerce', 'New: sovereign compute', 'Rising: pricing power'])
    expect(a.table.rows[2]).toEqual({ list: 'Rising', phrase: 'pricing power', calls: 90, share: '30.0%', earlier: '18.5%', rise: '+11.5 points', companies: 88, examples: 'AAA, BBB, CCC' })
    expect(a.present.items.map(i => `${i.label}: ${i.value}`)).toEqual(['agentic commerce: 40 calls', 'sovereign compute: 31 calls', 'pricing power: +11.5 points'])
    expect(a.facts).toMatchObject({ month: '2026-11', month_text: 'Nov 2026', list: 'both', calls: 300, companies: 290, earlier_calls: 410, matched_pct: 87.5, newest_call_date: '2026-11-16', stale: false })
    expect(callThemesRead({ ...themesEnv().data, status: 'ok' }).state).toBe('ok')              // the kind's data IS the shape the CEOS panel reads
  })
  it('one list, a list nothing passed, a plain comparison and old lists are each said', () => {
    const one = honest(answerFromThemes(themesEnv({ list: 'rising', new: [], shown: { new: 0, rising: 1 } })))
    expect(one.text.split('\n').slice(1, 3)).toEqual(['Rising (said before, clearly more this month), biggest rise first:', '• "pricing power": 30.0% of calls, up from 18.5% (+11.5 points, 1.6 times); 90 calls; said most by AAA, BBB, CCC'])
    expect(one.text).not.toMatch(/New this month/)
    const none = honest(answerFromThemes(themesEnv({ new: [], rising: [], qualified: { new: 0, rising: 0 }, baseline: { months: ['2026-10'], calls: 120, matched_pct: 0 } }, { stale: true })))
    expect(none.text.split('\n').slice(0, 3)).toEqual([
      'What was said on earnings calls in Nov 2026: phrases whose share of calls rose the most, across 300 calls from 290 companies, against 120 earlier calls (Oct 2026).',
      'New this month (near absent before), most-said first: no phrase passed the rules. That is a finding about the calls UCT holds, not a failed read.',
      'Rising (said before, clearly more this month), biggest rise first: no phrase passed the rules. That is a finding about the calls UCT holds, not a failed read.'])
    expect(none.text).toContain('The earlier share is a plain comparison: no industry weighting could be applied.')
    expect(none.text).toContain('Stale: these lists are older than a day and a half, so calls indexed since then are not in them.')
    expect(none.table).toBeUndefined()
    const undated = honest(answerFromThemes(themesEnv({ built_at: null, corpus: { calls: 520, oldest: null, newest: null } }, { as_of: null, stale: true })))
    expect(undated.text).toContain('The lists do not say which calls they were worked out from, so there is no call date to state.')
    expect(undated.text).not.toMatch(/Worked out by UCT at/)
  })
  it('lists that are not held are never "no phrase rising", and a month asked for is named', () => {
    const u = honest(answerFromThemes(UNAVAILABLE))
    expect(u.text).toMatch(/^I couldn't read the call themes: none are held on the server at the moment .*never starts that work\), or the call index does not hold enough calls to compare\. No figure is stated\. That is not the same as no phrase rising\.$/)
    expect(honest(answerFromThemes(UNAVAILABLE, '2026-09')).text).toMatch(/^I couldn't read the call themes for Sep 2026: there is no list for that month, or none are held on the server at the moment /)
    expect(honest(answerFromThemes(REFUSED)).text).toBe("I couldn't read the call themes: that request wasn't allowed for this question, so nothing was read. No figure is stated. That is not the same as no phrase rising.")
    expect(honest(answerFromThemes(themesEnv({ month: 'November' }))).text).toMatch(/^I couldn't read the call themes: UCT's data did not answer cleanly\./)
  })
  it('the lists, the limits and every field the answer reads are the kind\'s own and the CEOS panel\'s own (read from both files, never retyped)', () => {
    const src = adapter('earnings_call_themes')
    expect(pyTuple(src, 'LISTS')).toEqual(THEME_LIST_KEYS)
    expect(THEME_LIST_KEYS).toEqual(Object.keys(CALL_THEME_LISTS))
    expect(pyInt(src, 'MAX_LIMIT')).toBe(THEMES_MAX_ROWS)
    expect(pyInt(src, 'DEFAULT_LIMIT')).toBe(BOTH_ROWS)
    expect(pyInt(py('api/services/call_themes.py'), 'LIST_CAP')).toBe(THEMES_MAX_ROWS)
    expect(/^ROW_FIELDS = \(([\s\S]+?)\)$/m.exec(src)[1].match(/"\w+"/g).map(s => s.slice(1, -1))).toEqual(Object.keys(phrase('a b', 9, 5, 1)).filter(k => k !== 'isolated'))
    // "a day and a half" is the service's own refresh bound
    expect(/^STALE_REBUILD_S = (\d+) \* 3600$/m.exec(py('api/services/call_themes.py'))[1]).toBe('36')
  })
})

// ── group.drill → stock.groupDrill ─────────────────────────────────────────────────────────────────────────────────────
const grow = (sym, change, rs, flow, o = {}) => ({ sym, pct: change, start_close: 100, end_close: 100 + change, industry: 'Semiconductors', sector: 'Technology', rs, flow: flow ? { ...flow, isolated: true } : null, isolated: true, ...o })
const GROUP_ROWS = () => [grow('AAA', 30, 97, { dir: 'BULL', status: 'BUILDING' }), grow('BBB', 20, 55, null), grow('DDD', 10, null, { dir: 'BEAR', status: 'STEADY' }), grow('EEE', 0, 12, null)]
const COMMON = { range: 'ytd', start_day: '2025-12-31', end_day: '2026-11-16', built_at: '2026-11-17T15:25:00Z', held: 'fresh', partial_history: false }
const groupEnv = (over = {}, envOver = {}) => envelope(KINDS.drill, {
  mode: 'group', ...COMMON, kind: 'sector', name: 'Technology', found: true, group_pct: 15, rows: GROUP_ROWS(), count: 4, shown: 4, known: 4, ranked: 3, on_board: 2,
  sort: 'pct', dir: 'desc', rs_state: 'held', flow_state: 'held', flow_built_at: '2026-11-17T15:10:00Z', ...over,
}, envOver)
const LISTS = () => ({
  sector: [{ name: 'Technology', pct: 15, count: 4, isolated: true }, { name: 'Energy', pct: -5, count: 1, isolated: true }, { name: 'Financial Services', pct: 4, count: 1, isolated: true }],
  industry: [{ name: 'Semiconductors', pct: 20, count: 2, isolated: true }, { name: 'Semiconductor Equipment', pct: 9, count: 3, isolated: true }, { name: 'Software', pct: 10, count: 2, isolated: true },
    { name: 'Energy', pct: -5, count: 1, isolated: true }],
  theme: [{ name: 'AI / GPU Chips', pct: 20, count: 2, isolated: true }],
  isolated: true,
})
const listsEnv = (kind = null) => envelope(KINDS.drill, { mode: 'groups', ...COMMON, kind, lists: kind ? { [kind]: LISTS()[kind], isolated: true } : LISTS(), counts: { isolated: true } })

describe('stock.groupDrill — the answer', () => {
  it('each stock with its change, its RS rank and its place on the board; a stock with neither is said so, never as 0', () => {
    const a = honest(answerFromGroup(groupEnv(), groupModel, { name: 'Technology', range: 'ytd' }))
    expect(a.text.split('\n')).toEqual([
      "Technology (sector), this year (Dec 31, 2025 to Nov 16, 2026): the group's change is +15.00%; 4 stocks ranked.",
      'All 4 stocks, biggest gain first:',
      '• AAA +30.00% ($100.00 to $130.00), RS rank 97, on the confluence board: Bullish, building',
      '• BBB +20.00% ($100.00 to $120.00), RS rank 55',
      '• DDD +10.00% ($100.00 to $110.00), no RS rank, on the confluence board: Bearish, steady',
      '• EEE 0.00% ($100.00 to $100.00), RS rank 12',
      '3 of the 4 have an RS rank.',
      '2 of the 4 are on the confluence board.',
      GROUP_PCT_MEANING,
      RS_MEANING,
      FLOW_MEANING,
      'A change is measured between the closes of Wed, Dec 31, 2025 and Mon, Nov 16, 2026.',
      "The ranking was built by UCT at 10:25 AM ET (UCT's own time).",
      "Source: UCT's period ranking, RS ranking and confluence board (UCT's own ranking and grouping). Descriptive only: nothing here is a prediction. It is not a recommendation.",
    ])
    expect(a.facts.rows[2]).toMatchObject({ symbol: 'DDD', rs: null, flow: { direction: 'bearish', status: 'steady' }, flow_text: 'Bearish, steady' })
    expect(a.facts.rows[3]).toMatchObject({ symbol: 'EEE', change_pct: 0, change_text: '0.00%', rs: 12, flow: null, flow_text: null })      // a real 0.00%, and no flow
    expect(a.table.rows[2]).toEqual({ symbol: 'DDD', change: '+10.00%', closes: '$100.00 to $110.00', rs: 'none', flow: 'Bearish, steady', industry: 'Semiconductors' })
    expect(a.table.rows[3]).toMatchObject({ rs: 12, flow: 'not on it' })
    expect(a.present.items.map(i => `${i.label} ${i.value}`)).toEqual(['AAA +30.00%', 'BBB +20.00%', 'DDD +10.00%', 'EEE 0.00%'])
    expect(a.facts).toMatchObject({ kind: 'sector', name: 'Technology', range: 'ytd', group_change_pct: 15, count: 4, shown: 4, with_rs: 3, on_board: 2, sort: 'pct', dir: 'desc', stale: false })
  })
  it('a cut, an order, a theme and what is not held are each said; RS and flow that are not held are never "none"', () => {
    const cut = honest(answerFromGroup(groupEnv({ kind: 'theme', name: 'AI / GPU Chips', range: 'm3', rows: GROUP_ROWS().slice(0, 2), count: 40, shown: 2, ranked: 31, on_board: 1, sort: 'rs', dir: 'asc' }), groupModel))
    expect(cut.text.split('\n').slice(0, 2)).toEqual(["AI / GPU Chips (UCT theme), the last 3 months (Dec 31, 2025 to Nov 16, 2026): the group's change is +15.00%; 40 stocks ranked.", 'The first 2 of the 40, lowest RS rank first:'])
    expect(cut.text).toContain('31 of the 40 have an RS rank.')
    expect(cut.text).toContain('1 of the 40 is on the confluence board.')
    const blank = GROUP_ROWS().map(r => ({ ...r, rs: null, flow: null }))
    const cold = honest(answerFromGroup(groupEnv({ rows: blank, ranked: 0, on_board: 0, rs_state: 'not_held', flow_state: 'not_held', held: 'last_good' }, { status: 'partial', stale: true }), groupModel))
    expect(cold.text).toContain('• AAA +30.00% ($100.00 to $130.00)\n')                                // no "no RS rank" for a ranking that was not read
    expect(cold.text).toContain('The RS ranking is not held on the server at the moment, and this answer never starts that work, so no RS rank is stated. That is not the same as no rank.')
    expect(cold.text).toContain('The confluence board is not held on the server at the moment, and this answer never starts that work, so no flow signal is stated. That is not the same as no stock being on the board.')
    expect(cold.text).toContain('Stale: this is the last good ranking for the range, so it may be behind the market.')
    expect(cold.text).not.toContain(RS_MEANING)
    expect(cold.text).not.toMatch(/no RS rank,|of the 4 have an RS rank|on the confluence board\./)
    expect(cold.table.rows[0]).toMatchObject({ rs: 'not held', flow: 'not held' })
    const stored = honest(answerFromGroup(groupEnv({ rs_state: 'last_stored', built_at: null, start_day: null }, { stale: true }), groupModel))
    expect(stored.text).toContain('3 of the 4 have an RS rank (from the last ranking the server stored, so the ranks may be behind).')
    expect(stored.text).toContain('The ranking does not say which two days it measures between.')
    expect(stored.text).toContain('The ranking carries no build time, so I cannot say how old it is.')
  })
  it('a ranking that is not held, and a name the ranking does not list, are never "no stocks"', () => {
    const u = honest(answerFromGroup(UNAVAILABLE, groupModel, { name: 'Technology', range: 'm6' }))
    expect(u.text).toMatch(/^I couldn't read the stocks of Technology: the ranking for the last 6 months is not held on the server at the moment .*never starts that work\)\. .*No figure is stated, and that is not the same as the group having no stocks\.$/)
    expect(honest(answerFromGroup(REFUSED, groupModel, { name: 'Technology' })).text).toBe("I couldn't read the stocks of Technology: that request wasn't allowed for this question, so nothing was read. No figure is stated, and that is not the same as the group having no stocks.")
    const gone = honest(answerFromGroup(groupEnv({ found: false, rows: [], count: 0, group_pct: null, name: 'Tecnology' }), groupModel))
    expect(gone.text).toBe('The ranking for this year holds no sector called Tecnology. No figure is stated, and that is not the same as the group having no stocks.')
  })
  it('a name is resolved by the GRP panel\'s own resolver over the kind\'s lists: one group, which one, or the nearest names', () => {
    const lists = groupLists(listsEnv())
    expect(Object.keys(lists)).toEqual(GROUP_KIND_KEYS)               // the gateway's own stamp is never read as a kind
    expect(lists.sector[0]).toEqual({ name: 'Technology', pct: 15, count: 4, members: [] })
    const resolve = (text, kind = null) => { let q = groupModel.parseGroupQuery(text); if (!q.kind && kind) q = { ...q, kind }; return groupModel.resolveGroup(lists, q) }
    expect(resolve('technology').group).toMatchObject({ kind: 'sector', name: 'Technology' })
    expect(resolve('XLK').group).toMatchObject({ kind: 'sector', name: 'Technology', fund: 'XLK' })        // a sector fund's ticker is its sector
    expect(resolve('ai gpu chips').group).toMatchObject({ kind: 'theme', name: 'AI / GPU Chips' })
    expect(resolve('soft').group).toMatchObject({ kind: 'industry', name: 'Software' })                     // a prefix only ONE group starts with
    expect(groupAsk(resolve('technology'), groupModel, 'this year')).toBeNull()
    const energy = resolve('energy')                                   // exact in two kinds: the first, and the other is said
    expect(energy.group).toMatchObject({ kind: 'sector', name: 'Energy' })
    expect(energy.also).toEqual([{ kind: 'industry', name: 'Energy', fund: null }])
    expect(resolve('energy', 'industry').group).toMatchObject({ kind: 'industry', name: 'Energy' })
    expect(honest({ text: groupAsk(resolve('semi'), groupModel, 'this year') }).text.split('\n')).toEqual([
      '"SEMI" fits 2 ranked groups over this year. Which one?', '• Semiconductor Equipment (industry)', '• Semiconductors (industry)', 'No figure is stated.'])
    expect(honest({ text: groupAsk(resolve('gpu'), groupModel, 'the last month') }).text.split('\n')).toEqual([
      'I found no sector, industry or UCT theme called "GPU" in the ranking for the last month.', 'The nearest names: AI / GPU Chips (UCT theme).',
      'A UCT theme with no ranked stock is not listed, so this is not proof that no such theme exists.', 'No figure is stated.'])
    expect(groupAsk(resolve('zzzzqq'), groupModel, 'this year')).not.toMatch(/nearest names/)
    expect(groupAsk({ status: 'empty' }, groupModel, 'this year')).toMatch(/^Which sector, industry or UCT theme should I open\?/)
  })
  it('a kind word said LAST is read as the kind (the panel\'s parser reads it first), and only when the words as said fit nothing', () => {
    const lists = { ...groupLists(listsEnv()), theme: [...groupLists(listsEnv()).theme, { name: 'Space Sector', pct: 3, count: 2, members: [] }] }
    expect(kindFirst('the technology sector', groupModel)).toBe('sector technology')
    expect(kindFirst('energy industry', groupModel)).toBe('industry energy')
    expect(kindFirst('semiconductors group', groupModel)).toBe('semiconductors')
    expect(kindFirst('sector technology', groupModel)).toBe('sector technology')      // already first
    expect(kindFirst('technology', groupModel)).toBe('technology')
    expect(resolveAsked(lists, 'the technology sector', null, groupModel).group).toMatchObject({ kind: 'sector', name: 'Technology' })
    expect(resolveAsked(lists, 'energy industry', null, groupModel).group).toMatchObject({ kind: 'industry', name: 'Energy' })      // the kind said, not the first kind
    expect(resolveAsked(lists, 'space sector', null, groupModel).group).toMatchObject({ kind: 'theme', name: 'Space Sector' })      // a name that fits as said is that name
    expect(resolveAsked(lists, 'energy', 'industry', groupModel).group).toMatchObject({ kind: 'industry', name: 'Energy' })         // the planner's kind pins it
    expect(resolveAsked(lists, 'biotech sector', null, groupModel)).toMatchObject({ status: 'unknown', query: 'BIOTECH SECTOR' })   // nothing fits either way: asked back as said
  })
  it('the kinds, the ranges, the orders and the limits are the kind\'s own and the GRP panel\'s own (read from both files, never retyped)', () => {
    const src = adapter('group_drill')
    expect(pyTuple(src, 'GROUP_KINDS')).toEqual(GROUP_KIND_KEYS)
    expect(GROUP_KIND_KEYS).toEqual([...groupModel.GROUP_KIND_ORDER])
    expect(pyTuple(src, 'RANGES')).toEqual(GROUP_RANGE_KEYS)
    expect(GROUP_RANGE_KEYS).toEqual(Object.keys(PERIOD_RANGES))
    expect(/^DEFAULT_RANGE = "(\w+)"/m.exec(src)[1]).toBe(DEFAULT_PERIOD_RANGE)
    expect(pyTuple(src, 'SORTS')).toEqual(GROUP_SORT_KEYS)
    expect(GROUP_SORT_KEYS).toEqual(Object.keys(groupModel.GROUP_SORTS))
    expect(pyTuple(src, 'DIRS')).toEqual(GROUP_DIR_KEYS)
    expect(pyInt(src, 'MAX_LIMIT')).toBe(GROUP_MAX_ROWS)
    expect(pyTuple(src, 'ROW_FIELDS')).toEqual(Object.keys(grow('AAA', 1, 1, null)).filter(k => k !== 'isolated'))
    expect(pyTuple(src, 'FLOW_FIELDS')).toEqual(Object.keys(GROUP_ROWS()[0].flow).filter(k => k !== 'isolated'))
    expect(pyTuple(src, 'GROUP_FIELDS')).toEqual(Object.keys(LISTS().sector[0]).filter(k => k !== 'isolated'))
    for (const status of ['BUILDING', 'STEADY', 'ESTABLISHED']) expect(py('api/confluence_screen.py'), status).toContain(`status = "${status}"`)
  })
})

// ── served vs dark, isolation on both sides, the manifest limits, the reads each answer makes ──────────────────────────
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
const reset = () => { _resetAgentConfig(); _resetTurns(); _resetTerminalDataForTest(); _resetTerminalLocalForTest(); _resetTerminalWave2ForTest(); _resetTerminalWave3ForTest(); _resetTerminalWave4ForTest() }
const GROUP_ARGS = (o = {}) => ({ group: 'technology', kind: null, range: null, sort: null, dir: null, limit: null, ...o })

describe('served vs dark', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'themes', 'earnings', 'earnings.reactions', 'earnings.callSearch', 'confluence.board'], 'other kinds only']])('dark (%j, %s): none of the three is registered', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    expect(registerTerminalWave4Capabilities()).toEqual([])
    registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames(), n).not.toContain(n)
  })

  it.each(PAIRS)('served %s alone: only %s is registered, once, and it unregisters cleanly', async (kind, capability) => {
    wire([kind])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([capability])
    expect(registerTerminalWave4Capabilities()).toEqual([])            // idempotent
    reset()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([])
  })

  it('all three served: local-only on BOTH sides, never a plain data read, inside the manifest text limits', async () => {
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
      expect(handshake.isolated_kinds, kind).toContain(kind)          // every kind of this wave is model-isolated
      expect(handshake.local_only_actions, name).toContain(name)      // turn.LOCAL_ONLY_ACTIONS, via the generated handshake
      expect(dataReads.includes(`"${name}"`), name).toBe(false)       // the two server sets are disjoint
    }
  })

  it('the season and the themes answers make ONE read of their own kind, with the member\'s arguments', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KINDS.season] = seasonEnv()
    ENVS[KINDS.themes] = themesEnv()
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    expect((await run(CAPABILITIES.season, { date: '2026-11-17', session: 'amc', limit: 500 })).text).toMatch(/^Earnings season for Tue, Nov 17, 2026/)
    expect((await run(CAPABILITIES.season, { date: null, session: null, limit: null })).text).toMatch(/^Earnings season for/)
    expect((await run(CAPABILITIES.themes, { month: '2026-9', list: 'rising', limit: 500 })).text).toMatch(/^What was said on earnings calls in Nov 2026/)
    expect((await run(CAPABILITIES.themes, { month: null, list: null, limit: null })).text).toMatch(/^What was said on earnings calls/)
    expect(reads().map(r => [r.kind, r.params, r.purpose])).toEqual([
      [KINDS.season, { session: 'amc', limit: 50, date: '2026-11-17' }, 'answer'],
      [KINDS.season, { session: 'all', limit: 25 }, 'answer'],
      [KINDS.themes, { list: 'rising', limit: 30, month: '2026-09' }, 'answer'],
      [KINDS.themes, { list: 'both', limit: 10 }, 'answer'],
    ])
  })

  it('a group makes TWO reads of its one kind: the names, then the group the panel\'s resolver settled on by its exact name', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KINDS.drill] = (p) => (p.group ? groupEnv({ kind: p.kind, name: p.group, range: p.range, sort: p.sort, dir: p.dir }) : listsEnv(p.kind || null))
    const run = (args) => inTurn(() => getCapability(CAPABILITIES.drill).answer(null, args, null))
    expect((await run(GROUP_ARGS())).text).toMatch(/^Technology \(sector\), this year /)
    expect((await run(GROUP_ARGS({ group: 'xlk', range: 'm3', sort: 'rs', dir: 'asc', limit: 500 }))).text).toMatch(/^Technology \(sector\), the last 3 months /)
    expect((await run(GROUP_ARGS({ group: 'ai gpu chips', kind: 'theme' }))).text).toMatch(/^AI \/ GPU Chips \(UCT theme\), this year /)
    expect((await run(GROUP_ARGS({ group: 'the software industry' }))).text).toMatch(/^Software \(industry\), this year /)     // the kind word said last
    const both = await run(GROUP_ARGS({ group: 'Energy' }))           // exact in two kinds: the first is opened and the other is said
    expect(both.text).toMatch(/^Energy \(sector\), this year /)
    expect(both.text.split('\n').pop()).toBe('The same name is also Energy (industry): name the kind to open that one.')
    expect(reads().map(r => [r.kind, r.params, r.purpose])).toEqual([
      [KINDS.drill, { range: 'ytd' }, 'answer'],
      [KINDS.drill, { range: 'ytd', kind: 'sector', group: 'Technology', sort: 'pct', dir: 'desc', limit: 25 }, 'answer'],
      [KINDS.drill, { range: 'm3', kind: 'sector' }, 'answer'],                     // a sector fund's ticker pins the kind
      [KINDS.drill, { range: 'm3', kind: 'sector', group: 'Technology', sort: 'rs', dir: 'asc', limit: 50 }, 'answer'],
      [KINDS.drill, { range: 'ytd', kind: 'theme' }, 'answer'],
      [KINDS.drill, { range: 'ytd', kind: 'theme', group: 'AI / GPU Chips', sort: 'pct', dir: 'desc', limit: 25 }, 'answer'],
      [KINDS.drill, { range: 'ytd' }, 'answer'],
      [KINDS.drill, { range: 'ytd', kind: 'industry', group: 'Software', sort: 'pct', dir: 'desc', limit: 25 }, 'answer'],
      [KINDS.drill, { range: 'ytd' }, 'answer'],
      [KINDS.drill, { range: 'ytd', kind: 'sector', group: 'Energy', sort: 'pct', dir: 'desc', limit: 25 }, 'answer'],
    ])
  })

  it('a name the lists do not settle is asked back after ONE read, and a ranking that is not held is said after one', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KINDS.drill] = (p) => (p.group ? groupEnv() : listsEnv(p.kind || null))
    const run = (args) => inTurn(() => getCapability(CAPABILITIES.drill).answer(null, args, null))
    expect((await run(GROUP_ARGS({ group: 'semi' }))).text).toMatch(/^"SEMI" fits 2 ranked groups over this year\. Which one\?/)
    expect((await run(GROUP_ARGS({ group: 'biotech' }))).text).toMatch(/^I found no sector, industry or UCT theme called "BIOTECH" in the ranking for this year\./)
    expect(reads()).toHaveLength(2)
    ENVS[KINDS.drill] = UNAVAILABLE
    const cold = honest(await run(GROUP_ARGS({ range: 'm1' })))
    expect(cold.text).toMatch(/^I couldn't read the groups ranked over the last month: the ranking for the last month is not held on the server at the moment /)
    expect(reads()).toHaveLength(3)
  })

  it('no read without a turn or without a usable argument, and a refusal is answered in fixed words', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    for (const [name, args] of [[CAPABILITIES.season, { date: null, session: null, limit: null }], [CAPABILITIES.themes, { month: null, list: null, limit: null }], [CAPABILITIES.drill, GROUP_ARGS()]]) {
      expect((await getCapability(name).answer(null, args, null)).text, name).toMatch(/needs the Agent's turn/)
    }
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    expect((await run(CAPABILITIES.season, { date: 'tomorrow', session: null, limit: null })).text).toMatch(/^Which day's earnings season should I read\? Give me the date as YYYY-MM-DD\./)
    expect((await run(CAPABILITIES.season, { date: '2026-11-21', session: null, limit: null })).text).toMatch(/^Sat, Nov 21, 2026 is a weekend day/)
    expect((await run(CAPABILITIES.themes, { month: 'november', list: null, limit: null })).text).toMatch(/^Which month's call themes should I read\? Give me the month as YYYY-MM\./)
    expect((await run(CAPABILITIES.drill, GROUP_ARGS({ group: '' }))).text).toMatch(/^Which sector, industry or UCT theme should I open\?/)
    expect((await run(CAPABILITIES.drill, GROUP_ARGS({ group: 'sectors' }))).text).toMatch(/^Which sector, industry or UCT theme should I open\?/)     // a kind word alone names no group
    expect(reads()).toEqual([])
    const a = await run(CAPABILITIES.themes, { month: null, list: null, limit: null })   // the stub refuses
    expect(a.text).toMatch(/^I couldn't read the call themes: that request wasn't allowed for this question/)
    expect(reads()).toHaveLength(1)
  })
})

// ── routing: the wave's own words-only group, armed only while a capability is registered ───────────────────────────────
const ownGroup = () => GROUPS.find(g => g.id === ROUTE_GROUP)
const groupWords = (id) => GROUPS.find(g => g.id === id).words
const DATA_BASE = [...groupWords('data')]              // read before anything is served: routing.js's own list
const ROUTE_OPTS = () => ({ enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold })
const namedBy = (words) => (text) => Object.keys(words).filter(k => words[k].some(re => re.test(String(text).toLowerCase())))
const wordKeys = namedBy(WAVE4_ROUTE_WORDS)
/** plain member asks, by the capability whose words must name them */
const ASKS = {
  season: ['earnings season today', 'show me the earnings season for tomorrow', 'what does earnings season look like tonight', "priced moves for tonight's reporters", "what are the priced moves for tomorrow's earnings"],
  themes: ['what are CEOs saying', 'what are executives talking about this quarter', 'call themes this month', 'rising phrases on earnings calls', 'new themes on earnings calls', 'trending topics on earnings calls'],
  drill: ['stocks in the semiconductors industry', 'drill into XLK', 'what is in the AI theme', 'members of the technology sector', 'drill down on the energy sector this quarter', "what's in the software industry"],
}
/** another capability's language: none of the three's words may name these */
const NOT_OURS = [
  'who reports today', 'who is reporting this week', 'what reports on Thursday', 'open the earnings calendar', 'who reports tonight',                 // calendar.day
  'expected move for NVDA earnings', 'what are options pricing in for AAPL', 'implied move on TSLA',                                                   // stock.expectedMove
  'earnings reactions for yesterday', "how did yesterday's reporters move", 'post-earnings moves from thursday',                                      // stock.earningsReactions
  'when does NVDA report earnings', 'NVDA earnings history', 'how does NVDA trade after earnings',                                                    // stock.earnings, history.afterEvent
  'scan for stocks reporting this earnings season', 'alert me during earnings season', 'open the earnings season page',                               // the Screener, alerts, navigation
  'which companies mentioned tariffs on their earnings call', 'search earnings calls for pricing power', 'who said agentic on a call',                // stock.callSearch
  'which themes are rotating in', 'top themes this month', 'what are the rising themes', 'change the app theme to dark',                              // stock.themes, stock.themeRotation, settings
  'buy 5 calls on NVDA', 'new call options on TSLA', 'add a call option to the chart',                                                                // an option "call"
  'find stocks in the technology sector', 'scan for names in the semiconductor industry', 'screen for stocks in the energy sector above their 50 day', // the Screener
  'stocks in my watchlist', 'what is in my Momentum list', 'add the stocks in the tech sector to a watchlist',                                        // watchlists
  'how are the sectors doing', 'sector performance this month', 'which sector is leading', 'what is a sector',                                        // stock.sectorPerformance, the guide
  'compare the technology sector with energy', 'chart the semiconductors industry', 'drill into my journal',                                          // compare, charts, the journal
  'gamma levels for NVDA', 'show me the top flow picks', "what is the flow record's win rate", 'dark pool levels on NVDA',                            // waves 1 to 3
  'any news on TSLA', 'switch to weekly', 'what got upgraded today', 'which stocks made new 52-week highs',
]
/** asks the earlier waves' words name (their own tests hold the full lists): this wave's words must not */
const EARLIER_ASKS = ['what got upgraded today', 'new highs today', 'top gainers over 60 days', 'dark pool levels on NVDA', 'which stocks made new 52-week highs', 'which themes are rotating in',
  'what is on the confluence board', 'expected move for NVDA earnings', 'what are options pricing in for AAPL', 'which companies mentioned tariffs on their earnings call', 'search earnings calls for pricing power',
  'gamma levels for NVDA', 'show me the top flow picks', "what is the flow record's win rate", 'earnings reactions for yesterday', "how did yesterday's reporters move"]

describe('routing words', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the group is words-only and never a filler, and routing.js lists the three by action with no word of its own', () => {
    const g = ownGroup()
    expect(g.wordsOnly && g.fillLast).toBe(true)
    expect(g.words).toEqual([])                                      // server-armed: empty until a capability registers
    expect([...g.actions].sort()).toEqual([...ALL].sort())
    expect(g.domains).toEqual([])
    expect(g.title.length).toBeLessThanOrEqual(160)                  // the server cuts a group title at 160 characters (turn.py validate_routing)
    // the server keeps only MAX_GROUPS groups: this wave's is the 46th, straight after wave 3's (the cap was 48 when this
    // wave was built; wave 7's build raised it to 56 on 2026-11-20, pinned in agentTerminalDataWave7.test.js)
    const max = Number(/^MAX_GROUPS\s*=\s*(\d+)\s*$/m.exec(py('api/services/uct_agent/turn.py'))[1])
    const ids = GROUPS.map(x => x.id)
    expect([ids.indexOf(ROUTE_GROUP) + 1, max]).toEqual([46, 56])
    expect(GROUPS.length).toBeLessThanOrEqual(max)
    expect(ids.slice(44, 46)).toEqual([WAVE3_GROUP, ROUTE_GROUP])
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'themes', 'earnings', 'sectors.performance', 'earnings.reactions'], 'other kinds only']])('dark (%j, %s): the group has no words, and the data group keeps exactly routing.js\'s', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(ownGroup().words).toEqual([])
    expect(groupWords('data')).toEqual(DATA_BASE)
    for (const asks of Object.values(ASKS)) for (const q of asks) expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
  })

  it.each(KEYS)('served %s alone: only its own words are armed, the data group\'s and wave 3\'s words never change, and they are taken back', async (key) => {
    wire([KINDS[key]])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(ownGroup().words).toEqual(WAVE4_ROUTE_WORDS[key])
    expect(groupWords('data')).toEqual(DATA_BASE)
    expect(groupWords(WAVE3_GROUP)).toEqual([])
    registerTerminalWave4Capabilities()                                // idempotent: never armed twice
    expect(ownGroup().words).toHaveLength(WAVE4_ROUTE_WORDS[key].length)
    reset()
    expect(ownGroup().words).toEqual([])
  })

  it('every capability has words, and each ask is named by its own capability\'s words and by no other of this wave', () => {
    expect(Object.keys(WAVE4_ROUTE_WORDS).sort()).toEqual([...KEYS].sort())
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

  it('served: the words never name another capability\'s language, and v2 does not send the group for it either', async () => {
    for (const q of NOT_OURS) expect(wordKeys(q), q).toEqual([])
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    for (const q of NOT_OURS) expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
  })

  it('served: the fill for a message nothing recognised never carries the words-only group', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const q of ['flip to AMD', 'lose the gridlines', 'any articles on RIVN lately', 'show me the leaders', 'both', 'hmm']) {
      for (const route of [routeManifest, routeManifestV2]) {
        const names = route(full, q, ROUTE_OPTS()).manifest.map(c => c.name)
        for (const n of ALL) expect(names, `${route.name}: ${q}`).not.toContain(n)
      }
    }
  })

  it('the typo lexicon: registering the three changes no correction of any OTHER capability\'s capreg corpus phrasing', async () => {
    // A summary's and a hint's lowercase words join the typo lexicon (nl/lexicon.js). This wave's own phrasings are left out:
    // their words ("reporters", "phrases") become known words when the capability registers, which is the point.
    wire([])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const texts = [...new Set(allPhrasings().filter(p => !ALL.includes(p.intent.id)).map(p => p.ph.text)), 'walk me through the setup on NVDA', 'wipe the Momentum list', 'sort ascending by change', 'ascending order',
      'show me the leeders', 'chnage the theme', 'pharse that again', 'sector fund returns for the past month', 'how did the reporters do']
    const read = () => { const lex = lexiconFor(null); return texts.map(t => JSON.stringify((correctTypos(t, lex) || []).map(v => v.text))) }
    const before = read()
    _resetAgentConfig(); wire(PAIRS.map(p => p[0])); await loadAgentConfig(); registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames()).toContain(n)
    const after = read()
    expect(texts.length).toBeGreaterThan(500)
    expect(texts.filter((t, i) => before[i] !== after[i])).toEqual([])
  })

  it('no OTHER capability\'s capreg corpus phrasing is named by these words (armed, the group rides with none of them)', () => {
    // every corpus phrasing but this wave's own: production's and the dark ones (the corpus runs them with every kind on)
    const others = [...new Set(allPhrasings().filter(p => !ALL.includes(p.intent.id)).map(p => p.ph.text))]
    expect(others.length).toBeGreaterThan(500)
    expect(others.filter(t => wordKeys(t).length)).toEqual([])
  })

  it('the earlier waves\' words: none names a season or a group ask, and only the call search\'s "earnings calls" names a themes ask', () => {
    const wave1 = namedBy(TERMINAL_ROUTE_WORDS)
    const wave2 = namedBy(WAVE2_ROUTE_WORDS)
    const wave3 = namedBy(WAVE3_ROUTE_WORDS)
    for (const key of ['season', 'drill']) for (const q of ASKS[key]) expect([...wave1(q), ...wave2(q), ...wave3(q)], q).toEqual([])
    for (const q of ASKS.themes) {
      expect([...wave1(q), ...wave3(q)], q).toEqual([])
      // routing only ADDS a group: "earnings calls" also brings the data group, where the planner tells a search from a ranking
      expect(wave2(q).filter(k => k !== 'callSearch'), q).toEqual([])
    }
    for (const q of EARLIER_ASKS) {
      expect([...wave1(q), ...wave2(q), ...wave3(q)].length, q).toBeGreaterThan(0)   // non-vacuity: an earlier wave really names it
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
