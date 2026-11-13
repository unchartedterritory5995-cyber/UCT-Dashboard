// HOTFIX (negated-ticker targeting) — the MULTI CHART family of the cross-family matrix (negatedTicker.matrix.test.jsx): the
// grid harness of multiChartGrid.family.test.jsx (real AgentPanel + useAgent in gridMode, the real MultiChartGrid / useMultiChartState
// / useGridAgentControl), the scripted plan resetting ALL FOUR cells. The excluded cell (NVDA) stays byte-identical (grid state AND
// saved prefs), is never carded or offered; the other three change once the member takes the offer. SIMULATED (vitest, jsdom).
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

// ════ HOTFIX (negated-ticker targeting): the multiChart family of the cross-family matrix ════
const must = (v, what) => { if (v == null || v === false) throw new Error(`the context has no ${what}`); return v }
const cellsNow = () => H.mc.state.cells
const NG = () => GRID({ cells: [cell('c0', 'SPY', { settings: { chartType: 'line' } }), cell('c1', 'QQQ', { settings: { chartType: 'line' } }),
  cell('c2', 'NVDA', { settings: { chartType: 'line' } }), cell('c3', 'AMD', { settings: { chartType: 'line' } })] })
const EXCLUDED = 'c2'                                   // NVDA
const storedCell = (id) => JSON.stringify([cellsNow().find(c => c.id === id), JSON.parse(H.prefs.multichart_state).cells.find(c => c.id === id)])
const resetAll = (ctx) => must(ctx.charts?.length === 4 && ctx.charts, 'four cells').map(c => ({ action: 'multiChart.cell', target: c.ref, args: { op: 'resetToMine' } }))
const chartButtons = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent.trim()).filter(t => /NVDA|SPY|QQQ|AMD|Chart|cell/i.test(t))
const cards = () => [...document.querySelectorAll('[data-testid="agent-proposal"]')].map(e => e.textContent).join(' ')
const V = (q) => `reset ${q} to my chart`
const PHRASES = [
  `${V('every cell')}, but leave NVDA's alone`,
  `${V('all of them')}, skip NVDA's`,
  `${V('every cell')}. Not the NVDA chart though.`,
  `${V('all cells')}; dont touch NVDA`,
  `${V('every cell')}, hands off the NVDA chart`,
  `${V('every cell')}. Leave NVDA out of it.`,
  `${V('every cell')} apart from NVDA's`,
  `Leave the NVDA one alone and ${V('every cell')}`,
]
describe('multiChart.cell: a plan naming every cell never touches, cards or offers the cell a negated-ticker clause excludes', () => {
  it.each(PHRASES.map(t => [t]))('"%s"', async (t) => {
    H.prefs = { multichart_state: JSON.stringify(NG()) }
    const m = mount()
    await waitFor(() => expect(H.mc?.state.cells?.[2]?.sym).toBe('NVDA'))
    const before = Object.fromEntries(['c0', 'c1', 'c2', 'c3'].map(id => [id, storedCell(id)]))
    await m.say(t, resetAll)
    expect(storedCell(EXCLUDED), screen.getByTestId('agent-transcript').textContent).toBe(before[EXCLUDED])
    expect(chartButtons().join(' | ')).not.toMatch(/NVDA/)
    expect(cards()).not.toMatch(/NVDA/)
    // take what the panel offers (the set choice, then any Apply): the excluded cell still never changes, the others do
    const set = [...document.querySelectorAll('[data-testid="agent-transcript"] button')].find(b => /,| and /.test(b.textContent) && !/Cancel/.test(b.textContent))
    if (set) { fireEvent.click(set); await idle() }
    if (screen.queryAllByRole('button', { name: 'Apply' }).length) await m.apply()
    expect(storedCell(EXCLUDED)).toBe(before[EXCLUDED])
    expect(['c0', 'c1', 'c3'].filter(id => storedCell(id) !== before[id]), screen.getByTestId('agent-transcript').textContent).toEqual(['c0', 'c1', 'c3'])
  }, 60000)
})
