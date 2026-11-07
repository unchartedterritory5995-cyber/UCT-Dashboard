// ⭐ UCT Agent in MULTI CHART. Through the REAL panel (AgentPanel + useAgent + planner, policy, runtime, receipts, Undo), the
// REAL grid (MultiChartGrid + GridChartCell + useMultiChartState over the multichart_state pref) and the REAL workspace host
// (buildWorkspaceHost over the chart registry). Stand-ins: the canvas (StockChart), the model (/api/agent/turn, scripted, no
// paid call). Each test reads the outcome back from the grid's own state, or the drawing store.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useMemo } from 'react'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'

const H = vi.hoisted(() => ({ prefs: {}, setPref: null, api: null, mc: null, nav: null, chartProps: {}, session: 'closed' }))

vi.mock('../hooks/usePreferences', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, default: () => ({ prefs: H.prefs, setPref: H.setPref, loading: false }) }
})
vi.mock('../utils/extSession', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, getExtSessionCached: () => ({ session: H.session }) }
})
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, useSearchParams: () => [new URLSearchParams()] }
})
vi.mock('../pages/charts/WorkspaceContext', () => ({ useWorkspace: () => ({ chartsTheme: null, chartApiById: H.api }) }))
vi.mock('../components/StockChart', () => ({
  default: (props) => {
    if (H.crashOn && props.tf === H.crashOn) throw new Error('boom: a chart that cannot draw this')
    H.chartProps[props.chartId] = props
    props.onDateNavApi?.(H.nav)
    return <div data-testid={`canvas-${props.chartId}`}>{props.sym}</div>
  },
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
import { buildWorkspaceHost, buildCellSync, gridPositionWord, scopeHostToGrid } from './host'
import { watchGridSync, screenGridOps, GRID_BOARD_REFUSAL, GRID_HIDDEN_REFUSAL } from './gridMode'
import { cellPatch, cellStored, gridCellKey } from '../pages/charts/grid/gridAgentAdapter'
import { peekDrawings, removeDrawing } from '../components/chart/drawingsStore'
import { guideState, endGuide } from './guide/guideStore'
import { asSubjectWords } from './useAgent'
import { noteChartFault } from '../pages/charts/chartFaults'

registerBuiltins()

const cell = (id, sym, extra = {}) => ({ id, sym, tf: 'D', ...extra })
const GRID = (over = {}) => ({
  mode: 'grid', layout: '2x2',
  cells: [cell('c0', 'NVDA'), cell('c1', 'AMD'), cell('c2', 'TSLA'), cell('c3', null)],
  ...over,
})

let envelopes, boardAdds
const env = (disposition, ops, reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
beforeEach(() => {
  envelopes = []; boardAdds = []
  H.prefs = { multichart_state: JSON.stringify(GRID()) }
  H.setPref = vi.fn(async (k, v) => { H.prefs = { ...H.prefs, [k]: v }; return true })
  H.api = { current: new Map() }
  H.nav = { getDateMeta: () => ({ firstMs: Date.UTC(2020, 0, 1), lastMs: Date.UTC(2026, 0, 1), rightMs: Date.UTC(2026, 0, 1) }), goToDate: vi.fn() }
  H.chartProps = {}
  H.session = 'closed'
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const body = init.body ? JSON.parse(init.body) : null
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/turn') { const e = envelopes.shift(); return json({ conversationId: 'ac_1', envelope: typeof e === 'function' ? e(body) : e, usage: { research_calls: 0, citations: 0 } }) }
    if (u === '/api/agent/record') return json({ conversationId: 'ac_1' })
    const q = /ticker-search\?q=([^&]+)/.exec(u)
    if (q) return json({ results: [{ ticker: decodeURIComponent(q[1]).toUpperCase() }] })
    if (u.includes('keys=multichart_state')) return json({ multichart_state: H.prefs.multichart_state })
    if (u.startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => {
  for (const s of ['NVDA', 'AMD', 'TSLA']) for (const d of [...peekDrawings(s)]) removeDrawing(s, d.id)
  if (guideState()) endGuide('done')
  vi.restoreAllMocks(); cleanup()
})

const BOARD = [{ id: 'hidden1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'A', opts: {} }]
// useTracingsSync is the workspace's own (ChartsWorkspace), mounted above the grid; its server round trip is not this test's
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
  return (
    <>
      <MultiChartGrid mc={mc} />
      <AgentPanel host={host} gridMode surface="charts" onClose={() => {}} />
    </>
  )
}
function mount() {
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><Stage /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle() }
  return { say, undo: () => say('undo') }
}
// a model plan for the n-th cell (the context's own short refs)
const plan = (action, args, n = 0) => (b) => env('apply', [{ action, target: b.context.charts[n].ref, args }])
const planDrawing = (args, sym) => (b) => env('apply', [{ action: 'drawing.addLevel', target: b.context.drawings.find(d => d.symbol === sym).ref, args }])
const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const receipts = () => screen.queryAllByTestId('agent-receipt')
const cells = () => H.mc.state.cells
const at = (id) => cells().find(c => c.id === id)
const tfs = () => cells().map(c => c.tf).join('')
const click = (id) => fireEvent.pointerDown(document.querySelector(`[data-grid-cell-id="${id}"]`).parentElement)
const instances = (id) => (at(id).settings?.indicatorInstances || []).filter(i => !i.deleted)

describe('Multi Chart: the Agent starts here at all', () => {
  it('a chart command runs (it used to be refused outright), on the cell named, and on no other', async () => {
    const { say } = mount()
    await say('make the top-left chart weekly')
    await waitFor(() => expect(receipts()).toHaveLength(1))
    expect(tfs()).toBe('WDDD')
    expect(transcript()).not.toMatch(/Switch out of Multi Chart/)
  }, 30000)
  it('the model is told about the cells, not the hidden board', async () => {
    const { say } = mount()
    let body = null
    envelopes.push((b) => { body = b; return env('answer', [], 'ok') })
    await say('why does this grid look so busy to you today my friend')
    await waitFor(() => expect(body).not.toBeNull())
    expect(body.context.charts.map(c => c.label)).toEqual(['Top-left chart (NVDA)', 'Top-right chart (AMD)', 'Bottom-left chart (TSLA)', 'Bottom-right chart (empty)'])
    expect(body.context.charts.every(c => c.linkedWidgets === 0)).toBe(true)
    expect(body.context.board).toBeUndefined()
    expect(body.context.workspace).toBeUndefined()
  }, 30000)
})

describe('Multi Chart: which chart', () => {
  it('"this chart" with no click asks, and changes nothing', async () => {
    const { say } = mount()
    await say('make this chart weekly')
    await waitFor(() => expect(transcript()).toMatch(/Which chart/))
    expect(tfs()).toBe('DDDD')
  }, 30000)
  it('a bare command with no click asks too', async () => {
    const { say } = mount()
    await say('switch to weekly')
    await waitFor(() => expect(transcript()).toMatch(/Which chart/))
    expect(tfs()).toBe('DDDD')
  }, 30000)
  it('a click selects; a hover never does (the pointer crosses the grid on its way to the panel)', async () => {
    const { say } = mount()
    click('c2')
    fireEvent.pointerEnter(document.querySelector('[data-grid-cell-id="c1"]').parentElement)
    await say('make this chart weekly')
    await waitFor(() => expect(receipts()).toHaveLength(1))
    expect(tfs()).toBe('DDWD')
  }, 30000)
  it('the hidden board\'s selected chart is not "this chart" here', async () => {
    const { say } = mount()
    await say('hide the volume on this chart')
    await waitFor(() => expect(transcript()).toMatch(/Which chart/))
    expect(receipts()).toHaveLength(0)
  }, 30000)
  it('a maximized cell is the chart in front of the member', async () => {
    const { say } = mount()
    fireEvent.click(document.querySelector('[data-grid-cell-id="c1"]').querySelector('[aria-label="Maximize this chart"]'))
    await say('make this chart weekly')
    await waitFor(() => expect(receipts()).toHaveLength(1))
    expect(tfs()).toBe('DWDD')
  }, 30000)
  it('"chart 3" counts in reading order', async () => {
    const { say } = mount()
    await say('make chart 3 weekly')
    await waitFor(() => expect(receipts()).toHaveLength(1))
    expect(tfs()).toBe('DDWD')
  }, 30000)
  it('"the top chart" fits two cells: asked, never guessed', async () => {
    const { say } = mount()
    await say('make the top chart weekly')
    await waitFor(() => expect(transcript()).toMatch(/top|Which/i))
    expect(tfs()).toBe('DDDD')
  }, 30000)
  it('"the one I just changed" follows the member\'s own change in a cell, not only the Agent\'s', async () => {
    const { say } = mount()
    await say('make the top-right chart weekly')
    await waitFor(() => expect(receipts()).toHaveLength(1))
    expect(tfs()).toBe('DWDD')
    // the member then changes the bottom-left cell by hand, on its own timeframe bar
    const bar = document.querySelector('[data-grid-cell-id="c2"] [data-guide="chart.timeframe"]')
    act(() => { fireEvent.click([...bar.querySelectorAll('button')].find(b => b.textContent === '1M')) })
    expect(at('c2').tf).toBe('M')
    await say('make the one I just changed daily')
    await waitFor(() => expect(at('c2').tf).toBe('D'))
    expect(at('c1').tf).toBe('W')
  }, 30000)
  it('"the one you just changed" beats the clicked chart: they are different cells, and the words name one', async () => {
    const { say } = mount()
    click('c0')
    await say('make the top-right chart weekly')
    await waitFor(() => expect(tfs()).toBe('DWDD'))
    await say('make the one you just changed daily')
    await waitFor(() => expect(tfs()).toBe('DDDD'))
  }, 30000)
  it('"you" is the Agent\'s last change and "I" the member\'s, each with the other\'s change more recent', async () => {
    const hand = (id) => {
      const bar = document.querySelector(`[data-grid-cell-id="${id}"] [data-guide="chart.timeframe"]`)
      act(() => { fireEvent.click([...bar.querySelectorAll('button')].find(b => b.textContent === '1M')) })
    }
    const { say } = mount()
    hand('c2')
    await say('make the top-right chart weekly')
    await waitFor(() => expect(at('c1').tf).toBe('W'))
    await say('make the one I just changed daily')          // the Agent acted last; "I" is still the member's cell
    await waitFor(() => expect(at('c2').tf).toBe('D'))
    expect(at('c1').tf).toBe('W')
    hand('c0')
    await say('make the one you just changed weekly')       // the member acted last; "you" is still the Agent's: c2, its last
    await waitFor(() => expect(at('c2').tf).toBe('W'))
    expect(at('c0').tf).toBe('M')
    expect(at('c1').tf).toBe('W')
  }, 30000)
  it('"the one you just changed" with only a member\'s change is asked, never guessed', async () => {
    const { say } = mount()
    const bar = document.querySelector('[data-grid-cell-id="c2"] [data-guide="chart.timeframe"]')
    act(() => { fireEvent.click([...bar.querySelectorAll('button')].find(b => b.textContent === '1M')) })
    envelopes.push(plan('chart.setTimeframe', { timeframe: 'W' }, 2))
    await say('make the one you just changed weekly')
    await waitFor(() => expect(transcript()).toMatch(/Which chart/))
    expect(tfs()).toBe('DDMD')
  }, 30000)
  // the browser's own order: a real click on a cell's control presses inside the cell first, which also selects that cell
  const realClick = (el) => { fireEvent.pointerDown(el); fireEvent.mouseDown(el); fireEvent.pointerUp(el); fireEvent.mouseUp(el); fireEvent.click(el) }
  const handReal = (id) => {
    const bar = document.querySelector(`[data-grid-cell-id="${id}"] [data-guide="chart.timeframe"]`)
    act(() => { realClick([...bar.querySelectorAll('button')].find(b => b.textContent === '1M')) })
  }
  it('"the one you just changed" with only a real click by the member is asked: the click selected that cell, the words did not name it', async () => {
    const { say } = mount()
    handReal('c2')
    expect(at('c2').tf).toBe('M')
    envelopes.push(plan('chart.setTimeframe', { timeframe: 'W' }, 2))
    await say('make the one you just changed weekly')
    await waitFor(() => expect(transcript()).toMatch(/Which chart/))
    expect(tfs()).toBe('DDMD')
    expect(receipts()).toHaveLength(0)
  }, 30000)
  it('...and the same when the model reads those words: its plan on the clicked cell is asked about, never run', async () => {
    const { say } = mount()
    handReal('c2')
    envelopes.push(plan('chart.setType', { type: 'bars' }, 2))
    await say('turn the one you just changed into plain bars for me please')
    await waitFor(() => expect(transcript()).toMatch(/Which chart/))
    expect(at('c2').settings).toBeUndefined()
    expect(receipts()).toHaveLength(0)
  }, 30000)
  it('"the one I just changed" with nothing changed and a clicked cell is asked too', async () => {
    const { say } = mount()
    click('c1')
    envelopes.push(plan('chart.setTimeframe', { timeframe: 'W' }, 1))
    await say('make the one I just changed weekly')
    await waitFor(() => expect(transcript()).toMatch(/Which chart/))
    expect(tfs()).toBe('DDDD')
  }, 30000)
  it('a several-part request naming the one you just changed is not run on the clicked cell either', async () => {
    const { say } = mount()
    handReal('c2')
    envelopes.push(plan('chart.setTimeframe', { timeframe: 'W' }, 2))
    await say('make the one you just changed weekly and switch it to bars')
    await waitFor(() => expect(transcript()).toMatch(/Which chart/))
    expect(tfs()).toBe('DDMD')
  }, 30000)
  it('the answer to that question runs on the picked cell', async () => {
    const { say } = mount()
    handReal('c2')
    envelopes.push(plan('chart.setTimeframe', { timeframe: 'W' }, 2))
    await say('make the one you just changed weekly')
    await waitFor(() => expect(transcript()).toMatch(/Which chart/))
    const pick = [...document.querySelectorAll('button')].filter(b => /AMD|top-right/i.test(b.textContent)).at(-1)
    act(() => { fireEvent.click(pick) })
    await waitFor(() => expect(tfs()).toBe('DWMD'))
  }, 30000)
  it('a model plan aimed at the clicked chart when the words name the one just changed is asked, not run', async () => {
    const { say } = mount()
    click('c0')
    await say('make the top-right chart weekly')
    await waitFor(() => expect(tfs()).toBe('DWDD'))
    envelopes.push(plan('chart.setType', { type: 'bars' }, 0))
    await say('turn the one you just changed into plain bars for me please')
    await waitFor(() => expect(transcript()).toMatch(/Which chart do you mean/))
    expect(at('c0').settings).toBeUndefined()
  }, 30000)
  it('"the one I just changed" with nothing changed is asked, never guessed', async () => {
    const { say } = mount()
    envelopes.push((b) => env('apply', [{ action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } }]))
    await say('make the one I just changed weekly')
    await waitFor(() => expect(transcript()).toMatch(/Which chart/))
    expect(tfs()).toBe('DDDD')
  }, 30000)
  it('position words name every cell they can, and leave the rest to their number', () => {
    expect([0, 1, 2, 3].map(i => gridPositionWord(i, 2, 2))).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
    expect([0, 1, 2].map(i => gridPositionWord(i, 1, 3))).toEqual(['left', 'middle', 'right'])
    expect([0, 4].map(i => gridPositionWord(i, 3, 3))).toEqual(['top-left', 'middle-middle'])
    expect([0, 5, 15].map(i => gridPositionWord(i, 4, 4))).toEqual(['top-left', '', 'bottom-right'])
  })
})

describe('Multi Chart: chart commands, on the cell\'s own writer, with Undo', () => {
  it('timeframe: Undo puts it back, and the board reached the server', async () => {
    const { say, undo } = mount()
    await say('make the bottom-left chart weekly')
    await waitFor(() => expect(receipts()).toHaveLength(1))
    await waitFor(() => expect(JSON.parse(H.prefs.multichart_state).cells[2].tf).toBe('W'))
    await undo()
    await waitFor(() => expect(tfs()).toBe('DDDD'))
  }, 30000)
  it('ticker: fills the empty cell only; no link group carries it anywhere else; Undo empties it', async () => {
    const { say, undo } = mount()
    await say('show MSFT on the bottom-right chart')
    await waitFor(() => expect(at('c3').sym).toBe('MSFT'))
    expect(cells().map(c => c.sym)).toEqual(['NVDA', 'AMD', 'TSLA', 'MSFT'])
    await undo()
    await waitFor(() => expect(at('c3').sym).toBe(null))
  }, 30000)
  it('settings fork this cell only (policy A): nothing reaches the global chart_settings, Undo drops the fork', async () => {
    const { say, undo } = mount()
    envelopes.push(plan('chart.setScale', { scale: 'log' }, 0))
    await say('use a log scale on the top-left chart for me please')
    await waitFor(() => expect(receipts()).toHaveLength(1))
    expect(at('c0').settings?.logScale).toBe(true)
    expect(at('c1').settings).toBeUndefined()
    expect(H.setPref.mock.calls.some(([k]) => k === 'chart_settings')).toBe(false)
    await undo()
    await waitFor(() => expect(at('c0').settings).toBeUndefined())
  }, 30000)
  it('a type change on a cell with its own Style pick moves the pick (it would win), and Undo puts the pick back', async () => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ cells: [cell('c0', 'NVDA', { chartType: 'hollow' }), cell('c1', 'AMD'), cell('c2', 'TSLA'), cell('c3', null)] })) }
    const { say, undo } = mount()
    envelopes.push(plan('chart.setType', { type: 'bars' }, 0))
    await say('turn the top-left chart into plain bars for me please')
    await waitFor(() => expect(receipts()).toHaveLength(1))
    expect(at('c0').chartType).toBe('bars')
    await waitFor(() => expect(H.chartProps.c0.settingsOverride?.chartType).toBe('bars'))
    await undo()
    await waitFor(() => expect(at('c0').chartType).toBe('hollow'))
    expect(at('c0').settings ?? null).toBe(null)
  }, 30000)
  it('D/W/M extended hours reach the cell\'s own session view, which is what it draws with, and Undo clears it', async () => {
    H.session = 'post'
    const { say, undo } = mount()
    envelopes.push(plan('chart.setSession', { mode: 'extended' }, 0))
    await say('include extended hours on the top-left chart for me please')
    await waitFor(() => expect(H.chartProps.c0.sessionView).toBe('extended'))
    expect(H.chartProps.c1.sessionView).toBe('regular')
    await undo()
    await waitFor(() => expect(H.chartProps.c0.sessionView).toBe('regular'))
  }, 30000)
  it('intraday extended hours are the cell\'s own shading key', async () => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ cells: [cell('c0', 'NVDA', { tf: '5' }), cell('c1', 'AMD'), cell('c2', 'TSLA'), cell('c3', null)] })) }
    const { say } = mount()
    envelopes.push(plan('chart.setSession', { mode: 'regular' }, 0))
    await say('only regular hours on the top-left chart for me please')
    await waitFor(() => expect(at('c0').settings?.extendedHoursShading).toBe(false))
  }, 30000)
  it('a date jump goes through the cell\'s own date navigator', async () => {
    const { say } = mount()
    H.nav.getDateMeta = () => ({ firstMs: Date.UTC(2020, 0, 1), lastMs: Date.UTC(2026, 0, 1), rightMs: H.nav.goToDate.mock.calls.at(-1)?.[0] ?? Date.UTC(2026, 0, 1) })
    envelopes.push(plan('chart.goToDate', { date: '2024-03-01' }, 0))
    await say('take the top-left chart back to march 1 2024 for me please')
    await waitFor(() => expect(H.nav.goToDate).toHaveBeenCalled())
    await waitFor(() => expect(receipts()).toHaveLength(1))
  }, 30000)
  it('replay does not exist on the grid: refused, not a false receipt', async () => {
    const { say } = mount()
    envelopes.push(plan('chart.replay', { date: '2024-03-01' }, 0))
    await say('replay the top-left chart from march 1 2024 for me please')
    await waitFor(() => expect(transcript()).toMatch(/Replay Mode isn.t reachable from here/))
    expect(receipts()).toHaveLength(0)
  }, 30000)
})

describe('Multi Chart: indicators', () => {
  it('add lands on the named cell only, through the cell, saved, and Undo removes it', async () => {
    const { say, undo } = mount()
    await say('add rsi to the top-right chart')
    await waitFor(() => expect(instances('c1').some(i => /rsi/i.test(i.defId))).toBe(true))
    expect(at('c0').settings).toBeUndefined()
    expect(H.setPref.mock.calls.some(([k]) => k === 'chart_settings')).toBe(false)
    await waitFor(() => expect(JSON.stringify(JSON.parse(H.prefs.multichart_state).cells[1].settings)).toMatch(/rsi/i))
    await undo()
    await waitFor(() => expect(instances('c1').some(i => /rsi/i.test(i.defId))).toBe(false))
    expect(at('c1').settings ?? null).toBe(null)
  }, 30000)
  it('an empty cell has no chart to add to', async () => {
    const { say } = mount()
    await say('add rsi to the bottom-right chart')
    await idle()
    expect(at('c3').settings).toBeUndefined()
    expect(receipts()).toHaveLength(0)
  }, 30000)
  it('Create Indicator has no door on a cell (no toolbar is mounted there): the host says so', () => {
    mount()
    const cellApi = H.api.current.get(gridCellKey('c0')).agent
    expect(cellApi.canCreateIndicator).toBeUndefined()
    expect(cellApi.showAuthoringPreview).toBeUndefined()
    expect(cellApi.canManageIndicators()).toBe(true)
  })
})

describe('Multi Chart: drawings and guides', () => {
  it('a guide line lands on the cell\'s symbol, and Undo removes it', async () => {
    const { say, undo } = mount()
    envelopes.push(planDrawing({ price: 100 }, 'NVDA'))
    await say('put a horizontal guide at 100 on the top-left chart please')
    await waitFor(() => expect(peekDrawings('NVDA').length).toBe(1))
    expect(peekDrawings('AMD').length).toBe(0)
    await undo()
    await waitFor(() => expect(peekDrawings('NVDA').length).toBe(0))
  }, 30000)
  it('two cells on one symbol share its drawings, and the receipt says so', async () => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ cells: [cell('c0', 'NVDA'), cell('c1', 'NVDA', { tf: 'W' }), cell('c2', 'TSLA'), cell('c3', null)] })) }
    const { say } = mount()
    envelopes.push(planDrawing({ price: 100 }, 'NVDA'))
    await say('put a horizontal guide at 100 on the top-left chart please')
    await waitFor(() => expect(peekDrawings('NVDA').length).toBe(1))
    await waitFor(() => expect(transcript()).toMatch(/Drawings belong to the symbol, so this shows on Top-left chart \(NVDA\) and Top-right chart \(NVDA\)/))
  }, 30000)
})

describe('Multi Chart: what does not carry over', () => {
  it('a widget change is refused, named, and never lands on the hidden board', async () => {
    const { say } = mount()
    await say('add a news widget')
    await waitFor(() => expect(transcript()).toMatch(/hidden while Multi Chart is on/))
    expect(boardAdds).toEqual([])
    expect(receipts()).toHaveLength(0)
  }, 30000)
  it('"show NVDA and AMD side by side" is a board grid request: refused the same way', async () => {
    const { say } = mount()
    await say('show NVDA and AMD side by side')
    await idle()
    expect(boardAdds).toEqual([])
    expect(receipts()).toHaveLength(0)
  }, 30000)
  it('Groups mode: a ticker change would refill the whole grid, so it is refused and nothing moves', async () => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ groupsMode: true })) }
    const { say } = mount()
    const before = JSON.stringify(cells())
    await say('show MSFT on the top-left chart')
    await waitFor(() => expect(transcript()).toMatch(/Groups mode refills the whole grid/))
    expect(JSON.stringify(cells())).toBe(before)
  }, 30000)
  it('Groups mode: the adapter refuses a ticker write on its own, whatever reaches it', () => {
    H.prefs = { multichart_state: JSON.stringify(GRID({ groupsMode: true })) }
    mount()
    expect(H.api.current.get(gridCellKey('c0')).agent.commit({ symbol: 'MSFT' })).toBe(false)
    expect(at('c0').sym).toBe('NVDA')
  })
  it('the watermark setting is refused: a cell draws none', () => {
    const out = screenGridOps([{ action: 'chart.setSetting', target: 'c0', args: { setting: 'watermark.visible', value: true } }], { charts: { grid: () => null } })
    expect(out.refuse).toMatch(/watermark/)
  })
  it('a cell behind a maximized one is refused, whichever way it was named; the maximized cell is not', () => {
    const hostFor = (maximized) => ({ charts: {
      list: () => [{ ref: 'c0', cell: {} }, { ref: 'c1', cell: {} }],
      grid: () => ({ groupsMode: () => false, syncTimeRange: () => false, maximized: () => maximized }),
    } })
    const op = (target) => [{ action: 'chart.setTimeframe', target, args: { timeframe: 'W' } }]
    expect(screenGridOps(op('c1'), hostFor('c0')).refuse).toBe(GRID_HIDDEN_REFUSAL)
    expect(screenGridOps(op('c0'), hostFor('c0'))).toBe(null)
    expect(screenGridOps(op('c1'), hostFor(null))).toBe(null)
  })
  it('through the panel: "the top-right chart" with another cell maximized changes nothing and says why', async () => {
    const { say } = mount()
    fireEvent.click(document.querySelector('[data-grid-cell-id="c0"] [aria-label*="aximize"]'))
    await waitFor(() => expect(H.api.current.get('grid:board').agent.gridBoard.maximized()).toBe('c0'))
    await say('make the top-right chart weekly')
    await waitFor(() => expect(transcript()).toMatch(/hidden behind the maximized one/))
    expect(tfs()).toBe('DDDD')
  }, 30000)
  it('a layout write is refused, a layout read is not', () => {
    expect(screenGridOps([{ action: 'layout.open', target: 'layouts', args: {} }], {}).refuse).toBe(GRID_BOARD_REFUSAL)
    expect(screenGridOps([{ action: 'layout.list', target: 'layouts', args: {} }], {})).toBe(null)
  })
  describe('time-range sync: a date jump reports what moved, read back after it', () => {
    const op = [{ action: 'chart.goToDate', target: 'c0', args: { date: '2024-03-01' } }]
    const hostOf = (edges, sync = true) => ({ charts: {
      grid: () => ({ groupsMode: () => false, syncTimeRange: () => sync }),
      list: () => [{ ref: 'c0', symbol: 'NVDA' }, { ref: 'c1', symbol: 'AMD' }, { ref: 'c2', symbol: 'TSLA' }, { ref: 'c3', symbol: null }],
      read: (r) => ({ view: { rightMs: edges[r] } }),
    } })
    it('promises nothing up front', () => { expect(screenGridOps(op, hostOf({}))).toBe(null) })
    it('sync off: nothing to watch', () => { expect(watchGridSync(op, hostOf({}, false))).toBe(null) })
    it('only a date jump is watched', () => { expect(watchGridSync([{ action: 'chart.setTimeframe', target: 'c0', args: {} }], hostOf({}))).toBe(null) })
    const DAY = 86400000
    const NOW = Date.UTC(2026, 10, 5), THEN = Date.UTC(2025, 5, 2)
    it('every cell arrived', async () => {
      const e = { c0: NOW, c1: NOW, c2: NOW }
      const done = watchGridSync(op, hostOf(e))
      e.c0 = THEN; e.c1 = THEN; e.c2 = THEN - 3 * DAY
      expect(await done()).toMatch(/other charts in this grid moved with it/)
    })
    it('no cell moved: says so, and an empty cell is not counted', async () => {
      const e = { c0: NOW, c1: NOW, c2: NOW }
      const done = watchGridSync(op, hostOf(e))
      e.c0 = THEN
      expect(await done()).toBe('Time-range sync is on, but the other charts stayed where they were.')
    })
    it('one arrived, one did not: each is named', async () => {
      const e = { c0: NOW, c1: NOW, c2: NOW }
      const done = watchGridSync(op, hostOf(e))
      e.c0 = THEN; e.c1 = THEN
      expect(await done()).toBe('Time-range sync is on: AMD moved with it, TSLA stayed where it was.')
    })
    it('a live chart scrolling by itself is not reported as following', async () => {
      const e = { c0: NOW, c1: NOW, c2: NOW }
      const done = watchGridSync(op, hostOf(e))
      e.c0 = THEN; e.c1 = THEN; e.c2 = NOW + DAY
      expect(await done()).toBe('Time-range sync is on: AMD moved with it, TSLA stayed where it was.')
    })
    it('a cell that arrives a little later still counts', async () => {
      const e = { c0: NOW, c1: NOW, c2: NOW }
      const done = watchGridSync(op, hostOf(e))
      e.c0 = THEN; e.c1 = THEN
      setTimeout(() => { e.c2 = THEN }, 120)
      expect(await done()).toMatch(/moved with it/)
    })
  })
})

describe('Multi Chart: the Style picker', () => {
  const picker = (id) => document.querySelector(`[data-grid-cell-id="${id}"] select[aria-label^="Chart style"]`)
  const withPick = () => { H.prefs = { multichart_state: JSON.stringify(GRID({ cells: [cell('c0', 'NVDA', { chartType: 'hollow' }), cell('c1', 'AMD'), cell('c2', 'TSLA'), cell('c3', null)] })) } }
  it('"Style" (inherit) clears a per-cell pick, and the cell draws the inherited type again', async () => {
    withPick()
    mount()
    await waitFor(() => expect(H.chartProps.c0.settingsOverride?.chartType).toBe('hollow'))
    fireEvent.change(picker('c0'), { target: { value: '' } })
    await waitFor(() => expect(at('c0').chartType ?? null).toBe(null))
    expect(picker('c0').value).toBe('')
    expect(H.chartProps.c0.settingsOverride?.chartType).not.toBe('hollow')
  })
  it('a timeframe change keeps the pick: only a write that carries chartType moves it', async () => {
    withPick()
    mount()
    fireEvent.change(picker('c0'), { target: { value: 'bars' } })
    await waitFor(() => expect(at('c0').chartType).toBe('bars'))
    act(() => H.chartProps.c0.onTfChange('W'))
    await waitFor(() => expect(at('c0').tf).toBe('W'))
    expect(at('c0').chartType).toBe('bars')
  })
  it('Undo of an Agent change still restores the pick', async () => {
    withPick()
    const { say, undo } = mount()
    envelopes.push(plan('chart.setType', { type: 'bars' }, 0))
    await say('turn the top-left chart into plain bars for me please')
    await waitFor(() => expect(receipts()).toHaveLength(1))
    await undo()
    await waitFor(() => expect(at('c0').chartType).toBe('hollow'))
    expect(picker('c0').value).toBe('hollow')
  }, 30000)
  it('the member clears the pick after an Agent change: Undo still puts the chart back as it was before that change', async () => {
    withPick()
    const { say, undo } = mount()
    envelopes.push(plan('chart.setType', { type: 'bars' }, 0))
    await say('turn the top-left chart into plain bars for me please')
    await waitFor(() => expect(receipts()).toHaveLength(1))
    fireEvent.change(picker('c0'), { target: { value: '' } })
    await waitFor(() => expect(at('c0').chartType ?? null).toBe(null))
    await undo()
    await waitFor(() => expect(at('c0').chartType).toBe('hollow'))
    expect(at('c0').settings ?? null).toBe(null)
    expect(picker('c0').value).toBe('hollow')
  }, 30000)
  it('an Undo that restores a pick on an unforked cell brings the pick back even with the pick now cleared', () => {
    const was = cellStored({ id: 'a', chartType: 'hollow' })
    const next = cellPatch({ id: 'a', sym: 'X', tf: 'D', chartType: null }, { settings: was })
    expect(next.chartType).toBe('hollow')
    expect(next.settings).toBe(null)
  })
})

describe('Multi Chart: a chart that crashes after its change', () => {
  afterEach(() => { H.crashOn = null })
  const crash = () => { vi.spyOn(console, 'error').mockImplementation(() => {}); H.crashOn = 'W' }
  it('the receipt stops claiming success, the panel says what happened, the rest of the grid stays', async () => {
    crash()
    const { say } = mount()
    await say('make the top-right chart weekly')
    await waitFor(() => expect(transcript()).toMatch(/hit an error after that change/))
    expect(receipts().at(-1).getAttribute('data-status')).toBe('failed')
    expect(transcript()).toMatch(/Top-right chart \(AMD\)/)
    expect(screen.getByTestId('canvas-c0')).toBeTruthy()
    expect(document.querySelector('[data-grid-cell-id="c1"]').textContent).toMatch(/hit an error/)
  }, 30000)
  it('Undo takes it back and the chart returns, because a cell is still there to change', async () => {
    crash()
    const { say } = mount()
    await say('make the top-right chart weekly')
    await waitFor(() => expect(transcript()).toMatch(/Say “undo”/))
    await say('undo')
    await waitFor(() => expect(screen.getByTestId('canvas-c1')).toBeTruthy())
    expect(tfs()).toBe('DDDD')
  }, 30000)
  it('a chart nobody changed crashing says nothing on this receipt', async () => {
    const { say } = mount()
    await say('make the top-right chart weekly')
    await waitFor(() => expect(receipts()).toHaveLength(1))
    act(() => { noteChartFault('c2') })
    expect(receipts()[0].getAttribute('data-status')).toBe(null)
    expect(transcript()).not.toMatch(/hit an error/)
  }, 30000)
  it('a healthy chart: the receipt stands', async () => {
    const { say } = mount()
    await say('make the top-right chart weekly')
    await waitFor(() => expect(receipts()).toHaveLength(1))
    expect(receipts()[0].getAttribute('data-status')).toBe(null)
  }, 30000)
})

describe('Multi Chart: time-range sync', () => {
  const synced = (on = true) => { H.prefs = { multichart_state: JSON.stringify(GRID({ syncTimeRange: on })) } }
  const R = { from: '2025-01-02', to: '2025-06-02' }
  const follow = () => {
    const seen = { c0: [], c1: [], c2: [] }
    const offs = Object.keys(seen).map(id => H.chartProps[id].subscribeTimeRange((r) => seen[id].push(r)))
    return { seen, off: () => offs.forEach(f => f()) }
  }
  it('a member\'s move reaches every other cell, and not its own', () => {
    synced()
    mount()
    const { seen } = follow()
    H.chartProps.c0.onTimeRangeChange(R, { memberMoved: true })
    expect(seen.c1).toEqual([R])
    expect(seen.c2).toEqual([R])
    expect(seen.c0).toEqual([])
  })
  it('a chart framing its own load or timeframe moves nobody', () => {
    synced()
    mount()
    const { seen } = follow()
    H.chartProps.c0.onTimeRangeChange(R, { memberMoved: false })
    H.chartProps.c0.onTimeRangeChange(R)
    expect(seen.c1).toEqual([])
  })
  it('turning sync on after load wires the cells; turning it off unwires them', async () => {
    synced(false)
    mount()
    expect(H.chartProps.c0.onTimeRangeChange).toBe(null)
    act(() => H.mc.setSyncTimeRange(true))
    await waitFor(() => expect(H.chartProps.c0.onTimeRangeChange).toBeTypeOf('function'))
    const { seen, off } = follow()
    H.chartProps.c1.onTimeRangeChange(R, { memberMoved: true })
    expect(seen.c0).toEqual([R])
    off()
    act(() => H.mc.setSyncTimeRange(false))
    await waitFor(() => expect(H.chartProps.c0.onTimeRangeChange).toBe(null))
    const later = []
    H.chartProps.c0.subscribeTimeRange((r) => later.push(r))
    expect(later).toEqual([])
  })
})

describe('Multi Chart: walkthroughs', () => {
  // jsdom has no layout: every connected element reads as a box on screen (agentGuide.test.jsx's own stand-in)
  let restore
  beforeEach(() => {
    const BOX = { top: 10, left: 10, right: 110, bottom: 40, width: 100, height: 30, x: 10, y: 10 }
    const rects = Element.prototype.getClientRects
    const box = Element.prototype.getBoundingClientRect
    Element.prototype.getClientRects = function () { return this.isConnected ? [BOX] : [] }
    Element.prototype.getBoundingClientRect = function () { return { ...BOX, toJSON: () => BOX } }
    restore = () => { Element.prototype.getClientRects = rects; Element.prototype.getBoundingClientRect = box }
  })
  afterEach(() => restore())
  it('a walkthrough starts on a control a cell has, on the cell clicked', async () => {
    const { say } = mount()
    click('c2')
    await say('show me where to change the timeframe')
    await waitFor(() => expect(guideState()?.chartRef).toBe('c2'))
    expect(transcript()).toMatch(/highlighted it on Bottom-left chart \(TSLA\)/)
    expect(guideState().steps.map(s => s.target)).toEqual(['chart.timeframe'])   // a cell has no "more timeframes" menu
    expect(tfs()).toBe('DDDD')
  }, 30000)
  it('a control a cell does not have is said plainly, and the feature is still explained', async () => {
    const { say } = mount()
    await say('show me where the chart settings are')
    await waitFor(() => expect(transcript()).toMatch(/isn.t on a Multi Chart cell/))
    expect(guideState()).toBe(null)
  }, 30000)
})

describe('Multi Chart: grid truth, unit by unit', () => {
  it('a Style pick round-trips through the stored settings, and the marker never reaches a cell', () => {
    const cellA = { id: 'a', sym: 'X', tf: 'D', chartType: 'hollow' }
    const before = cellStored(cellA)
    const after = cellPatch(cellA, { settings: { ...before, chartType: 'bars' } })
    expect(after.chartType).toBe('bars')
    expect(JSON.stringify(after)).not.toMatch(/__grid/)
    const back = cellPatch(after, { settings: before })
    expect(back.chartType).toBe('hollow')
    expect(back.settings).toBe(null)
    expect(cellStored(back)).toEqual(before)
  })
  it('the same blob that was committed reads back, so a change on a picked cell lands', () => {
    const cellA = { id: 'a', sym: 'X', tf: 'D', chartType: 'hollow' }
    const blob = { logScale: true, chartType: 'hollow' }
    expect(JSON.stringify(cellStored(cellPatch(cellA, { settings: blob })))).toBe(JSON.stringify(blob))
  })
  it('an approved change fails closed: unreadable, or changed in another window', async () => {
    const local = { id: 'a', sym: 'X', tf: 'D' }
    const sync = (read) => buildCellSync({ readCells: read, localCell: () => local, settleMs: 0, tries: 0 })
    expect((await sync(async () => null)('a')).ok).toBe(false)
    expect((await sync(async () => [{ id: 'a', sym: 'X', tf: 'W' }])('a')).ok).toBe(false)
    expect((await sync(async () => [])('a')).ok).toBe(false)
    expect((await sync(async () => [{ id: 'a', sym: 'X', tf: 'D' }])('a')).ok).toBe(true)
  })
  it('"the one I just changed" is read only when there is a cell to point at', () => {
    const by = { member: 'c1', agent: 'c2' }
    const changed = (who) => by[who] ?? 'c3'
    expect(asSubjectWords('make the one I just changed weekly', null, changed)).toEqual({ text: 'make it weekly', subject: 'c1', changed: true })
    expect(asSubjectWords('make the one you just changed weekly', null, changed).subject).toBe('c2')
    expect(asSubjectWords('make the one we just changed weekly', null, changed).subject).toBe('c3')
    expect(asSubjectWords('make the one you just changed weekly', null, () => null)).toEqual({ text: 'make the one you just changed weekly', subject: null, changed: true })
    expect(asSubjectWords('make the one I just changed weekly', null, null).subject).toBe(null)
  })
})

describe('Multi Chart: the grid is its own board', () => {
  it('its own epoch and visit: an Undo, a proposal or a memory from the board never reaches a cell', () => {
    const board = { epoch: () => 'user:7', boardVisit: () => 3, widgets: {}, boardInSync: async () => ({ ok: true }), charts: { grid: () => null } }
    const grid = scopeHostToGrid(board)
    expect(grid.epoch()).not.toBe(board.epoch())
    expect(grid.boardVisit()).not.toBe(board.boardVisit())
    expect(grid.widgets).toBeUndefined()
    expect(grid.boardInSync).toBeUndefined()
    expect(scopeHostToGrid(null)).toBe(null)
  })
  it('a save the server refuses is not reported as saved', async () => {
    H.setPref = vi.fn(async () => false)
    const { say } = mount()
    await say('add rsi to the top-right chart')
    await waitFor(() => expect(transcript()).toMatch(/not confirmed|couldn.t be saved|NOT saved/i))
  }, 30000)
})

describe('Multi Chart: an approval', () => {
  it('a plan across cells the member never named is proposed, and runs only after the server\'s cell matches', async () => {
    const { say } = mount()
    await idle()
    envelopes.push((b) => env('apply', [
      { action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } },
      { action: 'chart.setTimeframe', target: b.context.charts[1].ref, args: { timeframe: 'W' } },
    ]))
    await say('could you make a couple of these a bit slower for me')
    await waitFor(() => expect(transcript()).toMatch(/check this first/i))
    expect(tfs()).toBe('DDDD')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(tfs()).toBe('WWDD'))
  }, 30000)
  it('another window changed that cell: the approval fails closed and nothing runs', async () => {
    const { say } = mount()
    await idle()
    envelopes.push((b) => env('apply', [
      { action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } },
      { action: 'chart.setTimeframe', target: b.context.charts[1].ref, args: { timeframe: 'W' } },
    ]))
    await say('could you make a couple of these a bit slower for me')
    await waitFor(() => expect(transcript()).toMatch(/check this first/i))
    H.prefs = { ...H.prefs, multichart_state: JSON.stringify(GRID({ cells: [cell('c0', 'NVDA', { tf: 'M' }), cell('c1', 'AMD'), cell('c2', 'TSLA'), cell('c3', null)] })) }
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(transcript()).toMatch(/changed|can.t run as you approved/i), { timeout: 8000 })
    expect(tfs()).toBe('DDDD')
  }, 30000)
})

// Autotest multi-chart-04 and u-workspace-09 (BROWSER-MOCK-MODEL, pl-auto's tree without the described-chart gates): the plan named
// the empty bottom-right cell and the Agent asked "Which chart do you mean?", offering that very cell. The words describe exactly
// one chart, so it is THE target, on the no-model reader and on the model path alike; a setting on an empty cell is kept by the
// cell and read back from the grid's own state.
describe('the empty cell, described', () => {
  const asked = () => /Which chart do you mean|Did you mean/.test(transcript())
  it.each([['put SPY on the empty chart'], ['put SPY on the empty chart for me please']])('%s: the empty cell gets SPY, no question', async (t) => {
    const { say } = mount()
    envelopes.push(plan('chart.setSymbol', { symbol: 'SPY' }, 3))
    await say(t)
    await waitFor(() => expect(at('c3').sym).toBe('SPY'))
    expect(cells().map(c => c.sym)).toEqual(['NVDA', 'AMD', 'TSLA', 'SPY'])
    expect(asked()).toBe(false)
  }, 30000)
  // pl-auto u-workspace-09 (BROWSER-MOCK-MODEL): an empty cell draws no chart, so a scale on it was receipted and never seen. The
  // empty cell is still the target (no other cell is touched, nothing is asked), and the change is refused in words, never receipted.
  it.each([['log scale in the empty cell'], ['log scale in the empty cell for me please']])('%s: the empty cell is the target, and a scale on it is refused, never receipted', async (t) => {
    const { say } = mount()
    envelopes.push(plan('chart.setScale', { scale: 'log' }, 3))
    await say(t)
    await waitFor(() => expect(transcript()).toMatch(/That cell is empty, so there is no chart there to change yet/))
    expect(cells().map(c => c.settings?.logScale ?? null)).toEqual([null, null, null, null])
    expect(receipts().length).toBe(0)
    expect(asked()).toBe(false)
  }, 30000)
  it('what an empty cell DOES show still changes on it: its timeframe ("make the empty cell weekly")', async () => {
    const { say } = mount()
    envelopes.push(plan('chart.setTimeframe', { timeframe: 'W' }, 3))
    await say('make the empty cell weekly')
    await waitFor(() => expect(at('c3').tf).toBe('W'))
  }, 30000)
  it('NEGATIVE: a plan on another cell is not run for "the empty cell"', async () => {
    const { say } = mount()
    envelopes.push(plan('chart.setScale', { scale: 'log' }, 0))
    await say('log scale in the empty cell for me please')
    await new Promise(r => setTimeout(r, 300))
    expect(at('c0').settings?.logScale).not.toBe(true)
  }, 30000)
})
