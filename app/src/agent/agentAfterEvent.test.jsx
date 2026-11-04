// W2-B2 (builder-b): historical analysis in the browser — (1) `stock.dailyBars` gains offHigh, pullbacks and a
// "from X to Y" window over the adapter's `from` (pure answers from fixture envelopes, the fast path, one read);
// (2) `history.afterEvent` over the MD-1 `history.eventStudy` kind: the member sees the study's table and text with
// "descriptive, not predictive" and a dated freshness line, it is LOCAL ONLY (localOnly + the server handshake), the
// gap question takes the fast path, ONE read after instrument.resolve, fixed no-study words, dark by default.
// No model, no provider.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handshake from './__fixtures__/program/isolation.json'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { allCapabilityNames, getCapability, manifestFor } from './capabilities'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { fastParse } from './fastPath'
import { presentOf } from './present'
import { resolveEnvelope } from './marketdata/__fixtures__/fakeResolve'
import { answerFromBars, pullbacksOf, windowFor, match as barsMatch, CAPABILITY as BARS, MIN_PULLBACK_PCT, _resetBarsForTest } from './capabilities/marketDataBars'
import { registerMarketDataCapabilities, _resetForTest } from './capabilities/marketDataQuote'
import {
  answerFromEventStudy, answerAfterEvent, freshnessLine, match, historyServed, registerHistoryCapability, _resetHistoryForTest,
  CAPABILITY, KIND, DESCRIPTIVE, DEFAULT_HORIZONS, BREADTH_DECLINE,
} from './capabilities/history'

let TURN = 't-history'
vi.mock('./trace', async (orig) => ({ ...(await orig()), currentTurnId: () => TURN }))
registerBuiltins()

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────
function sessions(n, end = '2026-10-30') {
  const out = []
  const d = new Date(`${end}T12:00:00Z`)
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
const bar = (date, close, o = {}) => ({ date, open: close - 1, high: close + 1, low: close - 2, close, volume: 1000, ...o })
function barsEnv(bars, o = {}) {
  const through = bars.length ? bars[bars.length - 1].date : null
  return { contract: 'MD-1.0', kind: 'bars.daily', params_echo: { symbol: 'NVDA' }, status: 'ok', freshness: 'historical',
    as_of: through ? `${through}T20:00:00Z` : null, fetched_at: '2026-11-02T16:00:00Z', delay_s: null, stale: false,
    source: 'uct-bars', coverage: null, provider_calls: 0, notes: ['a note that must never be echoed'],
    data: { symbol: 'NVDA', bars, through, latest_completed_session: through }, ...o }
}
const says = (a) => (typeof a === 'string' ? a : a.text)
// closes: 100 → 110 (peak) → 100 (−9.09 %) → 112 (recovered, new peak) → 108 (−3.57 %) → 113 (recovered) → 105 (current, −7.08 %)
const PATH = [100, 104, 110, 106, 100, 103, 112, 110, 108, 113, 109, 105]
const DS = sessions(PATH.length)
const PB_BARS = DS.map((d, i) => bar(d, PATH[i]))

describe('stock.dailyBars W2-B2 measures (pure)', () => {
  it('offHigh: the distance below the highest high, both dates named, the window said', () => {
    const t = says(answerFromBars(barsEnv(PB_BARS), { symbol: 'NVDA', measure: 'offHigh' }))
    expect(t.split('\n')[0]).toBe('NVDA closed at $105.00 on Fri, Oct 30, 7.89% ($9.00) below its 12-session high of $114.00 on Wed, Oct 28 (the highest high of the 12 completed sessions held, less than a full 52 weeks, Thu, Oct 15 to Fri, Oct 30).')
    expect(t).toMatch(/completed sessions only, today's session is not included\.$/)
    expect(t).not.toMatch(/never be echoed|\blive\b/)
    const at = says(answerFromBars(barsEnv([bar('2026-10-29', 100), bar('2026-10-30', 103, { high: 103 })]), { symbol: 'NVDA', measure: 'offHigh' }))
    expect(at).toMatch(/^NVDA closed at \$103\.00 on Fri, Oct 30, at its 2-session high/)
    const full = says(answerFromBars(barsEnv(sessions(252).map((d, i) => bar(d, 100 + (i % 50)))), { symbol: 'NVDA', measure: 'offHigh' }))
    expect(full).toMatch(/below its 52-week high of \$150\.00 on .* \(the highest high of the last 252 completed sessions, /)
  })
  it('pullbacksOf: close-to-close episodes of 3%+ with their peak, low, recovery and the one in progress', () => {
    const { current, completed } = pullbacksOf(PB_BARS)
    expect(completed.map(p => [p.peak.close, p.trough.close, p.recovered.close, Number(p.depthPct.toFixed(2)), p.toLow, p.toRecover]))
      .toEqual([[110, 100, 112, -9.09, 2, 2], [112, 108, 113, -3.57, 2, 1]])
    expect(current).toMatchObject({ peak: expect.objectContaining({ close: 113 }), sessions: 2 })
    expect(current.depthPct).toBeCloseTo(-7.08, 2)
    expect(pullbacksOf([bar('2026-10-29', 100), bar('2026-10-30', 101)])).toEqual({ current: null, completed: [] })
    expect(MIN_PULLBACK_PCT).toBe(3)
  })
  it('pullbacks: the current pullback beside the last three completed ones, as a table and a sentence each', () => {
    const a = answerFromBars(barsEnv(PB_BARS), { symbol: 'NVDA', measure: 'pullbacks' })
    const lines = a.text.split('\n')
    expect(lines[0]).toBe('NVDA is in a pullback: the close of $105.00 on Fri, Oct 30 is −7.08% from its highest close of the window, $113.00 on Wed, Oct 28, 2 sessions ago.')
    expect(lines[1]).toBe('The last 2 completed pullbacks of 3%+ (close to close) over the 12 completed sessions from Thu, Oct 15 to Fri, Oct 30:')
    expect(lines[2]).toBe('• −3.57% over 2 sessions: peak $112.00 on Fri, Oct 23 → low $108.00 on Tue, Oct 27, recovered Wed, Oct 28 (1 session after the low).')
    expect(lines[3]).toBe('• −9.09% over 2 sessions: peak $110.00 on Mon, Oct 19 → low $100.00 on Wed, Oct 21, recovered Fri, Oct 23 (2 sessions after the low).')
    expect(lines.at(-2)).toBe('Pullbacks are measured close to close, so an intraday low can be deeper.')
    expect(a.table.rows.map(r => r.depth)).toEqual(['−7.08% now', '−3.57%', '−9.09%'])
    expect(a.table.rows[0].recovered).toBe('not yet')
    expect(a.present.kind).toBe('table')
    expect(presentOf(a, { message: 'compare this pullback in NVDA to the last three' }).kind).toBe('table')
    const none = says(answerFromBars(barsEnv([bar('2026-10-29', 100), bar('2026-10-30', 101)]), { symbol: 'NVDA', measure: 'pullbacks' }))
    expect(none).toMatch(/^NVDA closed at its highest close of the window, \$101\.00 on Fri, Oct 30 — no pullback is in progress\.\nNo completed pullback of 3%\+ \(close to close\) in the 2 completed sessions/)
  })
  it('range from X to Y: the window wording, and a store that does not reach `from` is said', () => {
    const ds = sessions(4)
    const e = barsEnv(ds.map((d, i) => bar(d, 100 + i)))
    e.data.window_from = '2026-10-27'
    const t = says(answerFromBars(e, { symbol: 'NVDA', measure: 'range', date: { to: '2026-10-30', word: 'oct 30', from: '2026-10-27' } }))
    expect(t.split('\n')[0]).toBe('NVDA from Tue, Oct 27 to Fri, Oct 30 (4 completed sessions, Tue, Oct 27 to Fri, Oct 30): high $104.00 on Fri, Oct 30, low $98.00 on Tue, Oct 27. Close $103.00 on Fri, Oct 30.')
    const short = says(answerFromBars({ ...e, status: 'partial' }, { symbol: 'NVDA', measure: 'range', date: { to: '2026-10-30', word: 'oct 30', from: '2026-10-01' } }))
    expect(short).toContain("Note: UCT's bars for NVDA start Tue, Oct 27, after Thu, Oct 1, so the window is shorter than asked.")
  })
  it('windowFor: from + to, from after to refused, from alone leaves `to` to the adapter', () => {
    expect(windowFor('range', null, '2026-10-15', '2026-10-01')).toEqual({ date: { to: '2026-10-15', word: '2026-10-15', from: '2026-10-01' }, sessions: null })
    expect(windowFor('range', null, '2026-10-01', '2026-10-15').why).toMatch(/is after .* the window's start must come first/)
    expect(windowFor('range', null, null, '2026-10-01')).toEqual({ date: { to: null, word: null, from: '2026-10-01' }, sessions: null })
    expect(windowFor('range', null, null, 'someday').why).toMatch(/couldn't read “someday”/)
  })
})

// ── served vs dark ──────────────────────────────────────────────────────────────────────────────────────────────
const FETCHED = '2026-11-03T15:30:05Z'
const STUDY = {
  contract: 'MD-1.0', kind: KIND, params_echo: {}, status: 'ok', freshness: 'historical', as_of: '2026-10-30T20:00:00Z', fetched_at: FETCHED,
  delay_s: null, stale: false, source: 'uct-market-intel', coverage: null, provider_calls: 0, notes: ['a server note that must never be echoed'],
  data: {
    symbol: 'NVDA',
    request: { condition: { series: { kind: 'technical', symbol: 'NVDA', indicator: 'gap_pct' }, op: 'above', threshold: 5 }, symbol: 'NVDA', horizons: [{ sessions: 1 }, { sessions: 5 }, { sessions: 21 }], start: null },
    study: {
      lead: 'NVDA opening gap vs the previous close (%) above +5.0%: 3 events between 2024-01-03 and 2024-12-31 (first session of each run). Forward NVDA price returns from the event-day close:',
      text: 'NVDA opening gap vs the previous close (%) above +5.0%: 3 events between 2024-01-03 and 2024-12-31 (first session of each run). Forward NVDA price returns from the event-day close:\n• 1 trading session: up 3 of 3 (100%), average +0.09%, median +0.09%, best +0.09% (from 2024-02-14), worst +0.08% (from 2024-10-17); all sessions: up 100% of 251, median +0.09%.\nCondition series: NVDA opening gap vs the previous close (%) (technical), 2024-01-03 to 2024-12-31. Prices: NVDA stored 2024-01-02 to 2024-12-31. Past results do not predict future returns.',
      table: { columns: [{ key: 'window', label: 'Window' }, { key: 'n', label: 'Events' }, { key: 'up', label: 'Up' }, { key: 'mean', label: 'Average' }, { key: 'median', label: 'Median' }, { key: 'best', label: 'Best' }, { key: 'worst', label: 'Worst' }, { key: 'baseline', label: 'All sessions' }],
        rows: [{ window: '1 trading session', n: '3', up: '100%', mean: '+0.09%', median: '+0.09%', best: '+0.09% (2024-02-14)', worst: '+0.08% (2024-10-17)', baseline: '100% up, median +0.09%' }] },
      caveats: ['Small sample: fewer than 10 completed outcomes in at least one window.'],
    },
    summary: { status: 'ok', events_used: 3, events_detected: 3, overlapping_events: 0, study_start: '2024-01-03', study_end: '2024-12-31', price_last: '2024-12-31', price_first: '2024-01-02', horizons: [{ label: '1 trading session', n: 3, incomplete: 0 }], small_sample: true, series_label: 'NVDA opening gap vs the previous close (%)' },
    coverage: { price_first: '2024-01-02', price_last: '2024-12-31', study_start: '2024-01-03', study_end: '2024-12-31' },
    method: {}, notes: [],
  },
}
let calls
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
function wire(kinds, { study = STUDY, bars = null } = {}) {
  calls = []
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push([u, body])
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: kinds !== null, scan: false, data_kinds: kinds || [] })
    if (u === '/api/agent/data') {
      if (body.kind === 'instrument.resolve') return json(resolveEnvelope(body.params))
      if (body.kind === KIND) return json({ ...study, params_echo: body.params })
      if (body.kind === 'bars.daily' && bars) return json({ ...bars, params_echo: body.params })
      return json({ ...STUDY, kind: body.kind, status: 'refused', data: null, freshness: 'unavailable', as_of: null })
    }
    if (u.startsWith('/api/live-prices')) throw new Error('an Agent read called /api/live-prices')
    return json({}, 404)
  })
}
const reads = () => calls.filter(c => c[0] === '/api/agent/data').map(c => c[1])

describe('history.afterEvent: pure answer', () => {
  it('the study\'s own lead, rows, caveats, the gap note, "descriptive, not predictive" and a dated freshness line', () => {
    const a = answerFromEventStudy(STUDY, { symbol: 'NVDA', name: 'NVIDIA Corporation', indicator: 'gap_pct' })
    const lines = a.text.split('\n')
    expect(lines[0]).toBe('NVDA (NVIDIA Corporation) — NVDA opening gap vs the previous close (%) above +5.0%: 3 events between 2024-01-03 and 2024-12-31 (first session of each run). Forward NVDA price returns from the event-day close:')
    expect(lines[1]).toMatch(/^• 1 trading session: up 3 of 3 \(100%\)/)
    expect(lines).toContain('Caveat: Small sample: fewer than 10 completed outcomes in at least one window.')
    expect(lines).toContain("Opening gaps on any session are counted — UCT's data carries no past earnings dates, so earnings days are not separated.")
    expect(lines.at(-2)).toBe(DESCRIPTIVE)
    expect(lines.at(-1)).toBe("UCT's stored daily closes for NVDA run from Tue, Jan 2, 2024 through Tue, Dec 31, 2024 (completed sessions); the study is as of that close.")
    expect(a.text).not.toMatch(/never be echoed|\blive\b/)
    expect(a.table.rows).toHaveLength(1)
    expect(a.present).toMatchObject({ kind: 'table', title: 'NVDA — after opening gap vs the previous close (%)', short: 'NVDA' })
    expect(a.present.text).toContain(DESCRIPTIVE)
    expect(a.chart).toEqual({ symbol: 'NVDA', label: 'NVDA' })
    expect(freshnessLine({ ...STUDY, stale: true }, 'NVDA')).toMatch(/— note: a newer completed session exists, so the newest sessions are not included\.$/)
  })
  it('refused / unavailable answer in fixed words with no figure', () => {
    expect(says(answerFromEventStudy({ ...STUDY, status: 'refused', data: null }, { symbol: 'NVDA' }))).toBe("I couldn't run that study for NVDA: that request wasn't allowed for this question, so no study was run. No figure is stated.")
    expect(says(answerFromEventStudy({ ...STUDY, status: 'unavailable', data: null }, { symbol: 'AMD' }))).toBe("I couldn't run that study for AMD: UCT's stored daily history could not answer it. No figure is stated.")
  })
})

describe('history.afterEvent: served vs dark, local-only', () => {
  beforeEach(() => { _resetAgentConfig(); _resetHistoryForTest(); _resetForTest(); _resetBarsForTest(); vi.restoreAllMocks() })
  afterEach(() => { _resetHistoryForTest(); _resetForTest(); _resetBarsForTest() })

  it('dark: nothing registers, the fast path claims nothing, the manifest is unchanged', async () => {
    wire(null)
    await loadAgentConfig()
    expect(historyServed()).toBe(false)
    expect(registerHistoryCapability()).toBe(false)
    expect(allCapabilityNames()).not.toContain(CAPABILITY)
    expect(match('how has NVDA behaved after 5%+ gaps')).toBeNull()
    expect(fastParse('how has NVDA behaved after 5%+ gaps', {})).toBeNull()
    expect(manifestFor({ surface: 'charts', createIndicator: true }).map(c => c.name)).not.toContain(CAPABILITY)
  })

  it('served: a localOnly query named in the server handshake; the gap question takes the fast path', async () => {
    wire([KIND, 'instrument.resolve'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const cap = getCapability(CAPABILITY)
    expect(cap.query).toBe(true)
    expect(cap.localOnly).toBe(true)
    expect(cap.target).toBe('market')
    expect(handshake.local_only_actions).toContain(CAPABILITY)            // turn.LOCAL_ONLY_ACTIONS (tests/test_uct_agent_qa_isolation.py)
    expect(match('how has NVDA behaved after 5%+ gaps?')).toEqual({ action: CAPABILITY, params: { symbol: 'NVDA', indicator: 'gap_pct', period: null, op: 'above', threshold: 5, horizons: [...DEFAULT_HORIZONS], since: null } })
    expect(match('how did $amd do after 7% earnings gaps down since 2022')).toMatchObject({ params: { symbol: '$amd', op: 'below', threshold: -7, since: '2022-01-01' } })
    expect(match('what happens to TSLA after a 10% gap up')).toMatchObject({ params: { symbol: 'TSLA', op: 'above', threshold: 10 } })
    expect(match('how has NVDA behaved after earnings')).toBeNull()                           // no gap size: the model asks
    expect(match('how has NVDA behaved after 80% gaps')).toBeNull()
    expect(fastParse('how has NVDA behaved after 5%+ gaps', {})).toBeTruthy()
  })

  it('PKG2: breakouts, moving-average crosses, RSI levels and a sizeless gap take the fast path; a breadth study is declined in fixed words', async () => {
    wire([KIND, 'instrument.resolve'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const p = (q) => match(q)?.params
    expect(p('how does SPY do after new 50-day highs')).toEqual({ symbol: 'SPY', indicator: 'pct_from_high', period: 50, op: 'cross_above', threshold: 0, horizons: [...DEFAULT_HORIZONS], since: null })
    expect(p('what happens to NVDA after a 20-day breakout')).toMatchObject({ symbol: 'NVDA', indicator: 'pct_from_high', period: 20, op: 'cross_above', threshold: 0 })
    expect(p('how has AMD performed after it makes a new 52-week high since 2020')).toMatchObject({ indicator: 'pct_from_high', period: 252, since: '2020-01-01' })
    expect(p('how did QQQ do after 4-week highs')).toMatchObject({ indicator: 'pct_from_high', period: 20 })
    expect(p('what happens to AMD after it crosses above its 50-day')).toMatchObject({ symbol: 'AMD', indicator: 'pct_from_sma', period: 50, op: 'cross_above', threshold: 0 })
    expect(p('how has TSLA done after closing below the 200 day moving average?')).toMatchObject({ indicator: 'pct_from_sma', period: 200, op: 'cross_below', threshold: 0 })
    expect(p('how has NVDA done after RSI drops below 30')).toMatchObject({ indicator: 'rsi', period: 14, op: 'cross_below', threshold: 30 })
    expect(p('how did NVDA do after its rsi(5) goes above 80')).toMatchObject({ indicator: 'rsi', period: 5, op: 'cross_above', threshold: 80 })
    expect(p('how has NVDA reacted after earnings gaps')).toMatchObject({ indicator: 'gap_pct', op: 'above', threshold: 5 })
    // never a pronoun or a vague subject as the ticker, never an out-of-range window
    expect(match('how has it done after new 50-day highs')).toBeNull()
    expect(match('how does SPY do after new 900-day highs')).toBeNull()
    expect(match('how does SPY do after new 3-day highs')).toBeNull()
    // ADR-005: a breadth-conditioned study → the fixed decline (fastPath `say`), no op, no read
    expect(match('how does SPY do after breadth thrusts?')).toEqual({ say: BREADTH_DECLINE })
    expect(match('what happened to the market after a Zweig breadth thrust')).toEqual({ say: BREADTH_DECLINE })
    expect(fastParse('how does SPY do after breadth thrusts', {})).toEqual({ kind: 'say', text: BREADTH_DECLINE })
    expect(BREADTH_DECLINE).toMatch(/No figure is stated\.$/)
    expect(BREADTH_DECLINE).not.toMatch(/\d+(?:\.\d+)?%/)
    expect(fastParse('when was the last breadth thrust', {})?.kind).not.toBe('say')
    // anchored: a second request after the breadth question is not swallowed by the decline
    expect(match('how does SPY do after breadth thrusts and add rsi to the chart')).toBeNull()
    expect(match('how did SPY do after breadth thrusts since 2010')).toEqual({ say: BREADTH_DECLINE })
  })

  it('served: ONE study read after instrument.resolve; the answer is the table; an unconfirmed word reads nothing', async () => {
    wire([KIND, 'instrument.resolve'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const a = await getCapability(CAPABILITY).answer(null, { symbol: 'nvda', indicator: 'gap_pct', period: null, op: 'above', threshold: 5, horizons: null, since: null })
    const r = reads()
    expect(r.map(b => b.kind)).toEqual(['instrument.resolve', KIND])
    expect(r[1]).toEqual({ kind: KIND, params: { symbol: 'NVDA', indicator: 'gap_pct', period: null, op: 'above', threshold: 5, horizons: [1, 5, 21] }, purpose: 'answer', turn_id: 't-history' })
    expect(a.present.kind).toBe('table')
    expect(a.text).toMatch(/^NVDA \(NVIDIA Corporation\) — NVDA opening gap/)
    const g = await answerAfterEvent({ symbol: 'gld', indicator: 'gap_pct', period: null, op: 'above', threshold: 5, horizons: null, since: null })
    expect(says(g)).toMatch(/I'm not sure which instrument "gld" means|isn't one I can price here/)
    expect(reads().filter(b => b.kind === KIND)).toHaveLength(1)
    expect(says(await answerAfterEvent({ symbol: 'NVDA', indicator: 'rsi', period: null, op: 'below', threshold: 30, horizons: null, since: null }))).toMatch(/^Which period\?/)
    expect(says(await answerAfterEvent({ symbol: 'NVDA', indicator: null, period: null, op: null, threshold: null, horizons: null, since: null }))).toMatch(/^Which condition\?/)
    expect(calls.some(c => c[0].startsWith('/api/live-prices'))).toBe(false)
  })

  it('stock.dailyBars: the W2-B2 shapes take the fast path and a window read carries `from` (no bars count)', async () => {
    const ds = sessions(4)
    wire(['bars.daily', 'instrument.resolve'], { bars: barsEnv(ds.map((d, i) => bar(d, 100 + i))) })
    await loadAgentConfig()
    registerMarketDataCapabilities()
    expect(barsMatch('how far is NVDA off its high')).toEqual({ action: BARS, params: { symbol: 'NVDA', measure: 'offHigh', sessions: null, date: null, from: null } })
    expect(barsMatch('NVDA off its 52-week highs?')).toMatchObject({ params: { measure: 'offHigh' } })
    expect(barsMatch('compare this pullback in NVDA to the last three')).toMatchObject({ params: { symbol: 'NVDA', measure: 'pullbacks' } })
    expect(barsMatch('nvda pullbacks')).toMatchObject({ params: { symbol: 'nvda', measure: 'pullbacks' } })
    expect(barsMatch('NVDA range over the last 20 sessions')).toMatchObject({ params: { measure: 'range', sessions: 20 } })
    expect(barsMatch('NVDA 20 day change')).toMatchObject({ params: { measure: 'change', sessions: 20, from: null } })
    const a = await getCapability(BARS).answer(null, { symbol: 'NVDA', measure: 'range', sessions: null, date: '2026-10-30', from: '2026-10-27' })
    expect(reads().at(-1)).toEqual({ kind: 'bars.daily', params: { symbol: 'NVDA', from: '2026-10-27', to: '2026-10-30' }, purpose: 'answer', turn_id: 't-history' })
    expect(says(a)).toMatch(/^NVDA \(NVIDIA Corporation\) from Tue, Oct 27 to Fri, Oct 30 \(4 completed sessions/)
    await getCapability(BARS).answer(null, { symbol: 'NVDA', measure: 'range', sessions: null, date: null, from: '2026-10-27' })
    expect(reads().at(-1).params).toEqual({ symbol: 'NVDA', from: '2026-10-27' })
    await getCapability(BARS).answer(null, { symbol: 'NVDA', measure: 'offHigh', sessions: null, date: null, from: null })
    expect(reads().at(-1).params).toEqual({ symbol: 'NVDA', bars: 252 })
  })
})
