// Track D workflow "setupSnapshot" — `chartSetup.multiTimeframe` (DARK, UCT_AGENT_WORKFLOWS). The daily and weekly setup
// side by side from ONE bars.daily read, over SYNTHETIC bars: both columns equal chart.describeSetup's own figures for D
// and W (one computation, reused), the alignment count, short history named per column, stale, refusals; the REAL panel
// (fast path on the chart's own symbol, a named symbol resolved first, model path), dark by default, isolation.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handshake from './__fixtures__/program/isolation.json'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import { setupPanel, ONE, FOUR } from './testing/panelHarness'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { allCapabilityNames, getCapability } from './capabilities'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { groupOfAction, wordsSelect } from './routing'
import { _resetTurns } from './trace'
import { resolveEnvelope } from './marketdata/__fixtures__/fakeResolve'
import { setupOf } from './capabilities/chartDescribe'
import {
  answerFromMultiTimeframe, matchMulti, multiTimeframeServed, registerMultiTimeframeCapability, _resetMultiTimeframeForTest, CAPABILITY,
} from './capabilities/multiTimeframe'
import { DESCRIPTIVE } from './capabilities/workflowGate'

registerBuiltins()

function sessions(n, end = '2026-10-30') {
  const out = []
  const d = new Date(`${end}T12:00:00Z`)
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
const closeAt = (i, n) => 50 + i * 0.2 + (i % 7) * 0.3 - (i > n - 12 ? (i - (n - 12)) * 0.6 : 0)
const makeBars = (n, end) => sessions(n, end).map((date, i) => {
  const close = Math.round(closeAt(i, n) * 100) / 100
  return { date, open: close - 0.2, high: Math.round((close + 0.5 + (i % 3) * 0.1) * 100) / 100, low: Math.round((close - 0.6) * 100) / 100, close, volume: 1_000_000 + (i % 10) * 20_000 }
})
function barsEnv(bars, o = {}) {
  const through = bars.length ? bars[bars.length - 1].date : null
  return { contract: 'MD-1.0', kind: 'bars.daily', params_echo: {}, status: bars.length >= 252 ? 'ok' : 'partial', freshness: 'historical', as_of: through ? `${through}T20:00:00Z` : null,
    fetched_at: '2026-11-02T16:00:00Z', delay_s: null, stale: false, source: 'uct-bars', coverage: null, provider_calls: 0, notes: ['a note that must never be echoed'],
    data: { symbol: 'QQQ', bars, through, latest_completed_session: through }, ...o }
}
const FULL = makeBars(252)

describe('chartSetup.multiTimeframe: the card (pure)', () => {
  it('both columns are chart.describeSetup\'s own D and W figures; the text and table show the same rounded numbers', () => {
    const a = answerFromMultiTimeframe(barsEnv(FULL), { symbol: 'qqq' })
    const D = setupOf(barsEnv(FULL), { timeframe: 'D' }).setup
    const W = setupOf(barsEnv(FULL), { timeframe: 'W' }).setup
    expect(a.snapshot.daily).toEqual({ close_vs_sma20: D.measurables.close_vs_sma20, close_vs_sma50: D.measurables.close_vs_sma50, range_pct_10: D.measurables.range_pct_10 })
    expect(a.snapshot.weekly).toEqual({ close_vs_sma20w: W.weekly.close_vs_sma20w, close_vs_sma50w: W.weekly.close_vs_sma50w, range_pct_10w: W.weekly.range_pct_10w })
    expect(a.snapshot).toMatchObject({ symbol: 'QQQ', asOf: '2026-10-30', source: 'bars.daily', stale: false })
    const lines = a.text.split('\n')
    expect(lines[0]).toMatch(/^QQQ — daily and weekly setup side by side, from 252 completed sessions \(\d+ calendar weeks\) ending Fri, Oct 30:$/)
    expect(lines[1]).toMatch(/^Close: \$[\d.]+ on Fri, Oct 30 — also the close of the week ending Fri, Oct 30\.$/)
    expect(lines[2]).toMatch(/^vs the 20-bar SMA: daily [\d.]+% (above|below) its 20-session SMA .*; weekly [\d.]+% (above|below) its 20-week SMA/)
    for (const v of [D.measurables.close_vs_sma20, W.weekly.close_vs_sma50w, D.measurables.range_pct_10, W.weekly.range_pct_10w]) expect(a.text).toContain(`${Math.abs(v).toFixed(2)}%`)
    expect(a.text).toMatch(/^Alignment: the close is above \d of the 4 averages measured/m)
    expect(lines.at(-2)).toBe(DESCRIPTIVE)
    expect(a.table.rows.map(r => r[0])).toEqual(['Close vs 20-bar SMA', 'Close vs 50-bar SMA', '10-bar width'])
    expect(a.text).not.toMatch(/never be echoed|\blive\b|\bnow\b|\bbuy\b|\bsell\b|bullish|bearish/i)
  })

  it('alignment counts exactly the averages measured; a short history names what each column lacks', () => {
    const short = makeBars(120)
    const a = answerFromMultiTimeframe(barsEnv(short), { symbol: 'QQQ' })
    expect(a.text).toMatch(/weekly not measured \(needs 50 weeks; \d+ held\)/)
    expect(a.text).toMatch(/^Alignment: the close is above \d of the 3 averages measured/m)
    expect(a.text).toContain('Off the 52-week high: not measured — needs 252 completed sessions')
    expect(a.text).toContain('Only 120 completed sessions are held')
    expect(a.table.rows[1][2]).toBe('—')
  })

  it('a partial last week is said; stale bars are said; no bars → the fixed sentence, no figure', () => {
    const mid = makeBars(252, '2026-10-28')          // a Wednesday: that week holds 3 sessions
    expect(answerFromMultiTimeframe(barsEnv(mid), { symbol: 'QQQ' }).text).toContain('(that week holds 3 completed sessions)')
    const stale = answerFromMultiTimeframe(barsEnv(FULL, { stale: true, data: { symbol: 'QQQ', bars: FULL, through: '2026-10-30', latest_completed_session: '2026-11-02' } }), { symbol: 'QQQ' })
    expect(stale.text).toContain("Note: UCT's bars end Fri, Oct 30, but the most recent completed session was Mon, Nov 2")
    const none = answerFromMultiTimeframe(barsEnv([], { status: 'unavailable', data: null }), { symbol: 'QQQ' }).text
    expect(none).toBe("I couldn't describe QQQ's setup: its completed daily bars are not available from UCT's market data. No figure is stated.")
  })
})

const SERVED = { stream: false, nl1: false, data: true, scan: false, data_kinds: ['bars.daily', 'instrument.resolve'], workflows: ['setupSnapshot'] }
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
      if (b.kind === 'bars.daily') return json({ ...barsEnv(FULL), data: { ...barsEnv(FULL).data, symbol: b.params.symbol } })
      return json({ status: 'refused', data: null })
    }
    if (u.startsWith('/api/live-prices')) throw new Error('an Agent read called /api/live-prices')
    return harness(url, init)
  })
}

describe('chartSetup.multiTimeframe: served panel, dark, isolation', () => {
  beforeEach(() => { _resetAgentConfig(); _resetTurns(); _resetMultiTimeframeForTest(); config = SERVED; wirePanel() })
  afterEach(() => { _resetTurns(); _resetMultiTimeframeForTest(); vi.restoreAllMocks() })

  it('fast path on the chart\'s own symbol: 0 model turns, ONE bars.daily(252), no index read, the chart unchanged', async () => {
    const { say, h } = p.mount(...ONE('QQQ'))
    const before = h.charts.list().map(c => c.symbol)
    const out = await say('show me the daily and weekly setup side by side')
    expect(p.turns()).toBe(0)
    expect(reads.map(r => r.kind)).toEqual(['bars.daily'])
    expect(reads[0]).toMatchObject({ params: { symbol: 'QQQ', bars: 252 }, purpose: 'answer' })
    expect(out).toContain('QQQ — daily and weekly setup side by side')
    expect(out).toContain(DESCRIPTIVE)
    expect(h.charts.list().map(c => c.symbol)).toEqual(before)
  })

  it('a named symbol on no chart: resolved through the index, then ONE bars read; nothing borrowed from the SPY charts', async () => {
    const { say } = p.mount(...FOUR(['SPY', 'SPY', 'SPY', 'SPY']))
    const out = await say('daily vs weekly setup for NVDA')
    expect(p.turns()).toBe(0)
    expect(reads.map(r => r.kind)).toEqual(['instrument.resolve', 'bars.daily'])
    expect(reads[1].params).toEqual({ symbol: 'NVDA', bars: 252 })
    expect(out).toMatch(/NVDA( \(.*?\))? — daily and weekly setup side by side/)
    expect(out).not.toMatch(/SPY/)
  })

  it('model path (scripted): a plan naming a symbol on an SPY chart describes that symbol; "this chart" on four charts asks which', async () => {
    const { say } = p.mount(...FOUR(['NVDA', 'SPY', 'SPY', 'SPY']))
    await loadAgentConfig()
    expect(matchMulti('multi-timeframe snapshot of this chart')).toEqual({ symbol: null })
    p.st.envelopes.push(p.env('apply', [{ action: CAPABILITY, target: 'c2', args: { symbol: 'NVDA' } }], ''))
    const out = await say('can you give me a multi-timeframe read on nvda')
    expect(p.turns()).toBe(1)
    expect(JSON.stringify(p.lastTurnBody())).toContain(CAPABILITY)
    expect(reads.map(r => r.kind)).toEqual(['instrument.resolve', 'bars.daily'])
    expect(reads.at(-1).params).toEqual({ symbol: 'NVDA', bars: 252 })
    expect(out).toMatch(/NVDA( \(.*?\))? — daily and weekly setup side by side/)
    expect(out).not.toMatch(/SPY/)
    // "this chart" with four charts and none selected: the fast path does not guess, and the plan asks which chart
    p.st.envelopes.push(p.env('apply', [{ action: CAPABILITY, target: 'c1', args: { symbol: null } }], ''))
    const which = await say('multi-timeframe snapshot of this chart')
    expect(which).toMatch(/Which chart/)
    expect(reads).toHaveLength(2)
  })

  it('dark by default: flag off, or a kind missing → nothing registers, the fast path claims nothing, no routing words, no read', async () => {
    for (const c of [{ workflows: [] }, { workflows: ['relativeStrength', 'watchlistChanges'] }, { data: false }, { data_kinds: ['bars.daily'] }]) {
      _resetAgentConfig(); _resetMultiTimeframeForTest()
      config = { ...SERVED, ...c }
      await loadAgentConfig()
      expect(multiTimeframeServed()).toBe(false)
      expect(registerMultiTimeframeCapability()).toBe(false)
      expect(allCapabilityNames()).not.toContain(CAPABILITY)
      expect(matchMulti('daily and weekly setup for NVDA')).toBeNull()
    }
    expect(wordsSelect('chartSetup', 'daily and weekly setup for NVDA')).toBe(false)
    expect(reads).toEqual([])
  })

  it('review #788 f: a LATER config load that switches the workflow off takes the capability and its routing words out', async () => {
    await loadAgentConfig()
    expect(registerMultiTimeframeCapability()).toBe(true)
    _resetAgentConfig(); config = { ...SERVED, workflows: [] }
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames()).not.toContain(CAPABILITY)
    expect(wordsSelect('chartSetup', 'daily and weekly setup for NVDA')).toBe(false)
  })

  it('isolation and shape: a served NON-local chart query in the chartSetup group; phrasings', async () => {
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const cap = getCapability(CAPABILITY)
    expect(cap).toMatchObject({ query: true, target: 'chart' })
    expect(cap.localOnly).toBeFalsy()
    expect(handshake.local_only_actions).not.toContain(CAPABILITY)
    expect(groupOfAction(CAPABILITY)).toBe('chartSetup')
    expect(wordsSelect('chartSetup', 'daily and weekly setup for NVDA')).toBe(true)
    expect(matchMulti('daily and weekly setup for NVDA')).toEqual({ symbol: 'NVDA' })
    expect(matchMulti("NVDA's daily vs weekly")).toEqual({ symbol: 'NVDA' })
    expect(matchMulti('compare the weekly and daily view of amd')).toEqual({ symbol: 'amd' })
    expect(matchMulti('mtf setup')).toEqual({ symbol: null })
    for (const t of ['describe this setup', 'switch to weekly', 'daily and weekly setup for it', 'daily and weekly setup for NVDA and AMD']) expect(matchMulti(t), t).toBeNull()
  })
})
