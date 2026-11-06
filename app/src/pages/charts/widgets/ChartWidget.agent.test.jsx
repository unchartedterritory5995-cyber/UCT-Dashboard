import { render, act } from '@testing-library/react'
import { useRef, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'

// UCT Agent's chart adapter on the REAL ChartWidget: it must read the active
// tab's own settings / tf / colour group, and write through the widget's own
// sinks — settings + tf in ONE onOptsChange, the ticker through the group.
// The stand-in chart runs StockChart's REAL anchor migration, with the anchor a drawn pane would derive.
const WM_ANCHOR = { ax: 'left', dx: 40, ay: 'top', dy: 60 }
vi.mock('../../../components/StockChart', async () => {
  const { useRef } = await vi.importActual('react')
  const { default: useWatermarkAnchorMigration } = await vi.importActual('../../../components/chart/useWatermarkAnchorMigration')
  function StandInChart({ watermarkX, watermarkAnchor, onWatermarkAnchor }) {
    const wmCtrlRef = useRef({ getAnchor: () => WM_ANCHOR })
    useWatermarkAnchorMigration({ chartReady: true, watermarkAdjusting: false, watermarkX, watermarkAnchor, onWatermarkAnchor, wmCtrlRef })
    return <div data-testid="chart" />
  }
  return { default: StandInChart }
})
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
import { buildWorkspaceHost, optsSignature } from '../../../agent/host'
import { getTargetKind } from '../../../agent/capabilities'
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

test('the watermark position: the widget-level opts.watermarkPos the chart draws, on any tab, read back from there', () => {
  render(<Wrap initialOpts={{ tf: 'D', chartTabs: [{ id: 't1', color: 'B', tf: '5', settings: null }], activeChartTab: 1 }} />)
  const pos = { x: 0.2, y: 0.5, anchor: null }
  act(() => { adapter().commit({ watermarkPos: pos }) })
  expect(optsLog[0].watermarkPos).toEqual(pos)
  expect(optsLog[0].chartTabs[0].settings).toBe(null)   // the tab is untouched
  expect(adapter().read().watermarkPos).toEqual(pos)
  act(() => { adapter().commit({ watermarkPos: null }) })
  expect(adapter().read().watermarkPos).toBe(null)
})

describe('a watermark move survives the chart storing its anchor (about 300 ms later, the real migration)', () => {
  const settle = () => act(async () => { await new Promise(r => setTimeout(r, 380)) })
  const offAct = async (fn) => {
    const prevAct = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    try { return await fn() } finally { globalThis.IS_REACT_ACT_ENVIRONMENT = prevAct }
  }
  const hostOf = () => buildWorkspaceHost({
    chartApiById: api.chartApiById,
    getWidgets: () => [{ id: 'w1', type: 'chart', color: 'A', x: 0, y: 0, w: 24, h: 20, opts: api.opts }],
    widgetLabel: (t) => t,
  })
  async function move(host, value = 0.2) {
    const plan = planOps(collectTargets(host, ['chart']), [{ action: 'chart.setSetting', target: 'w1', args: { setting: 'watermark.x', value } }], {}, { surface: 'charts' })
    expect(plan.ok).toBe(true)
    const res = await offAct(() => commitPlan(host, plan))
    expect(res.ok).toBe(true)
    expect(api.opts.watermarkPos).toMatchObject({ x: value, anchor: null })
    await settle()
    expect(api.opts.watermarkPos.anchor).toEqual(WM_ANCHOR)              // the migration really ran on the Agent's write
    return res
  }

  test('Undo after the migration: from a centred mark, back to centred', async () => {
    render(<Wrap initialOpts={{ tf: 'D' }} />)
    const host = hostOf()
    const res = await move(host)
    const u = await offAct(() => undoEntry(host, res.undo))
    expect(u.reason).toBeUndefined()
    expect(u.ok).toBe(true)
    expect(api.opts.watermarkPos).toBe(null)
  })
  test('Undo after the migration: a hand-placed mark gets its own x/y and its own anchor back, and nothing re-derives it', async () => {
    const placed = { x: 0.8, y: 0.3, anchor: { ax: 'right', dx: 12, ay: 'top', dy: 20 } }
    render(<Wrap initialOpts={{ tf: 'D', watermarkPos: placed }} />)
    const host = hostOf()
    const res = await move(host)
    expect((await offAct(() => undoEntry(host, res.undo))).ok).toBe(true)
    await settle()
    expect(api.opts.watermarkPos).toEqual(placed)
  })
  test('a real later edit still refuses: the member dragged the mark somewhere else', async () => {
    render(<Wrap initialOpts={{ tf: 'D' }} />)
    const host = hostOf()
    const res = await move(host)
    const dragged = { x: 0.6, y: 0.5, anchor: WM_ANCHOR }
    act(() => { adapter().commit({ watermarkPos: dragged }) })
    const u = await offAct(() => undoEntry(host, res.undo))
    expect(u.ok).toBe(false)
    expect(u.reason).toMatch(/has changed since/)
    expect(api.opts.watermarkPos).toEqual(dragged)
  })
  test('the read-back itself: a receipt taken after the migration landed still counts as landed', async () => {
    render(<Wrap initialOpts={{ tf: 'D' }} />)
    const host = hostOf()
    await move(host)
    expect(getTargetKind('chart').landed(getTargetKind('chart').read(host, 'w1'), { watermarkPos: { x: 0.2, y: 0.5, anchor: null } })).toBe(true)
  })
  test('the whole-widget signatures (add-chart Undo, layout approval) do not read the anchor as an edit either', async () => {
    expect(optsSignature({ tf: 'D', watermarkPos: { x: 0.2, y: 0.5, anchor: null } })).toBe(optsSignature({ tf: 'D', watermarkPos: { x: 0.2, y: 0.5, anchor: WM_ANCHOR } }))
    expect(optsSignature({ tf: 'D', watermarkPos: { x: 0.2, y: 0.5 } })).not.toBe(optsSignature({ tf: 'D', watermarkPos: { x: 0.3, y: 0.5 } }))
    expect(optsSignature({ tf: 'D', watermarkPos: { x: 0.2, y: 0.5 } })).not.toBe(optsSignature({ tf: 'D' }))
  })
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
