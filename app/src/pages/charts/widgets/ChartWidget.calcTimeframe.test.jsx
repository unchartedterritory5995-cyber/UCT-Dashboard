import { render, cleanup } from '@testing-library/react'
import { useRef, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi, test, expect, beforeEach } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import { WidgetDoorContext } from '../widgetDoors'

// calc-TF family on the REAL ChartWidget + ChartPane: "calculate the 50 SMA on weekly" through the Agent reaches the chart's
// own settings sink (ChartWidget's agent adapter → ONE onOptsChange), lands as the instance's calculationTimeframe with the
// chart's own tf untouched, survives a remount from the saved opts, and the settings StockChart is then handed ask for the
// WEEKLY frame (useCalcFrames' framesNeeded) — and the real binder computes the average from those weekly bars.
// StockChart is a stub that captures its props and answers the Indicators button's predicate (canManageIndicators).
const captured = vi.hoisted(() => ({ props: null }))
vi.mock('../../../components/StockChart', () => ({
  default: (props) => {
    captured.props = props
    if (props.toolbarApiRef) props.toolbarApiRef.current = { canManageIndicators: () => true }
    return <span data-testid="chart-sym">{props.sym}</span>
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
import { buildWorkspaceHost } from '../../../agent/host'
import { registerBuiltins } from '../../../agent/builtins'
import { buildContext } from '../../../agent/capabilities'
import { planOps, collectTargets, prepareOps } from '../../../agent/executor'
import { commitPlan, undoEntry } from '../../../agent/runtime'
import { setOwnedDefinitionSource, _resetProposedPlans } from '../../../agent/capabilities/indicatorEdits'
import * as registry from '../../../components/chart/engine/nativeRegistry'
import { framesNeeded } from '../../../components/chart/engine/useCalcFrames'
import { createBinder } from '../../../components/chart/engine/binder'
import { createFakeChart } from '../../../components/chart/engine/__tests__/fakeChart'
import { mergeChartSettings } from '../../../components/chart/chartDefaults'
import { adoptOverlayAverages } from '../../../components/chart/maAdoption'

registerBuiltins()

let api
let optsLog
function Wrap({ initialOpts }) {
  const [opts, setOpts] = useState(initialOpts)
  const [groupSyms, setGroupSyms] = useState({ A: 'NVDA', B: 'AMD', C: null, D: null })
  const chartApiById = useRef(new Map())
  api = { chartApiById, get opts() { return opts } }
  const value = {
    groupSyms, setGroupSym: (c, s) => setGroupSyms(prev => ({ ...prev, [c]: s })), chartsTheme: 'default',
    crosshairBus: { emit: () => {}, subscribe: () => () => {} }, aiSearchBus: { subscribe: () => () => {}, request: () => false },
    activeChartRef: { current: null }, chartApiById,
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
const CTX = { surface: 'charts', createIndicator: true }
function hostOf() {
  const host = buildWorkspaceHost({ chartApiById: api.chartApiById, getWidgets: () => [{ id: 'w1', type: 'chart', color: 'A', x: 0, y: 0, w: 24, h: 20 }], widgetLabel: (t) => t })
  host.persist = async () => ({ ok: true })        // the board's ACK (ChartsWorkspace persist); the read-back is the widget's own
  return host
}
const noAct = async (fn) => {
  const prev = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = false
  try { return await fn() } finally { globalThis.IS_REACT_ACT_ENVIRONMENT = prev }
}
const sma50 = (cs) => (adoptOverlayAverages(cs) || cs).indicatorInstances.find(i => i.defId === 'movingAverage' && i.inputs?.period === 50 && i.inputs?.maType === 'sma')

beforeEach(() => { optsLog = []; captured.props = null; setOwnedDefinitionSource(() => []); _resetProposedPlans(); cleanup() })

test('"calculate the 50 sma on weekly": ONE write of the instance\'s frame, the chart stays Daily, it survives a reload, and the chart computes it on WEEKLY bars', async () => {
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  const host = hostOf()
  const chart = host.charts.list()[0]
  expect(chart.tf).toBe('D')
  const target = sma50(chart.cs)
  expect(target).toBeTruthy()
  buildContext(host, CTX)
  const ops = [{ action: 'indicatorStyle.setCalcTimeframe', target: `ixe:${chart.ref}`, args: { instance: '#50:sma', timeframe: 'weekly' } }]
  const plan = planOps(collectTargets(host, ['indicatorEdits', 'indicators', 'chart']), ops, await prepareOps(ops), CTX)
  expect(plan.ok, JSON.stringify(plan.refusals)).toBe(true)
  const res = await noAct(() => commitPlan(host, plan, { env: {}, ctx: CTX }))
  expect(res.ok, res.reason).toBe(true)
  expect(res.lines[0]).toMatch(/^Calculated SMA 50.* on weekly bars \(was the chart's own timeframe\) — the chart itself stays on Daily\.$/)
  // ONE write, through the widget's own sink; the chart's tf is the same
  expect(optsLog).toHaveLength(1)
  expect(api.opts.tf).toBe('D')
  const stored = api.opts.settings.indicatorInstances.find(i => i.instanceId === target.instanceId)
  expect(stored.calculationTimeframe).toBe('W')
  expect('visibility' in stored).toBe(false)

  // RELOAD: a fresh mount from the saved opts (as the board stores them) reads the frame back
  const saved = JSON.parse(JSON.stringify(api.opts))
  cleanup()
  render(<Wrap initialOpts={saved} />)
  const again = hostOf().charts.list()[0]
  expect(again.tf).toBe('D')
  expect(sma50(again.cs).calculationTimeframe).toBe('W')

  // THE DATA PATH: the settings StockChart is handed ask for the weekly frame (and nothing else does)…
  const handed = mergeChartSettings(JSON.stringify(captured.props.settingsOverride))
  const instances = (adoptOverlayAverages(handed) || handed).indicatorInstances
  expect(framesNeeded(instances, (id) => registry.getDefinition(id), 'NVDA', 'D')).toEqual([{ frame: 'W', symbol: 'NVDA' }])
  // …and the real binder computes the SMA 50 from those WEEKLY bars (daily closes are all 1; weekly closes are 100 + i)
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const DAY = 86400000
  const weekly = Array.from({ length: 80 }, (_, i) => ({ t: new Date(Date.UTC(2025, 0, 6) + i * 7 * DAY).toISOString().slice(0, 10), o: 0, h: 0, l: 0, c: 100 + i, v: 1 }))
  const lastWeek = Date.parse(`${weekly[weekly.length - 1].t}T12:00:00Z`)
  const daily = Array.from({ length: 4 }, (_, i) => ({ t: new Date(lastWeek + (i + 1) * DAY).toISOString().slice(0, 10), o: 1, h: 1, l: 1, c: 1, v: 1 }))
  const inst = instances.find(i => i.instanceId === target.instanceId)
  binder.sync({ enabled: true, instances: [inst], registry, bars: daily, adjustTime: (t) => t, plan: { fresh: true },
    resolvePlacement: () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: null }), tf: 'D', sym: 'NVDA',
    frames: new Map([['W|NVDA', { bars: weekly, status: 'available', newestBarIsForming: false }]]) })
  const b = binder.bindings().find(x => x.key.startsWith(`${target.instanceId}::`))
  expect(b, 'the weekly SMA drew nothing').toBeTruthy()
  const drawn = fake.calls.filter(c => c.id === b.series.__id && c.method === 'setData').pop().args[0]
  // the daily bars sit INSIDE the newest weekly period, so they show the SMA through the last COMPLETED week (no lookahead)
  const want = weekly.slice(-51, -1).reduce((a, x) => a + x.c, 0) / 50
  expect(drawn[drawn.length - 1].value).toBeCloseTo(want, 8)
  expect(drawn[drawn.length - 1].value).toBeGreaterThan(100)      // never the daily (chart) bars, which would read 1
})

test('Undo through the widget\'s sink puts the chart\'s own frame back (the absent key), one more write', async () => {
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  const host = hostOf()
  const chart = host.charts.list()[0]
  buildContext(host, CTX)
  const ops = [{ action: 'indicatorStyle.setCalcTimeframe', target: `ixe:${chart.ref}`, args: { instance: '#50:sma', timeframe: 'W' } }]
  const plan = planOps(collectTargets(host, ['indicatorEdits', 'indicators', 'chart']), ops, await prepareOps(ops), CTX)
  const res = await noAct(() => commitPlan(host, plan, { env: {}, ctx: CTX }))
  expect(res.ok, res.reason).toBe(true)
  const u = await noAct(() => undoEntry(host, res.undo))
  expect(u.ok, u.reason).toBe(true)
  expect(optsLog).toHaveLength(2)
  expect(api.opts.tf).toBe('D')
  const back = api.opts.settings ? sma50(mergeChartSettings(JSON.stringify(api.opts.settings))) : null
  expect(back ? 'calculationTimeframe' in back : false).toBe(false)
})
