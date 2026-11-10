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

const H = vi.hoisted(() => ({ prefs: {}, setPref: null, api: null, mc: null, nav: null, chartProps: {}, session: 'closed', alerts: [], alertCalls: [] }))

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
beforeEach(() => {
  envelopes = []; scriptErrors = []; boardAdds = []; turns = 0
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
function Stage() {
  const mc = useMultiChartState()
  H.mc = mc
  const host = useMemo(() => withTracingsSync(buildWorkspaceHost({
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
  })), [])
  return (<><MultiChartGrid mc={mc} /><AgentPanel host={host} gridMode surface="charts" onClose={() => {}} /></>)
}
const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })
function mount() {
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'member' } }}><Stage /></AuthContext.Provider>)
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

describe('Multi Chart execution family — rows no existing capability executes (GAP / BLOCKED-owner)', () => {
  // grid-level writers that already exist in useMultiChartState.js but are NOT on the Agent's grid object (gridBoard,
  // MultiChartGrid.jsx:232-245 — read-only: cells/shape/selected/lastChanged/maximized/syncTimeRange/groupsMode/persist) and
  // have no capability; any write to target 'board' | 'workspace' | 'layouts' is refused in grid mode (gridMode.js:75)
  it.todo('C3-042 enter a preset grid — GAP: writer mc.enterGrid (useMultiChartState.js:133) has no capability; from the board the Agent has no handle on mc at all (buildWorkspaceHost, host.js:749, carries no grid writer), and a workspace-target write is refused in grid mode (gridMode.js:75)')
  it.todo('C3-043 custom rows × columns grid — GAP: writer mc.applyCustomLayout (useMultiChartState.js:144) is not on gridBoard (MultiChartGrid.jsx:232-245); no multiChart.set capability; GRID_MAX_CELLS cap lives only in MultiChartMenu.jsx:66-80')
  it.todo('C3-044 exit Multi Chart — GAP: writer mc.exitGrid (useMultiChartState.js:140) is not on gridBoard; no capability; gridMode.js:75 refuses board/workspace targets')
  it.todo('C3-045 toggle crosshair sync — GAP: writer mc.setSyncCrosshair (useMultiChartState.js:229) is not on gridBoard (only a read of syncTimeRange is); no capability')
  it.todo('C3-046 toggle time-range sync — GAP: writer mc.setSyncTimeRange (useMultiChartState.js:233) is not on gridBoard (gridBoard.syncTimeRange is read-only, MultiChartGrid.jsx:242); no capability')
  it.todo('C3-047 turn on Groups mode — GAP: writer mc.setGroupsMode(true) (useMultiChartState.js:237) is not on gridBoard (gridBoard.groupsMode is read-only, MultiChartGrid.jsx:243); no capability')
  it.todo('C3-048 pick a group for the grid — GAP: the fetch-and-fill (fetchGroupTop + pinEtf → mc.fillCells, useMultiChartState.js:161) lives in MultiChartMenu.jsx (group picker); no capability, not on gridBoard')
  it.todo('C3-049 step or switch group — GAP: stepGroup is component logic in MultiChartMenu.jsx:84-101 (fetchGroups/neighborGroup/fetchGroupTop → mc.fillCells); needs lifting into a writer on gridBoard + a capability')
  it.todo('C3-050 refresh the group — GAP: the refresh handler is inline in MultiChartMenu.jsx:288-312 (→ mc.fillCells); needs a writer on gridBoard + a capability, and live group data to verify against (fixture)')
  it.todo('C3-051 exit Groups — GAP: writer mc.setGroupsMode(false) / mc.clearGroup (useMultiChartState.js:237, :225) is not on gridBoard; no capability')
  // saved grids: the same /api/charts/layouts store, kind:'multichart'
  it.todo('C3-052 apply a saved grid — GAP: writer mc.applyGridTemplate (useMultiChartState.js:245) is not on gridBoard; the Agent layout source omits multichart rows (ChartsWorkspace.jsx:2861-2862 filter → dockEntries → agentLayoutsRef.entries :3376); layout.open (capabilities/layout.js:351) opens workspace layouts only')
  it.todo('C3-053 save a grid — GAP: layout.saveAs (capabilities/layout.js:454) saves the WORKSPACE board, not {kind:\'multichart\', layout, cells, group} (MultiChartMenu.jsx:103-127), and gridMode.js:75 refuses every non-query layouts write in grid mode; needs a kind:\'multichart\' path')
  it.todo('C3-054 save a grid as global (admin) — BLOCKED-owner: admin/global scope is an owner decision (same as C3-032); not attempted')
  it.todo('C3-055 delete a saved grid — GAP: layout.delete (capabilities/layout.js:598) only sees dockEntries (workspace kind; multichart filtered at ChartsWorkspace.jsx:2861-2862) and is refused in grid mode by gridMode.js:75; needs a kind:\'multichart\' filter/path')
  // per-cell rows
  it.todo('C3-059 reset a cell to my chart — GAP: the product writes settings:null (GridChartCell.jsx:228-231 resetToMyChart → onChange, merged by presence at MultiChartGrid.jsx:202-205); chart.resetDefaults (capabilities/chart.js:893) writes CHART_DEFAULTS into a fork instead — a different outcome; needs a cell-reset capability (or a chart.resetDefaults grid mapping to settings:null in gridAgentAdapter.js)')
  it.todo('C3-060 maximize or restore a cell — GAP: maxId is local useState in MultiChartGrid.jsx:104 (setMaxId :108); gridBoard exposes maximized() read-only (:241); needs a writer on gridBoard + a capability')
  it.todo('C3-061 open shared grid settings — GAP: mc.setSettingsOpen (useMultiChartState.js:61) opens the grid\'s ONE shared ChartSettingsModal (MultiChartGrid.jsx:344, :563); no capability opens a dialog (same as C1-127)')
})
