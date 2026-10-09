// BATCH 6 — chart control: deeper settings, templates/defaults, compare, custom timeframes,
// go-to-date (a view), chart tabs and canonical resize. Every write through the product's own
// writer shape; every receipt read back; Undo exact.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { buildContext, shapeError } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { buildWidgetSource } from './host'
import { mergeChartSettings, CHART_DEFAULTS } from '../components/chart/chartDefaults'
import { repackAroundMoved, resolveResize } from '../pages/charts/ChartsWorkspace'
import { WIDGET_REGISTRY } from '../widgets/registry'
import { boardProblems } from '../pages/charts/placement/arrange'
import { chartTabList } from '../pages/charts/chartTabs'
import { viewAt, dateMs } from './capabilities/chart'

registerBuiltins()
const CTX = { surface: 'charts' }
const D = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))

// A chart host whose view behaves like StockChart's Time Navigator (right edge = last bar ≤ date).
function chartHost({ stored = null, tf = 'D', symbol = 'NVDA', templates = [] } = {}) {
  const bars = []
  for (let t = D('2020-01-02'); t <= D('2026-10-07'); t += 86400000) { const d = new Date(t).getUTCDay(); if (d && d < 6) bars.push(t) }
  const st = { stored, tf, symbol, right: bars[bars.length - 1] }
  const meta = () => ({ firstMs: bars[0], lastMs: bars[bars.length - 1], rightMs: st.right, fullyLoaded: true, loading: false })
  const read = (ref) => (ref === 'c1' ? { ref, label: 'Chart (NVDA)', symbol: st.symbol, tf: st.tf, stored: st.stored, cs: mergeChartSettings(st.stored || {}), linkedCount: 0, view: meta() } : null)
  return {
    st,
    prefs: { read: () => ({ chart_templates: JSON.stringify(templates) }) },
    charts: {
      list: () => [read('c1')], read,
      commit(ref, patch) { if ('settings' in patch) st.stored = patch.settings; if ('tf' in patch) st.tf = patch.tf; return true },
      goTo(ref, ms) { st.right = [...bars].reverse().find(b => b <= ms) ?? bars[0]; return true },
    },
    otherWidgets: () => [],
  }
}
const op = (action, args, target = 'c1') => ({ action, target, args })
async function plan(host, ops, kinds = ['chart']) {
  buildContext(host, CTX)                       // the chartTemplates provider reads the templates
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(host, kinds), ops, env, CTX), env }
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (String(url).includes('ticker-search') || String(url).includes('/api/tickers')) return json({ results: [{ ticker: 'QQQ' }, { ticker: 'SPY' }] })
    return json({})
  })
})
afterEach(() => { vi.restoreAllMocks() })

describe('chart.setSetting — Batch 6 rows (colours, watermark detail, prev-day line style, swing options)', () => {
  it('a named colour becomes the dialog\'s hex; read back; Undo restores', async () => {
    const host = chartHost()
    const { p, env } = await plan(host, [op('chart.setSetting', { setting: 'grid.color', value: 'blue' })])
    expect(p.ok).toBe(true)
    expect(p.plans[0].after.cs.grid.color).toBe('#2962ff')
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(true)
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(host.st.stored).toBe(null)
  })
  it('a control the dialog hides behind another setting is refused until that setting is on', async () => {
    const host = chartHost()
    expect((await plan(host, [op('chart.setSetting', { setting: 'swingLabels.tintByType', value: true })])).p.refusals[0].reason).toMatch(/swing labels on first/)
    const both = await plan(host, [op('chart.setSetting', { setting: 'swingLabels.enabled', value: true }), op('chart.setSetting', { setting: 'swingLabels.tintByType', value: true })])
    expect(both.p.ok).toBe(true)                // in ONE plan, in order — exactly as a member would click
    expect(shapeError('chart.setSetting', { setting: 'watermark.opacity', value: 0.5 }, CTX)).toMatch(/isn't an option/)
  })
})

describe('chart.applyTemplate / chart.resetDefaults — the product\'s own whole-blob writes, proposed first', () => {
  const tpl = { name: 'Swing Dark', settings: { ...mergeChartSettings({}), chartType: 'bars', grid: { color: '#111111', visible: false } } }
  it('applies {...template.settings, preset:custom} — exactly the right-click flyout — with Undo', async () => {
    const host = chartHost({ templates: [tpl] })
    const { p, env } = await plan(host, [op('chart.applyTemplate', { template: 'swing dark' })])
    expect(p.ok).toBe(true)
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.plans[0].after.cs).toEqual({ ...tpl.settings, preset: 'custom' })
    const res = await commitPlan(host, p, { env })
    expect(host.st.stored).toEqual({ ...tpl.settings, preset: 'custom' })
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(host.st.stored).toBe(null)
    expect((await plan(chartHost({ templates: [tpl] }), [op('chart.applyTemplate', { template: 'Nope' })])).p.refusals[0].reason).toMatch(/no chart template named “Nope”/)
  })
  it('restore defaults writes CHART_DEFAULTS (Chart Settings → Restore defaults), proposed', async () => {
    const host = chartHost({ stored: { chartType: 'line' } })
    const { p } = await plan(host, [op('chart.resetDefaults', {})])
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.plans[0].after.cs).toEqual(JSON.parse(JSON.stringify(CHART_DEFAULTS)))
  })
})

describe('chart.compare — the Compare Symbols panel\'s entries', () => {
  it('add → {sym, enabled, color, scaleMode:new}; remove; clear leaves "Group only"', async () => {
    const host = chartHost()
    const { p, env } = await plan(host, [op('chart.compare', { add: ['qqq', 'SPY'], remove: [], clear: false })])
    expect(p.ok).toBe(true)
    const list = p.plans[0].after.cs.comparisonSymbols
    expect(list.map(x => [x.sym, x.enabled, x.scaleMode])).toEqual([['QQQ', true, 'new'], ['SPY', true, 'new']])
    expect(list[0].color).not.toBe(list[1].color)
    expect(p.lines).toEqual(['Comparing NVDA with QQQ, SPY'])
    await commitPlan(host, p, { env })
    const r = (await plan(host, [op('chart.compare', { add: [], remove: ['SPY'], clear: false })])).p
    expect(r.plans[0].after.cs.comparisonSymbols.map(x => x.sym)).toEqual(['QQQ'])
    const c = (await plan(host, [op('chart.compare', { add: [], remove: [], clear: true })])).p
    expect(c.plans[0].after.cs).toMatchObject({ comparisonSymbols: [], compareHideBase: false })
    expect((await plan(host, [op('chart.compare', { add: ['NVDA'], remove: [], clear: false })])).p.refusals[0].reason).toMatch(/already shows NVDA/)
  })
})

describe('chart.addCustomTimeframe — the timeframe menu\'s Custom interval', () => {
  it('45 minutes: joins header.customTimeframes and the chart switches to it (one write, Undo)', async () => {
    const host = chartHost()
    const { p, env } = await plan(host, [op('chart.addCustomTimeframe', { unit: 'minutes', count: 45, switch: true })])
    expect(p.lines).toEqual(['Added a 45m timeframe and switched the chart to it'])
    const res = await commitPlan(host, p, { env })
    expect(host.st.tf).toBe('45')
    expect(mergeChartSettings(host.st.stored).header.customTimeframes).toEqual(['45'])
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(host.st.tf).toBe('D')
    expect((await plan(host, [op('chart.addCustomTimeframe', { unit: 'hours', count: 0, switch: true })])).p.refusals[0].reason).toMatch(/whole number/)
  })
})

describe('chart.goToDate — the Time Navigator jump (a view), read back, Undo scrolls back', () => {
  it('March 15, 2024 (a Friday): the right edge is that bar; a weekend date lands on the bar before', async () => {
    const host = chartHost()
    const before = host.st.right
    const { p, env } = await plan(host, [op('chart.goToDate', { date: '2024-03-15' })])
    expect(p.lines[0]).toMatch(/Moved the view to 2024-03-15/)
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(true)
    expect(host.st.right).toBe(D('2024-03-15'))
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(host.st.right).toBe(before)
    expect(viewAt({ firstMs: 0, lastMs: D('2026-10-07'), rightMs: D('2024-03-15'), fullyLoaded: true }, D('2024-03-17'))).toBe(true)
    expect((await plan(host, [op('chart.goToDate', { date: '2024-02-30' })])).p.refusals[0].reason).toMatch(/isn't a date/)
    expect(dateMs('2099-01-01')).toBeGreaterThan(Date.now())
    expect((await plan(host, [op('chart.goToDate', { date: '2099-01-01' })])).p.refusals[0].reason).toMatch(/future/)
  })
})

// ── the board: canonical resize and chart tabs ──
const COLS = 24, ROWS = 20
const minOf = (w) => ({ minW: WIDGET_REGISTRY[w?.type]?.defaults?.minW || 2, minH: WIDGET_REGISTRY[w?.type]?.defaults?.minH || 3 })
function boardHost(widgets) {
  const state = { widgets: widgets.map(w => ({ color: 'A', opts: {}, ...w })), writes: 0 }
  const widgetOps = {
    layout: () => state, grid: () => ({ cols: COLS, rows: ROWS }), minOf,
    repack: (ws, id, rect) => repackAroundMoved(ws, id, rect, COLS, ROWS),
    resize: (ws, id, rect, handle) => resolveResize(ws, { i: id, ...rect }, handle),
    themeAll: () => null,
    applyBoard: (p) => {
      state.writes += 1
      let ws = state.widgets.filter(w => !(p.remove || []).includes(w.id)).map(w => (p.set?.[w.id] ? { ...w, ...p.set[w.id] } : w))
      for (const r of p.restore || []) if (!ws.some(w => w.id === r.id)) ws.push(r)
      state.widgets = ws
    },
    groupSyms: () => ({}),
  }
  return { state, widgets: buildWidgetSource({ widgetOps, getWidgets: () => state.widgets }), watchlists: { snapshot: () => [] } }
}
const bop = (action, args) => ({ action, target: 'board', args })

describe('widget.resize — the resize handles\' own resolveResize', () => {
  it('"make my watchlist narrower and give the main chart more space": the chart\'s right edge moves, the watchlist shrinks', async () => {
    const host = boardHost([{ id: 'c', type: 'chart', x: 0, y: 0, w: 16, h: 20 }, { id: 'wl', type: 'watchlist', x: 16, y: 0, w: 8, h: 20 }])
    const { p, env } = await plan(host, [bop('widget.resize', { widget: 'c', edge: 'right', by: 3 })], ['board'])
    expect(p.ok).toBe(true)
    expect(p.lines[0]).toMatch(/^Resized the Chart .* to 19×20 cells \(1 neighbour gave up the space\)/)
    const res = await commitPlan(host, p, { env })
    expect(host.state.widgets.find(w => w.id === 'wl')).toMatchObject({ x: 19, w: 5 })
    expect(boardProblems(host.state.widgets, COLS, ROWS, minOf)).toEqual([])
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(host.state.widgets.find(w => w.id === 'wl')).toMatchObject({ x: 16, w: 8 })
  })

  it('two neighbours, one near its minimum: the largest step BOTH can give, never a gap (found in browser acceptance)', async () => {
    // the local acceptance board: chart 3..20, watchlist 20..24 above search 20..24 (search min 3)
    const host = boardHost([{ id: 'c', type: 'chart', x: 3, y: 0, w: 17, h: 17 }, { id: 'wl', type: 'watchlist', x: 20, y: 0, w: 4, h: 11 },
      { id: 's', type: 'search', x: 20, y: 11, w: 4, h: 9 }, { id: 't', type: 'themes', x: 0, y: 0, w: 3, h: 20 }, { id: 'f', type: 'fundamentals', x: 3, y: 17, w: 17, h: 3 }])
    const sMin = minOf({ type: 'search' }).minW
    const { p, env } = await plan(host, [bop('widget.resize', { widget: 'c', edge: 'right', by: 2 })], ['board'])
    expect(p.ok).toBe(true)
    await commitPlan(host, p, { env })
    const g = (id) => host.state.widgets.find(w => w.id === id)
    const step = Math.min(2, 4 - sMin)
    expect(g('c').w).toBe(17 + step)
    for (const id of ['wl', 's']) expect(g(id).x).toBe(g('c').x + g('c').w)   // flush — no gap
    expect(boardProblems(host.state.widgets, COLS, ROWS, minOf)).toEqual([])
    if (step < 2) expect(p.lines[0]).toMatch(new RegExp(`${step} of the 2 asked`))
  })
})

describe('chart tabs — the tab strip\'s reducers, one board write, exact Undo', () => {
  it('add a tab (same link colour, switched to), rename it, link it, select main, close it; Undo restores the tab and its settings', async () => {
    const host = boardHost([{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'B', opts: { tf: 'D', settings: { chartType: 'line' } } }])
    let r = await plan(host, [bop('chart.addTab', { widget: 'c', timeframe: '60', name: 'Intraday' })], ['board'])
    expect(r.p.lines).toEqual(['Added a chart tab “Intraday” to the Chart and switched to it'])
    await commitPlan(host, r.p, { env: r.env })
    let w = host.state.widgets[0]
    expect(chartTabList(w.opts).map(t => t.label)).toEqual(['1D', 'Intraday'])
    expect(w.opts.activeChartTab).toBe(1)
    expect(w.opts.chartTabs[0]).toMatchObject({ tf: '60', color: 'B' })
    expect(w.opts.settings).toEqual({ chartType: 'line' })             // the main tab's settings untouched
    r = await plan(host, [bop('chart.linkTab', { widget: 'c', tab: 'Intraday', color: 'C' }), bop('chart.selectTab', { widget: 'c', tab: 'main' })], ['board'])
    expect(r.p.ok).toBe(true)
    await commitPlan(host, r.p, { env: r.env })
    w = host.state.widgets[0]
    expect(w.opts.chartTabs[0].color).toBe('C')
    expect(w.opts.activeChartTab).toBe(0)
    const tabSettings = w.opts.chartTabs[0].settings
    r = await plan(host, [bop('chart.closeTab', { widget: 'c', tab: '1' })], ['board'])
    const res = await commitPlan(host, r.p, { env: r.env })
    expect(host.state.widgets[0].opts.chartTabs).toBe(undefined)
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(host.state.widgets[0].opts.chartTabs[0].settings).toEqual(tabSettings)
    expect((await plan(host, [bop('chart.closeTab', { widget: 'c', tab: 'main' })], ['board'])).p.refusals[0].reason).toMatch(/main tab can't be closed/)
  })
})
