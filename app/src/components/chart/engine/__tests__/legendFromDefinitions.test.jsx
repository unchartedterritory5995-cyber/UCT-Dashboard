import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
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
  //
  // ⭐ AND A THIRD LIST AT chart-UX-walls TASK 3, BECAUSE THE LIVE LANE MOVED.
  // `StockChart` calls `legendChips` now, which walks the INSTANCE list and calls
  // the module-INTERNAL `engineChips` for the valued half — so a regression to
  // `engineChips` at the call site is invisible in the rendered text of a chart
  // with nothing hidden, and deletes every hidden instance's chip on a chart with
  // something hidden. `engineChipKeys` is therefore asserted EMPTY: it records
  // only what `StockChart` itself calls.
  legendChipKeys: [],
  engineChipKeys: [],
  legacyChipKeys: [],
  reset() {
    H.addSeriesCalls.length = 0
    H.crosshairHandlers.length = 0
    H.chartContainers.length = 0
    H.legendChipKeys.length = 0
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
    legendChips: (...args) => {
      const out = actual.legendChips(...args)
      H.legendChipKeys.splice(0, H.legendChipKeys.length, ...keys(out))
      return out
    },
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
const { ENGINE_OWNED } = await import('../flipState')
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

/** The legend row — the `O 1.00` cell's PARENT, which is where every chip is a
 *  direct child in all three legend variants. */
const legendRowOf = (view) => {
  const o = [...view.container.querySelectorAll('span')].find(s => /^O\s/.test(s.textContent || ''))
  expect(o, 'the legend never rendered — this case is asserting on nothing').toBeTruthy()
  return o.parentElement
}

/**
 * The INDICATOR CHIP spans, in DOM order.
 *
 * ⚠️ A STRUCTURAL READ, not a text match against the expectation. A read that
 * filtered by the expected text could never fail.
 *
 * 🔴 THE PREDICATE MOVED AT chart-UX-walls TASK 3, AND SAYING WHY MATTERS. It was
 * *"the legend row's only children with NO class and no nested `<strong>`"* —
 * true while a chip was an inert `<span style={{color}}>{text}</span>`. A chip is
 * a `chart/legend/IndicatorChip` now and carries a CSS-module class, so the
 * class-less predicate matched ZERO chips and 22 of this file's 31 cases went red
 * at once. The replacement is NOT looser: an indicator chip is identified by the
 * `data-instance-id` the component stamps — which is a sharper handle than
 * "class-less", since it names the instance the chip belongs to — and the
 * comparison chip is still identified the old way, because it is still a
 * hand-written class-less span and is still asserted to be LAST.
 */
const chipTexts = (view) => {
  expectFoldShape(view)
  return [...legendRowOf(view).children]
    .filter(el => el.tagName === 'SPAN' && (
      el.hasAttribute('data-instance-id') || (!el.className && !el.querySelector('strong'))))
    .map(el => el.textContent)
}

/** The chip ELEMENTS, same predicate — for the cases that assert on state
 *  (`data-hidden`, the fold class) rather than on text. */
const chipEls = (view) => {
  expectFoldShape(view)
  return chipElsRaw(view)
}

/** The chip elements with NO fold assertion — what `expectFoldShape` reads, and
 *  the only reader that may be used inside it. */
const chipElsRaw = (view) => [...legendRowOf(view).children]
  .filter(el => el.tagName === 'SPAN' && el.hasAttribute('data-instance-id'))

/** The `+N` control, or `null`. It is the legend row's only BUTTON. */
const moreButtonOf = (view) =>
  [...legendRowOf(view).children].find(el => el.tagName === 'BUTTON') || null

/**
 * ⭐ THE FOLD SHAPE, ASSERTED AT EVERY CHIP READ (chart-UX-walls Task 4).
 *
 * 🔴 THE WEAKENING THIS REPAIRS, NAMED. Task 3 chose to FOLD the tail past
 * `CHIP_COLLAPSE_AT` (`display: none` + a `+N`) rather than SLICE it, because the
 * spec's four is a PER-PANE budget and the shipped legend is one box for the whole
 * chart — a slice would have made ~25 assertions across four files simply FALSE,
 * including five engine-vs-legacy legend PARITY cases. Its report flagged the
 * price honestly: **a folded chip's TEXT IS STILL IN THE DOM**, so every case in
 * this file that reads chip text now passes whether or not the strip is correctly
 * folded. Presence stopped implying visibility, and 23 reads went quiet about it.
 *
 * ⭐ THIS IS THE STRENGTHENING, AND IT IS ONE PLACE RATHER THAN 23. Both readers
 * above go through it, so EVERY chip read in this file now also proves WHICH
 * chips the user can see: the first `threshold` are laid out, the rest are folded
 * behind a control that restores them.
 *
 * ⛔ THE THRESHOLD IS DERIVED FROM THE `+N` BUTTON'S OWN COUNT (`n - N`), NEVER
 * TYPED. `CHIP_COLLAPSE_AT` is a module-private const in `StockChart.jsx`; a
 * literal 4 here would be a second copy of it, and the day it moved this rail
 * would fail for a reason that has nothing to do with the fold. Deriving it also
 * makes the button and the fold agree BY CONSTRUCTION — a `+5` beside four folded
 * chips fails here.
 *
 * ⛔ FALSIFIABLE IN BOTH DIRECTIONS, WHICH A "nothing before index 4 is folded"
 * CHECK WOULD NOT BE. It is an EQUALITY against `i >= threshold`, so a chip
 * wrongly FOLDED (an index below the threshold) and a chip wrongly SHOWN (an
 * index at or above it) each break the same assertion. Both were driven with a
 * byte-level mutation of `StockChart.jsx`'s `foldedFrom` before this shipped.
 *
 * No button ⇒ nothing may be folded, which is the ≤4 case and the post-expansion
 * case, and is what stops this rail from being vacuous on a short strip.
 */
const expectFoldShape = (view) => {
  const els = chipElsRaw(view)
  const folded = els.map(el => el.className.includes('chipFolded'))
  const more = moreButtonOf(view)
  if (!more) {
    expect(folded.filter(Boolean).length,
      'a chip is FOLDED with no `+N` control to unfold it — those chips are unreachable, '
      + 'and every text assertion in this file still passes because the text is in the DOM')
      .toBe(0)
    return els
  }
  const n = Number(String(more.textContent || '').replace(/^\+/, ''))
  expect(Number.isInteger(n) && n > 0,
    `the +N control reads ${JSON.stringify(more.textContent)} — this rail derives the fold `
    + 'threshold from that number and cannot read it').toBe(true)
  const threshold = els.length - n
  expect(folded,
    'the strip is not folded where the `+N` button says it is. A folded chip is `display: '
    + 'none` and its TEXT IS STILL IN THE DOM, so the text assertions in this case pass '
    + 'either way — this is the only thing that sees it. Left = what is folded, right = '
    + `what must be (index >= ${threshold}, derived from "+${n}" over ${els.length} chips).`)
    .toEqual(els.map((_, i) => i >= threshold))
  return els
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
      expect(ENGINE_OWNED.has(id),
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
    // ⚠️ `legendChips`, not `engineChips` — chart-UX-walls Task 3 moved the call
    // site, and a control naming a function the file no longer calls is a control
    // that fails for the wrong reason.
    expect(src, 'the source probe read nothing').toContain('legendChips')
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
    // ⭐ AND `engineChips` IS ASSERTED EMPTY AT chart-UX-walls TASK 3. `StockChart`
    // calls `legendChips`, which reaches `engineChips` through the module-internal
    // binding this recorder cannot see — so a key here means the CALL SITE went
    // back to walking the bindings, which prints the same text on a chart with
    // nothing hidden and silently deletes every hidden instance's chip.
    expect([...H.engineChipKeys].sort(),
      'StockChart is calling engineChips directly again — a hidden instance loses its chip')
      .toEqual([])
    expect([...H.legendChipKeys].sort(),
      'a flipped definition produced no chip — the legend lost it silently')
      .toEqual(['atr::atr', 'ichimoku::kijun', 'ichimoku::tenkan', 'macd::macd',
        'macd::signal', 'rsi::rsi', 'sar::sar', 'stoch::d', 'stoch::k'])

    // …and the ONE lane covers the nine with no duplicates. A key twice is the
    // double-draw; a key missing is a chip nobody prints.
    const all = [...H.legendChipKeys, ...H.engineChipKeys, ...H.legacyChipKeys]
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

  it('⭐ a hidden instance DOES emit a chip now — you cannot un-hide from a chip that is gone', async () => {
    // 🔴 THIS CASE ASSERTED THE OPPOSITE UNTIL THE chart-UX-walls PHASE, and it
    // was named *"a hidden instance emits no chip, and re-showing brings the same
    // one back"*. `hidden` is remove-and-rebind (`hiddenIsRemovedNotParked.test.js`
    // — `planBindings` skips the instance so the binder can release the series and
    // give the pane back), which is right for the RENDERER and was wrong for the
    // READOUT: with no chip there was no surface carrying the eye toggle, so Hide
    // was a ONE-WAY DOOR reachable back only from the settings modal. Spec §6's
    // state 7 calls Hidden a CHIP STATE, and shipped code contradicted it.
    //
    // The chip is sourced from the INSTANCE LIST now (`readout.legendChips`), so a
    // hidden instance renders dimmed, VALUE-LESS and un-hideable-from. Three
    // things are asserted, not one: the chip is PRESENT, it carries NO value, and
    // it is MARKED hidden in the DOM.
    //
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
    // ⛔ THE SERIES REALLY IS GONE — otherwise this case would be asserting that a
    // chip survives something that never happened. `seriesByChip` throws by name
    // on "0 created series", so the absence is read directly off `addSeriesCalls`.
    const rsiColor = registry.getDefinition('rsi').inputs.find(i => i.key === 'color').default
    expect(H.addSeriesCalls.filter(c => c.options && c.options.color === rsiColor),
      'the hidden instance is still DRAWN — `hidden` stopped meaning remove-and-rebind')
      .toHaveLength(0)

    const rsiChip = chipTexts(v1).find(t => t.startsWith('RSI'))
    expect(rsiChip, 'a HIDDEN instance printed no chip — Hide is a one-way door again').toBeTruthy()
    // The LABEL ALONE: there is no line on the chart, so there is no number to
    // read off it, and printing the last one it had would be a lie.
    expect(rsiChip, 'a hidden chip printed a value for a line that is not drawn').toBe('RSI(14)')
    const el = chipEls(v1).find(e => e.textContent.startsWith('RSI'))
    expect(el.getAttribute('data-hidden'),
      'the chip does not carry its hidden STATE — Task 4 has nothing to render an eye toggle from')
      .toBe('true')
    // …and the other eight are untouched, so this is not "the legend broke".
    expect(chipTexts(v1)).toHaveLength(9)
    expect(chipEls(v1).filter(e => e.getAttribute('data-hidden') === 'true')).toHaveLength(1)

    // …and the control: the same blob with `hidden: false` prints the VALUE.
    v1.unmount(); cleanup(); H.reset()
    const shown = { ...hidden, indicatorInstances: hidden.indicatorInstances.map(
      i => (i.defId === 'rsi' ? { ...i, hidden: false } : i)) }
    const v2 = draw(shown)
    await settledLegend(v2, crosshairWith({ 'rsi::rsi': 54.321 }))
    expect(chipTexts(v2), 're-showing did not bring the value back').toContain('RSI(14) 54.3')
    expect(chipEls(v2).every(e => e.getAttribute('data-hidden') === 'false'),
      'a chip is marked hidden on a blob that hides nothing — the marker is stuck on').toBe(true)
  })

  it('⭐ the OFF-CURSOR legend prints the chips too — `alwaysShowLegend`, no hover', async () => {
    // 🔴 THE FIELD THIS CASE EXISTS FOR SHIPPED AS `chips: EMPTY_CHIPS`, with a
    // comment saying *"the always-on legend has never printed an indicator
    // value"*. That was true and it was Wall 1's display half in one line:
    // `alwaysShowLegend` ships on 12 ChartPane mount modules and on `/r/chart`,
    // the OHLCV half of the SAME box already prints the last bar off-cursor, and
    // the indicator row directly below it stayed blank until the user hovered.
    //
    // ⛔ NO CROSSHAIR IS DELIVERED HERE, ON PURPOSE. `settledLegend` would defeat
    // the case by driving the hovering path; this waits for the always-on
    // refresher effect and reads what it left. The values come from
    // `binding.lastValue` — the binder's own record of the final point it set.
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={ALL_NINE_ON()} alwaysShowLegend />)
    let texts = []
    for (let i = 0; i < 40; i++) {
      await act(async () => { await new Promise(r => setTimeout(r, 20)) })
      const o = [...view.container.querySelectorAll('span')].find(s => /^O\s/.test(s.textContent || ''))
      if (o) { texts = chipTexts(view); if (texts.length) break }
    }
    expect(texts.length,
      'the off-cursor legend printed NO indicator chip — a trader who has not moved the '
      + 'mouse still cannot tell what the coloured line is').toBe(9)
    // Every one of them carries a NUMBER: `lastValue` is a number on every
    // binding, so an off-cursor chip that printed the label alone would mean the
    // fallback never fired.
    for (const t of texts) {
      expect(t, `the off-cursor chip ${JSON.stringify(t)} printed no value`).toMatch(/ -?\d/)
      expect(t, 'an off-cursor chip printed NaN').not.toMatch(/NaN/)
    }
    // …and it is the same nine labels the hovering legend prints — one strip,
    // two entry points, not two different readouts.
    expect(texts.map(t => t.split(' ')[0]).sort())
      .toEqual(CHIPS.map(([k]) => SHIPPED[k].label).sort())
    view.unmount()
  })

  it('⛔ …and the control: WITHOUT `alwaysShowLegend` an un-hovered chart prints nothing', async () => {
    // Without this, the case above would pass on a legend that renders chips
    // unconditionally, and the `alwaysShowLegend` contract it is named for would
    // be untested.
    const view = draw(ALL_NINE_ON())
    await act(async () => { await new Promise(r => setTimeout(r, 120)) })
    expect([...view.container.querySelectorAll('span')].find(s => /^O\s/.test(s.textContent || '')),
      'the legend rendered with no cursor and no alwaysShowLegend').toBeFalsy()
    view.unmount()
  })

  it('⛔ every chip is a DESCENDANT of the element the EXPORT ROUTE hides', async () => {
    // ⛔ THE INVARIANT THAT KEEPS THE STRIP OUT OF EVERY BRANDED SCREENSHOT.
    // `ChartRender.jsx` — the ONLY route `tools/chart_parity.py` photographs —
    // injects `#chart-export [class*="legend" i]{display:none !important}`. A
    // chip rendered as a SIBLING of the legend box would survive that hide,
    // appear in every newsletter export the hand-made charts never carried, and
    // move all 46 pixel baselines at once.
    //
    // ⚠️ THE SELECTOR IS PARSED OUT OF `ChartRender.jsx`, NEVER TYPED. If the
    // export rule moves, this fails on the parse — which is the correct outcome:
    // the premise has changed and the claim has to be re-derived.
    const CR = readFileSync(path.resolve(
      path.dirname(fileURLToPath(import.meta.url)), '../../../../pages/ChartRender.jsx'), 'utf-8')
    const m = CR.match(/#chart-export (\[class\*="legend" i\])\{display:none !important\}/)
    expect(m, 'the export route no longer hides the legend — this invariant\'s premise is gone')
      .toBeTruthy()
    const HIDDEN_BY_EXPORT = m[1]
    const reshow = CR.match(/#chart-export (\[class\*="volLegend" i\])\{display:flex !important\}/)
    expect(reshow, 'the export route no longer re-shows the volume legend').toBeTruthy()

    const view = draw(ALL_NINE_ON())
    await settledLegend(view, crosshairWith({ 'rsi::rsi': 54.321 }))
    const els = chipEls(view)
    expect(els.length, 'no chips rendered — this case would pass by finding nothing').toBe(9)
    const box = legendRowOf(view)
    for (const el of els) {
      expect(el.closest(HIDDEN_BY_EXPORT),
        'a chip is NOT inside the element the export hides — it will print in every '
        + 'branded newsletter screenshot and move all 46 parity baselines').toBe(box)
      expect(el.closest(reshow[1]),
        'a chip sits under the ONE thing the export puts back — it would be visible again')
        .toBe(null)
    }
    // ⛔ THE CONTROL: the selector does not match everything. If it did, every
    // assertion above would hold for a chip rendered anywhere at all.
    expect(view.container.closest(HIDDEN_BY_EXPORT),
      'the export selector matches the test container too — it cannot discriminate').toBe(null)
    view.unmount()
  })

  it('⭐ past FOUR chips the tail FOLDS behind a `+N` that expands in place', async () => {
    // Spec §7. The spec's four is a PER-PANE budget and the shipped legend is ONE
    // box for the whole chart (controller ruling: per-pane placement is out of
    // scope), so the threshold is over the strip and the tail is FOLDED rather
    // than dropped — see `CHIP_COLLAPSE_AT` in StockChart.jsx.
    const view = draw(ALL_NINE_ON())
    await settledLegend(view, crosshairWith({ 'rsi::rsi': 54.321 }))
    const els = chipEls(view)
    expect(els).toHaveLength(9)

    const folded = els.filter(e => e.className.includes('chipFolded'))
    expect(folded.length, 'the fold threshold moved — nine chips must leave five folded').toBe(5)
    expect(els.slice(0, 4).some(e => e.className.includes('chipFolded')),
      'a chip inside the first four is folded').toBe(false)

    // ⛔ AND THE CLASS REALLY HIDES — asserted on the ARTIFACT, not on the name.
    // A `chipFolded` that declared nothing would leave nine chips on the strip
    // and this case would still be green.
    const css = readFileSync(path.resolve(
      path.dirname(fileURLToPath(import.meta.url)), '../../legend/IndicatorChip.module.css'), 'utf-8')
    expect(css.replace(/\s+/g, ''),
      '.chipFolded no longer takes the chip out of the layout — the fold is cosmetic')
      .toContain('.chipFolded{display:none;}')

    const more = [...legendRowOf(view).children].find(el => el.tagName === 'BUTTON')
    expect(more, 'the +N control is missing — five chips are folded with no way back').toBeTruthy()
    expect(more.textContent).toBe('+5')
    expect(more.getAttribute('aria-label')).toBe('Show 5 more indicators')

    // 🔴 AND THE BUTTON HAS TO BE REACHABLE, WHICH `.click()` BELOW CANNOT PROVE.
    // `StockChart.module.css` `.legend` is `pointer-events: none` and that
    // INHERITS, so the button shipped un-clickable in a browser while this case
    // was green — jsdom does not implement pointer-events hit-testing and fires
    // `click()` regardless. The only honest gate is the ARTIFACT: the button
    // re-enables pointer events, and its parent really is the thing that turned
    // them off. Both halves, or the assertion stops meaning anything the day the
    // parent changes.
    expect(css.replace(/\s+/g, ''),
      'the +N button does not re-enable pointer events — it cannot be clicked in a browser, '
      + 'and the fold is a trap')
      .toMatch(/\.chipMore\{pointer-events:auto;/)
    const chartCss = readFileSync(path.resolve(
      path.dirname(fileURLToPath(import.meta.url)), '../../../StockChart.module.css'), 'utf-8')
    expect(chartCss.slice(chartCss.indexOf('\n.legend {')).slice(0, 400),
      'the legend box no longer disables pointer events — re-derive why .chipMore re-enables them')
      .toContain('pointer-events: none')

    // …and it EXPANDS IN PLACE: click, and nothing is folded and the button goes.
    await act(async () => { more.click() })
    expect(chipEls(view).filter(e => e.className.includes('chipFolded')),
      'the +N button did not unfold the tail').toHaveLength(0)
    expect([...legendRowOf(view).children].find(el => el.tagName === 'BUTTON'),
      'the +N button survived its own expansion').toBeFalsy()
    expect(chipTexts(view), 'expanding changed what the chips say').toHaveLength(9)
    view.unmount()
  })

  it('⛔ …and the control: at or below FOUR chips nothing folds and there is no button', async () => {
    // Without this the case above would pass on a legend that folds everything,
    // or on one that always shows a `+N`. Four is the boundary, so this is the
    // ON side of it.
    const four = mergeChartSettings({
      indicators: Object.fromEntries(['rsi', 'stoch', 'atr'].map(id => [id, { enabled: true }])),
    })
    const view = draw(four)
    await settledLegend(view, crosshairWith({ 'rsi::rsi': 54.321 }))
    // rsi(1) + stoch(%K,%D) + atr(1) = 4 — the threshold exactly.
    expect(chipEls(view), 'the fixture no longer draws exactly four chips').toHaveLength(4)
    expect(chipEls(view).filter(e => e.className.includes('chipFolded')),
      'a chip is folded at the threshold — the comparison is off by one').toHaveLength(0)
    expect([...legendRowOf(view).children].find(el => el.tagName === 'BUTTON'),
      'a +N button rendered with nothing to unfold').toBeFalsy()
    view.unmount()
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


// ─── TASK 2 — EVERY DEFINITION THAT DRAWS A LINE CAN NAME ITSELF ────────────
//
// 🔴 MEASURED 2026-08-06: NINE of the seventeen definitions declared NO `legend`
// block at all — a user who added MFI, CCI, Williams %R, ADX, OBV, Donchian, BB,
// VWAP or AVWAP got a line on the chart with no label AT ANY TIME, hovering or
// not, because `readout.chipsFrom:167` emits nothing for a plot with no `legend`.
// That is strictly worse than "the legend is hover-gated": for those nine there
// was nothing to gate.
//
// ⛔ AND NO TEST IN THE REPO COULD SEE IT. This file's fixture (`ALL_NINE_ON`)
// enables only the SIX definitions that already had chips, so the nine silent
// ones were never drawn in a case that reads the legend; the pixel gate is blind
// twice over (a headless capture has no cursor AND `ChartRender.jsx:527` injects
// `#chart-export [class*="legend" i]{display:none !important}` into the only
// route `tools/chart_parity.py` photographs, so a TOTAL regression of this task
// reports 0 changed pixels on all 46 live cases). The rail below is the gate.
//
// ⭐ IT IS DERIVED FROM THE REGISTRY, NOT HAND-LISTED, and that is the whole
// difference between this rail and a fixture. A set written down by hand cannot
// fail for a definition it has never heard of, so the FIRST thing the next author
// does — add a sixteenth indicator — is the thing it would not catch. The rule is
// extracted as `silentDefinitions(defs)` and applied to TWO lists: the real
// registry, and a synthetic list carrying a PLANTED chip-less definition that
// `registerDefinitions` accepts without complaint. The planted case is what
// proves the rail discriminates rather than merely agreeing with today's tree.

/**
 * `pool.js:608-610`'s predicate, INLINED VERBATIM — never re-derived.
 *
 * ⛔ A HELPER THAT REIMPLEMENTS THE LOGIC INSTEAD OF CALLING IT is the
 * mutation-harness failure this repo has already recorded, so the inline is
 * pinned to the shipped source by the case below rather than trusted: `pool.js`
 * does not export this function, and copying a predicate without a rail on the
 * copy is how the two quietly stop meaning the same thing.
 */
const dataPlotsOf = (def) => (def.plots || []).filter(
  p => p && p.style !== 'hlines' && typeof p.key === 'string')

/** The predicate as it must still read INSIDE `pool.js`. */
const DATA_PLOTS_PREDICATE_SRC =
  "(def.plots || []).filter(p => p && p.style !== 'hlines' && typeof p.key === 'string')"

const POOL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../pool.js')

/** The plots that put a VISIBLE chip in the readout — `readout.chipsFrom:167`'s
 *  own test (`!plot.legend || plot.legend.hide === true` ⇒ no chip), expressed
 *  over plot OBJECTS and restricted to the data-bearing ones, because a `legend`
 *  on an `hlines` guide names no series and can never reach the readout. */
const chipPlotsOf = (def) => dataPlotsOf(def).filter(
  p => p.legend && p.legend.hide !== true)

/**
 * THE RULE, AS A FUNCTION OF A DEFINITION LIST.
 *
 * ⭐ THIS IS WHAT MAKES THE RAIL DERIVED. It takes the list rather than reading
 * the registry itself, so the identical rule can be pointed at a synthetic list
 * — see the planted-definition case — and a future definition that lands without
 * a chip fails BY CONSTRUCTION rather than by somebody remembering to add a row.
 *
 * @returns {string[]} the ids that bind a data plot and declare no visible chip.
 */
const silentDefinitions = (defs) => defs
  .filter(d => dataPlotsOf(d).length > 0 && chipPlotsOf(d).length === 0)
  .map(d => d.id)

/**
 * A definition that would REGISTER CLEANLY TODAY and draw a line nobody can name.
 *
 * ⚠️ It is deliberately built the way `nativeRegistry`'s own definitions are —
 * through `registerDefinitions`, so the case can assert that the SCHEMA raises
 * nothing. "The schema does not catch it" is half the reason this rail exists.
 */
const plantSilentDefinition = (id = 'plantedSilentDef') => ({
  schemaVersion: registry.NATIVE_DEFS[0].schemaVersion,
  id,
  version: 1,
  compute: { kind: 'native', fn: 'rsi', rev: 1 },
  meta: {
    name: 'A Planted Silent Indicator', shortName: 'PLANT', category: 'Momentum',
    description: 'A definition that binds a data plot and declares no chip.',
    tags: ['oscillator'], tier: 'free', repaint: 'non-repainting',
  },
  placement: { target: 'pane', pane: { height: 0.15 } },
  inputs: [{ key: 'period', type: 'int', label: 'Period', default: 14, min: 2, max: 100, step: 1 }],
  plots: [{ key: 'rsi', label: 'Planted', style: 'line', color: '#ffffff', width: 1, role: 'primary' }],
})

describe('⭐ TASK 2 — every definition that draws a line can name itself', () => {
  it('the subject is not empty, and the rule reads the SHIPPED predicate — the controls', () => {
    // ⛔ EVERY ZERO NEEDS A POSITIVE CONTROL. `toEqual([])` below is vacuously
    // true over an empty registry, and `dataPlotsOf` returning nothing for
    // everything would make it vacuously true over a full one.
    const defs = registry.listDefinitions()
    expect(defs.length, 'no definitions — this case proves nothing').toBeGreaterThan(10)
    expect(defs.filter(d => dataPlotsOf(d).length > 0).length,
      'no definition binds a data plot — the predicate is reading nothing')
      .toBeGreaterThan(10)

    // …and the inlined predicate is still the one `pool.js` uses. A copy with no
    // rail on the copy is how two spellings of one rule diverge.
    const poolSrc = readFileSync(POOL_PATH, 'utf-8')
    expect(poolSrc.length, 'the pool.js probe read nothing').toBeGreaterThan(10_000)
    expect(poolSrc, 'pool.js no longer contains dataPlots — the inline above is orphaned')
      .toContain('function dataPlots(def)')
    expect(poolSrc,
      'pool.js::dataPlots and the predicate inlined in this file have diverged — one of '
      + 'them is now a SECOND implementation of "which plots bear data"')
      .toContain(DATA_PLOTS_PREDICATE_SRC)
  })

  it('a definition that binds a data plot declares at least ONE chip', () => {
    const silent = silentDefinitions(registry.listDefinitions())
    expect(silent,
      'these definitions draw a line the user can never put a name to — on any surface, '
      + 'hovering or not, because readout.chipsFrom emits nothing for a plot with no '
      + '`legend` block. Declare `plots[].legend` on the primary plot.')
      .toEqual([])
  })

  it('⛔ …and the rail is DERIVED: a PLANTED chip-less definition fails it by construction', () => {
    // ⭐ THE PROOF THAT THIS IS NOT A FIXTURE. A hand-listed set of "the nine"
    // could not possibly flag an id it has never heard of, so the rule is pointed
    // at a list the registry does not contain and must still name it.
    const raw = plantSilentDefinition()
    const { defs: planted, errors } = registry.registerDefinitions([raw])
    // …and the SCHEMA is blind to it, which is why the rail has to exist at all.
    expect(errors, 'the schema rejected the plant — then this case is measuring the schema, '
      + 'not the rail').toEqual([])
    expect(planted, 'the plant did not register').toHaveLength(1)

    expect(silentDefinitions([...registry.listDefinitions(), ...planted]),
      'a definition that binds a data plot and declares no chip did NOT fail the rail — '
      + 'the rail is agreeing with today\'s registry rather than checking it')
      .toEqual(['plantedSilentDef'])

    // …and the control: the same definition WITH a chip passes. Without this the
    // case above would also pass for a rail that flags everything.
    const named = registry.registerDefinitions([{
      ...raw,
      id: 'plantedNamedDef',
      plots: [{ ...raw.plots[0], legend: { decimals: 1 } }],
    }])
    expect(named.errors).toEqual([])
    expect(silentDefinitions([...registry.listDefinitions(), ...named.defs]),
      'a definition that DOES declare a chip was flagged — the rail flags everything')
      .toEqual([])
  })

  it('every declared chip has a PRIMARY plot behind it, so the chip names the main series', () => {
    let checked = 0
    for (const def of registry.listDefinitions()) {
      const chips = chipPlotsOf(def)
      if (!chips.length) continue
      checked++
      expect(chips.some(p => p.role === 'primary'), `${def.id}: every chip is on a secondary plot`)
        .toBe(true)
    }
    expect(checked, 'no definition declares a chip — the loop above asserted nothing')
      .toBeGreaterThan(5)
  })

  /**
   * WHAT EACH NEWLY-NAMED DEFINITION WAS DECIDED TO PRINT.
   *
   * ⚠️ A TABLE, NOT A COUNT. A count rots green the moment the registry grows,
   * and `expected 17, got 18` tells the next reader nothing. Every row is a
   * DECISION — the stem, the precision, and whether the chip carries parameters —
   * and each is the thing a reader would otherwise have to re-derive.
   *
   * ⛔ AND IT IS AN EQUALITY OVER THE WHOLE CHIP SET, not a per-row lookup. A loop
   * over the rows catches a chip that DISAPPEARS and is blind to one that APPEARS:
   * `adx::plusDI` gaining a `legend` in passing would put a third number in ADX's
   * readout and no row-wise check could see it. `chipPlotsOf` returns every
   * visible chip a definition declares, so the arrays below are length-1 by
   * assertion rather than by convention.
   *
   * ⚠️ `params` IS `meta.legendParams`, AND ITS `undefined`s ARE LOAD-BEARING.
   * `readout.chipLabel:107` returns `legend.label` BEFORE it ever looks at
   * `legendParams`, so a row carrying both would be declaring a control that does
   * nothing — the `stoch` trap. `donchian` is the only row with a label, and it is
   * the only row that must have no params.
   */
  const DECIDED = {
    // id            plotKey      stem          decimals  meta.legendParams
    bb:        [['middle',     'BB',          2, ['period', 'stdDev']]],
    vwap:      [['vwap',       'VWAP',        2, undefined]],
    mfi:       [['mfi',        'MFI',         1, ['period']]],
    cci:       [['cci',        'CCI',         1, ['period']]],
    williamsR: [['williams_r', '%R',          1, ['period']]],
    adx:       [['adx',        'ADX',         1, ['period']]],
    obv:       [['obv',        'OBV',         0, undefined]],
    donchian:  [['middle',     'DC',          2, undefined]],
    avwap:     [['avwap',      'AVWAP',       2, ['anchor']]],
    atrBands:  [['middle',     'ATR Bands',   2, ['period', 'multiplier']]],
  }

  it('⭐ the TEN newly-named definitions declare what was DECIDED, not a default', () => {
    const shape = (defId) => {
      const def = registry.getDefinition(defId)
      expect(def, `${defId} is no longer in the registry`).toBeTruthy()
      return chipPlotsOf(def).map(p => [
        p.key,
        // `chipLabel`'s own resolution: an explicit label, else the shortName.
        p.legend.label ?? (def.meta.shortName || def.id),
        p.legend.decimals,
        def.meta.legendParams,
      ])
    }
    const actual = Object.fromEntries(Object.keys(DECIDED).map(id => [id, shape(id)]))
    expect(actual,
      'a newly-named definition prints something other than what was decided — a missing '
      + 'chip, a spurious second one, a precision that drifted, or a `legend.label` and '
      + '`meta.legendParams` declared together (the label wins and the params are inert)')
      .toEqual(DECIDED)
    // …and every precision really is DECLARED, never `readout.DEFAULT_DECIMALS`
    // arriving at the same number by accident.
    for (const [id, rows] of Object.entries(actual)) {
      for (const [plotKey, , decimals] of rows) {
        expect(Number.isInteger(decimals), `${id}::${plotKey}: decimals not declared`).toBe(true)
      }
    }
  })

  it('⭐ …and each one PRINTS it, through the one formatting pipeline', async () => {
    // ⛔ THE DECLARATION IS NOT THE CHIP. `readout.chipsFrom` is the single
    // pipeline spec §6 names — it drives the Style-tab precision, the chip value
    // and the crosshair readout alike — so the decided text is asserted through
    // IT rather than re-assembled here from the same fields the case above reads.
    // A second rounding path invented in this file would agree with itself.
    const { chipsFrom } = await import('../readout')
    const V = 12.3456789
    const WANT = {
      bb: 'BB(20, 2) 12.35',
      vwap: 'VWAP 12.35',
      mfi: 'MFI(14) 12.3',
      cci: 'CCI(20) 12.3',
      williamsR: '%R(14) 12.3',
      adx: 'ADX(14) 12.3',
      obv: 'OBV 12',
      donchian: 'DC 12.35',
      avwap: 'AVWAP(session) 12.35',
      atrBands: 'ATR Bands(14, 2) 12.35',
    }
    const got = {}
    for (const [defId, [[plotKey]]] of Object.entries(DECIDED)) {
      const series = { __id: `${defId}::${plotKey}` }
      const chips = chipsFrom(
        [{ defId, plotKey, series }], new Map([[series, { value: V }]]), registry, () => ({}))
      got[defId] = chips.length === 1 ? chips[0].text : `<${chips.length} chips>`
    }
    expect(got, 'a newly-named definition does not print what was decided')
      .toEqual(WANT)
    H.reset()
  })

  it('⛔ the COMPLETE chip set is an equality — a chip cannot appear or vanish unseen', () => {
    // ⭐ THE RAIL THE NINE-CHIP RECORDS USED TO BE, WIDENED RATHER THAN LOOSENED.
    // `readout.test.js` and `enumerationSites.test.js` froze the chip set at *the
    // nine the 2026 legend rendered* (ten with `rsLine`), which is what kept these
    // ten definitions silent. The protection those records gave — a user's chip
    // cannot disappear — is kept HERE as a full equality over both lanes; what is
    // given up is only the claim that no chip may ever be ADDED, which was never
    // the thing being protected and was costing ten indicators their names.
    const declared = registry.listDefinitions()
      .flatMap(d => chipPlotsOf(d).map(p => `${d.id}::${p.key}`)).sort()
    expect(declared,
      'the chip set moved. A DROP is a user\'s chip disappearing silently (no pixel gate '
      + 'can see it — a headless capture has no cursor, and ChartRender hides the legend '
      + 'outright); an ADDITION is a number in the readout nobody decided on.')
      .toEqual([
        // the ten Task 2 declared…
        'adx::adx', 'atrBands::middle', 'avwap::avwap', 'bb::middle', 'cci::cci',
        'donchian::middle', 'mfi::mfi', 'obv::obv', 'vwap::vwap', 'williamsR::williams_r',
        // …and the ten that already shipped, untouched by it.
        'atr::atr', 'ichimoku::kijun', 'ichimoku::tenkan', 'macd::macd', 'macd::signal',
        'rsLine::rsLine', 'rsi::rsi', 'sar::sar', 'stoch::d', 'stoch::k',
      ].sort())
    // …and the control: the shipped nine are still in it, character for character,
    // read off the SHIPPED ARTIFACT rather than re-typed above.
    for (const key of Object.keys(SHIPPED)) {
      expect(declared, `${key} lost its chip — that is a REGRESSION, not a widening`)
        .toContain(key)
    }
    expect(Object.keys(SHIPPED).length, 'the shipped-legend probe parsed nothing').toBe(9)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ chart-UX-walls TASK 4 — THE CHIP CONTROLS, DRIVEN ON A REAL CHART
//
// The unit gates live beside the component (`legend/IndicatorChip.test.jsx`,
// `legend/chipMenu.test.js`). These are the WIRING: that the eye/gear/× a user
// actually sees on a mounted StockChart reach `instanceControls`' per-INSTANCE
// door and persist the right blob, and that a refused row is refused IN THE DOM
// rather than only in the pure function that decided it.
//
// ⛔ A GREEN CLICK IN JSDOM IS NOT REACHABILITY. jsdom implements no
// pointer-events hit-testing and `.legend` is `pointer-events: none`, which
// INHERITS — so every click below would fire on a control no human could reach.
// The gate for THAT is the CSS-artifact assertion in
// `legend/IndicatorChip.test.jsx`, in both directions. These cases are about
// which handler ran and what it wrote.
// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ chart-UX-walls TASK 4 — the chip controls, on a real chart', () => {
  /** rsi(1) + stoch(%K,%D) + atr(1) = FOUR chips — at the fold threshold, so
   *  every chip is laid out and reachable without expanding anything. */
  const FOUR = () => mergeChartSettings({
    indicators: Object.fromEntries(['rsi', 'stoch', 'atr'].map(id => [id, { enabled: true }])),
  })

  /** A chart whose writes are observable. `onSettingsPersist` is StockChart's
   *  FIRST branch in `handleUpdateChartSettings`, so it intercepts the whole
   *  merged blob before the preference write — which is exactly what a grid cell
   *  does in production, not a test-only seam. */
  const drawObserved = (settings, onPersist, extra) => render(
    <StockChart sym="AAPL" tf="D" barsOverride={BARS}
      settingsOverride={settings} onSettingsPersist={onPersist} {...extra} />)

  const chipFor = (view, label) => {
    const el = chipEls(view).find(e => (e.textContent || '').startsWith(label))
    expect(el, `no ${label} chip on the strip — this case is asserting on nothing`).toBeTruthy()
    return el
  }
  const liveInstance = (blob, id) =>
    (blob.indicatorInstances || []).find(i => i && i.instanceId === id) || null
  const menuRows = () => [...document.body.querySelectorAll('[role="menu"] button')]

  it('the EYE hides THAT instance, through the per-INSTANCE door, and nothing else moves', async () => {
    const persist = vi.fn()
    const view = drawObserved(FOUR(), persist)
    await settledLegend(view, crosshairWith({ 'rsi::rsi': 54.321 }))
    const chip = chipFor(view, 'RSI')
    const id = chip.getAttribute('data-instance-id')
    expect(chip.getAttribute('data-hidden')).toBe('false')

    await act(async () => { chip.querySelector('[aria-label^="Hide "]').click() })
    expect(persist, 'the eye wrote nothing — the chip control is decorative').toHaveBeenCalledTimes(1)
    const next = persist.mock.calls[0][0]
    expect(liveInstance(next, id).hidden,
      'the eye did not hide the instance it names').toBe(true)
    // …and it moved ONE instance. A door addressing the DEFINITION would take
    // every copy with it, which is exactly what makes this door door EIGHT.
    const others = (next.indicatorInstances || []).filter(i => i && i.instanceId !== id)
    expect(others.length, 'the fixture drew only one instance — "nothing else moved" is vacuous')
      .toBeGreaterThan(1)
    expect(others.some(i => i.hidden === true || i.deleted === true),
      'hiding one chip disturbed a sibling instance').toBe(false)
    view.unmount()
  })

  it('…and it goes BOTH WAYS: the eye on a HIDDEN chip shows it again', async () => {
    // The un-hide door Task 3 built the hidden chip FOR. Without this half, a
    // handler that wrote the CURRENT value back (rather than its negation) would
    // pass the case above and leave Hide a one-way door with a live-looking
    // control on it.
    const base = FOUR()
    const rsiId = base.indicatorInstances.find(i => i.defId === 'rsi').instanceId
    const hidden = {
      ...base,
      indicatorInstances: base.indicatorInstances.map(i =>
        (i.instanceId === rsiId ? { ...i, hidden: true } : i)),
    }
    const persist = vi.fn()
    const view = drawObserved(hidden, persist)
    await settledLegend(view, crosshairWith({}))
    const chip = chipFor(view, 'RSI')
    expect(chip.getAttribute('data-hidden'), 'the fixture did not start hidden').toBe('true')
    const btn = chip.querySelector('[aria-label^="Show "]')
    expect(btn, 'a hidden chip still offers "Hide" — the control lies about its direction').toBeTruthy()

    await act(async () => { btn.click() })
    expect(persist).toHaveBeenCalledTimes(1)
    expect(liveInstance(persist.mock.calls[0][0], rsiId).hidden,
      'the eye on a hidden chip did not un-hide it — Hide is a one-way door again')
      .toBe(false)
    view.unmount()
  })

  it('the GEAR opens the settings dialog on THAT instance', async () => {
    const view = drawObserved(FOUR(), vi.fn())
    await settledLegend(view, crosshairWith({}))
    const chip = chipFor(view, 'ATR')
    const id = chip.getAttribute('data-instance-id')
    expect(id, 'the ATR chip does not name an atr instance').toContain('atr')
    await act(async () => { chip.querySelector('[aria-label$="settings"]').click() })
    // Task 5's dialog, mounted on `settingsInstanceId`. It names the instance it
    // opened on, which is how "RSI(7) settings" differs from "RSI(14) settings".
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog, 'the gear opened no settings dialog').toBeTruthy()
    expect(dialog.textContent, 'the dialog opened on some other indicator').toMatch(/ATR/i)
    view.unmount()
  })

  it('the × removes THAT instance and leaves its siblings drawing', async () => {
    const persist = vi.fn()
    const view = drawObserved(FOUR(), persist)
    await settledLegend(view, crosshairWith({}))
    const chip = chipFor(view, 'ATR')
    const id = chip.getAttribute('data-instance-id')
    await act(async () => { chip.querySelector('[aria-label^="Remove "]').click() })
    expect(persist).toHaveBeenCalledTimes(1)
    const next = persist.mock.calls[0][0]
    expect(liveInstance(next, id).deleted, '× did not tombstone the instance').toBe(true)
    for (const other of ['rsi', 'stoch']) {
      expect((next.indicatorInstances || []).some(i => i && i.defId === other && !i.deleted),
        `removing ATR took ${other} with it`).toBe(true)
    }
    view.unmount()
  })

  it('a RIGHT-CLICK opens spec §6’s six rows, on the shipped ContextPopover', async () => {
    const view = drawObserved(FOUR(), vi.fn())
    await settledLegend(view, crosshairWith({}))
    fireEvent.contextMenu(chipFor(view, 'RSI'), { clientX: 120, clientY: 60 })
    const menu = document.body.querySelector('[role="menu"]')
    expect(menu, 'the right-click opened no menu').toBeTruthy()
    const text = menu.textContent
    for (const row of ['Settings', 'Hide RSI', 'Move to', 'Add alert on RSI', 'About', 'Remove']) {
      expect(text, `${row} is missing from the chip menu`).toContain(row)
    }
    // …and it is the shipped primitive, PORTALLED: not inside the legend, which
    // the export route hides, and not a second menu implementation.
    expect(view.container.querySelector('[role="menu"]'),
      'the menu rendered inside the chart — it would be hidden in every export')
      .toBeNull()
    view.unmount()
  })

  it('⛔ a REFUSED move target is disabled IN THE DOM, with the reason on screen', async () => {
    // The whole point of a disabled REASON. `chipMenu.test.js` proves the verdict
    // against the real `resolvePlacement`; this proves the verdict REACHES the
    // button — a row that renders live and writes an unresolvable placement takes
    // the indicator off the chart with its box still ticked.
    const view = drawObserved(FOUR(), vi.fn())
    await settledLegend(view, crosshairWith({}))
    fireEvent.contextMenu(chipFor(view, 'RSI'), { clientX: 120, clientY: 60 })
    const move = menuRows().find(b => (b.textContent || '').startsWith('Move to'))
    expect(move, 'no Move row').toBeTruthy()
    expect(move.disabled, 'a pane oscillator has nowhere to move — re-derive the refusals').toBe(false)
    await act(async () => { move.click() })

    const rows = menuRows()
    const byLabel = (t) => rows.find(b => (b.textContent || '').startsWith(t))
    const volume = byLabel('Volume pane')
    expect(volume, 'the Move page does not offer the volume target at all').toBeTruthy()
    expect(volume.disabled,
      'the volume target is live. `resolvePlacement` reads the overlay decision from '
      + '`cs.volumeOverlayIndicators` and NEVER from the instance target, so this row would '
      + 'persist a placement that changes nothing — with a tick beside it')
      .toBe(true)
    expect(volume.textContent,
      'the refusal reason is not on screen — the user is left clicking a grey line')
      .toMatch(/chart-wide toggle/)
    // The CURRENT placement is refused too, and for a different reason.
    expect(byLabel('Its own pane').disabled, 'the CURRENT target is offered as a destination')
      .toBe(true)
    // ⛔ …and the control: one row on this page IS live, so "disabled" is a
    // property of these two and not of the page.
    expect(rows.filter(b => !b.disabled).map(b => (b.textContent || '').slice(0, 11)),
      'every row on the Move page is dead, or none is — the verdict is not discriminating')
      .toContain('Price pane')
    view.unmount()
  })

  it('⛔ …and a PRICE overlay cannot be moved at all — the ROW itself is dead', async () => {
    const view = drawObserved(mergeChartSettings({
      indicators: { rsi: { enabled: true }, bb: { enabled: true } },
    }), vi.fn())
    await settledLegend(view, crosshairWith({}))
    fireEvent.contextMenu(chipFor(view, 'BB'), { clientX: 120, clientY: 60 })
    const move = menuRows().find(b => (b.textContent || '').startsWith('Move to'))
    expect(move, 'no Move row on the BB chip').toBeTruthy()
    expect(move.disabled,
      'BB can be moved. `computePaneLayout` gives a PRICE-declared definition no pane, so '
      + '`resolvePlacement` returns null and the binder binds nothing — the indicator would '
      + 'silently vanish').toBe(true)
    view.unmount()
  })

  it('⛔ a READ-ONLY mount gets chips with NO controls at all', async () => {
    // Model Book, a grid cell and the `/r/chart` export route all pass
    // `showDrawingTools={false}`: no toolbar, no settings panel, and now no chip
    // controls — the same gate the region menu's `<label> settings…` row uses.
    const view = drawObserved(FOUR(), vi.fn(), { showDrawingTools: false })
    await settledLegend(view, crosshairWith({}))
    const chips = chipEls(view)
    expect(chips.length, 'no chips at all — the absence below is vacuous').toBe(4)
    for (const chip of chips) {
      expect(chip.querySelectorAll('button').length,
        'a read-only chart sprouted a chip control that writes to the global preference')
        .toBe(0)
    }
    fireEvent.contextMenu(chips[0], { clientX: 10, clientY: 10 })
    expect(document.body.querySelector('[role="menu"]'),
      'a read-only chart opened a chip menu').toBeNull()
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
