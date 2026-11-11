import { render, act, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'

// C1-127 · "open chart settings": the Agent opens the chart's OWN Chart Settings dialog — the very
// `openSettings` the gear, the right-click "Chart settings" item and Alt+, call (ChartPane) — through
// the ChartWidget adapter, on the REAL ChartWidget + ChartPane. The modal is a marker that renders
// only while ChartPane holds it open, so "opened" is read back from the pane's own state.
// Opening a dialog changes no setting: nothing is written, so there is no Undo to offer.
vi.mock('../../../components/StockChart', () => ({ default: () => <div data-testid="chart" /> }))
vi.mock('../../../components/chart/SymbolSearch', () => ({ default: () => <span>search</span> }))
vi.mock('../../../components/community/ShareToFloor', () => ({ default: () => <span>share</span> }))
vi.mock('../../../components/chart/ChartSettingsModal', () => ({
  default: ({ open, onClose }) => (open ? <div data-testid="chart-settings-modal"><button type="button" onClick={onClose}>close</button></div> : null),
}))
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
import { getCapability } from '../../../agent/capabilities'
import { registerBuiltins } from '../../../agent/builtins'
import { planOps, collectTargets } from '../../../agent/executor'
import { commitPlan } from '../../../agent/runtime'

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
    <MemoryRouter>
      <WorkspaceContext.Provider value={value}>
        <ChartWidget color="A" chartId="w1" opts={opts} onOptsChange={(o) => { optsLog.push(o); setOpts(o) }} />
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}
const adapter = () => [...api.chartApiById.current.values()][0].agent
const hostOf = () => buildWorkspaceHost({
  chartApiById: api.chartApiById,
  getWidgets: () => [{ id: 'w1', type: 'chart', color: 'A', x: 0, y: 0, w: 24, h: 20, opts: api.opts }],
  widgetLabel: (t) => t,
})
// the runtime's read-back must see the re-rendered pane (see ChartWidget.agent.test.jsx: not inside act())
async function offAct(fn) {
  const prevAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = false
  try { return await fn() } finally { globalThis.IS_REACT_ACT_ENVIRONMENT = prevAct }
}

beforeEach(() => { optsLog = [] })

test('the adapter reaches the pane\'s own openSettings: the dialog opens and is read back from the pane', () => {
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  expect(screen.queryByTestId('chart-settings-modal')).toBeNull()
  expect(adapter().canOpenSettings()).toBe(true)
  expect(adapter().settingsOpen()).toBe(false)
  let ok
  act(() => { ok = adapter().openSettings() })
  expect(ok).toBe(true)
  expect(screen.getByTestId('chart-settings-modal')).toBeTruthy()
  expect(adapter().settingsOpen()).toBe(true)
  expect(optsLog).toEqual([])                          // opening the dialog writes nothing
  // closed by the member: the read-back follows the pane, not the Agent's last call
  act(() => { screen.getByText('close').click() })
  expect(screen.queryByTestId('chart-settings-modal')).toBeNull()
  expect(adapter().settingsOpen()).toBe(false)
})

test('the host snapshot carries the read-back, and host.charts.openSettings reaches the right chart', () => {
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  const host = hostOf()
  expect(host.charts.read('w1')).toMatchObject({ settingsOpen: false, canOpenSettings: true })
  let ok
  act(() => { ok = host.charts.openSettings('w1') })
  expect(ok).toBe(true)
  expect(host.charts.read('w1').settingsOpen).toBe(true)
  // a chart that is not on the board opens nothing
  expect(host.charts.openSettings('nope')).toBe(false)
})

test('end to end: chartSetup.openSettings plans, opens the dialog, is read back, and offers no Undo', async () => {
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  const host = hostOf()
  const plan = planOps(collectTargets(host, ['chart']), [{ action: 'chartSetup.openSettings', target: 'w1', args: {} }], {}, { surface: 'charts' })
  expect(plan.ok).toBe(true)
  const res = await offAct(() => commitPlan(host, plan))
  expect(res.ok).toBe(true)
  expect(res.lines.join(' ')).toMatch(/Opened Chart Settings/)
  expect(screen.getByTestId('chart-settings-modal')).toBeTruthy()
  expect(optsLog).toEqual([])
  expect(api.opts).toEqual({ tf: 'D' })
  expect(getCapability('chartSetup.openSettings').undo).toBe('none')
})

test('already open: a no-op that opens nothing twice', async () => {
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  act(() => { adapter().openSettings() })
  const host = hostOf()
  const plan = planOps(collectTargets(host, ['chart']), [{ action: 'chartSetup.openSettings', target: 'w1', args: {} }], {}, { surface: 'charts' })
  const spy = vi.spyOn(adapter(), 'openSettings')
  const res = await offAct(() => commitPlan(host, plan))
  expect(JSON.stringify(res)).toMatch(/already open/)
  expect(spy).not.toHaveBeenCalled()
})
