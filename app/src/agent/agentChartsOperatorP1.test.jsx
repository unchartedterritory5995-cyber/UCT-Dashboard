// UCT Agent — CHARTS OPERATOR PHASE 1 (2026-10-27): the Agent-only completion batch, unit by unit against the
// REAL registry, planner, runtime and Undo. No model, no network (fetch is a local stand-in).
//   chartSetup.*            copy a look · remove / star a timeframe · comparison display · save / delete a template
//   chart.resetDefaults     A1's keepIndicatorState (indicators AND header.infoValues kept — finding C5)
//   drawing.*               show/hide · lock · move a level · show/hide all · clear (proposed) · remove (owner rule)
//   watchlist.*             reorder (A–Z, to the top) · notes
//   indicator.discardDraft  through the Indicators-owned authoring interface
//   ordinal / positional    "the second chart", "NVDA on the left and AMD on the right", "side by side", "look like"
//   hardening               clarify choices · the 12-op model plan limit
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability, MANIFEST_CONTRACT } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { fastParse, extractTarget } from './fastPath'
import { ordinalChart, chartsNamedBy } from './deixis'
import { multiChartPlan, tickersIn } from './multiChart'
import { clarifyChoices, MAX_MODEL_OPS } from './useAgent'
import { buildDrawingSource } from './host'
import { _resetAlertCache } from './capabilities/alert'
import { lookOnto, tfCodeOf, NOT_LOOK_TOP } from './capabilities/chartSetup'
import { lastTouchedDrawing, _resetDrawingMemory } from './capabilities/drawings'
import { setAuthoringSources, _resetAuthoring, indicatorDraftsKind } from './capabilities/indicatorAuthoring'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings, CHART_DEFAULTS } from '../components/chart/chartDefaults'
import { keepIndicatorState } from '../components/chart/indicatorPreservation'
import { chartTemplatesAfterSave, chartTemplatesAfterDelete } from '../components/chart/chartTemplateApply'
import { INDICATOR_OWNED_TOP_KEYS } from '../components/chart/builder/agentSeams'
import { parseFormula } from '../components/chart/engine/ast/parse'
import { _simulateReload, STORAGE_KEY } from '../components/chart/builder/authoring/conversationSessions'
import { _resetDraftPreview, listDrafts } from '../components/chart/builder/agentAuthoring'
import * as store from '../components/chart/drawingsStore'

registerBuiltins()
const CTX = { surface: 'charts' }
let alertRows = []
beforeEach(() => {
  alertRows = []
  _resetAlertCache()
  _resetDrawingMemory()
  globalThis.fetch = vi.fn(async (url) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    const q = /ticker-search\?q=([^&]+)/.exec(String(url))
    if (q) return json({ results: [{ ticker: decodeURIComponent(q[1]) }] })          // every ticker is known
    if (String(url).startsWith('/api/watchlist-alerts')) return json(alertRows)
    return json([])
  })
})
afterEach(() => { vi.restoreAllMocks() })

async function plan(host, ops, kinds) {
  buildContext(host, CTX)
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(host, kinds), ops, env, CTX), env }
}
async function run(host, ops, kinds) {
  const { p, env } = await plan(host, ops, kinds)
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  const res = await commitPlan(host, p, { env, ctx: CTX })
  expect(res.ok, JSON.stringify(res.failed)).toBe(true)
  return { p, res }
}
// two charts side by side (left / right), each with its own settings
const twoCharts = (left = {}, right = {}) => makeBoard([
  { id: 'L', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'N', opts: { settings: left } },
  { id: 'R', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'N', opts: { settings: right } },
], { 'N:L': 'NVDA', 'N:R': 'AMD' })

// ── chartSetup.copyLook ───────────────────────────────────────────────────────────────────────────
describe('chartSetup.copyLook — the other chart\'s LOOK, never its indicators', () => {
  const RIGHT = { background: '#112233', bgMode: 'solid', chartType: 'bars', logScale: true, grid: { visible: false, color: '#334455' },
    indicatorInstances: [{ instanceId: 'r:rsi', defId: 'rsi', inputs: { period: 14 } }], overlays: [{ type: 'EMA', period: 50 }],
    comparisonSymbols: [{ sym: 'QQQ', enabled: true, color: '#fff', scaleMode: 'new' }], header: { titleMode: 'ticker', timeframes: ['D', 'W'], infoValues: ['r'] } }
  const LEFT = { background: '#000000', indicatorInstances: [{ instanceId: 'l:ema', defId: 'ema', inputs: { period: 9 } }],
    comparisonSymbols: [], header: { titleMode: 'both', timeframes: ['5', 'D'], customTimeframes: ['45'], infoValues: ['l'] }, positionCalc: { accountSize: 9 } }

  it('lookOnto keeps the TARGET\'s indicator keys, header.infoValues, comparisons, timeframe menu and calculator', () => {
    const out = lookOnto(RIGHT, LEFT)
    expect(out.background).toBe('#112233')
    expect(out.chartType).toBe('bars')
    expect(out.logScale).toBe(true)
    expect(out.grid).toEqual({ visible: false, color: '#334455' })
    expect(out.header.titleMode).toBe('ticker')
    for (const k of INDICATOR_OWNED_TOP_KEYS) expect(out[k], k).toEqual(LEFT[k])
    expect(out.header.infoValues).toEqual(['l'])
    expect(out.header.timeframes).toEqual(['5', 'D'])
    expect(out.header.customTimeframes).toEqual(['45'])
    for (const k of NOT_LOOK_TOP) expect(out[k], k).toEqual(LEFT[k])
    expect(out.preset).toBe('custom')
  })
  it('the indicator rule IS keepIndicatorState (A1) — copyLook never stamps the source chart\'s indicators', () => {
    const k = keepIndicatorState(RIGHT, LEFT)
    for (const key of INDICATOR_OWNED_TOP_KEYS) expect(lookOnto(RIGHT, LEFT)[key], key).toEqual(k[key])
  })
  it('plans on the real board: proposed, exact Undo; the source chart is never written', async () => {
    const { host, state } = twoCharts(LEFT, RIGHT)
    const ops = [{ action: 'chartSetup.copyLook', target: 'L', args: { from: 'R' } }]
    const { p } = await plan(host, ops, ['chart'])
    expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.lines[0]).toMatch(/Copied the look of Chart R/)
    const before = JSON.stringify(state.widgets.find(w => w.id === 'R').opts.settings)
    const { res } = await run(host, ops, ['chart'])
    const left = state.widgets.find(w => w.id === 'L').opts.settings
    expect(left.background).toBe('#112233')
    // the planner works on the MERGED chart (every chart op does): the target's own merged instances, never the source's
    expect(left.indicatorInstances).toEqual(mergeChartSettings(LEFT).indicatorInstances)
    expect(left.indicatorInstances.some(i => i.instanceId === 'r:rsi')).toBe(false)
    expect(JSON.stringify(state.widgets.find(w => w.id === 'R').opts.settings)).toBe(before)
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(state.widgets.find(w => w.id === 'L').opts.settings).toEqual(LEFT)
  })
  it('refuses a chart that is not on the board, and the same chart twice', async () => {
    const { host } = twoCharts(LEFT, RIGHT)
    expect((await plan(host, [{ action: 'chartSetup.copyLook', target: 'L', args: { from: 'ZZ' } }], ['chart'])).p.refusals[0].reason).toMatch(/Which chart/)
    expect((await plan(host, [{ action: 'chartSetup.copyLook', target: 'L', args: { from: 'L' } }], ['chart'])).p.refusals[0].reason).toMatch(/same chart/)
  })
})

// ── timeframes ───────────────────────────────────────────────────────────────────────────────────
describe('chartSetup.removeTimeframe / favoriteTimeframe — the timeframe menu\'s ✕ and ★', () => {
  const S = { header: { customTimeframes: ['45', '2h'], timeframes: ['5', 'D', '45'] } }
  it('tfCodeOf reads codes and words, never guesses', () => {
    expect(tfCodeOf('45')).toBe('45')
    expect(tfCodeOf('45m')).toBe('45')
    expect(tfCodeOf('2 hours')).toBe(tfCodeOf('2h'))
    expect(tfCodeOf('D')).toBe('D')
    expect(tfCodeOf('soon')).toBeNull()
  })
  it('remove: out of the custom list AND the stars (ChartPane.removeCustomTf); exact Undo', async () => {
    const { host, state } = twoCharts(S)
    const { res } = await run(host, [{ action: 'chartSetup.removeTimeframe', target: 'L', args: { timeframe: '45' } }], ['chart'])
    expect(res.lines[0]).toMatch(/Removed the .* timeframe/)
    const h = state.widgets.find(w => w.id === 'L').opts.settings.header
    expect(h.customTimeframes).toEqual(['2h'])
    expect(h.timeframes).toEqual(['5', 'D'])
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(state.widgets.find(w => w.id === 'L').opts.settings.header).toEqual(S.header)
  })
  it('refuses a built-in timeframe, one the chart does not have, and the one it is showing', async () => {
    const { host, state } = twoCharts(S)
    const why = async (tf) => (await plan(host, [{ action: 'chartSetup.removeTimeframe', target: 'L', args: { timeframe: tf } }], ['chart'])).p.refusals?.[0]?.reason
    expect(await why('D')).toMatch(/built-in/)
    expect(await why('3D')).toMatch(/isn't one of this chart's custom/)
    state.widgets = state.widgets.map(w => (w.id === 'L' ? { ...w, opts: { ...w.opts, tf: '45' } } : w))
    expect(await why('45')).toMatch(/showing/)
  })
  it('"remove the 45 minute timeframe" is an instant command', () => {
    expect(fastParse('remove the 45 minute timeframe')).toMatchObject({ kind: 'ops', ops: [{ action: 'chartSetup.removeTimeframe', args: { timeframe: '45' } }] })
    expect(fastParse('remove the daily timeframe')).toBeNull()
  })
  it('star / un-star (ChartPane.toggleTfFav); a timeframe not in the menu is refused', async () => {
    const { host, state } = twoCharts(S)
    await run(host, [{ action: 'chartSetup.favoriteTimeframe', target: 'L', args: { timeframe: 'W', favorite: true } }], ['chart'])
    expect(state.widgets.find(w => w.id === 'L').opts.settings.header.timeframes).toEqual(['5', 'D', '45', 'W'])
    const { p } = await plan(host, [{ action: 'chartSetup.favoriteTimeframe', target: 'L', args: { timeframe: '3D', favorite: true } }], ['chart'])
    expect(p.refusals[0].reason).toMatch(/add it as a custom timeframe first/)
  })
})

// ── compare display ──────────────────────────────────────────────────────────────────────────────
describe('chartSetup.compareDisplay — the Compare panel\'s scale, eye and Group only', () => {
  const C = { comparisonSymbols: [{ sym: 'QQQ', enabled: true, color: '#1', scaleMode: 'new' }, { sym: 'SPY', enabled: true, color: '#2', scaleMode: 'new' }], percentScale: true }
  it('one overlay onto the main scale, another hidden, Group only on — exact Undo', async () => {
    const { host, state } = twoCharts(C)
    const ops = [
      { action: 'chartSetup.compareDisplay', target: 'L', args: { symbols: ['QQQ'], scale: 'same', visible: null, groupOnly: null } },
      { action: 'chartSetup.compareDisplay', target: 'L', args: { symbols: ['SPY'], scale: null, visible: false, groupOnly: true } },
    ]
    const { res } = await run(host, ops, ['chart'])
    const cs = state.widgets.find(w => w.id === 'L').opts.settings
    expect(cs.comparisonSymbols.map(x => [x.sym, x.scaleMode, x.enabled])).toEqual([['QQQ', 'same', true], ['SPY', 'new', false]])
    expect(cs.compareHideBase).toBe(true)
    expect(res.lines.join(' ')).toMatch(/QQQ on the main price scale/)
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(state.widgets.find(w => w.id === 'L').opts.settings).toEqual(C)
  })
  it('refuses a chart with no comparisons and a symbol not compared', async () => {
    const { host } = twoCharts({}, C)
    expect((await plan(host, [{ action: 'chartSetup.compareDisplay', target: 'L', args: { symbols: [], scale: 'same', visible: null, groupOnly: null } }], ['chart'])).p.refusals[0].reason).toMatch(/no comparisons/)
    expect((await plan(host, [{ action: 'chartSetup.compareDisplay', target: 'R', args: { symbols: ['IWM'], scale: 'same', visible: null, groupOnly: null } }], ['chart'])).p.refusals[0].reason).toMatch(/IWM isn't compared/)
  })
})

// ── templates ────────────────────────────────────────────────────────────────────────────────────
describe('chartSetup.saveTemplate / deleteTemplate — Chart Settings → Templates, through the ONE shared helper', () => {
  const withPrefs = (templates) => {
    const b = twoCharts({ background: '#abcdef', indicatorInstances: [{ instanceId: 'x', defId: 'rsi' }] })
    const prefs = { chart_templates: JSON.stringify(templates) }
    b.prefs = prefs
    b.host.prefs = { read: () => prefs, write: vi.fn(async (k, v) => { prefs[k] = v; return true }) }
    return b
  }
  const listOf = (b) => JSON.parse(b.prefs.chart_templates)
  it('the helper: new first, a same-named one replaced (case-insensitive), capped; delete by id', () => {
    const r = chartTemplatesAfterSave([{ id: 'a', name: 'Swing', settings: {} }, { id: 'b', name: 'Day', settings: {} }], 'swing', { x: 1 }, { id: 'n', max: 2 })
    expect(r.templates.map(t => t.id)).toEqual(['n', 'b'])
    expect(r.replaced.id).toBe('a')
    expect(r.template.settings).toEqual({ x: 1, preset: 'custom' })
    expect(chartTemplatesAfterSave([], '   ', {})).toBeNull()
    expect(chartTemplatesAfterDelete([{ id: 'a' }, { id: 'b' }], 'a')).toEqual([{ id: 'b' }])
  })
  it('save from ONE chart (applied — a new name), exact Undo puts the old list back', async () => {
    const b = withPrefs([{ id: 'a', name: 'Day', settings: { x: 1 } }])
    const ops = [{ action: 'chartSetup.saveTemplate', target: 'chartTemplates', args: { name: 'Swing', chart: 'L' } }]
    const { p } = await plan(b.host, ops, ['chartTemplates'])
    expect(decideMode('apply', p)).toBe('apply')
    const { res } = await run(b.host, ops, ['chartTemplates'])
    expect(res.lines[0]).toMatch(/Saved Chart L's settings as the chart template “Swing”/)
    expect(listOf(b).map(t => t.name)).toEqual(['Swing', 'Day'])
    expect(listOf(b)[0].settings.background).toBe('#abcdef')
    expect(listOf(b)[0].settings.indicatorInstances.some(i => i.instanceId === 'x' && i.defId === 'rsi')).toBe(true)     // its indicators too — what the button saves
    expect((await undoEntry(b.host, res.undo)).ok).toBe(true)
    expect(listOf(b)).toEqual([{ id: 'a', name: 'Day', settings: { x: 1 } }])
  })
  it('a save that would REPLACE a template is shown first', async () => {
    const b = withPrefs([{ id: 'a', name: 'Swing', settings: { x: 1 } }])
    const { p } = await plan(b.host, [{ action: 'chartSetup.saveTemplate', target: 'chartTemplates', args: { name: 'swing', chart: 'L' } }], ['chartTemplates'])
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.lines[0]).toMatch(/Replaced your chart template “Swing”/)
  })
  it('delete: proposed, exact Undo; an unknown name lists the real ones', async () => {
    const b = withPrefs([{ id: 'a', name: 'Swing', settings: {} }, { id: 'b', name: 'Day', settings: {} }])
    const ops = [{ action: 'chartSetup.deleteTemplate', target: 'chartTemplates', args: { name: 'swing' } }]
    const { p } = await plan(b.host, ops, ['chartTemplates'])
    expect(decideMode('apply', p)).toBe('propose')
    const { res } = await run(b.host, ops, ['chartTemplates'])
    expect(listOf(b).map(t => t.name)).toEqual(['Day'])
    expect((await undoEntry(b.host, res.undo)).ok).toBe(true)
    expect(listOf(b).map(t => t.name)).toEqual(['Swing', 'Day'])
    const bad = await plan(b.host, [{ action: 'chartSetup.deleteTemplate', target: 'chartTemplates', args: { name: 'Weekly' } }], ['chartTemplates'])
    expect(bad.p.refusals[0].reason).toMatch(/you have: Swing, Day/)
  })
  it('a server that does not confirm the write → nothing reported as saved', async () => {
    const b = withPrefs([])
    b.host.prefs.write = async () => false
    const { p, env } = await plan(b.host, [{ action: 'chartSetup.saveTemplate', target: 'chartTemplates', args: { name: 'Swing', chart: 'L' } }], ['chartTemplates'])
    const res = await commitPlan(b.host, p, { env, ctx: CTX })
    expect(res.ok).toBe(false)
  })
})

// ── A1: Restore Defaults through keepIndicatorState ──────────────────────────────────────────────
describe('chart.resetDefaults — A1\'s keepIndicatorState (the modal\'s own Restore)', () => {
  it('keeps every indicator-owned key AND header.infoValues (finding C5), and equals the modal\'s result', async () => {
    const S = { background: '#123456', indicatorInstances: [{ instanceId: 'i1', defId: 'rsi' }], paneOrder: ['price', 'i1'], header: { titleMode: 'ticker', infoValues: [{ instanceId: 'i1', plotKey: 'rsi' }] } }
    const { host, state } = twoCharts(S)
    const ops = [{ action: 'chart.resetDefaults', target: 'L', args: {} }]
    const { p } = await plan(host, ops, ['chart'])
    expect(decideMode('apply', p)).toBe('propose')
    const { res } = await run(host, ops, ['chart'])
    const after = state.widgets.find(w => w.id === 'L').opts.settings
    // the cs the Agent planned from is the MERGED chart (mergeChartSettings) — exactly what the modal holds
    expect(after).toEqual(keepIndicatorState(JSON.parse(JSON.stringify(CHART_DEFAULTS)), mergeChartSettings(S)))
    expect(after.header.infoValues).toEqual(mergeChartSettings(S).header.infoValues)
    expect(after.header.infoValues).toHaveLength(1)
    expect(CHART_DEFAULTS.header?.infoValues).toBeUndefined()                 // so keeping it is the rule, not the default
    expect(after.indicatorInstances).toEqual(mergeChartSettings(S).indicatorInstances)
    expect(after.background).toBe(CHART_DEFAULTS.background)
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(state.widgets.find(w => w.id === 'L').opts.settings).toEqual(S)
  })
})

// ── drawings ─────────────────────────────────────────────────────────────────────────────────────
describe('drawings — visibility, lock, a level\'s price, bulk show/hide, clear', () => {
  let SYM, n = 0
  const dhost = () => ({ drawings: buildDrawingSource({ list: () => [{ label: `Chart (${SYM})`, symbol: SYM, drawSym: SYM, cs: {} }] }) })
  const dop = (action, args) => ({ action, target: SYM, args })
  const ids = () => store.peekDrawings(SYM).map(d => d.id)
  const get = (id) => store.peekDrawings(SYM).find(d => d.id === id)
  beforeEach(() => {
    SYM = `P1D${++n}X`
    store.addDrawing(SYM, { type: 'horizontal', points: [{ price: 150 }], color: '#ffffff' })
    store.addDrawing(SYM, { type: 'trendline', points: [{ time: '2026-01-02', price: 1 }, { time: '2026-02-02', price: 2 }], color: '#ffffff' })
  })

  it('hide / show one drawing and lock / unlock it — applied, exact Undo, nothing deleted', async () => {
    const h = dhost()
    const [a] = ids()
    const { res } = await run(h, [dop('drawing.setVisible', { drawing: a, visible: false }), dop('drawing.lock', { drawing: a, locked: true })], ['drawing'])
    expect(get(a).hidden).toBe(true)
    expect(get(a).locked).toBe(true)
    expect(res.lines.join(' · ')).toMatch(/Hid the .* · Locked the /)
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(!!get(a).hidden).toBe(false)
    expect(!!get(a).locked).toBe(false)
    expect(ids()).toHaveLength(2)
  })
  it('move a horizontal line to a price (its own points); a trendline and a locked line are refused', async () => {
    const h = dhost()
    const [a, t] = ids()
    const { res } = await run(h, [dop('drawing.setLevel', { drawing: a, price: 175.5 })], ['drawing'])
    expect(get(a).points).toEqual([{ price: 175.5 }])
    expect(res.lines[0]).toMatch(/from \$150 to \$175\.5/)
    expect(lastTouchedDrawing()).toEqual({ sym: SYM, id: a })
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(get(a).points).toEqual([{ price: 150 }])
    expect((await plan(h, [dop('drawing.setLevel', { drawing: t, price: 3 })], ['drawing'])).p.refusals[0].reason).toMatch(/isn't a horizontal level/)
    store.updateDrawing(SYM, a, { locked: true })
    expect((await plan(h, [dop('drawing.setLevel', { drawing: a, price: 3 })], ['drawing'])).p.refusals[0].reason).toMatch(/locked/)
  })
  it('moving a line an ALERT is attached to is shown first (the alert moves with it)', async () => {
    const h = dhost()
    const [a] = ids()
    alertRows = [{ id: 9, sym: SYM, target_price: 150, direction: 'above', is_active: true, drawing_id: a }]
    _resetAlertCache()
    const { p } = await plan(h, [dop('drawing.setLevel', { drawing: a, price: 160 })], ['drawing'])
    expect(p.ok).toBe(true)
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.lines[0]).toMatch(/its alert moves with it/)
  })
  it('show / hide EVERY drawing on the symbol — one change, exact Undo', async () => {
    const h = dhost()
    const { res } = await run(h, [dop('drawing.setAllVisible', { visible: false })], ['drawing'])
    expect(store.peekDrawings(SYM).every(d => d.hidden)).toBe(true)
    expect(res.lines[0]).toMatch(/Hid 2 drawings/)
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(store.peekDrawings(SYM).some(d => d.hidden)).toBe(false)
  })
  it('clear: a BROAD destructive operation — always proposed; locked and alert-bound drawings are kept and said; Undo puts the rest back', async () => {
    const h = dhost()
    const [a, t] = ids()
    store.addDrawing(SYM, { type: 'horizontal', points: [{ price: 99 }], color: '#ffffff', locked: true })
    alertRows = [{ id: 9, sym: SYM, target_price: 150, direction: 'above', is_active: true, drawing_id: a }]
    const ops = [dop('drawing.clear', {})]
    const { p } = await plan(h, ops, ['drawing'])
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.lines[0]).toMatch(/Removed 1 drawing .* kept 2 \(locked or with an alert attached\)/)
    const { res } = await run(h, ops, ['drawing'])
    expect(ids()).toContain(a)
    expect(ids()).not.toContain(t)
    expect(ids()).toHaveLength(2)
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(store.peekDrawings(SYM).map(d => d.type).sort()).toEqual(['horizontal', 'horizontal', 'trendline'])
  })
  it('clear refuses when the alert list cannot be read (never a guess about alerts)', async () => {
    const h = dhost()
    globalThis.fetch = vi.fn(async () => new Response('no', { status: 500 }))
    const { p } = await plan(h, [dop('drawing.clear', {})], ['drawing'])
    expect(p.refusals[0].reason).toMatch(/couldn't check which drawings have alerts/)
  })
  it('the drawing the Agent last drew or changed is marked `recent` for the model ("make it red")', async () => {
    const h = dhost()
    const [a] = ids()
    await run(h, [dop('drawing.style', { drawing: a, color: 'red', style: null, width: null })], ['drawing'])
    const ctx = buildContext(h, CTX).context.drawings[0].drawings
    expect(ctx.find(d => d.id === a).recent).toBe(true)
    expect(ctx.filter(d => d.recent)).toHaveLength(1)
  })
})

// ── watchlists ───────────────────────────────────────────────────────────────────────────────────
describe('watchlist.reorder / watchlist.setNote — the Watchlists page\'s own routes', () => {
  const lists = () => makeBoard([], {}, { watchlists: [{ id: 'wl1', name: 'Momentum', symbols: ['TSLA', 'AMD', 'NVDA'], notes: { NVDA: 'leader' } }] })
  const serverSyms = (b) => b.state.server.lists[0].items.map(i => i.sym)
  it('sort A–Z, then exact Undo restores the old order', async () => {
    const b = lists()
    const { res } = await run(b.host, [{ action: 'watchlist.reorder', target: 'wl1', args: { sort: 'az', top: [] } }], ['watchlist'])
    expect(serverSyms(b)).toEqual(['AMD', 'NVDA', 'TSLA'])
    expect(res.lines[0]).toBe('Reordered “Momentum”: sorted A–Z')
    expect((await undoEntry(b.host, res.undo)).ok).toBe(true)
    expect(serverSyms(b)).toEqual(['TSLA', 'AMD', 'NVDA'])
  })
  it('move tickers to the top, in the order given; a ticker not in the list is refused', async () => {
    const b = lists()
    await run(b.host, [{ action: 'watchlist.reorder', target: 'wl1', args: { sort: null, top: ['NVDA'] } }], ['watchlist'])
    expect(serverSyms(b)).toEqual(['NVDA', 'TSLA', 'AMD'])
    expect((await plan(b.host, [{ action: 'watchlist.reorder', target: 'wl1', args: { sort: null, top: ['IWM'] } }], ['watchlist'])).p.refusals[0].reason).toMatch(/IWM isn't in “Momentum”/)
  })
  it('"sort my momentum list alphabetically" and "move NVDA to the top of momentum" are instant', () => {
    const b = lists()
    expect(fastParse('sort my momentum list alphabetically', { host: b.host })).toMatchObject({ kind: 'ops', ops: [{ action: 'watchlist.reorder', target: 'wl1', args: { sort: 'az', top: [] } }] })
    expect(fastParse('move NVDA to the top of momentum', { host: b.host })).toMatchObject({ kind: 'ops', ops: [{ action: 'watchlist.reorder', target: 'wl1', args: { sort: null, top: ['NVDA'] } }] })
  })
  it('a reorder onto a list edited since is refused (nothing written)', async () => {
    const b = lists()
    const { p, env } = await plan(b.host, [{ action: 'watchlist.reorder', target: 'wl1', args: { sort: 'az', top: [] } }], ['watchlist'])
    b.state.manual('wl1', (wl) => { wl.items.push({ id: 'x9', sym: 'META', notes: '' }) })
    const res = await commitPlan(b.host, p, { env, ctx: CTX })
    expect(res.ok).toBe(false)
  })
  it('set and clear a note; Undo puts the old note back', async () => {
    const b = lists()
    const { res } = await run(b.host, [{ action: 'watchlist.setNote', target: 'wl1', args: { symbol: 'NVDA', note: 'add on a pullback to the 20' } }], ['watchlist'])
    const note = () => b.state.server.lists[0].items.find(i => i.sym === 'NVDA').notes
    expect(note()).toBe('add on a pullback to the 20')
    expect(res.lines[0]).toMatch(/Set the note on NVDA in “Momentum”/)
    expect((await undoEntry(b.host, res.undo)).ok).toBe(true)
    expect(note()).toBe('leader')
    const { res: r2 } = await run(b.host, [{ action: 'watchlist.setNote', target: 'wl1', args: { symbol: 'NVDA', note: '' } }], ['watchlist'])
    expect(r2.lines[0]).toBe('Cleared the note on NVDA in “Momentum”')
    expect((await plan(b.host, [{ action: 'watchlist.setNote', target: 'wl1', args: { symbol: 'META', note: 'x' } }], ['watchlist'])).p.refusals[0].reason).toMatch(/META isn't in/)
  })
})

// ── indicator.discardDraft ───────────────────────────────────────────────────────────────────────
describe('indicator.discardDraft — the Indicators specialist\'s own discardDraft', () => {
  const P = (src) => parseFormula(src).ast
  const converse = async ({ state }) => ({ ok: true, disposition: 'change', turn: 'patch', reply: '',
    envelope: { contract: 'uct.authoring.patch/1', baseRevision: state.revision, ops: [{ op: 'create', name: 'EMA 20', placement: 'price', outputs: [{ key: 'e', label: 'EMA 20', tree: P('ema(close, 20)') }] }], assumptions: [], disposition: 'change' } })
  const ACTX = { surface: 'charts', createIndicator: true }
  const h = () => ({
    charts: {
      list: () => [{ ref: 'L', label: 'Left chart (NVDA)', symbol: 'NVDA', tf: 'D', cs: mergeChartSettings(null), stored: null }],
      read: () => null, commit: () => true, canManageIndicators: () => true, canCreateIndicator: () => true,
    },
  })
  beforeEach(() => {
    _simulateReload(); try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* */ }
    _resetAuthoring(); _resetDraftPreview()
    setAuthoringSources({ access: () => true, rows: () => [], extra: { converse } })
  })
  it('proposed (irreversible, no Undo); after it the draft is gone and the active draft is cleared', async () => {
    const host = h()
    const build = [{ action: 'indicator.draft', target: 'draft:new', args: { message: 'plot the EMA 20 of close', chart: 'L', edit: null } }]
    buildContext(host, ACTX)
    expect((await commitPlan(host, planOps(collectTargets(host, ['indicatorDrafts']), build, {}, ACTX), { env: {}, ctx: ACTX })).ok).toBe(true)
    const ref = indicatorDraftsKind.list(host).find(s => s.active).ref
    const ops = [{ action: 'indicator.discardDraft', target: ref, args: {} }]
    const p = planOps(collectTargets(host, ['indicatorDrafts']), ops, {}, ACTX)
    expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
    expect(decideMode('apply', p)).toBe('propose')
    expect(getCapability('indicator.discardDraft').undo).toBe('none')
    const res = await commitPlan(host, p, { env: {}, ctx: ACTX })
    expect(res.ok, JSON.stringify(res.failed)).toBe(true)
    expect(res.lines[0]).toMatch(/Discarded .* it is gone/)
    expect(res.undo).toBeNull()
    expect(indicatorDraftsKind.list(host).filter(s => !s.new)).toHaveLength(0)
    expect(listDrafts({ canAuthor: true, definitionRows: [] })).toHaveLength(0)
  })
  it('there is nothing to discard on the new-draft entry', () => {
    const host = h()
    buildContext(host, ACTX)
    const p = planOps(collectTargets(host, ['indicatorDrafts']), [{ action: 'indicator.discardDraft', target: 'draft:new', args: {} }], {}, ACTX)
    expect(p.refusals[0].reason).toMatch(/no draft to discard/)
  })
})

// ── ordinal targeting ────────────────────────────────────────────────────────────────────────────
describe('"the second chart", "chart 3", "the middle one" — the board\'s reading order', () => {
  const row3 = () => makeBoard([
    { id: 'A', type: 'chart', x: 0, y: 0, w: 8, h: 20, color: 'N' }, { id: 'B', type: 'chart', x: 8, y: 0, w: 8, h: 20, color: 'N' },
    { id: 'C', type: 'chart', x: 16, y: 0, w: 8, h: 20, color: 'N' },
  ], { 'N:A': 'SPY', 'N:B': 'QQQ', 'N:C': 'IWM' })
  it('ordinalChart: first / second / last / chart N / middle (one row of three)', () => {
    const charts = row3().host.charts.list()
    expect(ordinalChart('switch the second chart to weekly', charts).ref).toBe('B')
    expect(ordinalChart('the last chart', charts).ref).toBe('C')
    expect(ordinalChart('chart 1', charts).ref).toBe('A')
    expect(ordinalChart('the middle chart', charts).ref).toBe('B')
    expect(ordinalChart('the fifth chart', charts).ask.text).toMatch(/only 3 charts/)
    expect(ordinalChart('make it weekly', charts)).toBeNull()
    // a unit after the number is a timeframe, never an ordinal
    for (const t of ['set the chart 5 min', 'make the chart 1 hour', 'chart 3 days', 'chart 2-minute']) expect(ordinalChart(t, charts), t).toBeNull()
    expect(ordinalChart('make chart 2 weekly', charts).ref).toBe('B')
  })
  it('"middle" on a 2×2 board is asked, never guessed', () => {
    const { host } = makeBoard([
      { id: 'A', type: 'chart', x: 0, y: 0, w: 12, h: 10 }, { id: 'B', type: 'chart', x: 12, y: 0, w: 12, h: 10 },
      { id: 'C', type: 'chart', x: 0, y: 10, w: 12, h: 10 }, { id: 'D', type: 'chart', x: 12, y: 10, w: 12, h: 10 },
    ])
    expect(ordinalChart('the middle chart', host.charts.list()).ask).toBeTruthy()
  })
  it('the fast path lifts the ordinal off the clause and names that chart', () => {
    const { host } = row3()
    const r = extractTarget('switch the third chart to weekly', host)
    expect(r.target).toEqual({ chart: 'C', word: 'third' })
    expect(fastParse('switch the third chart to weekly', { host })).toMatchObject({ kind: 'ops', ops: [{ action: 'chart.setTimeframe', args: { timeframe: 'W' } }], target: { chart: 'C' } })
  })
  it('NL-1 / model plans: an ordinal counts as naming the chart (screenUnnamedTargets)', () => {
    const charts = row3().host.charts.list()
    expect([...chartsNamedBy('make the second chart weekly', charts)]).toEqual(['B'])
    // "the first one" is as often a result or a list item: it never identifies a chart for a model plan
    expect([...chartsNamedBy('add the first one to my watchlist', charts)]).toEqual([])
  })
})

// ── multi-chart sentences ────────────────────────────────────────────────────────────────────────
describe('multiChartPlan — several charts in one sentence', () => {
  const board = (n, syms = ['SPY', 'QQQ', 'IWM', 'DIA']) => makeBoard(
    Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, type: 'chart', x: n === 2 ? i * 12 : (i % 2) * 12, y: n === 2 ? 0 : Math.floor(i / 2) * 10, w: 12, h: n === 2 ? 20 : 10, color: 'N' })),
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`N:c${i + 1}`, syms[i]])),
  ).host
  it('tickersIn: capitals or $, never a lowercase word or an indicator name', () => {
    expect(tickersIn('put NVDA on the left and $amd on the right')).toEqual(['NVDA', 'AMD'])
    expect(tickersIn('add RSI and the EMA to it')).toEqual([])
  })
  it('positional symbols: one change on exactly the charts named (applied), with a shared timeframe', () => {
    const host = board(2)
    expect(multiChartPlan('NVDA on the left and AMD on the right', { host })).toEqual({ kind: 'ops', mode: 'apply',
      ops: [{ action: 'chart.setSymbol', target: 'c1', args: { symbol: 'NVDA' } }, { action: 'chart.setSymbol', target: 'c2', args: { symbol: 'AMD' } }] })
    const w = multiChartPlan('put TSLA on the right, AAPL on the left, both weekly', { host })
    expect(w.ops.map(o => [o.action, o.target, o.args])).toEqual([
      ['chart.setSymbol', 'c2', { symbol: 'TSLA' }], ['chart.setSymbol', 'c1', { symbol: 'AAPL' }],
      ['chart.setTimeframe', 'c2', { timeframe: 'W' }], ['chart.setTimeframe', 'c1', { timeframe: 'W' }]])
    expect(multiChartPlan('TSLA on the first chart and AAPL on the second', { host: board(4) }).ops.map(o => o.target)).toEqual(['c1', 'c2'])
  })
  it('positional: anything that is not plainly "symbol on chart" is not read here', () => {
    const host = board(2)
    expect(multiChartPlan('add RSI to NVDA on the left and AMD on the right', { host })).toBeNull()
    expect(multiChartPlan('NVDA on the left', { host })).toBeNull()
    expect(multiChartPlan('NVDA on the left and AMD on the left', { host }).kind).toBe('say')
    expect(multiChartPlan('NVDA on the top and AMD on the bottom', { host }).kind).toBe('say')     // no top/bottom on a 1×2 board
  })
  it('two charts LINKED in one colour group can never show two symbols: said, never attempted', () => {
    const { host } = makeBoard([
      { id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A' }, { id: 'c2', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'A' },
    ], { A: 'SPY' })
    for (const t of ['NVDA on the left and AMD on the right', 'show NVDA and AMD side by side']) {
      const r = multiChartPlan(t, { host })
      expect(r.kind, t).toBe('say')
      expect(r.text).toMatch(/linked to the same colour group/)
    }
  })
  it('side by side — 2 charts: both reused (a chart already on one of them keeps it), applied', () => {
    const host = board(2, ['AMD', 'SPY'])
    expect(multiChartPlan('show NVDA and AMD side by side', { host })).toEqual({ kind: 'ops', mode: 'apply',
      ops: [{ action: 'chart.setSymbol', target: 'c2', args: { symbol: 'NVDA' } }, { action: 'chart.setSymbol', target: 'c1', args: { symbol: 'AMD' } }] })
  })
  // ⭐ live test 2026-10-28: APPLIED — one grid change (reuse + add + re-tile, one Undo), or new charts into empty space
  it('side by side — 1 chart: ONE grid change, applied (it is reused, keeping a ticker it shows); 0 charts or "new charts": added, applied', () => {
    const one = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N' }], { 'N:c1': 'SPY' }).host
    expect(multiChartPlan('NVDA and AMD side by side', { host: one })).toEqual({ kind: 'ops', mode: 'apply', ops: [{ action: 'chartGrid.set', target: 'board', args: { symbols: ['NVDA', 'AMD'], timeframe: null, layout: 'columns', new_charts: null } }] })
    const has = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'N' }], { 'N:c1': 'AMD' }).host
    expect(multiChartPlan('NVDA and AMD side by side', { host: has })).toMatchObject({ kind: 'ops', mode: 'apply', ops: [{ action: 'chartGrid.set', args: { symbols: ['AMD', 'NVDA'] } }] })
    expect(multiChartPlan('show NVDA and AMD side by side in new charts', { host: board(2) })).toMatchObject({ mode: 'apply', ops: [{ action: 'chartGrid.set', args: { symbols: ['NVDA', 'AMD'], new_charts: true } }] })
    expect(multiChartPlan('NVDA and AMD side by side', { host: makeBoard([]).host })).toMatchObject({ mode: 'apply', ops: [{ action: 'widget.addCharts', args: { symbols: ['NVDA', 'AMD'] } }] })
  })
  it('side by side — 3+ charts: PROPOSED with the charts named (never a silent pick); both already shown → said', () => {
    const host = board(4)
    const p = multiChartPlan('NVDA and AMD side by side', { host })
    expect(p.mode).toBe('propose')
    expect(p.note).toMatch(/I picked Chart c1 for NVDA and Chart c2 for AMD/)
    expect(multiChartPlan('SPY and QQQ side by side', { host }).kind).toBe('say')
  })
  it('copy a look: "make the left chart look like the right one" → chartSetup.copyLook (proposed)', () => {
    const host = board(2)
    expect(multiChartPlan('make the left chart look like the right one', { host })).toEqual({ kind: 'ops', mode: 'propose', ops: [{ action: 'chartSetup.copyLook', target: 'c1', args: { from: 'c2' } }] })
    expect(multiChartPlan('copy the look of the QQQ chart to the SPY chart', { host }).ops[0]).toEqual({ action: 'chartSetup.copyLook', target: 'c1', args: { from: 'c2' } })
    expect(multiChartPlan('make the left chart look like the other one', { host }).ops[0]).toEqual({ action: 'chartSetup.copyLook', target: 'c1', args: { from: 'c2' } })
    expect(multiChartPlan('make the left chart look like the left one', { host }).kind).toBe('say')
    expect(multiChartPlan('make the chart look like a candle chart', { host })).toBeNull()
  })
})

// ── "swap the 9 for a 10" ────────────────────────────────────────────────────────────────────────
describe('indicator.update — "swap the 9 for a 10" is the in-place length change', () => {
  it('parses to indicator.update (never remove + add), with the type when said; "on every chart" fans out', () => {
    expect(fastParse('swap the 9 for a 10')).toMatchObject({ kind: 'ops', ops: [{ action: 'indicator.update', args: { instance: '#9', inputs: [{ key: 'period', value: 10 }] } }] })
    expect(fastParse('replace the 20 ema with a 21')).toMatchObject({ kind: 'ops', ops: [{ action: 'indicator.update', args: { instance: '#20:ema', inputs: [{ key: 'period', value: 21 }] } }] })
    expect(fastParse('swap the 9 for a 10 on every chart')).toMatchObject({ kind: 'ops', target: { all: true } })
    expect(fastParse('swap AMD for NVDA')).toBeNull()
  })
})

// ── widget.addTab ────────────────────────────────────────────────────────────────────────────────
describe('widget.addTab — the widget header\'s "+" (addWidgetTab)', () => {
  const board = () => makeBoard([
    { id: 'news-1', type: 'news', x: 0, y: 0, w: 12, h: 20, color: 'B', opts: {} },
    { id: 'c1', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'A', opts: {} },
  ])
  it('adds the tab coloured like the slot, shows it, with a deterministic id; exact Undo', async () => {
    const b = board()
    const ops = [{ action: 'widget.addTab', target: 'board', args: { widget: 'news-1', type: 'fundamentals' } }]
    const { p } = await plan(b.host, ops, ['board'])
    expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
    const again = await plan(b.host, ops, ['board'])
    expect(JSON.stringify(again.p.plans[0].patch)).toBe(JSON.stringify(p.plans[0].patch))          // a re-plan writes the same board
    const { res } = await run(b.host, ops, ['board'])
    const w = b.state.widgets.find(x => x.id === 'news-1')
    expect(w.wtabs).toEqual([{ id: 'wta1', type: 'fundamentals', color: 'B', opts: {} }])
    expect(w.activeWtab).toBe(1)
    expect(res.lines[0]).toMatch(/Added a .* tab to the/)
    expect((await undoEntry(b.host, res.undo)).ok).toBe(true)
    expect(b.state.widgets.find(x => x.id === 'news-1').wtabs ?? null).toBeNull()             // no extra tabs (the board's undo writes the key back empty)
  })
  it('a chart widget is refused (its tabs are chart tabs)', async () => {
    const b = board()
    const { p } = await plan(b.host, [{ action: 'widget.addTab', target: 'board', args: { widget: 'c1', type: 'news' } }], ['board'])
    expect(p.refusals[0].reason).toMatch(/chart tabs/)
  })
})

// ── hardening ────────────────────────────────────────────────────────────────────────────────────
describe('hardening — clarify choices and the 12-op limit', () => {
  it('clarifyChoices keeps strings and {label} objects; drops null, numbers, arrays, empty labels; translates NL-1 refs', () => {
    expect(clarifyChoices([null, 'Left', 3, ['x'], { label: '' }, { label: 'Right', ref: 'c2' }, { ref: 'c1' }], { c2: { kind: 'chart', ref: 'R' } }))
      .toEqual([{ label: 'Left', ref: null }, { label: 'Right', ref: 'R' }])
    expect(clarifyChoices({ label: 'x' })).toEqual([])
    expect(clarifyChoices(Array.from({ length: 30 }, (_, i) => `c${i}`))).toHaveLength(12)
  })
  it('the model-plan limit is the shared contract\'s maxOps (12), the same number the server enforces', () => {
    expect(MAX_MODEL_OPS).toBe(12)
    expect(MAX_MODEL_OPS).toBe(MANIFEST_CONTRACT.limits.maxOps)
  })
})
