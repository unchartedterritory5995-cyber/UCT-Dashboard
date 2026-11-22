import { render, cleanup } from '@testing-library/react'
import { useRef, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi, test, expect, beforeEach } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import { WidgetDoorContext } from '../widgetDoors'

// Volume Profile family on the REAL ChartWidget + ChartPane: "turn on volume profile" through the Agent reaches the chart's own
// settings sink (ChartWidget's agent adapter → ONE onOptsChange), lands as `indicators.volumeProfile.enabled` (no definition,
// no instance), the settings StockChart is then handed carry it (the prop the canvas overlay effect reads), it survives a
// remount from the saved opts, and Undo puts the prior block back. StockChart is a stub that captures its props.
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
import { mergeChartSettings } from '../../../components/chart/chartDefaults'
import { confirmVolumeProfile, volumeProfileOf } from '../../../components/chart/builder/agentMutations'

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
const CTX = { surface: 'charts' }
function hostOf() {
  const host = buildWorkspaceHost({ chartApiById: api.chartApiById, getWidgets: () => [{ id: 'w1', type: 'chart', color: 'A', x: 0, y: 0, w: 24, h: 20 }], widgetLabel: (t) => t })
  host.persist = async () => ({ ok: true })
  return host
}
const noAct = async (fn) => {
  const prev = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = false
  try { return await fn() } finally { globalThis.IS_REACT_ACT_ENVIRONMENT = prev }
}
const handedVp = () => mergeChartSettings(captured.props.settingsOverride ? JSON.stringify(captured.props.settingsOverride) : null).indicators.volumeProfile
async function run(host, args) {
  const chart = host.charts.list()[0]
  buildContext(host, CTX)
  const ops = [{ action: 'volumeProfile.set', target: chart.ref, args: { enabled: null, bins: null, color: null, pocColor: null, ...args } }]
  const plan = planOps(collectTargets(host, ['chart']), ops, await prepareOps(ops), CTX)
  expect(plan.ok, JSON.stringify(plan.refusals)).toBe(true)
  return noAct(() => commitPlan(host, plan, { env: {}, ctx: CTX }))
}

beforeEach(() => { optsLog = []; captured.props = null; cleanup() })

test('"turn on volume profile with 30 bins": ONE write, the overlay prop flips, no instance, it survives a reload', async () => {
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  const host = hostOf()
  expect(handedVp().enabled).toBe(false)
  const instancesBefore = JSON.stringify(host.charts.list()[0].cs.indicatorInstances || [])
  const res = await run(host, { enabled: true, bins: 30 })
  expect(res.ok, res.reason).toBe(true)
  expect(res.lines.join(' ')).toMatch(/Turned on Volume Profile with 30 bins/)
  expect(optsLog).toHaveLength(1)                                           // ONE settings write, through the widget's sink
  expect(api.opts.tf).toBe('D')
  expect(confirmVolumeProfile(api.opts.settings, { enabled: true, bins: 30 })).toBe(true)
  expect(JSON.stringify(mergeChartSettings(JSON.stringify(api.opts.settings)).indicatorInstances || [])).toBe(instancesBefore)
  // the settings StockChart is handed now carry it — the slice its Volume Profile canvas effect reads
  expect(handedVp()).toMatchObject({ enabled: true, bins: 30 })

  const saved = JSON.parse(JSON.stringify(api.opts))
  cleanup()
  render(<Wrap initialOpts={saved} />)
  expect(volumeProfileOf(hostOf().charts.list()[0].cs)).toMatchObject({ enabled: true, bins: 30 })
  expect(handedVp()).toMatchObject({ enabled: true, bins: 30 })
})

test('Undo through the widget\'s sink puts the prior block back (off, 24 bins), one more write; the prop flips back', async () => {
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  const host = hostOf()
  const before = volumeProfileOf(host.charts.list()[0].cs)
  const res = await run(host, { enabled: true, bins: 40 })
  expect(res.ok, res.reason).toBe(true)
  const u = await noAct(() => undoEntry(host, res.undo))
  expect(u.ok, u.reason).toBe(true)
  expect(optsLog).toHaveLength(2)
  expect(volumeProfileOf(api.opts.settings ?? null)).toEqual(before)
  expect(handedVp().enabled).toBe(false)
})

test('already on: an honest no-op — no write, no Undo', async () => {
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  const host = hostOf()
  expect((await run(host, { enabled: true })).ok).toBe(true)
  optsLog = []
  const again = await run(host, { enabled: true })
  expect(optsLog).toHaveLength(0)
  expect(again.undo ?? null).toBeNull()
})
