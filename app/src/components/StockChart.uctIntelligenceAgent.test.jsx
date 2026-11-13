// uctIntelligence.set on the REAL StockChart: the gates the Agent reads are the ones this chart computes and the panel renders
// (toolbarApiRef.uctIntelligence(): { available, known, availability } — layerAvailability over the patterns response), and what
// the Agent commits through a chart adapter (the settings write a ChartWidget makes: onSettingsPersist's blob) flips the overlay's
// props and the panel exactly as the member's own switches do. Same mocks as StockChart.uctIntelligence.test.jsx (no network).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState, useRef } from 'react'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { act } from 'react'

const lw = vi.hoisted(() => ({ markerSets: [], clickHandlers: [], priceLines: [], removedLines: [] }))
const g = vi.hoisted(() => ({ scope: 'trusted', setups: false, payload: {}, hookCalls: [], overlayProps: [] }))

vi.mock('./chart/autoStructuresGate', () => ({
  useAutoStructuresScope: () => g.scope,
  useSetupsPanelReleased: () => g.setups,
}))
vi.mock('../hooks/usePatternDetections', () => ({
  usePatternDetections: (sym, tf, enabled, minConf, opts) => {
    g.hookCalls.push({ sym, tf, enabled, opts })
    return {
      detections: [], drawn: null, dealStatus: g.payload.dealStatus || null,
      levelsSr: g.payload.levelsSr, candleMarks: g.payload.candleMarks, setupDraws: g.payload.setupDraws,
    }
  },
}))
vi.mock('./chart/PatternOverlay', () => ({
  default: (props) => { g.overlayProps.push(props); return null },
}))

// Render harness copied from StockChart.deskmarkers.test.jsx (same mocks).
vi.mock('lightweight-charts', () => {
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: (o) => { const pl = { ...o }; lw.priceLines.push(pl); return pl }, removePriceLine: (pl) => { lw.removedLines.push(pl) }, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    dataByIndex: () => null, getPane: () => ({ getHeight: () => 300, paneIndex: () => 0 }),
    barsInLogicalRange: () => null, data: () => [], seriesType: () => 'Candlestick',
  }
  const timeScale = {
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {},
    getVisibleLogicalRange: () => null,
    setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
    unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
    resetTimeScale: () => {}, options: () => ({}), width: () => 600,
    subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    getVisibleRange: () => null, coordinateToLogical: () => 0, logicalToCoordinate: () => 0,
    timeToIndex: () => 0, height: () => 40, scrollPosition: () => 0,
  }
  const chart = {
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: (h) => { lw.clickHandlers.push(h) },
    unsubscribeClick: (h) => { lw.clickHandlers = lw.clickHandlers.filter(x => x !== h) },
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {},
    BaselineSeries: {}, LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    createSeriesMarkers: (_s, m) => {
      lw.markerSets.push(m)
      return { setMarkers: (next) => { lw.markerSets.push(next) } }
    },
  }
})

// Realtime feeds open EventSource/WS — jsdom has neither. Neutralize them.
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
// A deep hook (useJ2ChartMarkers → useWatchlistAlerts) needs AuthProvider; stub it.
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))
// jsdom has no IndexedDB; the bars cache layer would otherwise swallow the fetch.
vi.mock('../utils/barsIDB', () => ({
  idbGet: async () => null, idbPut: async () => {}, mergeDelta: (_a, b) => b,
}))


const BAR_DATES = Array.from({ length: 200 }, (_, i) =>
  new Date(Date.UTC(2026, 1, 20) - (199 - i) * 86400000).toISOString().slice(0, 10))
const FIXTURE_BARS = BAR_DATES.map((t, i) => ({ t, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 1000 + i }))

const SETUPS_PAYLOAD = {
  verdicts: [{ setup: 'macd_bullish_cross', setup_name: 'MACD Bullish Cross',
    setup_definition: 'MACD line crosses above signal line.', asof_date: '2026-02-19' }],
}

beforeEach(() => {
  cleanup()
  g.scope = 'trusted'; g.setups = false; g.payload = {}; g.hookCalls = []; g.overlayProps = []
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    const body = u.includes('/api/bars/') ? { ticker: 'AAPL', bars: FIXTURE_BARS }
      : u.includes('/api/patterns/') ? SETUPS_PAYLOAD : {}
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
  }))
})

const { default: StockChart } = await import('./StockChart')
const { buildWorkspaceHost } = await import('../agent/host')
const { registerBuiltins } = await import('../agent/builtins')
const { planOps, collectTargets } = await import('../agent/executor')
const { commitPlan, undoEntry } = await import('../agent/runtime')
const { mergeChartSettings } = await import('./chart/chartDefaults')
registerBuiltins()

// a chart widget's agent adapter over THIS StockChart: read the stored blob, commit it the way ChartWidget's onOptsChange does,
// and read the gates from the chart's own toolbarApiRef publication (ChartPane → ChartWidget `uctIntelligence`)
const live = { settings: null, set: null, tb: null }
function Widget({ initial, sym }) {
  const [settings, setSettings] = useState(initial)
  const tb = useRef(null)
  live.settings = settings; live.set = setSettings; live.tb = tb
  return <StockChart sym={sym} tf="D" barsOverride={FIXTURE_BARS} settingsOverride={settings} toolbarApiRef={tb}
    onSettingsPersist={(next) => { setSettings(next) }} />
}
const chartApiById = { current: new Map([['w1', { agent: {
  read: () => ({ chartId: 'w1', tabId: null, groupKey: 'N1', symbol: 'UCTA', tf: 'D', cs: mergeChartSettings(live.settings), stored: live.settings }),
  uctIntelligence: () => live.tb.current?.uctIntelligence?.() ?? null,
  commit: (patch) => { if ('settings' in patch) act(() => live.set(patch.settings)); return true },
} }]]) }
const host = () => buildWorkspaceHost({ chartApiById, getWidgets: () => [{ id: 'w1', type: 'chart', color: 'N1', x: 0, y: 0, w: 24, h: 20, opts: {} }] })
const lastOverlay = () => g.overlayProps.at(-1)
const panel = () => screen.queryByTestId('uct-intel-panel')
const planFor = (args) => planOps(collectTargets(host(), ['chart']), [{ action: 'uctIntelligence.set', target: 'w1', args }], {}, { surface: 'charts' })
async function agentDoes(args) {
  const pl = planFor(args)
  expect(pl.ok, JSON.stringify(pl.refusals)).toBe(true)
  const res = await commitPlan(host(), pl)
  expect(res.ok, JSON.stringify(res)).toBe(true)
  return res
}
async function mount(initial, sym = 'UCTA') {
  render(<Widget initial={initial} sym={sym} />)
  await waitFor(() => expect(g.overlayProps.length).toBeGreaterThan(0), { timeout: 5000 })
}

describe('the gates the Agent reads are this chart\'s own', () => {
  it('publishes { available, known, availability } — layerAvailability over the patterns response', async () => {
    g.payload = { levelsSr: [], setupDraws: [] }
    await mount({ showPatterns: true, uctIntelligence: { added: true } })
    const u = live.tb.current.uctIntelligence()
    expect(u.available).toBe(true)
    expect(u.known).toBe(true)
    expect(u.availability).toMatchObject({ supportResistance: true, candles: false, setups: true, caution: true })
    // the panel shows exactly the switches the gates say: S/R, Setups and Caution, no Candlestick patterns
    expect(screen.getByLabelText('Support & resistance')).toBeTruthy()
    expect(screen.queryByLabelText('Candlestick patterns')).toBeNull()
  })
  it('a viewer without the pattern layer: not available (the library row is not offered)', async () => {
    g.scope = null
    await mount({ showPatterns: false })
    expect(live.tb.current.uctIntelligence().available).toBe(false)
    expect(planFor({ op: 'add', layer: null }).ok).toBe(false)
  })
  it('a chart that never fetched patterns: the gates are not known, so a gated layer is never guessed', async () => {
    await mount({ showPatterns: false })
    expect(live.tb.current.uctIntelligence().known).toBe(false)
    expect(planFor({ op: 'on', layer: 'supportResistance' }).refusals[0].reason).toMatch(/can’t tell yet/)
  })
})

describe('what the Agent commits draws, as the member\'s switches do', () => {
  it('add: the panel appears and the overlay is enabled with labels; Undo takes both away', async () => {
    await mount({ showPatterns: false })
    expect(panel()).toBeNull()
    expect(lastOverlay().enabled).toBe(false)
    const res = await agentDoes({ op: 'add', layer: null })
    await waitFor(() => expect(panel()).toBeTruthy())
    expect(lastOverlay().enabled).toBe(true)
    expect(lastOverlay().showLabels).toBe(true)
    expect(screen.getByLabelText('Toggle chart patterns overlay').getAttribute('aria-pressed')).toBe('true')
    await undoEntry(host(), res.undo)
    await waitFor(() => expect(panel()).toBeNull())
    expect(lastOverlay().enabled).toBe(false)
  })
  it('setups ON (setup_draws released): the overlay is asked to draw the setup lines', async () => {
    g.payload = { setupDraws: [] }
    await mount({ showPatterns: true, uctIntelligence: { added: true } })
    expect(lastOverlay().showSetupDraws).toBe(false)
    await agentDoes({ op: 'on', layer: 'setups' })
    await waitFor(() => expect(lastOverlay().showSetupDraws).toBe(true))
    expect(screen.getByLabelText('Setups').checked).toBe(true)
  })
  it('pattern labels OFF: the overlay drops its labels; the panel switch reads off', async () => {
    await mount({ showPatterns: true, uctIntelligence: { added: true, labels: true } })
    await agentDoes({ op: 'off', layer: 'labels' })
    await waitFor(() => expect(lastOverlay().showLabels).toBe(false))
    expect(screen.getByLabelText('Pattern labels & numbers').checked).toBe(false)
  })
  it('candlestick patterns (no candle_marks): refused, nothing drawn, nothing written', async () => {
    await mount({ showPatterns: true, uctIntelligence: { added: true } })
    const before = live.settings
    expect(planFor({ op: 'on', layer: 'candles' }).ok).toBe(false)
    expect(live.settings).toBe(before)
  })
})
