// app/src/components/StockChart.noticeScopeUnmount.test.jsx
//
// ⭐ L1 — AN UNMOUNTED CHART LEAVES NO NOTICE SCOPE BEHIND.
//
// StockChart's indicator binder publishes bind-time notes (here: a script's own
// `runtime.error`, reached at the member's setting) under the chart's notice scope
// (`createBinder({scope})`). The unmount cleanup now calls `binder.teardown()` before
// `chart.remove()`, so the scope's notes go with the chart. Real StockChart, real
// binder, real registry; lightweight-charts stubbed (the mock is
// StockChart.lookbackPlacement.test.jsx's).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

const SCOPES = vi.hoisted(() => [])
vi.mock('./chart/engine/binder', async (orig) => {
  const real = await orig()
  return { ...real, createBinder: (deps) => { SCOPES.push(deps && deps.scope); return real.createBinder(deps) } }
})
const S = vi.hoisted(() => ({ paneHeights: [300], volPane: null, axisH: 28, axisW: 76, sizeSubs: [] }))

vi.mock('lightweight-charts', () => {
  const makeSeries = (isVolume) => ({
    setData: () => {}, update: () => {}, applyOptions: () => {}, options: () => ({}),
    // the VOLUME series answers with the pane the test says it is in (null = not created yet)
    getPane: () => (isVolume
      ? (S.volPane == null ? null : { paneIndex: () => S.volPane, getHeight: () => S.paneHeights[S.volPane] || 0, setStretchFactor: () => {}, getSeries: () => [] })
      : { paneIndex: () => 0, getHeight: () => S.paneHeights[0], setStretchFactor: () => {}, getSeries: () => [] }),
    priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
    attachPrimitive: () => {}, detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0,
    priceFormatter: () => ({ format: (v) => String(v) }), data: () => [], moveToPane: () => {},
  })
  const Histogram = { __volume: true }
  const chart = {
    addSeries: (type) => makeSeries(type === Histogram), addCustomSeries: () => makeSeries(true), removeSeries: () => {},
    applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {}, width: () => S.axisW }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
      setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => 600, height: () => S.axisH,
      subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
      subscribeSizeChange: (fn) => { S.sizeSubs.push(fn) }, unsubscribeSizeChange: () => {},
    }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => S.paneHeights.map((h, i) => ({ getHeight: () => h, paneIndex: () => i, setStretchFactor: () => {}, getHTMLElement: () => document.createElement('div'), getSeries: () => [], attachPrimitive: () => {} })),
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
    chartElement: () => document.createElement('div'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: {}, HistogramSeries: Histogram, LineSeries: {}, AreaSeries: {}, BarSeries: {}, BaselineSeries: {},
    createSeriesMarkers: () => ({ setMarkers: () => {}, detach: () => {} }),
  }
})
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))


const { default: StockChart } = await import('./StockChart')
const { mergeChartSettings } = await import('./chart/chartDefaults')
const registry = await import('./chart/engine/nativeRegistry')
const { memberPaneDefinition } = await import('./chart/builder/memberPane/memberPaneDefinition')
const { runtimeErrorNotices, resetRuntimeErrorNotices } = await import('./chart/engine/runtimeErrorNotice')

const DEF_ID = 'u_l1_unmount'
const SCRIPT = ['//@version=6', 'indicator("l1 unmount")', 'lim = input.float(100000.0, "Limit")',
  'plot(close, "c")', 'if barstate.islast and close > lim', '    runtime.error("close is above the limit")', ''].join(String.fromCharCode(10))
const bars = Array.from({ length: 60 }, (_, i) => {
  const t = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t, o: 100, h: 101, l: 99, c: 100 + (i % 5), v: 1000 + i }
})
const frames = (n = 4) => act(async () => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)) })

const realClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
beforeEach(() => {
  cleanup()
  SCOPES.length = 0
  resetRuntimeErrorNotices()
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => 400 })
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  const built = memberPaneDefinition({ source: SCRIPT, id: DEF_ID, name: 'Limit check' })
  expect(built.ok, built.reason).toBe(true)
  expect(registry.installUserDefinitions([built.definition]).installed.length).toBe(1)
})
afterEach(() => {
  cleanup()
  Object.defineProperty(Element.prototype, 'clientHeight', realClientHeight)
  registry.uninstallUserDefinition(DEF_ID)
  resetRuntimeErrorNotices()
  vi.unstubAllGlobals()
})

const settings = (lim) => mergeChartSettings({
  indicatorInstances: [{ instanceId: 'l1-i1', defId: DEF_ID, inputs: { lim }, hidden: false }],
})

describe('L1 — unmount releases the chart notice scope', () => {
  it('a stopped script publishes under the chart scope while mounted, and the scope is empty after unmount', async () => {
    const view = render(<StockChart sym="ENPH" tf="D" barsOverride={bars} settingsOverride={settings(1)} noticeScope="l1-scope" />)
    await vi.waitFor(() => expect(runtimeErrorNotices('l1-scope').length).toBe(1), { timeout: 8000 })
    expect(SCOPES).toContain('l1-scope')
    expect(runtimeErrorNotices('l1-scope')[0][1]).toContain('close is above the limit')
    await frames()
    view.unmount()
    expect(runtimeErrorNotices('l1-scope')).toEqual([])
  })

  it('CONTROL — a chart whose script does not stop publishes nothing, mounted or not', async () => {
    const view = render(<StockChart sym="ENPH" tf="D" barsOverride={bars} settingsOverride={settings(100000)} noticeScope="l1-ctrl" />)
    await vi.waitFor(() => expect(SCOPES).toContain('l1-ctrl'), { timeout: 8000 })
    await frames()
    expect(runtimeErrorNotices('l1-ctrl')).toEqual([])
    view.unmount()
    expect(runtimeErrorNotices('l1-ctrl')).toEqual([])
  })
})
