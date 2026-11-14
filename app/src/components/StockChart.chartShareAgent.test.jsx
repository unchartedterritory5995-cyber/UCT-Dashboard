// chartShare.export on the REAL StockChart: the doors the Agent reaches (toolbarApiRef.shareDownload / shareOpen / shareIsOpen,
// through ChartPane → ChartWidget) are the Share popover's OWN: Download PNG is handleDownload (composeScreenshot + downloadBlob,
// the popover's file name) and resolves to that name only once a PNG was made; the popover the Agent opens is the one the
// toolbar's Share button opens. And the popover's Copy Share URL says "URL copied" only once the browser confirmed it.
// Same render mocks as StockChart.uctIntelligenceAgent.test.jsx (no network). Evidence: LOCAL / SIMULATED (jsdom).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState, useRef } from 'react'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { act } from 'react'

const lw = vi.hoisted(() => ({ markerSets: [], clickHandlers: [], priceLines: [], removedLines: [] }))
const shot = vi.hoisted(() => ({ blob: null, downloads: [], composed: 0 }))
vi.mock('./chart/chartScreenshot', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real,
    composeScreenshot: async () => { shot.composed += 1; return shot.blob },
    downloadBlob: (blob, filename) => { shot.downloads.push({ blob, filename }) } }
})

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

beforeEach(() => {
  cleanup()
  shot.blob = new Blob(['png'], { type: 'image/png' }); shot.downloads = []; shot.composed = 0
  vi.stubGlobal('fetch', vi.fn((url) => {
    const body = String(url).includes('/api/bars/') ? { ticker: 'UCTA', bars: FIXTURE_BARS } : {}
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
  }))
})

const { default: StockChart } = await import('./StockChart')
const { buildWorkspaceHost } = await import('../agent/host')
const { registerBuiltins } = await import('../agent/builtins')
const { planOps, collectTargets } = await import('../agent/executor')
const { commitPlan } = await import('../agent/runtime')
const { mergeChartSettings } = await import('./chart/chartDefaults')
registerBuiltins()

// a chart widget's agent adapter over THIS StockChart (ChartWidget → ChartPane → toolbarApiRef), as host.charts reaches it
const live = { settings: null, set: null, tb: null }
function Widget({ initial }) {
  const [settings, setSettings] = useState(initial)
  const tb = useRef(null)
  live.settings = settings; live.set = setSettings; live.tb = tb
  return <StockChart sym="UCTA" tf="D" barsOverride={FIXTURE_BARS} settingsOverride={settings} toolbarApiRef={tb}
    onSettingsPersist={(next) => { setSettings(next) }} />
}
const chartApiById = { current: new Map([['w1', { agent: {
  read: () => ({ chartId: 'w1', tabId: null, groupKey: 'N1', symbol: 'UCTA', tf: 'D', cs: mergeChartSettings(live.settings), stored: live.settings }),
  shareDownload: async () => (await live.tb.current?.shareDownload?.()) || null,
  shareOpen: () => !!live.tb.current?.shareOpen?.(),
  shareIsOpen: () => !!live.tb.current?.shareIsOpen?.(),
  commit: (patch) => { if ('settings' in patch) act(() => live.set(patch.settings)); return true },
} }]]) }
const host = () => buildWorkspaceHost({ chartApiById, getWidgets: () => [{ id: 'w1', type: 'chart', color: 'N1', x: 0, y: 0, w: 24, h: 20, opts: {} }] })
const popover = () => screen.queryByText('Share Chart')
async function mount(initial = null) {
  render(<Widget initial={initial} />)
  await waitFor(() => expect(live.tb.current?.shareDownload).toBeTypeOf('function'), { timeout: 5000 })
}
async function agentShares(output) {
  const pl = planOps(collectTargets(host(), ['chart']), [{ action: 'chartShare.export', target: 'w1', args: { output } }], {}, { surface: 'charts' })
  expect(pl.ok, JSON.stringify(pl.refusals)).toBe(true)
  // NOT wrapped in act(): the runtime polls the chart's RENDERED state (shareIsOpen) while it waits, so React must render
  // between polls exactly as it does in the app (act would hold every render until the commit returned)
  return commitPlan(host(), pl)
}

describe("the doors are the Share popover's own", () => {
  it("shareDownload IS Download PNG: one capture, one download under the popover's file name, resolved to that name", async () => {
    await mount()
    let name
    await act(async () => { name = await live.tb.current.shareDownload() })
    expect(name).toMatch(/^UCTA-D-\d{4}-\d{2}-\d{2}\.png$/)
    expect(shot.composed).toBe(1)
    expect(shot.downloads).toEqual([{ blob: shot.blob, filename: name }])
  })
  it('no PNG composed: resolves null and downloads nothing (the Agent then says it failed)', async () => {
    await mount()
    shot.blob = null
    let name
    await act(async () => { name = await live.tb.current.shareDownload() })
    expect(name).toBeNull()
    expect(shot.downloads).toEqual([])
  })
  it("shareOpen opens the popover the toolbar's Share button opens, and shareIsOpen reads it back", async () => {
    await mount()
    expect(popover()).toBeNull()
    expect(live.tb.current.shareIsOpen()).toBe(false)
    act(() => { live.tb.current.shareOpen() })
    await waitFor(() => expect(popover()).toBeTruthy())
    expect(live.tb.current.shareIsOpen()).toBe(true)
    expect(screen.getByText('Copy Share URL')).toBeTruthy()
  })
})

describe('chartShare.export through the host and the runtime, on this chart', () => {
  it("image: the PNG is downloaded; the chart's settings are untouched; no Undo", async () => {
    await mount({ theme: 'dark' })
    const before = live.settings
    const res = await agentShares('image')
    expect(res.ok, JSON.stringify(res)).toBe(true)
    expect(shot.downloads).toHaveLength(1)
    expect(live.settings).toBe(before)
    expect(res.undo).toBeNull()
  })
  it('link: the Share popover is open (read back), and nothing reached the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    await mount()
    const res = await agentShares('link')
    expect(res.ok, JSON.stringify(res)).toBe(true)
    await waitFor(() => expect(popover()).toBeTruthy())
    expect(writeText).not.toHaveBeenCalled()
    expect(shot.downloads).toEqual([])
  })
  it.each(['image', 'link', 'both'])('HARD CONSTRAINT (%s): no clipboard write and no network share call on the real chart', async (output) => {
    const writeText = vi.fn(() => Promise.resolve()), write = vi.fn(() => Promise.resolve())
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText, write }, configurable: true })
    await mount()
    const n0 = fetch.mock.calls.length
    const res = await agentShares(output)
    expect(res.ok, JSON.stringify(res)).toBe(true)
    expect(writeText).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    const during = fetch.mock.calls.slice(n0).map(c => String(c[0]))
    expect(during.filter(u => /share|shorten|short-?link|permalink|snapshot|upload|state=/i.test(u))).toEqual([])
    // the PNG never leaves the browser: whatever the chart fetched meanwhile carried no image body
    expect(fetch.mock.calls.slice(n0).filter(c => c[1]?.body instanceof Blob || c[1]?.body instanceof FormData)).toEqual([])
  })
  it('image with no PNG made: the runtime reports the failure', async () => {
    await mount()
    shot.blob = null
    const res = await agentShares('image')
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/could not be captured as a PNG/)
  })
})

describe('Copy Share URL says "URL copied" only once the browser confirmed it', () => {
  const openAndCopy = async () => {
    act(() => { live.tb.current.shareOpen() })
    await waitFor(() => expect(popover()).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getByText('Copy Share URL')) })
  }
  it('confirmed: "URL copied"', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    await mount()
    await openAndCopy()
    expect(writeText).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByText(/URL copied/)).toBeTruthy())
  })
  it('refused by the browser (no gesture / permission): "the link was not copied", never "URL copied"', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('NotAllowedError')))
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    await mount()
    await openAndCopy()
    await waitFor(() => expect(screen.getByText(/the link was not copied/)).toBeTruthy())
    expect(screen.queryByText(/URL copied/)).toBeNull()
  })
})
