// CHARTS OUTCOME — execution family MULTI CHART (pl-auto): the C3-042..062 rows of docs/agent/CHARTS_EXECUTION_STATUS.md,
// through the REAL panel (AgentPanel + useAgent + planner policy, runtime, receipts, Undo) in gridMode, the REAL grid
// (MultiChartGrid + GridChartCell + useMultiChartState over the multichart_state pref) and the REAL workspace host
// (buildWorkspaceHost → scopeHostToGrid). The mount is agentMultiChartMode.test.jsx's. Stand-ins: the canvas (StockChart
// records the props a cell draws with), the server (fetch: prefs, ticker search, a stateful /api/watchlist-alerts book) and
// the MODEL (scripted). The script reads the REQUEST it was sent: the cell comes from body.context.charts by position, and a
// capability the request did not offer is asked for through routing exactly as a planner must; a request that does not carry
// what the plan needs FAILS the case.
//
// Each PASS case: the row id, a natural request, a scripted plan on an EXISTING capability, the outcome read back from the
// grid's own state (H.mc.state.cells / the persisted pref / what the cell hands its canvas / the alert book), never from the
// plan; the other cells untouched; Undo restores. Rows with no capability path are it.todo naming the missing piece
// (docs/agent/program/EXEC-MULTICHART.md).
// ⛔ THE MODEL IS SCRIPTED. Evidence: vitest, jsdom, panel — not a real browser, not the real model.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useMemo } from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

const H = vi.hoisted(() => ({ prefs: {}, setPref: null, api: null, mc: null, nav: null, chartProps: {}, session: 'closed', alerts: [], alertCalls: [], layouts: null, layoutCalls: [], groupTop: null, topCalls: [] }))

vi.mock('../../../hooks/usePreferences', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, default: () => ({ prefs: H.prefs, setPref: H.setPref, loading: false }) }
})
vi.mock('../../../utils/extSession', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, getExtSessionCached: () => ({ session: H.session }) }
})
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, useSearchParams: () => [new URLSearchParams()] }
})
vi.mock('../../../pages/charts/WorkspaceContext', () => ({ useWorkspace: () => ({ chartsTheme: null, chartApiById: H.api }) }))
vi.mock('../../../components/StockChart', () => ({
  default: (props) => {
    H.chartProps[props.chartId] = props
    props.onDateNavApi?.(H.nav)
    return <div data-testid={`canvas-${props.chartId}`}>{props.sym}</div>
  },
}))
vi.mock('../../../components/chart/SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return { default: forwardRef((_p, ref) => { useImperativeHandle(ref, () => ({ openWith: () => {} })); return <span /> }) }
})
vi.mock('../../../pages/charts/widgets/ChartDayGain', () => ({ default: () => null }))
vi.mock('../../../pages/charts/widgets/ChartMarketClock', () => ({ default: () => null }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))
vi.mock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../utils/prefetchBars', () => ({ prefetchGridWarm: () => {} }))
vi.mock('../../../components/chart/ChartSettingsModal', () => ({ default: () => null }))
vi.mock('../../../pages/charts/grid/useStaggeredMount', () => ({ default: (ids) => ({ mountedIds: new Set(ids), release: () => {} }) }))
vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

import { registerBuiltins } from '../../builtins'
import { AuthContext } from '../../../context/AuthContext'
import AgentPanel from '../../AgentPanel'
import useMultiChartState from '../../../pages/charts/grid/useMultiChartState'
import useGridAgentControl from '../../../pages/charts/grid/useGridAgentControl'
import MultiChartGrid from '../../../pages/charts/grid/MultiChartGrid'
import { buildWorkspaceHost } from '../../host'
import { groupOfAction } from '../../routing'
import { _resetAlertCache } from '../../capabilities/alert'

registerBuiltins()

// ── the grid: 2×2, NVDA / AMD / TSLA / empty, reading order ──
const cell = (id, sym, extra = {}) => ({ id, sym, tf: 'D', ...extra })
const GRID = (over = {}) => ({ mode: 'grid', layout: '2x2', cells: [cell('c0', 'NVDA'), cell('c1', 'AMD'), cell('c2', 'TSLA'), cell('c3', null)], ...over })

let envelopes, scriptErrors, boardAdds, turns
const env = (disposition, ops, reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
let alertN = 0
function alertsRoute(u, init) {
  const method = (init.method || 'GET').toUpperCase()
  H.alertCalls.push([method, u])
  if (method === 'GET') return json(H.alerts)
  if (method === 'POST') {
    const b = JSON.parse(init.body)
    const row = { id: `al${++alertN}`, sym: b.sym, target_price: b.target_price, direction: b.direction, alert_type: b.alert_type || 'price', is_active: true, triggered_at: null }
    H.alerts = [...H.alerts, row]
    return json(row)
  }
  if (method === 'DELETE') {
    const id = decodeURIComponent(u.split('/').pop())
    H.alerts = H.alerts.filter(a => a.id !== id)
    return json({ ok: true })
  }
  return json({ detail: 'no' }, 405)
}
// ── the saved-layouts service (/api/charts/layouts): a stateful book of rows, multichart and workspace kinds side by side ──
let layoutN = 100
function layoutsRoute(u, init) {
  const method = (init.method || 'GET').toUpperCase()
  H.layoutCalls.push([method, u, init.body ? JSON.parse(init.body) : null])
  if (method === 'GET') return json(H.layouts)
  if (method === 'POST') {
    const b = JSON.parse(init.body)
    const key = b.scope === 'global' ? 'global' : 'mine'
    if (b.create_only && H.layouts[key].some(t => t.name === b.name)) return json({ detail: 'A layout with that name already exists' }, 409)
    const row = { id: ++layoutN, name: b.name, layout: b.layout, groups: b.groups, scope: b.scope }
    H.layouts = { ...H.layouts, [key]: [...H.layouts[key], row] }
    return json(row)
  }
  if (method === 'DELETE') {
    const id = Number(u.split('/').pop())
    H.layouts = { global: H.layouts.global.filter(t => t.id !== id), mine: H.layouts.mine.filter(t => t.id !== id) }
    return json({ ok: true })
  }
  return json({ detail: 'no' }, 405)
}
// ── the groups service (/api/groups): a fixture theme list and each theme's ranking (H.groupTop may re-rank between calls) ──
const GROUPS = [
  { id: 'semis', name: 'Semiconductors', chartable: 16 },
  { id: 'semi_equipment', name: 'Semiconductor Equipment', chartable: 6 },
  { id: 'space', name: 'Space', chartable: 4 },
  { id: 'memory', name: 'Memory & HBM', chartable: 4 },
  { id: 'dead', name: 'Dead Theme', chartable: 0 },
]
const TOP = () => ({
  semis: { syms: ['NVDA', 'AMD', 'AVGO', 'MU', 'TSM', 'INTC', 'QCOM', 'MRVL', 'ARM'], etf: 'SMH' },
  semi_equipment: { syms: ['AMAT', 'LRCX', 'KLAC', 'ASML', 'TER', 'ONTO'], etf: null },
  space: { syms: ['RKLB', 'ASTS', 'LUNR', 'BKSY'], etf: 'UFO' },
  memory: { syms: ['MU', 'WDC', 'STX', 'SNDK'], etf: null },
  dead: { syms: [], etf: null },
})
function groupsRoute(u) {
  if (u === '/api/groups') return json({ groups: GROUPS })
  const m = /^\/api\/groups\/([^/]+)\/top\?n=(\d+)/.exec(u)
  if (m) {
    const id = decodeURIComponent(m[1])
    H.topCalls.push(id)
    const t = (H.groupTop || TOP())[id]
    if (!t) return json({ detail: 'no' }, 404)
    return json({ syms: t.syms.slice(0, Number(m[2])), etf: t.etf, rows: t.syms.map(sym => ({ sym })), total: t.syms.length, by: 'today', ranked_as_of: 'regular' })
  }
  return json({ seed: null, group_id: null, peers: [], source: 'none' })
}
beforeEach(() => {
  envelopes = []; scriptErrors = []; boardAdds = []; turns = 0
  H.layouts = { global: [], mine: [] }; H.layoutCalls = []; H.groupTop = null; H.topCalls = []
  H.prefs = { multichart_state: JSON.stringify(GRID()) }
  H.setPref = vi.fn(async (k, v) => { H.prefs = { ...H.prefs, [k]: v }; return true })
  H.api = { current: new Map() }
  H.nav = { getDateMeta: () => ({ firstMs: Date.UTC(2020, 0, 1), lastMs: Date.UTC(2026, 0, 1), rightMs: Date.UTC(2026, 0, 1) }), goToDate: vi.fn() }
  H.chartProps = {}
  H.session = 'closed'
  H.alerts = []; H.alertCalls = []
  _resetAlertCache()
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const body = init.body ? JSON.parse(init.body) : null
    if (u === '/api/agent/turn') {
      turns++
      const e = envelopes.shift()
      return json({ conversationId: 'ac_1', envelope: typeof e === 'function' ? e(body) : (e || env('answer', [], '«no script»')), usage: { research_calls: 0, citations: 0 } })
    }
    if (u === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (u.startsWith('/api/watchlist-alerts')) return alertsRoute(u, init)
    if (u.startsWith('/api/charts/layouts')) return layoutsRoute(u, init)
    if (u.startsWith('/api/groups')) return groupsRoute(u)
    const q = /ticker-search\?q=([^&]+)/.exec(u)
    if (q) return json({ results: [{ ticker: decodeURIComponent(q[1]).toUpperCase() }] })
    if (u.includes('keys=multichart_state')) return json({ multichart_state: H.prefs.multichart_state })
    if (u.startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const BOARD = [{ id: 'hidden1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'A', opts: {} }]
const withTracingsSync = (host) => ({ ...host, drawings: { ...host.drawings, confirm: async () => ({ ok: true }) } })
// ⭐ pl-grid: the Stage is ChartsWorkspace's own wiring — the grid only while Multi Chart is on (its `mode`), the panel in grid
// mode exactly then, and the host carrying the grid's writers (useGridAgentControl, as ChartsWorkspace builds it)
function Stage() {
  const mc = useMultiChartState()
  H.mc = mc
  const gridControl = useGridAgentControl(mc)
  const gridMode = mc.state.mode === 'grid'
  const host = useMemo(() => withTracingsSync(buildWorkspaceHost({
    gridControl,
    chartApiById: H.api,
    getWidgets: () => BOARD,
    selectedChart: () => 'hidden1',
    widgetLabel: (t) => t,
    widgetOps: {
      layout: () => ({ widgets: BOARD }),
      add: (t) => { boardAdds.push(t) },
      remove: () => { boardAdds.push('remove') },
      applyBoard: () => { boardAdds.push('applyBoard') },
      persist: async () => ({ ok: true }),
      groupSyms: () => ({ A: 'SPY' }),
    },
  })), [])   // eslint-disable-line react-hooks/exhaustive-deps
  return (<>{gridMode && <MultiChartGrid mc={mc} />}<AgentPanel host={host} gridMode={gridMode} surface="charts" onClose={() => {}} /></>)
}
const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })
function mount() {
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><AuthContext.Provider value={{ user: { id: 1, role: 'member' } }}><Stage /></AuthContext.Provider></SWRConfig>)
  const box = screen.getByLabelText('Message UCT Agent')
  const send = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle() }
  /** The member says `text`; `plan(context)` → the ops a correct planner sends from THIS request. */
  const say = async (text, plan = null, disposition = 'apply') => {
    turns = 0
    if (plan) envelopes.push(scripted(plan, disposition))
    await send(text)
    expect(scriptErrors, `the request for "${text}" carried what the plan needed`).toEqual([])
    // the scripted plan is what ran: the model was asked and its plan consumed (a pre-model fast path would leave it queued)
    if (plan) expect(envelopes, `"${text}" reached the (scripted) model`).toEqual([])
  }
  const apply = async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Apply' }).at(-1)); await idle() }
  /** A request the Agent answers WITHOUT the model (its deterministic pre-model path): the model is never asked. */
  const sayFast = async (text) => { turns = 0; await send(text); expect(turns, `"${text}" never reached the model`).toBe(0) }
  return { say, sayFast, apply, undo: () => send('undo') }
}
function scripted(plan, disposition) {
  return (body) => {
    let ops
    try { ops = plan(body.context, body) } catch (e) { scriptErrors.push(String(e?.message || e)); return env('answer', [], '«the request did not carry the target»') }
    const have = new Set((body.capabilities || []).map(c => c.name))
    const missing = ops.map(o => o.action).filter(a => !have.has(a))
    if (!missing.length) return env(disposition, ops)
    if (!body.reroute && body.routing) {
      envelopes.unshift(scripted(plan, disposition))
      return { ...env('answer', [], ''), need_groups: [...new Set(missing.map(groupOfAction).filter(Boolean))] }
    }
    scriptErrors.push(`the model was not given ${missing.join(', ')}`)
    return env('answer', [], '«not given»')
  }
}
const must = (v, what) => { if (v == null || v === false) throw new Error(`the context has no ${what}`); return v }
const cellAt = (ctx, position) => must((ctx.charts || []).find(c => c.position === position), `cell at ${position}`)
const onCell = (position, action, args) => (ctx) => [{ action, target: cellAt(ctx, position).ref, args }]

const cells = () => H.mc.state.cells
const at = (id) => cells().find(c => c.id === id)
const savedCells = () => JSON.parse(H.prefs.multichart_state).cells
/** Every cell but `id`, as stored: what "the other cells are untouched" compares. */
const othersOf = (id) => JSON.stringify(cells().filter(c => c.id !== id))
const receipts = () => screen.queryAllByTestId('agent-receipt')
/** The chart type a cell draws: its own Style pick wins, else its own settings fork (what GridChartCell hands the canvas). */
const drawnType = (id) => H.chartProps[id]?.settingsOverride?.chartType ?? null

describe('Multi Chart execution family — rows an existing capability executes (PASS)', () => {
  it('C3-056 "could you flip the top-right one over to a weekly view": the scripted plan chart.setTimeframe on that cell; the cell and the saved grid read W; Undo puts D back; no other cell moves', async () => {
    const { say, undo } = mount()
    const before = othersOf('c1')
    await say('could you flip the top-right one over to a weekly view', onCell('top-right', 'chart.setTimeframe', { timeframe: 'W' }))
    await waitFor(() => expect(at('c1').tf).toBe('W'))
    await waitFor(() => expect(savedCells()[1].tf).toBe('W'))
    expect(H.chartProps.c1.tf).toBe('W')
    expect(othersOf('c1')).toBe(before)
    expect(receipts()).toHaveLength(1)
    await undo()
    await waitFor(() => expect(at('c1').tf).toBe('D'))
    await waitFor(() => expect(savedCells()[1].tf).toBe('D'))
    expect(othersOf('c1')).toBe(before)
  }, 30000)

  it('C3-056 (pre-model path) "make the top-right chart weekly": answered without the model; same read-back, same Undo, other cells untouched', async () => {
    const { sayFast, undo } = mount()
    const before = othersOf('c1')
    await sayFast('make the top-right chart weekly')
    await waitFor(() => expect(at('c1').tf).toBe('W'))
    await waitFor(() => expect(savedCells()[1].tf).toBe('W'))
    expect(othersOf('c1')).toBe(before)
    await undo()
    await waitFor(() => expect(at('c1').tf).toBe('D'))
    expect(othersOf('c1')).toBe(before)
  }, 30000)

  it('C3-057 "turn the bottom-left chart into plain bars": chart.setType on that cell; the cell draws bars; Undo restores its Style; no other cell moves', async () => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ cells: [cell('c0', 'NVDA'), cell('c1', 'AMD'), cell('c2', 'TSLA', { chartType: 'hollow' }), cell('c3', null)] })) }
    const { say, undo } = mount()
    const before = othersOf('c2')
    await say('turn the bottom-left chart into plain bars for me please', onCell('bottom-left', 'chart.setType', { type: 'bars' }))
    await waitFor(() => expect(at('c2').chartType).toBe('bars'))
    await waitFor(() => expect(drawnType('c2')).toBe('bars'))
    await waitFor(() => expect(savedCells()[2].chartType).toBe('bars'))
    expect(othersOf('c2')).toBe(before)
    await undo()
    await waitFor(() => expect(at('c2').chartType).toBe('hollow'))
    expect(at('c2').settings ?? null).toBe(null)
    expect(othersOf('c2')).toBe(before)
  }, 30000)

  it('C3-058 (D/W/M) "include extended hours on the top-left chart": chart.setSession; the cell\'s own session view goes extended; Undo puts regular back; the other cells stay regular', async () => {
    H.session = 'post'
    const { say, undo } = mount()
    const before = othersOf('c0')
    await say('include extended hours on the top-left chart for me please', onCell('top-left', 'chart.setSession', { mode: 'extended' }))
    await waitFor(() => expect(H.chartProps.c0.sessionView).toBe('extended'))
    for (const id of ['c1', 'c2']) expect(H.chartProps[id].sessionView).toBe('regular')
    expect(othersOf('c0')).toBe(before)
    await undo()
    await waitFor(() => expect(H.chartProps.c0.sessionView).toBe('regular'))
    expect(othersOf('c0')).toBe(before)
  }, 30000)

  it('C3-058 (intraday) "regular hours only on the top-left chart": chart.setSession writes the cell\'s own extendedHoursShading, saved; Undo drops it; no other cell forks', async () => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ cells: [cell('c0', 'NVDA', { tf: '5' }), cell('c1', 'AMD'), cell('c2', 'TSLA'), cell('c3', null)] })) }
    const { say, undo } = mount()
    const before = othersOf('c0')
    await say('only regular hours on the top-left chart for me please', onCell('top-left', 'chart.setSession', { mode: 'regular' }))
    await waitFor(() => expect(at('c0').settings?.extendedHoursShading).toBe(false))
    await waitFor(() => expect(savedCells()[0].settings?.extendedHoursShading).toBe(false))
    expect(othersOf('c0')).toBe(before)
    expect(H.setPref.mock.calls.some(([k]) => k === 'chart_settings')).toBe(false)
    await undo()
    await waitFor(() => expect(at('c0').settings ?? null).toBe(null))
    expect(othersOf('c0')).toBe(before)
  }, 30000)

  // ── C3-062: the alert lands on the NAMED cell's symbol, at the level and direction asked, and nothing else ──
  // The product's own door, the cell's right-click "Set alert @ price" (GridChartCell.jsx:353-360), is NOT exercised here:
  // these cases prove the Agent's route to the same outcome (one price alert on that cell's symbol).
  const SEED_BOOK = () => [{ id: 's1', sym: 'SPY', target_price: 100, direction: 'below', alert_type: 'price', is_active: true, triggered_at: null }]
  const libRef = (ctx) => must(ctx.alertLibrary?.[0]?.ref, 'alert library')
  const ALERT_TEXT = 'alert me when the top-right chart goes above 250'
  /** the planner's job: the symbol comes from the cell the WORDS name, found in the request's context by position */
  const namedCellPlan = (ctx) => [{ action: 'alert.create', target: libRef(ctx), args: { symbol: cellAt(ctx, 'top-right').symbol, price: 250, direction: 'above' } }]
  /** the failure the control exists to catch: the symbol taken from the clicked (selected) cell instead */
  const activeCellPlan = (ctx) => [{ action: 'alert.create', target: libRef(ctx), args: { symbol: must((ctx.charts || []).find(c => c.selected), 'selected cell').symbol, price: 250, direction: 'above' } }]
  const rowOf = (a) => `${a.sym} ${a.direction} ${a.target_price}`
  /** what Apply added to the book, as the server holds it (not the plan) */
  const added = (book0) => H.alerts.filter(a => !book0.some(b => b.id === a.id)).map(rowOf)
  /** (a)+(b)+(c): exactly one alert added, on the named cell's symbol read from the GRID STATE, at 250, above; none on any other cell's symbol */
  const outcomeIsNamedCell = (book0, namedId) => {
    const named = at(namedId).sym
    const rows = added(book0)
    const otherSyms = cells().filter(c => c.id !== namedId && c.sym).map(c => c.sym)
    return rows.length === 1 && rows[0] === `${named} above 250` && !H.alerts.some(a => !book0.some(b => b.id === a.id) && otherSyms.includes(a.sym))
  }
  async function runAlert({ clickFirst = null, plan }) {
    H.alerts = SEED_BOOK()
    const m = mount()
    if (clickFirst) click(clickFirst)
    const book0 = JSON.parse(JSON.stringify(H.alerts))
    const bytes0 = JSON.stringify(H.alerts)
    const grid = JSON.stringify(cells())
    let ctxSeen = null
    await m.say(ALERT_TEXT, (ctx) => { ctxSeen = ctx; return plan(ctx) }, 'propose')
    expect(JSON.stringify(H.alerts)).toBe(bytes0)                    // nothing is written before Apply
    await m.apply()
    await waitFor(() => expect(added(book0)).toHaveLength(1))
    expect(H.alertCalls.filter(([meth]) => meth === 'POST')).toHaveLength(1)
    expect(JSON.stringify(cells())).toBe(grid)
    return { ...m, book0, bytes0, grid, ctxSeen }
  }
  const click = (id) => fireEvent.pointerDown(document.querySelector(`[data-grid-cell-id="${id}"]`).parentElement)

  it('C3-062 "alert me when the top-right chart goes above 250": alert.create on the NAMED cell\'s symbol (AMD, read from the grid), at 250, above; exactly one alert added; Undo leaves the book byte-identical; the grid is untouched', async () => {
    const r = await runAlert({ plan: namedCellPlan })
    expect(at('c1').sym).toBe('AMD')
    expect(added(r.book0)).toEqual(['AMD above 250'])
    const made = H.alerts.find(a => !r.book0.some(b => b.id === a.id))
    expect(made.target_price).toBe(250)
    expect(made.direction).toBe('above')
    expect(outcomeIsNamedCell(r.book0, 'c1')).toBe(true)
    await r.undo()
    await waitFor(() => expect(JSON.stringify(H.alerts)).toBe(r.bytes0))
    expect(JSON.stringify(cells())).toBe(r.grid)
  }, 30000)

  it('C3-062 CONTROL: the member clicked the top-left cell (NVDA), the words name the top-right one (AMD): the alert is AMD\'s, none is NVDA\'s; Undo leaves the book byte-identical', async () => {
    const r = await runAlert({ clickFirst: 'c0', plan: namedCellPlan })
    // the control is real only if the request marked a DIFFERENT cell active than the one named
    expect(r.ctxSeen.charts.find(c => c.selected)?.symbol).toBe('NVDA')
    expect(cellAt(r.ctxSeen, 'top-right').symbol).toBe('AMD')
    expect(added(r.book0)).toEqual(['AMD above 250'])
    expect(H.alerts.some(a => a.sym === 'NVDA')).toBe(false)
    expect(outcomeIsNamedCell(r.book0, 'c1')).toBe(true)
    await r.undo()
    await waitFor(() => expect(JSON.stringify(H.alerts)).toBe(r.bytes0))
  }, 30000)

  it('C3-062 CONTROL (the check has teeth): the same setup with a plan that alerts the ACTIVE cell\'s symbol is rejected by the same outcome check', async () => {
    const r = await runAlert({ clickFirst: 'c0', plan: activeCellPlan })
    expect(added(r.book0)).toEqual(['NVDA above 250'])                 // what a wrong run does
    expect(outcomeIsNamedCell(r.book0, 'c1')).toBe(false)              // …and the check the real cases use fails it
    await r.undo()
    await waitFor(() => expect(JSON.stringify(H.alerts)).toBe(r.bytes0))
  }, 30000)
})

// ── pl-grid: the grid's own actions (multiChart.set / multiChart.cell over useGridAgentControl) ──
const gridRef = (ctx) => must(ctx.multiChart?.ref, 'multiChart section')
const gridOp = (op, extra = {}) => (ctx) => [{ action: 'multiChart.set', target: gridRef(ctx), args: { op, rows: null, cols: null, on: null, name: null, direction: null, ...extra } }]
const cellOp = (position, op) => (ctx) => [{ action: 'multiChart.cell', target: cellAt(ctx, position).ref, args: { op } }]
/** the board exactly as persisted in memory (device scoping included) — what Undo must give back byte for byte */
const raw = () => H.mc.snapshot()
const persisted = () => H.prefs.multichart_state
const syms = () => cells().map(c => c.sym || null)
const board = () => H.api.current.get('grid:board')?.agent?.gridBoard || null
const transcript = () => screen.getByTestId('agent-transcript').textContent
/** Undo, then: the board is byte-identical in memory AND in the saved pref, and nothing else is left over */
async function undoesExactly(undo, raw0, { maxId = null, settingsOpen = false } = {}) {
  await undo()
  await waitFor(() => expect(raw()).toBe(raw0))
  await waitFor(() => expect(persisted()).toBe(raw0), { timeout: 3000 })
  expect(H.mc.maxId ?? null).toBe(maxId)
  expect(!!H.mc.settingsOpen).toBe(settingsOpen)
}
const groupState = (g, extra = {}) => ({ groupsMode: true, group: g, ...extra })
const tpl = (layoutId, symsIn, extra = {}) => ({ kind: 'multichart', widgets: [], layout: layoutId, cells: symsIn.map(sym => ({ sym, tf: 'D', chartType: null })), group: null, ...extra })
const layoutsLoaded = () => waitFor(() => expect(H.layoutCalls.some(([m]) => m === 'GET')).toBe(true))

describe('Multi Chart execution family — the grid itself (pl-grid: multiChart.set / multiChart.cell)', () => {
  it('C3-042 "can you split my screen into a two by three grid of charts" from the BOARD: Multi Chart opens at 2×3; the four cells keep their charts, two new ones are empty; Undo puts the board back byte for byte', async () => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ mode: 'workspace' })) }
    const { say, undo } = mount()
    expect(screen.queryByTestId('canvas-c0')).toBeNull()                // the board, not the grid, is on screen
    const raw0 = raw(); const keep = JSON.stringify(cells())
    await say('can you split my screen into a two by three grid of charts', gridOp('layout', { rows: 2, cols: 3 }))
    await waitFor(() => expect(H.mc.state.mode).toBe('grid'))
    expect(H.mc.state.layout).toBe('2x3')
    expect(cells()).toHaveLength(6)
    expect(JSON.stringify(cells().slice(0, 4))).toBe(keep)
    expect(cells().slice(4).map(c => c.sym)).toEqual([null, null])
    await waitFor(() => expect(JSON.parse(persisted()).layout).toBe('2x3'))
    await waitFor(() => expect(screen.getByTestId('canvas-c0')).toBeTruthy())
    expect(receipts().at(-1).textContent).toMatch(/whole grid is now 2×3 \(6 charts\)/)
    await undoesExactly(undo, raw0)
    expect(H.mc.state.mode).toBe('workspace')
  }, 30000)

  it('C3-043 "I want three rows and four columns": a custom 3×4 grid (12 cells) through applyCustomLayout; Undo is exact', async () => {
    const { say, undo } = mount()
    const raw0 = raw(); const keep = JSON.stringify(cells())
    await say('I want three rows and four columns of charts', gridOp('layout', { rows: 3, cols: 4 }))
    await waitFor(() => expect(H.mc.state.layout).toBe('3x4'))
    expect(cells()).toHaveLength(12)
    expect(JSON.stringify(cells().slice(0, 4))).toBe(keep)
    await undoesExactly(undo, raw0)
  }, 30000)

  it('C3-043 a grid past the cap ("make it five rows by two") is refused in words; nothing changes', async () => {
    const { say } = mount()
    const raw0 = raw()
    await say('make it five rows by two', gridOp('layout', { rows: 5, cols: 2 }))
    await waitFor(() => expect(transcript()).toMatch(/at most 4 rows by 4 columns/))
    expect(raw()).toBe(raw0)
    expect(receipts()).toHaveLength(0)
  }, 30000)

  it('C3-044 "close the multi chart view and take me back to my normal board": the grid leaves the screen, kept for next time; Undo brings it back exactly', async () => {
    const { say, undo } = mount()
    const raw0 = raw(); const keep = JSON.stringify(cells())
    await say('close the multi chart view and take me back to my normal board', gridOp('exit'))
    await waitFor(() => expect(H.mc.state.mode).toBe('workspace'))
    await waitFor(() => expect(screen.queryByTestId('canvas-c0')).toBeNull())
    expect(JSON.stringify(cells())).toBe(keep)                            // the grid itself is kept
    await waitFor(() => expect(JSON.parse(persisted()).mode).toBe('workspace'))
    await undoesExactly(undo, raw0)
    expect(H.mc.state.mode).toBe('grid')
  }, 30000)

  it('C3-045 "link the crosshairs across all four charts": crosshair sync on for the whole grid (the receipt says so); cells untouched; Undo is exact', async () => {
    const { say, undo } = mount()
    const raw0 = raw(); const keep = JSON.stringify(cells())
    await say('link the crosshairs across all four charts', gridOp('syncCrosshair', { on: true }))
    await waitFor(() => expect(H.mc.state.syncCrosshair).toBe(true))
    await waitFor(() => expect(JSON.parse(persisted()).syncCrosshair).toBe(true))
    expect(JSON.stringify(cells())).toBe(keep)
    expect(receipts().at(-1).textContent).toMatch(/every chart in the grid/)
    await undoesExactly(undo, raw0)
  }, 30000)

  it('C3-046 "keep every chart scrolled to the same dates": time-range sync on (gridBoard reads it); Undo is exact', async () => {
    const { say, undo } = mount()
    const raw0 = raw(); const keep = JSON.stringify(cells())
    await say('keep every chart scrolled to the same dates', gridOp('syncTimeRange', { on: true }))
    await waitFor(() => expect(board().syncTimeRange()).toBe(true))
    await waitFor(() => expect(JSON.parse(persisted()).syncTimeRange).toBe(true))
    expect(JSON.stringify(cells())).toBe(keep)
    await undoesExactly(undo, raw0)
    expect(board().syncTimeRange()).toBe(false)
  }, 30000)

  it('C3-047 "switch groups mode on": Groups mode on (gridBoard reads it); cells untouched; Undo is exact', async () => {
    const { say, undo } = mount()
    const raw0 = raw(); const keep = JSON.stringify(cells())
    await say('switch groups mode on', gridOp('groupsMode', { on: true }))
    await waitFor(() => expect(board().groupsMode()).toBe(true))
    expect(JSON.stringify(cells())).toBe(keep)
    await undoesExactly(undo, raw0)
    expect(board().groupsMode()).toBe(false)
  }, 30000)

  it('C3-048 "fill the grid with the space stocks": the picker\'s own fetch-and-fill — the ETF pinned first, the grid size kept, Groups mode on; Undo is exact', async () => {
    const { say, undo } = mount()
    const raw0 = raw()
    await say('fill the grid with the space stocks', gridOp('pickGroup', { name: 'space' }))
    await waitFor(() => expect(syms()).toEqual(['UFO', 'RKLB', 'ASTS', 'LUNR']))
    expect(H.mc.state.group).toMatchObject({ id: 'space', name: 'Space' })
    expect(H.mc.state.groupsMode).toBe(true)
    expect(H.topCalls).toContain('space')
    await waitFor(() => expect(JSON.parse(persisted()).group?.id).toBe('space'))
    expect(receipts().at(-1).textContent).toMatch(/every cell of the grid/)
    await undoesExactly(undo, raw0)
  }, 30000)

  it('C3-048 a group name that fits two groups ("the semiconductor group") is asked by name, never guessed; nothing changes', async () => {
    const { say } = mount()
    const raw0 = raw()
    await say('load the semiconductor group', gridOp('pickGroup', { name: 'semiconductor' }))
    await waitFor(() => expect(transcript()).toMatch(/Several groups match/))
    expect(transcript()).toMatch(/Semiconductors/)
    expect(transcript()).toMatch(/Semiconductor Equipment/)
    expect(raw()).toBe(raw0)
    expect(receipts()).toHaveLength(0)
  }, 30000)

  it('C3-048 a group with nothing chartable: the picker would have switched Groups mode on first — the Agent takes that back, and nothing is left changed', async () => {
    const { say } = mount()
    const raw0 = raw()
    await say('load the Dead Theme group', gridOp('pickGroup', { name: 'Dead Theme' }))
    await waitFor(() => expect(transcript()).toMatch(/no chartable names/))
    await waitFor(() => expect(raw()).toBe(raw0))
    expect(H.mc.state.groupsMode).toBe(false)
    expect(receipts()).toHaveLength(0)
  }, 30000)

  it('C3-049 "go to the next group": Next › — the next theme\'s leaders fill the grid; Undo is exact', async () => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ cells: [cell('c0', 'UFO'), cell('c1', 'RKLB'), cell('c2', 'ASTS'), cell('c3', 'LUNR')], ...groupState({ id: 'space', name: 'Space', by: 'today', n: 4 }) })) }
    const { say, undo } = mount()
    const raw0 = raw()
    await say('go to the next group', gridOp('stepGroup', { direction: 'next' }))
    await waitFor(() => expect(syms()).toEqual(['MU', 'WDC', 'STX', 'SNDK']))
    expect(H.mc.state.group).toMatchObject({ id: 'memory', name: 'Memory & HBM' })
    await undoesExactly(undo, raw0)
  }, 30000)

  it('C3-049 "switch over to the memory & HBM group" (an also-in chip): the switcher swaps the current group into the chips; Undo is exact', async () => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ cells: [cell('c0', 'SMH'), cell('c1', 'NVDA'), cell('c2', 'AMD'), cell('c3', 'AVGO')], ...groupState({ id: 'semis', name: 'Semiconductors', by: 'today', n: 4, seed: 'NVDA', alsoIn: [{ id: 'memory', name: 'Memory & HBM' }] }) })) }
    const { say, undo } = mount()
    const raw0 = raw()
    await say('switch over to the memory & HBM group', gridOp('pickGroup', { name: 'memory & HBM' }))
    await waitFor(() => expect(syms()).toEqual(['MU', 'WDC', 'STX', 'SNDK']))
    expect(H.mc.state.group.id).toBe('memory')
    expect(H.mc.state.group.alsoIn).toEqual([{ id: 'semis', name: 'Semiconductors' }])
    await undoesExactly(undo, raw0)
  }, 30000)

  it('C3-050 "refresh the group": ↻ Refresh — the loaded group re-ranked now; a cell whose ticker stays keeps its id; Undo is exact', async () => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ cells: [cell('c0', 'SMH'), cell('c1', 'NVDA'), cell('c2', 'AMD'), cell('c3', 'AVGO')], ...groupState({ id: 'semis', name: 'Semiconductors', by: 'today', n: 4, seed: 'NVDA', alsoIn: [{ id: 'memory', name: 'Memory & HBM' }] }) })) }
    H.groupTop = { ...TOP(), semis: { syms: ['AVGO', 'MU', 'NVDA', 'AMD'], etf: 'SMH' } }
    const { say, undo } = mount()
    const raw0 = raw()
    await say('refresh the group', gridOp('refreshGroup'))
    await waitFor(() => expect(syms()).toEqual(['SMH', 'AVGO', 'MU', 'NVDA']))
    expect(at('c0').sym).toBe('SMH')
    expect(cells().find(c => c.sym === 'AVGO').id).toBe('c3')
    // a refresh keeps the group it refreshed — its also-in chips — exactly as ↻ Refresh does ({ ...g, n })
    expect(H.mc.state.group).toMatchObject({ id: 'semis', alsoIn: [{ id: 'memory', name: 'Memory & HBM' }] })
    await undoesExactly(undo, raw0)
  }, 30000)

  it('C3-051 "get out of groups mode": Exit Groups — the group is dropped, the charts stay; Undo is exact', async () => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ cells: [cell('c0', 'UFO'), cell('c1', 'RKLB'), cell('c2', 'ASTS'), cell('c3', 'LUNR')], ...groupState({ id: 'space', name: 'Space', by: 'today', n: 4 }) })) }
    const { say, undo } = mount()
    const raw0 = raw(); const symsBefore = syms()
    await say('get out of groups mode', gridOp('groupsMode', { on: false }))
    await waitFor(() => expect(H.mc.state.groupsMode).toBe(false))
    expect(H.mc.state.group).toBe(null)
    expect(syms()).toEqual(symsBefore)
    await undoesExactly(undo, raw0)
  }, 30000)

  it('C3-052 "open my Momentum Nine grid": the saved multichart grid (not the workspace layout of a similar name) replaces the board; Undo is exact', async () => {
    const nine = ['NVDA', 'AMD', 'TSLA', 'META', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'NFLX']
    H.layouts = { global: [], mine: [
      { id: 7, name: 'Momentum Nine', scope: 'user', layout: tpl('3x3', nine) },
      { id: 8, name: 'Momentum Board', scope: 'user', layout: { widgets: [{ id: 'w1', type: 'chart' }], cols: 24 } },
    ] }
    const { say, undo } = mount()
    await layoutsLoaded()
    const raw0 = raw()
    let seen = null
    await say('open my Momentum Nine grid', (ctx) => { seen = ctx.multiChart; return gridOp('applySaved', { name: 'Momentum Nine' })(ctx) })
    expect(seen.savedGrids).toEqual(['Momentum Nine'])                    // the workspace layout is not offered as a grid
    await waitFor(() => expect(H.mc.state.layout).toBe('3x3'))
    expect(syms()).toEqual(nine)
    await undoesExactly(undo, raw0)
  }, 30000)

  it('C3-053 "save this grid as Chip Watch": one create-only POST of the menu\'s own shape (kind multichart, the cells, the member\'s scope); the grid is untouched; Undo deletes it', async () => {
    const { say, undo } = mount()
    await layoutsLoaded()
    const raw0 = raw()
    await say('save this grid as Chip Watch', gridOp('saveGrid', { name: 'Chip Watch' }))
    await waitFor(() => expect(H.layouts.mine.map(t => t.name)).toEqual(['Chip Watch']))
    const posts = H.layoutCalls.filter(([m]) => m === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0][2]).toMatchObject({ name: 'Chip Watch', scope: 'user', create_only: true, layout: { kind: 'multichart', layout: '2x2', group: null } })
    expect(posts[0][2].layout.cells.map(c => c.sym)).toEqual(['NVDA', 'AMD', 'TSLA', null])
    expect(raw()).toBe(raw0)
    await undo()
    await waitFor(() => expect(H.layouts.mine).toEqual([]))
    expect(H.layoutCalls.filter(([m]) => m === 'DELETE')).toHaveLength(1)
    expect(raw()).toBe(raw0)
  }, 30000)

  it('C3-054 BOUNDARY: a PREBUILT (global) grid is not the member\'s to delete — refused in words, no DELETE sent', async () => {
    H.layouts = { global: [{ id: 3, name: 'UCT Leaders', scope: 'global', layout: tpl('2x2', ['SPY', 'QQQ', 'IWM', 'DIA']) }], mine: [] }
    const { say } = mount()
    await layoutsLoaded()
    await say('delete the UCT Leaders grid', gridOp('deleteSaved', { name: 'UCT Leaders' }))
    await waitFor(() => expect(transcript()).toMatch(/prebuilt grid, which only an admin can delete/))
    expect(H.layoutCalls.filter(([m]) => m === 'DELETE')).toHaveLength(0)
    expect(H.layouts.global).toHaveLength(1)
  }, 30000)

  it('C3-055 "delete my Old Grid layout": shown first; Apply sends ONE DELETE of that row only; Undo saves it again under its name with its content', async () => {
    const old = tpl('1x2', ['SPY', 'QQQ'])
    H.layouts = { global: [], mine: [{ id: 9, name: 'Old Grid', scope: 'user', layout: old }, { id: 10, name: 'Keep Grid', scope: 'user', layout: tpl('2x1', ['IWM', 'DIA']) }] }
    const { say, apply, undo } = mount()
    await layoutsLoaded()
    const raw0 = raw()
    await say('delete my Old Grid layout', gridOp('deleteSaved', { name: 'Old Grid' }))
    expect(H.layoutCalls.filter(([m]) => m === 'DELETE')).toHaveLength(0)    // a proposal: nothing deleted yet
    await apply()
    await waitFor(() => expect(H.layouts.mine.map(t => t.name)).toEqual(['Keep Grid']))
    expect(H.layoutCalls.filter(([m]) => m === 'DELETE').map(([, u]) => u)).toEqual(['/api/charts/layouts/9'])
    expect(raw()).toBe(raw0)
    await undo()
    await waitFor(() => expect(H.layouts.mine.map(t => t.name).sort()).toEqual(['Keep Grid', 'Old Grid']))
    expect(H.layouts.mine.find(t => t.name === 'Old Grid').layout).toEqual(old)
  }, 30000)

  it('C3-059 "put the top-right chart back to my own chart settings": Reset to my chart — that cell drops its fork, keeps its Style pick and timeframe; no other cell moves; Undo is exact', async () => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ cells: [cell('c0', 'NVDA', { settings: { upColor: '#111111' } }), cell('c1', 'AMD', { tf: 'W', chartType: 'hollow', settings: { upColor: '#123456', chartType: 'bars' } }), cell('c2', 'TSLA'), cell('c3', null)] })) }
    const { say, undo } = mount()
    const raw0 = raw(); const before = othersOf('c1')
    await say('put the top-right chart back to my own chart settings', cellOp('top-right', 'resetToMine'))
    await waitFor(() => expect(at('c1').settings).toBeUndefined())
    expect(at('c1')).toMatchObject({ id: 'c1', sym: 'AMD', tf: 'W', chartType: 'hollow' })
    expect(othersOf('c1')).toBe(before)
    await waitFor(() => expect(JSON.parse(persisted()).cells[1].settings).toBeUndefined())
    await undoesExactly(undo, raw0)
  }, 30000)

  it('C3-060 "blow up the bottom-left chart to full size": maximized (gridBoard reads it), the grid unchanged; "restore the grid" un-maximizes; each Undo is exact', async () => {
    const { say, undo } = mount()
    const raw0 = raw()
    await say('blow up the bottom-left chart to full size', cellOp('bottom-left', 'maximize'))
    await waitFor(() => expect(board().maximized()).toBe('c2'))
    expect(raw()).toBe(raw0)
    await undo()
    await waitFor(() => expect(board().maximized()).toBe(null))
    expect(raw()).toBe(raw0)
    await say('blow up the bottom-left chart to full size', cellOp('bottom-left', 'maximize'))
    await waitFor(() => expect(board().maximized()).toBe('c2'))
    await say('ok put the grid back to normal', gridOp('restoreGrid'))
    await waitFor(() => expect(board().maximized()).toBe(null))
    await undo()
    await waitFor(() => expect(board().maximized()).toBe('c2'))
    expect(raw()).toBe(raw0)
  }, 30000)

  it('C3-061 "open the shared chart settings for the grid": the grid\'s ONE Shared Chart Settings dialog opens (its scope said); Undo closes it', async () => {
    const { say, undo } = mount()
    const raw0 = raw()
    await say('open the shared chart settings for the grid', gridOp('openSettings'))
    await waitFor(() => expect(H.mc.settingsOpen).toBe(true))
    expect(receipts().at(-1).textContent).toMatch(/every chart in the grid/)
    expect(raw()).toBe(raw0)
    await undo()
    await waitFor(() => expect(H.mc.settingsOpen).toBe(false))
    expect(raw()).toBe(raw0)
  }, 30000)
})

describe('Multi Chart execution family — rows not executed (BLOCKED-owner)', () => {
  it.todo('C3-054 save a grid as global (admin) — BLOCKED-owner: admin/global scope is an owner decision (same as C3-032); not attempted. The Agent saves only the member\'s own grids (multiChart.set saveGrid, scope user) and refuses to delete a prebuilt one (C3-054 BOUNDARY above)')
})
