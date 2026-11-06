// ⭐ UCT Agent controlling MULTI CHART itself: going in and out, shape, options, groups, saved grids, one cell. Through the REAL
// panel (AgentPanel + useAgent + planner, policy, runtime, receipts, Undo), the REAL hook the menu writes with
// (useMultiChartState over the multichart_state pref), the REAL grid (MultiChartGrid + GridChartCell) and the REAL workspace host,
// switching between the board and the grid as ChartsWorkspace does. Stand-ins: the canvas and the model (scripted, no paid call).
// Evidence class: SIMULATED. A scripted model proves what happens to a plan, not that a real model writes that plan.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useMemo } from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const H = vi.hoisted(() => ({ prefs: {}, setPref: null, api: null, mc: null, chartProps: {}, mine: [], global: [], saveLayout: null, deleteLayout: null, groups: [], top: {} }))

vi.mock('../hooks/usePreferences', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, default: () => ({ prefs: H.prefs, setPref: H.setPref, loading: false }) }
})
vi.mock('../utils/extSession', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, getExtSessionCached: () => ({ session: 'closed' }) }
})
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, useSearchParams: () => [new URLSearchParams()] }
})
vi.mock('../pages/charts/WorkspaceContext', () => ({ useWorkspace: () => ({ chartsTheme: null, chartApiById: H.api }) }))
vi.mock('../components/StockChart', () => ({
  default: (props) => { H.chartProps[props.chartId] = props; return <div data-testid={`canvas-${props.chartId}`}>{props.sym}</div> },
}))
vi.mock('../components/chart/SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return { default: forwardRef((_p, ref) => { useImperativeHandle(ref, () => ({ openWith: () => {} })); return <span /> }) }
})
vi.mock('../pages/charts/widgets/ChartDayGain', () => ({ default: () => null }))
vi.mock('../pages/charts/widgets/ChartMarketClock', () => ({ default: () => null }))
vi.mock('../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {} }) }))
vi.mock('../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))
vi.mock('../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../utils/prefetchBars', () => ({ prefetchGridWarm: () => {} }))
vi.mock('../components/chart/ChartSettingsModal', () => ({ default: () => null }))
vi.mock('../pages/charts/grid/useStaggeredMount', () => ({ default: (ids) => ({ mountedIds: new Set(ids), release: () => {} }) }))
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

import { registerBuiltins } from './builtins'
import { AuthContext } from '../context/AuthContext'
import AgentPanel from './AgentPanel'
import useMultiChartState from '../pages/charts/grid/useMultiChartState'
import MultiChartGrid from '../pages/charts/grid/MultiChartGrid'
import { buildWorkspaceHost } from './host'
import { GRID_BOARD_KEY } from '../pages/charts/grid/gridAgentAdapter'
import { exactLayout } from './capabilities/multiChartMode'

registerBuiltins()

const cell = (id, sym, extra = {}) => ({ id, sym, tf: 'D', ...extra })
const GRID = (over = {}) => ({
  mode: 'grid', layout: '2x2',
  cells: [cell('c0', 'NVDA'), cell('c1', 'AMD'), cell('c2', 'TSLA'), cell('c3', 'SPY')],
  ...over,
})
const BOARD = [{ id: 'board1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'A', opts: {} }]
const GROUPS = [{ id: 'semis', name: 'Semiconductors' }, { id: 'software', name: 'Software' }, { id: 'space', name: 'Space Economy' }, { id: 'solar', name: 'Solar' }]

let envelopes, boardWrites
const env = (disposition, ops, reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
const parsed = () => JSON.parse(H.prefs.multichart_state)
beforeEach(() => {
  envelopes = []; boardWrites = []
  H.prefs = { multichart_state: JSON.stringify(GRID()) }
  H.setPref = vi.fn(async (k, v) => { H.prefs = { ...H.prefs, [k]: v }; return true })
  H.api = { current: new Map() }
  H.chartProps = {}
  H.mine = []; H.global = []
  H.groups = GROUPS
  H.top = { semis: { syms: ['AMD', 'NVDA', 'AVGO'], etf: 'SMH' }, software: { syms: ['MSFT', 'CRM', 'NOW', 'ADBE'], etf: null }, space: { syms: ['RKLB', 'ASTS', 'LUNR', 'PL'], etf: null }, solar: { syms: [], etf: null } }
  H.saveLayout = vi.fn(async ({ name, layout }) => { const row = { id: `t${H.mine.length + 1}`, name, layout }; H.mine = [...H.mine, row]; return row })
  H.deleteLayout = vi.fn(async (id) => { H.mine = H.mine.filter(t => t.id !== id) })
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const body = init.body ? JSON.parse(init.body) : null
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/turn') { const e = envelopes.shift(); return json({ conversationId: 'ac_1', envelope: typeof e === 'function' ? e(body) : e, usage: { research_calls: 0, citations: 0 } }) }
    if (u === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (u === '/api/groups') return json({ groups: H.groups })
    const top = /\/api\/groups\/([^/]+)\/top/.exec(u)
    if (top) return json(H.top[top[1]] || { syms: [], etf: null })
    if (u.includes('keys=multichart_state')) return json({ multichart_state: H.prefs.multichart_state })
    if (u.startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })

function Stage() {
  const mc = useMultiChartState()
  H.mc = mc
  const host = useMemo(() => buildWorkspaceHost({
    chartApiById: H.api,
    getWidgets: () => BOARD,
    selectedChart: () => 'board1',
    widgetLabel: (t) => t,
    multiChart: () => ({ mc: H.mc, global: H.global, mine: H.mine, saveLayout: H.saveLayout, deleteLayout: H.deleteLayout }),
    widgetOps: {
      layout: () => ({ widgets: BOARD }),
      add: (t) => { boardWrites.push(t) },
      remove: () => { boardWrites.push('remove') },
      applyBoard: () => { boardWrites.push('applyBoard') },
      persist: async () => { boardWrites.push('persist'); return { ok: true } },
      groupSyms: () => ({ A: 'SPY' }),
    },
  }), [])
  const gridMode = mc.state.mode === 'grid'
  return (
    <>
      {gridMode ? <MultiChartGrid mc={mc} /> : <div data-testid="the-board" />}
      <AgentPanel host={host} gridMode={gridMode} surface="charts" onClose={() => {}} />
    </>
  )
}
function mount() {
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><Stage /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle() }
  return { say, undo: () => say('undo') }
}
const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const receipts = () => screen.queryAllByTestId('agent-receipt')
const lastReceipt = () => receipts().at(-1)?.textContent || ''
const refOf = (b, label = 'Multi Chart') => b.context.multiChart.find(x => x.label === label).ref
// a scripted model's plan on the Multi Chart entry, or the Saved grids entry
const plan = (action, args, label) => (b) => env('apply', [{ action, target: refOf(b, label), args }])
const plans = (...steps) => (b) => env('apply', steps.map(([action, args]) => ({ action, target: refOf(b), args })))
const onCell = (what, n) => (b) => env('apply', [{ action: 'multiChart.cell', target: b.context.charts[n].ref, args: { do: what } }])
const st = () => H.mc.state
const syms = () => st().cells.map(c => c.sym).join(' ')
const click = (id) => fireEvent.pointerDown(document.querySelector(`[data-grid-cell-id="${id}"]`).parentElement)
const maxed = () => H.api.current.get(GRID_BOARD_KEY).agent.gridBoard.maximized()
const onBoard = () => { H.prefs = { multichart_state: JSON.stringify(GRID({ mode: 'workspace' })) } }

describe('going in and out', () => {
  it('enters from the board on a preset, saves it, and Undo puts the board back exactly', async () => {
    onBoard()
    const { say, undo } = mount()
    expect(screen.queryByTestId('the-board')).not.toBeNull()
    envelopes.push(plan('multiChart.enter', { layout: '3x3' }))
    await say('take me into multi chart, three by three')
    await waitFor(() => expect(receipts()).toHaveLength(1))
    expect(st().mode).toBe('grid')
    expect(st().layout).toBe('3x3')
    expect(st().cells).toHaveLength(9)
    expect(screen.queryByTestId('the-board')).toBeNull()
    expect(parsed().mode).toBe('grid')
    expect(parsed().layout).toBe('3x3')
    expect(lastReceipt()).toMatch(/Switched to Multi Chart \(3×3\)/)
    await undo()
    await waitFor(() => expect(st().mode).toBe('workspace'))
    expect(st().layout).toBe('2x2')
    expect(st().cells.map(c => c.id)).toEqual(['c0', 'c1', 'c2', 'c3'])
    expect(parsed().mode).toBe('workspace')
    expect(screen.queryByTestId('the-board')).not.toBeNull()
  }, 30000)
  it('enters with no shape on the grid it had', async () => {
    onBoard()
    const { say } = mount()
    envelopes.push(plan('multiChart.enter', { layout: null }))
    await say('multi chart please')
    await waitFor(() => expect(st().mode).toBe('grid'))
    expect(st().layout).toBe('2x2')
    expect(syms()).toBe('NVDA AMD TSLA SPY')
    expect(lastReceipt()).toMatch(/Switched to Multi Chart \(2×2\)/)
  }, 30000)
  it('a custom shape lands as asked', async () => {
    onBoard()
    const { say } = mount()
    envelopes.push(plan('multiChart.enter', { layout: '1x4' }))
    await say('multi chart one row of four')
    await waitFor(() => expect(st().layout).toBe('1x4'))
    expect(st().cells).toHaveLength(4)
  }, 30000)
  it.each(['2x6', '5x2', 'x', '8 by 2', '3x'])('%s is refused, never clamped to a shape the member did not ask for', async (layout) => {
    onBoard()
    const { say } = mount()
    envelopes.push(plan('multiChart.enter', { layout }))
    await say('multi chart with that shape')
    await waitFor(() => expect(transcript()).toMatch(/go up to 4 rows by 4 columns/))
    expect(st().mode).toBe('workspace')
    expect(st().layout).toBe('2x2')
    expect(receipts()).toHaveLength(0)
    expect(H.setPref).not.toHaveBeenCalled()
  }, 30000)
  it('leaves the grid and keeps it; Undo comes back to it', async () => {
    const { say, undo } = mount()
    envelopes.push(plan('multiChart.exit', {}))
    await say('leave multi chart')
    await waitFor(() => expect(st().mode).toBe('workspace'))
    expect(screen.queryByTestId('the-board')).not.toBeNull()
    expect(syms()).toBe('NVDA AMD TSLA SPY')
    expect(parsed().mode).toBe('workspace')
    await undo()
    await waitFor(() => expect(st().mode).toBe('grid'))
    expect(parsed().mode).toBe('grid')
    expect(syms()).toBe('NVDA AMD TSLA SPY')
  }, 30000)
  it('Undo of leaving also brings back the cell that was maximized', async () => {
    const { say, undo } = mount()
    fireEvent.click(document.querySelector('[data-grid-cell-id="c1"]').querySelector('[aria-label="Maximize this chart"]'))
    await waitFor(() => expect(maxed()).toBe('c1'))
    envelopes.push(plan('multiChart.exit', {}))
    await say('leave multi chart')
    await waitFor(() => expect(st().mode).toBe('workspace'))
    await undo()
    await waitFor(() => expect(st().mode).toBe('grid'))
    await waitFor(() => expect(maxed()).toBe('c1'))
  }, 30000)
  it('a smaller shape says which tickers it dropped, and Undo brings those cells back whole', async () => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ cells: [cell('c0', 'NVDA'), cell('c1', 'AMD'), cell('c2', 'TSLA', { tf: 'W', chartType: 'hollow' }), cell('c3', 'SPY')] })) }
    const { say, undo } = mount()
    envelopes.push(plan('multiChart.enter', { layout: '1x2' }))
    await say('make the multi chart side by side')
    await waitFor(() => expect(st().layout).toBe('1x2'))
    expect(lastReceipt()).toMatch(/Changed Multi Chart to 1×2\. TSLA and SPY no longer fit/)
    expect(syms()).toBe('NVDA AMD')
    await undo()
    await waitFor(() => expect(st().layout).toBe('2x2'))
    expect(st().cells.map(c => [c.id, c.sym, c.tf, c.chartType ?? null])).toEqual([['c0', 'NVDA', 'D', null], ['c1', 'AMD', 'D', null], ['c2', 'TSLA', 'W', 'hollow'], ['c3', 'SPY', 'D', null]])
  }, 30000)
  it('already where the member asked: said, no write, no Undo', async () => {
    onBoard()
    const { say } = mount()
    envelopes.push(plan('multiChart.exit', {}))
    await say('leave multi chart')
    await waitFor(() => expect(transcript()).toMatch(/Multi Chart is already off/))
    expect(receipts()).toHaveLength(0)
    expect(H.setPref).not.toHaveBeenCalled()
  }, 30000)
  it('a mode switch never shares a plan with a chart change: the hidden side is not written', async () => {
    const { say } = mount()
    envelopes.push((b) => env('apply', [{ action: 'multiChart.exit', target: refOf(b), args: {} }, { action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } }]))
    await say('leave multi chart and make the NVDA chart weekly')
    await waitFor(() => expect(transcript()).toMatch(/do it in two steps/))
    expect(st().mode).toBe('grid')
    expect(st().cells[0].tf).toBe('D')
    expect(receipts()).toHaveLength(0)
  }, 30000)
  it('after going in, chart commands reach the cells and the hidden board is refused; after going out, the reverse', async () => {
    onBoard()
    const { say } = mount()
    envelopes.push(plan('multiChart.enter', { layout: null }))
    await say('multi chart')
    await waitFor(() => expect(st().mode).toBe('grid'))
    await say('make the top-left chart weekly')
    await waitFor(() => expect(st().cells[0].tf).toBe('W'))
    let onGrid = null, offGrid = null
    envelopes.push((b) => { onGrid = b; return plan('multiChart.exit', {})(b) })
    await say('leave multi chart')
    await waitFor(() => expect(st().mode).toBe('workspace'))
    expect(onGrid.context.board).toBeUndefined()
    expect(onGrid.context.charts[0].label).toMatch(/NVDA/)
    envelopes.push((b) => { offGrid = b; return env('answer', [], 'ok') })
    await say('tell me what you think of how my screen is set up')
    await waitFor(() => expect(offGrid).not.toBeNull())
    expect(offGrid.context.multiChart[0].on).toBe(false)
    expect(offGrid.context.multiChart[0].crosshairSync).toBeUndefined()
    expect(boardWrites.filter(w => w !== 'persist')).toEqual([])
  }, 30000)
  it('an Undo is refused when the member has moved what it would restore, and says so', async () => {
    onBoard()
    const { say, undo } = mount()
    envelopes.push(plan('multiChart.enter', { layout: null }))
    await say('multi chart')
    await waitFor(() => expect(st().mode).toBe('grid'))
    H.mc.exitGrid()
    await waitFor(() => expect(st().mode).toBe('workspace'))
    H.mc.enterGrid('3x3')
    await waitFor(() => expect(st().layout).toBe('3x3'))
    H.mc.exitGrid()
    H.mc.enterGrid('2x2')
    await waitFor(() => expect(st().mode).toBe('grid'))
    H.mc.exitGrid()
    await waitFor(() => expect(st().mode).toBe('workspace'))
    await undo()
    await waitFor(() => expect(transcript()).toMatch(/has changed since I made that change/))
    expect(st().mode).toBe('workspace')
  }, 30000)
})

describe('truthful failure: nothing is claimed without read-back', () => {
  it('a save the server refuses is put back, and only then called nothing changed', async () => {
    const { say } = mount()
    let calls = 0
    H.setPref = vi.fn(async (k, v) => { calls += 1; if (calls === 1) return false; H.prefs = { ...H.prefs, [k]: v }; return true })
    envelopes.push(plan('multiChart.exit', {}))
    await say('leave multi chart')
    await waitFor(() => expect(transcript()).toMatch(/did not confirm the change/))
    expect(transcript()).toMatch(/nothing was left changed/)
    await waitFor(() => expect(st().mode).toBe('grid'))
    expect(receipts()).toHaveLength(0)
    expect(calls).toBe(2)
    expect(parsed().mode).toBe('grid')
  }, 30000)
  it('a revert the server does not confirm either is never called "nothing was left changed"', async () => {
    const { say } = mount()
    H.setPref = vi.fn(async () => false)
    envelopes.push(plan('multiChart.exit', {}))
    await say('leave multi chart')
    await waitFor(() => expect(transcript()).toMatch(/did not confirm the change/))
    expect(transcript()).not.toMatch(/nothing was left changed/)
    expect(transcript()).toMatch(/could not be reversed/)
    expect(receipts()).toHaveLength(0)
  }, 30000)
  it('a write that never lands is reported as that', async () => {
    const { say } = mount()
    await idle()
    const real = H.mc
    const dead = { ...real, exitGrid: () => {} }
    H.mc = dead
    Object.defineProperty(H, 'mc', { get: () => dead, set: () => {}, configurable: true })
    envelopes.push(plan('multiChart.exit', {}))
    await say('leave multi chart')
    await waitFor(() => expect(transcript()).toMatch(/did not take effect/), { timeout: 9000 })
    Object.defineProperty(H, 'mc', { value: real, writable: true, configurable: true })
    expect(receipts()).toHaveLength(0)
  }, 30000)
})

describe('options', () => {
  it('crosshair sync reaches the charts, is saved, and Undo takes it off', async () => {
    const { say, undo } = mount()
    envelopes.push(plan('multiChart.setOption', { option: 'crosshair_sync', on: true }))
    await say('sync the crosshairs')
    await waitFor(() => expect(st().syncCrosshair).toBe(true))
    expect(parsed().syncCrosshair).toBe(true)
    expect(lastReceipt()).toMatch(/Crosshair sync on/)
    await undo()
    await waitFor(() => expect(st().syncCrosshair).toBe(false))
    expect(parsed().syncCrosshair).toBe(false)
  }, 30000)
  it('two options in one request are one change with one Undo', async () => {
    const { say, undo } = mount()
    envelopes.push(plans(['multiChart.setOption', { option: 'crosshair_sync', on: true }], ['multiChart.setOption', { option: 'time_range_sync', on: true }]))
    await say('sync crosshair and time range')
    await waitFor(() => expect(st().syncTimeRange && st().syncCrosshair).toBe(true))
    expect(receipts()).toHaveLength(1)
    await undo()
    await waitFor(() => expect(st().syncCrosshair || st().syncTimeRange).toBe(false))
  }, 30000)
  it('on: null flips what is there, read at plan time', async () => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ syncTimeRange: true })) }
    const { say } = mount()
    envelopes.push(plan('multiChart.setOption', { option: 'time_range_sync', on: null }))
    await say('toggle time range sync')
    await waitFor(() => expect(st().syncTimeRange).toBe(false))
    expect(lastReceipt()).toMatch(/Time-range sync off/)
  }, 30000)
  it('already on: said, no Undo offered for nothing', async () => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ syncCrosshair: true })) }
    const { say } = mount()
    envelopes.push(plan('multiChart.setOption', { option: 'crosshair_sync', on: true }))
    await say('sync the crosshairs')
    await waitFor(() => expect(transcript()).toMatch(/Crosshair sync is already on/))
    expect(receipts()).toHaveLength(0)
  }, 30000)
  it.each([['symbol_sync', /no symbol sync/], ['timeframe_sync', /no timeframe sync/]])('%s does not exist in the product, and the member is told', async (option, said) => {
    const { say } = mount()
    envelopes.push(plan('multiChart.setOption', { option, on: true }))
    await say('sync the option across all charts')
    await waitFor(() => expect(transcript()).toMatch(said))
    expect(receipts()).toHaveLength(0)
    expect(H.setPref).not.toHaveBeenCalled()
  }, 30000)
  it('set off screen: done, and the receipt says when it applies', async () => {
    onBoard()
    const { say } = mount()
    envelopes.push(plan('multiChart.setOption', { option: 'time_range_sync', on: true }))
    await say('sync the time range')
    await waitFor(() => expect(st().syncTimeRange).toBe(true))
    expect(st().mode).toBe('workspace')
    expect(lastReceipt()).toMatch(/applies when Multi Chart is on/)
  }, 30000)
  it('Groups off clears the group and keeps the charts; Undo brings the group back', async () => {
    const group = { id: 'semis', name: 'Semiconductors', by: 'today' }
    H.prefs = { multichart_state: JSON.stringify(GRID({ groupsMode: true, group })) }
    const { say, undo } = mount()
    envelopes.push(plan('multiChart.setOption', { option: 'groups_mode', on: false }))
    await say('exit groups')
    await waitFor(() => expect(st().groupsMode).toBe(false))
    expect(st().group).toBe(null)
    expect(syms()).toBe('NVDA AMD TSLA SPY')
    expect(lastReceipt()).toMatch(/Semiconductors cleared, the charts stay/)
    await undo()
    await waitFor(() => expect(st().groupsMode).toBe(true))
    expect(st().group?.id).toBe('semis')
  }, 30000)
  it('Undo restores only what its change touched: a later cell edit survives it', async () => {
    const { say, undo } = mount()
    envelopes.push(plan('multiChart.setOption', { option: 'crosshair_sync', on: true }))
    await say('sync the crosshairs')
    await waitFor(() => expect(st().syncCrosshair).toBe(true))
    H.mc.updateCellAt(1, { ...st().cells[1], tf: 'W' })
    await waitFor(() => expect(st().cells[1].tf).toBe('W'))
    await undo()
    await waitFor(() => expect(st().syncCrosshair).toBe(false))
    expect(st().cells[1].tf).toBe('W')
  }, 30000)
  it('"maximized" only restores: a cell to maximize has to be named, and off the grid there is nothing to restore', async () => {
    const { say } = mount()
    envelopes.push(plan('multiChart.setOption', { option: 'maximized', on: true }))
    await say('maximize')
    await waitFor(() => expect(transcript()).toMatch(/name the cell to maximize/))
    envelopes.push(plan('multiChart.exit', {}))
    await say('leave multi chart')
    await waitFor(() => expect(st().mode).toBe('workspace'))
    envelopes.push(plan('multiChart.setOption', { option: 'maximized', on: false }))
    await say('restore the grid')
    await waitFor(() => expect(transcript()).toMatch(/only exists inside Multi Chart/))
  }, 30000)
})

describe('one cell: a click never stands in for a described chart', () => {
  it('a named cell maximizes, the click elsewhere does not matter; Undo restores', async () => {
    const { say, undo } = mount()
    click('c0')
    envelopes.push(onCell('maximize', 1))
    await say('maximize the AMD chart')
    await waitFor(() => expect(maxed()).toBe('c1'))
    expect(lastReceipt()).toMatch(/Maximized .*AMD/)
    await undo()
    await waitFor(() => expect(maxed()).toBe(null))
  }, 30000)
  it.each([
    ['maximize the AMD chart', 'maximize'],
    ['maximize AMD', 'maximize'],
    ['blow up the top right one', 'maximize'],
    ['blow up the top-right chart', 'maximize'],
    ['maximize chart 2', 'maximize'],
    ['reset the AMD cell chart', 'reset'],
    ['reset AMD to my chart', 'reset'],
  ])('"%s" with NVDA clicked and a plan aimed at the click: asked, nothing runs', async (text, action) => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ cells: [cell('c0', 'NVDA', { settings: { a: 1 } }), cell('c1', 'AMD', { settings: { b: 2 } }), cell('c2', 'TSLA'), cell('c3', 'SPY')] })) }
    const { say } = mount()
    click('c0')
    envelopes.push(onCell(action, 0))
    await say(text)
    await waitFor(() => expect(transcript()).toMatch(/Did you mean .*AMD|Which chart/))
    expect(maxed()).toBe(null)
    expect(st().cells[0].settings).toEqual({ a: 1 })
    expect(receipts()).toHaveLength(0)
  }, 30000)
  it('the answer to that question acts on the chart picked', async () => {
    const { say } = mount()
    click('c0')
    envelopes.push(onCell('maximize', 0))
    await say('maximize the AMD chart')
    await waitFor(() => expect(transcript()).toMatch(/Did you mean/))
    fireEvent.click(screen.getByRole('button', { name: /AMD/ }))
    await waitFor(() => expect(maxed()).toBe('c1'))
  }, 30000)
  it('"this chart" with a click is the click', async () => {
    const { say } = mount()
    click('c2')
    envelopes.push(onCell('maximize', 2))
    await say('maximize this chart')
    await waitFor(() => expect(maxed()).toBe('c2'))
  }, 30000)
  it('no click and no description: asked, never guessed', async () => {
    const { say } = mount()
    envelopes.push(onCell('maximize', 3))
    await say('maximize it')
    await waitFor(() => expect(transcript()).toMatch(/Which chart/))
    expect(maxed()).toBe(null)
  }, 30000)
  it('the hidden board\'s selected chart is not a cell', async () => {
    onBoard()
    const { say } = mount()
    envelopes.push(() => env('apply', [{ action: 'multiChart.cell', target: 'board1', args: { do: 'maximize' } }]))
    await say('maximize this chart')
    await waitFor(() => expect(transcript()).toMatch(/not on the workspace/))
    expect(boardWrites).toEqual([])
    expect(st().mode).toBe('workspace')
  }, 30000)
  it('a cell behind the maximized one is refused', async () => {
    const { say } = mount()
    fireEvent.click(document.querySelector('[data-grid-cell-id="c1"]').querySelector('[aria-label="Maximize this chart"]'))
    await waitFor(() => expect(maxed()).toBe('c1'))
    envelopes.push(onCell('maximize', 2))
    await say('maximize the TSLA chart')
    await waitFor(() => expect(transcript()).toMatch(/hidden behind the maximized one/))
    expect(maxed()).toBe('c1')
  }, 30000)
  it('restores the grid, and Undo maximizes the same cell again', async () => {
    const { say, undo } = mount()
    fireEvent.click(document.querySelector('[data-grid-cell-id="c1"]').querySelector('[aria-label="Maximize this chart"]'))
    await waitFor(() => expect(maxed()).toBe('c1'))
    envelopes.push(plan('multiChart.setOption', { option: 'maximized', on: false }))
    await say('restore the grid')
    await waitFor(() => expect(maxed()).toBe(null))
    await undo()
    await waitFor(() => expect(maxed()).toBe('c1'))
  }, 30000)
  it('a forked cell resets to the member\'s chart, ticker and pick kept; Undo puts its settings back', async () => {
    const own = { chartType: 'line', upColor: '#123456' }
    H.prefs = { multichart_state: JSON.stringify(GRID({ cells: [cell('c0', 'NVDA', { chartType: 'hollow', settings: own }), cell('c1', 'AMD'), cell('c2', 'TSLA'), cell('c3', 'SPY')] })) }
    const { say, undo } = mount()
    envelopes.push(onCell('reset', 0))
    await say('reset the NVDA chart to my chart')
    await waitFor(() => expect(st().cells[0].settings ?? null).toBe(null))
    expect(st().cells[0].chartType).toBe('hollow')
    await waitFor(() => expect(parsed().cells[0].settings ?? null).toBe(null))
    await undo()
    await waitFor(() => expect(st().cells[0].settings).toEqual(own))
    expect(st().cells[0].chartType).toBe('hollow')
  }, 30000)
})

describe('groups', () => {
  it('loads a group by name from the board: Multi Chart and Groups on, ETF first; Undo puts all of it back', async () => {
    onBoard()
    const { say, undo } = mount()
    envelopes.push(plan('multiChart.loadGroup', { group: 'semiconductors', step: null }))
    await say('load semiconductors into the grid')
    await waitFor(() => expect(st().group?.id).toBe('semis'))
    expect(st().mode).toBe('grid')
    expect(st().groupsMode).toBe(true)
    expect(st().cells.slice(0, 4).map(c => c.sym)).toEqual(['SMH', 'AMD', 'NVDA', 'AVGO'])
    expect(parsed().group.id).toBe('semis')
    expect(lastReceipt()).toMatch(/Loaded Semiconductors: SMH, AMD, NVDA and AVGO/)
    await undo()
    await waitFor(() => expect(st().mode).toBe('workspace'))
    expect(st().group).toBe(null)
    expect(st().groupsMode).toBe(false)
    expect(syms()).toBe('NVDA AMD TSLA SPY')
    expect(st().cells.map(c => c.id)).toEqual(['c0', 'c1', 'c2', 'c3'])
  }, 30000)
  it('words that fit several groups are never guessed', async () => {
    const { say } = mount()
    envelopes.push(plan('multiChart.loadGroup', { group: 's', step: null }))
    await say('load the s group into the grid')
    await waitFor(() => expect(transcript()).toMatch(/several groups fit/))
    expect(syms()).toBe('NVDA AMD TSLA SPY')
    expect(receipts()).toHaveLength(0)
  }, 30000)
  it('a group that does not exist is said', async () => {
    const { say } = mount()
    envelopes.push(plan('multiChart.loadGroup', { group: 'Cannabis', step: null }))
    await say('load cannabis into the grid')
    await waitFor(() => expect(transcript()).toMatch(/no group called/))
    expect(syms()).toBe('NVDA AMD TSLA SPY')
  }, 30000)
  it('a group with nothing to chart leaves the grid as it was, and says so', async () => {
    const { say } = mount()
    envelopes.push(plan('multiChart.loadGroup', { group: 'Solar', step: null }))
    await say('load solar into the grid')
    await waitFor(() => expect(transcript()).toMatch(/Solar has no chartable names/))
    expect(syms()).toBe('NVDA AMD TSLA SPY')
    expect(st().groupsMode).toBeFalsy()
    expect(receipts()).toHaveLength(0)
  }, 30000)
  it.each([['next', 'Software', 'MSFT'], ['previous', 'Solar', null]])('steps to the %s group from the one loaded', async (step, name, first) => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ groupsMode: true, group: { id: 'semis', name: 'Semiconductors', by: 'today' } })) }
    const { say } = mount()
    envelopes.push(plan('multiChart.loadGroup', { group: null, step }))
    await say(`${step} group`)
    if (first) {
      await waitFor(() => expect(st().group?.name).toBe(name))
      expect(st().cells[0].sym).toBe(first)
    } else {
      await waitFor(() => expect(transcript()).toMatch(/Solar has no chartable names/))
      expect(st().group.id).toBe('semis')
    }
  }, 30000)
  it('refresh re-reads the group loaded', async () => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ groupsMode: true, group: { id: 'space', name: 'Space Economy', by: 'today' } })) }
    const { say } = mount()
    envelopes.push(plan('multiChart.loadGroup', { group: null, step: 'refresh' }))
    await say('refresh this group')
    await waitFor(() => expect(syms()).toBe('RKLB ASTS LUNR PL'))
    expect(lastReceipt()).toMatch(/Refreshed Space Economy/)
  }, 30000)
  it('next with no group loaded asks for one', async () => {
    const { say } = mount()
    envelopes.push(plan('multiChart.loadGroup', { group: null, step: 'next' }))
    await say('next group')
    await waitFor(() => expect(transcript()).toMatch(/no group loaded/))
  }, 30000)
  it('neither a group nor a step: refused, not guessed', async () => {
    const { say } = mount()
    envelopes.push(plan('multiChart.loadGroup', { group: null, step: null }))
    await say('load a group into the grid')
    await waitFor(() => expect(transcript()).toMatch(/name one group/))
    expect(receipts()).toHaveLength(0)
  }, 30000)
})

describe('saved grids', () => {
  const tpl = (id, name, syms2) => ({ id, name, layout: { kind: 'multichart', widgets: [], layout: '1x2', cells: syms2.map(sym => ({ sym, tf: 'W' })), group: null } })
  it('opens one, and Undo puts the grid and mode back', async () => {
    onBoard()
    H.mine = [tpl('t1', 'Leaders', ['MSFT', 'AAPL'])]
    const { say, undo } = mount()
    envelopes.push(plan('multiChart.openSaved', { name: 'leaders' }))
    await say('open my leaders grid')
    await waitFor(() => expect(syms()).toBe('MSFT AAPL'))
    expect(st().mode).toBe('grid')
    expect(st().layout).toBe('1x2')
    expect(lastReceipt()).toMatch(/Opened the saved grid “Leaders” \(1×2\)/)
    await undo()
    await waitFor(() => expect(st().mode).toBe('workspace'))
    expect(st().layout).toBe('2x2')
    expect(st().cells.map(c => c.id)).toEqual(['c0', 'c1', 'c2', 'c3'])
  }, 30000)
  it('words that fit two saved grids are asked about', async () => {
    H.mine = [tpl('t1', 'Semis A', ['AMD']), tpl('t2', 'Semis B', ['NVDA'])]
    const { say } = mount()
    envelopes.push(plan('multiChart.openSaved', { name: 'semis' }))
    await say('open my semis grid')
    await waitFor(() => expect(transcript()).toMatch(/several saved grids fit/))
    expect(syms()).toBe('NVDA AMD TSLA SPY')
  }, 30000)
  it('saves the grid through the menu\'s payload, create-only, and Undo deletes it', async () => {
    const { say, undo } = mount()
    envelopes.push(plan('multiChart.saveGrid', { name: 'Tonight' }, 'Saved grids'))
    await say('save this grid as Tonight')
    await waitFor(() => expect(receipts()).toHaveLength(1))
    const call = H.saveLayout.mock.calls[0][0]
    expect(call).toMatchObject({ name: 'Tonight', scope: 'user', createOnly: true, groups: null })
    expect(call.layout).toMatchObject({ kind: 'multichart', widgets: [], layout: '2x2', group: null })
    expect(call.layout.cells.map(c => c.sym)).toEqual(['NVDA', 'AMD', 'TSLA', 'SPY'])
    await undo()
    await waitFor(() => expect(H.deleteLayout).toHaveBeenCalledWith('t1'))
    expect(H.mine).toEqual([])
  }, 30000)
  it('a name already taken is refused: a saved grid is never overwritten', async () => {
    H.mine = [tpl('t1', 'Leaders', ['MSFT'])]
    const { say } = mount()
    envelopes.push(plan('multiChart.saveGrid', { name: 'LEADERS' }, 'Saved grids'))
    await say('save this grid as LEADERS')
    await waitFor(() => expect(transcript()).toMatch(/already have a saved grid/))
    expect(H.saveLayout).not.toHaveBeenCalled()
  }, 30000)
  it('a save the server refuses is reported, with no receipt', async () => {
    H.saveLayout = vi.fn(async () => { throw new Error('Save failed') })
    const { say } = mount()
    envelopes.push(plan('multiChart.saveGrid', { name: 'Nope' }, 'Saved grids'))
    await say('save this grid as Nope')
    await waitFor(() => expect(transcript()).toMatch(/Save failed/))
    expect(receipts()).toHaveLength(0)
  }, 30000)
  it('off the grid there is nothing to save', async () => {
    onBoard()
    H.mine = [tpl('t1', 'Leaders', ['MSFT'])]
    const { say } = mount()
    envelopes.push(plan('multiChart.saveGrid', { name: 'Fresh' }, 'Saved grids'))
    await say('save this grid as Fresh')
    await waitFor(() => expect(transcript()).toMatch(/no grid on screen/))
    expect(H.saveLayout).not.toHaveBeenCalled()
  }, 30000)
  it('deleting waits for Apply, then says plainly there is no Undo', async () => {
    H.mine = [tpl('t1', 'Leaders', ['MSFT'])]
    const { say } = mount()
    envelopes.push(plan('multiChart.deleteSaved', { name: 'Leaders' }, 'Saved grids'))
    await say('delete my leaders grid')
    await waitFor(() => expect(transcript()).toMatch(/Delete/))
    expect(H.deleteLayout).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }))
    await waitFor(() => expect(H.deleteLayout).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(transcript()).toMatch(/cannot be brought back/))
  }, 30000)
  it('a prebuilt grid is not the member\'s to delete', async () => {
    H.global = [tpl('g1', 'House Grid', ['SPY'])]
    const { say } = mount()
    envelopes.push(plan('multiChart.deleteSaved', { name: 'House Grid' }, 'Saved grids'))
    await say('delete the house grid')
    await waitFor(() => expect(transcript()).toMatch(/no saved grid called/))
    expect(H.deleteLayout).not.toHaveBeenCalled()
  }, 30000)
})

describe('what the model is told', () => {
  it('off screen it gets the mode and shape; on screen the options; never a cell\'s settings or a group\'s internals', async () => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ syncCrosshair: true, groupsMode: true,
      group: { id: 'semis', name: 'Semiconductors', sources: { AMD: 'engine' }, alsoIn: [{ id: 'x', name: 'Hidden Y' }] },
      cells: [cell('c0', 'NVDA', { settings: { secretField: 1 } }), cell('c1', 'AMD'), cell('c2', 'TSLA'), cell('c3', 'SPY')] })) }
    const { say } = mount()
    let body = null
    envelopes.push((b) => { body = b; return env('answer', [], 'ok') })
    await say('how does this look to you today')
    await waitFor(() => expect(body).not.toBeNull())
    const entry = body.context.multiChart[0]
    expect(entry).toMatchObject({ on: true, layout: '2×2', crosshairSync: true, groupsMode: true, group: 'Semiconductors' })
    expect(entry.timeRangeSync).toBeUndefined()
    const text = JSON.stringify(body.context.multiChart)
    for (const hidden of ['secretField', 'sources', 'alsoIn', 'Hidden Y', 'presentation', 'cells', 'hydrated']) expect(text).not.toContain(hidden)
  }, 30000)
  it('exactLayout accepts what rows × columns allows and nothing else', () => {
    expect(exactLayout('4x4').id).toBe('4x4')
    expect(exactLayout('2 × 3').id).toBe('2x3')
    expect(exactLayout('3 by 2').id).toBe('3x2')
    for (const bad of ['5x1', '1x5', '0x2', '2x0', '', null, 'big', '2x2x2']) expect(exactLayout(bad)).toBe(null)
  })
})
