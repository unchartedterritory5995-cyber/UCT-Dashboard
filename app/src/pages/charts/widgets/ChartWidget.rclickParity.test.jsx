import { render, act, screen, cleanup, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { vi, test, expect, beforeEach } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import { WidgetDoorContext } from '../widgetDoors'

// Family C (right-click parity) on the REAL ChartWidget + ChartPane: what the Agent does is what the chart's own right-click
// item does, through the same function.
//   C1-176  Send to Journal: widget.sendToJournal over the chart's own capture door sends the same capture, to the same place,
//           as the menu's "Send to Journal" (both reach sendCaptureToJournal; the module is stubbed — no network, no note).
//   C1-178  Ask AI: chartMenu.askAi → host.charts.askAi → the adapter → openAskAi, the opener the menu's "Ask AI about {sym}"
//           calls: the same /research/:sym?section=ai location.
//   C1-061  Reset watermark: chartMenu.resetWatermark writes opts.watermarkPos = null, the same opts Chart Settings' watermark
//           "Reset to center" (resetWatermark, handed through ChartPane as onResetWatermark) writes; exact Undo.
// StockChart is a stub that captures its props (the menu payload and the watermark Reset are its callbacks).
const captured = vi.hoisted(() => ({ props: null, settings: null }))
const sent = vi.hoisted(() => ({ calls: [] }))
vi.mock('../../../components/StockChart', () => ({
  default: (props) => { captured.props = props; return <span data-testid="chart-sym">{props.sym}</span> },
}))
vi.mock('../../journal-2-0/lib/sendToJournal', () => ({
  sendCaptureToJournal: async (kind, capture, opts) => { sent.calls.push({ kind, capture, opts }); return 'NVDA sent to your note' },
}))
vi.mock('../../../components/journalCaptureLoader', () => ({
  loadJournalCapture: async () => ({ sendCaptureToJournal: async (kind, capture, opts) => { sent.calls.push({ kind, capture, opts }); return 'NVDA sent to your note' } }),
}))
vi.mock('../../../components/chart/SymbolSearch', () => ({ default: () => <span>search</span> }))
vi.mock('../../../components/community/ShareToFloor', () => ({ default: () => <span>share</span> }))
vi.mock('../../../components/chart/ChartSettingsModal', () => ({ default: (props) => { captured.settings = props; return null } }))
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
import { getCapability } from '../../../agent/capabilities'
import { registerBuiltins } from '../../../agent/builtins'
import { planOps, collectTargets, prepareOps } from '../../../agent/executor'
import { buildContext } from '../../../agent/capabilities'
import { commitPlan, undoEntry } from '../../../agent/runtime'
import { makeBoard } from '../../../agent/__fixtures__/board'

registerBuiltins()

let api
let optsLog
let where
function Where() { where = useLocation(); return null }
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
      <Where />
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
// the runtime's read-back must see the re-rendered widget (see ChartWidget.agent.test.jsx: not inside act())
async function offAct(fn) {
  const prevAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = false
  try { return await fn() } finally { globalThis.IS_REACT_ACT_ENVIRONMENT = prevAct }
}
/** The chart's right-click menu, as StockChart opens it on a bar (StockChart.openMenuAt's payload). */
function openMenu() {
  act(() => {
    captured.props.onBarContextMenu({
      clientX: 200, clientY: 150, event: null, bar: { time: '2026-11-02', close: 1 }, clickPrice: 1, currentPrice: 1,
      region: null, resetView: () => {}, openSettings: () => {}, clearDrawings: () => {}, hasDrawings: false,
      onWatermark: false, onCandle: true,
    })
  })
  return document.body.querySelector('[data-guide="chart.contextMenu"]')
}
const chartPlan = (host, action) => planOps(collectTargets(host, ['chart']), [{ action, target: 'w1', args: {} }], {}, { surface: 'charts' })

beforeEach(() => { optsLog = []; sent.calls = []; captured.props = null; where = null })

test('C1-176: widget.sendToJournal sends exactly what the right-click "Send to Journal" sends, to the same default place', async () => {
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  // the menu item
  const menu = openMenu()
  await act(async () => { menu.querySelector('[data-menu-id="journal"]').click() })
  expect(sent.calls).toHaveLength(1)
  const viaMenu = sent.calls[0]
  expect(viaMenu.kind).toBe('chart')
  expect(viaMenu.capture.symbol).toBe('NVDA')
  // the Agent: the board's widget.sendToJournal over the chart's OWN capture door (ChartWidget useWidgetDoor)
  const { host } = makeBoard([{ id: 'w1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'A', opts: { tf: 'D' } }], { A: 'NVDA' })
  buildContext(host, { surface: 'charts' })
  const ops = [{ action: 'widget.sendToJournal', target: 'board', args: { widget: 'w1', where: null } }]
  const env = await prepareOps(ops)
  const p = planOps(collectTargets(host, ['board']), ops, env, { surface: 'charts' })
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  expect(p.lines[0]).toMatch(/to your current note \(or the Notebook inbox\)$/)
  expect(sent.calls).toHaveLength(1)                       // nothing is sent before Apply
  const res = await offAct(() => commitPlan(host, p, { env }))
  expect(res.ok).toBe(true)
  expect(sent.calls).toHaveLength(2)
  const viaAgent = sent.calls[1]
  expect(viaAgent.kind).toBe(viaMenu.kind)
  expect(viaAgent.capture).toEqual(viaMenu.capture)       // the same frozen chart (symbol, tf, range, merged settings)
  // the menu passes no place (sendCaptureToJournal's default, 'note'); the Agent names that same default
  expect(viaMenu.opts?.target ?? 'note').toBe('note')
  expect(viaAgent.opts).toEqual({ target: 'note' })
  expect(res.undo).toBeFalsy()                             // a send has no Undo, as at the door
  expect(optsLog).toEqual([])                              // and changes nothing on the chart
})

test('C1-178: chartMenu.askAi reaches the menu\'s own Ask AI opener: the same /research/:sym?section=ai', async () => {
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  const menu = openMenu()
  act(() => { menu.querySelector('[data-menu-id="ask-ai"]').click() })
  const viaMenu = `${where.pathname}${where.search}`
  expect(viaMenu).toBe('/research/NVDA?section=ai')
  // back on Charts; the Agent's turn
  cleanup()
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  expect(`${where.pathname}`).toBe('/charts')
  const host = hostOf()
  expect(host.charts.read('w1')).toMatchObject({ canAskAi: true, symbol: 'NVDA' })
  const plan = chartPlan(host, 'chartMenu.askAi')
  expect(plan.ok, JSON.stringify(plan.refusals)).toBe(true)
  expect(plan.lines.join(' ')).toMatch(/Ask AI about NVDA/)
  const res = await offAct(() => commitPlan(host, plan))
  expect(res.ok).toBe(true)
  expect(where.pathname).toBe('/charts')                   // the receipt first: the page has not changed yet
  await waitFor(() => expect(`${where.pathname}${where.search}`).toBe(viaMenu), { timeout: 3000 })
  expect(optsLog).toEqual([])                              // nothing on the chart was written
  expect(getCapability('chartMenu.askAi').undo).toBe('none')
})

test('C1-061: chartMenu.resetWatermark writes what the watermark\'s own Reset writes; read back; exact Undo', async () => {
  const placed = { x: 0.2, y: 0.8, anchor: { left: 10, top: 300 } }
  // the product's Reset
  render(<Wrap initialOpts={{ tf: 'D', watermarkPos: placed }} />)
  act(() => { captured.settings.onResetWatermark() })
  const viaMenu = optsLog.at(-1)
  expect(viaMenu).toEqual({ tf: 'D', watermarkPos: null })
  // the Agent, on a fresh chart with the same dragged watermark
  optsLog = []
  cleanup()
  render(<Wrap initialOpts={{ tf: 'D', watermarkPos: placed }} />)
  const host = hostOf()
  expect(host.charts.read('w1').watermarkPos).toEqual(placed)
  const plan = chartPlan(host, 'chartMenu.resetWatermark')
  expect(plan.ok, JSON.stringify(plan.refusals)).toBe(true)
  const res = await offAct(() => commitPlan(host, plan))
  expect(res.ok).toBe(true)
  expect(optsLog.at(-1)).toEqual(viaMenu)
  expect(host.charts.read('w1').watermarkPos).toBeNull()   // read back from the widget
  const u = await offAct(() => undoEntry(host, res.undo))
  expect(u.ok).toBe(true)
  expect(api.opts.watermarkPos).toEqual(placed)            // exactly where it was, anchor included
})

test('C1-061: a watermark never moved by hand is a no-op that writes nothing', async () => {
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  const plan = chartPlan(hostOf(), 'chartMenu.resetWatermark')
  expect(plan.noops.join(' ')).toMatch(/already in its default place/)
  expect(screen.getByTestId('chart-sym').textContent).toBe('NVDA')
  expect(optsLog).toEqual([])
})
