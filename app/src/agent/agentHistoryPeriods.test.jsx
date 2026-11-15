// Phase 2 history (hist-builder): (1) `stock.dailyBars` gains `periods` (weekly / monthly closes and changes over the
// bars.daily kind's tf = W | M) and `compare` (2–3 symbols' performance over the SAME periods) — a forming week / month
// is said to be partial, never a closed bar; every figure in the prose comes from the envelope (grounding); rows before
// 2003-09-10 are labelled yfinance; (2) `history.afterEvent` gains `day_pct` ("after it fell 3% in a day") and `last`
// ("the last 5 times"), states its sample every time, and declines an earnings-date study in fixed words. Dark by
// default; one resolve, then one read per symbol. No model, no provider.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { fastParse } from './fastPath'
import { resolveEnvelope } from './marketdata/__fixtures__/fakeResolve'
import { match as barsMatch, CAPABILITY as BARS, _resetBarsForTest } from './capabilities/marketDataBars'
import { registerMarketDataCapabilities, _resetForTest } from './capabilities/marketDataQuote'
import { answerFromPeriods, answerFromCompare, periodWindow, PRE_FLOOR } from './capabilities/marketDataPeriods'
import { money, signedPct } from './capabilities/marketDataFormat'
import {
  answerFromEventStudy, match as histMatch, sampleLine, _resetHistoryForTest, CAPABILITY as HIST, KIND, DESCRIPTIVE, DEFAULT_HORIZONS, EARNINGS_DECLINE,
} from './capabilities/history'

let TURN = 't-hist2'
vi.mock('./trace', async (orig) => ({ ...(await orig()), currentTurnId: () => TURN }))
registerBuiltins()

// ── fixtures: friday-keyed weekly rows (the server's shape) ─────────────────────────────────────────────────────
const FRIDAYS = ['2025-01-03', '2025-01-10', '2025-01-17', '2025-01-24', '2025-01-31']
function wk(date, close, change, o = {}) {
  const d = new Date(`${date}T12:00:00Z`)
  const mon = new Date(d.getTime() - 4 * 86400000).toISOString().slice(0, 10)
  return { date, first_session: mon, last_session: date, sessions: 5, open: close - 1, high: close + 2, low: close - 3, close, volume: 5000, change_pct: change, partial: false, ...o }
}
function periodsEnv(rows, o = {}, data = {}) {
  const last = rows[rows.length - 1]
  return { contract: 'MD-1.0', kind: 'bars.daily', params_echo: {}, status: 'ok', freshness: 'historical', as_of: `${last.last_session}T21:00:00Z`,
    fetched_at: '2025-02-01T16:00:00Z', delay_s: null, stale: false, source: 'uct-bars', coverage: null, provider_calls: 0,
    notes: ['a server note that must never be echoed'],
    data: { symbol: 'NVDA', timeframe: 'W', bars: rows, through: last.last_session, latest_completed_session: last.last_session, current_period_partial: !!last.partial, ...data }, ...o }
}
const CLOSES = [100, 104.5, 101.2, 108.9, 110.4]
const CHG = [null, 4.5, -3.157894736842, 7.608695652174, 1.377410468320]
const ROWS = FRIDAYS.map((d, i) => wk(d, CLOSES[i], CHG[i]))
const FORMING = [...ROWS.slice(0, 4), wk('2025-01-31', 109.1, 0.183654729109, { last_session: '2025-01-29', sessions: 3, partial: true, partial_reason: 'forming' })]

// every number the prose may carry: the facts' own closes / changes, the derived window change, counts and date parts
function groundedNumbers(rows, extra = []) {
  const out = new Set()
  const add = (s) => { for (const t of String(s).match(/\d[\d,]*(?:\.\d+)?/g) || []) out.add(t) }
  for (const r of rows) {
    add(money(r.close)); if (r.change_pct != null) add(signedPct(r.change_pct)); add(r.sessions)
    for (const d of [r.date, r.first_session, r.last_session]) { const [y, , dd] = d.split('-'); add(y); add(String(Number(dd))) }
  }
  add(rows.length); add(rows.length - 1); for (const e of extra) add(e)
  add('2003'); add('10')                                  // the fixed yfinance-floor sentence
  return out
}
const numbersIn = (text) => String(text).match(/\d[\d,]*(?:\.\d+)?/g) || []

describe('stock.dailyBars periods / compare (pure)', () => {
  it('weekly closes: each week by its Friday, change vs the previous close, the window change — every figure grounded in the facts', () => {
    const a = answerFromPeriods(periodsEnv(ROWS), { symbol: 'NVDA', name: 'NVIDIA Corporation', want: 5 })
    const lines = a.text.split('\n')
    expect(lines[0]).toBe("NVDA (NVIDIA Corporation) weekly closes, 5 weeks from the week ending Fri, Jan 3 to the week ending Fri, Jan 31; each change is vs the previous week's close:")
    expect(lines[2]).toBe('• week ending Fri, Jan 10: close $104.50 (+4.50%).')
    expect(lines).toContain('From the week ending Fri, Jan 3 close of $100.00 to the week ending Fri, Jan 31 close of $110.40: +10.40%.')
    expect(a.text).not.toMatch(/still forming|never be echoed|\blive\b/)
    const total = signedPct((110.4 / 100 - 1) * 100)
    const allowed = groundedNumbers(ROWS, [total, 3, 1])                // 3 up, 1 down: counted from the change_pct facts
    for (const n of numbersIn(a.text)) expect(allowed.has(n), `ungrounded number ${n}`).toBe(true)
    expect(a.table.rows.map(r => r.period)).toEqual(['Fri, Jan 3', 'Fri, Jan 10', 'Fri, Jan 17', 'Fri, Jan 24', 'Fri, Jan 31'])
    expect(a.present.kind).toBe('table')
  })

  it('a FORMING week is labelled partial in its row, its table note and its own sentence — never a closed week', () => {
    const a = answerFromPeriods(periodsEnv(FORMING), { symbol: 'NVDA', want: 5 })
    const lines = a.text.split('\n')
    expect(lines.at(-2)).not.toBe('')
    expect(lines).toContain('• week ending Fri, Jan 31: close $109.10 (+0.18%) — forming: partial, not a closed week.')
    expect(lines).toContain('The week ending Fri, Jan 31 is still forming (3 sessions held, through Wed, Jan 29): it is partial, not a closed week.')
    expect(a.table.rows.at(-1).note).toBe('forming: partial, not a closed week')
    // the best / worst summary counts CLOSED weeks only: the forming week is never ranked
    const summary = lines.find(l => l.startsWith('Of the'))
    expect(summary).toMatch(/^Of the 3 closed weeks with a change:/)
    const allowed = groundedNumbers(FORMING, [signedPct((109.1 / 100 - 1) * 100), 2, 1])
    for (const n of numbersIn(a.text)) expect(allowed.has(n), `ungrounded number ${n}`).toBe(true)
  })

  it('monthly, stale, short and pre-2003 rows are said plainly; no usable rows answers in fixed words', () => {
    const m = [{ ...wk('2003-08-01', 20, null), first_session: '2003-08-01', last_session: '2003-08-29', pre_vendor_floor: true },
      { ...wk('2003-09-01', 21, 5), first_session: '2003-09-02', last_session: '2003-09-30', pre_vendor_floor: true },
      { ...wk('2003-10-01', 22, 4.761904761905), first_session: '2003-10-01', last_session: '2003-10-31' }]
    const a = answerFromPeriods(periodsEnv(m, { stale: true }, { timeframe: 'M', latest_completed_session: '2003-11-03' }), { symbol: 'MSFT', want: 6 })
    expect(a.text.split('\n')[0]).toMatch(/^MSFT monthly closes, 3 months from the Aug 2003 to the Oct 2003/)
    expect(a.text).toContain(PRE_FLOOR)
    expect(a.text).toMatch(/Only 3 months are held, fewer than the 6 asked for\./)
    expect(a.text).toMatch(/so the newest month is not up to date\./)
    expect(a.table.rows[0].note).toBe('yfinance history')
    expect(answerFromPeriods({ status: 'unavailable', data: null }, { symbol: 'zzzz' }).text).toBe("I couldn't answer that for ZZZZ: its weekly / monthly bars are not available from UCT's market data. No price is stated.")
  })

  it('compare: the same weeks for every symbol (only the keys all hold), ranked, grounded; a forming last week is said', () => {
    const msft = [wk('2025-01-10', 400, 1), wk('2025-01-17', 390, -2.5), wk('2025-01-24', 410, 5.128205128205), wk('2025-01-31', 420, 2.43902439, { last_session: '2025-01-29', sessions: 3, partial: true, partial_reason: 'forming' })]
    const aapl = FORMING
    const a = answerFromCompare([periodsEnv(aapl, {}, { symbol: 'AAPL' }), periodsEnv(msft, {}, { symbol: 'MSFT' })], { symbols: ['AAPL', 'MSFT'], names: { AAPL: 'Apple Inc.' } })
    const lines = a.text.split('\n')
    expect(lines[0]).toBe('Relative performance on weekly closes, from the week ending Fri, Jan 10 close to the week ending Fri, Jan 31 close (3 weeks):')
    const pa = signedPct((109.1 / 104.5 - 1) * 100), pm = signedPct((420 / 400 - 1) * 100)
    expect(lines[1]).toBe(`• MSFT: ${pm} ($400.00 → $420.00).`)
    expect(lines[2]).toBe(`• AAPL (Apple Inc.): ${pa} ($104.50 → $109.10).`)
    expect(lines).toContain('The week ending Fri, Jan 31 is still forming: its close is the latest completed session\'s, not a closed week.')
    const allowed = groundedNumbers([...aapl, ...msft], [pa, pm])
    for (const n of numbersIn(a.text)) expect(allowed.has(n), `ungrounded number ${n}`).toBe(true)
    expect(answerFromCompare([periodsEnv(aapl), { status: 'unavailable', data: null }], { symbols: ['AAPL', 'ZZZZ'] }).text).toMatch(/for ZZZZ are not available.*No price is stated\.$/)
  })

  it('periodWindow: years, since, ytd and "the last N" (never a guess)', () => {
    expect(periodWindow('in 2024', 'M', '2026-11-13')).toEqual({ from: '2024-01-01', to: '2024-12-31', word: '2024' })
    expect(periodWindow('in 2026', 'M', '2026-11-13')).toEqual({ from: '2026-01-01', to: null, word: '2026' })
    expect(periodWindow('since 2020', 'W', '2026-11-13')).toMatchObject({ from: '2020-01-01', to: null })
    expect(periodWindow('over the last year', 'W', '2026-11-13')).toMatchObject({ periods: 52 })
    expect(periodWindow('the past 6 months', 'W', '2026-11-13')).toMatchObject({ periods: 26 })
    expect(periodWindow('last 3 years', 'M', '2026-11-13')).toMatchObject({ periods: 36 })
    expect(periodWindow('last 10 weeks', 'M', '2026-11-13')).toHaveProperty('why')
    expect(periodWindow('in 2031', 'M', '2026-11-13')).toHaveProperty('why')
    expect(periodWindow('last 30 years', 'M', '2026-11-13')).toHaveProperty('why')
    expect(periodWindow('whenever', 'W', '2026-11-13')).toBeUndefined()
    expect(periodWindow('', 'W', '2026-11-13')).toBeNull()
  })
})

// ── served vs dark ──────────────────────────────────────────────────────────────────────────────────────────────
const STUDY = {
  contract: 'MD-1.0', kind: KIND, params_echo: {}, status: 'ok', freshness: 'historical', as_of: '2026-10-30T20:00:00Z', fetched_at: '2026-11-03T15:30:05Z',
  delay_s: null, stale: false, source: 'uct-market-intel', coverage: null, provider_calls: 0, notes: [],
  data: {
    symbol: 'SPY', request: { condition: { series: { kind: 'technical', symbol: 'SPY', indicator: 'day_pct' }, op: 'below', threshold: -3 } },
    study: { lead: 'SPY one-day change, close vs the previous close (%) below −3.0%: 5 events between 2020-01-03 and 2026-10-30 (first session of each run). Forward SPY price returns from the event-day close:', text: 'x', table: null, caveats: ['Small sample: fewer than 10 completed outcomes in at least one window.'] },
    summary: { status: 'ok', events_used: 5, events_detected: 41, overlapping_events: 0, study_start: '2020-01-03', study_end: '2026-10-30', price_last: '2026-10-30', price_first: '2020-01-02', horizons: [], small_sample: true, series_label: 'SPY one-day change', last: 5, events_before_last: 36 },
    coverage: { price_first: '2020-01-02', price_last: '2026-10-30' }, method: {}, notes: [],
  },
}
let calls
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
function wire(kinds) {
  calls = []
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push([u, body])
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: kinds !== null, scan: false, data_kinds: kinds || [] })
    if (u === '/api/agent/data') {
      if (body.kind === 'instrument.resolve') return json(resolveEnvelope(body.params))
      if (body.kind === KIND) return json({ ...STUDY, params_echo: body.params })
      if (body.kind === 'bars.daily') return json(periodsEnv(ROWS, { params_echo: body.params }, { symbol: body.params.symbol, timeframe: body.params.tf || 'W' }))
    }
    if (u.startsWith('/api/live-prices')) throw new Error('an Agent read called /api/live-prices')
    return json({}, 404)
  })
}
const reads = () => calls.filter(c => c[0] === '/api/agent/data').map(c => c[1])

describe('stock.dailyBars periods / compare: served vs dark', () => {
  beforeEach(() => { _resetAgentConfig(); _resetForTest(); _resetBarsForTest(); _resetHistoryForTest(); vi.restoreAllMocks() })
  afterEach(() => { _resetForTest(); _resetBarsForTest(); _resetHistoryForTest() })

  it('dark: the new shapes claim nothing', async () => {
    wire(null)
    await loadAgentConfig()
    expect(barsMatch('monthly returns for NVDA in 2024')).toBeNull()
    expect(fastParse('compare AAPL and MSFT weekly over the last year', {})).toBeNull()
  })

  it('served: the fast path reads the shapes; a bare comparison or an unreadable window is never claimed', async () => {
    wire(['bars.daily', 'instrument.resolve'])
    await loadAgentConfig()
    registerMarketDataCapabilities()
    const p = (q) => barsMatch(q)?.params
    expect(p('monthly returns for NVDA in 2024')).toEqual({ symbol: 'NVDA', measure: 'periods', sessions: null, date: '2024-12-31', from: '2024-01-01', timeframe: 'M', symbols: [] })
    expect(p("NVDA's weekly closes over the last 10 weeks")).toEqual({ symbol: 'NVDA', measure: 'periods', sessions: 10, date: null, from: null, timeframe: 'W', symbols: [] })
    expect(p('show me AMD monthly performance since 2020')).toMatchObject({ measure: 'periods', from: '2020-01-01', date: null, timeframe: 'M' })
    expect(p('NVDA weekly bars')).toMatchObject({ measure: 'periods', sessions: null, timeframe: 'W' })
    expect(p('compare AAPL and MSFT weekly over the last year')).toEqual({ symbol: 'AAPL', measure: 'compare', sessions: 52, date: null, from: null, timeframe: 'W', symbols: ['MSFT'] })
    expect(p('compare AAPL, MSFT and GOOGL monthly performance in 2024')).toMatchObject({ measure: 'compare', timeframe: 'M', from: '2024-01-01', date: '2024-12-31', symbols: ['MSFT', 'GOOGL'] })
    expect(p('AAPL vs MSFT over the last 3 years')).toMatchObject({ measure: 'compare', timeframe: 'M', sessions: 36 })
    expect(barsMatch('compare nvda with amd')).toBeNull()
    expect(barsMatch('compare AAPL and MSFT weekly whenever')).toBeNull()
    expect(barsMatch('weekly returns for the market in 2024')).toBeNull()
    for (const q of ['monthly returns for NVDA in 2024', 'compare AAPL and MSFT weekly over the last year']) expect(fastParse(q, {})).toMatchObject({ ops: [{ action: BARS }] })
  })

  it('served: ONE resolve, then one W / M read per symbol (a comparison reads one base period more)', async () => {
    wire(['bars.daily', 'instrument.resolve'])
    await loadAgentConfig()
    registerMarketDataCapabilities()
    const cap = getCapability(BARS)
    const a = await cap.answer(null, { symbol: 'NVDA', measure: 'periods', sessions: null, date: '2024-12-31', from: '2024-01-01', timeframe: 'M', symbols: [] })
    expect(reads().map(b => [b.kind, b.params])).toEqual([['instrument.resolve', { symbols: [{ text: 'NVDA', form: 'upper' }] }], ['bars.daily', { symbol: 'NVDA', tf: 'M', from: '2024-01-01', to: '2024-12-31' }]])
    expect(a.text).toMatch(/^NVDA \(NVIDIA Corporation\) monthly closes/)
    calls.length = 0
    const c = await cap.answer(null, { symbol: 'AAPL', measure: 'compare', sessions: 52, date: null, from: null, timeframe: 'W', symbols: ['MSFT'] })
    expect(reads().map(b => b.kind)).toEqual(['instrument.resolve', 'bars.daily', 'bars.daily'])
    expect(reads().slice(1).map(b => b.params)).toEqual([{ symbol: 'AAPL', tf: 'W', bars: 53 }, { symbol: 'MSFT', tf: 'W', bars: 53 }])
    expect(c.text).toMatch(/^Relative performance on weekly closes/)
    // old arg shapes (no timeframe / symbols) still validate; a lone compare or a daily timeframe asks
    expect(await cap.answer(null, { symbol: 'AAPL', measure: 'compare', sessions: 10, date: null, from: null, timeframe: 'W', symbols: [] })).toMatch(/^Which tickers\?/)
    expect(await cap.answer(null, { symbol: 'AAPL', measure: 'periods', sessions: 10, date: null, from: null, timeframe: 'D', symbols: null })).toMatch(/^Daily closes are answered per session/)
    expect(await cap.answer(null, { symbol: 'AAPL', measure: 'periods', sessions: 999, date: null, from: null, timeframe: 'W', symbols: null })).toMatch(/^Over how many weeks\?/)
  })
})

describe('history.afterEvent: day_pct, last N, the sample line, the earnings decline', () => {
  beforeEach(() => { _resetAgentConfig(); _resetForTest(); _resetBarsForTest(); _resetHistoryForTest(); vi.restoreAllMocks() })
  afterEach(() => { _resetForTest(); _resetBarsForTest(); _resetHistoryForTest() })

  it('the answer states the sample (events, window, how many earlier events were left out) before the descriptive line', () => {
    const a = answerFromEventStudy(STUDY, { symbol: 'SPY', indicator: 'day_pct' })
    const lines = a.text.split('\n')
    expect(lines.at(-3)).toBe('Sample: 5 past events between Fri, Jan 3, 2020 and Fri, Oct 30, 2026 (the most recent 5 asked for; 36 earlier ones left out). Past results are a small sample of history, not a forecast.')
    expect(lines.at(-2)).toBe(DESCRIPTIVE)
    expect(sampleLine({ data: { summary: { events_used: 1, study_start: null, study_end: null } } })).toBe('Sample: 1 past event. Past results are a small sample of history, not a forecast.')
    expect(sampleLine({ data: {} })).toBeNull()
    expect(a.text).not.toMatch(/\bwill\b|\bexpect(?:ed)?\b|\bpredicts? (?!future)/i)
  })

  it('served: one-day moves and "the last N times" take the fast path; an earnings-WINDOW study is declined in fixed words', async () => {
    wire([KIND, 'instrument.resolve'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const p = (q) => histMatch(q)?.params
    expect(p('what happened to SPY after the last 5 times it fell 3% in a day')).toEqual({ symbol: 'SPY', indicator: 'day_pct', period: null, op: 'below', threshold: -3, horizons: [...DEFAULT_HORIZONS], since: null, last: 5 })
    expect(p('how does SPY do after 3% down days')).toEqual({ symbol: 'SPY', indicator: 'day_pct', period: null, op: 'below', threshold: -3, horizons: [...DEFAULT_HORIZONS], since: null })
    expect(p('how has NVDA done after a 5% up day since 2018')).toMatchObject({ indicator: 'day_pct', op: 'above', threshold: 5, since: '2018-01-01' })
    expect(p('what happens to QQQ after it drops 2.5% in a single day')).toMatchObject({ symbol: 'QQQ', op: 'below', threshold: -2.5 })
    expect(p('what happened to AMD after the last 3 times it rose 8% in one day')).toMatchObject({ op: 'above', threshold: 8, last: 3 })
    expect(histMatch('what happened to SPY after the last 99 times it fell 3% in a day')).toBeNull()
    expect(histMatch('what happened to it after the last 5 times it fell 3% in a day')).toBeNull()
    // the earlier shapes are unchanged (no `last` key)
    expect(p('how has NVDA behaved after 5%+ gaps')).toEqual({ symbol: 'NVDA', indicator: 'gap_pct', period: null, op: 'above', threshold: 5, horizons: [...DEFAULT_HORIZONS], since: null })
    expect(histMatch('how does NVDA typically do the week after earnings')).toEqual({ say: EARNINGS_DECLINE })
    expect(histMatch('what happens to AAPL in the days following its earnings reports')).toEqual({ say: EARNINGS_DECLINE })
    expect(fastParse('how does NVDA typically do the week after earnings', {})).toEqual({ kind: 'say', text: EARNINGS_DECLINE })
    expect(EARNINGS_DECLINE).toMatch(/No figure is stated\.$/)
    expect(EARNINGS_DECLINE).not.toMatch(/\d+(?:\.\d+)?\s?%(?!\+? gaps|\+? in a day| in a day)/)
    expect(histMatch('how has NVDA behaved after earnings')).toBeNull()                       // the model's (it may offer a gap study)
    expect(fastParse('what happened to SPY after the last 5 times it fell 3% in a day', {})).toMatchObject({ ops: [{ action: HIST }] })
  })

  it('served: the study read carries `last` only when asked', async () => {
    wire([KIND, 'instrument.resolve'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const cap = getCapability(HIST)
    await cap.answer(null, { symbol: 'SPY', indicator: 'day_pct', period: null, op: 'below', threshold: -3, horizons: null, since: null, last: 5 })
    expect(reads().at(-1).params).toEqual({ symbol: 'SPY', indicator: 'day_pct', period: null, op: 'below', threshold: -3, horizons: [1, 5, 21], last: 5 })
    await cap.answer(null, { symbol: 'SPY', indicator: 'day_pct', period: 14, op: 'below', threshold: -3, horizons: null, since: null })
    expect(reads().at(-1).params).toEqual({ symbol: 'SPY', indicator: 'day_pct', period: null, op: 'below', threshold: -3, horizons: [1, 5, 21] })
  })
})
