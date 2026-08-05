import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bars200 from '../../../../pages/parityBars/ramp200.json'
import { legendTextOf, settledLegend as settledLegendWith, shippedLegendChips } from './legendProbe'
import { stripComments } from './sourceScan'

/** `StockChart.jsx`, resolved from THIS file rather than from `process.cwd()` —
 *  vitest is run from `app/` and from the repo root at different times. */
const STOCK_CHART_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../../StockChart.jsx')
const readFileSync = fs.readFileSync

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
// ship; at B4 only three belonged to a FLIPPED definition. A legend rendering
// `engineChips()` alone stopped printing `%K`, `%D`, `ATR(14)`, `SAR`, `TK` and
// `KJ` — silently, invisibly, and with every test green. So the legend rendered
// TWO lanes through ONE formatting pipeline (`readout.chipsFrom`), and the six
// legacy chips were declared on their own definitions' `plots[].legend`.
//
// ⭐ AND AS OF B5 TASK 6 THERE IS ONE LANE AGAIN, WHICH IS WHY THE LANE RECORDER
// BELOW IS THE SHARPEST THING IN THIS FILE. Task 5 moved `%K`, `%D` and `ATR(14)`
// onto the engine and Task 6 moved `SAR`, `TK` and `KJ`, so all nine chips come
// from `binder.bindings()` and `registerLegacyChip` / `legacyChipEntriesRef` /
// `csIndicatorsRef` / `LEGACY_CHIP_ORDER` are DELETED. The rendered text did not
// change by one character at either step — which is exactly the change no
// assertion on the rendered text could ever see.
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
  // ── WHICH LANE PRODUCED WHICH CHIP ─────────────────────────────────────────
  //
  // ⛔ THE ASSERTION THE RENDERED TEXT CANNOT MAKE, AND B5'S MIGRATIONS ARE
  // EXACTLY THE CHANGE IT EXISTS FOR. A flip moves a chip from
  // `legacyChipEntriesRef` to `binder.bindings()` and the TEXT IS IDENTICAL BY
  // DESIGN — both lanes format through `readout.chipsFrom` off the same
  // `plots[].legend` block. So "the nine chips still read the same" stays green
  // whether the migration retired the legacy registration or LEFT IT IN PLACE,
  // and a chip drawn twice, one exactly on top of the other, is invisible in
  // text. These two lists are the source, recorded at the two call sites
  // `StockChart` uses: `engineChips(bindings, …)` and `chipsFrom(entries, …)`.
  engineChipKeys: [],
  legacyChipKeys: [],
  reset() {
    H.addSeriesCalls.length = 0
    H.crosshairHandlers.length = 0
    H.chartContainers.length = 0
    H.engineChipKeys.length = 0
    H.legacyChipKeys.length = 0
  },
}))

// ⚠️ A PASS-THROUGH, NOT A DOUBLE. Every case in this file asserts on real
// formatted chips; a mock that invented them would make the whole suite a test
// of the mock. `engineChips` calls the module-INTERNAL `chipsFrom`, not the
// exported binding, so the `chipsFrom` recorder below sees StockChart's direct
// call — the LEGACY lane — and nothing else. That separation is what makes the
// two lists disjoint by construction rather than by filtering.
vi.mock('../readout', async (importOriginal) => {
  const actual = await importOriginal()
  const keys = (chips) => chips.map(c => `${c.defId}::${c.plotKey}`)
  return {
    ...actual,
    engineChips: (...args) => {
      const out = actual.engineChips(...args)
      H.engineChipKeys.splice(0, H.engineChipKeys.length, ...keys(out))
      return out
    },
    chipsFrom: (...args) => {
      const out = actual.chipsFrom(...args)
      H.legacyChipKeys.splice(0, H.legacyChipKeys.length, ...keys(out))
      return out
    },
  }
})

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
const { ENGINE_FLIPPED_DEF_IDS } = await import('../flipState')
const { computePaneLayout } = await import('../paneLayout')
const { stackRank } = await import('../instances')

const BARS = bars200.bars
const SHIPPED = shippedLegendChips()
/** `['<defId>::<plotKey>', {label, decimals, color}]`, in the shipped order. */
const CHIPS = Object.entries(SHIPPED)

/** The same chips in the order the legend prints them after B5 Task 13 — the
 *  fold's SHIPPED STACK order. DERIVED with a STABLE sort, so a definition's own
 *  plots keep declaration order (`macd::macd` before `macd::signal`) and a chip
 *  whose definition the frozen array does not rank keeps its shipped position. */
const CHIPS_IN_STACK_ORDER = [...CHIPS].sort(
  (a, b) => stackRank(a[0].split('::')[0]) - stackRank(b[0].split('::')[0]))


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
  it('the fixture draws all nine, and EVERY chip-bearing definition is now flipped', () => {
    // ⛔ THE NON-VACUITY GATE FOR EVERY CASE BELOW. If `ALL_NINE_ON()` failed to
    // draw, say, Ichimoku, `seriesByChip` would throw — but a case asserting
    // "no chip for X" would pass for the wrong reason. Six DEFINITIONS carry the
    // nine chips.
    //
    // 🔴 THIS CASE HAS BEEN INVERTED TWICE, AND SAYING SO IS THE POINT. At B4 it
    // ended *"four of them (`stoch`, `atr`, `sar`, `ichimoku`) are NOT migrated
    // and MUST NOT BE — B4 ships zero migrations"*; B5 Task 5 falsified half of it
    // and it became a PARTITION (four flipped, two not); **B5 Task 6 empties the
    // second half of that partition entirely.** All six chip-bearing definitions
    // are flipped, so the LEGACY lane has no producer — which is not a loss of
    // coverage, it is the fact that licensed deleting `registerLegacyChip`, and it
    // is asserted here rather than inferred.
    const view = draw(ALL_NINE_ON())
    const byChip = seriesByChip()
    expect(byChip.size).toBe(9)
    expect([...new Set(CHIPS.map(([k]) => k.split('::')[0]))].sort())
      .toEqual(['atr', 'ichimoku', 'macd', 'rsi', 'sar', 'stoch'])
    for (const id of ['rsi', 'macd', 'stoch', 'atr', 'sar', 'ichimoku']) {
      expect(ENGINE_FLIPPED_DEF_IDS.has(id),
        `${id} is not flipped — the ENGINE lane no longer carries its chip, and the `
        + 'LEGACY lane that used to carry it has been deleted').toBe(true)
    }
    view.unmount()
  })

  it('⛔ and the legacy chip REGISTRAR is gone from the SOURCE, not merely unused', () => {
    // ⛔ A DEAD MECHANISM READS AS A MECHANISM. `registerLegacyChip` re-added as a
    // no-op with no callers is invisible to every assertion in this file — the
    // chips would still all come from the engine lane — so the only thing that can
    // see it is a probe on the IDENTIFIERS, WITH COMMENTS STRIPPED. The stripping
    // is not decoration: `StockChart.jsx` names all four of them in the tombstone
    // paragraphs where they used to live, on purpose, so a raw read of the file
    // would report them alive forever.
    const src = stripComments(readFileSync(STOCK_CHART_PATH, 'utf-8'))
    for (const ident of ['registerLegacyChip', 'legacyChipEntriesRef',
      'csIndicatorsRef', 'LEGACY_CHIP_ORDER']) {
      expect(src, `${ident} is still live code in StockChart.jsx`).not.toContain(ident)
    }
    // The controls: the probe is not blind, and the stripper did not eat the file.
    expect(src, 'the source probe read nothing').toContain('engineChips')
    expect(src).toContain('engineInstancesRef')
    expect(src.length).toBeGreaterThan(50_000)
  })

  it('⭐ ALL NINE now come from the ENGINE lane, and the legacy lane produces NOTHING', async () => {
    // ⭐ THE SOURCE FLIPS EVEN THOUGH THE TEXT DOES NOT. Without this the
    // migration could have left the legacy registration in place beside the new
    // engine binding and the chip would be produced twice — one exactly on top of
    // the other in the same colour with the same number, invisible in text and
    // invisible to every pixel case (a headless capture has no cursor).
    //
    // ⭐ SAR, TK AND KJ ARE THE LAST THREE TO MOVE (B5 Task 6), SO THE LEGACY LIST
    // IS NOW EMPTY — and that empty list is the assertion. `chipsFrom` is recorded
    // at StockChart's own call site; `engineChips` calls the module-INTERNAL
    // `chipsFrom` and therefore never trips this recorder, so ONE surviving
    // `registerLegacyChip('sar', …)` would put `sar::sar` straight back on it.
    const view = draw(ALL_NINE_ON())
    const values = Object.fromEntries(CHIPS.map(([k], i) => [k, 10 + i * 1.111111]))
    await settledLegend(view, crosshairWith(values))

    // ⛔ `toEqual`, NOT `arrayContaining`, ON BOTH SIDES. `arrayContaining` on the
    // legacy list is exactly the assertion a left-behind registration survives.
    expect([...H.legacyChipKeys].sort(),
      'the legacy lane still holds a chip — that chip is now drawn twice, and the ' +
      'rendered text is identical either way')
      .toEqual([])
    expect([...H.engineChipKeys].sort(),
      'a flipped definition produced no engine chip — the legend lost it silently')
      .toEqual(['atr::atr', 'ichimoku::kijun', 'ichimoku::tenkan', 'macd::macd',
        'macd::signal', 'rsi::rsi', 'sar::sar', 'stoch::d', 'stoch::k'])

    // …and the ONE lane covers the nine with no duplicates. A key twice is the
    // double-draw; a key missing is a chip nobody prints.
    const all = [...H.engineChipKeys, ...H.legacyChipKeys]
    expect(new Set(all).size, 'a chip is produced twice').toBe(all.length)
    expect(all.sort(), 'the engine lane stopped covering the nine shipped chips')
      .toEqual(CHIPS.map(([k]) => k).sort())
    view.unmount()
  })

  it('ATR still prints its period, because the DEFINITION declares legendParams', async () => {
    // `meta.legendParams: ['period']` is what puts the number in the brackets, and
    // it is read by `chipLabel` from the INSTANCE's inputs now rather than from
    // `cs.indicators.atr`. Dropping it reads `ATR 2.7000`.
    const view = draw(ALL_NINE_ON())
    await settledLegend(view, crosshairWith({ 'atr::atr': 2.7 }))
    const atr = chipTexts(view).find(t => t.startsWith('ATR'))
    expect(atr, 'the ATR chip is gone from the legend').toBeTruthy()
    expect(atr).toMatch(/^ATR\(14\) -?\d+\.\d{4}$/)
    expect(atr).toBe('ATR(14) 2.7000')
    view.unmount()
  })

  it('…and it follows the INSTANCE\'s period, which is the engine lane\'s answer', async () => {
    // ⛔ THE HALF THAT PROVES THE LANE, NOT JUST THE LABEL. The legacy lane
    // resolves inputs from `cs.indicators.atr`; the engine lane resolves them per
    // INSTANCE. A blob whose two disagree therefore reads differently on each
    // lane, and `ATR(21)` is only reachable through the engine's.
    const base = ALL_NINE_ON()
    const view = draw({
      ...base,
      indicators: { ...base.indicators, atr: { ...base.indicators.atr, period: 14 } },
      indicatorInstances: [{
        instanceId: 'legacy:atr', defId: 'atr', inputs: { period: 21, color: '#FFA726' },
        placement: { target: 'pane' }, hidden: false,
      }],
    })
    await settledLegend(view, crosshairWith({ 'atr::atr': 2.7 }))
    expect(chipTexts(view).find(t => t.startsWith('ATR')),
      'the ATR chip is still reading cs.indicators.atr — it is on the wrong lane')
      .toBe('ATR(21) 2.7000')
    view.unmount()
  })

  it('and %K/%D still print NO period, because stoch declares none — deliberately', async () => {
    // ⛔ THE ABSENCE IS THE ASSERTION, AND IT IS HELD FROM BOTH SIDES. `stoch`
    // declares no `meta.legendParams`, so its chips are `%K 54.3` with no
    // brackets — the shipped text. `legend.label` short-circuits `legendParams`
    // in `chipLabel`, so ADDING params would be inert today and would start
    // printing `%K(14, 3)` the day a label is dropped: a change nothing else
    // would catch.
    const view = draw(ALL_NINE_ON())
    await settledLegend(view, crosshairWith({ 'stoch::k': 54.3, 'stoch::d': 51.9 }))
    const texts = chipTexts(view)
    for (const label of ['%K', '%D']) {
      const chip = texts.find(t => t.startsWith(label))
      expect(chip, `${label} is gone from the legend`).toBeTruthy()
      expect(chip).toMatch(/^%[KD] -?\d+\.\d$/)
      expect(chip, `${label} grew a parameter list`).not.toMatch(/\(/)
    }
    expect(texts).toContain('%K 54.3')
    expect(texts).toContain('%D 51.9')
    expect(registry.getDefinition('stoch').meta.legendParams,
      'stoch declared legendParams — the shipped chips have no brackets').toBeUndefined()
    view.unmount()
  })

  it('renders exactly the nine chips the shipped legend rendered, character for character', async () => {
    const view = draw(ALL_NINE_ON())
    const values = Object.fromEntries(CHIPS.map(([k], i) => [k, 10 + i * 1.111111]))
    const text = await settledLegend(view, crosshairWith(values))
    expect(text.length, 'the legend read is empty').toBeGreaterThan(10)
    // ⚠️ B5 TASK 13 MOVED THE ORDER AND NOTHING ELSE — see the case below. The
    // chips, their labels, their decimals and their text are still the shipped
    // ones character for character, which is what this case is named for, so the
    // SET is asserted here against the shipped fixture and the ORDER is asserted
    // (derived, not typed) against the stack.
    expect([...chipTexts(view)].sort(),
      'the legend is no longer printing the nine chips it shipped with')
      .toEqual(CHIPS.map(([k]) => expected(k, values[k])).sort())
    expect(chipTexts(view))
      .toEqual(CHIPS_IN_STACK_ORDER.map(([k]) => expected(k, values[k])))
  })

  it('chips appear in BINDING order — which B5 Task 13 made the STACK order', async () => {
    // The shipped order was rsi · MACD · SIG · %K · %D · ATR · SAR · TK · KJ. It
    // is now rsi · %K · %D · MACD · SIG · ATR · SAR · TK · KJ.
    //
    // ⭐ IT USED TO READ "engine lane first, then legacy, registry order within
    // each", AND IT SURVIVED THE TWO LANES COLLAPSING INTO ONE WITHOUT AN EDIT:
    // the read-time migrator walked the REGISTRY, so instance order was registry
    // order, and `planBindings` walks each definition's plots in declaration
    // order.
    //
    // ⛔⭐ B5 TASK 9 NEARLY MOVED IT AND B5 TASK 13 DID — DELIBERATELY, AND THIS IS
    // THE PRICE OF THE OWNER'S "PRESERVE TODAY'S". The fold now seeds the instance
    // list in SHIPPED STACK ORDER so an existing user's PANES come out stacked the
    // way their bands are stacked today; chips render in BINDING order, which
    // walks the same list, so `%K`/`%D` move ahead of `MACD`/`SIG` here.
    //
    // ⚠️ TODAY'S SHIPPED LEGEND AND TODAY'S SHIPPED BAND STACK DISAGREE — that is
    // the fact that makes this a trade and not a free win: the legend lists MACD
    // before %K while the band stack puts stoch ABOVE macd. Both cannot be
    // preserved by one list. The panes win because they are the surface the owner
    // answered about and the one a user looks at; the legend's SET and TEXT are
    // untouched, and after this it agrees with the stack it sits above, which is
    // the reading a user of real panes will make. Recorded in the Flip C record §7.
    const view = draw(ALL_NINE_ON())
    const values = Object.fromEntries(CHIPS.map(([k], i) => [k, 20 + i]))
    await settledLegend(view, crosshairWith(values))
    expect(chipTexts(view).map(t => t.split(' ')[0]))
      .toEqual(CHIPS_IN_STACK_ORDER.map(([k]) => SHIPPED[k].label))
    // …and it really is a MOVE: the shipped fixture orders them differently. If
    // this ever stops being true the trade above evaporated and the note is stale.
    expect(CHIPS_IN_STACK_ORDER.map(([k]) => SHIPPED[k].label),
      'the stack order and the shipped legend order collapsed onto each other')
      .not.toEqual(CHIPS.map(([k]) => SHIPPED[k].label))
  })

  // ✅ TASK 12 / FLIP C — THE RECORDED MISMATCH WENT STALE, EXACTLY AS THIS CASE
  // SAID IT WOULD, SO IT IS INVERTED RATHER THAN DELETED.
  //
  // It used to read: *"The legend prints in BINDING order (registry order). The
  // CHART stacks its bands in `PANES` order, and the two disagree: `stoch`'s band
  // sits ABOVE `macd`'s while the legend lists MACD first … Flip C turns those
  // bands into real panes, at which point 'the legend reads top-to-bottom' becomes
  // a claim somebody will make. It is false today"* — and it ended by instructing
  // its own deletion if the two ever agreed.
  //
  // ⭐ THEY AGREE NOW, AND THE REASON IS THE WHOLE OF TASK 12. `paneMargins.PANES`
  // — the nine-row table that fixed the stack order independently of anything the
  // user had — is DELETED. `computePaneLayout` orders its panes (and its bands)
  // from the INSTANCE LIST, and the legend prints in BINDING order, which walks
  // the same list. One list, two readings: the legend reads top-to-bottom.
  //
  // ⛔ SO THE CLAIM IS INVERTED INSTEAD OF DROPPED, because it is exactly as
  // fragile as it was interesting. Sorting panes by `instances.stackRank` INSIDE
  // `computePaneLayout` — the other way to give existing users back the pane order
  // their BANDS had — breaks it, and would do so silently: the legend cannot see
  // the panes and no pixel case hovers.
  //
  // ⭐ B5 TASK 13 TOOK THE OTHER ROUTE FOR EXACTLY THAT REASON — it sorted the
  // LIST (in the fold), not the layout, so both readings moved together and this
  // case still holds. It is now read off the RENDERED legend rather than off the
  // shipped fixture, because the fixture is what the legend printed in July and
  // the claim is about what it prints today.
  it('✅ …and that IS the pane order the chart draws — one list, two readings', async () => {
    const paneIds = registry.listDefinitions()
      .filter(d => d.placement.target === 'pane').map(d => d.id)
    // The instances a REAL chart holds for this fixture — the fold's output, not a
    // hand-built list — because that list is the thing both orders now read.
    const settings = ALL_NINE_ON()
    const insts = settings.indicatorInstances
    expect(insts.length, 'the fixture seeded no instances — the comparison is not one')
      .toBeGreaterThan(3)
    const bands = computePaneLayout(insts, { hasVolumeBand: false, excludeKeys: new Set() }).bands
    // `bands` is keyed bottom-of-the-chart first and ends with `main`; reversing
    // the oscillator keys gives the stack TOP-TO-BOTTOM, which is pane order.
    const topToBottom = Object.keys(bands).filter(k => k !== 'main' && k !== 'volume').reverse()

    // ⛔ THE LEGEND ORDER IS READ BACK OUT OF THE DOM, not derived from the same
    // list a second time — a comparison between two readings of one array is not
    // a comparison. `planBindings` and `computePaneLayout` are different walks.
    const view = draw(settings)
    await settledLegend(view, crosshairWith(
      Object.fromEntries(CHIPS.map(([k], i) => [k, 20 + i]))))
    const labelToDef = new Map(CHIPS.map(([k]) => [SHIPPED[k].label, k.split('::')[0]]))
    const renderedDefs = [...new Set(chipTexts(view)
      .map(t => labelToDef.get(t.split(' ')[0])).filter(Boolean))]
    view.unmount()

    const chipDefs = [...new Set(CHIPS.map(([k]) => k.split('::')[0]))]
    const legendPaneOrder = renderedDefs.filter(id => paneIds.includes(id))
    const chartPaneOrder = topToBottom.filter(id => chipDefs.includes(id))
    expect(new Set(legendPaneOrder), 'the two are over different sets — the comparison is not one')
      .toEqual(new Set(chartPaneOrder))
    expect(legendPaneOrder,
      'the legend and the pane stack disagree again. If that is deliberate — a stackRank '
      + 'sort inside the LAYOUT rather than in the fold — say so in the Flip C notes and '
      + 'record the new mismatch here; if it is not, the panes moved and nothing else can see it.')
      .toEqual(chartPaneOrder)
    // …and the exact order, so a future reader does not have to re-derive it. This
    // IS the band stack the chart draws today: `rsi · stoch · macd · atr`.
    expect(legendPaneOrder).toEqual(['rsi', 'stoch', 'macd', 'atr'])
    expect(chartPaneOrder).toEqual(['rsi', 'stoch', 'macd', 'atr'])
    // ⛔ AND IT IS NOT THE ORDER THE SHIPPED LEGEND PRINTED — the priced cost of
    // giving the panes back their order, named where a reader will meet it.
    expect(chipDefs.filter(id => paneIds.includes(id)),
      'the shipped legend order now equals the stack order — the trade recorded in '
      + 'the case above evaporated, and that note is stale')
      .toEqual(['rsi', 'macd', 'stoch', 'atr'])
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

  it('⭐ TK and KJ now print on the DEVELOPING bar, which they never did before', async () => {
    // ⛔ THE NORMAL LIVE CASE, NOT AN EDGE ONE. The bars-push writer appends the
    // developing candle before the indicator has it, so the hovered bar carries
    // no point for the indicator series. Legacy printed the last computed value;
    // an engine chip that printed NOTHING was a readout regression no pixel gate
    // could see (B3 I-3). Here NO chip series carries a value at all.
    //
    // ⭐⭐ B5 TASK 6'S ONE NAMED BEHAVIOUR CHANGE, AND IT IS ASSERTED RATHER THAN
    // ALLOWED TO LAND SILENTLY.
    //
    //   BEFORE: this case expected SEVEN labels —
    //   ['%D', '%K', 'ATR(14)', 'MACD', 'RSI(14)', 'SAR', 'SIG'] — and its own
    //   comment said *"⚠️ Ichimoku does NOT, and that is TRANSCRIBED not broken:
    //   the shipped read was `dt?.value ?? null` with no `indicatorData`
    //   fallback"*. `StockChart.jsx:6492-6493` registered `ichimoku::tenkan` and
    //   `::kijun` with a series and **no thunk**, so on the developing bar the
    //   two chips printed nothing at all.
    //
    //   AFTER: NINE. The engine lane's fallback is `binding.lastValue`, which is
    //   a NUMBER on every binding — there is no per-registration opt-out to
    //   transcribe — so TK and KJ fall back like every other chip. This is the
    //   same gap B3 closed for RSI as review finding I-3, every other chip
    //   already had it, and **no pixel case can see any of it** (a headless
    //   capture has no cursor), which is exactly why it is written down here.
    const view = draw(ALL_NINE_ON())
    const text = await settledLegend(view, crosshairWith(null))
    const labels = chipTexts(view).map(t => t.split(' ')[0])
    expect(text.length, 'the legend read is empty').toBeGreaterThan(10)
    expect(labels.sort(), 'a chip lost its developing-bar fallback')
      .toEqual(['%D', '%K', 'ATR(14)', 'KJ', 'MACD', 'RSI(14)', 'SAR', 'SIG', 'TK'].sort())
    // …and TK/KJ print a real formatted number, not a blank or a NaN.
    for (const label of ['TK', 'KJ']) {
      const chip = chipTexts(view).find(t => t.startsWith(`${label} `))
      expect(chip, `${label} printed no chip on the developing bar`).toMatch(/^(TK|KJ) -?\d+\.\d{2}$/)
    }
    for (const t of chipTexts(view)) expect(t, 'a fallback chip printed NaN').not.toMatch(/NaN/)
  })

  it('…and the control: it really IS the developing bar, not just "a bar"', async () => {
    // ⛔ WITHOUT THIS, THE CASE ABOVE PASSES ON A CROSSHAIR THAT SIMPLY HOVERED A
    // NORMAL BAR. The claim is about the state where the CANDLE has a point at
    // the hovered time and the indicator series does NOT — so both halves are
    // asserted on the same event: the candle is in `seriesData`, and not one
    // chip-bearing series is.
    const view = draw(ALL_NINE_ON())
    const param = crosshairWith(null)
    const candle = H.addSeriesCalls.find(c => c.ctor === 'CandlestickSeries')
    expect(param.seriesData.has(candle.series),
      'the candle is absent — this is not the developing-bar state').toBe(true)
    const chipSeries = [...seriesByChip().values()]
    expect(chipSeries.length).toBe(9)
    for (const s of chipSeries) {
      expect(param.seriesData.has(s),
        'a chip series HAS a point at the hovered time — the fallback is not what printed').toBe(false)
    }
    await settledLegend(view, param)
    expect(chipTexts(view)).toHaveLength(9)
  })

  it('a hidden instance emits no chip, and re-showing brings the same one back', async () => {
    // ⭐ B5 TASK 9: `ALL_NINE_ON()` is a MERGED blob, so the fold has already
    // seeded an instance per enabled definition. Replacing the whole list with
    // one rsi entry (which is what this case used to do) now deletes the other
    // eight and the control below has nothing to draw — the probe throws by name
    // on "0 created series", which is how it was caught. Patch the seeded one.
    const base = ALL_NINE_ON()
    const hidden = {
      ...base,
      indicatorInstances: base.indicatorInstances.map(
        i => (i.defId === 'rsi' ? { ...i, hidden: true } : i)),
    }
    expect(hidden.indicatorInstances.some(i => i.defId === 'rsi' && i.hidden),
      'the fixture does not hide anything').toBe(true)
    const v1 = draw(hidden)
    await settledLegend(v1, crosshairWith({ 'macd::macd': 5 }))
    expect(chipTexts(v1).some(t => t.startsWith('RSI')), 'a HIDDEN instance still printed a chip').toBe(false)
    // …and the control: the same blob with `hidden: false` prints it.
    v1.unmount(); cleanup(); H.reset()
    const shown = { ...hidden, indicatorInstances: hidden.indicatorInstances.map(
      i => (i.defId === 'rsi' ? { ...i, hidden: false } : i)) }
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
