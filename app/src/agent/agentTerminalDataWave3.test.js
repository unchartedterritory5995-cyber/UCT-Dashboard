// Terminal data wave 3 — the four local-only capabilities over `levels.gamma`, `flow.topPicks`, `flow.record` and
// `earnings.reactions`: the member's answer (the data's own time or why there is none; never live / now; levels that are not
// held, a record that could not be read and a day that is not held each said in their own words, never as "nothing"; a pick
// with too few daily prices "too new to score", never 0%; where the flow numbers come from; an envelope's notes never
// echoed), served vs dark (each registers only while the server lists ITS kind), local-only on both sides, the manifest text
// limits, one read per answer, and the cross-file facts read from the other file (never retyped).
// Routing: the four have their OWN words-only group (`marketBoards`; the data group has no room under the routing budget).
// Each capability's own words are on that group only while it is registered (a dark server's routing is routing.js's own, and
// the data group's words never change), every plain ask reaches its capability under v1 and v2, the group never rides the
// fill, and the words stay off other capabilities' language (the chart's GEX Walls indicator, the Options Flow page, the
// journal's win rate, the calendar's "who reports").
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
import { LEVEL_KINDS, REGIME_TEXT, gexRead } from '../pages/terminal/panels/levelsModel'
import { TOP_FLOW_SORTS, MIN_HISTORY_SNAPSHOTS, OI_RISE_FACTOR } from '../pages/terminal/panels/topFlowModel'
import * as reactionsModel from '../pages/terminal/panels/earningsReactionsModel'
import { LIVE_WORDS } from './capabilities/terminalDataFormat'
import { _resetTerminalDataForTest } from './capabilities/terminalData'
import { _resetTerminalLocalForTest, TERMINAL_ROUTE_WORDS } from './capabilities/terminalDataLocal'
import { _resetTerminalWave2ForTest, WAVE2_ROUTE_WORDS } from './capabilities/terminalDataWave2'
import {
  KINDS, CAPABILITIES, ZERO_GAMMA_CAVEAT, GAIN_MEANING, FLOW_SOURCES, OI_ROSE, RECORD_RULE, MOVE_MEANING_PAST, MOVE_MEANING_TODAY, gain1,
  PICK_STATUS_KEYS, PICK_DIRECTION_KEYS, PICK_SORT_KEYS, PICKS_MAX_ROWS, REACTIONS_MAX_ROWS,
  answerFromGamma, answerFromTopPicks, answerFromRecord, answerFromReactions,
  registerTerminalWave3Capabilities, _resetTerminalWave3ForTest, WAVE3_ROUTE_WORDS, ROUTE_GROUP,
} from './capabilities/terminalDataWave3'

registerBuiltins()

const REPO = path.resolve(__dirname, '..', '..', '..')
const py = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const adapter = (name) => py(`api/services/uct_agent/marketdata/${name}.py`)
const pyInt = (src, name) => Number(new RegExp(`^${name} = (\\d+)\\b`, 'm').exec(src)[1])
const pyTuple = (src, name) => new RegExp(`^${name} = \\(([^)]+)\\)`, 'm').exec(src)[1].match(/"[^"]+"/g).map(s => s.slice(1, -1))
const pyDictKeys = (src, name) => new RegExp(`^${name} = \\{(.+)\\}$`, 'm').exec(src)[1].match(/"(\w+)":/g).map(s => s.slice(1, -2))
const FETCHED = '2026-11-13T15:30:00Z'               // 10:30 AM ET
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

// ── levels.gamma → stock.gammaLevels ───────────────────────────────────────────────────────────────────────────────────
const lv = (kind, price) => ({ kind, price, isolated: true })
const gammaEnv = (over = {}, envOver = {}) => envelope(KINDS.gamma, {
  sym: 'AAA', levels: [lv('putWall', 95), lv('callWall', 105), lv('zeroGamma', 98.5)], spot: 100, regime: 'choppy', version: 'gxw-v1', asOf: 1794583200,
  computed_at: '2026-11-13T15:20:00Z', held: 'fresh', chain_source: 'massive', band_pct: 15, kept_minutes: 10, last_good_minutes: 30, ...over,
}, envOver)

describe('stock.gammaLevels — the answer', () => {
  it('the three levels highest first by the LVL panel\'s own helper, each with its distance, and UCT\'s own build time', () => {
    const a = honest(answerFromGamma(gammaEnv(), 'AAA'))
    expect(a.text.split('\n')).toEqual([
      'AAA gamma levels from options expiring within a week, against a stock price of $100.00: 3 levels, highest first.',
      '• Call wall $105.00 (5.00% above that price)',
      '• Zero gamma $98.50 (1.50% below that price)',
      '• Put wall $95.00 (5.00% below that price)',
      `Call wall: ${LEVEL_KINDS.callWall.meaning}`,
      `Put wall: ${LEVEL_KINDS.putWall.meaning}`,
      `Zero gamma: ${LEVEL_KINDS.zeroGamma.meaning}`,
      REGIME_TEXT.choppy,
      ZERO_GAMMA_CAVEAT,
      "Worked out by UCT at 10:20 AM ET from Massive's option chain (UCT's own time, not an exchange timestamp). The stock price is the one that option chain carried, not a quote of the moment.",
      "Source: UCT's gamma levels (UCT's own arithmetic on an option chain). Descriptive only: nothing here is a prediction.",
    ])
    expect(a.table.rows).toEqual([{ level: 'Call wall', price: '$105.00', distance: '5.00% above that price' }, { level: 'Zero gamma', price: '$98.50', distance: '1.50% below that price' },
      { level: 'Put wall', price: '$95.00', distance: '5.00% below that price' }])
    expect(a.present.items.map(i => `${i.label} ${i.value}`)).toEqual(['Call wall $105.00', 'Zero gamma $98.50', 'Put wall $95.00'])
    expect(a.link).toEqual({ href: '/research/AAA', label: 'Open AAA in Research' })
    expect(a.facts).toMatchObject({ symbol: 'AAA', spot: 100, regime: 'choppy', levels: 3, held: 'fresh', stale: false, chain_source: 'massive' })
    expect(gexRead(gammaEnv().data).state).toBe('ok')                 // the kind's data IS the shape the LVL panel reads
  })
  it('a last good copy is said to be stale; Massive\'s chain is named and no other; no build time and no chain are said plainly', () => {
    const s = honest(answerFromGamma(gammaEnv({ held: 'last_good', chain_source: 'massive' }, { stale: true }), 'AAA'))
    expect(s.text).toContain("from Massive's option chain")
    // Schwab's chain was retired on 2026-11-17. A payload that still said so (an older server) is not named as a chain.
    const old = honest(answerFromGamma(gammaEnv({ chain_source: 'schwab' }), 'AAA'))
    expect(old.facts.chain_source).toBeNull()
    expect(old.text).not.toMatch(/Schwab/)
    expect(old.text).toContain("Worked out by UCT at ")
    expect(s.text).toContain('Stale: these are the last good levels, older than the 10 minutes they are normally kept, so they may be behind the option market.')
    const n = honest(answerFromGamma(gammaEnv({ computed_at: null, asOf: null, chain_source: null }, { stale: true }), 'AAA'))
    expect(n.text).toContain('The levels carry no build time, so I cannot say how old they are.')
    expect(n.text).not.toMatch(/option chain \(UCT's own time|Stale:/)
    const one = honest(answerFromGamma(gammaEnv({ levels: [lv('callWall', 100.02)], regime: 'unbound' }), 'AAA'))
    expect(one.text.split('\n').slice(0, 2)).toEqual(['AAA gamma levels from options expiring within a week, against a stock price of $100.00: 1 level, highest first.', '• Call wall $100.02 (at that price)'])
    expect(one.text).not.toContain(ZERO_GAMMA_CAVEAT)                 // said only when a zero gamma level is given
    expect(one.text).toContain(REGIME_TEXT.unbound)
  })
  it('no level inside the band is a normal answer; levels that are not held are never "no levels"', () => {
    const e = honest(answerFromGamma(gammaEnv({ levels: [] }), 'AAA'))
    expect(e.text.split('\n')[0]).toBe('AAA has no gamma level within 15% of its stock price ($100.00), from options expiring within a week. That is a normal answer, not a failed read.')
    expect(e.table).toBeUndefined()
    const u = honest(answerFromGamma(UNAVAILABLE, 'AAA'))
    expect(u.text).toMatch(/^I couldn't read AAA's gamma levels: none are held on the server at the moment .*never starts an option chain read.*No level is stated, and that is not the same as no levels\.$/)
    expect(u.text).not.toMatch(/has no gamma level/)
    expect(honest(answerFromGamma(REFUSED, 'AAA')).text).toBe("I couldn't read AAA's gamma levels: that request wasn't allowed for this question, so nothing was read. No level is stated, and that is not the same as no levels.")
    expect(honest(answerFromGamma(gammaEnv({ spot: 0, levels: [] }), 'AAA')).text).toMatch(/^I couldn't read AAA's gamma levels: UCT's data did not answer cleanly\./)
  })
  it('the level kinds, the regimes and the chains are the kind\'s own and the LVL panel\'s own (read from both files, never retyped)', () => {
    const src = adapter('gamma_levels')
    expect(pyTuple(src, 'LEVEL_KINDS')).toEqual(Object.keys(LEVEL_KINDS).filter(k => k !== 'darkPool'))
    expect(pyTuple(src, 'REGIMES')).toEqual(Object.keys(REGIME_TEXT))
    expect([...new Set(/^CHAIN_OF_MODE = \{(.+)\}$/m.exec(src)[1].match(/: "(\w+)"/g).map(s => s.slice(3, -1)))].sort()).toEqual(['massive'])        // one chain since Schwab was retired (2026-11-17)
    expect(src.replace(/"\s*\n\s*"/g, '')).toContain('expiring within a week, each given only when it is within {band}% of the stock price')   // what the answer's first line restates
  })
})

// ── flow.topPicks → stock.topFlowPicks ─────────────────────────────────────────────────────────────────────────────────
const prow = (sym, o = {}) => ({
  id: `${sym}|C|100.0|1/15/2027`, sym, cp: 'C', strike: 100, exp: '1/15/2027', grade: 'A+', dir: 'BULL', dateSaved: '2026-08-10', saved_date: '2026-08-10', status: 'open', stopped: false,
  scored: true, prices: 3, entry: 2, latest_price: 3, latest_date: '2026-11-12', peak_price: 4, current_gain_pct: 50, max_gain_pct: 100, days_tracked: 2, oi_evaluable: true, oi_confirmed: true,
  prem: 1500000, hits: 4, cap: 'Large Cap', src: ['massive', 'schwab'], isolated: true, ...o,
})
const PICK_ROWS = () => [prow('AAA'),
  prow('BBB', { cp: 'P', dir: 'BEAR', grade: 'B', status: 'expired', stopped: true, entry: 5, latest_price: 2.5, current_gain_pct: -50, max_gain_pct: -20, oi_confirmed: false, src: ['schwab'] }),
  // not scored: the gains the envelope carries are IGNORED (a broken server must not turn "too new" into 0%)
  prow('CCC', { grade: null, scored: false, prices: 1, entry: 1, latest_price: 1.2, current_gain_pct: 0, max_gain_pct: 0, days_tracked: 0, oi_confirmed: true, src: ['massive'] })]
const picksEnv = (over = {}, envOver = {}) => envelope(KINDS.topPicks, {
  status: 'all', direction: 'any', sort: 'gain', symbol: null, rows: PICK_ROWS(), count: 41, counts: { total: 41, open: 30, expired: 11, scored: 35, too_new: 4, never_scored: 2, isolated: true },
  matching_too_new: 6, unread: 0, min_prices: 2, newest_price_date: '2026-11-12', newest_pick_date: '2026-08-14', days_since_newest_price: 1, days_since_newest_pick: 91, no_new_picks: true, ...over,
}, { freshness: 'historical', as_of: '2026-11-12T21:00:00Z', ...envOver })

describe('stock.topFlowPicks — the answer', () => {
  it('each pick with its contract\'s gain, a pick too new to score never as 0%, where the numbers come from, and both dates', () => {
    const a = honest(answerFromTopPicks(picksEnv()))
    expect(a.text.split('\n')).toEqual([
      'UCT Top Flow picks: 41 picks on record (30 open, 11 expired); 35 scored, 4 too new to score, 2 expired before they could be scored.',
      'The first 3 of the 41 picks, biggest current gain first:',
      '• AAA $100.00 call expiring 1/15/2027 (grade A+, bullish, open), flagged Aug 10, 2026: +50.0% since flagged ($2.00 to $3.00), best +100.0%; open interest later rose more than 10% above its first reading',
      '• BBB $100.00 put expiring 1/15/2027 (grade B, bearish, stopped early), flagged Aug 10, 2026: −50.0% since flagged ($5.00 to $2.50), best −20.0%',
      '• CCC $100.00 call expiring 1/15/2027 (bullish, open), flagged Aug 10, 2026: too new to score (1 daily price so far)',
      'A pick with fewer than 2 daily prices is too new to score: no gain is stated for it, which is not the same as 0%.',
      GAIN_MEANING,
      FLOW_SOURCES,
      'As of the close of Thu, Nov 12, 2026, the newest daily price on record.',
      'The newest pick on record was flagged Aug 14, 2026; none has been added since.',
      "Source: UCT's Top Flow record (UCT's own picks). Descriptive only: nothing here is a prediction. It is not a recommendation.",
    ])
    const ccc = a.facts.rows[2]
    expect(ccc).toMatchObject({ symbol: 'CCC', scored: false, gain_pct: null, gain_text: null, peak_pct: null, days_tracked: null, oi_confirmed: false })
    expect(a.table.rows[2]).toMatchObject({ symbol: 'CCC', gain: 'too new to score', peak: '—', days: '—' })
    expect(a.table.rows[0]).toEqual({ symbol: 'AAA', contract: '$100.00 call expiring 1/15/2027', grade: 'A+', direction: 'bullish', status: 'open', flagged: 'Aug 10, 2026', entry: '$2.00',
      latest: '$3.00', gain: '+50.0%', peak: '+100.0%', days: 2 })
    expect(a.present.items.map(i => i.value)).toEqual(['+50.0%', '−50.0%', 'too new to score'])
    expect(a.facts.rows.map(r => r.priced_by)).toEqual([['Massive', 'Schwab'], ['Schwab'], ['Massive']])
    expect(a.facts).toMatchObject({ total: 41, open: 30, expired: 11, scored: 35, too_new: 4, matching: 41, shown: 3, stale: false, no_new_picks: true, newest_pick_date: '2026-08-14' })
    expect(a.text.split('\n')[4]).not.toMatch(/%/)                       // CCC's line states no gain at all, zero included
  })
  it('a filter, an order and a ticker are named; a stale record and no price at all are each said', () => {
    const f = honest(answerFromTopPicks(picksEnv({ status: 'open', direction: 'bearish', sort: 'peak', symbol: 'BBB', rows: [PICK_ROWS()[1]], count: 1, matching_too_new: 0, no_new_picks: false })))
    expect(f.text.split('\n')[1]).toBe(`The 1 open bearish pick on BBB, ${TOP_FLOW_SORTS.peak.words}:`)
    expect(f.text).not.toMatch(/too new to score:|none has been added/)
    const all = honest(answerFromTopPicks(picksEnv({ rows: PICK_ROWS().slice(0, 2), count: 2, matching_too_new: 0 })))
    expect(all.text.split('\n')[1]).toBe('All 2 picks, biggest current gain first:')
    const s = honest(answerFromTopPicks(picksEnv({}, { stale: true })))
    expect(s.text).toContain('Stale: no daily price has been recorded since Nov 12, 2026.')
    const n = honest(answerFromTopPicks(picksEnv({ newest_price_date: null }, { as_of: null })))
    expect(n.text).toContain('No pick carries a daily price yet, so there is no price date to state.')
  })
  it('no pick that matches, and an empty record, are said for what they are; a failed read is never "no picks"', () => {
    const none = honest(answerFromTopPicks(picksEnv({ status: 'expired', symbol: 'ZZZ', rows: [], count: 0, matching_too_new: 0 })))
    expect(none.text.split('\n')[1]).toBe('None of them is an expired pick on ZZZ.')
    expect(none.table).toBeUndefined()
    const e = honest(answerFromTopPicks(picksEnv({ rows: [], count: 0, counts: { total: 0, open: 0, expired: 0, scored: 0, too_new: 0, never_scored: 0 }, newest_price_date: null, newest_pick_date: null, no_new_picks: false }, { as_of: null })))
    expect(e.text.split('\n')[0]).toBe('No Top Flow pick is on record on this server. A record that could not be loaded reads the same way, so this is not proof that none was ever flagged.')
    const u = honest(answerFromTopPicks(UNAVAILABLE))
    expect(u.text).toMatch(/^I couldn't read UCT's Top Flow picks: the pick record could not be read .*That is not the same as no picks\. No figure is stated\.$/)
    expect(u.text).not.toMatch(/No Top Flow pick is on record/)
    expect(honest(answerFromTopPicks(REFUSED)).text).toMatch(/that request wasn't allowed for this question/)
  })
  it('the statuses, directions, orders and limits are the kind\'s own and the TOPF panel\'s own (read from both files, never retyped)', () => {
    const src = adapter('flow_top_picks')
    expect(pyTuple(src, 'STATUSES')).toEqual(PICK_STATUS_KEYS)
    expect(pyDictKeys(src, 'DIRECTIONS')).toEqual(PICK_DIRECTION_KEYS)
    expect(pyTuple(src, 'SORTS')).toEqual(PICK_SORT_KEYS)
    expect(pyInt(src, 'MAX_LIMIT')).toBe(PICKS_MAX_ROWS)
    expect(pyInt(py('api/flow_scoreboard.py'), 'MIN_HISTORY_SNAPSHOTS')).toBe(MIN_HISTORY_SNAPSHOTS)
    // "OI confirmed" in plain words is the Flow Record's own factor, by the TOPF panel's constant
    expect(Number(/^OI_RISE_FACTOR = ([\d.]+)/m.exec(py('api/flow_scoreboard.py'))[1])).toBe(OI_RISE_FACTOR)
    expect(OI_ROSE).toBe('open interest later rose more than 10% above its first reading')
    // where the numbers come from is said the same way on both sides
    for (const said of [FLOW_SOURCES, /^NOTE_SOURCES = \(([\s\S]+?)\)$/m.exec(src)[1].replace(/"\s*\n\s*"/g, '')]) {
      for (const word of ["UCT's options flow tape", 'from Massive (prices recorded before November 2026 came from Schwab and stay as recorded)']) expect(said, word).toContain(word)
      for (const gone of ['Schwab as backup', 'Schwab alone before']) expect(said, gone).not.toContain(gone)        // the backup was removed 2026-11-17
    }
  })
})

// ── flow.record → stock.flowRecord ─────────────────────────────────────────────────────────────────────────────────────
const bucket = (picks, o = {}) => (picks
  ? { picks, win_rate_10: 62.5, win_rate_25: 41.7, win_rate_50: 25, pct_doubled: 8.3, avg_max_gain: 38.4, median_max_gain: 17.5, oi_confirmed_rate: 55.6, oi_evaluated: 18, isolated: true, ...o }
  : { picks: 0, win_rate_10: null, win_rate_25: null, win_rate_50: null, pct_doubled: null, avg_max_gain: null, median_max_gain: null, oi_confirmed_rate: null, oi_evaluated: 0, isolated: true })
const rpick = (sym, gain, o = {}) => ({ sym, cp: 'C', strike: 100, exp: '1/15/2027', grade: 'A', dateSaved: '2026-08-10', entry: 2, peak_price: 4, max_gain_pct: 100, days_tracked: 2, oi_confirmed: true, current_gain_pct: gain, latest_price: 3, isolated: true, ...o })
const recordEnv = (over = {}, envOver = {}) => envelope(KINDS.record, {
  flagged: 30, picks_tracked: 24, too_new: 6, overall: bucket(24),
  by_grade: [{ grade: 'A+', ...bucket(10, { win_rate_25: 60, win_rate_50: 40, avg_max_gain: 61.2 }) }, { grade: 'A', ...bucket(14) }, { grade: 'B', ...bucket(0) }, { grade: 'C', ...bucket(0) }, { grade: 'D', ...bucket(0) }],
  recent_winners: [rpick('AAA', 50)], recent_picks: [rpick('AAA', 50), rpick('BBB', -50, { cp: 'P', dateSaved: '8/7/2026', max_gain_pct: -20 })],
  generated_at: '2026-11-13T15:25:00.123456+00:00', computed_at: '2026-11-13T15:25:00Z', min_prices: 2, recent_window_days: 45, newest_price_date: '2026-11-12', newest_pick_date: '2026-08-14',
  days_since_newest_price: 1, days_since_newest_pick: 91, no_new_picks: true, ...over,
}, { freshness: 'historical', as_of: '2026-11-12T21:00:00Z', ...envOver })

describe('stock.flowRecord — the answer', () => {
  it('the rates as the record gives them, by grade, the last scored picks whatever the result, and where the numbers come from', () => {
    const a = honest(answerFromRecord(recordEnv()))
    expect(a.text.split('\n')).toEqual([
      'UCT Flow Record: 30 Top Flow picks flagged; 24 scored, 6 too new to score.',
      'Of the 24 scored picks, at the best daily price each reached: 62.5% gained 10% or more, 41.7% gained 25% or more, 25.0% gained 50% or more and 8.3% at least doubled.',
      'Average best gain +38.4%, median +17.5%.',
      'On 55.6% of the 18 picks it could be checked on, open interest later rose more than 10% above its first reading.',
      'By grade:',
      '• A+: 10 scored picks, 60.0% gained 25% or more, 40.0% gained 50% or more, average best gain +61.2%',
      '• A: 14 scored picks, 41.7% gained 25% or more, 25.0% gained 50% or more, average best gain +38.4%',
      '• B: no scored pick',
      '• C: no scored pick',
      '• D: no scored pick',
      'The last 2 scored picks, whatever the result:',
      '• AAA $100.00 call expiring 1/15/2027 (grade A), flagged Aug 10, 2026: +50.0% since flagged, best +100.0%',
      '• BBB $100.00 put expiring 1/15/2027 (grade A), flagged 8/7/2026: −50.0% since flagged, best −20.0%',
      RECORD_RULE,
      GAIN_MEANING,
      FLOW_SOURCES,
      'As of the close of Thu, Nov 12, 2026, the newest daily price on record.',
      'The newest pick on record was flagged Aug 14, 2026; none has been added since.',
      "Worked out by UCT at 10:25 AM ET (UCT's own time).",
      "Source: UCT's Flow Record (UCT's own measurement of its own picks). Past results, not a forecast.",
    ])
    expect(a.table.rows.map(r => r.grade)).toEqual(['A+', 'A'])           // a grade with no scored pick has no rate to tabulate
    expect(a.table.rows[0]).toEqual({ grade: 'A+', picks: '10', w10: '62.5%', w25: '60.0%', w50: '40.0%', dbl: '8.3%', avg: '+61.2%', med: '+17.5%' })
    expect(a.present.items.map(i => `${i.label}: ${i.value}`)).toEqual(['Gained 25% or more: 41.7%', 'Gained 50% or more: 25.0%', 'At least doubled: 8.3%'])
    expect(a.link).toEqual({ href: '/flow-scoreboard', label: 'Open the Flow Record' })
    expect(a.facts).toMatchObject({ flagged: 30, scored: 24, too_new: 6, stale: false, no_new_picks: true, newest_pick_date: '2026-08-14' })
  })
  it('nothing scored yet states no rate; an empty record and a failed read are each said for what they are', () => {
    const n = honest(answerFromRecord(recordEnv({ flagged: 3, picks_tracked: 0, too_new: 3, overall: bucket(0), by_grade: [], recent_picks: [] })))
    expect(n.text.split('\n').slice(0, 2)).toEqual(['UCT Flow Record: 3 Top Flow picks flagged; 0 scored, 3 too new to score.', 'No pick has enough daily prices to be scored yet, so there is no rate to state.'])
    expect(n.text.replace(RECORD_RULE, '')).not.toMatch(/\d%/)           // no rate and no gain: the only percent is the rule's "never as 0%"
    expect(n.table).toBeUndefined()
    expect(n.present).toBeUndefined()
    const e = honest(answerFromRecord(recordEnv({ flagged: 0, picks_tracked: 0, too_new: 0, overall: bucket(0), by_grade: [], recent_picks: [] })))
    expect(e.text.split('\n')[0]).toBe('The Flow Record holds no pick on this server. A record that could not be loaded reads the same way, so this is not a statement about the picks.')
    const u = honest(answerFromRecord(UNAVAILABLE))
    expect(u.text).toMatch(/^I couldn't read UCT's Flow Record: it could not be read .*not a statement about the picks\. No figure is stated\.$/)
    expect(u.text).not.toMatch(/holds no pick/)
    expect(honest(answerFromRecord(REFUSED)).text).toMatch(/that request wasn't allowed for this question/)
    expect(honest(answerFromRecord(recordEnv({}, { stale: true }))).text).toContain('Stale: no daily price has been recorded since Nov 12, 2026.')
  })
  it('every aggregate field the answer reads is one the kind returns (read from the adapter, never retyped)', () => {
    const fields = pyTuple(adapter('flow_record'), 'BUCKET_FIELDS')
    expect(fields).toEqual(Object.keys(bucket(1)).filter(k => k !== 'isolated'))
    expect(pyTuple(adapter('flow_record'), 'PICK_FIELDS').sort()).toEqual(Object.keys(rpick('AAA', 1)).filter(k => k !== 'isolated').sort())
    expect(gain1(-12.34)).toBe('−12.3%')
    expect(gain1(0)).toBe('0.0%')
    expect(gain1(null)).toBeNull()
  })
})

// ── earnings.reactions → stock.earningsReactions ───────────────────────────────────────────────────────────────────────
const rep = (sym, session, move, o = {}) => ({ sym, name: `${sym} Corp`, session, eps_act: 1.25, eps_est: 1, rev_act: 520, rev_est: 500, move, isolated: true, ...o })
const reactionsEnv = (over = {}, envOver = {}) => envelope(KINDS.reactions, {
  date: '2026-11-12', day_kind: 'past', scheduled: 9,
  reporters: [rep('BBB', 'bmo', -7.5, { eps_act: 0.8 }), rep('AAA', 'amc', 4.25, { rev_act: 52000, rev_est: 50000 }), rep('CCC', 'tbd', null, { name: null, eps_act: -0.1, eps_est: null, rev_act: null, rev_est: null })],
  count: 6, moves: 'held', moved: 5, up: 2, down: 2, flat: 1, no_move: 1, ...over,
}, { freshness: 'historical', ...envOver })

describe('stock.earningsReactions — the answer', () => {
  it('each reporter with its result against expectations and its move, a missing move never as 0, and what a move is', () => {
    const a = honest(answerFromReactions(reactionsEnv(), reactionsModel))
    expect(a.text.split('\n')).toEqual([
      'Earnings reactions for Thu, Nov 12, 2026: 6 companies with a reported result on record (9 on the calendar that day).',
      'Of the 5 with a stock move on record: 2 up, 2 down, 1 unchanged.',
      'The table holds the first 3 of the 6, biggest move first.',
      '• BBB (BBB Corp, before the open): EPS $0.80 against $1.00 expected (−20.0%); revenue $520.0M against $500.0M expected; stock −7.50%',
      '• AAA (AAA Corp, after the close): EPS $1.25 against $1.00 expected (+25.0%); revenue $52.00B against $50.00B expected; stock +4.25%',
      '• CCC (time not confirmed): EPS −$0.10; no stock move on record',
      '1 company has no stock move on record (no price bar for the day, or the session it is measured to has not closed).',
      MOVE_MEANING_PAST,
      'The calendar and the moves carry no data time, only the day they are for.',
      "Source: UCT's earnings calendar (third-party results and estimates as UCT holds them) and UCT's own move arithmetic. Descriptive only: nothing here is a prediction.",
    ])
    expect(a.table.rows[2]).toEqual({ symbol: 'CCC', name: '—', session: 'Time not confirmed', eps: '−$0.10', eps_expected: '—', surprise: '—', revenue: '—', revenue_expected: '—', move: 'not on record' })
    expect(a.present.items.map(i => `${i.label} ${i.value}`)).toEqual(['BBB −7.50%', 'AAA +4.25%'])
    expect(a.facts.rows[0].surprise_pct).toBe(reactionsModel.epsSurprisePct(0.8, 1))        // the EMOV panel's own arithmetic
    expect(a.facts).toMatchObject({ date: '2026-11-12', day_kind: 'past', count: 6, shown: 3, moves: 'held', moved: 5, no_move: 1 })
  })
  it('moves that are not held, or that could not be worked out, are never "no move"; a day in session says what its move is', () => {
    const blank = reactionsEnv().data.reporters.map(r => ({ ...r, move: null }))
    const nc = honest(answerFromReactions(reactionsEnv({ reporters: blank, moves: 'not_cached', moved: 0, up: 0, down: 0, flat: 0, no_move: 6 }, { status: 'partial' }), reactionsModel))
    expect(nc.text).toContain('The stock moves for that day are not held on the server at the moment, and this answer never starts price reads, so no move is stated. That is not the same as no move.')
    expect(nc.text).not.toMatch(/Of the \d+ with a stock move|close-to-close|0\.00%/)
    expect(nc.present).toBeUndefined()
    const nw = honest(answerFromReactions(reactionsEnv({ reporters: blank, moves: 'none_worked_out', moved: 0, up: 0, down: 0, flat: 0, no_move: 6 }, { status: 'partial' }), reactionsModel))
    expect(nw.text).toContain('No stock move is on record for these companies: the price source did not answer, or the session a move is measured to has not closed. That is not the same as no move.')
    const t = honest(answerFromReactions(reactionsEnv({ day_kind: 'today', count: 3, moved: 2, up: 1, down: 1, flat: 0, no_move: 1 }, { freshness: 'periodic' }), reactionsModel))
    expect(t.text).toContain(MOVE_MEANING_TODAY)
    expect(t.text).not.toContain(MOVE_MEANING_PAST)
    expect(t.text).toContain('Of the 2 with a stock move on record: 1 up, 1 down.')
  })
  it('nobody reported is a normal answer; a day that is not held is never that', () => {
    const none = honest(answerFromReactions(reactionsEnv({ reporters: [], count: 0, moves: null, moved: 0, up: 0, down: 0, flat: 0, no_move: 0, scheduled: 2 }), reactionsModel))
    expect(none.text.split('\n')[0]).toBe("No company on UCT's earnings calendar for Thu, Nov 12, 2026 has a reported result on record (2 companies on the calendar that day). That is a normal answer, not a failed read.")
    expect(none.table).toBeUndefined()
    const u = honest(answerFromReactions(UNAVAILABLE, reactionsModel, '2026-11-12'))
    expect(u.text).toMatch(/^I couldn't read the earnings reactions for Thu, Nov 12, 2026: that day's calendar is not held on the server at the moment, .*never builds a calendar week\. That is not the same as nobody reporting\. No figure is stated\.$/)
    expect(u.text).not.toMatch(/No company on UCT's earnings calendar/)
    expect(honest(answerFromReactions(REFUSED, reactionsModel)).text).toBe("I couldn't read the earnings reactions: that request wasn't allowed for this question, so nothing was read. No figure is stated.")
  })
  it('the sessions, the move states and the limit are the kind\'s own and the EMOV panel\'s own (read from both files, never retyped)', () => {
    const src = adapter('earnings_reactions')
    expect(pyTuple(src, 'SESSIONS')).toEqual(Object.keys(reactionsModel.SESSION_TEXT))
    expect(pyInt(src, 'MAX_LIMIT')).toBe(REACTIONS_MAX_ROWS)
    for (const state of pyTuple(src, 'MOVES')) expect(py('app/src/agent/capabilities/terminalDataWave3.js'), state).toContain(`'${state}'`)
    expect(pyTuple(src, 'ROW_FIELDS')).toEqual(Object.keys(rep('AAA', 'bmo', 1)).filter(k => k !== 'isolated'))
  })
})

// ── served vs dark, isolation on both sides, the manifest limits, one read per answer ──────────────────────────────────
let calls, ENVS
function wire(kinds) {
  calls = []; ENVS = {}
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push([u, body])
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: kinds !== null, scan: false, data_kinds: kinds || [] })
    if (u === '/api/agent/data') return json(ENVS[body.kind] || { status: 'refused', data: null, notes: ['refused'] })
    return json({}, 404)
  })
}
const reads = () => calls.filter(c => c[0] === '/api/agent/data').map(c => c[1])
async function inTurn(fn) { turnStart('send'); try { return await fn() } finally { turnEnd() } }
const KEYS = Object.keys(KINDS)
const ALL = Object.values(CAPABILITIES)
const PAIRS = KEYS.map(k => [KINDS[k], CAPABILITIES[k]])
const reset = () => { _resetAgentConfig(); _resetTurns(); _resetTerminalDataForTest(); _resetTerminalLocalForTest(); _resetTerminalWave2ForTest(); _resetTerminalWave3ForTest() }

describe('served vs dark', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'themes', 'earnings', 'levels.darkpool', 'earnings.expectedMove'], 'other kinds only']])('dark (%j, %s): none of the four is registered', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    expect(registerTerminalWave3Capabilities()).toEqual([])
    registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames(), n).not.toContain(n)
  })

  it.each(PAIRS)('served %s alone: only %s is registered, once, and it unregisters cleanly', async (kind, capability) => {
    wire([kind])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([capability])
    expect(registerTerminalWave3Capabilities()).toEqual([])            // idempotent
    reset()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([])
  })

  it('all four served: local-only on BOTH sides, never a plain data read, inside the manifest text limits', async () => {
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

  it('each answer makes ONE read of its own kind, with the member\'s arguments', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KINDS.gamma] = gammaEnv()
    ENVS[KINDS.topPicks] = picksEnv()
    ENVS[KINDS.record] = recordEnv()
    ENVS[KINDS.reactions] = reactionsEnv()
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    expect((await run(CAPABILITIES.gamma, { symbol: '$aaa' })).text).toMatch(/^AAA gamma levels from options expiring within a week/)
    expect((await run(CAPABILITIES.topPicks, { status: 'open', direction: null, sort: 'peak', limit: 500, symbol: 'nvda' })).text).toMatch(/^UCT Top Flow picks: 41 picks on record/)
    expect((await run(CAPABILITIES.topPicks, { status: null, direction: null, sort: null, limit: null, symbol: null })).text).toMatch(/^UCT Top Flow picks:/)
    expect((await run(CAPABILITIES.record, {})).text).toMatch(/^UCT Flow Record: 30 Top Flow picks flagged/)
    expect((await run(CAPABILITIES.reactions, { date: '2026-11-12', limit: null })).text).toMatch(/^Earnings reactions for Thu, Nov 12, 2026/)
    expect((await run(CAPABILITIES.reactions, { date: null, limit: 500 })).text).toMatch(/^Earnings reactions for/)
    expect(reads().map(r => [r.kind, r.params, r.purpose])).toEqual([
      [KINDS.gamma, { symbol: 'AAA' }, 'answer'],
      [KINDS.topPicks, { status: 'open', direction: 'any', sort: 'peak', limit: 50, symbol: 'NVDA' }, 'answer'],
      [KINDS.topPicks, { status: 'all', direction: 'any', sort: 'gain', limit: 20 }, 'answer'],
      [KINDS.record, {}, 'answer'],
      [KINDS.reactions, { limit: 25, date: '2026-11-12' }, 'answer'],
      [KINDS.reactions, { limit: 50 }, 'answer'],
    ])
  })

  it('no read without a turn or without a usable argument, and a refusal is answered in fixed words', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    for (const [name, args] of [[CAPABILITIES.gamma, { symbol: 'AAA' }], [CAPABILITIES.topPicks, { status: null, direction: null, sort: null, limit: null, symbol: null }],
      [CAPABILITIES.record, {}], [CAPABILITIES.reactions, { date: null, limit: null }]]) {
      expect((await getCapability(name).answer(null, args, null)).text, name).toMatch(/needs the Agent's turn/)
    }
    expect((await inTurn(() => getCapability(CAPABILITIES.gamma).answer(null, { symbol: 'not a ticker!' }, null))).text).toMatch(/^Which stock's gamma levels/)
    expect((await inTurn(() => getCapability(CAPABILITIES.reactions).answer(null, { date: 'yesterday', limit: null }, null))).text).toMatch(/^Which day's earnings reactions should I read\? Give me the date as YYYY-MM-DD\./)
    expect((await inTurn(() => getCapability(CAPABILITIES.reactions).answer(null, { date: '2026-11-14', limit: null }, null))).text).toMatch(/^Sat, Nov 14, 2026 is a weekend day/)
    expect(reads()).toEqual([])
    const a = await inTurn(() => getCapability(CAPABILITIES.record).answer(null, {}, null))   // the stub refuses
    expect(a.text).toMatch(/^I couldn't read UCT's Flow Record: that request wasn't allowed for this question/)
    expect(reads()).toHaveLength(1)
  })
})

// ── routing: the wave's own words-only group, armed only while a capability is registered ───────────────────────────────
const ownGroup = () => GROUPS.find(g => g.id === ROUTE_GROUP)
const dataGroup = () => GROUPS.find(g => g.id === 'data')
const DATA_BASE = [...dataGroup().words]                 // read before anything is served: routing.js's own list
const ROUTE_OPTS = () => ({ enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold })
const namedBy = (words) => (text) => Object.keys(words).filter(k => words[k].some(re => re.test(String(text).toLowerCase())))
const wordKeys = namedBy(WAVE3_ROUTE_WORDS)
/** plain member asks, by the capability whose words must name them */
const ASKS = {
  gamma: ['gamma levels for NVDA', 'where is the call wall on SPY', 'NVDA gamma walls', 'what is the zero gamma level for QQQ', 'TSLA put wall', 'gex levels on AAPL'],
  topPicks: ['show me the top flow picks', 'how are the top flow picks doing', 'top flow picks on NVDA', 'which top flow picks are up the most'],
  record: ["what is the flow record's win rate", 'how has the flow record done', 'flow scoreboard results', 'what is the win rate of the flow picks'],
  reactions: ['earnings reactions for yesterday', "how did yesterday's reporters move", 'how did the stocks that reported yesterday do', 'post-earnings moves from thursday', 'which earnings reporters gapped the most'],
}
/** another capability's language: none of the four's words may name these */
const NOT_OURS = [
  'turn on gex walls on this chart', 'add the gex walls indicator', 'hide the gamma walls', 'show the gex walls overlay',                           // the chart's GEX Walls indicator
  'what is a call wall', 'explain gamma exposure', 'what is gamma',                                                                               // the guide / the coach
  'alert me when SPY hits the call wall', 'draw a line at the put wall', 'scan for stocks near their call wall',                                  // alerts, drawings, the Screener
  'open the options flow page', 'add an options flow widget', 'open the top flow tab', 'options flow on NVDA',                                    // the Options Flow page and widget
  'open the flow record', 'go to the flow scoreboard page', "what's my win rate", 'my win rate on flow trades this month',                        // navigation, the journal
  'who reports today', 'who is reporting this week', 'what reports on Thursday', 'who reported yesterday', 'open the earnings calendar',           // calendar.day
  'when does NVDA report earnings', 'NVDA earnings history', 'how does NVDA trade after earnings',                                                // stock.earnings, history.afterEvent
  'scan for stocks that gapped up on earnings', 'alert me when AAPL reports',
  'dark pool levels on NVDA', 'expected move for NVDA earnings', 'buy 5 calls on NVDA', 'add a call option to the chart',                         // waves 1 and 2, orders
  'any news on TSLA', 'switch to weekly', 'what got upgraded today', 'which stocks made new 52-week highs',
]
/** asks the earlier waves' words name (their own tests hold the full lists): this wave's words must not */
const EARLIER_ASKS = ['what got upgraded today', 'new highs today', 'top gainers over 60 days', 'dark pool levels on NVDA', 'which stocks made new 52-week highs', 'which themes are rotating in',
  'what is on the confluence board', 'expected move for NVDA earnings', 'what are options pricing in for AAPL', 'which companies mentioned tariffs on their earnings call', 'search earnings calls for pricing power']

describe('routing words', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the group is words-only and never a filler, and routing.js lists the four by action with no word of its own', () => {
    const g = ownGroup()
    expect(g.wordsOnly && g.fillLast).toBe(true)
    expect(g.words).toEqual([])                                      // server-armed: empty until a capability registers
    expect([...g.actions].sort()).toEqual([...ALL].sort())
    expect(g.domains).toEqual([])
    expect(g.title.length).toBeLessThanOrEqual(160)                  // the server cuts a group title at 160 characters (turn.py validate_routing)
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'themes', 'earnings', 'sectors.performance'], 'other kinds only']])('dark (%j, %s): the group has no words, and the data group keeps exactly routing.js\'s', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(ownGroup().words).toEqual([])
    expect(dataGroup().words).toEqual(DATA_BASE)
    for (const asks of Object.values(ASKS)) for (const q of asks) expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
  })

  it.each(KEYS)('served %s alone: only its own words are armed, the data group\'s words never change, and they are taken back', async (key) => {
    wire([KINDS[key]])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(ownGroup().words).toEqual(WAVE3_ROUTE_WORDS[key])
    expect(dataGroup().words).toEqual(DATA_BASE)
    registerTerminalWave3Capabilities()                                // idempotent: never armed twice
    expect(ownGroup().words).toHaveLength(WAVE3_ROUTE_WORDS[key].length)
    reset()
    expect(ownGroup().words).toEqual([])
  })

  it('every capability has words, and each ask is named by its own capability\'s words', () => {
    expect(Object.keys(WAVE3_ROUTE_WORDS).sort()).toEqual([...KEYS].sort())
    for (const [key, asks] of Object.entries(ASKS)) for (const q of asks) expect(wordKeys(q), q).toContain(key)
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

  it('the typo lexicon: registering the four changes no correction of any OTHER capability\'s capreg corpus phrasing', async () => {
    // A summary's and a hint's lowercase words join the typo lexicon (nl/lexicon.js). This wave's own phrasings are left out:
    // their words ("picks", "reporters") become known words when the capability registers, which is the point.
    wire([])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const texts = [...new Set(allPhrasings().filter(p => !ALL.includes(p.intent.id)).map(p => p.ph.text)), 'walk me through the setup on NVDA', 'wipe the Momentum list', 'sort ascending by change', 'ascending order']
    const read = () => { const lex = lexiconFor(null); return texts.map(t => JSON.stringify((correctTypos(t, lex) || []).map(v => v.text))) }
    const before = read()
    _resetAgentConfig(); wire(PAIRS.map(p => p[0])); await loadAgentConfig(); registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames()).toContain(n)
    const after = read()
    expect(texts.length).toBeGreaterThan(500)
    expect(texts.filter((t, i) => before[i] !== after[i])).toEqual([])
  })

  it('the earlier waves\' words and this wave\'s never name the same ask (one wave\'s words per ask)', () => {
    const wave1 = namedBy(TERMINAL_ROUTE_WORDS)
    const wave2 = namedBy(WAVE2_ROUTE_WORDS)
    for (const asks of Object.values(ASKS)) for (const q of asks) expect([...wave1(q), ...wave2(q)], q).toEqual([])
    for (const q of EARLIER_ASKS) {
      expect([...wave1(q), ...wave2(q)].length, q).toBeGreaterThan(0)   // non-vacuity: an earlier wave really names it
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
