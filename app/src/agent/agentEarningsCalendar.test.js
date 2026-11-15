// P3 earnings calendar — stock.earningsCalendar: the window the member named (ET days), the member's answer (read-back,
// session never guessed, per-row source, past rows with actuals and never worded as upcoming, honest unavailable), the
// watchlist expanded CLIENT-side (only symbols, <= 50, reach the server), served vs dark, LOCAL-ONLY, and routing.
// No model, no provider: /api/agent/config and /api/agent/data are stubbed. Synthetic rows only — never market data.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCapability, allCapabilityNames, manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { turnStart, turnEnd, _resetTurns } from './trace'
import { GROUPS, routeManifest, selectGroups } from './routing'
import { routeManifestV2 } from './nlm1/routingV2'
import {
  CAPABILITY, KIND, MAX_SYMBOLS, windowFor, answerFromCalendar, registerEarningsCalendarCapability, _resetEarningsCalendarForTest,
  earningsCalendarServed, EARNINGS_CALENDAR_ROUTE_WORDS, todayET, dayText,
} from './capabilities/earningsCalendar'

registerBuiltins()

const row = (symbol, date, session, over = {}) => ({ symbol, name: null, date, when: 'upcoming', session, eps_est: 1.25, rev_est_m: 2500,
  eps_act: null, rev_act_m: null, date_estimated: false, source: 'earningswhispers', ...over })
const envelope = (data, over = {}) => ({
  contract: 'MD-1.0', kind: KIND, params_echo: {}, status: 'ok', freshness: 'periodic', as_of: '2026-11-16T13:05:00Z',
  fetched_at: '2026-11-16T15:00:00Z', delay_s: null, stale: false, source: 'earningswhispers', coverage: null, notes: [], provider_calls: 0,
  data: { week_start: '2026-11-16', week_end: '2026-11-20', date: null, session: 'any', rows: [], total: 0, truncated: false,
    excluded: { unknown: 0, other: 0 }, not_on_calendar: [], sources: ['earningswhispers'], today: '2026-11-16', ...data }, ...over,
})

describe('windowFor — the member\'s words → an ET day or week (weekends anchor forward, as the Calendar page does)', () => {
  const MON = '2026-11-16'; const SAT = '2026-11-21'; const FRI = '2026-11-20'
  it.each([
    [{ when: 'today' }, MON, { date: MON }],
    [{ when: 'tomorrow' }, MON, { date: '2026-11-17' }],
    [{ when: 'tomorrow' }, FRI, { date: '2026-11-23' }],                 // Friday → the next session day
    [{ when: 'yesterday' }, MON, { date: '2026-11-13' }],
    [{ when: 'this_week' }, MON, {}],
    [{ when: 'next_week' }, MON, { week: '2026-11-23' }],
    [{ when: 'next_week' }, SAT, { week: '2026-11-30' }],               // Saturday: "this week" is already the coming one
    [{ when: 'last_week' }, MON, { week: '2026-11-09' }],
    [{ when: 'date', date: '2026-12-03' }, MON, { date: '2026-12-03' }],
    [{ when: 'week', date: '2026-12-03' }, MON, { week: '2026-12-03' }],
    [{ when: 'date', date: 'soon' }, MON, {}],                          // a malformed date is the current week, never a guess
    [{ when: 'nonsense' }, MON, {}],
  ])('%j on %s → %j', (args, today, want) => expect(windowFor(args, today)).toEqual(want))
  it('todayET is the New York calendar day', () => {
    expect(todayET(new Date('2026-11-17T03:30:00Z'))).toBe('2026-11-16')      // 22:30 ET on the 16th
    expect(todayET(new Date('2026-11-17T05:30:00Z'))).toBe('2026-11-17')
  })
})

describe('answerFromCalendar — read-back, sessions, sources, past rows, honest refusal', () => {
  it('a week: the read-back line, one table row per reporter, the session never guessed, each row its own source', () => {
    const a = answerFromCalendar(envelope({ rows: [row('AAA', '2026-11-17', 'bmo'), row('BBB', '2026-11-17', 'unknown', { source: 'fmp' }),
      row('CCC', '2026-11-18', 'amc', { source: 'finnhub', date_estimated: true })], total: 3, sources: ['earningswhispers', 'finnhub', 'fmp'] }))
    expect(a.text).toMatch(/^Earnings — the week of Mon Nov 16–Fri Nov 20: 3 reporting\./)
    expect(a.table.rows.map(r => [r.symbol, r.session, r.source])).toEqual([
      ['AAA', 'before the open', 'EarningsWhispers'], ['BBB', 'session not confirmed', 'FMP'], ['CCC', 'after the close', 'Finnhub']])
    expect(a.table.rows[2].date).toBe('Wed Nov 18 (projected)')
    expect(a.text).toMatch(/Source: EarningsWhispers, Finnhub, FMP via UCT's earnings calendar, built 2026-11-16 13:05 UTC\. Schedules can change; this is not a forecast\./)
    expect(a.link.href).toBe('/calendar?week=2026-11-16')
  })
  it('past rows show estimate / actual and are never worded as upcoming', () => {
    const a = answerFromCalendar(envelope({ rows: [row('AAA', '2026-11-10', 'amc', { when: 'past', eps_act: 1.4, rev_act_m: 2600 })], total: 1, week_start: '2026-11-09', week_end: '2026-11-13' },
      { freshness: 'historical', notes: ['dates before today (2026-11-16) have already passed; their rows are reported results, not upcoming reports'] }))
    expect(a.table.columns.map(c => c.label)).toEqual(['Date', 'Session', 'Symbol', 'EPS est / act', 'Rev est / act', 'Source'])
    expect(a.table.rows[0]).toMatchObject({ eps: '$1.25 / $1.40', rev: '$2.50B / $2.60B' })
    expect(a.text).toMatch(/have already passed; their rows are reported results, not upcoming reports/)
    expect(a.text).not.toMatch(/\bupcoming report(?:s)? (?:on|for)\b|\bwill report\b/)
  })
  it('a watchlist read-back, a session filter, and what it left out', () => {
    const a = answerFromCalendar(envelope({ rows: [row('AAA', '2026-11-17', 'bmo')], total: 1, session: 'bmo', excluded: { unknown: 2, other: 1 },
      not_on_calendar: ['ZZZ'] }, { status: 'partial', notes: ['2 reporters with an unconfirmed session (no hour given) were left out of the bmo filter', "not on UCT's calendar for that window: ZZZ (this is not proof they don't report)"] }),
    { listName: 'Core', listMore: 3 })
    expect(a.text).toMatch(/^Earnings — the week of Mon Nov 16–Fri Nov 20 \(your watchlist “Core”, before the open\): 1 reporting\./)
    expect(a.text).toMatch(/2 reporters with an unconfirmed session \(no hour given\) were left out of the bmo filter/)
    expect(a.text).toMatch(/not on UCT's calendar for that window: ZZZ/)
    expect(a.text).toMatch(/your watchlist has 3 more symbols than the 50 read/)
    expect(a.facts.not_on_calendar).toEqual(['ZZZ'])
  })
  it('stale is said', () => {
    expect(answerFromCalendar(envelope({ rows: [row('AAA', '2026-11-17', 'bmo')], total: 1 }, { stale: true })).text).toMatch(/Stale: this is the last good calendar UCT built/)
  })
  it('unavailable / refused: one line with the server\'s reason, no date', () => {
    expect(answerFromCalendar({ status: 'unavailable', data: null, notes: ['UCT has not loaded the earnings calendar for the week of 2026-12-07 yet, so nothing is read for it (opening that week on the Calendar page loads it)'] }).text)
      .toBe("I couldn't read UCT's earnings calendar: UCT has not loaded the earnings calendar for the week of 2026-12-07 yet, so nothing is read for it (opening that week on the Calendar page loads it). No date is stated.")
    expect(answerFromCalendar({ status: 'refused', data: null, notes: ['x'] }).text).toMatch(/wasn't allowed for this question, so no calendar was read\. No date is stated\.$/)
    expect(answerFromCalendar(null).text).toMatch(/could not answer it right now\. No date is stated\.$/)
  })
  it('dayText formats a calendar day without a zone shift', () => expect(dayText('2026-11-16')).toBe('Mon Nov 16'))
})

// ── served vs dark, local-only, routing, and the end-to-end ask ──
let KINDS, calls, ENV
function wire(kinds) {
  KINDS = kinds; calls = []
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    calls.push([u, init?.body ? JSON.parse(init.body) : null])
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: KINDS !== null, scan: false, data_kinds: KINDS || [] })
    if (u === '/api/agent/data') return json(ENV)
    return json({}, 404)
  })
}
const reads = () => calls.filter(c => c[0] === '/api/agent/data').map(c => c[1])
async function inTurn(fn) { turnStart('send'); try { return await fn() } finally { turnEnd() } }
const OPTS = () => ({ enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold })
const calGroup = () => GROUPS.find(g => g.id === 'earningsCalendar')
const NO_ARGS = { when: 'this_week', date: null, symbols: null, watchlist: null, session: null }

const CAL_ASKS = [
  'Who reports earnings this week?',
  "what's on the earnings calendar next week",
  'which stocks report before the open tomorrow?',
  'who is reporting after the close today',
  'which of my watchlist report earnings this week',
  'earnings this week for my core list',
  'what companies report on Thursday?',
]
const NOT_CAL = [
  'When does NVDA report?', 'show me NVDA earnings', 'add the 50 day moving average', 'show me the news on NVDA',
  'how is US breadth now?', 'switch to the weekly', 'Find stocks near new highs', 'what did AAPL earn last quarter',
  'put the earnings strip on my chart', 'open the calendar widget settings',
]

describe('served vs dark', () => {
  beforeEach(() => { _resetAgentConfig(); _resetTurns(); _resetEarningsCalendarForTest(); vi.restoreAllMocks() })
  afterEach(() => { _resetTurns(); _resetEarningsCalendarForTest() })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'earnings', 'cot.positioning'], 'other kinds only']])('dark (%j, %s): not registered, the group has no words, routing unchanged', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    expect(earningsCalendarServed()).toBe(false)
    expect(registerEarningsCalendarCapability()).toBe(false)
    registerServerGatedBuiltins()
    expect(allCapabilityNames()).not.toContain(CAPABILITY)
    expect(calGroup().words).toEqual([])
    const full = manifestFor({ surface: 'charts', createIndicator: true })
    for (const q of CAL_ASKS) expect(selectGroups(q).selected).not.toContain('earningsCalendar')
    expect(routeManifest(full, CAL_ASKS[0], OPTS()).manifest.some(c => c.name === CAPABILITY)).toBe(false)
  })

  it('served: registers once, LOCAL-ONLY, arms the group words, and unregisters cleanly', async () => {
    wire([KIND])
    await loadAgentConfig()
    expect(earningsCalendarServed()).toBe(true)
    registerServerGatedBuiltins()
    expect(allCapabilityNames()).toContain(CAPABILITY)
    expect(getCapability(CAPABILITY).localOnly).toBe(true)
    expect(getCapability(CAPABILITY).query).toBe(true)
    expect(registerEarningsCalendarCapability()).toBe(false)
    expect(calGroup().words).toEqual(EARNINGS_CALENDAR_ROUTE_WORDS)
    expect(calGroup().wordsOnly && calGroup().fillLast).toBe(true)
    expect(GROUPS.at(-1).id).toBe('earningsCalendar')                 // last in the catalog
    _resetEarningsCalendarForTest()
    expect(allCapabilityNames()).not.toContain(CAPABILITY)
    expect(calGroup().words).toEqual([])
  })

  it('routing (served): every calendar ask routes the group under v1 and v2; single-stock and other asks do not', async () => {
    wire([KIND])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const q of CAL_ASKS) {
      expect(selectGroups(q.toLowerCase()).selected, q).toContain('earningsCalendar')
      for (const route of [routeManifest, routeManifestV2]) {
        const r = route(full, q, OPTS())
        expect(r.manifest.map(c => c.name), `${route.name}: ${q}`).toContain(CAPABILITY)
      }
    }
    for (const q of NOT_CAL) {
      expect(selectGroups(q.toLowerCase()).selected, q).not.toContain('earningsCalendar')
      expect(routeManifestV2(full, q, OPTS()).manifest.map(c => c.name), `v2: ${q}`).not.toContain(CAPABILITY)
    }
  })

  it('served: the fill for a message nothing recognised never carries the words-only group', async () => {
    wire([KIND])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const q of ['flip to AMD', 'lose the gridlines', 'any articles on RIVN lately', 'both', 'hmm']) {
      for (const route of [routeManifest, routeManifestV2]) expect(route(full, q, OPTS()).manifest.map(c => c.name), `${route.name}: ${q}`).not.toContain(CAPABILITY)
    }
  })

  it('end to end: ONE read with the window, purpose answer; the answer is the read-back', async () => {
    wire([KIND])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENV = envelope({ rows: [row('AAA', '2026-11-17', 'bmo')], total: 1 })
    const a = await inTurn(() => getCapability(CAPABILITY).answer(null, { ...NO_ARGS, when: 'next_week', session: 'bmo' }))
    expect(a.text).toMatch(/^Earnings — the week of/)
    const r = reads()
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ kind: KIND, purpose: 'answer', params: { session: 'bmo', limit: 50 } })
    expect(r[0].params.week).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(r[0].params).not.toHaveProperty('symbols')
  })

  it('a watchlist is expanded HERE: only its symbols (deduped, upper-case, at most 50) reach the server — never the list', async () => {
    wire([KIND])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENV = envelope({ rows: [], total: 0 })
    const items = Array.from({ length: 60 }, (_, i) => ({ sym: `s${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}` }))
    const host = { watchlists: {
      snapshot: () => [{ id: 'w1', name: 'Core', items, shownIn: [], editable: true }],
      fetchList: vi.fn(async () => ({ id: 'w1', name: 'Core', items })),
    } }
    const a = await inTurn(() => getCapability(CAPABILITY).answer(null, { ...NO_ARGS, watchlist: 'core' }, host))
    const p = reads()[0].params
    expect(p.symbols).toHaveLength(MAX_SYMBOLS)
    expect(p.symbols.every(s => s === s.toUpperCase())).toBe(true)
    expect(JSON.stringify(reads()[0])).not.toMatch(/Core|w1|watchlist/)
    expect(a.text).toMatch(/your watchlist “Core”/)
    expect(a.text).toMatch(/your watchlist has 10 more symbols than the 50 read/)
  })

  it('no open turn, an unknown watchlist, or an empty one: a plain sentence and no read', async () => {
    wire([KIND])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect((await getCapability(CAPABILITY).answer(null, NO_ARGS)).text).toBe("I couldn't read UCT's earnings calendar: this needs the Agent's turn, which wasn't available.")
    const host = { watchlists: { snapshot: () => [{ id: 'w2', name: 'Empty', items: [], shownIn: [], editable: true }], fetchList: async () => ({ id: 'w2', name: 'Empty', items: [] }) } }
    expect((await inTurn(() => getCapability(CAPABILITY).answer(null, { ...NO_ARGS, watchlist: 'nope' }, host))).text).toMatch(/couldn't find a watchlist called “nope”/)
    expect((await inTurn(() => getCapability(CAPABILITY).answer(null, { ...NO_ARGS, watchlist: 'empty' }, host))).text).toMatch(/is empty/)
    expect(reads()).toEqual([])
  })
})
