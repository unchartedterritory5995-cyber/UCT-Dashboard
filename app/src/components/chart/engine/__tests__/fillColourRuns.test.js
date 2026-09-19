// app/src/components/chart/engine/__tests__/fillColourRuns.test.js
//
// ─── ⭐⭐ (j) j.3 / R30 — A FILL IS DRAWN AS RUNS ────────────────────────────
//
// R30 (owner, 2026-09-17): `createFillPrimitive` receives PER-POINT colours — the
// array `columnColorsForPlot` yields for the fill exactly as for a plot — and
// draws one polygon per RUN: a maximal sequence of consecutive points whose
// resolved colour is identical. `ctx.fillStyle` is set once per run.
//
// ⛔⛔ A STATIC-COLOUR FILL RESOLVES TO ONE RUN, and its draw-call list stays
// BYTE-IDENTICAL to j.2's. That is the control, and it is what makes this change
// safe to ship: the shipped single-colour band cannot move.
//
// ⛔⛔ A POINT WHOSE COLOUR RESOLVES TO `null` ENDS THE CURRENT RUN AND STARTS NO
// POLYGON until the next non-null point. An `na` bar is a GAP, never a guess —
// the same rule `toPoints` already follows for a plot, where a non-finite
// condition gets no colour at all rather than the "false" colour.
//
// ─── THE TWO LEVELS, AND WHY THEY ARE NOT ONE ───────────────────────────────
//
// ⭐ SEGMENTATION IS BY COLOUR; GEOMETRY IS BY FINITENESS. They are different
// questions and collapsing them breaks the control:
//
//   colour run  — where `fillStyle` changes. Decided ONLY by the resolved colour.
//   geometry    — where a polygon stops. Decided by `fillRuns`' existing
//                 finite/coordinate rules, INSIDE one colour run.
//
// A static fill therefore has exactly ONE colour run even when an `na` hole
// splits it into three polygons — so `fillStyle` is still assigned once and the
// call list is unchanged. Had "run" meant one thing, a static band with a gap
// would have started setting `fillStyle` three times and the byte-identical
// control would have failed for a fill whose colour nobody made dynamic.
import { describe, it, expect } from 'vitest'
import { createBinder } from '../binder'
import { createFakeChart, createRecordingCtx, drawPrimitive } from './fakeChart'
import { createFillPrimitive, fillRuns } from '../fillPrimitive'
import { withAlpha } from '../../designTokens'

// ⚰️ THE STATIC CONTROLS WERE FIRST WRITTEN AGAINST `'#0000FF'` AND THAT WAS A
// GUESS, NOT A MEASUREMENT — the shipped path puts the colour through
// `withAlpha`, which answers `rgba(0, 0, 255, 1)`. A control that pins a value
// nobody measured fails on its first run and teaches the author to "fix" the
// code to match it. It goes through the SAME helper the renderer does, so the
// control pins the PATH rather than restating that function's output format,
// which would be a second authority over one string.
const STATIC_DRAWN = withAlpha('#0000FF', 1)

const UP = '#00AA00'
const DOWN = '#AA0000'
const STATIC = '#0000FF'

// 7 bars. `timeToX` is `t * 10` and `priceToY` is `500 - p` (fakeChart's
// defaults), so every pixel below is invertible by eye: bar i sits at x = 10i+10,
// the upper edge at y = 490 and the lower at y = 495.
const TIMES = [1, 2, 3, 4, 5, 6, 7]
const UPPER = [10, 10, 10, 10, 10, 10, 10]
const LOWER = [5, 5, 5, 5, 5, 5, 5]

/** isBullish true on 0–2, false on 3–5, true on 6 — the prompt's fixture. */
const COND = [1, 1, 1, 0, 0, 0, 1]
/** The same fixture with bar 4 `na`. */
const COND_NA = [1, 1, 1, 0, NaN, 0, 1]

/** The per-point colours a `colorMode: 'column:<key>'` fill resolves to — the
 *  SAME rule `toPoints` applies for a plot: a non-finite condition is no colour
 *  at all. Written here as the expectation; j.3 makes the binder produce it. */
const coloursFor = (cond) => cond.map((c) => (Number.isFinite(c) ? (c !== 0 ? UP : DOWN) : null))

function drawWith(opts) {
  const fake = createFakeChart()
  const rec = createRecordingCtx()
  const { primitive } = createFillPrimitive({
    upper: UPPER, lower: LOWER, times: TIMES, color: STATIC, opacity: 1, ...opts,
  })
  drawPrimitive(primitive, {
    chart: fake.chart,
    series: fake.seriesCreated[0] || fake.chart.addSeries(fake.LWC.LineSeries, {}, 0),
    recorder: rec,
  })
  return rec
}

describe('(j) j.3 / R30 — a fill is drawn as runs', () => {
  it('⛔⛔ NON-VACUITY — the fixture really resolves to BOTH colours, and to a null when na', () => {
    // Without this, every sequence assertion below could be passing over an array
    // that is all one colour, or all null, and "three runs" would be measuring
    // the fixture rather than the renderer.
    const c = coloursFor(COND)
    expect(c.length, 'the colour array is not parallel to the bars').toBe(TIMES.length)
    expect(new Set(c).size, 'the fixture does not contain two distinct colours').toBe(2)
    expect(c).toEqual([UP, UP, UP, DOWN, DOWN, DOWN, UP])
    expect(c.includes(null), 'the no-na fixture must contain no null').toBe(false)

    const na = coloursFor(COND_NA)
    expect(na[4], 'bar 4 does not resolve to null, so the gap case tests nothing').toBe(null)
    expect(na.filter((x) => x === null).length, 'exactly one bar should be na').toBe(1)
    expect(na).toEqual([UP, UP, UP, DOWN, null, DOWN, UP])
  })

  it('⛔ CONTROL — a STATIC fill is ONE run and its draw calls are unchanged', () => {
    // ⭐ THE SHIPPED BAND CANNOT MOVE. This is j.2's case with no colour array at
    // all, and it is pinned to MEASURED pixels rather than to "some polygon".
    const rec = drawWith({})
    expect(rec.fillStyles(), 'a static fill must assign fillStyle exactly once')
      .toEqual([STATIC_DRAWN])
    const polys = rec.polygons()
    expect(polys.length, 'a static fill over contiguous finite columns is ONE polygon').toBe(1)
    expect(polys[0]).toEqual([
      { x: 10, y: 490 }, { x: 20, y: 490 }, { x: 30, y: 490 }, { x: 40, y: 490 },
      { x: 50, y: 490 }, { x: 60, y: 490 }, { x: 70, y: 490 },
      { x: 70, y: 495 }, { x: 60, y: 495 }, { x: 50, y: 495 }, { x: 40, y: 495 },
      { x: 30, y: 495 }, { x: 20, y: 495 }, { x: 10, y: 495 },
    ])
    expect(rec.ops.map((o) => o.op).filter((o) => o === 'save' || o === 'restore'))
      .toEqual(['save', 'restore'])
  })

  it('⛔ CONTROL — a STATIC fill with an na HOLE is still ONE fillStyle, several polygons', () => {
    // ⭐ THE CASE THAT SEPARATES THE TWO LEVELS. Geometry splits; colour does not.
    // If "run" meant one thing, this would assign fillStyle three times and the
    // control above would be a lie for every shipped band that has a gap.
    const holed = [10, 10, NaN, 10, 10, NaN, 10]
    const rec = drawWith({ upper: holed })
    expect(rec.fillStyles(), 'an na hole must NOT introduce a second fillStyle')
      .toEqual([STATIC_DRAWN])
    expect(rec.polygons().length, 'the hole must split the band into three polygons').toBe(3)
  })

  it('⛔⛔ THREE RUNS — up(0-2), down(3-5), up(6): fillStyle up/down/up', () => {
    const rec = drawWith({ colors: coloursFor(COND) })
    expect(rec.fillStyles()).toEqual([UP, DOWN, UP])
    const polys = rec.polygons()
    expect(polys.length, 'one polygon per run').toBe(3)
    // Run LENGTHS are 3, 3, 1 bars. Their VERTEX counts are 6, 6, 4 — a run of one
    // bar has no width of its own and `runPolygon` gives it the thinnest honest
    // area (x ± 0.5), which is four points, not two. Both readings are pinned so
    // neither can drift into the other.
    expect(polys.map((p) => p.length), 'vertex counts for run lengths 3, 3, 1').toEqual([6, 6, 4])
    expect(rec.polygonColours(), 'each polygon drew under its own run colour')
      .toEqual([UP, DOWN, UP])
    // the single-bar run, pinned exactly
    expect(polys[2]).toEqual([
      { x: 69.5, y: 490 }, { x: 70.5, y: 490 }, { x: 70.5, y: 495 }, { x: 69.5, y: 495 },
    ])
  })

  it('⛔⛔ AN na BAR IS A GAP — four polygons, and the run before it ENDS', () => {
    // up(0-2), down(3), [bar 4 draws NOTHING], down(5), up(6).
    const rec = drawWith({ colors: coloursFor(COND_NA) })
    const polys = rec.polygons()
    expect(polys.length, 'four runs survive the na bar').toBe(4)
    // ⛔ EVERY ASSIGNMENT, not the de-duplicated sequence: runs 2 and 3 are
    // SEPARATE runs that happen to share a colour, and R30 sets fillStyle once
    // per run. Collapsing them here would hide a renderer that had merged the two
    // across the gap — which is exactly the bridged-gap defect.
    expect(rec.fillStyles(), 'fillStyle is assigned once per run')
      .toEqual([UP, DOWN, DOWN, UP])
    // …and the DISTINCT consecutive colours are three, in that order.
    const distinct = rec.fillStyles().filter((v, i, a) => i === 0 || a[i - 1] !== v)
    expect(distinct, 'three distinct colours, in order').toEqual([UP, DOWN, UP])
    expect(rec.polygonColours()).toEqual([UP, DOWN, DOWN, UP])
    // ⛔ THE GAP IS NOT BRIDGED. Bar 4 sits at x = 50; no vertex may.
    expect(polys.flat().some((p) => p.x === 50), 'bar 4 was drawn — the gap was guessed')
      .toBe(false)
  })

  it('⛔ RUN SEGMENTATION IS COMPUTED ONCE PER FRAME, and it is a pure function', () => {
    // R30 says run boundaries are computed once per frame. `fillRuns` is where
    // that lives, so it must ANSWER the colour question rather than the draw loop
    // re-deriving it — otherwise there are two authorities on one sentence.
    const runs = fillRuns(UPPER, LOWER, coloursFor(COND))
    expect(runs.map((r) => [r.from, r.to, r.color]))
      .toEqual([[0, 2, UP], [3, 5, DOWN], [6, 6, UP]])
    const naRuns = fillRuns(UPPER, LOWER, coloursFor(COND_NA))
    expect(naRuns.map((r) => [r.from, r.to, r.color]))
      .toEqual([[0, 2, UP], [3, 3, DOWN], [5, 5, DOWN], [6, 6, UP]])
    // …and with no colour array it is exactly what it has always been.
    expect(fillRuns(UPPER, LOWER).map((r) => [r.from, r.to])).toEqual([[0, 6]])
  })
})

// ─── THE CARRIAGE: the binder hands `plot.fill` to `columnColorsForPlot` ──────

const BARS = TIMES.map((t) => ({ t, c: 10 }))
const COLUMNS = { vis: UPPER, hiA: UPPER, hiB: LOWER, cond: COND }

/** Clouds in miniature WITH a dynamic fill colour: the fill carries the SAME
 *  three field names a plot uses, so `columnColorsForPlot` reads it verbatim. */
const dynamicCloud = (id) => ({
  id, schemaVersion: 2, label: id, inputs: [],
  plots: [
    { key: 'vis', label: 'Fast MA', style: 'line', legend: { decimals: 2 } },
    {
      key: 'hiA', label: '', style: 'line', legend: { decimals: 2 }, hidden: true,
      fill: { with: 'hiB', colorMode: 'column:cond', colorUp: UP, colorDown: DOWN },
    },
    { key: 'hiB', label: '', style: 'line', legend: { decimals: 2 }, hidden: true },
    { key: 'cond', label: '', style: 'line', hidden: true },
  ],
})

function bind(def) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const defs = new Map([[def.id, def]])
  binder.sync({
    enabled: true,
    instances: [{ instanceId: `inst:${def.id}:1`, defId: def.id, inputs: {} }],
    registry: {
      getDefinition: (i) => defs.get(i) || null,
      computeFor: () => COLUMNS,
      hasAnyFinite: (col) => Array.isArray(col) && col.some(Number.isFinite),
      columnKeys: (d) => (d.plots || []).map((p) => p.key),
    },
    bars: BARS,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    resolvePlacement: () => ({ paneIndex: 1, scaleId: 's', scaleOptions: {} }),
  })
  const attached = fake.calls.filter((c) => c.method === 'attachPrimitive')
  return { fake, attached }
}

describe('(j) j.3 — the fill is handed to the SAME colour reader a plot is', () => {
  it('⛔⛔ NON-VACUITY — the specimen declares a dynamic fill and its condition column', () => {
    const d = dynamicCloud('u_dyn')
    const owner = d.plots.find((p) => p.fill)
    expect(owner.fill.colorMode, 'the fill carries no column colour mode').toBe('column:cond')
    expect(owner.fill.colorUp).toBe(UP)
    expect(owner.fill.colorDown).toBe(DOWN)
    expect(d.plots.some((p) => p.key === 'cond'), 'the condition column is not declared').toBe(true)
    expect(COLUMNS.cond, 'the condition column has no data').toBeTruthy()
  })

  it('⛔ CONTROL — the dynamic fill still attaches exactly ONE primitive', () => {
    // A colour array must not change the ATTACH contract j.2 pinned.
    const { attached } = bind(dynamicCloud('u_dyn'))
    expect(attached.length, 'a dynamic fill must attach one hosted primitive').toBe(1)
  })

  it('⛔⛔ THE BAND DRAWS IN RUNS END TO END, from the definition', () => {
    const { fake, attached } = bind(dynamicCloud('u_dyn'))
    const rec = createRecordingCtx()
    drawPrimitive(attached[0].args[0], {
      chart: fake.chart,
      series: fake.seriesCreated[0],
      recorder: rec,
    })
    expect(rec.fillStyles(), 'the binder did not carry per-point colours to the fill')
      .toEqual([UP, DOWN, UP])
    expect(rec.polygons().length).toBe(3)
  })

  it('⛔⛔ BOTH COLOURS CARRY THE FILL\'S OWN ALPHA — the rail a mutation demanded', () => {
    // ⚰️ ADDED BECAUSE A MUTATION WOULD HAVE ESCAPED, AND THE ACCEPTANCE WAS
    // INCOMPLETE UNTIL IT DID NOT. Building the two colours straight off
    // `fill.colorUp`/`fill.colorDown` — routing AROUND `columnColorsForPlot` —
    // leaves every case above green, because none of those fixtures declares an
    // opacity and the two routes therefore agree.
    //
    // ⭐ `twoColoursOf` is what folds a fill's `opacity` into BOTH colours, and it
    // is the whole reason the fill is handed to the plot's reader rather than read
    // field by field. Skipping it ships a cloud at full strength over the candles
    // it is meant to sit BEHIND — a band that hides the indicator it annotates,
    // which is the same failure `zOrder: 'bottom'` exists to prevent, arriving by
    // a different door and visible only on a chart.
    //
    // ⛔ ALL THREE RUNS ARE ASSERTED, not just the first. An alpha applied to the
    // `up` colour alone is exactly what a half-done fix looks like, and a check
    // that reads one run would call it fixed.
    const def = dynamicCloud('u_alpha')
    const owner = def.plots.find((p) => p.fill)
    owner.fill.opacity = 0.2
    const { fake, attached } = bind(def)
    const rec = createRecordingCtx()
    drawPrimitive(attached[0].args[0], {
      chart: fake.chart,
      series: fake.seriesCreated[0],
      recorder: rec,
    })
    // `withAlpha` MULTIPLIES through, so these are the measured strings, derived
    // from the same helper the renderer uses rather than typed out here.
    expect(rec.fillStyles(), 'the fill\'s alpha reached neither colour')
      .toEqual([withAlpha(UP, 0.2), withAlpha(DOWN, 0.2), withAlpha(UP, 0.2)])
    // …and the control: with NO opacity the colours are untouched, so the
    // assertion above is about the alpha and not about the colours in general.
    const plain = bind(dynamicCloud('u_plain'))
    const rec2 = createRecordingCtx()
    drawPrimitive(plain.attached[0].args[0], {
      chart: plain.fake.chart,
      series: plain.fake.seriesCreated[0],
      recorder: rec2,
    })
    expect(rec2.fillStyles(), 'a fill declaring no opacity must draw its colours verbatim')
      .toEqual([UP, DOWN, UP])
  })
})
