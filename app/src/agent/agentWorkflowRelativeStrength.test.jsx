// Track D workflow "relativeStrength" — `stock.relativeStrength` (DARK, UCT_AGENT_WORKFLOWS). Pure computation over
// SYNTHETIC bars (recomputed here independently), the refusals (missing / unavailable / no common sessions / short /
// stale / ends differ), the fast path, the REAL panel (fast path and scripted model), dark by default, and isolation
// (a served NON-local query like stock.dailyBars). No model, no provider, no real market value anywhere.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handshake from './__fixtures__/program/isolation.json'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import { setupPanel, ONE } from './testing/panelHarness'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { allCapabilityNames, getCapability, manifestFor } from './capabilities'
import { loadAgentConfig, _resetAgentConfig, serverWorkflows } from './agentClient'
import { fastParse } from './fastPath'
import { groupOfAction, wordsSelect } from './routing'
import { _resetTurns } from './trace'
import { resolveEnvelope } from './marketdata/__fixtures__/fakeResolve'
import {
  relativeStrengthOf, answerFromRelativeStrength, match, relativeStrengthServed, registerRelativeStrengthCapability,
  _resetRelativeStrengthForTest, calendarCutoff, CAPABILITY, DEFAULT_WINDOWS,
} from './capabilities/relativeStrength'
import { DESCRIPTIVE } from './capabilities/workflowGate'

registerBuiltins()

// ── synthetic weekday sessions and two deterministic paths ──────────────────────────────────────────────────────
function sessions(n, end = '2026-10-30') {
  const out = []
  const d = new Date(`${end}T12:00:00Z`)
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
const path = (n, end, f) => sessions(n, end).map((date, i) => ({ date, open: f(i), high: f(i) + 1, low: f(i) - 1, close: Math.round(f(i) * 100) / 100, volume: 1000 }))
const STOCK = path(258, '2026-10-30', i => 40 + i * 0.25 + (i % 5) * 0.4 - (i > 240 ? (i - 240) * 0.3 : 0))
const BENCH = path(258, '2026-10-30', i => 100 + i * 0.1 + (i % 3) * 0.2)
function barsEnv(sym, bars, o = {}) {
  const through = bars.length ? bars[bars.length - 1].date : null
  return { contract: 'MD-1.0', kind: 'bars.daily', params_echo: { symbol: sym }, status: 'ok', freshness: 'historical', as_of: through ? `${through}T20:00:00Z` : null,
    fetched_at: '2026-11-02T16:00:00Z', delay_s: null, stale: false, source: 'uct-bars', coverage: null, provider_calls: 0,
    notes: ['a note that must never be echoed'], data: { symbol: sym, bars, through, latest_completed_session: through }, ...o }
}
const r2 = (v) => Math.round(v * 100) / 100

describe('stock.relativeStrength: the computation and the card (pure)', () => {
  it('every window by the formula (recomputed here), aligned on common dates, with its sessions', () => {
    const rs = relativeStrengthOf(barsEnv('NVDA', STOCK), barsEnv('SPY', BENCH))
    expect(rs.ok).toBe(true)
    expect(rs.rows.map(r => r.sessions)).toEqual(DEFAULT_WINDOWS)
    for (const r of rs.rows) {
      const a = STOCK.at(-1 - r.sessions); const z = STOCK.at(-1); const ba = BENCH.at(-1 - r.sessions); const bz = BENCH.at(-1)
      expect(r).toMatchObject({ from: a.date, to: z.date, stockPct: r2((z.close / a.close - 1) * 100), benchPct: r2((bz.close / ba.close - 1) * 100),
        ratioPct: r2(((z.close / bz.close) / (a.close / ba.close) - 1) * 100) })
      expect(r.diff).toBe(r2(r.stockPct - r.benchPct))
    }
    // the RS line's high over the 252-session window, found independently
    const ratios = STOCK.slice(-253).map((b, i) => ({ date: b.date, v: b.close / BENCH.slice(-253)[i].close }))
    const hi = ratios.reduce((m, x) => (x.v >= m.v ? x : m))
    expect(rs.rsLine.highDate).toBe(hi.date)
    expect(rs.rsLine.offHighPct).toBe(r2((ratios.at(-1).v / hi.v - 1) * 100))
    expect(rs.rsLine.atHigh).toBe(false)
  })

  it('the card: dated header, one line per window with the same rounded numbers, RS line, overlay suggestion, descriptive, source', () => {
    const a = answerFromRelativeStrength(barsEnv('NVDA', STOCK), barsEnv('SPY', BENCH), { symbol: 'nvda', benchmark: 'spy', names: { NVDA: 'NVIDIA Corp', SPY: 'SPDR S&P 500 ETF Trust, an ETF' } })
    const lines = a.text.split('\n')
    expect(lines[0]).toBe('NVDA (NVIDIA Corp) vs SPY (SPDR S&P 500 ETF Trust, an ETF) — relative strength from completed daily closes through Fri, Oct 30:')
    expect(lines[2]).toMatch(/^Over 21 sessions \(about 1 month\), .* to Fri, Oct 30: NVDA [+−][\d.]+%, SPY [+−][\d.]+% — [\d.]+ points? (ahead of|behind) SPY; the NVDA\/SPY ratio (rose|fell) [\d.]+%\.$/)
    for (const r of a.rs.rows) expect(a.text).toContain(`${Math.abs(r.ratioPct).toFixed(2)}%`)
    expect(a.text).toMatch(/RS line \(NVDA close ÷ SPY close\): [\d.]+% below its highest of the 252 sessions/)
    expect(a.text).toContain('say "compare SPY on this chart" (Compare Symbols)')
    expect(a.text).toContain("An ETF's price is the fund's own share price")
    expect(lines.at(-2)).toBe(DESCRIPTIVE)
    expect(lines.at(-1)).toMatch(/^From UCT's daily bars \(completed sessions only/)
    expect(a.text).not.toMatch(/never be echoed|\blive\b|\bnow\b|\bbuy\b|\bsell\b|will (rise|fall)/i)
    expect(a.table.rows).toHaveLength(5)
    expect(a.present.kind).toBe('table')
    expect(a.rs).toMatchObject({ symbol: 'NVDA', benchmark: 'SPY', asOf: '2026-10-30', source: 'bars.daily', stale: false })
  })

  it('a member window: one row; a window the bars cannot cover is named, never estimated', () => {
    const one = answerFromRelativeStrength(barsEnv('NVDA', STOCK), barsEnv('SPY', BENCH), { symbol: 'NVDA', benchmark: 'SPY', sessions: 10 })
    expect(one.rs.rows.map(r => r.sessions)).toEqual([10])
    expect(one.text).toMatch(/^Over 10 sessions, /m)
    const short = answerFromRelativeStrength(barsEnv('NVDA', STOCK.slice(-30)), barsEnv('SPY', BENCH), { symbol: 'NVDA', benchmark: 'SPY' })
    expect(short.rs.rows.map(r => r.sessions)).toEqual([5, 21])
    expect(short.text).toContain('Not measured: the 63-session and 126-session and 252-session windows — only 30 common completed sessions held.')
    const tooShort = answerFromRelativeStrength(barsEnv('NVDA', STOCK.slice(-30)), barsEnv('SPY', BENCH), { symbol: 'NVDA', benchmark: 'SPY', sessions: 60 })
    expect(tooShort.text).toContain('Not measured: the two share only 30 completed sessions')
    expect(tooShort.table).toBeUndefined()
  })

  it('review #788: a missing date keeps the 1-year window (cushion); calendar windows; "at its high" only when the high IS the last point', () => {
    // (a) the 258-bar read with ONE benchmark date missing still covers 252 common sessions
    const holed = BENCH.filter((_, i) => i !== 100)
    expect(relativeStrengthOf(barsEnv('NVDA', STOCK), barsEnv('SPY', holed)).rows.map(r => r.sessions)).toEqual(DEFAULT_WINDOWS)
    // (b) "30 days" are CALENDAR days: the base is the last session on or before Oct 30 − 30 days (Wed, Sep 30)
    expect(calendarCutoff('2026-10-30', { days: 30 })).toBe('2026-09-30')
    expect(calendarCutoff('2026-03-31', { months: 1 })).toBe('2026-02-28')
    const cal = answerFromRelativeStrength(barsEnv('NVDA', STOCK), barsEnv('SPY', BENCH), { symbol: 'NVDA', benchmark: 'SPY', days: 30 })
    expect(cal.rs.rows).toHaveLength(1)
    expect(cal.rs.rows[0]).toMatchObject({ from: '2026-09-30', to: '2026-10-30', sessions: 22, calendar: { days: 30 } })
    expect(cal.text).toMatch(/^Over the last 30 calendar days \(22 sessions\), Wed, Sep 30 to Fri, Oct 30:/m)
    const mo = answerFromRelativeStrength(barsEnv('NVDA', STOCK), barsEnv('SPY', BENCH), { symbol: 'NVDA', benchmark: 'SPY', months: 3 })
    expect(mo.text).toMatch(/^Over the last 3 months \(\d+ sessions\), Thu, Jul 30 to Fri, Oct 30:/m)
    // (c) a flat ratio whose high was set EARLIER (a tie rounding to 0.00%) is not "at its high"
    const flat = path(30, '2026-10-30', i => (i === 10 ? 101 : 100))
    const tie = relativeStrengthOf(barsEnv('NVDA', flat.map(b => ({ ...b, close: b.close === 101 ? 100.001 : b.close }))), barsEnv('SPY', path(30, '2026-10-30', () => 100)), { windows: [21] })
    expect(tie.rsLine.offHighPct).toBe(-0)
    expect(tie.rsLine.atHigh).toBe(false)
  })

  it('refusals: either series unavailable / refused, or no common sessions → fixed words, no figure', () => {
    const none = barsEnv('X', [], { status: 'unavailable', data: null })
    const t1 = answerFromRelativeStrength(none, barsEnv('SPY', BENCH), { symbol: 'NVDA', benchmark: 'SPY' }).text
    expect(t1).toBe("I couldn't compare NVDA with SPY: for NVDA, its completed daily bars are not available from UCT's market data. No figure is stated.")
    const t2 = answerFromRelativeStrength(barsEnv('NVDA', STOCK), { ...none, status: 'refused' }, { symbol: 'NVDA', benchmark: 'SPY' }).text
    expect(t2).toBe("I couldn't compare NVDA with SPY: for SPY, that request wasn't allowed for this question. No figure is stated.")
    const t3 = answerFromRelativeStrength(barsEnv('NVDA', path(10, '2025-01-31', i => 10 + i)), barsEnv('SPY', BENCH.slice(-20)), { symbol: 'NVDA', benchmark: 'SPY' }).text
    expect(t3).toContain('share fewer than two completed sessions. No figure is stated.')
    for (const t of [t1, t2, t3]) expect(t.replace(/two/g, '')).not.toMatch(/\d/)
  })

  it('stale and uneven ends are said plainly; the comparison runs through the last session both hold', () => {
    const early = STOCK.slice(0, -2)
    const a = answerFromRelativeStrength(barsEnv('NVDA', early, { stale: true, data: { symbol: 'NVDA', bars: early, through: early.at(-1).date, latest_completed_session: '2026-10-30' } }), barsEnv('SPY', BENCH), { symbol: 'NVDA', benchmark: 'SPY' })
    expect(a.rs.asOf).toBe(early.at(-1).date)
    expect(a.text).toContain(`Note: UCT's bars for NVDA end Wed, Oct 28, earlier than the other's, so the comparison runs through Wed, Oct 28 — the last session both hold.`)
    expect(a.text).toContain('Note: the most recent completed session was Fri, Oct 30; UCT\'s bars here end Wed, Oct 28, so this is not the latest state.')
    expect(a.rs.stale).toBe(true)
  })
})

// ── the REAL panel ──────────────────────────────────────────────────────────────────────────────────────────────
const SERVED = { stream: false, nl1: false, data: true, scan: false, data_kinds: ['bars.daily', 'instrument.resolve'], workflows: ['relativeStrength'] }
let p, reads, config
function wirePanel({ benchStatus = 'ok' } = {}) {
  reads = []
  p = setupPanel()
  const harness = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/config') return json(config)
    if (u === '/api/agent/data') {
      const b = JSON.parse(init.body); reads.push(b)
      if (b.kind === 'instrument.resolve') return json(resolveEnvelope(b.params))
      if (b.kind === 'bars.daily') {
        if (b.params.symbol === 'SPY' && benchStatus !== 'ok') return json({ ...barsEnv('SPY', []), status: benchStatus, data: null })
        return json(barsEnv(b.params.symbol, (b.params.symbol === 'SPY' ? BENCH : STOCK).slice(-b.params.bars)))
      }
      return json({ status: 'refused', data: null })
    }
    if (u.startsWith('/api/live-prices')) throw new Error('an Agent read called /api/live-prices')
    return harness(url, init)
  })
}

describe('stock.relativeStrength: served panel, model path, dark, isolation', () => {
  beforeEach(() => { _resetAgentConfig(); _resetTurns(); _resetRelativeStrengthForTest(); config = SERVED; wirePanel() })
  afterEach(() => { _resetTurns(); _resetRelativeStrengthForTest(); vi.restoreAllMocks() })

  it('fast path: 0 model turns, ONE resolve of both words, then TWO bars reads (stock, benchmark); the card; no chart changed', async () => {
    const { say, h } = p.mount(...ONE('QQQ'))
    const before = h.charts.list().map(c => c.symbol)
    const out = await say('NVDA relative strength vs SPY')
    expect(p.turns()).toBe(0)
    expect(reads.map(r => r.kind)).toEqual(['instrument.resolve', 'bars.daily', 'bars.daily'])
    expect(reads[0].params.symbols.map(s => s.text)).toEqual(['NVDA', 'SPY'])
    expect(reads[1]).toMatchObject({ params: { symbol: 'NVDA', bars: 258 }, purpose: 'answer' })      // 252 + 1 + a 5-bar cushion
    expect(reads[2]).toMatchObject({ params: { symbol: 'SPY', bars: 258 }, purpose: 'answer' })
    expect(typeof reads[1].turn_id).toBe('string')
    expect(out).toMatch(/NVDA( \(.*?\))? vs SPY( \(.*?\))? — relative strength from completed daily closes through Fri, Oct 30/)
    expect(out).toContain(DESCRIPTIVE)
    expect(h.charts.list().map(c => c.symbol)).toEqual(before)
    // "the market" = SPY; a window in days
    await say('is AMD outperforming the market over the last 20 days?')
    expect(reads.slice(3).map(r => r.kind)).toEqual(['instrument.resolve', 'bars.daily', 'bars.daily'])
    expect(reads[4].params).toEqual({ symbol: 'AMD', bars: 22 })      // 20 CALENDAR days: ≤ 15 sessions + base + cushion
  })

  it('benchmark bars unavailable → the fixed sentence, no figure', async () => {
    wirePanel({ benchStatus: 'unavailable' })
    const { say } = p.mount(...ONE('QQQ'))
    const out = await say('relative strength of NVDA vs SPY')
    expect(out).toContain("I couldn't compare NVDA with SPY: for SPY, its completed daily bars are not available from UCT's market data. No figure is stated.")
  })

  it('model path (scripted): an apply of the action runs the same reads; "vs its sector" with no fund is never guessed', async () => {
    const { say } = p.mount(...ONE('QQQ'))
    p.st.envelopes.push(p.env('apply', [{ action: CAPABILITY, target: 'm', args: { symbol: 'TSLA', benchmark: 'DIA', sessions: 63, days: null, months: null } }], ''))   // (the server blanks a data-read plan's reply: tests/test_uct_agent_workflows.py)
    const out = await say('how is tesla doing versus the dow fund, last three months')
    expect(p.turns()).toBe(1)
    expect(JSON.stringify(p.lastTurnBody())).toContain(CAPABILITY)
    expect(reads.filter(r => r.kind === 'bars.daily').map(r => r.params)).toEqual([{ symbol: 'TSLA', bars: 69 }, { symbol: 'DIA', bars: 69 }])
    expect(out).toMatch(/TSLA.* vs DIA.* — relative strength/)
    p.st.envelopes.push(p.env('apply', [{ action: CAPABILITY, target: 'm', args: { symbol: 'NVDA', benchmark: 'sector', sessions: null, days: null, months: null } }], ''))
    const sector = await say('nvda relative strength vs its sector')
    expect(sector).toContain("UCT doesn't pick a sector for a stock")
  })

  it('dark by default: flag off, or a kind missing → nothing registers, the fast path claims nothing, no read', async () => {
    for (const c of [{ workflows: [] }, { workflows: undefined }, { workflows: ['watchlistChanges'] }, { data: false }, { data_kinds: ['bars.daily'] }]) {
      _resetAgentConfig(); _resetRelativeStrengthForTest()
      config = { ...SERVED, ...c }
      await loadAgentConfig()
      expect(relativeStrengthServed()).toBe(false)
      expect(registerRelativeStrengthCapability()).toBe(false)
      expect(allCapabilityNames()).not.toContain(CAPABILITY)
      expect(match('NVDA relative strength vs SPY')).toBeNull()
      expect(manifestFor({ surface: 'charts', createIndicator: true }).map(x => x.name)).not.toContain(CAPABILITY)
    }
    expect(reads).toEqual([])
    expect(wordsSelect('data', 'is NVDA outperforming the market')).toBe(false)    // routing exactly as before
  })

  it('review #788 f: a LATER config load that switches the workflow off takes the capability and its routing words out', async () => {
    await loadAgentConfig()
    expect(registerRelativeStrengthCapability()).toBe(true)
    expect(wordsSelect('data', 'is NVDA outperforming the market')).toBe(true)
    _resetAgentConfig(); config = { ...SERVED, workflows: [] }
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames()).not.toContain(CAPABILITY)
    expect(wordsSelect('data', 'is NVDA outperforming the market')).toBe(false)
  })

  it('isolation and shape: a served NON-local market query in the data group; fast-path phrasings', async () => {
    await loadAgentConfig()
    expect(serverWorkflows()).toEqual(['relativeStrength'])
    registerServerGatedBuiltins()
    const cap = getCapability(CAPABILITY)
    expect(cap).toMatchObject({ query: true, target: 'market' })
    expect(cap.localOnly).toBeFalsy()
    expect(handshake.local_only_actions).not.toContain(CAPABILITY)
    expect(groupOfAction(CAPABILITY)).toBe('data')
    expect(wordsSelect('data', 'is NVDA outperforming the market')).toBe(true)     // its own words, only while registered
    const P = (symbol, benchmark, sessions, days = null, months = null) => ({ action: CAPABILITY, params: { symbol, benchmark, sessions, days, months } })
    expect(match('NVDA relative strength vs SPY')).toEqual(P('NVDA', 'SPY', null))
    expect(match("what's the relative strength of amd against qqq over the last 3 months?")).toEqual(P('amd', 'qqq', null, null, 3))
    expect(match('is TSLA underperforming the S&P over the past 2 weeks')).toEqual(P('TSLA', 'SPY', null, 14))
    expect(match("show me NVDA's RS line")).toEqual(P('NVDA', null, null))
    expect(match('relative strength of NVDA over the last year')).toEqual(P('NVDA', null, null, null, 12))
    expect(match('NVDA relative strength vs SPY over the last 30 trading days')).toEqual(P('NVDA', 'SPY', 30))
    expect(match('NVDA relative strength vs SPY over the last 30 days')).toEqual(P('NVDA', 'SPY', null, 30))
    for (const t of ['relative strength of it vs SPY', 'NVDA relative strength vs its sector', 'NVDA vs AMD', 'compare NVDA to AMD', 'NVDA rs over the last 400 days']) expect(match(t), t).toBeNull()
    expect(fastParse('NVDA relative strength vs SPY', {})).toBeTruthy()
  })
})
