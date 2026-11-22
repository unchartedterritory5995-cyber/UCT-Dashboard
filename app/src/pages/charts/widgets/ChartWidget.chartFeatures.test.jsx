import { render, act, screen, cleanup } from '@testing-library/react'
import { useRef, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi, test, expect, beforeEach } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import { WidgetDoorContext } from '../widgetDoors'

// chartFeatures.companyPanel / chartFeatures.earningsStrip on the REAL ChartWidget + ChartPane + ChartDetailDock: what the Agent
// writes is what the member's own controls write, through the same transforms — Indicators → Add to Chart's
// chartFeatures.add / remove / setOpen (handed through ChartPane to Chart Settings, captured here) — in ONE onOptsChange,
// read back from the widget, rendered by the dock (the panel / the rail / the strip), kept by a reload (a fresh mount on the
// persisted opts), and undone to the exact opts.dock before. StockChart and the dock's data tabs are stubs (no network).
const captured = vi.hoisted(() => ({ props: null, settings: null }))
vi.mock('../../../components/StockChart', () => ({
  default: (props) => { captured.props = props; return <span data-testid="chart-sym">{props.sym}</span> },
}))
vi.mock('../../../components/chart/SymbolSearch', () => ({ default: () => <span>search</span> }))
vi.mock('../../../components/community/ShareToFloor', () => ({ default: () => <span>share</span> }))
vi.mock('../../../components/chart/ChartSettingsModal', () => ({ default: (props) => { captured.settings = props; return null } }))
vi.mock('./ChartMarketClock', () => ({ default: () => <span>clock</span> }))
vi.mock('./ChartDayGain', () => ({ default: () => <span>gain</span> }))
vi.mock('./AiSearchWidget', () => ({ default: () => null }))
vi.mock('./TimeframeMenu', () => ({ default: () => null }))
vi.mock('./DockProfile', () => ({ default: () => <span data-testid="tab-overview">overview</span> }))
vi.mock('./DockNews', () => ({ default: () => <span data-testid="tab-news">news</span> }))
vi.mock('./DockFinancials', () => ({ default: () => <span data-testid="tab-financials">financials</span> }))
vi.mock('./DockEarnings', () => ({ default: () => <span data-testid="tab-earnings">earnings</span> }))
vi.mock('./DockOwnership', () => ({ default: () => <span data-testid="tab-ownership">ownership</span> }))
vi.mock('./CompanySearch', () => ({ default: () => null }))
vi.mock('./ChartEarningsStrip', () => ({ default: () => <div data-testid="chart-earnings-strip">strip</div> }))
vi.mock('./dockPrefetch', () => ({ clearNewsPrefetch: () => {}, prefetchPanel: () => {} }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, setPrefMerged: () => {}, loading: false }), parsePref: (_r, f) => f }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))

import ChartWidget from './ChartWidget'
import { COMPANY_INFO, EARNINGS_STRIP } from './chartFeatures'
import { buildWorkspaceHost } from '../../../agent/host'
import { registerBuiltins } from '../../../agent/builtins'
import { planOps, collectTargets } from '../../../agent/executor'
import { commitPlan, undoEntry } from '../../../agent/runtime'

registerBuiltins()

let api
let optsLog
function Wrap({ initialOpts }) {
  const [opts, setOpts] = useState(initialOpts)
  const [groupSyms, setGroupSyms] = useState({ A: 'NVDA', B: 'AMD', C: null, D: null })
  const chartApiById = useRef(new Map())
  api = { chartApiById, get opts() { return opts } }
  const value = {
    groupSyms,
    setGroupSym: (c, s) => setGroupSyms(prev => ({ ...prev, [c]: s })),
    chartsTheme: 'default',
    crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    aiSearchBus: { subscribe: () => () => {}, request: () => false },
    activeChartRef: { current: null },
    chartApiById,
  }
  return (
    <MemoryRouter initialEntries={['/charts']}>
      <WorkspaceContext.Provider value={value}>
        <WidgetDoorContext.Provider value="w1">
          <ChartWidget color="A" chartId="w1" opts={opts} onOptsChange={(o) => { optsLog.push(o); setOpts(o) }} />
        </WidgetDoorContext.Provider>
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}
const hostOf = () => buildWorkspaceHost({
  chartApiById: api.chartApiById,
  getWidgets: () => [{ id: 'w1', type: 'chart', color: 'A', x: 0, y: 0, w: 24, h: 20, opts: api.opts }],
  widgetLabel: (t) => t,
})
async function offAct(fn) {
  const prevAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = false
  try { return await fn() } finally { globalThis.IS_REACT_ACT_ENVIRONMENT = prevAct }
}
const agentPlan = (host, action, args) => planOps(collectTargets(host, ['chart']), [{ action, target: 'w1', args }], {}, { surface: 'charts' })
async function agentDoes(action, args) {
  const host = hostOf()
  const p = agentPlan(host, action, args)
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  const res = await offAct(() => commitPlan(host, p))
  expect(res.ok, JSON.stringify(res)).toBe(true)
  return { host, res }
}
// the member's own dock: Company Info added and COLLAPSED on Ownership at a dragged 520px; the strip at a dragged 140px
const MINE = { company: true, open: false, tab: 'ownership', rightW: 520, strip: true, stripH: 140 }
const reload = () => { const o = api.opts; cleanup(); render(<Wrap initialOpts={o} />) }

beforeEach(() => { optsLog = []; captured.props = null; captured.settings = null })

test('add Company Info: the SAME opts Add to Chart writes, in ONE onOptsChange; the panel renders; a reload keeps it; Undo exact', async () => {
  // the member's Add to Chart (ChartPane hands chartFeatures to Chart Settings)
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  act(() => { captured.settings.chartFeatures.add(COMPANY_INFO) })
  const viaMenu = optsLog.at(-1)
  cleanup(); optsLog = []
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  expect(screen.queryByTestId('company-panel')).toBeNull()
  const { host, res } = await agentDoes('chartFeatures.companyPanel', { op: 'open', tab: null })
  expect(optsLog).toHaveLength(1)                          // ONE write for the action
  expect(optsLog[0]).toEqual(viaMenu)
  expect(host.charts.read('w1').dock).toEqual(viaMenu.dock) // read back from the widget
  expect(screen.getByTestId('company-panel')).toBeTruthy()
  reload()
  expect(screen.getByTestId('company-panel')).toBeTruthy() // the persisted opts carry it
  const u = await offAct(() => undoEntry(hostOf(), res.undo))
  expect(u.ok).toBe(true)
  expect(api.opts).toEqual({ tf: 'D' })                    // exactly as before: no dock key at all
  expect(screen.queryByTestId('company-panel')).toBeNull()
})

test('remove Company Info then Undo: the member\'s own 520px width, tab and collapsed state come back (not DEFAULT_RIGHT_W)', async () => {
  render(<Wrap initialOpts={{ tf: 'D', dock: MINE }} />)
  expect(screen.getByTestId('company-rail')).toBeTruthy()
  // the member's own remove writes the same
  act(() => { captured.settings.chartFeatures.remove(COMPANY_INFO) })
  const viaMenu = optsLog.at(-1)
  cleanup(); optsLog = []
  render(<Wrap initialOpts={{ tf: 'D', dock: MINE }} />)
  const { res } = await agentDoes('chartFeatures.companyPanel', { op: 'remove', tab: null })
  expect(optsLog).toEqual([viaMenu])
  expect(screen.queryByTestId('company-rail')).toBeNull()
  const u = await offAct(() => undoEntry(hostOf(), res.undo))
  expect(u.ok).toBe(true)
  expect(api.opts.dock).toEqual(MINE)
  expect(optsLog).toHaveLength(2)                          // the Undo is one write too
})

test('collapse = the chevron (setOpen false): the panel becomes the rail and STAYS added; Undo expands it', async () => {
  const open = { ...MINE, open: true }
  render(<Wrap initialOpts={{ tf: 'D', dock: open }} />)
  act(() => { captured.settings.chartFeatures.setOpen(COMPANY_INFO, false) })
  const viaMenu = optsLog.at(-1)
  cleanup(); optsLog = []
  render(<Wrap initialOpts={{ tf: 'D', dock: open }} />)
  expect(screen.getByTestId('company-panel')).toBeTruthy()
  const { res } = await agentDoes('chartFeatures.companyPanel', { op: 'collapse', tab: null })
  expect(optsLog).toEqual([viaMenu])
  expect(api.opts.dock.company).toBe(true)
  expect(screen.getByTestId('company-rail')).toBeTruthy()
  await offAct(() => undoEntry(hostOf(), res.undo))
  expect(api.opts.dock).toEqual(open)
})

test('a tab: the panel shows it (ChartDetailDock\'s own tab), one write', async () => {
  render(<Wrap initialOpts={{ tf: 'D', dock: { ...MINE, open: true } }} />)
  expect(screen.getByTestId('tab-ownership')).toBeTruthy()
  await agentDoes('chartFeatures.companyPanel', { op: null, tab: 'news' })
  expect(optsLog).toHaveLength(1)
  expect(screen.getByTestId('tab-news')).toBeTruthy()
})

test('the Earnings Strip ("fundamentals strip"): Add to Chart\'s EARNINGS_STRIP write — dock.strip, never dock.bottom; it renders; Undo exact', async () => {
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  act(() => { captured.settings.chartFeatures.add(EARNINGS_STRIP) })
  const viaMenu = optsLog.at(-1)
  cleanup(); optsLog = []
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  const { res } = await agentDoes('chartFeatures.earningsStrip', { op: 'open' })
  expect(optsLog).toEqual([viaMenu])
  expect(api.opts.dock.strip).toBe(true)
  expect(api.opts.dock.bottom).toBe(false)
  expect(screen.getByTestId('chart-earnings-strip')).toBeTruthy()
  await offAct(() => undoEntry(hostOf(), res.undo))
  expect(api.opts).toEqual({ tf: 'D' })
})

test('no-ops write nothing: a duplicate add, removing what is not there', async () => {
  render(<Wrap initialOpts={{ tf: 'D', dock: { ...MINE, open: true } }} />)
  const host = hostOf()
  expect(agentPlan(host, 'chartFeatures.companyPanel', { op: 'open', tab: null }).noops.join(' ')).toMatch(/already open/)
  expect(agentPlan(host, 'chartFeatures.earningsStrip', { op: 'open' }).noops.join(' ')).toMatch(/already under this chart/)
  expect(optsLog).toEqual([])
})

test('the dock is the WIDGET\'s: changed from an extra tab, every tab shows it, and the receipt says so', async () => {
  const opts = { tf: 'D', chartTabs: [{ id: 't1', color: 'A', tf: 'W' }], activeChartTab: 1 }
  render(<Wrap initialOpts={opts} />)
  const host = hostOf()
  const ref = host.charts.list()[0].ref
  const p = planOps(collectTargets(host, ['chart']), [{ action: 'chartFeatures.companyPanel', target: ref, args: { op: 'open', tab: null } }], {}, { surface: 'charts' })
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  expect(p.lines.join(' ')).toMatch(/shared by all 2 tabs of this chart widget/)
  await offAct(() => commitPlan(host, p))
  expect(optsLog).toHaveLength(1)
  expect(api.opts.dock.company).toBe(true)                 // the widget's own dock, not a tab's
  expect(api.opts.chartTabs).toEqual(opts.chartTabs)       // the tabs are untouched
})
