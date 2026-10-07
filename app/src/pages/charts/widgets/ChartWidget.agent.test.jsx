import { render, act } from '@testing-library/react'
import { useRef, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'

// UCT Agent's chart adapter on the REAL ChartWidget: it must read the active
// tab's own settings / tf / colour group, and write through the widget's own
// sinks — settings + tf in ONE onOptsChange, the ticker through the group.
vi.mock('../../../components/StockChart', () => ({ default: () => <div data-testid="chart" /> }))
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
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, setPrefMerged: () => {}, loading: false }) }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))

import ChartWidget from './ChartWidget'
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
  api = { chartApiById, get opts() { return opts }, groupSyms }
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
    <MemoryRouter>
      <WorkspaceContext.Provider value={value}>
        <ChartWidget color="A" chartId="w1" opts={opts} onOptsChange={(o) => { optsLog.push(o); setOpts(o) }} />
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}
const adapter = () => [...api.chartApiById.current.values()][0].agent

beforeEach(() => { optsLog = [] })

test('main tab: reads its own state and commits settings + tf in ONE onOptsChange', () => {
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  const r = adapter().read()
  expect(r).toMatchObject({ chartId: 'w1', tabId: null, groupKey: 'A', symbol: 'NVDA', tf: 'D', stored: null })
  act(() => { adapter().commit({ settings: { ...r.cs, chartType: 'bars' }, tf: 'W' }) })
  expect(optsLog).toHaveLength(1)
  expect(optsLog[0].tf).toBe('W')
  expect(optsLog[0].settings.chartType).toBe('bars')
  expect(adapter().read()).toMatchObject({ tf: 'W' })
  act(() => { adapter().commit({ symbol: 'MSFT' }) })
  expect(adapter().read().symbol).toBe('MSFT')
  expect(optsLog).toHaveLength(1)                      // the ticker never touched opts
})

test('extra chart tab: reads and writes ONLY that tab', () => {
  render(<Wrap initialOpts={{ tf: 'D', chartTabs: [{ id: 't1', color: 'B', tf: '5', settings: null }], activeChartTab: 1 }} />)
  const r = adapter().read()
  expect(r).toMatchObject({ tabId: 't1', groupKey: 'B', symbol: 'AMD', tf: '5' })
  act(() => { adapter().commit({ tf: 'D', settings: { ...r.cs, chartType: 'line' } }) })
  const o = optsLog[0]
  expect(o.tf).toBe('D')                               // main tab untouched (was already D)
  expect(o.settings).toBeUndefined()
  expect(o.chartTabs[0]).toMatchObject({ id: 't1', tf: 'D' })
  expect(o.chartTabs[0].settings.chartType).toBe('line')
})

test('end to end through the real host: plan → one write → read-back ACK → undo', async () => {
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  const host = buildWorkspaceHost({
    chartApiById: api.chartApiById,
    getWidgets: () => [{ id: 'w1', type: 'chart', color: 'A', x: 0, y: 0, w: 24, h: 20 }],
    widgetLabel: (t) => t,
  })
  const ref = host.charts.list()[0].ref
  expect(ref).toBe('w1')
  const plan = planOps(collectTargets(host, ['chart']), [
    { action: 'chart.setType', target: ref, args: { type: 'bars' } },
    { action: 'chart.setTimeframe', target: ref, args: { timeframe: 'W' } },
    { action: 'volume.setState', target: ref, args: { state: 'hidden' } },
  ], {}, { surface: 'charts' })
  expect(plan.ok).toBe(true)
  // ⚠️ NOT inside act(): act() holds React updates until its scope ends, so a
  // read-back inside it would see the pre-commit render. With the act
  // environment off React schedules the render as the browser does, and the
  // runtime's frame-delayed read-back is a real ACK of the re-rendered widget.
  const prevAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = false
  let res
  try { res = await commitPlan(host, plan) } finally { globalThis.IS_REACT_ACT_ENVIRONMENT = prevAct }
  expect(res.ok).toBe(true)
  expect(res.lines).toEqual(['Changed chart to Bars', 'Switched timeframe to Weekly', 'Hid Volume'])
  expect(optsLog).toHaveLength(1)
  expect(api.opts.settings.volume.visible).toBe(false)
  globalThis.IS_REACT_ACT_ENVIRONMENT = false
  let u
  try { u = await undoEntry(host, res.undo) } finally { globalThis.IS_REACT_ACT_ENVIRONMENT = prevAct }
  expect(u.ok).toBe(true)
  expect(api.opts.tf).toBe('D')
  expect(api.opts.settings ?? null).toBeNull()         // back to inheriting the seed
})
