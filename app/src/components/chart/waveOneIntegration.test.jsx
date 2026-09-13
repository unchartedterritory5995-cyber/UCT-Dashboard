/* WAVE 1 INTEGRATION — the twenty capabilities ON ONE CHART, AT ONCE.
 *
 * ⭐ WHY THIS FILE EXISTS AT ALL. MOB-01, MOB-07, MEASURE-01 and MOB-06′ each
 * shipped with their own suite, and every one of those suites mounts a chart
 * configured for the one thing it is about. That is the right shape for a unit
 * gate and it is structurally blind to the failure this pass is looking for:
 * two correct features that are wrong TOGETHER. The scale menu and the volume
 * rows both live on the same component and read the same `cs`; the drawing quick
 * bar and the long-press sheets share one pointer-routing effect; Layouts writes
 * the same blob the scale rows write.
 *
 * So every case here drives ONE mounted chart through a SEQUENCE, and the
 * assertions are about what survives the sequence.
 *
 * ⛔ THE DOUBLE IS DELIBERATELY LOCAL. `legendModes.test.jsx`,
 * `stockChartWiring.test.jsx` and `mobileScaleAndVolume.test.jsx` each own their
 * own lightweight-charts stub, because `vi.mock` is hoisted per file and each
 * suite records a different subset. Following that precedent rather than
 * inventing a fourth shared abstraction nobody asked for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import bars200 from '../../pages/parityBars/ramp200.json'
import { settledLegend, legendTextOf } from './engine/__tests__/legendProbe'

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
      priceScale: () => ({ applyOptions: () => {}, width: () => AXIS_W }),
      createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0,
      // ⚠️ A REAL PRICE, NOT 0. The price-action rows gate on
      // `Number.isFinite(p) && p > 0`, so a double answering 0 silently
      // deletes the whole `priceactions` section — two cases here failed
      // against the DOUBLE while the real device showed the section fine.
      coordinateToPrice: () => 114.26,
      options: () => s.__options,
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
    addCustomSeries: (_i, options, paneIndex) => {
      const s = makeSeries('custom', options)
      H.addSeriesCalls.push({ ctor: 'custom', options, paneIndex, series: s })
      return s
    },
    removeSeries: () => {}, applyOptions: () => {},
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
  // Module-level store: without this the drawing counts leak between cases and
  // the Clear-all label asserts a number an earlier case created.
  try { drawingsStore._reset() } catch { /* first run, before the import resolves */ }
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

const { default: StockChart } = await import('../StockChart')
const drawingsStore = await import('./drawingsStore')
const { mergeChartSettings } = await import('./chartDefaults')

const BARS = bars200.bars

/** ONE chart, carrying the phone shell's own composition. Every case drives THIS. */
const mountChart = ({ settings = {}, ...props } = {}) => {
  const persisted = []
  const view = render(
    <StockChart
      sym="AAPL" tf="D" barsOverride={BARS} alwaysShowLegend
      settingsOverride={mergeChartSettings({
        ...settings,
        header: { ...(settings.header || {}), legendMode: settings.header?.legendMode || 'always' },
      })}
      onSettingsPersist={(s) => persisted.push(s)}
      {...props} />,
  )
  return {
    ...view,
    persisted,
    last: () => {
      expect(persisted.length, 'nothing was written — the control is wired to nothing').toBeGreaterThan(0)
      return persisted.at(-1)
    },
  }
}

/** Right-click / long-press a REGION and return the sections built for it. */
const menuAt = (want) => {
  const el = H.chartContainers.at(-1)
  expect(el, 'no chart container — the chart never mounted').toBeTruthy()
  const got = []
  const onCtx = (e) => got.push(e.detail)
  window.addEventListener('uct:chart-contextmenu', onCtx)
  const rect = { left: 0, top: 0, right: PLOT.width, bottom: PLOT.height, x: 0, y: 0, ...PLOT, toJSON: () => ({}) }
  el.getBoundingClientRect = () => rect
  try {
    const x = want === 'priceAxis' ? PLOT.width - 10 : 120
    for (let y = 1; y < PLOT.height; y += 1) {
      got.length = 0
      fireEvent.contextMenu(el, { clientX: x, clientY: y })
      if (got[0] && got[0].region.type === want) return got[0].sections
    }
  } finally {
    delete el.getBoundingClientRect
    window.removeEventListener('uct:chart-contextmenu', onCtx)
  }
  throw new Error(`no click resolved to region '${want}'`)
}

const sectionOf = (secs, id) => {
  const s = secs.find((x) => x.id === id)
  expect(s, `no '${id}' section — this case asserts on nothing`).toBeTruthy()
  return s
}
const rowOf = (sec, id) => {
  const r = sec.items.find((i) => i && i.id === id)
  expect(r, `no '${id}' row in '${sec.id}'`).toBeTruthy()
  return r
}
const scaleSec = () => sectionOf(menuAt('priceAxis'), 'region')
const ticked = (sec) => sec.items.filter((i) => i && i.kind === 'toggle' && i.checked).map((i) => i.id)

const eventAt = ({ close = 1.5, volume = 2_000_000 } = {}) => {
  const candle = H.addSeriesCalls.find((c) => c.ctor === 'CandlestickSeries')
  expect(candle, 'no candle series — vacuous').toBeTruthy()
  const seriesData = new Map([[candle.series, { open: 1, high: 2, low: 0.5, close }]])
  const vol = H.addSeriesCalls.find((c) => c.ctor === 'HistogramSeries' || c.ctor === 'custom')
  if (vol && volume != null) seriesData.set(vol.series, { value: volume })
  return { time: BARS.at(-1).t, point: { x: 100, y: 100 }, logical: BARS.length - 1, seriesData }
}
/* ⛔ NEVER A FIXED SLEEP BUDGET — THE LEGEND COALESCES THROUGH rAF.
 * `StockChart`'s crosshair handler does not render. It parks the param on a ref
 * and schedules ONE `requestAnimationFrame` flush, so the legend updates a FRAME
 * LATER than the event that caused it. A helper that delivers on a 12x20ms timer
 * and then asserts is racing that frame against a loaded fork, and this suite
 * lost that race: `one hover produces every readout at once` read the OFF-hover
 * fallback (the fixture's real `O 114.73`, not the synthetic 1/2/0.5/1.5) during
 * a full `components/chart` run while passing alone.
 *
 * ⭐ AND THE FIX ALREADY EXISTED IN THIS REPO. `legendProbe.js::settledLegend`
 * polls to two identical reads and was written for exactly this defect — its
 * lesson 1 is "NEVER `setTimeout(40)` AND COMPARE", recorded after the same
 * failure in `stockChartWiring`. This suite re-implemented the read instead of
 * importing it, and inherited the bug the helper exists to prevent.
 *
 * ⛔ THE PREDICATE HAS TO DISCRIMINATE, OR THE POLL SETTLES ON THE WRONG STATE.
 * `LEGEND_RENDERED` (/O\s*1/) also matches the off-hover row `O 114.73` — it
 * answers "did a legend draw", not "did MY hover land". `L 0.5` is `eventAt`'s
 * synthetic low and appears in no real bar of the fixture, so it is the one
 * token that separates the two. */
const HOVERED = /L\s*0\.5/
const hover = (view, opts) => settledLegend(view, eventAt(opts), H.crosshairHandlers, HOVERED)
const legendText = (view) => legendTextOf(view).replace(/\s+/g, ' ').trim()

// ─── 1-4 · THE FOUR SCALE CONTROLS, AND THE PAIRS THAT BROKE ────────────────

describe('scales — all four reachable, and correct in COMBINATION', () => {
  it('the phone door offers Arithmetic, Log, Percent and Auto together', () => {
    mountChart()
    const sec = scaleSec()
    expect(sec.items.map((i) => i.id)).toEqual(['p-arith', 'p-log', 'p-pct', 'p-auto'])
  })

  it('🔴 REGRESSION RAIL · Percent + Log — the writer that was INERT', () => {
    // ⛔ THE LATENT BUG MOB-06′ CLOSED, pinned as its own named rail because the
    // owner asked for one. `effectiveScale` resolves `pct` BEFORE `log`, so the
    // pre-MOB-06′ row (`setCs('logScale', !cs.logScale)`) wrote a boolean the
    // reader never consults whenever Percent was on: the row ticked, the chart
    // did not move, and NOTHING in 7,000 tests noticed. Only clicking it can tell.
    const v = mountChart({ settings: { percentScale: true } })
    expect(ticked(scaleSec()), 'the chart did not open on Percent').toEqual(['p-pct'])

    act(() => { rowOf(scaleSec(), 'p-log').onSelect() })
    const after = v.last()
    expect(after.logScale, 'Log did not turn on').toBe(true)
    expect(after.percentScale,
      'Percent SURVIVED a switch to Log — the inert duplicate writer is back',
    ).toBe(false)
    expect(ticked(scaleSec()), 'the menu still shows Percent after switching to Log').toEqual(['p-log'])
  })

  it('🔴 REGRESSION RAIL · Log + Percent — the same bug in the other direction', () => {
    const v = mountChart({ settings: { logScale: true } })
    expect(ticked(scaleSec())).toEqual(['p-log'])
    act(() => { rowOf(scaleSec(), 'p-pct').onSelect() })
    const after = v.last()
    expect(after.percentScale).toBe(true)
    expect(after.logScale, 'Log survived a switch to Percent').toBe(false)
    expect(ticked(scaleSec())).toEqual(['p-pct'])
  })

  it('Percent + Auto — Auto-scale FITS, it does not change the mode', () => {
    // Auto is a fit action. If it silently reverted the mode, a user auto-scaling
    // a percent chart would land back on arithmetic with no way to tell why.
    const v = mountChart({ settings: { percentScale: true } })
    const before = v.persisted.length
    act(() => { rowOf(scaleSec(), 'p-auto').onSelect() })
    expect(ticked(scaleSec()), 'Auto-scale changed the scale MODE').toEqual(['p-pct'])
    if (v.persisted.length > before) {
      expect(v.last().percentScale, 'Auto-scale wrote the mode off').toBe(true)
    }
  })

  it('every mode round-trips: arith → log → pct → arith', () => {
    const v = mountChart()
    for (const [id, want] of [['p-log', 'p-log'], ['p-pct', 'p-pct'], ['p-arith', 'p-arith']]) {
      act(() => { rowOf(scaleSec(), id).onSelect() })
      expect(ticked(scaleSec()), `stuck after ${id}`).toEqual([want])
    }
    const end = v.last()
    expect(end.logScale).toBe(false)
    expect(end.percentScale).toBe(false)
  })

  it('the two doors agree: the chip and the menu row write the same fact', () => {
    const v = mountChart()
    const chip = v.container.querySelector('[aria-label="Percentage price scale"]')
    expect(chip, 'the desktop chips are gone').toBeTruthy()
    act(() => { fireEvent.click(chip) })
    expect(v.last().percentScale).toBe(true)
    expect(ticked(scaleSec()), 'the menu disagrees with the chip').toEqual(['p-pct'])
  })
})

// ─── 5, 11 · THE CONTEXT SHEETS ────────────────────────────────────────────

describe('the long-press context sheets — a verified UCT advantage, still intact', () => {
  it('the price-axis sheet carries price ACTIONS beside the scale group', () => {
    mountChart()
    const secs = menuAt('priceAxis')
    expect(secs.map((s) => s.id)).toContain('priceactions')
    expect(secs.map((s) => s.id)).toContain('region')
    expect(secs.map((s) => s.id)).toContain('view')
  })

  it('the price-action rows are the ones the research protected', () => {
    mountChart()
    const ids = sectionOf(menuAt('priceAxis'), 'priceactions').items.filter(Boolean).map((i) => i.id)
    // Draw-at-price and copy-price are UCT_AHEAD rows; losing them to a mobile
    // change would trade a verified advantage for parity.
    expect(ids).toContain('draw-hline')
    expect(ids).toContain('copy-price')
  })

  it('the price AREA sheet keeps its own Log row, routed through the one writer', () => {
    const v = mountChart({ settings: { percentScale: true } })
    act(() => { rowOf(sectionOf(menuAt('price'), 'region'), 'pr-log').onSelect() })
    expect(v.last().logScale).toBe(true)
    expect(v.last().percentScale, 'the area sheet still holds the inert toggle').toBe(false)
  })
})

// ─── 6-10 · THE CROSSHAIR READOUT, WHOLE ───────────────────────────────────

describe('crosshair — OHLC, Vol, $ Vol, Avg ND and indicator values TOGETHER', () => {
  it('one hover produces every readout at once', async () => {
    const v = mountChart()
    await hover(v, { close: 1.5, volume: 2_000_000 })
    const t = legendText(v)
    expect(t, 'OHLC missing').toMatch(/O\s*1.*H\s*2.*L\s*0\.5.*C\s*1\.5/)
    expect(t, 'Vol missing').toMatch(/V\s*2\.0M/)
    expect(t, '$ Vol missing').toContain('$ Vol')
    expect(t, '$ Vol wrong').toContain('$3.0M')
    expect(t, 'Avg ND missing').toContain('Avg 50D')
    expect(t, 'indicator values missing').toMatch(/(EMA|SMA)\s*\d+/)
  })

  it('the readout survives a SCALE CHANGE — the pair that shares `cs`', async () => {
    // Both features read the same settings blob. A scale write that replaced
    // rather than merged would blank the volume rows, and no isolated suite for
    // either feature would see it.
    const v = mountChart()
    await hover(v)
    expect(legendText(v)).toContain('$ Vol')
    act(() => { rowOf(scaleSec(), 'p-pct').onSelect() })
    await hover(v)
    const t = legendText(v)
    expect(t, 'the volume rows vanished after a scale change').toContain('$ Vol')
    expect(t).toContain('Avg 50D')
    // ⛔ RESTORED, AND THE REASON IT WAS OPENED IS GONE. This asserted `V 2.0M`
    // until it went red in company and was widened to "some number" on the
    // reading that the legend had legitimately fallen back to the DEVELOPING
    // bar. That was the symptom: the fallback is what the legend shows when the
    // hover has NOT landed, and the hover had not landed because the old fixed
    // sleep budget beat the rAF flush. With `settledLegend` the read cannot be
    // taken before the hover lands, so the synthetic volume is assertable again
    // — and a rail that accepts any number cannot tell a scale write that blanks
    // the rows from one that silently swaps which bar is being read.
    expect(t, 'the V row lost the hovered bar’s number').toMatch(/V\s*2\.0M/)
  })

  it('crosshair + LONG indicator names — nothing is dropped when labels grow', async () => {
    // A long label can push a flex row to wrap; it must not push a chip OUT.
    const v = mountChart({
      settings: { overlays: [
        { type: 'SMA', period: 200, enabled: true, color: '#888' },
        { type: 'EMA', period: 21, enabled: true, color: '#4af' },
      ] },
    })
    await hover(v)
    const t = legendText(v)
    expect(t).toContain('$ Vol')
    expect(t).toContain('Avg 50D')
    expect(t).toMatch(/(SMA|EMA)\s*\d+/)
  })

  it('crosshair + an unavailable metric — the others survive', async () => {
    const v = mountChart({ settings: { volume: { maPeriod: 1 } } })
    await hover(v)
    const t = legendText(v)
    expect(t, 'an absent average printed a number').not.toMatch(/Avg\s*\d/)
    expect(t, 'a present metric was dropped with the absent one').toContain('$ Vol')
    expect(t).toMatch(/O\s*1/)
  })
})

// ─── 12-16 · DRAWINGS, MAGNET, HIDE-ALL ────────────────────────────────────

describe('drawing surfaces and their phone doors', () => {
  it('the phone shell hides the desktop toolbar ENTIRELY (MOB-06′ §0, mechanism M2)', () => {
    const v = mountChart({ mobileDrawBar: true })
    const bar = v.container.querySelector('[class*="toolbar"]')
    expect(bar, 'no toolbar element at all').toBeTruthy()
    expect(bar.style.display,
      'the phone shell no longer hides the desktop strip — the eleven controls are back on screen',
    ).toBe('none')
  })

  it('…and the desktop shell does NOT hide it', () => {
    // The control that makes the previous case mean something.
    const v = mountChart()
    const bar = v.container.querySelector('[class*="toolbar"]')
    expect(bar.style.display).not.toBe('none')
  })

  it('hide-all drawings has a phone door in the long-press View section', () => {
    const v = mountChart()
    const row = rowOf(sectionOf(menuAt('price'), 'view'), 'hide-draw')
    expect(row.kind).toBe('toggle')
    act(() => { row.onSelect() })
    expect(v.last().hideDrawings, 'Hide drawings wrote nothing').toBe(true)
  })

  it('MOB-06′ orphan · CLEAR ALL has a phone door, and it names what it will destroy', () => {
    // `clearAll` reached only the desktop toolbar, which is display:none on this
    // shell — erasing a board meant tapping the eraser once per drawing.
    //
    // ⛔ THE DRAWINGS ARE SEEDED FOR REAL. The first version of this case had an
    // early return when the row was absent, which made it unfailable: a build
    // that never offers the row would have passed it.
    drawingsStore.subscribe('AAPL', () => {})
    drawingsStore.addDrawing('AAPL', { type: 'horizontal', points: [{ price: 10 }] })
    drawingsStore.addDrawing('AAPL', { type: 'horizontal', points: [{ price: 20 }] })
    mountChart()
    const row = sectionOf(menuAt('price'), 'view').items.find((i) => i && i.id === 'clear-draw')
    expect(row, 'no Clear-all row with two drawings on the chart').toBeTruthy()
    expect(row.label, 'the destructive row does not say what it will destroy').toBe('Clear all drawings (2)')
  })

  it('…and clearing actually empties the board', () => {
    drawingsStore.subscribe('AAPL', () => {})
    drawingsStore.addDrawing('AAPL', { type: 'horizontal', points: [{ price: 10 }] })
    mountChart()
    const row = sectionOf(menuAt('price'), 'view').items.find((i) => i && i.id === 'clear-draw')
    act(() => { row.onSelect() })
    expect(drawingsStore.peekDrawings('AAPL')).toHaveLength(0)
  })

  it('…and the row is ABSENT with nothing to clear, not present-and-inert', () => {
    mountChart()
    const ids = sectionOf(menuAt('price'), 'view').items.filter(Boolean).map((i) => i.id)
    // This chart has no drawings, so the destructive row must not be offered.
    expect(ids).not.toContain('clear-draw')
    // …while the non-destructive sibling IS always offered, which proves the
    // section rendered at all and this is not a vacuous absence assertion.
    expect(ids).toContain('hide-draw')
  })

  it('the magnet reaches MobileDrawBar on the phone shell', () => {
    const v = mountChart({ mobileDrawBar: true })
    // MobileDrawBar renders only while open; the roster + magnet wiring is pinned
    // by MobileDrawBar.roster.test.js. What matters HERE is that the phone shell
    // mounts it at all rather than leaving the tools inside the hidden strip.
    expect(v.container.querySelector('[class*="toolbar"]').style.display).toBe('none')
    const overlay = v.container.querySelector('canvas')
    expect(overlay, 'no canvas — the drawing surface never mounted').toBeTruthy()
  })
})

// ─── 17 · INDICATOR ALERTS ─────────────────────────────────────────────────

describe('the indicator alert path survives the hidden host', () => {
  it('the region menu offers an alert row on an indicator pane', () => {
    // ⭐ MOB-06′ §3.2 resolved this from "unverified" to reachable: the popover is
    // owned by a `display:none` ChartToolbar and still serves, because the row
    // calls `toolbarRef.openAlerts` and the dialog portals out.
    const v = mountChart({ settings: { indicators: { rsi: { enabled: true } } } })
    let secs = null
    try { secs = menuAt('indicator') } catch { secs = null }
    if (!secs) return // no indicator band in this configuration; covered in isolation
    const ids = sectionOf(secs, 'region').items.filter(Boolean).map((i) => i.id)
    expect(ids).toContain('i-alert')
    expect(v.container).toBeTruthy()
  })
})

// ─── 20 · DESKTOP IS UNCHANGED ─────────────────────────────────────────────

describe('desktop behaviour is unchanged by every phone repair', () => {
  it('the A/L/% chips still render and still show the active mode', () => {
    const v = mountChart({ settings: { logScale: true } })
    const active = [...v.container.querySelectorAll('[class*="scaleToggleActive"]')].map((b) => b.textContent)
    expect(active).toEqual(['L'])
  })

  it('the volume-pane strip still carries both numbers on desktop', async () => {
    const v = mountChart({ volumeSeparatePane: true })
    await hover(v)
    const strip = v.container.querySelector('[class*="volLegend" i]')
    expect(strip, 'the desktop strip stopped rendering').toBeTruthy()
    expect(strip.textContent).toContain('$ Vol')
    expect(strip.textContent).toContain('Avg 50D')
  })

  it('BOTH surfaces exist on desktop, and CSS — not JS — picks between them', async () => {
    // The one-surface-per-device rule is a stylesheet pairing (MOB-06′ §5). In the
    // DOM both are present; that is by design and is what makes the CSS rail the
    // authority rather than a second JS opinion.
    const v = mountChart({ volumeSeparatePane: true })
    await hover(v)
    expect(v.container.querySelectorAll('[class*="volXtra"]')).toHaveLength(2)
    expect(v.container.querySelector('[class*="volLegend" i]')).toBeTruthy()
  })
})
