// Terminal data wave 2 — the five local-only capabilities over `highsLows.yearly`, `themes.rotation`, `confluence.board`,
// `earnings.expectedMove` and `earnings.callSearch`: the member's answer (the data's own time or why there is none; never
// live / now; a list that could not be read, a board still building, a straddle that is not held and an empty index each
// said in their own words, never as "nothing"; an envelope's notes never echoed; an excerpt quoted exactly as the server cut
// it), served vs dark (each registers only while the server lists ITS kind), local-only on both sides, the manifest text
// limits, one read per answer, and the cross-file facts read from the other file (never retyped).
// Routing: each capability's own words are on the data group only while it is registered (a dark server's routing is
// routing.js's own), every plain ask reaches its capability under v1 and v2, and the words stay off other capabilities'
// language (breadth's counts, the Screener's 52-week filters, the Compare panel's rotation map, chart settings, alerts).
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
import collisions from './qa/capabilityRegression/baseline/routingCollisions.json'
import handshake from './__fixtures__/program/isolation.json'
import { HIGHS52_SIDES, drillRead } from '../pages/terminal/panels/highs52Model'
import { LIVE_WORDS } from './capabilities/terminalDataFormat'
import { _resetTerminalDataForTest } from './capabilities/terminalData'
import { _resetTerminalLocalForTest, TERMINAL_ROUTE_WORDS } from './capabilities/terminalDataLocal'
import {
  KINDS, CAPABILITIES, YEARLY_SIDE_KEYS, YEARLY_MAX_ROWS, NOT_THE_DAY, ROTATION_SIDE_KEYS, ROTATION_MAX_ROWS, CONFLUENCE_LEANS, CONFLUENCE_MAX_ROWS,
  CALL_SEARCH_MIN_QUERY, CALL_SEARCH_MAX_QUERY, CALL_SEARCH_MAX_ROWS, excerptText, callQuery,
  answerFromYearly, answerFromRotation, answerFromConfluence, answerFromExpectedMove, answerFromCallSearch,
  registerTerminalWave2Capabilities, _resetTerminalWave2ForTest, WAVE2_ROUTE_WORDS,
} from './capabilities/terminalDataWave2'

registerBuiltins()

const REPO = path.resolve(__dirname, '..', '..', '..')
const py = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const adapter = (name) => py(`api/services/uct_agent/marketdata/${name}.py`)
const pyInt = (src, name) => Number(new RegExp(`^${name} = (\\d+)\\b`, 'm').exec(src)[1])
const pyTuple = (src, name) => new RegExp(`^${name} = \\(([^)]+)\\)`, 'm').exec(src)[1].match(/"[^"]+"/g).map(s => s.slice(1, -1))
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

// ── highsLows.yearly → stock.yearlyHighsLows ───────────────────────────────────────────────────────────────────────────
const item = (t, pctv, o = {}) => ({ t, c: o.c ?? 10.5, pct: pctv, vr: 1.8, v: 1200000, n: `${t} Corp`, isolated: true })
const list = (items, count) => ({ state: 'ok', items, count: count ?? items.length, isolated: true })
const yearlyEnv = (over = {}, envOver = {}) => envelope(KINDS.yearly, {
  mode: 'live', why: null, session_date: '2026-11-13', side: 'both',
  highs: list([item('BBB', 4.5, { c: 1234.5 }), item('AAA', 9)], 41), lows: list([item('CCC', -6.2)]),
  basis: 'intraday', computed_at: '2026-11-13T15:29:30Z', missing: [], ...over,
}, { as_of: '2026-11-13T15:29:05Z', ...envOver })
const settledEnv = (why, over = {}, envOver = {}) => yearlyEnv({ mode: 'settled', why, session_date: '2026-11-12', basis: null, computed_at: null, ...over },
  { freshness: 'historical', as_of: '2026-11-12T21:00:00Z', ...envOver })

describe('stock.yearlyHighsLows — the answer', () => {
  it('a session under way: the counts, the names by the H52 panel\'s own order, and the snapshot\'s own time', () => {
    const a = honest(answerFromYearly(yearlyEnv()))
    const lines = a.text.split('\n')
    expect(lines[0]).toBe('New 52-week highs and lows in the session of Fri, Nov 13, 2026, so far: 41 stocks at a new 52-week high, 1 stock at a new 52-week low.')
    expect(lines[1]).toBe('New highs, biggest gain first: AAA ($10.50, +9.00% vs the prior close); BBB ($1,234.50, +4.50% vs the prior close).')
    expect(lines[2]).toBe('New lows, biggest fall first: CCC ($10.50, −6.20% vs the prior close).')
    expect(a.text).toContain("The table holds the first 2 of the 41 new highs, in the list's own order.")
    expect(a.text).toContain(NOT_THE_DAY)
    expect(a.text).toContain('Counted from the market snapshot of 10:29 AM ET; the lists are recomputed about once a minute.')
    expect(a.text).toContain('Counted on the exchange convention: a trade above the prior 52-week high, or below the prior 52-week low.')
    expect(a.table.rows.map(r => `${r.side} ${r.symbol}`)).toEqual(['New 52-week highs AAA', 'New 52-week highs BBB', 'New 52-week lows CCC'])
    expect(a.table.rows[0]).toMatchObject({ name: 'AAA Corp', price: '$10.50', change: '+9.00%', rvol: '1.8x', volume: '1,200,000' })
    expect(a.present.items.map(i => i.value)).toEqual(['41', '1'])
    expect(a.facts).toMatchObject({ in_session: true, session_date: '2026-11-13', highs_total: 41, lows_total: 1, missing: [], stale: false })
    // the rows are the H52 panel helper's, in its order
    expect(a.facts.highs.map(r => r.symbol)).toEqual(drillRead({ ok: true, items: yearlyEnv().data.highs.items }, { side: 'highs', live: true }).rows.map(r => r.sym))
  })
  it('no vendor stamp: UCT\'s own time, labelled as such; an old read is said to be stale', () => {
    const a = honest(answerFromYearly(yearlyEnv({ basis: null }, { as_of: null, stale: true })))
    expect(a.text).toContain("Counted by UCT at 10:29 AM ET (UCT's own time; the market snapshot's time is not carried).")
    expect(a.text).not.toContain('exchange convention')
    expect(a.text).toContain('Stale: the breadth read behind these lists is more than five minutes old, so newer highs and lows may be missing.')
  })
  it.each([
    ['finished', 'The session has finished: these are its stored lists.'],
    ['thin', 'The breadth read of the session under way covers too few stocks to trust, so these are the lists of the last finished session.'],
    ['closed', 'The market is not in session, so these are the lists of the last finished session.'],
    ['no_read', 'No breadth read of a session under way was available to this answer, so these are the lists of the last finished session. A session may be under way.'],
  ])('a finished session (%s) is named as one, with why, dated by its close', (why, sentence) => {
    const a = honest(answerFromYearly(settledEnv(why)))
    expect(a.text.split('\n')[0]).toBe('New 52-week highs and lows of the finished session Thu, Nov 12, 2026: 41 stocks at a new 52-week high, 1 stock at a new 52-week low.')
    expect(a.text).toContain(sentence)
    expect(a.text).toContain('As of the close of Thu, Nov 12, 2026.')
    expect(a.text).not.toMatch(/so far|Counted/)
    expect(a.facts).toMatchObject({ in_session: false, why, as_of: null, counted_at: null })
  })
  it('a stored session that is behind is stale; one side only when one was asked for', () => {
    const s = honest(answerFromYearly(settledEnv('no_read', {}, { stale: true })))
    expect(s.text).toContain('Stale: a more recent session has finished since Thu, Nov 12, 2026, and its lists are not stored yet.')
    const one = honest(answerFromYearly(yearlyEnv({ side: 'lows', highs: null })))
    expect(one.text.split('\n')[0]).toBe('New 52-week highs and lows in the session of Fri, Nov 13, 2026, so far: 1 stock at a new 52-week low.')
    expect(one.table.rows.map(r => r.symbol)).toEqual(['CCC'])
    expect(one.facts.highs_total).toBeNull()
  })
  it('a list that could not be read is never "no new lows"; an empty list is a count of zero', () => {
    const m = honest(answerFromYearly(yearlyEnv({ lows: { state: 'unavailable', items: [], count: 0 }, missing: ['lows'] }, { status: 'partial' })))
    expect(m.text.split('\n')[0]).toBe('New 52-week highs and lows in the session of Fri, Nov 13, 2026, so far: 41 stocks at a new 52-week high.')
    expect(m.text).toContain('The new 52-week low list could not be read for this session. That is not the same as no new lows.')
    expect(m.text).not.toMatch(/\b0 stocks at a new 52-week low\b/)
    expect(m.facts).toMatchObject({ lows_total: null, missing: ['lows'] })
    const e = honest(answerFromYearly(yearlyEnv({ lows: list([]) })))
    expect(e.text.split('\n')[0]).toMatch(/41 stocks at a new 52-week high, 0 stocks at a new 52-week low\.$/)
  })
  it('refused / unavailable: fixed words keyed on the status, no figure, no table', () => {
    expect(honest(answerFromYearly(REFUSED)).text).toBe("I couldn't read UCT's new 52-week high and low lists: that request wasn't allowed for this question, so nothing was read. No figure is stated.")
    const u = honest(answerFromYearly(UNAVAILABLE))
    expect(u.text).toMatch(/^I couldn't read UCT's new 52-week high and low lists: they are not available from UCT's data at the moment .*No figure is stated\.$/)
    expect(u.table).toBeUndefined()
    expect(u.text).not.toMatch(/\b0 stocks\b/)
  })
  it('the sides and the lists are the kind\'s own and the H52 panel\'s own (read from both files, never retyped)', () => {
    const src = adapter('yearly_highs_lows')
    expect(pyTuple(src, 'SIDES')).toEqual(YEARLY_SIDE_KEYS)
    const lists = Object.fromEntries([.../^LISTS = \{(.+)\}$/m.exec(src)[1].matchAll(/"(highs|lows)": "(\w+)"/g)].map(m => [m[1], m[2]]))
    expect(lists).toEqual({ highs: HIGHS52_SIDES.highs.list, lows: HIGHS52_SIDES.lows.list })
    expect(pyInt(src, 'MAX_LIMIT')).toBe(YEARLY_MAX_ROWS)
  })
})

// ── themes.rotation → stock.themeRotation ──────────────────────────────────────────────────────────────────────────────
const rot = (ticker, name, delta, o = {}) => ({ name, ticker, '1w_return': o.w ?? 4.2, '1w_rank': o.r1w ?? 82.4, '1m_return': o.m ?? 1.1, '1m_rank': o.r1m ?? 41.2, '3m_return': 9, '3m_rank': 55, momentum_delta: delta, isolated: true })
const rotationEnv = (over = {}, envOver = {}) => envelope(KINDS.rotation, {
  side: 'both', rotating_in: [rot('ai-chips', 'AI Chips', 41.2)], rotating_out: [rot('solar', 'Solar', -27.5, { w: -3.1, r1w: 20.4, m: 2.2, r1m: 47.9 })],
  in_count: 3, out_count: 1, ranked: 112, threshold: 20, generated_at: '2026-11-13T15:20:00.123456+00:00', computed_at: '2026-11-13T15:20:00Z', ...over,
}, envOver)

describe('stock.themeRotation — the answer', () => {
  it('each theme\'s whole ranks, a change that matches them, and UCT\'s own working time', () => {
    const a = honest(answerFromRotation(rotationEnv()))
    const lines = a.text.split('\n')
    expect(lines[0]).toBe('UCT theme rotation, 112 themes ranked: 3 themes rotating in, 1 theme rotating out.')
    expect(lines[1]).toBe('Rotating in, biggest rank change first:')
    expect(lines[2]).toBe('• AI Chips: rank 41 to 82 (+41), 1-week return +4.20%, 1-month +1.10%')
    expect(lines[3]).toBe('(The table holds the first 1 of 3.)')
    expect(lines[4]).toBe('Rotating out, biggest rank change first:')
    expect(lines[5]).toBe('• Solar: rank 48 to 20 (−28), 1-week return −3.10%, 1-month +2.20%')
    expect(a.text).toContain("A theme is rotating in when its 1-week rank is 20 or more points above its 1-month rank, and rotating out when it is 20 or more below.")
    expect(a.text).toContain("Worked out by UCT at 10:20 AM ET from its theme returns, and kept for up to 15 minutes (UCT's own time, not an exchange timestamp).")
    expect(a.text).toContain('Descriptive only: nothing here is a prediction.')
    expect(a.table.rows.map(r => `${r.side}: ${r.theme} ${r.change}`)).toEqual(['Rotating in: AI Chips +41', 'Rotating out: Solar −28'])
    expect(a.facts).toMatchObject({ ranked: 112, threshold: 20, in_total: 3, out_total: 1 })
  })
  it('one side only, and no theme rotating is a healthy answer', () => {
    const o = honest(answerFromRotation(rotationEnv({ side: 'out', rotating_in: [], in_count: 0 })))
    expect(o.text.split('\n')[0]).toBe('UCT theme rotation, 112 themes ranked: 1 theme rotating out.')
    expect(o.text).not.toContain('Rotating in')
    const n = honest(answerFromRotation(rotationEnv({ rotating_in: [], rotating_out: [], in_count: 0, out_count: 0 })))
    expect(n.text).toContain('Rotating in: no theme by 20 points or more.')
    expect(n.text).toContain('Rotating out: no theme by 20 points or more.')
    expect(n.table).toBeUndefined()
  })
  it('not held on the server / refused: never "nothing is rotating"', () => {
    const u = honest(answerFromRotation(UNAVAILABLE))
    expect(u.text).toMatch(/^I couldn't read UCT's theme rotation ranking: it is not held on the server at the moment .*never starts that computation.*No figure is stated\.$/)
    expect(u.text).not.toMatch(/no theme|0 themes/)
    expect(honest(answerFromRotation(REFUSED)).text).toMatch(/that request wasn't allowed for this question/)
    expect(honest(answerFromRotation(rotationEnv({ computed_at: null, generated_at: null }))).text).toContain('The ranking carries no time, so I cannot say when it was worked out.')
  })
  it('the sides and the limit are the kind\'s own (read from the adapter, never retyped)', () => {
    const src = adapter('themes_rotation')
    expect(pyTuple(src, 'SIDES')).toEqual(ROTATION_SIDE_KEYS)
    expect(pyInt(src, 'MAX_LIMIT')).toBe(ROTATION_MAX_ROWS)
  })
})

// ── confluence.board → stock.confluenceBoard ───────────────────────────────────────────────────────────────────────────
const crow = (sym, dir, o = {}) => ({
  sym, band: o.band ?? 'L', dir, status: o.status ?? 'BUILDING', sector: 'Technology', dpn: 180000000, dpAvg: 101.4, dpLo: 98.5, dpHi: 104.25, dpLast: 103.1,
  bigPrint: 40000000, bigPrice: 101, bigDate: '11/10', net: dir === 'BULL' ? 12500000 : -8000000, net5: 6000000, bull: 14000000, bear: 1500000, bullPct: 90.3,
  leapPrem: 5000000, leapShare: 0.412, freshRatio: 0.48, top: { cp: dir === 'BULL' ? 'C' : 'P', strike: 120, exp: '1/15/2027', dte: 63, prem: 4200000, isolated: true }, score: 2.4, isolated: true,
})
const confEnv = (over = {}, envOver = {}) => envelope(KINDS.confluence, {
  days: 30, window: 'Oct 6 – Nov 12, 2026', direction: 'all', rows: [crow('AAA', 'BULL'), crow('BBB', 'BEAR', { band: 'M', status: 'STEADY' })], count: 3,
  counts: { total: 3, bull: 2, bear: 1, building: 1, isolated: true }, band_meta: {}, incomplete: false, built_at: '2026-11-13T15:05:00Z', refresh_minutes: 30, ...over,
}, envOver)

describe('stock.confluenceBoard — the answer', () => {
  it('the board in the server\'s order, the long-dated share turned into a percent once, and UCT\'s build time', () => {
    const a = honest(answerFromConfluence(confEnv()))
    const lines = a.text.split('\n')
    expect(lines[0]).toBe('UCT confluence board, dark pool window Oct 6 to Nov 12, 2026 (30 trading days): 3 stocks, 2 bullish and 1 bearish; 1 still building.')
    expect(lines[1]).toBe('Showing the first 2 of the 3 names, best ranked first.')
    expect(lines[2]).toBe('• AAA (Large cap, bullish, building): $180.0M traded in the dark pool at an average of $101.40; net bullish option premium $12.5M, 41% of the open premium long-dated; largest position the Jan 15, 2027 $120.00 call ($4.2M)')
    expect(lines[3]).toBe('• BBB (Mid cap, bearish, steady): $180.0M traded in the dark pool at an average of $101.40; net bearish option premium $8.0M, 41% of the open premium long-dated; largest position the Jan 15, 2027 $120.00 put ($4.2M)')
    expect(a.text).toContain("Built by UCT at 10:05 AM ET and rebuilt about every 30 minutes; the board carries no data time (UCT's own build time, not an exchange timestamp).")
    expect(a.text).toContain('a dark pool print names a price, not a buyer')
    expect(a.text).toMatch(/Descriptive only: nothing here is a prediction\. It is not a recommendation\.$/)
    expect(a.text).not.toMatch(/\bAcc\b|accumulat|distribut/i)           // the accumulation call is never shown
    expect(a.table.rows[0]).toMatchObject({ symbol: 'AAA', band: 'Large cap', direction: 'bullish', status: 'building', dark: '$180.0M', long: '41%', top: 'Jan 15, 2027 $120.00 call' })
    expect(a.facts).toMatchObject({ total: 3, bullish: 2, bearish: 1, building: 1, matching: 3, shown: 2, stale: false, incomplete: false })
  })
  it('a direction asked for, a stale board, a missing leg and an unknown build time are each said', () => {
    const b = honest(answerFromConfluence(confEnv({ direction: 'bear', rows: [crow('BBB', 'BEAR')], count: 1 }), { lean: 'bearish' }))
    expect(b.text.split('\n')[1]).toBe('The 1 bearish name, best ranked first:')
    const s = honest(answerFromConfluence(confEnv({ incomplete: true }, { stale: true, status: 'partial' })))
    expect(s.text).toContain('Stale: the board is older than its usual refresh, so it may be behind the latest options flow.')
    expect(s.text).toContain('One options-flow leg could not be read when this board was built, so some names may be missing.')
    const n = honest(answerFromConfluence(confEnv({ built_at: null }, { stale: true })))
    expect(n.text).toContain('The board carries no build time, so I cannot say how old it is.')
    expect(n.text).not.toContain('Stale:')
  })
  it('nothing on the board is a normal answer; a board still building is never that', () => {
    const e = honest(answerFromConfluence(confEnv({ rows: [], count: 0, counts: { total: 0, bull: 0, bear: 0, building: 0 } })))
    expect(e.text.split('\n')[0]).toBe("UCT's confluence board has no stock on it for dark pool window Oct 6 to Nov 12, 2026 (30 trading days): nothing passes its gate. That is a normal answer, not a failed read.")
    expect(e.table).toBeUndefined()
    const none = honest(answerFromConfluence(confEnv({ direction: 'bear', rows: [], count: 0 }), { lean: 'bearish' }))
    expect(none.text.split('\n')[1]).toBe('None of them is bearish.')
    const u = honest(answerFromConfluence(UNAVAILABLE))
    expect(u.text).toMatch(/^I couldn't read UCT's confluence board: it is not available .*may still be building on the server.*No figure is stated\.$/)
    expect(u.text).not.toMatch(/no stock on it|nothing passes/)
    expect(honest(answerFromConfluence(REFUSED)).text).toMatch(/that request wasn't allowed/)
  })
  it('the directions and the limit are the kind\'s own (read from the adapter, never retyped)', () => {
    const src = adapter('confluence_board')
    const keys = /^DIRECTIONS = \{(.+)\}$/m.exec(src)[1].match(/"(\w+)":/g).map(s => s.slice(1, -2))
    expect(Object.values(CONFLUENCE_LEANS)).toEqual(keys)
    expect(pyInt(src, 'MAX_LIMIT')).toBe(CONFLUENCE_MAX_ROWS)
  })
})

// ── earnings.expectedMove → stock.expectedMove ─────────────────────────────────────────────────────────────────────────
const cap = (report_date, pctv, o = {}) => ({ sym: 'AAA', report_date, captured_at: o.captured ?? '2026-11-18T02:00:00+00:00', pct: pctv, dollar: 9.1, expiry: report_date, fiscal_year: 2026, fiscal_quarter: o.q ?? 3, isolated: true })
const moveEnv = (over = {}, envOver = {}) => envelope(KINDS.expectedMove, {
  symbol: 'AAA', report_date: '2026-11-19',
  live: { pct: 8.4, dollar: 10.5, strike: 125, spot: 125.3, call_mid: 5.6, put_mid: 4.9, iv_atm: 0.71, expiry: '2026-11-20', horizon: 'through 2026-11-20', asof: '2026-11-13T15:10:00+00:00', source: 'massive-chain', isolated: true },
  live_state: 'fresh', live_outcome: { kind: 'ok', reason: null, isolated: true }, read_at: '2026-11-13T15:10:00Z',
  history: [cap('2026-11-19', 7.9), cap('2026-08-06', 6.2, { q: 2, captured: '2026-08-05T02:00:00+00:00' })], history_since: '2025-08-07', store_read: true, ...over,
}, envOver)

describe('stock.expectedMove — the answer', () => {
  it('the straddle the server holds, its break-evens, the expiry it runs to, and UCT\'s own read time', () => {
    const a = honest(answerFromExpectedMove(moveEnv(), 'AAA'))
    const lines = a.text.split('\n')
    expect(lines[0]).toBe('AAA expected move: ±8.40% (about $10.50 on a $125.30 stock price), the price of the at-the-money straddle at the $125.00 strike, through the Nov 20, 2026 expiry.')
    expect(lines[1]).toBe('That puts the break-even prices near $114.80 and $135.80.')
    expect(lines[2]).toBe('It is the first expiry on or after the report date of Nov 19, 2026.')
    expect(lines[3]).toBe("Read by UCT from its option chain at 10:10 AM ET (UCT's own read time, not an exchange timestamp).")
    expect(lines[4]).toBe('What the straddle priced before each report, captured once by UCT ahead of it:')
    expect(lines[5]).toBe('• Q3 2026, report of Nov 19, 2026 (still ahead): ±7.90% ($9.10), captured Nov 18, 2026')
    expect(lines[6]).toBe('• Q2 2026, report of Aug 6, 2026: ±6.20% ($9.10), captured Aug 5, 2026')
    expect(a.text).toContain('The expected move is what the options market prices, not a forecast')
    expect(a.table.rows.map(r => r.report)).toEqual(['Nov 19, 2026 (ahead)', 'Aug 6, 2026'])
    expect(a.present.items[0]).toMatchObject({ label: 'AAA expected move', value: '±8.40%' })
    expect(a.link).toEqual({ href: '/research/AAA', label: 'Open AAA in Research' })
    expect(a.facts.priced).toMatchObject({ pct: 8.4, expiry: '2026-11-20', last_good: false })
  })
  it('an expiry on the report day, no report date, and a last good read are each said', () => {
    const same = honest(answerFromExpectedMove(moveEnv({ report_date: '2026-11-20' }), 'AAA'))
    expect(same.text).toContain('That expiry is the report day itself: for a report after the close, these options settle before the result is out.')
    const none = honest(answerFromExpectedMove(moveEnv({ report_date: null }), 'AAA'))
    expect(none.text).toContain('No report date was given or stored, so this is the nearest expiry: it spans the next earnings report only if the report falls before it.')
    const old = honest(answerFromExpectedMove(moveEnv({ live_state: 'last_good' }, { stale: true }), 'AAA'))
    expect(old.text).toContain('Stale: this is the last good read, older than the 15 minutes it is normally kept, so it may be behind the option market.')
  })
  it('no straddle held: no price is stated, only what was stored; nothing held at all is never "no move is priced"', () => {
    const p = honest(answerFromExpectedMove(moveEnv({ live: null, live_state: 'not_cached', live_outcome: null, read_at: null }, { status: 'partial' }), 'AAA'))
    expect(p.text.split('\n')[0]).toBe('No expected move for AAA is held on the server at the moment, and this answer never starts an option chain read, so no straddle price is stated. Open AAA in Research to read it.')
    expect(p.text).not.toMatch(/8\.40|break-even/)
    expect(p.text).toContain('• Q3 2026, report of Nov 19, 2026 (still ahead): ±7.90% ($9.10), captured Nov 18, 2026')
    expect(p.facts.priced).toBeNull()
    const nh = honest(answerFromExpectedMove(moveEnv({ history: [], history_since: null }), 'AAA'))
    expect(nh.text).toContain('No stored capture is held for AAA: the capture store began recently and many stocks have none.')
    expect(nh.table).toBeUndefined()
    const sf = honest(answerFromExpectedMove(moveEnv({ history: [], store_read: false }, { status: 'partial' }), 'AAA'))
    expect(sf.text).toContain('The stored captures could not be read, which is not the same as none being held.')
    const u = honest(answerFromExpectedMove(UNAVAILABLE, 'AAA'))
    expect(u.text).toMatch(/^I couldn't read AAA's expected move: nothing is held for it at the moment.*That is not the same as no move being priced\. No figure is stated\.$/)
    expect(honest(answerFromExpectedMove(REFUSED, 'AAA')).text).toMatch(/that request wasn't allowed/)
  })
})

// ── earnings.callSearch → stock.callSearch ─────────────────────────────────────────────────────────────────────────────
const SNIPPET = 'we expect <mark>pricing</mark> <mark>power</mark> to hold through the first half …  and margins'
const hit = (symbol, o = {}) => ({ symbol, year: 2026, quarter: 3, date: '2026-11-05 17:00:00', snippet: SNIPPET, score: 9.5, isolated: true, ...o })
const searchEnv = (over = {}, envOver = {}) => envelope(KINDS.callSearch, {
  query: 'pricing power', symbol: null, since: null, total: 57, total_wider: false, hits: [hit('AAA'), hit('BBB', { quarter: 2, date: '2026-08-04' })], expanded: {},
  index: { calls: 1840, oldest: '2026-08-15', newest: '2026-11-12', isolated: true }, ...over,
}, { as_of: '2026-11-12T05:00:00Z', ...envOver })

describe('stock.callSearch — the answer', () => {
  it('one line per call with the index\'s own excerpt, never longer and never as HTML', () => {
    const a = honest(answerFromCallSearch(searchEnv(), 'pricing power'))
    const lines = a.text.split('\n')
    expect(lines[0]).toBe('Earnings calls mentioning "pricing power": 57 calls match; the 2 best matches are shown.')
    expect(lines[1]).toBe('• AAA, Q3 2026 call (Nov 5, 2026): "we expect pricing power to hold through the first half … and margins"')
    expect(lines[2]).toBe('• BBB, Q2 2026 call (Aug 4, 2026): "we expect pricing power to hold through the first half … and margins"')
    expect(a.text).toContain("Each excerpt is quoted from the call's transcript as indexed. The index does not record who was speaking.")
    expect(a.text).toContain("UCT's index holds 1,840 recent earnings calls, dated Aug 15, 2026 to Nov 12, 2026.")
    expect(a.text).toMatch(/Source: UCT's earnings-call transcript index \(third-party transcript text\)\.$/)
    expect(a.text).not.toMatch(/<\/?mark>/)
    expect(a.table.rows[0]).toEqual({ symbol: 'AAA', call: 'Q3 2026', date: 'Nov 5, 2026', excerpt: excerptText(SNIPPET) })
    expect(excerptText(SNIPPET).length).toBeLessThanOrEqual(SNIPPET.length)          // never longer than the server cut it
    expect(a.present).toBeUndefined()
    expect(a.facts).toMatchObject({ query: 'pricing power', total: 57, shown: 2, index_calls: 1840 })
  })
  it('a search within one stock, a widened search and a total wider than the hits are each said', () => {
    const one = honest(answerFromCallSearch(searchEnv({ symbol: 'AAA', since: '2026-10-01', total: 1, hits: [hit('AAA')] }), 'pricing power'))
    expect(one.text.split('\n')[0]).toBe('Earnings calls mentioning "pricing power" for AAA since Oct 1, 2026: 1 call matches.')
    const w = honest(answerFromCallSearch(searchEnv({ total: 31, total_wider: true, expanded: { tariff: ['tariffs', 'duties'], isolated: true } }), 'tariff'))
    expect(w.text.split('\n')[0]).toBe('Earnings calls mentioning "pricing power": 31 calls match.')
    expect(w.text).toContain('The count is of calls that match the words in some form; exact words and quoted phrases were checked only for the calls shown.')
    expect(w.text).toContain('The search was widened: "tariff" also matched "tariffs" and "duties".')
  })
  it('no hit is a finding about the calls the index holds; an empty index or a failed search is never "no mention"', () => {
    const n = honest(answerFromCallSearch(searchEnv({ total: 0, hits: [] }), 'pricing power'))
    expect(n.text.split('\n')[0]).toBe('No indexed earnings call mentions "pricing power". UCT\'s index holds 1,840 recent earnings calls, dated Aug 15, 2026 to Nov 12, 2026, so that is a finding about those calls only.')
    expect(n.table).toBeUndefined()
    const u = honest(answerFromCallSearch(UNAVAILABLE, 'pricing power'))
    expect(u.text).toMatch(/^I couldn't read the earnings call search: it could not be run on UCT's index at the moment .*That is not the same as no call mentioning it\. No excerpt is quoted\.$/)
    expect(u.text).not.toMatch(/No indexed earnings call mentions/)
    expect(honest(answerFromCallSearch(REFUSED, 'x')).text).toMatch(/that request wasn't allowed/)
  })
  it('the query and row limits are the kind\'s own (read from the adapter, never retyped)', () => {
    const src = adapter('earnings_call_search')
    expect(pyInt(src, 'MIN_QUERY')).toBe(CALL_SEARCH_MIN_QUERY)
    expect(pyInt(src, 'MAX_QUERY')).toBe(CALL_SEARCH_MAX_QUERY)
    expect(pyInt(src, 'MAX_LIMIT')).toBe(CALL_SEARCH_MAX_ROWS)
    expect(callQuery('  pricing   power ')).toBe('pricing power')
    for (const bad of ['', 'a', '?!', 'x'.repeat(CALL_SEARCH_MAX_QUERY + 1), null]) expect(callQuery(bad), String(bad)).toBeNull()
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
const reset = () => { _resetAgentConfig(); _resetTurns(); _resetTerminalDataForTest(); _resetTerminalLocalForTest(); _resetTerminalWave2ForTest() }

describe('served vs dark', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'themes', 'earnings', 'highsLows.session', 'levels.darkpool'], 'other kinds only']])('dark (%j, %s): none of the five is registered', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    expect(registerTerminalWave2Capabilities()).toEqual([])
    registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames(), n).not.toContain(n)
  })

  it.each(PAIRS)('served %s alone: only %s is registered, once, and it unregisters cleanly', async (kind, capability) => {
    wire([kind])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([capability])
    expect(registerTerminalWave2Capabilities()).toEqual([])            // idempotent
    reset()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([])
  })

  it('all five served: local-only on BOTH sides, never a plain data read, inside the manifest text limits', async () => {
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
      expect(groupOfAction(name), name).toBe('data')                 // routed with the stock data group (by domain)
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
    ENVS[KINDS.yearly] = yearlyEnv()
    ENVS[KINDS.rotation] = rotationEnv()
    ENVS[KINDS.confluence] = confEnv()
    ENVS[KINDS.expectedMove] = moveEnv()
    ENVS[KINDS.callSearch] = searchEnv()
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    expect((await run(CAPABILITIES.yearly, { side: 'highs', limit: 500 })).text).toMatch(/^New 52-week highs and lows in the session of/)
    expect((await run(CAPABILITIES.rotation, { side: null, limit: null })).text).toMatch(/^UCT theme rotation, 112 themes ranked/)
    expect((await run(CAPABILITIES.confluence, { direction: 'bearish', limit: 5 })).text).toMatch(/^UCT confluence board, dark pool window/)
    expect((await run(CAPABILITIES.expectedMove, { symbol: '$aaa', report_date: null })).text).toMatch(/^AAA expected move: ±8\.40%/)
    expect((await run(CAPABILITIES.callSearch, { q: '  pricing   power ', symbol: 'aaa', since: 'last month', limit: 400 })).text).toMatch(/^Earnings calls mentioning "pricing power"/)
    expect(reads().map(r => [r.kind, r.params, r.purpose])).toEqual([
      [KINDS.yearly, { side: 'highs', limit: 50 }, 'answer'],
      [KINDS.rotation, { side: 'both', limit: 20 }, 'answer'],
      [KINDS.confluence, { direction: 'bear', limit: 5 }, 'answer'],
      [KINDS.expectedMove, { symbol: 'AAA' }, 'answer'],
      [KINDS.callSearch, { q: 'pricing power', limit: 40, symbol: 'AAA' }, 'answer'],
    ])
  })

  it('no read without a turn or without a usable argument, and a refusal is answered in fixed words', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    for (const [name, args] of [[CAPABILITIES.yearly, { side: null, limit: null }], [CAPABILITIES.rotation, { side: null, limit: null }], [CAPABILITIES.confluence, { direction: null, limit: null }],
      [CAPABILITIES.expectedMove, { symbol: 'AAA', report_date: null }], [CAPABILITIES.callSearch, { q: 'tariffs', symbol: null, since: null, limit: null }]]) {
      expect((await getCapability(name).answer(null, args, null)).text, name).toMatch(/needs the Agent's turn/)
    }
    expect((await inTurn(() => getCapability(CAPABILITIES.expectedMove).answer(null, { symbol: 'not a ticker!', report_date: null }, null))).text).toMatch(/^Which stock's expected move/)
    expect((await inTurn(() => getCapability(CAPABILITIES.callSearch).answer(null, { q: '?', symbol: null, since: null, limit: null }, null))).text).toMatch(/^What word or phrase should I search/)
    expect(reads()).toEqual([])
    const a = await inTurn(() => getCapability(CAPABILITIES.confluence).answer(null, { direction: null, limit: null }, null))   // the stub refuses
    expect(a.text).toMatch(/^I couldn't read UCT's confluence board: that request wasn't allowed for this question/)
    expect(reads()).toHaveLength(1)
  })
})

// ── routing: each capability's own words, on the data group only while it is registered ────────────────────────────────
const dataGroup = () => GROUPS.find(g => g.id === 'data')
const DATA_BASE = [...dataGroup().words]                 // read before anything is served: routing.js's own list
const ROUTE_OPTS = () => ({ enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold })
const wordKeys = (text) => KEYS.filter(k => WAVE2_ROUTE_WORDS[k].some(re => re.test(String(text).toLowerCase())))
/** plain member asks, by the capability whose words must name them */
const ASKS = {
  yearly: ['which stocks made new 52-week highs', 'what stocks hit a new 52-week low', 'what is at a 52-week high', 'stocks hitting 52 week lows', 'show me the new 52w highs'],
  rotation: ['which themes are rotating in', 'theme rotation', 'themes rotating out', 'what themes is money rotating into'],
  confluence: ['what is on the confluence board', 'bullish confluence names', 'confluence radar', 'show me the confluence list'],
  expectedMove: ['expected move for NVDA earnings', 'implied move on TSLA', 'what are options pricing in for AAPL', 'how much is NVDA expected to move'],
  callSearch: ['which companies mentioned tariffs on their earnings call', 'search earnings calls for pricing power', 'find mentions of tariffs in call transcripts', 'who talked about ai capex on their last call'],
}
/** another capability's language: none of the five's words may name these */
const NOT_OURS = [
  'how many new 52-week highs today', 'net new 52-week highs', 'what % of stocks made new 52-week highs', 'number of stocks at 52 week lows',   // breadth's measures
  'find stocks near their 52-week highs', 'stocks within 5% of their 52-week high', 'scan for names making new 52-week highs with volume',       // the Screener's
  'find stocks up 20% this month near 52-week highs with volume above average', 'NVDA distance from the 52-week high',
  'alert me when NVDA hits a new 52-week high', 'draw a line at the 52-week high',                                                               // alerts, drawings
  'new highs today', 'stocks hitting new lows of the day',                                                                                      // wave 1's session lists
  "open the rotation map for nvda's sector", 'pull up the relative rotation graph for the nvda sector', 'open the compare panel on the rotation tab',   // the Compare panel
  'use the nord chart theme', 'change the app theme to light', 'compare NVDA with the AI Chips theme', 'which themes are leading this month',
  'turn on confluence on this chart', 'add the confluence indicator', 'open the confluence page',                                               // chart settings, pages
  'scan for stocks with an expected move over 10%', 'alert me if the implied move goes above 8%', 'buy the straddle',
  'buy 5 calls on NVDA', 'add a call option to the chart', 'open the earnings calendar', 'when does NVDA report earnings',
  'any news on TSLA', 'switch to weekly', 'what got upgraded today', 'dark pool levels on NVDA',
]

describe('routing words', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'themes', 'earnings', 'sectors.performance'], 'other kinds only']])('dark (%j, %s): the data group keeps exactly routing.js\'s words', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(dataGroup().words).toEqual(DATA_BASE)
    for (const res of Object.values(WAVE2_ROUTE_WORDS)) for (const re of res) expect(dataGroup().words).not.toContain(re)
    for (const q of [ASKS.yearly[0], ASKS.rotation[0], ASKS.confluence[0]]) expect(wordsSelect('data', q), q).toBe(false)
  })

  it.each(KEYS)('served %s alone: only its own words are added, after routing.js\'s, and they are taken back', async (key) => {
    wire([KINDS[key]])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(dataGroup().words).toEqual([...DATA_BASE, ...WAVE2_ROUTE_WORDS[key]])
    registerTerminalWave2Capabilities()                                // idempotent: never armed twice
    expect(dataGroup().words).toHaveLength(DATA_BASE.length + WAVE2_ROUTE_WORDS[key].length)
    reset()
    expect(dataGroup().words).toEqual(DATA_BASE)
  })

  it('every capability has words, and each ask is named by its own capability\'s words', () => {
    expect(Object.keys(WAVE2_ROUTE_WORDS).sort()).toEqual([...KEYS].sort())
    for (const [key, asks] of Object.entries(ASKS)) for (const q of asks) expect(wordKeys(q), q).toContain(key)
  })

  it('served: each ask routes its capability under v1 and v2, and the budget never cuts the data group', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const [key, asks] of Object.entries(ASKS)) {
      for (const q of asks) {
        expect(wordsSelect('data', q), q).toBe(true)
        expect(selectGroups(q).selected, q).toContain('data')
        for (const route of [routeManifest, routeManifestV2]) {
          const r = route(full, q, ROUTE_OPTS())
          expect(r.manifest.map(c => c.name), `${route.name}: ${q}`).toContain(CAPABILITIES[key])
          expect(r.overBudget || [], `${route.name}: ${q}`).not.toContain('data')
        }
      }
    }
  })

  it('the words never name another capability\'s language', () => {
    for (const q of NOT_OURS) expect(wordKeys(q), q).toEqual([])
  })

  it('wave 1\'s words and wave 2\'s never name the same ask (one capability\'s words per ask)', () => {
    const wave1 = (text) => Object.keys(TERMINAL_ROUTE_WORDS).filter(k => TERMINAL_ROUTE_WORDS[k].some(re => re.test(String(text).toLowerCase())))
    for (const asks of Object.values(ASKS)) for (const q of asks) expect(wave1(q), q).toEqual([])
  })

  it('no row of the routing-collision table that another group owns is named by these words', () => {
    // baseline/routingCollisions.json is asserted under production's kinds, where these words are not armed: this holds it armed
    const stolen = collisions.rows.filter(r => r.owner !== 'data' && !(r.also || []).includes('data') && wordKeys(r.text).length).map(r => `${r.text} (${r.owner})`)
    expect(stolen).toEqual([])
  })
})
