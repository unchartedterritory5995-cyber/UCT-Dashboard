// The UCT Intelligence indicator, wired through the REAL StockChart: what a member who never adds it
// sees (unchanged: same fetch gate, same overlay props, no panel), what adding it does, the Patterns
// toolbar button and the panel's Auto patterns toggle as two doors onto ONE persisted key
// (`showPatterns` in the per-widget blob via onSettingsPersist), and the released-layer gates.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'

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
      levelsSr: g.payload.levelsSr, candleMarks: g.payload.candleMarks,
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

let persisted = []
function Widget({ initial, sym }) {
  const [settings, setSettings] = useState(initial)
  return <StockChart sym={sym} tf="D" barsOverride={FIXTURE_BARS} settingsOverride={settings}
    onSettingsPersist={(next) => { persisted.push(next); setSettings(next) }} />
}
const lastOverlay = () => g.overlayProps.at(-1)
const lastHook = () => g.hookCalls.at(-1)
const panel = () => screen.queryByTestId('uct-intel-panel')
const patternsUrls = () => fetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/api/patterns/'))

async function mount(initial = {}, sym = 'UCTI') {
  persisted = []
  render(<Widget initial={initial} sym={sym} />)
  await waitFor(() => expect(g.overlayProps.length).toBeGreaterThan(0), { timeout: 5000 })
}

describe('a member who never adds UCT Intelligence — unchanged', () => {
  it('no panel; fetch gated on showPatterns alone; overlay props at their defaults', async () => {
    await mount({ showPatterns: false })
    expect(panel()).toBeNull()
    expect(lastHook().enabled).toBe(false)
    const p = lastOverlay()
    expect(p.enabled).toBe(false)
    expect(p.showDealStatus).toBe(false)
    expect(p.showLabels).toBe(true)
    expect(p.showLearned).toBe(true)
    expect(patternsUrls()).toEqual([])                // no setups request either
  })

  it('Patterns button on (never added): draws exactly as before, still no panel', async () => {
    await mount({ showPatterns: true })
    expect(panel()).toBeNull()
    expect(lastHook().enabled).toBe(true)
    expect(lastOverlay().enabled).toBe(true)
    expect(lastOverlay().showLabels).toBe(true)
    expect(lastOverlay().showDealStatus).toBe(false)
  })

  it('a viewer without the pattern layer gets no panel even with a stored add', async () => {
    g.scope = null
    await mount({ showPatterns: true, uctIntelligence: { added: true } })
    expect(panel()).toBeNull()
    expect(lastHook().enabled).toBe(false)
  })
})

describe('added', () => {
  it('panel shows; deal status still shown and the fetch kept while Auto patterns is off', async () => {
    await mount({ showPatterns: false, uctIntelligence: { added: true, labels: true } })
    expect(panel()).toBeTruthy()
    expect(screen.getByLabelText('Auto patterns').checked).toBe(false)
    expect(lastHook().enabled).toBe(true)
    expect(lastOverlay().enabled).toBe(false)
    expect(lastOverlay().showDealStatus).toBe(true)
  })

  it('Patterns button and Auto patterns toggle write ONE key into the per-widget blob', async () => {
    await mount({ showPatterns: false, uctIntelligence: { added: true, labels: true } })
    fireEvent.click(screen.getByLabelText('Toggle chart patterns overlay'))
    await waitFor(() => expect(screen.getByLabelText('Auto patterns').checked).toBe(true))
    expect(persisted.at(-1).showPatterns).toBe(true)
    expect(lastOverlay().enabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Auto patterns'))
    await waitFor(() => expect(screen.getByLabelText('Toggle chart patterns overlay')
      .getAttribute('aria-pressed')).toBe('false'))
    expect(persisted.at(-1).showPatterns).toBe(false)
    expect(persisted.at(-1).uctIntelligence.added).toBe(true)
  })

  it('labels toggle persists and reaches the overlay', async () => {
    await mount({ showPatterns: true, uctIntelligence: { added: true, labels: true } })
    fireEvent.click(screen.getByLabelText('Pattern labels & numbers'))
    await waitFor(() => expect(lastOverlay().showLabels).toBe(false))
    expect(persisted.at(-1).uctIntelligence.labels).toBe(false)
  })

  it('remove turns everything off and hides the panel', async () => {
    await mount({ showPatterns: true, uctIntelligence: { added: true, labels: true } })
    fireEvent.click(screen.getByLabelText('Remove UCT Intelligence'))
    await waitFor(() => expect(panel()).toBeNull())
    expect(persisted.at(-1).showPatterns).toBe(false)
    expect(persisted.at(-1).uctIntelligence.added).toBe(false)
  })
})

describe('gates — hidden until released, then lit by one signal', () => {
  it('no levels_sr / candle_marks / setups release: none of those toggles exists, no setups fetch', async () => {
    await mount({ showPatterns: true, uctIntelligence: { added: true, setups: true } })
    expect(screen.queryByLabelText('Support & resistance')).toBeNull()
    expect(screen.queryByLabelText('Candlestick patterns')).toBeNull()
    expect(screen.queryByLabelText('Setups')).toBeNull()
    expect(screen.queryByTestId('uct-intel-admin')).toBeNull()
    expect(patternsUrls()).toEqual([])
  })

  it('the server sending levels_sr lights Support & resistance', async () => {
    g.payload = { levelsSr: [] }
    await mount({ showPatterns: true, uctIntelligence: { added: true } })
    expect(screen.getByLabelText('Support & resistance')).toBeTruthy()
    expect(screen.queryByLabelText('Candlestick patterns')).toBeNull()
  })

  it('setups released: the list reads the confirmed setups, with their definitions', async () => {
    g.setups = true
    await mount({ showPatterns: true, uctIntelligence: { added: true, setups: true } }, 'UCTSET')
    await waitFor(() => expect(screen.getAllByTestId('uct-intel-setup').length).toBe(1), { timeout: 5000 })
    expect(screen.getByTestId('uct-intel-setup').textContent).toContain('MACD line crosses above signal line.')
    expect(patternsUrls()).toEqual(['/api/patterns/UCTSET?tf=D&confirmed_only=true'])
  })

  it('admins get the Admin section inside the same panel', async () => {
    g.scope = 'all'
    await mount({ showPatterns: true, uctIntelligence: { added: true } })
    expect(screen.getByTestId('uct-intel-admin')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Learned levels & trendlines'))
    await waitFor(() => expect(lastOverlay().showLearned).toBe(false))
  })
})
