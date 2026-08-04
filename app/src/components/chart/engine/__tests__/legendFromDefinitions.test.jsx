import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import bars200 from '../../../../pages/parityBars/ramp200.json'
import { legendTextOf, settledLegend as settledLegendWith, shippedLegendChips } from './legendProbe'

// ─── B4 TASK 10 — THE LEGEND, RENDERED FROM THE DEFINITIONS ─────────────────
//
// ⛔ THE PIXEL GATE CANNOT SEE ANY OF THIS. A headless capture has no cursor, so
// no chip is drawn on either side and the diff is 0 whether the rewrite is right
// or wrong. B3 measured the sibling case: `engine_bb_vs_legacy` read 0 px under a
// z-order mutation that a purpose-built case read 281 px on. `ChartRender.jsx`
// additionally CSS-hides the legend and the export never composites it, and not
// one of the 24 parity cases hovers. **THIS FILE IS THE GATE**, and every case
// below carries a control.
//
// ⛔ AND THE OBVIOUS B4 WOULD HAVE DELETED SIX CHIPS FOR EVERY USER. Nine chips
// ship; only three belong to a FLIPPED definition. A legend rendering
// `engineChips()` alone stops printing `%K`, `%D`, `ATR(14)`, `SAR`, `TK` and
// `KJ` — silently, invisibly, and with every test green. So the legend renders
// TWO lanes through ONE formatting pipeline (`readout.chipsFrom`), and the six
// legacy chips are declared on their own definitions' `plots[].legend`.
//
// ⚠️ THE EXPECTATIONS ARE PARSED OUT OF THE SHIPPED SOURCE, NOT HAND-TYPED.
// `shippedLegendChips()` reads the pre-B4 `legChips` array from `git show
// d2733adc:…` and throws by name if it cannot parse nine rows. A hand-copied
// expectation is the defect `readout.test.js` shipped once already — a
// `RENDERED_FIELDS` Set that never read `StockChart.jsx`, under which deleting
// the ATR row from the legend left 956 chart tests green.

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
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
    getVisibleRange: () => null, setVisibleRange: () => {}, scrollToPosition: () => {}, scrollPosition: () => 0,
    timeToCoordinate: () => 0, coordinateToTime: () => null, logicalToCoordinate: () => 0, coordinateToLogical: () => 0,
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
    // CAPTURED, not swallowed. Everything the legend does lives inside these.
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
  const ctx = { canvas: null, measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop: () => {} }), getImageData: () => ({ data: [] }) }
  for (const m of CANVAS_2D_NOOPS) ctx[m] = () => {}
  return ctx
}

beforeEach(() => {
  cleanup()
  H.reset()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

const { default: StockChart } = await import('../../../StockChart')
const registry = await import('../nativeRegistry')
const { mergeChartSettings } = await import('../../chartDefaults')

const BARS = bars200.bars
const SHIPPED = shippedLegendChips()
/** `['<defId>::<plotKey>', {label, decimals, color}]`, in the shipped order. */
const CHIPS = Object.entries(SHIPPED)

/** Every settings section whose chip ships, ON. Both lanes at once. */
const ALL_NINE_ON = () => mergeChartSettings({
  indicators: Object.fromEntries(
    [...new Set(CHIPS.map(([k]) => k.split('::')[0]))].map(id => [id, { enabled: true }])),
})

const draw = (settings) => render(
  <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settings} />,
)

const settledLegend = (view, param, ready) => settledLegendWith(view, param, H.crosshairHandlers, ready)

/**
 * `'<defId>::<plotKey>'` → the SERIES that plot was drawn on.
 *
 * ⛔ RESOLVED THROUGH THE DEFINITION'S OWN DECLARED COLOUR, never a hand-written
 * index. Each chip-bearing plot names a `$colorInput`; that input's declared
 * default is what both lanes hand `addSeries`, and the nine defaults are
 * distinct. THROWS BY NAME on zero or more than one match, so a case that cannot
 * find its series fails loudly instead of asserting on an empty legend.
 */
const seriesByChip = (keys = CHIPS.map(([k]) => k)) => {
  const out = new Map()
  for (const key of keys) {
    const [defId, plotKey] = key.split('::')
    const def = registry.getDefinition(defId)
    const plot = def.plots.find(p => p.key === plotKey)
    const refKey = plot.$refs && plot.$refs.color
    const color = refKey ? def.inputs.find(i => i.key === refKey).default : plot.color
    const hits = H.addSeriesCalls.filter(c => c.options && c.options.color === color)
    if (hits.length !== 1) {
      throw new Error(
        `seriesByChip: ${key} declares colour ${color} and ${hits.length} created series wear it ` +
        `(expected exactly 1). ${hits.length === 0
          ? 'The indicator was never drawn — check the settings this case renders with.'
          : 'Two plots now share a default colour; this resolver needs a different discriminator.'}`)
    }
    out.set(key, hits[0].series)
  }
  return out
}

/** A crosshair event: the candle, plus a value for each named chip. */
const crosshairWith = (values) => {
  const candle = H.addSeriesCalls.find(c => c.ctor === 'CandlestickSeries')
  expect(candle, 'no candle series — the chart never drew').toBeTruthy()
  const seriesData = new Map([[candle.series, { open: 1, high: 2, low: 0.5, close: 1.5 }]])
  if (values) {
    // ⚠️ ONLY the chips this event names. Resolving all nine would make a case
    // about a HIDDEN instance throw on the series that is correctly absent.
    const byChip = seriesByChip(Object.keys(values))
    for (const [key, v] of Object.entries(values)) seriesData.set(byChip.get(key), { value: v })
  }
  return { time: BARS.at(-1).t, point: { x: 100, y: 100 }, logical: BARS.length - 1, seriesData }
}

/**
 * The INDICATOR CHIP spans, in DOM order.
 *
 * ⚠️ A STRUCTURAL READ, not a text match against the expectation. Chip spans are
 * the legend row's only children with NO class and no nested `<strong>` — the
 * OHLC cells carry `styles.legendLabel`, the MA overlays nest a `<strong>`. A
 * read that filtered by the expected text could never fail.
 */
const chipTexts = (view) => {
  const o = [...view.container.querySelectorAll('span')].find(s => /^O\s/.test(s.textContent || ''))
  expect(o, 'the legend never rendered — this case is asserting on nothing').toBeTruthy()
  return [...o.parentElement.children]
    .filter(el => el.tagName === 'SPAN' && !el.className && !el.querySelector('strong'))
    .map(el => el.textContent)
}

/** What the chip for `key` reads when its series carries `v`. */
const expected = (key, v) => `${SHIPPED[key].label} ${v.toFixed(SHIPPED[key].decimals)}`

describe('B4 Task 10 — the legend renders from the definitions, on both lanes', () => {
  it('the fixture really does turn on both lanes — engine AND legacy', () => {
    // ⛔ THE NON-VACUITY GATE FOR EVERY CASE BELOW. If `ALL_NINE_ON()` failed to
    // draw, say, Ichimoku, `seriesByChip` would throw — but a case asserting
    // "no chip for X" would pass for the wrong reason. Six DEFINITIONS carry the
    // nine chips; four of them (`stoch`, `atr`, `sar`, `ichimoku`) are NOT
    // migrated and MUST NOT BE — B4 ships zero migrations.
    const view = draw(ALL_NINE_ON())
    const byChip = seriesByChip()
    expect(byChip.size).toBe(9)
    expect([...new Set(CHIPS.map(([k]) => k.split('::')[0]))].sort())
      .toEqual(['atr', 'ichimoku', 'macd', 'rsi', 'sar', 'stoch'])
    view.unmount()
  })

  it('renders exactly the nine chips the shipped legend rendered, character for character', async () => {
    const view = draw(ALL_NINE_ON())
    const values = Object.fromEntries(CHIPS.map(([k], i) => [k, 10 + i * 1.111111]))
    const text = await settledLegend(view, crosshairWith(values))
    expect(text.length, 'the legend read is empty').toBeGreaterThan(10)
    expect(chipTexts(view), 'the legend is no longer printing the nine chips it shipped with')
      .toEqual(CHIPS.map(([k]) => expected(k, values[k])))
  })

  it('chips appear in binding order — engine lane first, then legacy, the shipped order', async () => {
    // The shipped order is rsi · macd · SIG · %K · %D · ATR · SAR · TK · KJ,
    // which is engine-then-legacy AND registry order within each lane. A `Map`'s
    // insertion order would have put a late-enabled Stochastic at the END; the
    // legacy lane is sorted by `LEGACY_CHIP_ORDER`, derived from the registry.
    const view = draw(ALL_NINE_ON())
    const values = Object.fromEntries(CHIPS.map(([k], i) => [k, 20 + i]))
    await settledLegend(view, crosshairWith(values))
    expect(chipTexts(view).map(t => t.split(' ')[0]))
      .toEqual(CHIPS.map(([k]) => SHIPPED[k].label))
  })

  it.each(CHIPS)('%s formats from the definition and matches its shipped row', async (key) => {
    const view = draw(ALL_NINE_ON())
    const V = 42.987654321
    await settledLegend(view, crosshairWith({ [key]: V }))
    const texts = chipTexts(view)
    expect(texts, `${key}'s chip is missing from the legend`).toContain(expected(key, V))
    // …and its COLOUR is the one the shipped row printed for an untouched blob.
    const o = [...view.container.querySelectorAll('span')].find(s => /^O\s/.test(s.textContent || ''))
    const span = [...o.parentElement.children].find(el => el.textContent === expected(key, V))
    expect(span.style.color.replace(/\s/g, ''), `${key}'s chip changed colour`)
      .toBe(hexToRgb(SHIPPED[key].color))
    view.unmount()
  })

  it('a plot with no legend block emits no chip — spanA, spanB, chikou and every guide', async () => {
    // Ichimoku draws FIVE lines and declares chips on TWO. The cloud and the
    // lagging line have always been chip-less; a `chipsFrom` that emitted for
    // every plot it could would put three undeclared numbers in the readout.
    const view = draw(ALL_NINE_ON())
    await settledLegend(view, crosshairWith(Object.fromEntries(CHIPS.map(([k], i) => [k, 30 + i]))))
    const texts = chipTexts(view)
    expect(texts, 'a plot with no legend block started emitting a chip').toHaveLength(9)
    for (const bad of ['Span', 'Chikou', 'Histogram', 'Upper', 'Lower', 'Basis']) {
      expect(texts.join(' '), `an undeclared plot is in the legend: ${bad}`).not.toContain(bad)
    }
    // …and the guide LEVELS (70/30, 80/20, 0) are not chips either. `50` would
    // false-positive on a value, so the guide labels are checked by count above.
    expect(new Set(texts.map(t => t.split(' ')[0])).size, 'two chips share a label').toBe(9)
  })

  it('the developing-bar fallback survives on BOTH lanes', async () => {
    // ⛔ THE NORMAL LIVE CASE, NOT AN EDGE ONE. The bars-push writer appends the
    // developing candle before the indicator has it, so the hovered bar carries
    // no point for the indicator series. Legacy printed the last computed value;
    // an engine chip that printed NOTHING was a readout regression no pixel gate
    // could see (B3 I-3). Here NO chip series carries a value at all.
    const view = draw(ALL_NINE_ON())
    const text = await settledLegend(view, crosshairWith(null))
    const labels = chipTexts(view).map(t => t.split(' ')[0])
    expect(text.length, 'the legend read is empty').toBeGreaterThan(10)
    // ENGINE lane (`binding.lastValue`) and LEGACY lane (the registered thunk)
    // both fall back. ⚠️ Ichimoku does NOT, and that is TRANSCRIBED not broken:
    // the shipped read was `dt?.value ?? null` with no `indicatorData` fallback,
    // so giving it one here would be a behaviour change B4 does not make.
    expect(labels.sort(), 'a lane lost its developing-bar fallback')
      .toEqual(['%D', '%K', 'ATR(14)', 'MACD', 'RSI(14)', 'SAR', 'SIG'].sort())
    for (const t of chipTexts(view)) expect(t, 'a fallback chip printed NaN').not.toMatch(/NaN/)
  })

  it('a hidden instance emits no chip, and re-showing brings the same one back', async () => {
    const base = ALL_NINE_ON()
    const hidden = {
      ...base,
      indicatorInstances: [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14, color: '#7b68ee' }, hidden: true }],
    }
    const v1 = draw(hidden)
    await settledLegend(v1, crosshairWith({ 'macd::macd': 5 }))
    expect(chipTexts(v1).some(t => t.startsWith('RSI')), 'a HIDDEN instance still printed a chip').toBe(false)
    // …and the control: the same blob with `hidden: false` prints it.
    v1.unmount(); cleanup(); H.reset()
    const shown = { ...hidden, indicatorInstances: [{ ...hidden.indicatorInstances[0], hidden: false }] }
    const v2 = draw(shown)
    await settledLegend(v2, crosshairWith({ 'rsi::rsi': 54.321 }))
    expect(chipTexts(v2), 're-showing did not bring the chip back').toContain('RSI(14) 54.3')
  })

  it('the comparison chip still renders and is NOT an indicator chip', async () => {
    // It is a SYMBOL overlay: no definition, no `plots[]`, and a signed
    // percentage no `legend` block can express. It stays hand-written, and it
    // stays LAST — after the indicator chips, which is where it shipped.
    // The compare overlay is fed by its own SWR fetch, so the stub has to answer
    // it — otherwise `comparisonData` is empty, no series is created, and the
    // case would pass by finding nothing rather than by the chip being right.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ bars: BARS }) })))
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={ALL_NINE_ON()} compareSymbol="SPY" />)
    await act(async () => { await new Promise(r => setTimeout(r, 60)) })
    // ⚠️ BY ITS PRICE SCALE, not only its colour: the index pane draws a second
    // `#fb923c` line, and picking the wrong one would feed the value to a series
    // the legend's compare read never looks at.
    const cmp = H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'compare')
    expect(cmp, 'no comparison series was drawn — this case would pass by finding nothing')
      .toHaveLength(1)
    const param = crosshairWith({ 'rsi::rsi': 54.321 })
    param.seriesData.set(cmp[0].series, { value: 1.5 })
    await settledLegend(view, param)
    const texts = chipTexts(view)
    expect(texts.at(-1), 'the comparison chip is no longer last, or no longer rendered')
      .toBe('SPY +1.50%')
    expect(texts.filter(t => t.startsWith('SPY')), 'the comparison chip was duplicated').toHaveLength(1)
  })

  it('every crosshair subscriber that needs the legend gets it — there are TWO', async () => {
    // ⚠️ StockChart registers TWO handlers on one chart: the legend's and the
    // hovered-bar recorder's. `H.crosshairHandlers.at(-1)` is the WRONG one, and
    // reading it made EVERY legend assertion — including the legacy control —
    // measure a legend nobody asked to update (B3 Task 2, brief-wrong #1).
    const view = draw(ALL_NINE_ON())
    expect(H.crosshairHandlers.length,
      'the number of crosshair subscribers changed — the fan-out below may now be reaching the wrong one')
      .toBe(2)
    const param = crosshairWith({ 'rsi::rsi': 54.321 })

    // Delivering to ONE handler is not enough for both: exactly one of the two
    // updates the legend, and which one is an ordering detail no case may assume.
    const solo = []
    for (const fn of [...H.crosshairHandlers]) {
      cleanup(); H.reset()
      const v = draw(ALL_NINE_ON())
      const p = crosshairWith({ 'rsi::rsi': 54.321 })
      const idx = solo.length
      await act(async () => { H.crosshairHandlers[idx](p); await new Promise(r => setTimeout(r, 80)) })
      solo.push(legendTextOf(v).includes('RSI(14) 54.3'))
      v.unmount()
    }
    expect(solo.filter(Boolean), 'exactly one subscriber should be the legend').toHaveLength(1)

    // …and the fan-out reaches it whichever position it holds.
    cleanup(); H.reset()
    const v = draw(ALL_NINE_ON())
    await settledLegend(v, crosshairWith({ 'rsi::rsi': 54.321 }))
    expect(chipTexts(v)).toContain('RSI(14) 54.3')
    view.unmount()
  })
})

/** `#rrggbb` → the `rgb(r, g, b)` jsdom reports for an inline style. */
function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16))
  return `rgb(${r},${g},${b})`
}
