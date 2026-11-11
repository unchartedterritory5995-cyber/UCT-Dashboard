// CHARTS OUTCOME — Multi Chart GRID family, HELD-OUT (pl-grid): the grid's own actions (multiChart.set / multiChart.cell)
// across 2×2, 2×3 and 3×3 grids, in phrasings of their own, through the same real-panel mount as multiChart.outcome.test.jsx
// (AgentPanel + useAgent in gridMode, the real MultiChartGrid / GridChartCell / useMultiChartState, the real workspace host
// with useGridAgentControl). Stand-ins: the canvas, the server (fetch), the MODEL (scripted). Evidence: SIMULATED (vitest,
// jsdom, scripted model) — not a real browser, not the real model.
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

const click = (id) => fireEvent.pointerDown(document.querySelector(`[data-grid-cell-id="${id}"]`).parentElement)
// ════ pl-grid HELD-OUT FAMILY: the grid's own actions across grid shapes, in phrasings the outcome rows do not use ════
// Written before the capability was registered (it failed there: the model was never given multiChart.*). Each case: the
// outcome read back from the grid's state, every other cell byte-identical, and an exact Undo; the targeting cases also
// carry a WRONG plan (the anchor, the excluded click, a guess) and prove it is never run.
const gridRef = (ctx) => must(ctx.multiChart?.ref, 'multiChart section')
const gridOp = (op, extra = {}) => (ctx) => [{ action: 'multiChart.set', target: gridRef(ctx), args: { op, rows: null, cols: null, on: null, name: null, direction: null, ...extra } }]
const cellOp = (position, op) => (ctx) => [{ action: 'multiChart.cell', target: cellAt(ctx, position).ref, args: { op } }]
const cellN = (n, op) => (ctx) => [{ action: 'multiChart.cell', target: must((ctx.charts || [])[n], `chart ${n + 1}`).ref, args: { op } }]
const raw = () => H.mc.snapshot()
const board = () => H.api.current.get('grid:board')?.agent?.gridBoard || null
const transcript = () => screen.getByTestId('agent-transcript').textContent
const POOL = ['NVDA', 'AMD', 'TSLA', 'META', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'NFLX']
const SHAPES = [{ id: '2x2', rows: 2, cols: 2 }, { id: '2x3', rows: 2, cols: 3 }, { id: '3x3', rows: 3, cols: 3 }]
const gridOf = (s, extra = {}) => GRID({ layout: s.id, cells: POOL.slice(0, s.rows * s.cols).map((sym, i) => cell(`c${i}`, sym)), ...extra })
const corner = (s) => ({ 'top-left': 0, 'top-right': s.cols - 1, 'bottom-left': (s.rows - 1) * s.cols, 'bottom-right': s.rows * s.cols - 1 })
const asked = () => /Which chart|Did you mean/.test(transcript())

describe.each(SHAPES)('Multi Chart family on a $id grid (pl-grid held-out)', (shape) => {
  for (const [pos, idx] of Object.entries(corner(shape))) {
    it(`maximize: "make the ${pos} chart take up the whole grid" → exactly that cell (c${idx}); the board is untouched; Undo restores the grid`, async () => {
      H.prefs = { multichart_state: JSON.stringify(gridOf(shape)) }
      const { say, undo } = mount()
      const raw0 = raw()
      await say(`make the ${pos} chart take up the whole grid`, cellOp(pos, 'maximize'))
      await waitFor(() => expect(board().maximized()).toBe(`c${idx}`))
      expect(raw()).toBe(raw0)
      await undo()
      await waitFor(() => expect(board().maximized()).toBe(null))
      expect(raw()).toBe(raw0)
    }, 30000)
  }

  it('maximize by number: "go full screen on chart 4" → the fourth cell in reading order', async () => {
    H.prefs = { multichart_state: JSON.stringify(gridOf(shape)) }
    const { say } = mount()
    await say('go full screen on chart 4', cellN(3, 'maximize'))
    await waitFor(() => expect(board().maximized()).toBe('c3'))
  }, 30000)

  it('ANCHOR: the clicked top-left cell + "maximize the one below this" → the cell below it; a plan on the anchor itself is asked, never run', async () => {
    H.prefs = { multichart_state: JSON.stringify(gridOf(shape)) }
    const m = mount()
    click('c0')
    // the wrong plan: aimed at the anchor: aimed at the anchor
    await m.say('maximize the one below this', (ctx) => [{ action: 'multiChart.cell', target: must(ctx.charts.find(c => c.selected), 'clicked').ref, args: { op: 'maximize' } }])
    await waitFor(() => expect(asked()).toBe(true))
    expect(board().maximized()).toBe(null)
    expect(receipts()).toHaveLength(0)
  }, 30000)

  it('ANCHOR (the right plan): the clicked top-left cell + "maximize the one below this" → the cell below, and only it', async () => {
    H.prefs = { multichart_state: JSON.stringify(gridOf(shape)) }
    const m = mount()
    click('c0')
    const below = shape.cols
    await m.say('maximize the one below this', cellN(below, 'maximize'))
    await waitFor(() => expect(board().maximized()).toBe(`c${below}`))
  }, 30000)

  it('EXCLUDED click: "reset the bottom-right one to my chart, not the clicked one" — a plan on the clicked cell is asked, the clicked cell keeps its fork', async () => {
    const n = shape.rows * shape.cols
    H.prefs = { multichart_state: JSON.stringify(gridOf(shape, { cells: POOL.slice(0, n).map((sym, i) => cell(`c${i}`, sym, { settings: { upColor: `#00000${i}` } })) })) }
    const m = mount()
    click('c0')
    const raw0 = raw()
    await m.say('reset the bottom-right one to my chart, not the clicked one', (ctx) => [{ action: 'multiChart.cell', target: must(ctx.charts.find(c => c.selected), 'clicked').ref, args: { op: 'resetToMine' } }])
    await waitFor(() => expect(asked()).toBe(true))
    expect(raw()).toBe(raw0)
    expect(at('c0').settings).toEqual({ upColor: '#000000' })
  }, 30000)

  it('reset: "drop the custom look on the bottom-right chart and use my normal settings" → only that cell loses its fork; Undo is byte-exact', async () => {
    const n = shape.rows * shape.cols
    H.prefs = { multichart_state: JSON.stringify(gridOf(shape, { cells: POOL.slice(0, n).map((sym, i) => cell(`c${i}`, sym, { settings: { upColor: `#00000${i}` } })) })) }
    const { say, undo } = mount()
    const raw0 = raw()
    const id = `c${n - 1}`
    const others = JSON.stringify(cells().filter(c => c.id !== id))
    await say('drop the custom look on the bottom-right chart and use my normal settings', cellOp('bottom-right', 'resetToMine'))
    await waitFor(() => expect(at(id).settings).toBeUndefined())
    expect(JSON.stringify(cells().filter(c => c.id !== id))).toBe(others)
    await undo()
    await waitFor(() => expect(raw()).toBe(raw0))
  }, 30000)

  // ⛔ FOUND by this family (pl-grid, 2026-11-10), NOT fixed here (deixis.js is read-only for this workstream; #988 owns it):
  // deixis NEG_POINTER reads "not the clicked one" / "except this one" as excluding the click, but NOT "not the one I clicked" —
  // that phrase then POINTS at the click (POINTS), resolveDeictic answers the click, and a model plan aimed at the clicked cell
  // runs. Measured with multiChart.cell resetToMine; the rule is target-kind-generic, so chart.* ops read it the same way.
  // FIXED by #988 (NEG_POINTER), on master since 64421f770d: the it.fails and the PINNED wrong outcome flipped together on the
  // #1030 re-merge, so they are one plain `it` asserting the ask (as the Lead's 2026-11-10 pin said).
  const runPhrasing2 = async () => {
    const n = shape.rows * shape.cols
    H.prefs = { multichart_state: JSON.stringify(gridOf(shape, { cells: POOL.slice(0, n).map((sym, i) => cell(`c${i}`, sym, { settings: { upColor: `#00000${i}` } })) })) }
    const m = mount()
    click('c0')
    await m.say('reset the bottom-right one to my chart, not the one I clicked', (ctx) => [{ action: 'multiChart.cell', target: must(ctx.charts.find(c => c.selected), 'clicked').ref, args: { op: 'resetToMine' } }])
  }
  it('#988 NEG_POINTER: "…not the one I clicked" — a plan on the clicked cell is asked and the clicked cell keeps its fork', async () => {
    await runPhrasing2()
    await waitFor(() => expect(asked()).toBe(true), { timeout: 1500 })
    expect(at('c0').settings).toEqual({ upColor: '#000000' })
  }, 30000)

  it('AMBIGUOUS: "maximize the top chart" fits several cells: asked, nothing changes', async () => {
    H.prefs = { multichart_state: JSON.stringify(gridOf(shape)) }
    const { say } = mount()
    const raw0 = raw()
    await say('maximize the top chart', cellOp('top-left', 'maximize'))
    await waitFor(() => expect(asked()).toBe(true))
    expect(board().maximized()).toBe(null)
    expect(raw()).toBe(raw0)
  }, 30000)

  it('HIDDEN: with one cell maximized, a maximize aimed at a cell behind it is refused in words; nothing moves', async () => {
    H.prefs = { multichart_state: JSON.stringify(gridOf(shape)) }
    const { say } = mount()
    await say('make the top-left chart take up the whole grid', cellOp('top-left', 'maximize'))
    await waitFor(() => expect(board().maximized()).toBe('c0'))
    await say('now maximize the bottom-right one', cellOp('bottom-right', 'maximize'))
    await waitFor(() => expect(transcript()).toMatch(/hidden behind the maximized one/))
    expect(board().maximized()).toBe('c0')
  }, 30000)

  it('layout: a grow keeps every chart in its cell and appends empties; a shrink that drops charts is SHOWN first, names them, and Undo brings every one back byte for byte', async () => {
    H.prefs = { multichart_state: JSON.stringify(gridOf(shape)) }
    const { say, apply, undo } = mount()
    const raw0 = raw()
    const n = shape.rows * shape.cols
    if (n < 16) {
      const keep = JSON.stringify(cells())
      await say('give me sixteen charts, four by four', gridOp('layout', { rows: 4, cols: 4 }))
      await waitFor(() => expect(H.mc.state.layout).toBe('4x4'))
      expect(JSON.stringify(cells().slice(0, n))).toBe(keep)
      expect(cells().slice(n).every(c => c.sym === null)).toBe(true)
      await undo()
      await waitFor(() => expect(raw()).toBe(raw0))
    }
    await say('shrink this down to just two side by side', gridOp('layout', { rows: 1, cols: 2 }))
    expect(H.mc.state.layout).toBe(shape.id)                                 // shown first: nothing changed yet
    await waitFor(() => expect(transcript()).toMatch(new RegExp(POOL[n - 1])))  // the proposal names what goes
    await apply()
    await waitFor(() => expect(H.mc.state.layout).toBe('1x2'))
    expect(cells().map(c => c.sym)).toEqual(POOL.slice(0, 2))
    await undo()
    await waitFor(() => expect(raw()).toBe(raw0))
  }, 30000)

  it('grid-wide toggle: "sync the crosshair on all of these" names its scope and leaves every cell byte-identical; "turn it back off" is the same op, off', async () => {
    H.prefs = { multichart_state: JSON.stringify(gridOf(shape)) }
    const { say } = mount()
    const keep = JSON.stringify(cells())
    await say('sync the crosshair on all of these', gridOp('syncCrosshair', { on: true }))
    await waitFor(() => expect(H.mc.state.syncCrosshair).toBe(true))
    expect(receipts().at(-1).textContent).toMatch(/every chart in the grid/)
    await say('turn crosshair sync back off', gridOp('syncCrosshair', { on: false }))
    await waitFor(() => expect(H.mc.state.syncCrosshair).toBe(false))
    expect(JSON.stringify(cells())).toBe(keep)
  }, 30000)
})
