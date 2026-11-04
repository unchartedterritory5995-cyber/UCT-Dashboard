// W2-B3 (builder-b): `chart.describeSetup` — the open chart's setup from ONE `bars.daily` read (252 completed sessions)
// plus the chart's own snapshot. Pure answers over synthetic bars (happy path daily / weekly, missing bars, short
// history, stale bars), the STRUCTURED `setup` (KN-1 v1 measurable ids and formulas, recomputed here independently
// for value traceability), the follow-ups ("and on the weekly?", "same for AMD") through the REAL panel and routing,
// dark by default, and isolation untouched (not local-only, bars.daily not an isolated kind). No model, no provider.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import handshake from './__fixtures__/program/isolation.json'
import KN1 from './__fixtures__/kn1-measurables-v1.json'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import { setupPanel, ONE, FOUR } from './testing/panelHarness'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { allCapabilityNames, getCapability, manifestFor, registerCapability } from './capabilities'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { fastParse } from './fastPath'
import { selectGroups, groupOfAction } from './routing'
import { _resetTurns } from './trace'
import { resolveEnvelope } from './marketdata/__fixtures__/fakeResolve'
import {
  answerFromSetup, setupOf, weeklyBars, match, matchSymbol, chartForSymbol, describeServed, registerChartDescribeCapability, _resetDescribeForTest,
  CAPABILITY, KIND, MEASURABLES, DESCRIPTIVE, BARS,
} from './capabilities/chartDescribe'
import { NO_RESULT, emptyAnswer } from './useAgent'

registerBuiltins()
const REPO = path.resolve(__dirname, '../../..')

// ── fixtures: weekday sessions (no holidays), a deterministic path ──────────────────────────────────────────────
function sessions(n, end = '2026-10-30') {
  const out = []
  const d = new Date(`${end}T12:00:00Z`)
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
// a rise with a wobble, then the last 12 sessions pulling back: every measurable is non-trivial
const closeAt = (i, n) => 50 + i * 0.2 + (i % 7) * 0.3 - (i > n - 12 ? (i - (n - 12)) * 0.6 : 0)
function makeBars(n, end) {
  return sessions(n, end).map((date, i) => {
    const close = Math.round(closeAt(i, n) * 100) / 100
    return { date, open: close - 0.2, high: Math.round((close + 0.5 + (i % 3) * 0.1) * 100) / 100, low: Math.round((close - 0.6) * 100) / 100, close, volume: i === n - 1 ? 2_400_000 : 1_000_000 + (i % 10) * 20_000 }
  })
}
function barsEnv(bars, o = {}) {
  const through = bars.length ? bars[bars.length - 1].date : null
  return { contract: 'MD-1.0', kind: 'bars.daily', params_echo: { symbol: 'QQQ' }, status: bars.length >= BARS ? 'ok' : 'partial', freshness: 'historical',
    as_of: through ? `${through}T20:00:00Z` : null, fetched_at: '2026-11-02T16:00:00Z', delay_s: null, stale: false,
    source: 'uct-bars', coverage: null, provider_calls: 0, notes: ['a note that must never be echoed'],
    data: { symbol: 'QQQ', bars, through, latest_completed_session: through }, ...o }
}
const FULL = makeBars(BARS)

// ── the KN-1 formulas, written again here from the contract (not imported) ──────────────────────────────────────
const r2 = (v) => Math.round(v * 100) / 100
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const sma = (b, n, back = 0) => avg(b.slice(b.length - back - n, b.length - back).map(x => x.close))
function kn1(b) {
  const c = b.at(-1).close
  const w = b.slice(-10)
  const hi = Math.max(...w.map(x => x.high))
  const lo = Math.min(...w.map(x => x.low))
  const h52 = Math.max(...b.slice(-252).map(x => x.high))
  return {
    close_vs_sma20: r2((c - sma(b, 20)) / sma(b, 20) * 100),
    close_vs_sma50: r2((c - sma(b, 50)) / sma(b, 50) * 100),
    pct_from_52w_high: r2((c - h52) / h52 * 100),
    range_pct_10: r2((hi - lo) / lo * 100),
    rel_volume_50d: r2(b.at(-1).volume / avg(b.slice(-51, -1).map(x => x.volume))),
    sma50_above_sma200: sma(b, 50) > sma(b, 200),
    sma50_rising: sma(b, 50) > sma(b, 50, 20),
    sma200_rising: sma(b, 200) > sma(b, 200, 20),
  }
}

describe('chart.describeSetup: the structured setup (KN-1 v1) and the answer (pure)', () => {
  it('the measurable ids are exactly the KN-1 v1 table (fixture copy; and the contract itself once it is on this branch)', () => {
    expect(MEASURABLES).toEqual(KN1.v1.map(r => r.id))
    const doc = path.join(REPO, KN1.contract)
    if (fs.existsSync(doc)) {
      const v1 = fs.readFileSync(doc, 'utf8').split(/\r?\n/).map(l => l.match(/^\|\s*`([a-z0-9_]+)`\s*\|.*\|\s*yes\b/)).filter(Boolean).map(m => m[1])
      expect(MEASURABLES).toEqual(v1)
    }
    expect(Object.keys(setupOf(barsEnv(FULL)).setup.measurables)).toEqual(MEASURABLES)
  })

  it('happy path, daily: every measurable by the KN-1 formula, shown in the text as the same number, with its sessions', () => {
    const a = answerFromSetup(barsEnv(FULL), { symbol: 'qqq', timeframe: 'D', indicators: [{ name: 'RSI 14' }, { name: 'EMA 21', hidden: true }], label: 'Chart (QQQ)' })
    const want = kn1(FULL)
    expect(a.setup).toMatchObject({ symbol: 'QQQ', asOf: '2026-10-30', source: KIND, timeframe: 'D', sessions: 252, stale: false, missing: {} })
    expect(a.setup.measurables).toEqual(want)
    expect(want.pct_from_52w_high).toBeLessThan(0)
    const lines = a.text.split('\n')
    expect(lines[0]).toBe('QQQ — daily setup (Chart (QQQ)), from 252 completed sessions ending Fri, Oct 30:')
    expect(lines[1]).toMatch(/^Trend: the close of \$[\d.]+ on Fri, Oct 30 is [\d.]+% (above|below) the 20-session SMA \(\$[\d.]+, .* to Fri, Oct 30\) and [\d.]+% (above|below) the 50-session SMA/)
    // value traceability: each numeric measurable appears in the text exactly as the structure carries it
    for (const id of ['close_vs_sma20', 'close_vs_sma50', 'pct_from_52w_high', 'range_pct_10']) expect(a.text).toContain(`${Math.abs(want[id]).toFixed(2)}%`)
    expect(a.text).toContain(`${want.rel_volume_50d.toFixed(2)}× the average of`)
    expect(a.text).toContain(`the 50-session SMA is ${want.sma50_rising ? 'rising' : 'not rising'}`)
    expect(a.text).toContain('On the chart: RSI 14, EMA 21 (hidden) (names only; their values are not read).')
    expect(lines.at(-2)).toBe(DESCRIPTIVE)
    expect(a.text).not.toMatch(/never be echoed|\blive\b|\bbuy\b|\bsell\b/i)
    expect(a.present.kind).toBe('metrics')
    expect(a.present.items.map(i => i.value)).toContain(`${want.range_pct_10.toFixed(2)}%`)
  })

  it('happy path, weekly: calendar weeks from the same bars (a cut leading week dropped); the KN-1 measurables stay daily', () => {
    const wk = weeklyBars(FULL, { dropLeading: true })
    expect(wk[0].start).toBe(wk[0].week)                                      // starts on a Monday
    expect(wk.at(-1)).toMatchObject({ date: '2026-10-30', sessions: 5 })
    const a = answerFromSetup(barsEnv(FULL), { symbol: 'QQQ', timeframe: 'W' })
    expect(a.setup.timeframe).toBe('W')
    expect(a.setup.measurables).toEqual(kn1(FULL))
    const w20 = avg(wk.slice(-20).map(x => x.close))
    expect(a.setup.weekly.close_vs_sma20w).toBe(r2((wk.at(-1).close - w20) / w20 * 100))
    const ten = wk.slice(-10)
    expect(a.setup.weekly.range_pct_10w).toBe(r2((Math.max(...ten.map(x => x.high)) - Math.min(...ten.map(x => x.low))) / Math.min(...ten.map(x => x.low)) * 100))
    expect(a.text.split('\n')[0]).toBe(`QQQ — weekly setup, from ${wk.length} completed weeks (252 sessions) ending Fri, Oct 30:`)
    expect(a.text).toMatch(/the 20-week SMA .* the 50-week SMA/)
    expect(a.text).toContain(`Consolidation: the last 10 weeks`)
    expect(a.text).toContain(`${Math.abs(a.setup.weekly.close_vs_sma20w).toFixed(2)}%`)
    expect(a.text.split('\n').at(-2)).toBe(DESCRIPTIVE)
  })

  it('missing bars: no figure at all, the reason said; every measurable null with why', () => {
    for (const status of ['unavailable', 'refused']) {
      const a = answerFromSetup(barsEnv([], { status, data: null }), { symbol: 'QQQ' })
      expect(a.text).toMatch(/^I couldn't describe QQQ's setup: .*No figure is stated\.$/)
      expect(a.text).not.toMatch(/\d/)
      expect(Object.values(a.setup.measurables).every(v => v === null)).toBe(true)
      expect(Object.keys(a.setup.missing)).toEqual(MEASURABLES)
    }
  })

  it('short history: what the bars support is given, what they cannot is named as missing — never estimated', () => {
    const short = makeBars(40)
    const a = answerFromSetup(barsEnv(short), { symbol: 'QQQ' })
    const m = a.setup.measurables
    expect(m.close_vs_sma20).toBe(kn1(short).close_vs_sma20)
    expect(m.range_pct_10).toBe(kn1(short).range_pct_10)
    for (const id of ['close_vs_sma50', 'pct_from_52w_high', 'rel_volume_50d', 'sma50_above_sma200', 'sma50_rising', 'sma200_rising']) expect(m[id], id).toBeNull()
    expect(a.setup.missing).toEqual({
      close_vs_sma50: 'needs 50 sessions; 40 held', pct_from_52w_high: 'needs 252 completed sessions for a 52-week high; 40 held',
      rel_volume_50d: 'needs 51 sessions; 40 held', sma50_above_sma200: 'needs 200 sessions; 40 held',
      sma50_rising: 'needs 70 sessions; 40 held', sma200_rising: 'needs 220 sessions; 40 held',
    })
    expect(a.text).toContain('No 50-session SMA: needs 50 sessions; 40 held.')
    expect(a.text).toContain('Off the high: no 52-week figure — needs 252 completed sessions for a 52-week high; 40 held.')
    expect(a.text).toContain('Volume: no comparison — needs 51 sessions; 40 held.')
    expect(a.text).toContain('Only 40 completed sessions are held')
    // a missing volume inside the window is missing, not skipped
    const holed = FULL.map((b, i) => (i === FULL.length - 5 ? { ...b, volume: null } : b))
    expect(setupOf(barsEnv(holed)).setup.missing.rel_volume_50d).toBe('a volume is missing in the last 51 sessions')
  })

  it('stale bars: the answer says the bars end before the latest completed session; the structure says stale', () => {
    const a = answerFromSetup(barsEnv(FULL, { stale: true, data: { symbol: 'QQQ', bars: FULL, through: '2026-10-30', latest_completed_session: '2026-11-02' } }), { symbol: 'QQQ' })
    expect(a.setup.stale).toBe(true)
    expect(a.setup.asOf).toBe('2026-10-30')
    expect(a.text).toContain("Note: UCT's bars end Fri, Oct 30, but the most recent completed session was Mon, Nov 2, so this is not the latest state.")
    expect(a.text).not.toMatch(/\blive\b|\bnow\b/)
    expect(answerFromSetup(barsEnv(FULL, { stale: true }), { symbol: 'QQQ' }).setup.stale).toBe(false)   // same session: nothing newer
  })
})

// ── served: the REAL panel ──────────────────────────────────────────────────────────────────────────────────────
const SERVED = { stream: false, nl1: false, data: true, scan: false, data_kinds: ['bars.daily', 'instrument.resolve'] }
let p, reads, config
function wirePanel() {
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
      if (b.kind === 'bars.daily') return json({ ...barsEnv(FULL), params_echo: b.params, data: { ...barsEnv(FULL).data, symbol: b.params.symbol } })
      return json({ status: 'refused', data: null })
    }
    if (u.startsWith('/api/live-prices')) throw new Error('an Agent read called /api/live-prices')
    return harness(url, init)
  })
}

describe('chart.describeSetup: served panel, follow-ups, dark, isolation', () => {
  beforeEach(() => { _resetAgentConfig(); _resetTurns(); _resetDescribeForTest(); config = SERVED; wirePanel() })
  afterEach(() => { _resetTurns(); _resetDescribeForTest(); vi.restoreAllMocks() })

  it('"describe this setup" → fast path, 0 model turns, ONE bars.daily(252) read of the chart\'s symbol; then "and on the weekly?" and "same for AMD" re-plan the same action', async () => {
    const { say } = p.mount(...ONE('QQQ'))
    const first = await say('describe this setup')
    expect(p.turns()).toBe(0)
    expect(reads.map(r => r.kind)).toEqual(['bars.daily'])
    expect(reads[0]).toMatchObject({ kind: 'bars.daily', params: { symbol: 'QQQ', bars: 252 }, purpose: 'answer' })
    expect(typeof reads[0].turn_id).toBe('string')
    expect(first).toContain('QQQ — daily setup')
    expect(first).toContain(DESCRIPTIVE)
    // follow-up 1: the model (scripted) re-plans the action with timeframe W; the routing follow-up kept the action in its manifest
    p.st.envelopes.push(p.env('apply', [{ action: CAPABILITY, target: 'c', args: { symbol: null, timeframe: 'W' } }], 'The weekly view.'))
    const weekly = await say('and on the weekly?')
    expect(p.turns()).toBe(1)
    expect(JSON.stringify(p.lastTurnBody())).toContain(CAPABILITY)
    expect(weekly).toContain('QQQ — weekly setup')
    expect(reads.filter(r => r.kind === 'bars.daily')).toHaveLength(2)
    // follow-up 2: another symbol — resolved first, then ONE bars read; the chart itself is not changed
    p.st.envelopes.push(p.env('apply', [{ action: CAPABILITY, target: 'c', args: { symbol: 'AMD', timeframe: 'W' } }], 'AMD on the weekly.'))
    const amd = await say('same for AMD')
    expect(JSON.stringify(p.lastTurnBody())).toContain(CAPABILITY)
    expect(reads.slice(2).map(r => r.kind)).toEqual(['instrument.resolve', 'bars.daily'])
    expect(reads.at(-1).params).toEqual({ symbol: 'AMD', bars: 252 })
    expect(amd).toMatch(/AMD \(.*\) — weekly setup/)
    expect(amd).not.toContain('On the chart:')                               // the chart's indicators are QQQ's, not AMD's
  })

  it('routing: the action sits in chartSetup by name; follow-ups carry the group; "describe … setup" names it', () => {
    expect(groupOfAction(CAPABILITY)).toBe('chartSetup')
    for (const t of ['and on the weekly?', 'same for AMD']) expect(selectGroups(t, { recentActions: [CAPABILITY] }).priority).toContain('chartSetup')
    expect(selectGroups('can you describe the setup on this one').priority).toContain('chartSetup')
  })

  it('dark by default: nothing registers, the fast path claims nothing, no read', async () => {
    for (const c of [{ data: false, data_kinds: SERVED.data_kinds }, { data: true, data_kinds: ['instrument.resolve'] }, { data: true, data_kinds: ['bars.daily'] }]) {
      _resetAgentConfig(); _resetDescribeForTest()
      config = { ...SERVED, ...c }
      await loadAgentConfig()
      expect(describeServed()).toBe(false)
      expect(registerChartDescribeCapability()).toBe(false)
      expect(allCapabilityNames()).not.toContain(CAPABILITY)
      expect(match('describe this setup')).toBeNull()
      expect(manifestFor({ surface: 'charts', createIndicator: true }).map(x => x.name)).not.toContain(CAPABILITY)
    }
    expect(reads).toEqual([])
  })

  it('isolation untouched: a served, NON-local query on the chart target; bars.daily is not an isolated kind; fast-path shapes', async () => {
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const cap = getCapability(CAPABILITY)
    expect(cap).toMatchObject({ query: true, target: 'chart' })
    expect(cap.localOnly).toBeFalsy()
    expect(handshake.isolated_kinds).not.toContain(KIND)
    expect(handshake.local_only_actions).not.toContain(CAPABILITY)
    expect(match('Describe this setup.')).toEqual({ action: CAPABILITY, params: { symbol: null, timeframe: null } })
    expect(match("what's the weekly setup here")).toEqual({ action: CAPABILITY, params: { symbol: null, timeframe: 'W' } })
    expect(match("what's the chart")).toBeNull()
    expect(match('describe the setup of NVDA in detail please')).toBeNull()
    expect(fastParse('describe this setup', {})).toBeTruthy()
  })
})

// ── LT-15 (live 2026-11-03): "describe the setup on nvda" on a 4-chart board answered "Checking NVDA's daily setup now."
// and then showed nothing. The named-symbol phrase is now UCT's own (fast path, no model): the chart showing the ticker,
// else ANY chart as the op's target with nothing borrowed from it (bars.daily is per symbol); a word that only MIGHT be
// a ticker gets the neutral question; and a read that comes back with nothing says so (never an empty row).
describe('LT-15: "describe the setup on <SYMBOL>"', () => {
  beforeEach(() => { _resetAgentConfig(); _resetTurns(); _resetDescribeForTest(); config = SERVED; wirePanel() })
  afterEach(() => { _resetTurns(); _resetDescribeForTest(); vi.restoreAllMocks() })

  it('pure: the phrase → the symbol as typed and a timeframe; chart words, pronouns and positions are not tickers', async () => {
    await loadAgentConfig()
    expect(matchSymbol('describe the setup on nvda')).toEqual({ symbol: 'nvda', timeframe: null })
    expect(matchSymbol("What's the setup on $NVDA?")).toEqual({ symbol: 'NVDA', timeframe: null })
    expect(matchSymbol("describe NVDA's weekly setup")).toEqual({ symbol: 'NVDA', timeframe: 'W' })
    expect(matchSymbol('describe the setup for amd on the weekly')).toEqual({ symbol: 'amd', timeframe: 'W' })
    expect(matchSymbol('describe the daily setup of the NVDA chart')).toEqual({ symbol: 'NVDA', timeframe: 'D' })
    for (const t of ['describe the setup on this chart', 'describe the setup on it', 'describe the setup on the weekly',
      'describe the setup on the left chart', 'describe this setup', 'describe the setup on nvda and amd', 'buy nvda']) expect(matchSymbol(t), t).toBeNull()
    const charts = [{ ref: 'a', symbol: 'SPY' }, { ref: 'b', symbol: 'NVDA' }, { ref: 'c', symbol: 'NVDA' }, { ref: 'd', symbol: 'SPY' }]
    expect(chartForSymbol('nvda', charts)).toBe('b')                    // the chart showing it (first in reading order)
    expect(chartForSymbol('NVDA', charts, 'c')).toBe('c')               // …the selected one when several do
    expect(chartForSymbol('AMD', charts, 'd')).toBe('d')                // none shows it: the selected chart
    expect(chartForSymbol('AMD', charts)).toBe('a')                     // …else the first
    expect(chartForSymbol('AMD', [])).toBeNull()
  })

  it('NVDA on a chart (top-left of four, nothing selected): no model, no "Which chart?", ONE bars read of NVDA, that chart\'s card', async () => {
    const { say, board } = p.mount(...FOUR(['NVDA', 'SPY', 'SPY', 'SPY']))
    const out = await say('describe the setup on nvda')
    expect(p.turns()).toBe(0)
    expect(out).not.toMatch(/Which chart/)
    expect(reads.map(r => r.kind)).toEqual(['bars.daily'])               // the chart's own ticker: no index read
    expect(reads[0].params).toEqual({ symbol: 'NVDA', bars: 252 })
    expect(out).toMatch(/NVDA — daily setup \(.*NVDA\)\), from 252 completed sessions/)
    expect(out).toContain('On the chart:')
    expect(out).toContain(DESCRIPTIVE)
    expect(board.state.widgets.filter(w => w.type === 'chart')).toHaveLength(4)
    // "this chart" on the same board still asks which one (unchanged)
    const which = await say('describe the setup on this chart')
    expect(which).toMatch(/Which chart/)
    expect(reads.filter(r => r.kind === 'bars.daily')).toHaveLength(1)
  })

  it('NVDA on NO chart (four SPY charts): resolved through the index, then ONE bars read; nothing borrowed from an SPY chart', async () => {
    const { say, h } = p.mount(...FOUR(['SPY', 'SPY', 'SPY', 'SPY']))
    const before = h.charts.list().map(c => c.symbol)
    const out = await say('describe the setup on nvda')
    expect(p.turns()).toBe(0)
    expect(reads.map(r => r.kind)).toEqual(['instrument.resolve', 'bars.daily'])
    expect(reads[1].params).toEqual({ symbol: 'NVDA', bars: 252 })
    expect(out).toMatch(/NVDA( \(.*\))? — daily setup, from 252 completed sessions/)
    expect(out).not.toMatch(/SPY|On the chart:/)                        // no SPY label, no SPY indicators
    expect(h.charts.list().map(c => c.symbol)).toEqual(before)          // no chart was changed
  })

  it('an ambiguous word ("meta", no META chart): the neutral question, no bars read, no figure', async () => {
    const { say } = p.mount(...FOUR(['NVDA', 'SPY', 'SPY', 'SPY']))
    const out = await say('describe the setup on meta')
    expect(p.turns()).toBe(0)
    expect(reads.map(r => r.kind)).toEqual(['instrument.resolve'])
    expect(out).toContain('I\'m not sure which instrument "meta" means.')
    expect(out.replace(/\d{1,2}:\d{2}\s?[AP]M/g, '')).not.toMatch(/\d/)      // (the row's timestamp aside)
    // the same word typed as a ticker is described
    const sure = await say('describe the setup on META')
    expect(reads.at(-1)).toMatchObject({ kind: 'bars.daily', params: { symbol: 'META', bars: 252 } })
    expect(sure).toMatch(/META( \(.*\))? — daily setup/)
  })

  it('model path: an apply naming a symbol on an SPY chart (the live plan, scripted) describes that symbol', async () => {
    const { say } = p.mount(...FOUR(['NVDA', 'SPY', 'SPY', 'SPY']))
    // (the model's refs are c1…c4 in reading order: c1 = the NVDA chart, c2 = an SPY chart)
    p.st.envelopes.push(p.env('apply', [{ action: CAPABILITY, target: 'c2', args: { symbol: 'NVDA', timeframe: null } }], ''))
    const out = await say("can you give me a read on nvda's setup")
    expect(p.turns()).toBe(1)
    expect(reads.map(r => r.kind)).toEqual(['instrument.resolve', 'bars.daily'])
    expect(out).toMatch(/NVDA( \(.*\))? — daily setup, from/)
    expect(out).not.toMatch(/SPY/)
  })

  it('silent-failure path: a bars read that fails says so; a read that returns NOTHING says so — never an empty row', async () => {
    // (1) bars unavailable → the capability's own honest sentence
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const u = String(url)
      const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
      if (u === '/api/agent/config') return json(config)
      if (u === '/api/agent/data') { const b = JSON.parse(init.body); reads.push(b); return json(b.kind === 'instrument.resolve' ? resolveEnvelope(b.params) : { status: 'unavailable', data: null }) }
      if (u === '/api/agent/turn') return json({ conversationId: 'ac_1', envelope: p.st.envelopes.shift(), usage: { research_calls: 0, citations: [] } })
      return json({ conversations: [] })
    })
    const { say } = p.mount(...FOUR(['NVDA', 'SPY', 'SPY', 'SPY']))
    const failed = await say('describe the setup on nvda')
    expect(failed).toContain("I couldn't describe NVDA's setup: its completed daily bars are not available from UCT's market data. No figure is stated.")
    // (2) any query that returns nothing at all → NO_RESULT after the plan's reply
    expect([null, undefined, '', '   ', {}, { text: '' }].every(emptyAnswer)).toBe(true)
    expect([' x', { text: 'x' }, { present: { kind: 'metrics' } }, { table: { rows: [] } }].some(emptyAnswer)).toBe(false)
    const off = registerCapability({ name: 'lt15.emptyRead', target: 'chart', query: true, surfaces: ['charts'], summary: 'A read that returns nothing (test).',
      args: { type: 'object', properties: {}, required: [], additionalProperties: false }, answer: () => null })
    try {
      p.st.envelopes.push(p.env('apply', [{ action: 'lt15.emptyRead', target: 'c1', args: {} }], ''))
      const empty = await say('read something that comes back empty')
      expect(empty).toContain(NO_RESULT)
    } finally { off() }
  })
})
