// UCT Agent — PHASE 2A safety and consistency fixes (docs/agent/PHASE2-CHART-CONTROL-AUDIT.md §5), unit by
// unit against the real registry, planner, runtime and Undo. No model, no network.
//   F5  chart.compare: the product's published ceiling, counted on the result; honest no-op text
//   F6  chart.goToDate: a jump with no known earlier view says it can't be undone; a scrolled view makes Undo stale
//   F7  chart.setType on a breadth / market-indicator series writes (and reports) `breadthChartType`
//   D2  drawing.remove — superseded 2026-10-27 (Charts operator P1, owner): approval is for BROAD destructive
//       drawing operations (drawing.clear); one visible drawing is removed at once with Undo, a hidden one is shown first
//   F15 drawing.style on a Price Move writes `labelColor`
//   F14 "undo that indicator removal" never undoes a change of another kind
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { buildContext } from './capabilities'
import { planOps, collectTargets, prepareOps, undoNotesFor } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { fastParse } from './fastPath'
import { buildDrawingSource } from './host'
import { _resetAlertCache } from './capabilities/alert'
import { describeChart, isBreadthLikeSymbol } from './capabilities/chart'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { MAX_COMPARISONS } from '../components/chart/chartCeilings'
import { __setBreadthSymbolsForTest } from '../hooks/useBreadthSymbols'
import * as store from '../components/chart/drawingsStore'

registerBuiltins()
const CTX = { surface: 'charts' }
const D = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))

function chartHost({ stored = null, symbol = 'NVDA', viewKnown = true } = {}) {
  const st = { stored, tf: 'D', symbol, right: D('2026-10-07') }
  const view = () => (viewKnown ? { firstMs: D('2020-01-02'), lastMs: D('2026-10-07'), rightMs: st.right, fullyLoaded: true, loading: false } : null)
  const read = (ref) => (ref === 'c1' ? { ref, label: `Chart (${st.symbol})`, symbol: st.symbol, tf: st.tf, stored: st.stored, cs: mergeChartSettings(st.stored || {}), linkedCount: 0, view: view() } : null)
  return {
    st,
    charts: {
      list: () => [read('c1')], read,
      commit(ref, patch) { if ('settings' in patch) st.stored = patch.settings; if ('tf' in patch) st.tf = patch.tf; return true },
      goTo(ref, ms) { st.right = ms; viewKnown = true; return true },
    },
    otherWidgets: () => [],
  }
}
const op = (action, args, target = 'c1') => ({ action, target, args })
async function plan(host, ops, kinds = ['chart']) {
  buildContext(host, CTX)
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(host, kinds), ops, env, CTX), env }
}
const cmp = (syms) => ({ comparisonSymbols: syms.map(sym => ({ sym, enabled: true, color: '#123456', scaleMode: 'new' })) })

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    const q = /ticker-search\?q=([^&]+)/.exec(String(url))
    return q ? json({ results: [{ ticker: decodeURIComponent(q[1]) }] }) : json([])   // every ticker is known
  })
})
afterEach(() => { vi.restoreAllMocks(); __setBreadthSymbolsForTest(null) })

describe('F5 — chart.compare holds the product ceiling (chartCeilings.MAX_COMPARISONS)', () => {
  it('a sixth comparison is refused, with the real number', async () => {
    const host = chartHost({ stored: cmp(['AAA', 'BBB', 'CCC', 'DDD', 'EEE']) })
    const { p } = await plan(host, [op('chart.compare', { add: ['FFF'], remove: [], clear: false })])
    expect(MAX_COMPARISONS).toBe(5)
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/at most 5 symbols — this one would have 6/)
  })
  it('swapping one for another at the ceiling is counted on the RESULT, and runs', async () => {
    const host = chartHost({ stored: cmp(['AAA', 'BBB', 'CCC', 'DDD', 'EEE']) })
    const { p } = await plan(host, [op('chart.compare', { add: ['FFF'], remove: ['AAA'], clear: false })])
    expect(p.ok).toBe(true)
    expect(p.plans[0].after.cs.comparisonSymbols.map(x => x.sym)).toEqual(['BBB', 'CCC', 'DDD', 'EEE', 'FFF'])
  })
  it('a chart already past the ceiling (the Compare panel allows it) can still REMOVE', async () => {
    const host = chartHost({ stored: cmp(['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'GGG', 'HHH']) })
    const { p } = await plan(host, [op('chart.compare', { add: [], remove: ['AAA'], clear: false })])
    expect(p.ok).toBe(true)
  })
  it('removing a symbol that is not compared says so — never "already there"', async () => {
    const host = chartHost({ stored: cmp(['QQQ']) })
    const { p } = await plan(host, [op('chart.compare', { add: [], remove: ['SPY'], clear: false })])
    expect(p.noops).toEqual(['None of those is being compared on this chart'])
  })
})

describe('F6 — chart.goToDate is honest about its Undo', () => {
  it('a known earlier view: Undo scrolls back; once the member scrolls, Undo is stale and refuses', async () => {
    const host = chartHost()
    const { p, env } = await plan(host, [op('chart.goToDate', { date: '2024-03-15' })])
    const res = await commitPlan(host, p, { env })
    expect(res.undo).toBeTruthy()
    host.st.right = D('2025-01-02')                        // the member scrolls the chart by hand
    const u = await undoEntry(host, res.undo)
    expect(u.ok).toBe(false)
    expect(u.reason).toMatch(/has changed since/)
    expect(host.st.right).toBe(D('2025-01-02'))            // their view is left where they put it
  })
  it('an unknown earlier view: no Undo, and the receipt SAYS why', async () => {
    const host = chartHost({ viewKnown: false })
    const { p, env } = await plan(host, [op('chart.goToDate', { date: '2024-03-15' })])
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(true)
    expect(res.undo).toBeNull()
    expect(undoNotesFor(p, res)).toEqual([expect.stringMatching(/can't be undone here/)])
  })
  it('an ordinary chart change still ignores the view (scrolling never makes its Undo stale)', async () => {
    const host = chartHost()
    const { p, env } = await plan(host, [op('chart.setTimeframe', { timeframe: 'W' })])
    const res = await commitPlan(host, p, { env })
    host.st.right = D('2025-01-02')
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
  })
})

describe('F7 — chart.setType on a breadth series writes the key the canvas reads', () => {
  it('breadth: breadthChartType changes, the stock chartType is untouched; context reports the breadth type', async () => {
    __setBreadthSymbolsForTest([{ symbol: 'UCTA50' }])
    expect(isBreadthLikeSymbol('UCTA50')).toBe(true)
    const host = chartHost({ symbol: 'UCTA50', stored: { chartType: 'bars' } })
    const { p, env } = await plan(host, [op('chart.setType', { type: 'line' })])
    expect(p.ok).toBe(true)
    expect(p.lines).toEqual(['Changed chart to Line'])
    await commitPlan(host, p, { env })
    expect(host.st.stored.breadthChartType).toBe('line')
    expect(host.st.stored.chartType).toBe('bars')
    expect(describeChart(host.charts.read('c1'), 'c1').chartType).toBe('line')
  })
  it('a stock: chartType, as before', async () => {
    __setBreadthSymbolsForTest([{ symbol: 'UCTA50' }])
    const host = chartHost({ symbol: 'NVDA' })
    const { p, env } = await plan(host, [op('chart.setType', { type: 'bars' })])
    await commitPlan(host, p, { env })
    expect(host.st.stored.chartType).toBe('bars')
    expect(host.st.stored.breadthChartType).toBe('candles')   // the default, untouched
  })
})

describe('D2 / F15 — drawings', () => {
  let SYM, n = 0
  const dhost = () => ({ drawings: buildDrawingSource({ list: () => [{ label: `Chart (${SYM})`, symbol: SYM, drawSym: SYM, cs: {} }] }) })
  const dop = (action, args) => ({ action, target: SYM, args })
  beforeEach(() => { SYM = `P2A${++n}X`; _resetAlertCache() })

  // OWNER 2026-10-27 (Charts operator P1): approval is for BROAD destructive drawing operations (drawing.clear),
  // not every single removal — one visible drawing goes at once (Undo); a HIDDEN one is still shown first
  it('drawing.remove: one visible drawing is applied; a hidden one is a proposal; the receipt says every chart and layout on the symbol', async () => {
    const h = dhost()
    store.addDrawing(SYM, { type: 'horizontal', points: [{ time: 0, price: 150 }], color: '#ffffff' })
    store.addDrawing(SYM, { type: 'horizontal', points: [{ time: 0, price: 160 }], color: '#ffffff', hidden: true })
    const [shown, hidden] = store.peekDrawings(SYM).map(d => d.id)
    const { p } = await plan(h, [dop('drawing.remove', { drawing: shown })], ['drawing'])
    expect(p.ok).toBe(true)
    expect(decideMode('apply', p)).toBe('apply')
    expect(p.lines[0]).toMatch(new RegExp(`every chart and layout showing ${SYM}`))
    const { p: ph } = await plan(h, [dop('drawing.remove', { drawing: hidden })], ['drawing'])
    expect(ph.ok).toBe(true)
    expect(decideMode('apply', ph)).toBe('propose')
    expect(ph.lines[0]).toMatch(/\(hidden\)/)
  })
  it('a Price Move\'s colour is its label colour (the key its own settings write)', async () => {
    const h = dhost()
    store.addDrawing(SYM, { type: 'advance', points: [{ time: 0, price: 1 }, { time: 1, price: 2 }], labelColor: '#ffffff' })
    const id = store.peekDrawings(SYM)[0].id
    const { p, env } = await plan(h, [dop('drawing.style', { drawing: id, color: 'red', style: null, width: null })], ['drawing'])
    expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
    expect(p.lines[0]).toMatch(/colour/)
    await commitPlan(h, p, { env })
    const d = store.peekDrawings(SYM)[0]
    expect(d.labelColor).not.toBe('#ffffff')
    expect(d.color).toBeUndefined()
  })
})

describe('F14 — a named Undo never reaches a change of another kind', () => {
  it('"undo that indicator removal" carries the noun; plain "undo" does not', () => {
    expect(fastParse('undo that indicator removal')).toEqual({ kind: 'undo', about: 'indicator' })
    expect(fastParse('undo removing the indicator')).toEqual({ kind: 'undo', about: 'indicator' })
    expect(fastParse('undo that change')).toEqual({ kind: 'undo' })
    expect(fastParse('undo')).toEqual({ kind: 'undo' })
  })
})
