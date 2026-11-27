// BEHAVIOURAL rails for the lookback (3M / 6M / YTD / 1Y / 5Y / Origin) bar's geometry, on the real
// StockChart with lightweight-charts stubbed:
//
// 1. IT FIRST APPEARS WHERE IT STAYS. Measured in WebKit (route-mocked /api): the bar painted at its
//    CSS fallback, then at the time-axis fallback, then jumped up when the separate Volume pane
//    mounted and the host's `--time-axis-min-height` landed (Ticker Hub 390: y 461 -> 415; 834:
//    863 -> 787; desktop TickerPopup 666 -> 611; /charts 1200: 674 -> 519). Now it is hidden
//    (`.rangeBar:not([data-placed])`) until `lookbackPlacementSettled` says the anchor is final,
//    or `LOOKBACK_REVEAL_MAX_MS` passes. After: one position, first paint, at every one of those.
// 2. ITS WIDTH CAP COMES FROM THE MEASURED PRICE SCALE. The hub's scrolling bar was capped at a
//    guessed `100% - 96px`; StockChart now publishes `priceScale('right').width()` as
//    `--price-axis-w` on its wrapper, and the cap reads that (StockChart.module.css).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

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
const { LOOKBACK_REVEAL_MAX_MS, lookbackPlacementSettled } = await import('./chart/chromeGeometry')
const { mergeChartSettings } = await import('./chart/chartDefaults')
const { addInstance, setInstanceInput } = await import('./chart/engine/instanceControls')
const registry = await import('./chart/engine/nativeRegistry')
const { lastCreatedInstance } = await import('./chart/discoveryCatalog')
const { volumePaneRequired, nativeVolumeOwnsPane } = await import('./chart/engine/volumePresentation')

const bars = Array.from({ length: 60 }, (_, i) => {
  const t = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t, o: 100, h: 101, l: 99, c: 100 + (i % 5), v: 1000 + i }
})
const frames = (n = 4) => act(async () => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)) })
const rangeBar = () => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '3M')
  return b ? b.parentElement : null
}
const mount = () => render(<StockChart sym="ENPH" tf="D" barsOverride={bars} showRangeSelector volumeSeparatePane />)

// jsdom lays nothing out, so every clientHeight is 0 and the sampler (which places nothing on a
// zero-height chart) would never run its placement branch: give elements a height.
const realClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
afterEach(() => { Object.defineProperty(Element.prototype, 'clientHeight', realClientHeight) })
beforeEach(() => {
  cleanup()
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => 400 })
  Object.assign(S, { paneHeights: [300], volPane: null, axisH: 28, axisW: 76, sizeSubs: [] })
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

describe('the lookback bar appears only at the anchor it keeps', () => {
  it('while the separate Volume pane does not exist yet, the bar is rendered but not placed', async () => {
    mount()
    await vi.waitFor(() => expect(rangeBar()).not.toBeNull(), { timeout: 5000 })
    await frames()
    expect(rangeBar().hasAttribute('data-placed')).toBe(false)
  })

  it('once the volume pane exists WITH a height, the very next frames place it', async () => {
    mount()
    await vi.waitFor(() => expect(rangeBar()).not.toBeNull(), { timeout: 5000 })
    await frames()
    S.paneHeights = [300, 0]; S.volPane = 1 // created, not laid out yet
    await frames()
    expect(rangeBar().hasAttribute('data-placed')).toBe(false)
    S.paneHeights = [240, 60]
    await frames()
    expect(rangeBar().hasAttribute('data-placed')).toBe(true)
  })

  it('a host axis reserve that has not landed yet holds it hidden too', async () => {
    const style = document.createElement('style')
    style.textContent = '.axis-host { --time-axis-min-height: 80px; }'
    document.head.appendChild(style)
    try {
      S.paneHeights = [240, 60]; S.volPane = 1; S.axisH = 28
      render(<StockChart sym="ENPH" tf="D" barsOverride={bars} showRangeSelector volumeSeparatePane className="axis-host" />)
      await vi.waitFor(() => expect(rangeBar()).not.toBeNull(), { timeout: 5000 })
      await frames()
      expect(rangeBar().hasAttribute('data-placed')).toBe(false)
      S.axisH = 80
      await frames()
      expect(rangeBar().hasAttribute('data-placed')).toBe(true)
    } finally { style.remove() }
  })

  it('a volume pane that never arrives cannot keep it hidden: the time limit, and only it, reveals it', async () => {
    // The clock is the one the sampler reads, moved by the test: no real wait, and nothing but
    // the elapsed time changes between the three reads.
    const realNow = performance.now.bind(performance)
    let skew = 0
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => realNow() + skew)
    try {
      mount()
      await vi.waitFor(() => expect(rangeBar()).not.toBeNull(), { timeout: 5000 })
      await frames()
      expect(rangeBar().hasAttribute('data-placed')).toBe(false)
      skew = LOOKBACK_REVEAL_MAX_MS - 700 // real time since the bar mounted is well under 700ms here
      await frames()
      expect(rangeBar().hasAttribute('data-placed'), 'revealed before the limit').toBe(false)
      skew = LOOKBACK_REVEAL_MAX_MS + 200
      await frames()
      expect(rangeBar().hasAttribute('data-placed')).toBe(true)
    } finally { spy.mockRestore() }
  })

  it('a GUEST-only volume pane (native Volume removed, an MA sent to it) does not hold the bar: there is no volume series, so the fallback anchor is final', async () => {
    // Built through the shipped writers, as volumePaneResidency.test.js does.
    let cs = mergeChartSettings(JSON.stringify({ volume: { visible: true, separatePane: true } }))
    const added = addInstance(cs, 'movingAverage', registry)
    const id = lastCreatedInstance(cs, added).instanceId
    cs = setInstanceInput(added, id, 'source', 'volume', registry)
    const gone = { ...cs, volume: { ...cs.volume, removed: true } }
    const opts = { cs: gone, instances: gone.indicatorInstances, shown: false }
    // PREMISE: the pane is required (a guest holds it) while the native bars are not in it.
    expect(volumePaneRequired(opts)).toBe(true)
    expect(nativeVolumeOwnsPane(opts)).toBe(false)
    const realNow = performance.now.bind(performance)
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => realNow()) // the limit never passes here
    try {
      render(<StockChart sym="ENPH" tf="D" barsOverride={bars} showRangeSelector settingsOverride={gone} />)
      await vi.waitFor(() => expect(rangeBar()).not.toBeNull(), { timeout: 5000 })
      await frames()
      expect(rangeBar().hasAttribute('data-placed'), 'hidden waiting for a volume series that will never exist').toBe(true)
    } finally { spy.mockRestore() }
  })

  it('the stylesheet hides exactly the unplaced bar (the wire between the attribute and the paint)', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/StockChart.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/(^|\n)\.rangeBar:not\(\[data-placed\]\)\s*\{\s*visibility:\s*hidden;\s*\}/)
  })
})

// ⚡ (2026-11-27, the board switch) THE CHROME SAMPLER'S FIRST PASS RUNS IN THE FRAME, NOT IN THE COMMIT. It ran inside
// the mount's passive effects: its first layout read (`container.clientHeight`) forced the freshly committed board's
// style and layout in the middle of the click task, and its writes (`--price-pane-top`, `--lookback-bottom` on the
// wrapper, inherited by the whole chart) made the next effect's read restyle the chart again (trace: 238 elements,
// 1.6-3.2 ms, twice per chart per switch). It now waits for the next animation frame (before that frame paints), so
// it measures the layout the frame computes anyway. These rails drive the frames by hand.
describe('the chrome sampler measures in the frame, not inside the commit', () => {
  let queue = []
  const flushFrame = () => act(() => { const due = queue; queue = []; for (const fn of due) fn(performance.now()) })
  beforeEach(() => {
    queue = []
    vi.stubGlobal('requestAnimationFrame', (fn) => { queue.push(fn); return queue.length })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(() => { vi.unstubAllGlobals() })

  // The chart is ready (the chartReady effects subscribed) with NO frame run yet.
  const mountReady = async () => {
    const r = mount()
    await vi.waitFor(() => expect(S.sizeSubs.length).toBeGreaterThan(0), { timeout: 5000 })
    await act(async () => {})
    return r.container.firstElementChild
  }

  it('nothing is placed until the frame runs; the first frame places it', async () => {
    const wrapper = await mountReady()
    expect(wrapper.style.getPropertyValue('--lookback-bottom'), 'measured inside the commit').toBe('')
    expect(queue.length, 'the first pass waits for a frame').toBeGreaterThan(0)
    await flushFrame()
    expect(wrapper.style.getPropertyValue('--lookback-bottom')).toMatch(/^\d+px$/)
  })

  it('an unarranged chart (Price on top) leaves --price-pane-top unset: every reader falls back to 0px', async () => {
    const wrapper = await mountReady()
    for (let i = 0; i < 4; i++) await flushFrame()
    expect(wrapper.style.getPropertyValue('--lookback-bottom')).toMatch(/^\d+px$/) // the sampler did run
    expect(wrapper.style.getPropertyValue('--price-pane-top')).toBe('')
  })

  it('every reader of --price-pane-top falls back to 0px (what makes leaving it unset identical)', () => {
    const walk = (dir) => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? walk(p) : [p]
    })
    const files = walk(join(process.cwd(), 'src')).filter((p) => /\.(css|jsx?)$/.test(p) && !/\.test\./.test(p))
    let readers = 0
    for (const f of files) {
      // comments mention the variable (`var(--price-pane-top)` in prose); only code reads it
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      for (const m of src.matchAll(/var\(--price-pane-top([^)]*)\)/g)) {
        readers++
        expect(m[1].trim(), `${f}: ${m[0]}`).toBe(', 0px')
      }
    }
    expect(readers).toBeGreaterThan(3)
  })

  it('the sampler writes --lookback-bottom AFTER its layout reads (a changed value is not flushed mid-pass)', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/StockChart.jsx'), 'utf8')
    const start = src.indexOf('const revealRangeBar = (rb) =>')
    const end = src.indexOf('const loop = createAdaptiveFrameLoop({ tick })', start)
    const body = src.slice(start, end)
    const write = body.indexOf("setProperty('--lookback-bottom'")
    expect(write).toBeGreaterThan(0)
    for (const read of ['stack.getBoundingClientRect()', 'leg.getBoundingClientRect()', 'pinPriceTable(priceTableRef.current)', 'paneLegendRefs.current.forEach(pinPaneLegend)']) {
      const at = body.indexOf(read)
      expect(at, read).toBeGreaterThan(0)
      expect(write, `--lookback-bottom is written before ${read}`).toBeGreaterThan(at)
    }
  })
})

describe('the price-scale width is published for the hub range bar cap', () => {
  it('the wrapper carries --price-axis-w = priceScale("right").width(), and follows it', async () => {
    const { container } = mount()
    await vi.waitFor(() => expect(S.sizeSubs.length).toBeGreaterThan(0), { timeout: 5000 })
    const wrapper = container.firstElementChild
    await vi.waitFor(() => expect(wrapper.style.getPropertyValue('--price-axis-w')).toBe('76px'), { timeout: 5000 })
    S.axisW = 93 // a four-digit price widens the scale
    act(() => { S.sizeSubs.forEach((fn) => fn()) })
    expect(wrapper.style.getPropertyValue('--price-axis-w')).toBe('93px')
  })

  it('the hub cap reads that variable, not a guessed width', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/StockChart.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const m = /:global\(\[data-ticker-hub-chart\]\) \.rangeBar \{([^}]*)\}/.exec(css)
    expect(m, 'hub .rangeBar rule').toBeTruthy()
    expect(m[1]).toMatch(/max-width:\s*calc\(100% - 8px - var\(--price-axis-w, 88px\) - 4px\)/)
  })
})

describe('lookbackPlacementSettled, the pure rule', () => {
  it('no reserve requested and no volume pane expected: settled at once, whatever the axis reads', () => {
    expect(lookbackPlacementSettled({ volumePaneExpected: false })).toBe(true)
    expect(lookbackPlacementSettled({ volumePaneExpected: false, timeAxisMinHeight: 0, timeAxisHeight: 0 })).toBe(true)
  })
  it('a reserve requested: not settled until the axis reaches it', () => {
    expect(lookbackPlacementSettled({ volumePaneExpected: false, timeAxisMinHeight: 80, timeAxisHeight: 28 })).toBe(false)
    expect(lookbackPlacementSettled({ volumePaneExpected: false, timeAxisMinHeight: 80, timeAxisHeight: 80 })).toBe(true)
  })
  it('volume expected: null index or a zero-height pane waits; a laid-out pane settles', () => {
    expect(lookbackPlacementSettled({ volumePaneExpected: true, volumeIndex: null, paneHeights: [300] })).toBe(false)
    expect(lookbackPlacementSettled({ volumePaneExpected: true, volumeIndex: 1, paneHeights: [300, 0] })).toBe(false)
    expect(lookbackPlacementSettled({ volumePaneExpected: true, volumeIndex: 1, paneHeights: [240, 60] })).toBe(true)
  })
  it('volume at the very top (index 0) takes the fallback by design, so it is settled even with no height read', () => {
    expect(lookbackPlacementSettled({ volumePaneExpected: true, volumeIndex: 0, paneHeights: [] })).toBe(true)
  })
})
