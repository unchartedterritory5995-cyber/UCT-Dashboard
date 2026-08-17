import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import bars200 from '../../../../pages/parityBars/ramp200.json'
import { legendTextOf } from './legendProbe'

// ─── THE THREE LEGEND MODES, DRIVEN THROUGH THE REAL CHART ───────────────────
//
// ⛔ THE PIXEL GATE CANNOT SEE ANY OF THIS, for the same reason the sibling
// legend suites say so: a headless capture has no cursor and no click, and
// `ChartRender.jsx` CSS-hides `[class*="legend"]` from the export outright. A
// mode that silently never draws the legend, and a mode that draws it on every
// hover regardless of the setting, are both a 0-pixel diff.
//
// ⭐ EVERY CASE HERE CARRIES A CONTROL, because the assertions are mostly
// ABSENCE assertions ("hovering draws nothing") and an absence assertion passes
// just as happily against a chart that never rendered at all. The control is
// always the SAME events under `legendMode: 'always'` — if the harness can make
// a legend appear on hover, then its non-appearance in `'click'` mode is the
// mode working rather than the test being vacuous.

const H = vi.hoisted(() => ({
  addSeriesCalls: [],
  crosshairHandlers: [],
  clickHandlers: [],
  chartContainers: [],
  reset() {
    H.addSeriesCalls.length = 0
    H.crosshairHandlers.length = 0
    H.clickHandlers.length = 0
    H.chartContainers.length = 0
  },
}))

vi.mock('lightweight-charts', () => {
  const makeSeries = (ctor, options) => {
    const s = {
      __ctor: ctor,
      __options: { ...(options || {}) },
      setData: () => {}, update: () => {},
      applyOptions: (o) => { Object.assign(s.__options, o || {}) },
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
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
    options: () => ({}), width: () => 600, height: () => 40, barSpacing: () => 6,
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
    priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: (fn) => { H.crosshairHandlers.push(fn) },
    unsubscribeCrosshairMove: (fn) => {
      const i = H.crosshairHandlers.indexOf(fn); if (i >= 0) H.crosshairHandlers.splice(i, 1)
    },
    // ⭐ CAPTURED, NOT SWALLOWED — the sibling suites stub this to a no-op, which
    // is exactly why none of them could have caught a click-pin that never fires.
    subscribeClick: (fn) => { H.clickHandlers.push(fn) },
    unsubscribeClick: (fn) => {
      const i = H.clickHandlers.indexOf(fn); if (i >= 0) H.clickHandlers.splice(i, 1)
    },
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: (el) => { H.chartContainers.push(el); return chart },
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: 'CandlestickSeries', HistogramSeries: 'HistogramSeries', LineSeries: 'LineSeries',
    AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries', BarSeries: 'BarSeries',
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
  }
})

vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../../../../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../../../../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../../../../context/AuthContext', () => ({
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

const { default: StockChart } = await import('../../../StockChart')
const { mergeChartSettings } = await import('../../chartDefaults')

const BARS = bars200.bars

/** A chart carrying the workspace's own props — `alwaysShowLegend` is what
 *  `/charts` passes, and it is the flag `'click'` mode has to overrule. */
const draw = (legendMode) => render(
  <StockChart
    sym="AAPL" tf="D" barsOverride={BARS} alwaysShowLegend
    settingsOverride={mergeChartSettings({ header: { legendMode } })}
  />,
)

/** A crosshair/click event over the candle series, with a nameable close.
 *  Volume is included so the VOLUME PANE's own readout has something to draw —
 *  see the regression suite at the bottom of this file. */
const eventAt = (close) => {
  const candle = H.addSeriesCalls.find(c => c.ctor === 'CandlestickSeries')
  expect(candle, 'no candle series — the chart never drew, so this case is vacuous').toBeTruthy()
  const seriesData = new Map([[candle.series, { open: 1, high: 2, low: 0.5, close }]])
  const vol = H.addSeriesCalls.find(c => c.ctor === 'HistogramSeries')
  if (vol) seriesData.set(vol.series, { value: 1_000_000 })
  return { time: BARS.at(-1).t, point: { x: 100, y: 100 }, logical: BARS.length - 1, seriesData }
}

/** Pump the rAF/timer coalescing the legend runs on and read the settled text. */
const pump = async (fn) => {
  for (let i = 0; i < 12; i++) {
    // Sequential: each pass must observe the DOM the previous one settled into.
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { fn(); await new Promise(r => setTimeout(r, 20)) })
  }
}

const hover = (view, close) => pump(() => {
  for (const fn of [...H.crosshairHandlers]) fn(eventAt(close))
})
const clickCandle = (view, close) => pump(() => {
  for (const fn of [...H.clickHandlers]) fn(eventAt(close))
})
const clickEmpty = () => pump(() => {
  // Lightweight-charts fires a click with no `time` when the user clicks off the
  // series — the same shape the crosshair handler already treats as "left".
  for (const fn of [...H.clickHandlers]) fn({ time: undefined, point: { x: 5, y: 5 }, seriesData: new Map() })
})

describe("legendMode 'always' — the control, and today's behavior", () => {
  it('draws the legend on hover', async () => {
    const view = draw('always')
    await hover(view, 1.5)
    expect(legendTextOf(view)).toMatch(/O\s*1/)
  })
})

describe("legendMode 'click' — the chart stays clean until a candle is clicked", () => {
  it('a HOVER draws no legend at all', async () => {
    const view = draw('click')
    await hover(view, 1.5)
    expect(legendTextOf(view)).toBe('')
  })

  it('a CLICK on a candle pins the legend to that bar', async () => {
    const view = draw('click')
    await clickCandle(view, 1.5)
    expect(legendTextOf(view)).toMatch(/O\s*1/)
    expect(legendTextOf(view)).toContain('1.50')
  })

  it('once pinned, moving the crosshair leaves the legend on the CLICKED bar', async () => {
    // ⭐ THE ASSERTION THAT SEPARATES "PINNED" FROM "TURNED ON". A click that
    // merely re-enabled the hover legend would pass every other case in this
    // block and then follow the cursor — which is the behavior the owner
    // explicitly did not pick.
    const view = draw('click')
    await clickCandle(view, 1.5)
    await hover(view, 9.9)
    expect(legendTextOf(view)).toContain('1.50')
    expect(legendTextOf(view)).not.toContain('9.90')
  })

  it('clicking empty space clears the pin', async () => {
    const view = draw('click')
    await clickCandle(view, 1.5)
    expect(legendTextOf(view)).toMatch(/O\s*1/)
    await clickEmpty()
    expect(legendTextOf(view)).toBe('')
  })

  it('Escape clears the pin', async () => {
    const view = draw('click')
    await clickCandle(view, 1.5)
    expect(legendTextOf(view)).toMatch(/O\s*1/)
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
      await new Promise(r => setTimeout(r, 20))
    })
    expect(legendTextOf(view)).toBe('')
  })

  it('`alwaysShowLegend` does NOT reinstate it — the mode overrules the host prop', async () => {
    // ⛔ THE REGRESSION THIS EXISTS FOR. `/charts` passes `alwaysShowLegend`, and
    // two separate code paths seed the legend from the LATEST bar whenever the
    // cursor is off the chart. Miss either one and 'click' mode looks like it
    // works on a popup and does nothing at all on the workspace — the surface
    // the owner actually asked about.
    const view = draw('click')
    // No hover, no click: just let every mount effect run.
    await pump(() => {})
    expect(legendTextOf(view)).toBe('')
  })
})

describe("legendMode 'off' — never drawn", () => {
  it('neither a hover nor a click draws it', async () => {
    const view = draw('off')
    await hover(view, 1.5)
    expect(legendTextOf(view)).toBe('')
    await clickCandle(view, 1.5)
    expect(legendTextOf(view)).toBe('')
  })
})

// ─── 🔴 REGRESSION: A CLICK HANDLER THAT THROWS TAKES ITS NEIGHBOURS DOWN ────
//
// `subscribeCrosshairMove` always hands over a `seriesData` Map, so the payload
// builder read `param.seriesData.get(...)` unguarded for as long as a HOVER was
// its only caller. Routing clicks through it broke that assumption: a click param
// without `seriesData` threw, and because LWC runs its click subscribers in a
// list, the throw took out every handler registered after this one.
//
// ⛔ THE DAMAGE WAS TWO SUBSCRIBERS AWAY FROM THE LEGEND: `StockChart` also
// subscribes clicks for desk markers, earnings badges and callouts, and the
// symptom that surfaced was "clicking a desk marker navigates nowhere". A new
// subscriber on a shared bus owes the bus a handler that cannot throw.
describe('a click param without seriesData is survivable', () => {
  it('does not throw, and leaves the chart usable', async () => {
    const view = draw('click')
    expect(H.clickHandlers.length,
      'nothing subscribed to click — this case is vacuous').toBeGreaterThan(0)
    await act(async () => {
      for (const fn of [...H.clickHandlers]) {
        // Exactly the shape that crashed: a real point, a real time, no map.
        fn({ time: BARS.at(-1).t, point: { x: 100, y: 100 } })
      }
      await new Promise(r => setTimeout(r, 20))
    })
    // And the chart still answers a normal click afterwards.
    await clickCandle(view, 1.5)
    expect(legendTextOf(view)).toMatch(/O\s*1/)
  })
})

// ─── 🔴 REGRESSION: THE VOLUME PANE HAS ITS OWN READOUT ──────────────────────
//
// MEASURED ON SCREEN 2026-08-16, and by NOTHING in 5,110 green chart tests: the
// first implementation gated `crosshairData` itself on the mode. That object is
// not the OHLC legend — it is the shared readout payload, and the volume pane's
// "$ Vol · Avg 50D" strip renders off `crosshairData.dollarVol`. So switching the
// OHLC legend to 'on click' silently blanked an unrelated readout that has its
// own `volume.labelVisible` setting.
//
// ⭐ The lesson is the assertion: the mode belongs on the LEGEND'S RENDER GATE,
// never on the data other consumers share. These two cases fail the moment
// anyone moves it back.
const volStripText = (view) => {
  const el = view.container.querySelector('[class*="volLegend" i]')
  return el ? el.textContent : ''
}

/** The workspace recipe, with the volume pane split out so the strip renders. */
const drawWithVolPane = (legendMode) => render(
  <StockChart
    sym="AAPL" tf="D" barsOverride={BARS} alwaysShowLegend volumeSeparatePane
    settingsOverride={mergeChartSettings({ header: { legendMode } })}
  />,
)

describe("the volume pane's readout is NOT the OHLC legend", () => {
  it("'always' mode: both readouts are on — the control that makes the next case mean something", async () => {
    const view = drawWithVolPane('always')
    await hover(view, 1.5)
    expect(legendTextOf(view), 'the OHLC legend never drew — this suite is vacuous').toMatch(/O\s*1/)
    expect(volStripText(view), 'the volume strip never drew — the next case cannot fail')
      .toMatch(/Vol/)
  })

  it("'on click' with nothing pinned: the OHLC legend is hidden and the volume strip is NOT", async () => {
    const view = drawWithVolPane('click')
    await hover(view, 1.5)
    expect(legendTextOf(view)).toBe('')
    expect(volStripText(view),
      'hiding the OHLC legend took the volume pane\'s own readout down with it — the mode was '
      + 'applied to the shared `crosshairData` payload instead of to the legend\'s render gate',
    ).toMatch(/Vol/)
  })
})

// ─── THE THIRD DOOR: the right-click menu ────────────────────────────────────
//
// The toolbar button only exists on surfaces that render a toolbar. The menu is
// on every chart, so the mode has a door on all of them.
//
// ⭐ THE PROBE TARGETS THE **COMMON** `view` SECTION, which every region builds,
// so it needs no scan over pane geometry and carries no copy of the band math —
// one right-click anywhere in the plot is enough. That is also the product
// argument for putting the entry there rather than under `Chart`: the legend is
// a view concern, and right-clicking the RSI pane should still reach it.
const openMenu = (view) => {
  const el = H.chartContainers.at(-1)
  expect(el, 'no chart container recorded — the chart never mounted').toBeTruthy()
  const captured = []
  const onCtx = (e) => captured.push(e.detail)
  window.addEventListener('uct:chart-contextmenu', onCtx)
  const rect = { left: 0, top: 0, right: 800, bottom: 400, x: 0, y: 0, width: 800, height: 400, toJSON: () => ({}) }
  el.getBoundingClientRect = () => rect
  try {
    fireEvent.contextMenu(el, { clientX: 120, clientY: 120 })
  } finally {
    delete el.getBoundingClientRect
    window.removeEventListener('uct:chart-contextmenu', onCtx)
  }
  expect(captured[0], 'the right-click produced no menu payload').toBeTruthy()
  return captured[0].sections
}

const legendSubmenu = (sections) => {
  const view = sections.find(s => s.id === 'view')
  expect(view, "no 'view' section in the menu — this case is asserting on nothing").toBeTruthy()
  const item = view.items.find(i => i && i.id === 'legend-mode')
  expect(item, "no 'legend-mode' item in the view section").toBeTruthy()
  expect(item.submenu, "'legend-mode' is not a submenu").toBeTruthy()
  return item.submenu
}

describe('the right-click menu carries the same three modes', () => {
  it('offers exactly the three modes, with the current one ticked', () => {
    const view = draw('click')
    const rows = legendSubmenu(openMenu(view))
    expect(rows.map(r => r.id)).toEqual(['legend-always', 'legend-click', 'legend-off'])
    expect(rows.filter(r => r.checked).map(r => r.id)).toEqual(['legend-click'])
  })

  it('picking a row writes legendMode and leaves the legacy boolean alone', () => {
    const persisted = []
    render(
      <StockChart
        sym="AAPL" tf="D" barsOverride={BARS} alwaysShowLegend
        settingsOverride={mergeChartSettings({ header: { showLegend: true, legendMode: 'always' } })}
        onSettingsPersist={(s) => persisted.push(s)}
      />,
    )
    const rows = legendSubmenu(openMenu(null))
    act(() => { rows.find(r => r.id === 'legend-off').onSelect() })
    expect(persisted.length,
      'the menu row wrote nowhere — an item wired to nothing must fail, not read as "no change"',
    ).toBeGreaterThan(0)
    const next = persisted.at(-1)
    expect(next.header.legendMode).toBe('off')
    expect(next.header.showLegend).toBe(true)
  })
})
