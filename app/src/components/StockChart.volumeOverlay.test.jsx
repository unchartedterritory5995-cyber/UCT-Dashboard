// app/src/components/StockChart.volumeOverlay.test.jsx
//
// ─── /charts: VOLUME IN ITS OWN PANE OR OVERLAID ON PRICE (owner 11-16) ─────
//
// The /charts pane look (paneLook.js) passes `volumePaneByDefault`: Volume draws in
// its own pane unless the member chose ⋯ → Display in → "Overlay on price", saved as
// `cs.volume.displayIn`. Overlay is TradingView's default look — the bars sit in the
// bottom ~22% of the PRICE pane, behind the candles, on the invisible overlay scale,
// at reduced opacity, with no tag on the price axis — and the legend row moves into
// the price stack. These cases drive the real component against a recording LWC double.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import bars200 from '../pages/parityBars/ramp200.json'

const H = vi.hoisted(() => ({
  addSeriesCalls: [],
  crosshairHandlers: [],
  reset() { H.addSeriesCalls.length = 0; H.crosshairHandlers.length = 0 },
}))

vi.mock('lightweight-charts', () => {
  const makeSeries = (ctor, options) => {
    const s = {
      __ctor: ctor,
      __options: { ...(options || {}) },
      __scale: [],
      __data: null,
      setData: (d) => { s.__data = d },
      update: () => {},
      applyOptions: (o) => { Object.assign(s.__options, o || {}) },
      priceScale: () => ({ applyOptions: (o) => { s.__scale.push(o) }, width: () => 60 }),
      createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => s.__options,
      moveToPane: () => {}, getPane: () => ({ getHeight: () => 300 }),
      dataByIndex: () => null,
    }
    return s
  }
  const timeScaleBase = {
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {},
    getVisibleLogicalRange: () => null, getVisibleRange: () => null, setVisibleRange: () => {},
    scrollToPosition: () => {}, scrollPosition: () => 0,
    timeToCoordinate: () => 0, coordinateToTime: () => null,
    logicalToCoordinate: () => 0, coordinateToLogical: () => 0,
    options: () => ({}), width: () => 600, height: () => 24, barSpacing: () => 6,
  }
  const timeScale = new Proxy(timeScaleBase, {
    get: (t, p) => {
      if (p in t) return t[p]
      if (typeof p === 'symbol' || p === 'then') return undefined
      return () => undefined
    },
  })
  const chart = {
    addSeries: (ctor, options, paneIndex) => {
      const s = makeSeries(ctor, options)
      H.addSeriesCalls.push({ ctor, options, paneIndex, series: s })
      return s
    },
    addCustomSeries: (_impl, options, paneIndex) => {
      const s = makeSeries('custom', options)
      H.addSeriesCalls.push({ ctor: 'custom', options, paneIndex, series: s })
      return s
    },
    removeSeries: () => {},
    applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {}, width: () => 60 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: (fn) => { H.crosshairHandlers.push(fn) },
    unsubscribeCrosshairMove: (fn) => {
      const i = H.crosshairHandlers.indexOf(fn); if (i >= 0) H.crosshairHandlers.splice(i, 1)
    },
    subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: 'CandlestickSeries', HistogramSeries: 'HistogramSeries', LineSeries: 'LineSeries',
    AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries', BarSeries: 'BarSeries',
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
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

const CANVAS_2D_NOOPS = [
  'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc',
  'stroke', 'fill', 'save', 'restore', 'setLineDash', 'translate', 'scale', 'rotate', 'setTransform',
  'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'rect', 'clip', 'drawImage', 'putImageData',
]
HTMLCanvasElement.prototype.getContext = function getContext() {
  const ctx = {
    canvas: null, measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop: () => {} }), getImageData: () => ({ data: [] }),
  }
  for (const m of CANVAS_2D_NOOPS) ctx[m] = () => {}
  return ctx
}

beforeEach(() => {
  cleanup()
  H.reset()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

const { default: StockChart, TV_VOLUME_OVERLAY_MARGINS } = await import('./StockChart')
const { mergeChartSettings } = await import('./chart/chartDefaults')
const { PANE_LOOK } = await import('./chart/pane/paneLook')

const BARS = bars200.bars
const isVol = (c) => c.ctor === 'HistogramSeries' || c.ctor === 'custom'
const volCalls = () => H.addSeriesCalls.filter(isVol)
const lastVol = () => volCalls().at(-1)
// The volume MA: a LineSeries on the volume formatter's scale (the only line carrying it).
const volMaCalls = () => H.addSeriesCalls.filter((c) => c.ctor === 'LineSeries' && c.options && c.options.priceFormat && c.options.priceFormat.type === 'custom' && c.options.autoscaleInfoProvider)

const chartsLook = ({ volume = {}, ...rest } = {}) => (
  <StockChart
    sym="AAPL" tf="D" barsOverride={BARS} alwaysShowLegend
    {...PANE_LOOK}
    volumePaneHeightPct={12}
    settingsOverride={mergeChartSettings({ volume: { maPeriod: 50, ...volume }, header: { legendMode: 'always' } })}
    onSettingsPersist={() => {}}
    {...rest} />
)

const eventAt = () => {
  const candle = H.addSeriesCalls.find((c) => c.ctor === 'CandlestickSeries')
  const seriesData = new Map([[candle.series, { open: 1, high: 2, low: 0.5, close: 1.5 }]])
  const vol = lastVol()
  if (vol) seriesData.set(vol.series, { value: 2_000_000 })
  return { time: BARS.at(-1).t, point: { x: 100, y: 100 }, logical: BARS.length - 1, seriesData }
}
const volStrip = (view) => view.container.querySelector('[class*="volLegend" i]')

describe('/charts volume — own pane by default', () => {
  it('⭐ PANE_LOOK defaults the pane and no longer FIXES it', () => {
    expect(PANE_LOOK.volumePaneByDefault).toBe(true)
    expect(PANE_LOOK.volumeSeparatePane).toBeUndefined()
  })

  it('no choice saved (every old blob says separatePane:false) → its own pane, on the right axis', async () => {
    render(chartsLook({ volume: { separatePane: false } }))
    await vi.waitFor(() => expect(lastVol()).toBeTruthy())
    const v = lastVol()
    expect(v.paneIndex).toBe(1)
    expect(v.options.priceScaleId).toBe('right')
  })
})

describe('/charts volume — Overlay on price (TradingView style)', () => {
  it('⭐ the bars sit in the PRICE pane on the invisible overlay scale, bottom ~22%, no axis tag', async () => {
    render(chartsLook({ volume: { displayIn: 'price' } }))
    await vi.waitFor(() => expect(lastVol()).toBeTruthy())
    const v = lastVol()
    expect(v.paneIndex, 'volume was given a pane of its own').toBe(0)
    expect(v.options.priceScaleId, 'volume took a visible axis').toBe('')
    expect(v.options.lastValueVisible).toBe(false)
    expect(v.options.priceLineVisible).toBe(false)
    expect(volCalls().every((c) => c.paneIndex === 0), 'a volume pane was created anyway').toBe(true)
    await vi.waitFor(() => expect(v.series.__scale.some((o) => o && o.scaleMargins)).toBe(true))
    const m = v.series.__scale.filter((o) => o && o.scaleMargins).at(-1).scaleMargins
    expect(m).toEqual(TV_VOLUME_OVERLAY_MARGINS)
    expect(m.top).toBeGreaterThanOrEqual(0.75)
    expect(m.top).toBeLessThanOrEqual(0.8)
    expect(m.bottom).toBe(0)
  })

  it('the bars are drawn at reduced opacity — setData AND live update() go through the dimmer', async () => {
    render(chartsLook({ volume: { displayIn: 'price' } }))
    await vi.waitFor(() => expect(lastVol()?.series.__data?.length).toBeGreaterThan(0))
    const s = lastVol().series
    expect(s.__data.every((p) => /rgba\(.*,0\.5\)$/.test(String(p.color).replace(/\s/g, '')))).toBe(true)
    expect(s.__uctDimmed).toBe(true)
    s.setData([{ time: 1, value: 1, color: '#ff0000' }, { time: 2 }])
    expect(s.__data[0].color).toBe('rgba(255,0,0,0.5)')
    expect(s.__data[1]).toEqual({ time: 2 })   // whitespace passes through untouched
  })

  it('dimVolumeSeries wraps update() for the live writers, once', async () => {
    const { dimVolumeSeries } = await import('./StockChart')
    const got = []
    const s = { setData: () => {}, update: (p) => got.push(p) }
    dimVolumeSeries(dimVolumeSeries(s))
    s.update({ time: 1, value: 5, color: 'rgba(0,128,0,0.8)' })
    expect(got[0].color).toBe('rgba(0,128,0,0.4)')
    s.update({ time: 2, value: 5, color: '#00ff0080' })
    expect(got[1].color).toMatch(/^rgba\(0,255,0,0\.25/)
  })

  it('the volume MA overlays the same way — price pane, invisible scale', async () => {
    render(chartsLook({ volume: { displayIn: 'price' } }))
    await vi.waitFor(() => expect(volMaCalls().length).toBeGreaterThan(0))
    const ma = volMaCalls().at(-1)
    expect(ma.paneIndex).toBe(0)
    expect(ma.options.priceScaleId).toBe('')
  })

  it('⭐ the legend row lives in the PRICE stack, not a volume-pane strip', async () => {
    const view = render(chartsLook({ volume: { displayIn: 'price' } }))
    await vi.waitFor(() => expect(lastVol()).toBeTruthy())
    const row = await vi.waitFor(() => {
      act(() => { for (const fn of H.crosshairHandlers) fn(eventAt()) })
      const r = view.container.querySelector('[data-legend-row="volume"]')
      expect(r, 'the volume row is gone from the legend').toBeTruthy()
      return r
    }, { timeout: 3000 })
    const strip = volStrip(view)
    expect(!strip || !strip.contains(row), 'the volume row is still in a volume-pane strip').toBe(true)
  })

  // ⭐ Owner 11-16 — overlaid on price, Volume's bars sit along the BOTTOM of the price pane, so
  // its row is listed BELOW the moving averages, not above them.
  // The price stack's rows, top to bottom, by the name each row's control carries (the default
  // averages are engine chips, Volume a LegendRow: both say `<name> options`).
  const priceStackNames = (view) => {
    const vol = view.container.querySelector('[data-legend-row="volume"]')
    const stack = vol && vol.parentElement
    return stack ? [...stack.children].map((el) => el.getAttribute('aria-label')).filter(Boolean)
      .map((l) => l.replace(/ options$/, '')) : []
  }
  const stackOf = async (view) => vi.waitFor(() => {
    act(() => { for (const fn of H.crosshairHandlers) fn(eventAt()) })
    const names = priceStackNames(view)
    expect(names, 'no moving-average rows beside the volume row').toContain('EMA 9')
    return names
  }, { timeout: 3000 })

  it('⭐ the overlaid Volume row is listed LAST, below EMA 9 / EMA 20 / SMA 50 / SMA 200', async () => {
    const view = render(chartsLook({ volume: { displayIn: 'price' } }))
    await vi.waitFor(() => expect(lastVol()).toBeTruthy())
    const names = await stackOf(view)
    expect(names).toEqual(['EMA 9', 'EMA 20', 'SMA 50', 'SMA 200', 'Volume'])
  })

  it('…even when a saved price-pane row order lists Volume first (its place is where its bars are drawn)', async () => {
    const view = render(chartsLook({ volume: { displayIn: 'price' },
      settingsOverride: mergeChartSettings({
        volume: { maPeriod: 50, displayIn: 'price' }, header: { legendMode: 'always' },
        paneSeriesOrder: { price: ['volume'] },
      }) }))
    await vi.waitFor(() => expect(lastVol()).toBeTruthy())
    const names = await stackOf(view)
    expect(names.at(-1), `the volume row is not last: ${names.join(', ')}`).toBe('Volume')
    expect(names.slice(0, 4)).toEqual(['EMA 9', 'EMA 20', 'SMA 50', 'SMA 200'])
  })

  it('…and in Own pane mode it lives in the volume pane’s strip (the contrast)', async () => {
    const view = render(chartsLook())
    await vi.waitFor(() => expect(lastVol()).toBeTruthy())
    const row = await vi.waitFor(() => {
      act(() => { for (const fn of H.crosshairHandlers) fn(eventAt()) })
      const s = volStrip(view)
      const r = s && s.querySelector('[data-legend-row="volume"]')
      expect(r, 'no volume row in the volume-pane strip').toBeTruthy()
      return r
    }, { timeout: 3000 })
    expect(row).toBeTruthy()
  })

  it('⭐ switching back to Own pane recreates the bars in their own pane', async () => {
    const view = render(chartsLook({ volume: { displayIn: 'price' } }))
    await vi.waitFor(() => expect(lastVol()).toBeTruthy())
    expect(lastVol().paneIndex).toBe(0)
    view.rerender(chartsLook({ volume: { displayIn: 'pane' } }))
    await vi.waitFor(() => expect(lastVol().paneIndex).toBe(1))
    expect(lastVol().options.priceScaleId).toBe('right')
    // the own-pane series is never wrapped by the overlay dimmer
    expect(lastVol().series.__uctDimmed).toBeUndefined()
  })

  it('⛔ a host that FIXES the pane (volumeSeparatePane) ignores the choice', async () => {
    render(chartsLook({ volume: { displayIn: 'price' }, volumeSeparatePane: true }))
    await vi.waitFor(() => expect(lastVol()).toBeTruthy())
    expect(lastVol().paneIndex).toBe(1)
  })
})
