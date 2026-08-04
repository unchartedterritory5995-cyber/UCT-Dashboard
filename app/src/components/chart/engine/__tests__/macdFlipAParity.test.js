import { describe, it, expect } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import { AUTOSCALE_DEFAULT } from '../pool'
import * as engineRegistry from '../nativeRegistry'
import { computeMACD } from '../../indicators'
import { computePaneMargins } from '../../paneMargins'
import { createFakeChart, makeBars } from './fakeChart'

// ─── THE FLIP-A CONTRACT FOR MACD ───────────────────────────────────────────
//
// The multi-plot stress test: two lines AND a sign-coloured histogram in one
// autoscaled band, two pool keys bound from a single instance, and a
// `largeDashed` zero guide. `tools/chart_parity.py --cases engine_macd_vs_legacy`
// is the real proof; this is what protects it between parity runs — the CALLS,
// asserted against a literal transcription of `StockChart.jsx:6094-6131`.
//
// WHAT THIS HOLDS THAT THE PIXEL GATE CANNOT: that the histogram's per-bar
// colours come from the SIGN of the value and not from a series colour. B2's
// review Critical #3 was exactly this — `toPoints` emitted `{time,value}` only
// and `seriesOptionsForPlot` ignored `colorMode: 'sign'`, so the whole pane drew
// in ONE flat LWC default where legacy is green above zero and red below. Over a
// fixture that is 115 bars up and 112 bars down that is a *large* diff, but an
// unattributable one; here it is a per-bar assertion, sign change by sign change,
// plus the boundary case no computed fixture contains — a bar EXACTLY at zero.
//
// WHAT IT CANNOT HOLD: creation ORDER relative to the rest of the chart (LWC
// z-orders by insertion), the band's geometry, and anything the renderer decides
// for itself. Those are the pixel gate's job.

// ─── the literal transcription ──────────────────────────────────────────────
// `StockChart.jsx:6100-6118`, verbatim. Do not "tidy" these — their whole value
// is that they are a copy of the shipped call, not a derivation of it.

/** `chart.addSeries(LineSeries, <this>, macdTgt.pane)` — `:6100-6105`. */
const LEGACY_LINE = {
  priceScaleId: 'macd',
  color: '#2196F3',
  lineWidth: 1,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
}
/** `:6106-6111` — same call, the signal colour. */
const LEGACY_SIGNAL = { ...LEGACY_LINE, color: '#FF9800' }

/**
 * `:6112-6116` — a HistogramSeries with `precision: 5` and **no colour at all**.
 * The colour rides on every point (`:4036-4040`), which is what `colorMode:
 * 'sign'` expresses in the definition.
 */
const LEGACY_HIST = {
  priceScaleId: 'macd',
  priceFormat: { type: 'price', precision: 5 },
  priceLineVisible: false,
  lastValueVisible: false,
}

/** The options the engine states on a LINE that the legacy block does not — each
 *  equal to the value a freshly-created LWC 5.2.0 series already has, so a
 *  CREATED series is byte-identical and a RE-PURPOSED one is reset to it. Same
 *  table as `rsiFlipAParity`, and for the same reason (C-1: the complete key set
 *  for a pool key on every bind). */
const LWC_LINE_DEFAULTS_RESTATED = {
  visible: true,
  lineStyle: 0,
  lineType: 0,
  pointMarkersVisible: false,
  pointMarkersRadius: 3,
  priceFormat: { type: 'price', precision: 2 },
  // MACD owns its own stacked band, so `placement` returns 'default' and the
  // identity provider is the restatement. A price overlay would carry
  // AUTOSCALE_EXCLUDE here instead.
  autoscaleInfoProvider: AUTOSCALE_DEFAULT,
}

/**
 * …and the same account for the HISTOGRAM, whose key set is deliberately
 * SMALLER (`pool.js:524-531`): no lineWidth, no lineStyle, no lineType, no
 * crosshair marker, no point markers. Passing them would describe a series that
 * is not there, and a histogram can only ever be re-purposed by another
 * histogram, so there is nothing of that kind for it to inherit.
 *
 * `color` is the entry worth naming: the legacy call sets NONE, so the series
 * takes LWC's own `histogramStyleDefaults.color`. The engine restates that exact
 * literal (`pool.js:266`, pinned against the INSTALLED bundle by `pool.test.js`),
 * which is why a histogram with per-point colours is byte-identical either way —
 * and why the definition declaring no `color` is correct rather than an omission.
 */
const LWC_HIST_DEFAULTS_RESTATED = {
  visible: true,
  color: '#26a69a',
  autoscaleInfoProvider: AUTOSCALE_DEFAULT,
}

/** `applyIndScale('macd', …, { autoScale: true })` — `:6117`, expanded through
 *  `applyIndScale`'s non-`left` branch (`:5543`). MACD is the pilot with an
 *  AUTOSCALED band: no `minimum`/`maximum`, unlike RSI's 0-100. */
const legacyScaleOptions = (band) => ({
  borderVisible: false,
  scaleMargins: band,
  autoScale: true,
})

/** `:6118`. LineStyle 3 = LargeDashed — the same class of finding as RSI's 50
 *  midline (379 px): an OMITTED `createPriceLine` option takes LWC's own default,
 *  which is Dashed (2), not "leave it alone". */
const LEGACY_ZERO_LINE = {
  price: 0,
  color: 'rgba(255,255,255,0.12)',
  lineWidth: 1,
  lineStyle: 3,
  axisLabelVisible: false,
}

/** `StockChart.jsx:81-82`, verbatim. */
const MACD_HIST_UP = 'rgba(76,175,80,0.75)'
const MACD_HIST_DOWN = 'rgba(244,67,54,0.75)'

// ─── the fixture ────────────────────────────────────────────────────────────

const BARS = makeBars(260)
const FAST = 12
const SLOW = 26
const SIGNAL = 9

const INSTANCE = {
  instanceId: 'legacy:macd',
  defId: 'macd',
  defVersion: 2,
  inputs: {
    fastPeriod: FAST, slowPeriod: SLOW, signalPeriod: SIGNAL,
    macdColor: '#2196F3', signalColor: '#FF9800',
  },
  placement: { target: 'pane' },
  hidden: false,
}

/** The `cs` the parity case pins. Its ONLY job is to feed `computePaneMargins`,
 *  which is what reserves MACD's band — and the reason the legacy toggle has to
 *  stay ON under Flip A. */
const CS = { indicators: { macd: { enabled: true } } }
const PANE_MARGINS = computePaneMargins(CS, false, new Set())
const BAND = PANE_MARGINS.macd

const ctxFor = (instances, over) => ({
  enabled: true,
  cs: CS,
  registry: engineRegistry,
  instances,
  bars: BARS,
  adjustTime: (t) => t,
  resolvePlacement,
  paneMargins: PANE_MARGINS,
  volOverlaySet: new Set(),
  volSeparatePane: false,
  VOL_PANE_INDEX: 1,
  plan: { fresh: true },
  ...over,
})

const sync = (over) => {
  const F = createFakeChart()
  const binder = createBinder({ chart: F.chart, LWC: F.LWC })
  const result = binder.sync(ctxFor([INSTANCE], over))
  return { F, binder, result }
}

/** The three `setData` arrays, in bind order: macd · signal · histogram. */
const columns = (F) => F.callsOf('setData').map(c => c.args[0])

describe('MACD Flip A — two lines, a histogram, one guide', () => {
  it('reserves a band at all (otherwise every assertion below is about nothing)', () => {
    expect(BAND).toEqual({ top: 0.83, bottom: 0 })
  })

  it('creates three series: LineSeries, LineSeries, HistogramSeries', () => {
    const { F, result } = sync()
    expect(result.ok).toBe(true)
    expect(result.bound).toBe(3)
    expect(F.count('addSeries')).toBe(3)
    // TWO POOL KEYS FROM ONE INSTANCE — the first migration where that happens.
    // Declaration order is legacy creation order (`:6100`, `:6106`, `:6112`), and
    // it matters: all three share one band and LWC z-orders by insertion, so the
    // histogram drawing OVER the lines rather than under them is a real picture.
    expect(F.seriesCreated.map(s => String(s.__ctor)))
      .toEqual(['LineSeries', 'LineSeries', 'HistogramSeries'])
  })

  it('the two lines carry the legacy options VERBATIM, plus restated defaults', () => {
    const { F } = sync()
    const [line, signal] = F.callsOf('addSeries')
    for (const [call, spec, label] of [[line, LEGACY_LINE, 'macd'], [signal, LEGACY_SIGNAL, 'signal']]) {
      const opts = call.args[1]
      expect(opts, label).toMatchObject(spec)
      expect(opts, label).toMatchObject(LWC_LINE_DEFAULTS_RESTATED)
      // EXHAUSTIVE. `toMatchObject` alone cannot see an option the engine states
      // and the legacy block does not — a stray `lastValueVisible: true` would put
      // an axis tag on the macd scale that the hand-written block never drew, and
      // both assertions above would still pass. Anything the engine emits has to
      // be named in one of the two tables, which is what makes them an account
      // rather than a sample.
      expect(opts, label).toEqual({ ...spec, ...LWC_LINE_DEFAULTS_RESTATED })
    }
  })

  it('the histogram carries precision 5, LWC\'s own colour, and NO line options', () => {
    const { F } = sync()
    const hist = F.callsOf('addSeries')[2].args[1]
    expect(hist).toMatchObject(LEGACY_HIST)
    expect(hist).toEqual({ ...LEGACY_HIST, ...LWC_HIST_DEFAULTS_RESTATED })
    // Named individually as well as covered by the `toEqual`, because these are
    // the four the histogram branch exists to NOT emit — a shared key set across
    // pool keys is the exact bug `pool.js:524-531` is written against.
    for (const key of ['lineWidth', 'lineStyle', 'lineType', 'crosshairMarkerVisible',
      'pointMarkersVisible', 'pointMarkersRadius']) {
      expect(hist, `a histogram has no ${key}`).not.toHaveProperty(key)
    }
    // `minMove` must NOT be emitted: LWC's `merge` recurses into a nested plain
    // object, so the series keeps its own 0.01 — exactly what the legacy call
    // (`{type:'price', precision:5}` and nothing else) leaves it at.
    expect(hist.priceFormat).toEqual({ type: 'price', precision: 5 })
    expect(hist.priceFormat).not.toHaveProperty('minMove')
  })

  it('the band AUTOSCALES — the complete set, and NO fixed range', () => {
    const { F } = sync()
    const applied = F.callsOf('priceScale.applyOptions')
    // ⚠️ THREE, WHERE LEGACY MAKES ONE — and this is the first migration where
    // the two counts differ, because it is the first with more than one series on
    // an OWNED scale. The binder asserts the scale per BINDING (`binder.js:403`);
    // `StockChart` calls `applyIndScale` once, on the MACD line (`:6117`). All
    // three name the same scale id (`macd`) and the same object, and
    // `PriceScaleApiImpl.applyOptions` is idempotent — so this is three writes of
    // one value, not three different bands. It is stated as a COUNT rather than
    // looped over with `length > 0`, because "at least one" would hide the day a
    // definition's plots start disagreeing about their own scale.
    // 🔴 THE COUNT WAS THREE UNTIL B5 TASK 8 MEASURED THE REPEAT AT 11,913 px.
    // The binder wrote the scale once per BINDING; a second
    // `priceScale().applyOptions` landing between two siblings' `setData`
    // calls MATERIALISES the frozen range from the first sibling alone
    // (`adx` came out 15.5154..59.0249 against the shipped 5.1746..59.0249).
    // The shipped blocks call `applyIndScale` ONCE, so the binder does too —
    // `binder.js` TRAP #6. The payload is unchanged and still asserted whole.
    expect(applied, 'nothing asserted the band — this case is vacuous').toHaveLength(1)
    for (const call of applied) expect(call.args[0]).toEqual(legacyScaleOptions(BAND))
    // Stated separately: RSI and Stochastic pin 0-100 here. MACD's range is data,
    // so a `fixedPane(...)` definition would frame the pane wrong in a way the
    // `toEqual` above catches only by absence.
    expect(applied[0].args[0]).not.toHaveProperty('minimum')
    expect(applied[0].args[0]).not.toHaveProperty('maximum')
  })

  it('re-asserts that whole set on a SECOND pass, where legacy asserts only half', () => {
    // Trap #2. `applyIndScale` gets no `bandExtra` on the update branch
    // (`:6122`), so `autoScale: true` survives today only because the series and
    // its scale are born together. A pooled series has no such luck — every bind,
    // the whole object.
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    binder.sync(ctxFor([INSTANCE]))
    binder.sync(ctxFor([INSTANCE]))
    const applied = F.callsOf('priceScale.applyOptions')
    // 🔴 SIX UNTIL B5 TASK 8 — see the case above and `binder.js` TRAP #6. TWO is
    // the claim that matters here and it is UNWEAKENED: the second SYNC writes
    // the whole object again, which is the whole of trap #2.
    expect(applied).toHaveLength(2)
    for (const call of applied) expect(call.args[0]).toEqual(legacyScaleOptions(BAND))
  })

  it('all three sit in pane 0, on the macd scale, and drive it', () => {
    const { F } = sync()
    const calls = F.callsOf('addSeries')
    expect(calls).toHaveLength(3)
    for (const call of calls) {
      // Flip A draws into a BAND inside pane 0, not a real pane. A `1` here is
      // B5 arriving early, and it would move every other series down.
      expect(call.args[2], 'a Flip-A band lives in pane 0').toBe(0)
      expect(call.args[1].priceScaleId).toBe('macd')
      expect(call.args[1].autoscaleInfoProvider,
        'the only thing on that axis has to be what sizes it').toBe(AUTOSCALE_DEFAULT)
    }
  })

  it('the zero guide is LargeDashed, once, on the FIRST data-bearing series', () => {
    const { F } = sync()
    const lines = F.callsOf('createPriceLine')
    expect(lines).toHaveLength(1)
    expect(lines[0].args[0]).toEqual(LEGACY_ZERO_LINE)
    // Legacy puts it on the MACD line (`:6118`), which is the first data plot.
    // Which series owns a guide is not a picture — three overlapping horizontal
    // lines would look the same — but it decides what disappears with a
    // `removeSeries`, which is the orphan the mid-session gate is about.
    expect(lines[0].id).toBe(F.seriesCreated[0].__id)
  })

  it('makes NO other renderer call — nothing removed, nothing moved, nothing extra', () => {
    // The legacy block's create path is exactly: addSeries ×3 ·
    // priceScale.applyOptions · createPriceLine · _applyData ×3. Anything else on
    // a first bind is a call the migration added.
    const { F } = sync()
    expect(F.methodsUsed().sort()).toEqual(
      ['addSeries', 'createPriceLine', 'priceScale.applyOptions', 'setData'],
    )
  })

  it('the numbers are computeMACD\'s, unrounded, NaN → whitespace', () => {
    const { F } = sync()
    const raw = computeMACD(BARS, FAST, SLOW, SIGNAL)
    const cols = columns(F)
    expect(cols).toHaveLength(3)
    for (const [i, key] of ['macd', 'signal', 'histogram'].entries()) {
      const points = cols[i]
      expect(points, key).toHaveLength(BARS.length)
      for (let b = 0; b < BARS.length; b++) {
        const expected = raw[key][b] ? raw[key][b].value : undefined
        if (Number.isFinite(expected)) {
          expect(points[b].value, `${key}@${b}`).toBe(expected)
        } else {
          expect(points[b], `${key}@${b} must be a whitespace item`).toEqual({ time: BARS[b].t })
        }
      }
    }
    // Not vacuous in either direction: real numbers at the tail, whitespace at
    // the head. Three all-whitespace columns would satisfy the loop above against
    // three all-whitespace legacy arrays and prove nothing at all.
    for (const points of cols) {
      expect(Number.isFinite(points.at(-1).value)).toBe(true)
      expect(points[0].value).toBeUndefined()
    }
    // …and the three are DISTINCT columns, not the same one wired three times —
    // the exact failure `computeFor`'s key mapping could make. histogram = macd −
    // signal by construction, which is the cheapest true statement about all three.
    const last = BARS.length - 1
    expect(cols[2][last].value).toBeCloseTo(cols[0][last].value - cols[1][last].value, 12)
    expect(cols[0][last].value).not.toBe(cols[1][last].value)
  })

  it('the MACD line starts at slowPeriod-1, EIGHT bars before the signal — no head-mask', () => {
    // ✅ The owner DROPPED the head-mask on 2026-08-02 (decision `MACD_HEAD_MASK`,
    // `docs/decisions/2026-08-02-macd-head-mask.md`, ACCEPTED). This is the
    // engine's half of the same pin `macdHeadMaskRendered.test.jsx` holds on the
    // legacy render lane: both lanes read ONE constant, and Flip A means the
    // ENGINE lane is now the one users see for MACD.
    const { F } = sync()
    const raw = computeMACD(BARS, FAST, SLOW, SIGNAL)
    const [macd, signal] = columns(F)
    const firstDrawn = (pts) => pts.findIndex(p => Number.isFinite(p && p.value))

    expect(engineRegistry.MACD_HEAD_MASK).toBe(false)
    expect(firstDrawn(macd), 'the line must draw from its OWN first bar').toBe(SLOW - 1)
    expect(firstDrawn(signal)).toBe(SLOW - 1 + SIGNAL - 1)
    expect(firstDrawn(signal) - firstDrawn(macd), 'the 88 px are these bars').toBe(SIGNAL - 1)
    for (let i = SLOW - 1; i < SLOW - 1 + SIGNAL - 1; i++) {
      expect(macd[i].value, `bar ${i} must be drawn at its real value`).toBe(raw.macd[i].value)
    }
    // …and the flip restored the head, it did not invent history in front of it.
    expect(macd[SLOW - 2].value).toBeUndefined()
  })

  it('the user\'s periods reach the compute — a different MACD is a different picture', () => {
    // `fastPeriod`/`slowPeriod`/`signalPeriod` appear in NO option object: they
    // exist only in the numbers. An adapter that dropped one would draw a
    // perfectly legal-looking MACD at the definition default and every option
    // assertion above would still pass. This is Task 3's lesson, applied.
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    binder.sync(ctxFor([{ ...INSTANCE, inputs: { ...INSTANCE.inputs, fastPeriod: 5, slowPeriod: 35, signalPeriod: 4 } }]))
    const [macd, signal] = columns(F)
    const tuned = computeMACD(BARS, 5, 35, 4)
    const stock = computeMACD(BARS, FAST, SLOW, SIGNAL)
    const last = BARS.length - 1
    expect(macd[last].value).toBe(tuned.macd[last].value)
    expect(signal[last].value).toBe(tuned.signal[last].value)
    expect(tuned.macd[last].value).not.toBe(stock.macd[last].value)
    expect(tuned.signal[last].value).not.toBe(stock.signal[last].value)
    // …and the head moved with slowPeriod, which is the other half of "it reached
    // the maths" — a colour-only perturbation can prove neither.
    expect(macd.findIndex(p => Number.isFinite(p && p.value))).toBe(34)
  })

  it('the user\'s colours reach the two lines, not the definition defaults', () => {
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    binder.sync(ctxFor([{ ...INSTANCE, inputs: { ...INSTANCE.inputs, macdColor: '#00ff00', signalColor: '#ff00ff' } }]))
    const calls = F.callsOf('addSeries')
    expect(calls[0].args[1].color).toBe('#00ff00')
    expect(calls[1].args[1].color).toBe('#ff00ff')
    // …and the histogram is NOT repainted by either of them. Its colours are the
    // definition's `colorUp`/`colorDown`, which no input names — exactly as legacy,
    // where `MACD_HIST_UP`/`DOWN` are module constants.
    expect(calls[2].args[1].color).toBe('#26a69a')
    const hist = columns(F)[2]
    const coloured = hist.filter(p => p.color !== undefined)
    expect(coloured.length).toBeGreaterThan(100)
    for (const p of coloured) expect([MACD_HIST_UP, MACD_HIST_DOWN]).toContain(p.color)
  })
})

// ─── THE HISTOGRAM'S PER-BAR COLOUR ─────────────────────────────────────────
//
// B2 review Critical #3, gated. `>= 0` is green, matching `StockChart.jsx:4038`
// exactly. Aggregates are deliberately NOT trusted here: a bridge that coloured
// every bar green would satisfy "both colours appear" if a single stray red
// existed, and a bridge that got the comparison backwards would satisfy any
// count-based check perfectly.

/** Every index where the sign of the histogram flips, computed from the fixture
 *  rather than assumed. These are the bars where a wrong comparison shows. */
function signChanges(points) {
  const out = []
  let prev = null
  for (let i = 0; i < points.length; i++) {
    const v = points[i].value
    if (!Number.isFinite(v)) continue
    const up = v >= 0
    if (prev !== null && up !== prev.up) out.push({ from: prev.i, to: i })
    prev = { i, up }
  }
  return out
}

describe('MACD Flip A — every histogram bar is coloured by the SIGN of its value', () => {
  it('colours every bar, and leaves whitespace uncoloured', () => {
    const { F } = sync()
    const points = columns(F)[2]
    let coloured = 0
    for (const p of points) {
      if (p.value === undefined) { expect(p.color).toBeUndefined(); continue }
      expect(p.color, `value ${p.value}`).toBe(p.value >= 0 ? MACD_HIST_UP : MACD_HIST_DOWN)
      coloured++
    }
    expect(coloured, 'no histogram bar had a value — this case is vacuous').toBeGreaterThan(100)
  })

  it('the fixture exercises BOTH colours, and it is not lopsided', () => {
    // Pinned counts, not just ">0". A fixture drifting to 226 green and 1 red
    // would still satisfy a `>0` check while making every red assertion below a
    // one-in-227 coincidence.
    const { F } = sync()
    const points = columns(F)[2]
    const ups = points.filter(p => p.color === MACD_HIST_UP).length
    const downs = points.filter(p => p.color === MACD_HIST_DOWN).length
    expect(ups).toBe(115)
    expect(downs).toBe(112)
    expect(ups + downs).toBe(227)
  })

  it('is correct on BOTH SIDES of all eleven sign changes, named bar by bar', () => {
    // THE ASSERTION THE AGGREGATE CANNOT MAKE. A sign change is where a `>` vs
    // `>=`, a flipped comparison, or a colour read from the WRONG bar shows up;
    // everywhere else a wrong rule agrees with the right one for long stretches.
    const { F } = sync()
    const points = columns(F)[2]
    const flips = signChanges(points)
    // Pinned, so a fixture change that flattened the histogram cannot silently
    // make this loop iterate zero times.
    expect(flips.map(f => f.to)).toEqual([36, 61, 82, 104, 126, 148, 170, 192, 214, 236, 258])

    for (const { from, to } of flips) {
      const a = points[from]
      const b = points[to]
      expect(Math.sign(a.value) === Math.sign(b.value),
        `bars ${from}/${to} are not actually on opposite sides of zero`).toBe(false)
      expect(a.color, `bar ${from} (${a.value}) is on the wrong side of the flip at ${to}`)
        .toBe(a.value >= 0 ? MACD_HIST_UP : MACD_HIST_DOWN)
      expect(b.color, `bar ${to} (${b.value}) is the first bar of the new sign`)
        .toBe(b.value >= 0 ? MACD_HIST_UP : MACD_HIST_DOWN)
      expect(a.color, `bars ${from} and ${to} straddle zero and must differ`).not.toBe(b.color)
    }
  })

  it('a bar EXACTLY at zero is green — `>= 0`, the legacy comparison', () => {
    // No computed fixture contains an exact zero (the real one has none in 227
    // bars), and it is the one bar where `>` and `>=` disagree. So the column is
    // supplied directly, through the REAL binder and the REAL `macd` definition —
    // only `computeFor` is replaced, so `colorMode`/`colorUp`/`colorDown` and the
    // whole `signColorsForPlot` → `toPoints` path are the shipped ones.
    const HAND = [-1e-12, -0, 0, 1e-12, -3, 3]
    const column = new Array(BARS.length).fill(NaN)
    HAND.forEach((v, i) => { column[BARS.length - HAND.length + i] = v })
    const registry = {
      ...engineRegistry,
      computeFor: (def, bars, inputs) => {
        const real = engineRegistry.computeFor(def, bars, inputs)
        return { ...real, histogram: column }
      },
    }
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const res = binder.sync(ctxFor([INSTANCE], { registry }))
    expect(res.bound, 'the stub column bound nothing — vacuous').toBe(3)

    const points = columns(F)[2]
    const tail = points.slice(-HAND.length)
    expect(tail.map(p => p.value)).toEqual([-1e-12, -0, 0, 1e-12, -3, 3])
    // `-0 >= 0` is TRUE in JS, so negative zero is green too. Written out rather
    // than derived, because deriving it from the same `>= 0` the code uses would
    // make this test agree with the implementation by construction.
    expect(tail.map(p => p.color)).toEqual([
      MACD_HIST_DOWN,  // -1e-12
      MACD_HIST_UP,    // -0
      MACD_HIST_UP,    // 0  ← the boundary
      MACD_HIST_UP,    // 1e-12
      MACD_HIST_DOWN,  // -3
      MACD_HIST_UP,    // 3
    ])
  })

  it('C-2\'s twin for a histogram: a pooled MACD histogram is re-coloured, never inherited', () => {
    // The histogram is the one pool key with a per-point colour, so the
    // re-purpose question has an extra half: a series pooled from a PREVIOUS
    // MACD instance must be handed the new instance's points, colours included,
    // and must not keep the old array. Drive two instances through one binder.
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    binder.sync(ctxFor([INSTANCE]))
    const first = F.seriesCreated[2]
    F.reset()
    binder.sync(ctxFor([{ ...INSTANCE, instanceId: 'other:macd', inputs: { ...INSTANCE.inputs, slowPeriod: 35 } }]))

    expect(F.count('addSeries'), 'the histogram was recreated — that is the #2049 path').toBe(0)
    const writes = F.callsOf('setData').filter(c => c.id === first.__id)
    expect(writes, 'the pooled histogram was never re-fed').toHaveLength(1)
    const points = writes[0].args[0]
    const tuned = computeMACD(BARS, 12, 35, 9)
    const last = BARS.length - 1
    expect(points[last].value).toBe(tuned.histogram[last].value)
    for (const p of points) {
      if (p.value === undefined) { expect(p.color).toBeUndefined(); continue }
      expect(p.color).toBe(p.value >= 0 ? MACD_HIST_UP : MACD_HIST_DOWN)
    }
  })
})
