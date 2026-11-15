import { render, act, screen, cleanup } from '@testing-library/react'
import { useRef, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi, test, expect, beforeEach } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import { WidgetDoorContext } from '../widgetDoors'

// uctIntelligence.set on the REAL ChartWidget + ChartPane: what the Agent writes is what the member's own switches write — the
// Indicators library row (toggledRow → addUctIntelligence / removeUctIntelligence) and the UCT Intelligence panel's toggle
// (setUctIntelligenceLayer, as StockChart's handleUctIntelLayer) — through the chart's settings path (StockChart's
// onSettingsPersist ↔ the Agent's adapter commit: ONE onOptsChange of opts.settings), handed back to StockChart as its
// `settingsOverride`, kept by a reload (a fresh mount on the persisted opts), and undone to the exact blob before. The gates
// are read from StockChart's own toolbarApiRef publication (`uctIntelligence()`), through ChartPane, never a copy.
// StockChart is a stub that captures its props and publishes those gates; the overlay half is StockChart.uctIntelligenceAgent.test.jsx.
const g = vi.hoisted(() => ({ props: null, uci: null }))
vi.mock('../../../components/StockChart', () => ({
  default: (props) => {
    g.props = props
    if (props.toolbarApiRef) props.toolbarApiRef.current = { uctIntelligence: () => g.uci }
    const s = props.settingsOverride || {}
    return <span data-testid="chart-sym" data-patterns={String(s.showPatterns === true)} data-uci={JSON.stringify(s.uctIntelligence ?? null)}>{props.sym}</span>
  },
}))
vi.mock('../../../components/chart/SymbolSearch', () => ({ default: () => <span>search</span> }))
vi.mock('../../../components/community/ShareToFloor', () => ({ default: () => <span>share</span> }))
vi.mock('../../../components/chart/ChartSettingsModal', () => ({ default: () => null }))
vi.mock('./ChartMarketClock', () => ({ default: () => <span>clock</span> }))
vi.mock('./ChartDayGain', () => ({ default: () => <span>gain</span> }))
vi.mock('./AiSearchWidget', () => ({ default: () => null }))
vi.mock('./TimeframeMenu', () => ({ default: () => null }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, setPrefMerged: () => {}, loading: false }), parsePref: (_r, f) => f }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))

import ChartWidget from './ChartWidget'
import { toggledRow } from '../../../components/chart/IndicatorLibraryDialog'
import { UCT_INTELLIGENCE_ROW, setUctIntelligenceLayer, readUctIntelligence } from '../../../components/chart/uctIntelligence'
import { mergeChartSettings } from '../../../components/chart/chartDefaults'
import { buildWorkspaceHost } from '../../../agent/host'
import { registerBuiltins } from '../../../agent/builtins'
import { planOps, collectTargets } from '../../../agent/executor'
import { commitPlan, undoEntry } from '../../../agent/runtime'

registerBuiltins()

const A = 'uctIntelligence.set'
const AV = { supportResistance: false, supportResistanceEmpty: false, candles: false, setups: true, caution: false }
let api
let optsLog
function Wrap({ initialOpts, drop = false }) {
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
          <ChartWidget color="A" chartId="w1" opts={opts} onOptsChange={(o) => { optsLog.push(o); if (!drop) setOpts(o) }} />
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
const agentPlan = (host, args) => planOps(collectTargets(host, ['chart']), [{ action: A, target: 'w1', args }], {}, { surface: 'charts' })
async function agentDoes(args) {
  const host = hostOf()
  const p = agentPlan(host, args)
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  const res = await offAct(() => commitPlan(host, p))
  expect(res.ok, JSON.stringify(res)).toBe(true)
  return { host, res }
}
const shown = () => { const el = screen.getByTestId('chart-sym'); return { patterns: el.dataset.patterns, uci: JSON.parse(el.dataset.uci) } }
// the member's chart: patterns off, the indicator added once and removed, Setups chosen, labels off — and a grid choice
const MINE = { ...mergeChartSettings(null), showPatterns: false, uctIntelligence: { added: false, setups: true, labels: false }, grid: { color: '#ffffff08', visible: false }, preset: 'custom' }
const reload = () => { const o = api.opts; cleanup(); render(<Wrap initialOpts={o} />) }

beforeEach(() => { optsLog = []; g.props = null; g.uci = { available: true, known: true, availability: AV } })

test('add: the SAME opts the library row writes, in ONE onOptsChange; StockChart is handed it; a reload keeps it; Undo exact', async () => {
  // the member's own click on the library row (ChartToolbar → IndicatorLibraryDialog onToggle → onUpdateSettings → onSettingsPersist)
  render(<Wrap initialOpts={{ tf: 'D', settings: MINE }} />)
  act(() => { g.props.onSettingsPersist({ ...toggledRow(UCT_INTELLIGENCE_ROW, mergeChartSettings(g.props.settingsOverride), null), preset: 'custom' }) })
  const viaRow = optsLog.at(-1)
  cleanup(); optsLog = []
  render(<Wrap initialOpts={{ tf: 'D', settings: MINE }} />)
  expect(shown()).toEqual({ patterns: 'false', uci: MINE.uctIntelligence })
  const { host, res } = await agentDoes({ op: 'add', layer: null })
  expect(optsLog).toHaveLength(1)                                   // ONE write for the action
  expect(optsLog[0]).toEqual(viaRow)
  expect(readUctIntelligence(host.charts.read('w1').stored)).toMatchObject({ added: true, autoPatterns: true, labels: false, setups: true })
  expect(shown()).toEqual({ patterns: 'true', uci: { added: true, setups: true, labels: false } })   // StockChart draws it
  reload()
  expect(shown()).toEqual({ patterns: 'true', uci: { added: true, setups: true, labels: false } })   // the persisted opts carry it
  const u = await offAct(() => undoEntry(hostOf(), res.undo))
  expect(u.ok).toBe(true)
  expect(api.opts).toEqual({ tf: 'D', settings: MINE })              // both keys exactly as before (and the rest)
  expect(shown()).toEqual({ patterns: 'false', uci: MINE.uctIntelligence })
})

test('a layer: the panel toggle\'s write (setUctIntelligenceLayer), one write, rendered, kept by a reload, Undo exact', async () => {
  const added = { ...MINE, showPatterns: true, uctIntelligence: { added: true, labels: true } }
  render(<Wrap initialOpts={{ tf: 'D', settings: added }} />)
  act(() => { g.props.onSettingsPersist({ ...setUctIntelligenceLayer(mergeChartSettings(g.props.settingsOverride), 'setups', true), preset: 'custom' }) })
  const viaPanel = optsLog.at(-1)
  cleanup(); optsLog = []
  render(<Wrap initialOpts={{ tf: 'D', settings: added }} />)
  const { res } = await agentDoes({ op: 'on', layer: 'setups' })
  expect(optsLog).toHaveLength(1)
  expect(optsLog[0]).toEqual(viaPanel)
  expect(shown().uci).toEqual({ added: true, labels: true, setups: true })
  reload()
  expect(shown().uci).toEqual({ added: true, labels: true, setups: true })
  await offAct(() => undoEntry(hostOf(), res.undo))
  expect(api.opts).toEqual({ tf: 'D', settings: added })
})

test('the gates are StockChart\'s own publication: a layer it does not release is refused, nothing written', async () => {
  render(<Wrap initialOpts={{ tf: 'D', settings: { ...MINE, showPatterns: true, uctIntelligence: { added: true } } }} />)
  expect(hostOf().charts.read('w1').uctIntel).toEqual(g.uci)       // read through ChartPane → ChartWidget, not a copy
  const p = agentPlan(hostOf(), { op: 'on', layer: 'candles' })
  expect(p.ok).toBe(false)
  expect(p.refusals[0].reason).toMatch(/Candlestick patterns aren’t released/)
  g.uci = { available: false, known: false, availability: {} }
  expect(agentPlan(hostOf(), { op: 'add', layer: null }).refusals[0].reason).toMatch(/isn’t offered on this chart for your account/)
  expect(optsLog).toHaveLength(0)
})

test('read-back: a widget that drops the write is never reported as done', async () => {
  render(<Wrap initialOpts={{ tf: 'D', settings: MINE }} drop />)
  const host = hostOf()
  const p = agentPlan(host, { op: 'add', layer: null })
  expect(p.ok).toBe(true)
  const res = await offAct(() => commitPlan(host, p))
  expect(res.ok).toBe(false)
  expect(api.opts).toEqual({ tf: 'D', settings: MINE })
})
