/* MOB-06′ — the two ORPHANED MOBILE TASKS, repaired and gated behaviourally.
 *
 * An orphaned mobile task is a capability the product COMPUTES and the phone can
 * never REACH. The MOB-06 inventory found exactly two, and both are here:
 *
 *   1. PERCENT SCALE. The always-visible A/L/% chips are `display:none` on the
 *      phone shell, and they were the only writer of `percentScale` anywhere in
 *      the app (ChartSettingsModal has no scale control). Log survived via the
 *      long-press toggle, Auto via the price-axis menu; Percent had no door.
 *   2. $ Vol / Avg ND. `.volLegend` — the volume-pane strip — carries them on
 *      desktop and is `display:none` on the phone shell, and no other surface
 *      rendered either number.
 *
 * ⭐ EVERY CASE HERE DRIVES THE REAL DOOR. The first draft of this file asserted
 * on the SOURCE of StockChart.jsx, and that was the wrong instrument twice over:
 * a grep cannot tell a menu row wired to `setScale` from one wired to nothing,
 * and it reads the LATENT BUG below (a toggle that writes a boolean the reader
 * never consults) as perfectly correct code. So the scale cases open the actual
 * right-click/long-press menu and click its rows, and the legend cases hover the
 * actual crosshair and read the actual rendered text.
 *
 * The double + hook mocks are `engine/__tests__/legendModes.test.jsx`'s, with one
 * change: `priceScale().width()` answers 60 instead of 0, because
 * `resolveChartRegion` gates the price-axis band on `axisWidth > 0` and a 0-wide
 * axis makes the region this whole first suite is about unreachable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import bars200 from '../../pages/parityBars/ramp200.json'
import { legendTextOf, settledLegend } from './engine/__tests__/legendProbe'
import { __resetCoarsePointerForTest } from './coarsePointer'

const PLOT = { width: 800, height: 400 }
const AXIS_W = 60

const H = vi.hoisted(() => ({
  addSeriesCalls: [],
  crosshairHandlers: [],
  chartContainers: [],
  reset() {
    H.addSeriesCalls.length = 0
    H.crosshairHandlers.length = 0
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
      // ⭐ A REAL AXIS WIDTH. `openMenuAt` reads this through `mainPriceScale()`,
      // and `resolveChartRegion` returns 'priceAxis' only when `axisWidth > 0`.
      // With the sibling suites' 0 the price-axis region does not exist and every
      // case below would fail on "no click resolved to priceAxis" — or, worse,
      // silently resolve to 'price' and assert on a different menu.
      priceScale: () => ({ applyOptions: () => {}, width: () => AXIS_W }),
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
    priceScale: () => ({ applyOptions: () => {}, width: () => AXIS_W }),
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

vi.mock('../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../../context/AuthContext', () => ({
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

const { default: StockChart } = await import('../StockChart')
const { mergeChartSettings } = await import('./chartDefaults')

const BARS = bars200.bars

// ─── the harness ────────────────────────────────────────────────────────────

/** A chart plus the blob its menu rows write. `alwaysShowLegend` + legendMode
 *  'always' is the workspace recipe; the legend cases below need the readout on. */
const draw = ({ settings = {}, legendMode = 'always', ...props } = {}) => {
  const persisted = []
  const view = render(
    <StockChart
      sym="AAPL" tf="D" barsOverride={BARS} alwaysShowLegend
      settingsOverride={mergeChartSettings({ ...settings, header: { ...(settings.header || {}), legendMode } })}
      onSettingsPersist={(s) => persisted.push(s)}
      {...props} />,
  )
  return {
    ...view,
    /** The last write. THROWS when nothing was written: a row wired to nothing
     *  must fail the case, never read as "no change". */
    lastSettings: () => {
      expect(persisted.length,
        'the row wrote nowhere — a menu item wired to nothing must fail, not read as "no change"',
      ).toBeGreaterThan(0)
      return persisted.at(-1)
    },
    writeCount: () => persisted.length,
  }
}

/** Long-press / right-click THE PRICE AXIS and return the sections built for it.
 *
 *  This is the phone's door: the axis long-press is what a coarse pointer gets
 *  where a mouse gets a right-click, and `useLongPress` routes both into the same
 *  `openMenuAt`. x sits inside the 60px axis band; y is above the time axis. */
const openPriceAxisMenu = () => {
  const el = H.chartContainers.at(-1)
  expect(el, 'no chart container recorded — the chart never mounted').toBeTruthy()
  const captured = []
  const onCtx = (e) => captured.push(e.detail)
  window.addEventListener('uct:chart-contextmenu', onCtx)
  const rect = { left: 0, top: 0, right: PLOT.width, bottom: PLOT.height, x: 0, y: 0, ...PLOT, toJSON: () => ({}) }
  el.getBoundingClientRect = () => rect
  try {
    fireEvent.contextMenu(el, { clientX: PLOT.width - 10, clientY: 120 })
  } finally {
    delete el.getBoundingClientRect
    window.removeEventListener('uct:chart-contextmenu', onCtx)
  }
  const hit = captured[0]
  expect(hit, 'the right-click on the price axis produced no menu payload').toBeTruthy()
  expect(hit.region.type,
    'the click did not land on the price axis — this case would assert on a different menu',
  ).toBe('priceAxis')
  return hit.sections
}

/** Right-click the open PRICE AREA (the other sheet that carries a Log row). */
const openPriceAreaMenu = () => {
  const el = H.chartContainers.at(-1)
  expect(el, 'no chart container recorded').toBeTruthy()
  const captured = []
  const onCtx = (e) => captured.push(e.detail)
  window.addEventListener('uct:chart-contextmenu', onCtx)
  const rect = { left: 0, top: 0, right: PLOT.width, bottom: PLOT.height, x: 0, y: 0, ...PLOT, toJSON: () => ({}) }
  el.getBoundingClientRect = () => rect
  try {
    fireEvent.contextMenu(el, { clientX: 120, clientY: 60 })
  } finally {
    delete el.getBoundingClientRect
    window.removeEventListener('uct:chart-contextmenu', onCtx)
  }
  expect(captured[0], 'the right-click produced no menu payload').toBeTruthy()
  return captured[0].sections
}

const sectionOf = (sections, id) => {
  const s = sections.find(x => x.id === id)
  expect(s, `no '${id}' section in the menu — this case is asserting on nothing`).toBeTruthy()
  return s
}
const rowOf = (section, id) => {
  const r = section.items.find(i => i && i.id === id)
  expect(r, `no '${id}' row in the '${section.id}' section`).toBeTruthy()
  return r
}
/** The scale section, named by its TITLE as well as its id so a section that
 *  quietly becomes something else fails here instead of three lines later. */
const scaleSection = () => {
  const s = sectionOf(openPriceAxisMenu(), 'region')
  expect(s.title).toBe('Price scale')
  return s
}
const modeRows = (section) => section.items.filter(i => i && i.kind === 'toggle')
const tickedIds = (section) => modeRows(section).filter(r => r.checked).map(r => r.id)

// ─── SUITE A · PERCENT SCALE HAS A PHONE DOOR ───────────────────────────────

describe("MOB-06′ #1 — the phone can reach every price-scale mode", () => {
  it('CONTROL · the price-axis long-press builds a Price scale section at all', () => {
    // Absence assertions dominate this suite; without this the rest could all
    // pass against a menu that was never built.
    draw()
    expect(scaleSection().items.length).toBeGreaterThan(0)
  })

  it('offers all three MODES, not just Log — Percent is the orphan this repairs', () => {
    draw()
    expect(modeRows(scaleSection()).map(r => r.id)).toEqual(['p-arith', 'p-log', 'p-pct'])
  })

  it('Auto-scale survives as a FIT action, not folded into the mode group', () => {
    draw()
    const auto = rowOf(scaleSection(), 'p-auto')
    expect(auto.kind, 'Auto-scale is not a mode and must not carry a checkmark').not.toBe('toggle')
  })

  it('picking Percent turns percent scale ON', () => {
    const view = draw()
    act(() => { rowOf(scaleSection(), 'p-pct').onSelect() })
    expect(view.lastSettings().percentScale).toBe(true)
  })

  it('…and clears logScale in the SAME write — one writer owns both booleans', () => {
    // The proof that there is no second writer is not that a string is absent
    // from the file; it is that ONE click leaves the pair consistent.
    const view = draw({ settings: { logScale: true } })
    act(() => { rowOf(scaleSection(), 'p-pct').onSelect() })
    const next = view.lastSettings()
    expect(next.percentScale).toBe(true)
    expect(next.logScale, 'logScale survived a switch to Percent — two writers, one fact').toBe(false)
  })

  it('the ticked row is the ACTIVE mode, and it updates immediately', () => {
    const view = draw()
    expect(tickedIds(scaleSection())).toEqual(['p-arith'])
    act(() => { rowOf(scaleSection(), 'p-pct').onSelect() })
    // Re-opened from the same live chart: `setScale` sets a local override that
    // `effectiveScale` reads first, so the mark must move without a settings
    // round-trip. A menu that ticks the OLD mode is a menu the user cannot trust.
    expect(tickedIds(scaleSection()), 'the checkmark did not follow the click').toEqual(['p-pct'])
    expect(view.writeCount()).toBe(1)
  })

  it('a chart that OPENS on Percent shows Percent ticked', () => {
    draw({ settings: { percentScale: true } })
    expect(tickedIds(scaleSection())).toEqual(['p-pct'])
  })

  it('🔴 REGRESSION · picking Log while Percent is on actually LEAVES Percent', () => {
    // ⛔ THE LATENT BUG THIS REPAIR ALSO CLOSED, and the reason both menus were
    // rerouted rather than just gaining a row. `effectiveScale` resolves
    // `pct` BEFORE `log`, so the old bare `setCs('logScale', !cs.logScale)`
    // toggle was INERT whenever Percent was on: it ticked a box, persisted a
    // boolean nothing read, and the chart did not move. A source grep reads that
    // code as correct — only clicking it can tell.
    const view = draw({ settings: { percentScale: true } })
    act(() => { rowOf(scaleSection(), 'p-log').onSelect() })
    const next = view.lastSettings()
    expect(next.logScale).toBe(true)
    expect(next.percentScale,
      'Percent survived a switch to Log — the Log row is writing a boolean the reader never consults',
    ).toBe(false)
    expect(tickedIds(scaleSection())).toEqual(['p-log'])
  })

  it('Arithmetic clears BOTH — the third mode is a real destination', () => {
    const view = draw({ settings: { percentScale: true } })
    act(() => { rowOf(scaleSection(), 'p-arith').onSelect() })
    const next = view.lastSettings()
    expect(next.logScale).toBe(false)
    expect(next.percentScale).toBe(false)
  })

  it('the price-AREA sheet\'s Log row routes through the same writer', () => {
    // The second sheet carried the same duplicate writer. It stays a single Log
    // row (that sheet is the price-context sheet, not the place to grow a mode
    // group) but it must not be able to disagree with the axis menu.
    const view = draw({ settings: { percentScale: true } })
    const row = rowOf(sectionOf(openPriceAreaMenu(), 'region'), 'pr-log')
    act(() => { row.onSelect() })
    const next = view.lastSettings()
    expect(next.logScale).toBe(true)
    expect(next.percentScale, 'the price-area Log row is still the old inert toggle').toBe(false)
  })

  it('DESKTOP UNCHANGED · the A/L/% chips write the same fact through the same writer', () => {
    // ⭐ THE "NO DUPLICATE STATE" ASSERTION THAT MEANS SOMETHING. Two doors, one
    // state: the chip a desktop user clicks and the menu row a phone user taps
    // must land on identical settings. Anything else is the second-authority
    // defect wearing a device label.
    const view = draw()
    const chip = view.container.querySelector('[aria-label="Percentage price scale"]')
    expect(chip, 'the desktop A/L/% chips are gone — this repair was not supposed to touch them').toBeTruthy()
    act(() => { fireEvent.click(chip) })
    const viaChip = view.lastSettings()
    expect(viaChip.percentScale).toBe(true)
    expect(viaChip.logScale).toBe(false)
    // …and the menu agrees, because it reads the same resolver.
    expect(tickedIds(scaleSection())).toEqual(['p-pct'])
  })

  it('DESKTOP UNCHANGED · the chips still show the active mode', () => {
    const view = draw({ settings: { logScale: true } })
    const active = [...view.container.querySelectorAll('[class*="scaleToggleActive"]')]
      .map(b => b.textContent)
    expect(active).toEqual(['L'])
  })

  it('the menu is POINTER-AGNOSTIC — a coarse pointer gets the same rows', () => {
    // ⛔ THE FOUR-CONCEPTS RULE, ENFORCED. Presentation policy (what the phone
    // shows) is CSS's job; this menu is behaviour and must not branch on pointer
    // at all. A pointer branch here would mean a desktop and a phone could offer
    // different scale modes — the exact split MOB-06′ exists to close.
    const orig = window.matchMedia
    window.matchMedia = vi.fn(q => ({
      media: q, matches: /pointer:\s*coarse/.test(q),
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
    }))
    __resetCoarsePointerForTest()
    try {
      draw()
      expect(modeRows(scaleSection()).map(r => r.id)).toEqual(['p-arith', 'p-log', 'p-pct'])
    } finally {
      window.matchMedia = orig
      __resetCoarsePointerForTest()
    }
  })

  it('NO always-visible % chip was added to the phone — the TASK was restored, not the furniture', () => {
    // The chips are still one element, still the desktop control, still hidden on
    // the phone shell by `.scaleToggle`'s coarse rule. Restoring them would have
    // been the easy fix and was explicitly refused.
    const view = draw()
    expect(view.container.querySelectorAll('[class*="scaleToggle"]:not([class*="scaleToggleBtn"]):not([class*="scaleToggleActive"])'))
      .toHaveLength(1)
  })
})

// ─── SUITE B · $ Vol AND Avg ND REACH THE PHONE ─────────────────────────────

/** One crosshair event over the newest bar, with a nameable close and volume.
 *  `vol` is read off the VOLUME SERIES' point (not the bar), so the test drives
 *  the same input a real hover does. The vol-MA series is deliberately LEFT OUT:
 *  omitting it exercises the component's own `volMaDataRef` fallback, so `Avg ND`
 *  is checked against the real moving average rather than a number this file
 *  handed in. */
const eventAt = ({ close = 1.5, volume = 2_000_000 } = {}) => {
  const candle = H.addSeriesCalls.find(c => c.ctor === 'CandlestickSeries')
  expect(candle, 'no candle series — the chart never drew, so this case is vacuous').toBeTruthy()
  const seriesData = new Map([[candle.series, { open: 1, high: 2, low: 0.5, close }]])
  const vol = H.addSeriesCalls.find(c => c.ctor === 'HistogramSeries' || c.ctor === 'custom')
  if (vol && volume != null) seriesData.set(vol.series, { value: volume })
  return { time: BARS.at(-1).t, point: { x: 100, y: 100 }, logical: BARS.length - 1, seriesData }
}

/* ⛔ NEVER A FIXED SLEEP BUDGET — THE LEGEND COALESCES THROUGH rAF.
 * `StockChart`'s crosshair handler parks the param on a ref and schedules ONE
 * `requestAnimationFrame` flush, so the legend updates a FRAME LATER than the
 * event. A helper that delivers on a 12x20ms timer and then asserts is racing
 * that frame against a loaded fork, and this suite lost it: three cases here
 * (`$ Vol tracks the bar`, `an UNAVAILABLE average`, `an UNAVAILABLE volume`)
 * read the OFF-hover fallback during a full `components/chart` run while every
 * one of them passed alone.
 *
 * ⭐ THE FIX ALREADY EXISTED, AND THIS FILE ALREADY IMPORTED HALF OF IT. It
 * took `legendTextOf` from `legendProbe` and left `settledLegend` — the poll-to-
 * stability half, written for this exact defect — behind. Now it takes both.
 *
 * ⛔ THE PREDICATE HAS TO DISCRIMINATE. `L 0.5` is `eventAt`'s synthetic low
 * and appears in no real bar of the fixture; `/O\s*1/` would also match the
 * off-hover row `O 114.73` and settle on the state this is trying to leave. */
const HOVERED = /L\s*0\.5/
const hover = (view, opts) => settledLegend(view, eventAt(opts), H.crosshairHandlers, HOVERED)

/** Deliver the hover and require the legend to STAY ABSENT.
 *
 * ⛔ `settledLegend` cannot express this and must not be bent into it. Its rule
 * is "two identical reads that satisfy the predicate", and an empty read
 * satisfies an empty predicate IMMEDIATELY — it would return before the legend
 * had any chance to appear, which is the one thing this case exists to catch. A
 * fixed number of deliveries is the right instrument here precisely because the
 * expected outcome is NO CHANGE: nothing is being waited for, so nothing can be
 * read too early. */
const hoverExpectingNoLegend = async (view, opts) => {
  for (let i = 0; i < 12; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      for (const fn of [...H.crosshairHandlers]) fn(eventAt(opts))
      await new Promise(r => setTimeout(r, 20))
    })
  }
  return legendTextOf(view)
}

/** The desktop volume-pane strip, which must keep working untouched. */
const volStripText = (view) => {
  const el = view.container.querySelector('[class*="volLegend" i]')
  return el ? el.textContent : ''
}
/** The legend row element itself (the `O ` span's parent) — see legendProbe. */
const legendEl = (view) => {
  const o = [...view.container.querySelectorAll('span')].find(s => /^O\s/.test(s.textContent || ''))
  return o ? o.parentElement : null
}

/** The volume MA the component computes, derived here from the FIXTURE — an
 *  independent oracle, not a copy of the component's arithmetic. */
const meanOfLastVolumes = (n) => {
  const tail = BARS.slice(-n).map(b => b.v)
  return tail.reduce((a, b) => a + b, 0) / tail.length
}
const fmtVolume = (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(v))

describe("MOB-06′ #2 — dollar volume and average volume reach the phone", () => {
  it('CONTROL · hovering draws the legend, and Vol is in it', async () => {
    const view = draw()
    await hover(view)
    expect(legendTextOf(view), 'the legend never drew — every case below would pass vacuously')
      .toMatch(/O\s*1/)
    expect(legendTextOf(view)).toMatch(/V\s*2\.0M/)
  })

  it('$ Vol is in the legend, and it is volume × close', async () => {
    const view = draw()
    await hover(view, { close: 1.5, volume: 2_000_000 })
    // 2,000,000 × 1.5 = $3.0M, through the shipped formatter.
    expect(legendTextOf(view)).toContain('$ Vol')
    expect(legendTextOf(view)).toContain('$3.0M')
  })

  it('$ Vol tracks the bar — a different bar gives a different number', async () => {
    // Guards the "renders a constant" failure an equality check alone cannot see.
    const view = draw()
    await hover(view, { close: 10, volume: 4_000_000 })
    expect(legendTextOf(view)).toContain('$40.0M')
  })

  it('Avg 50D is in the legend, and it is the real moving average', async () => {
    const view = draw()
    await hover(view)
    const text = legendTextOf(view)
    expect(text).toContain('Avg 50D')
    expect(text, 'the Avg row is not the volume MA the chart draws')
      .toContain(fmtVolume(meanOfLastVolumes(50)))
  })

  it('the Avg row names the CONFIGURED period, not a hard-coded 50', async () => {
    const view = draw({ settings: { volume: { maPeriod: 20 } } })
    await hover(view)
    const text = legendTextOf(view)
    expect(text).toContain('Avg 20D')
    expect(text).toContain(fmtVolume(meanOfLastVolumes(20)))
    expect(text).not.toContain('Avg 50D')
  })

  it('an UNAVAILABLE average renders NOTHING — never a misleading zero', async () => {
    // maPeriod 1 makes the MA uncomputable (the memo bails under 2), so the datum
    // is genuinely absent. The row must vanish while its neighbours stay.
    const view = draw({ settings: { volume: { maPeriod: 1 } } })
    await hover(view)
    const text = legendTextOf(view)
    expect(text, 'an absent average was rendered as a number').not.toMatch(/Avg\s*\d/)
    expect(text, 'a metric that IS available was dropped with the one that is not').toContain('$ Vol')
    expect(text).toMatch(/V\s*2\.0M/)
  })

  it('an UNAVAILABLE volume takes $ Vol with it, and only it', async () => {
    // The guards are independent per metric, so absence propagates exactly as far
    // as the missing datum and no further.
    const view = draw()
    await hover(view, { close: 1.5, volume: null })
    const text = legendTextOf(view)
    expect(text, 'dollar volume was computed from a volume that does not exist').not.toContain('$ Vol')
    expect(text, 'the OHLC half of the legend went down with the volume half').toMatch(/O\s*1/)
  })

  it('the two rows JOIN the existing legend row rather than adding a second one', async () => {
    // ⭐ The structural half of "no 390px overflow": both spans are siblings of
    // the V span inside the one legend element, so they wrap with it instead of
    // forcing a new fixed-width surface. The PIXEL half cannot be measured in
    // jsdom (no layout engine) and is on the device-validation list.
    const view = draw()
    await hover(view)
    const leg = legendEl(view)
    expect(leg, 'no legend element').toBeTruthy()
    const labels = [...leg.children].map(el => (el.textContent || '').trim())
    expect(labels.some(t => t.startsWith('$ Vol'))).toBe(true)
    expect(labels.some(t => /^Avg 50D/.test(t))).toBe(true)
  })

  it('only the NEW rows are phone-gated — V is not', async () => {
    // ⛔ VISIBILITY IS CSS'S JOB. `.volXtra` is the marker the stylesheet keys on;
    // the V row must NOT carry it, or the metric that already worked everywhere
    // would become phone-only too.
    const view = draw()
    await hover(view)
    const leg = legendEl(view)
    const byText = (re) => [...leg.children].find(el => re.test((el.textContent || '').trim()))
    expect(byText(/^\$ Vol/).className, '$ Vol is not marked for the phone-only rule').toMatch(/volXtra/)
    expect(byText(/^Avg 50D/).className, 'Avg ND is not marked for the phone-only rule').toMatch(/volXtra/)
    // ⚰️ THIS READ `byText(/^V\s/)` — the V row used to be ONE span, `V 56.0M`.
    // It is a `LegendRow` now (it grew the eye / gear / ✕ every other indicator
    // has), so the label and the value are separate cells and no single child's
    // text starts with "V ". The CLAIM is unchanged and is what is asserted: the
    // volume row must not carry `.volXtra`, or a metric that works everywhere
    // would become phone-only. Addressed by the id the row publishes rather than
    // by its text, which is what made the probe brittle in the first place.
    const volRow = leg.querySelector('[data-legend-row="volume"]')
      || byText(/^V\s/)
    expect(volRow, 'the volume row is gone from the legend entirely').toBeTruthy()
    expect(volRow.className, 'the V row was swept into the phone-only rule').not.toMatch(/volXtra/)
  })

  it('they are CONTEXTUAL — no crosshair, no rows', async () => {
    // The decision was explicitly not to restore permanent chart furniture.
    const view = draw({ legendMode: 'off' })
    expect(await hoverExpectingNoLegend(view)).toBe('')
  })

  it('DESKTOP UNCHANGED · the volume-pane strip still carries both numbers', async () => {
    const view = draw({ volumeSeparatePane: true })
    await hover(view)
    const strip = volStripText(view)
    expect(strip, 'the desktop strip stopped rendering — this repair was additive').toContain('$ Vol')
    expect(strip).toContain('Avg 50D')
  })
})

// ─── the CSS pairing that keeps exactly ONE surface authoritative ────────────
//
// ⚠️ THE ONE PLACE A SOURCE ASSERTION IS THE RIGHT INSTRUMENT, and it is scoped
// to the one claim jsdom structurally cannot hold: `.volXtra` is visible exactly
// where `.volLegend` is hidden. That is a relationship between two @media rules —
// jsdom applies no media queries, so a render test sees neither — and expressing
// it in JS would move presentation into behaviour, which is the split MOB-06′
// exists to keep. The tests above own everything that IS observable.
describe("MOB-06′ — one surface per device, pinned in the stylesheet", () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const css = fs.readFileSync(path.join(__dirname, '..', 'StockChart.module.css'), 'utf8')
  const PHONE_SHELL_QUERY = '(pointer: coarse) and (max-width: 640px)'

  it('.volXtra is hidden by DEFAULT, so desktop keeps showing the strip', () => {
    expect(css).toMatch(/\.volXtra\s*\{\s*display:\s*none/)
  })

  it('.volXtra is revealed by exactly the query that hides .volLegend', () => {
    const reveal = css.slice(css.indexOf('.volXtra {'))
    expect(reveal).toContain(PHONE_SHELL_QUERY)
    expect(reveal).toContain('(pointer: coarse) and (orientation: landscape) and (max-height: 500px)')
    expect(reveal).toContain('html[data-mobile-chart-shell]')
  })

  it('the two rules stay in step — .volLegend is still hidden on the phone shell', () => {
    // If anyone unhides `.volLegend` on the phone, `.volXtra` must be hidden in
    // the same commit or both surfaces print the same numbers.
    const hideBlock = css.slice(css.indexOf(PHONE_SHELL_QUERY))
    expect(hideBlock).toContain('.volLegend')
  })

  it('the phone-hidden set still includes .scaleToggle — the chips did not come back', () => {
    const hideBlock = css.slice(css.indexOf(PHONE_SHELL_QUERY))
    expect(hideBlock).toContain('.scaleToggle')
  })
})
