// app/src/components/chart/engine/__tests__/markerPixels.test.js
//
// ─── UCT Relative Strength, Phase 1 (review fix unit 6) — THE DOT SIZE CHANNEL,
//     IN PIXELS ──────────────────────────────────────────────────────────────
//
// Review finding V1: the "small" (size 0.6) and "large" (size 1.2) new-high dots
// drew at the SAME 9 px at every normal zoom. lightweight-charts 5.2.0 clamps a
// series-marker glyph to a 12..30 px floor TWICE — once on the bar spacing
// (`calculateShapeHeight`) and again on the multiplied size (`shapeSize` →
// `size`) — so a multiplier below 1 can never reach under the floor.
//
// The fix draws the two small dots as the series' own POINT MARKERS (a `markers`
// plot with NO `marker` block: `pointMarkersRadius` from `width`, no floor) and
// keeps the gold before-price dot as a glyph (size 2.0 at Phase 1, 1.6 since
// decision L1 on 2026-11-07), which the floor can only make LARGER. This file MIRRORS LWC's arithmetic from the installed source
// (`node_modules/lightweight-charts/dist/lightweight-charts.development.mjs`:
// `ceiledEven`, `ceiledOdd`, `size`, `shapeSize`, `calculateShapeHeight`,
// `fillSizeAndY`, `drawCircle`, `drawSeriesPointMarkers`) and asserts small < large
// at every bar spacing a member reaches — phone, grid cell, default desktop daily
// (~14.8 px at 1000 px / 65 bars), zoomed in.
//
// ⚠️ A MIRROR, NOT AN IMPORT. The functions are module-private in LWC. The first
// test pins the mirror to the installed version and to the three constants it
// copies, so a library upgrade that moves the floor fails HERE, by name.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as nativeRegistry from '../nativeRegistry'
import { getDefinition } from '../nativeRegistry'
import { seriesOptionsForPlot } from '../pool'
import { presentedPlot, DOT_SIZES, DOT_GLYPH_SCALE, scaledMarker } from '../presentation'
import { markersFor } from '../markerPrimitive'
import { createBinder } from '../binder'
import { IND_TOKENS } from '../../designTokens'
import { createFakeChart } from './fakeChart'
import { mergeChartSettings } from '../../chartDefaults'
import { addInstance, applyPresetInputs, findInstance } from '../instanceControls'

// ─── the mirror ─────────────────────────────────────────────────────────────

const MIN_SHAPE_SIZE = 12
const MAX_SHAPE_SIZE = 30
const CIRCLE_COEFF = 0.8

const ceiledEven = (x) => { const c = Math.ceil(x); return c % 2 !== 0 ? c - 1 : c }
const ceiledOdd = (x) => { const c = Math.ceil(x); return c % 2 === 0 ? c - 1 : c }
/** LWC `size(barSpacing, coeff)` — the clamp lives HERE, and it is applied to
 *  whatever is passed, which is the bar spacing on one call and the already
 *  multiplied size on the next. */
const size = (barSpacing, coeff) => ceiledOdd(Math.min(Math.max(barSpacing, MIN_SHAPE_SIZE), MAX_SHAPE_SIZE) * coeff)
const shapeSize = (shape, originalSize) => (shape === 'circle' ? size(originalSize, CIRCLE_COEFF) : size(originalSize, 1))
const calculateShapeHeight = (barSpacing) => ceiledEven(size(barSpacing, 1))

/** `fillSizeAndY`: `rendererItem.size = calculateShapeHeight(barSpacing) * max(marker.size, 0)`
 *  (1 when `size` is not a number); `drawCircle` then takes `shapeSize('circle', size)`
 *  and fills an arc of radius `(circleSize - 1) / 2` (× the pixel ratio). The number
 *  returned here is `circleSize` — the odd integer LWC calls the circle's size; the
 *  painted disc is `circleSize - 1` CSS px across. */
function glyphCircleSize(markerSize, barSpacing) {
  const multiplier = Number.isFinite(markerSize) ? Math.max(markerSize, 0) : 1
  return shapeSize('circle', calculateShapeHeight(barSpacing) * multiplier)
}
const glyphDiameterPx = (markerSize, barSpacing) => glyphCircleSize(markerSize, barSpacing) - 1

/** `drawSeriesPointMarkers`: `radius = pointMarkersRadius * verticalPixelRatio + correction`,
 *  an arc at every point — no bar-spacing term anywhere. Diameter in CSS px: */
const pointDiameterPx = (pointMarkersRadius) => 2 * pointMarkersRadius

/** Every bar spacing the fix plan names: phone and grid cell (4–8), the floor (12),
 *  the default desktop daily (~15), zoomed in (20, 30). */
const BAR_SPACINGS = [4, 6, 8, 12, 15, 20, 30]

const rs = getDefinition('rsLine')
const plot = (key) => rs.plots.find((p) => p.key === key)

// ─── 1. the mirror is the installed library's arithmetic ────────────────────

describe('the mirror is pinned to the installed lightweight-charts', () => {
  const LWC = [
    join(process.cwd(), 'node_modules', 'lightweight-charts'),
    join(process.cwd(), 'app', 'node_modules', 'lightweight-charts'),
  ].find((p) => existsSync(join(p, 'package.json')))

  it('is 5.2.0, and its marker source carries the three constants copied above', () => {
    expect(LWC, `lightweight-charts not found from cwd ${process.cwd()}`).toBeTruthy()
    const pkg = JSON.parse(readFileSync(join(LWC, 'package.json'), 'utf8'))
    expect(pkg.version).toBe('5.2.0')
    const src = readFileSync(join(LWC, 'dist', 'lightweight-charts.development.mjs'), 'utf8')
    // `size()`: the double clamp, verbatim.
    expect(src).toContain(`Math.min(Math.max(barSpacing, ${MIN_SHAPE_SIZE} /* Constants.MinShapeSize */), ${MAX_SHAPE_SIZE} /* Constants.MaxShapeSize */) * coeff`)
    // `shapeSize('circle', …)`: the circle coefficient.
    expect(src).toContain(`case 'circle':\n            return size(originalSize, ${CIRCLE_COEFF});`)
    // `calculateShapeHeight`: even-ceiled; `drawCircle`: `(circleSize - 1) / 2`.
    expect(src).toContain('return ceiledEven(size(barSpacing, 1));')
    expect(src).toContain('const halfSize = (circleSize - 1) / 2;')
    // `fillSizeAndY`: height × the marker's size multiplier (1 when absent).
    expect(src).toContain('const sizeMultiplier = isNumber(marker.size) ? Math.max(marker.size, 0) : 1;')
    expect(src).toContain('const shapeSize = calculateShapeHeight(timeScale.options().barSpacing) * sizeMultiplier;')
    // point markers: a radius, a pixel ratio, no bar spacing.
    expect(src).toContain('const radius = pointMarkersRadius * verticalPixelRatio + correction;')
    // …and the line is skipped entirely when `lineVisible` is off.
    expect(src).toContain('_internal_lineType: options.lineVisible ? options.lineType : undefined,')
  })

  it('ceiledOdd / ceiledEven behave as LWC\'s', () => {
    expect([9.6, 10, 11, 13.44, 16].map(ceiledOdd)).toEqual([9, 9, 11, 13, 15])
    expect([11, 12, 15, 29].map(ceiledEven)).toEqual([10, 12, 14, 28])
  })
})

// ─── 2. the defect, as a control ────────────────────────────────────────────

describe('⛔ CONTROL — the OLD sizes 0.6 and 1.2 were the same 9 px circle at every normal zoom', () => {
  it('equal at bar spacings 4..12, barely apart at 15, and never below 9 px', () => {
    for (const bs of [4, 6, 8, 12]) {
      expect(glyphCircleSize(0.6, bs), `bs ${bs}`).toBe(9)
      expect(glyphCircleSize(1.2, bs), `bs ${bs}`).toBe(9)
    }
    // The floor: a multiplier under 1 can never reach beneath 9 px.
    for (const bs of BAR_SPACINGS) expect(glyphCircleSize(0.25, bs), `bs ${bs}`).toBe(9)
    expect(glyphCircleSize(1.2, 15)).toBe(13)
  })
})

// ─── 3. the shape unit 6 landed ─────────────────────────────────────────────

describe('the small dots are the series\' own point markers — radius 2, no floor (two at Phase 1, four at 2a-14)', () => {
  for (const key of ['dotNH', 'dotNHpartial', 'dotNL', 'dotMansfieldCross']) {
    it(`${key}: a markers plot with NO marker block and width 2`, () => {
      const p = plot(key)
      expect(p.style).toBe('markers')
      expect(p.marker).toBeUndefined()
      expect(p.width).toBe(2)
      const o = seriesOptionsForPlot(p, { scaleId: 'rsLine' })
      expect(o.lineWidth).toBe(0)
      expect(o.pointMarkersVisible).toBe(true)
      expect(o.pointMarkersRadius).toBe(2)
      // ⛔ The zero-width line is hidden OUTRIGHT: the canvas ignores a zero line
      // width, so without this LWC strokes a hairline chord from one sparse dot to the
      // next across the pane.
      expect(o.lineVisible).toBe(false)
    })
  }

  it('4 px across at EVERY bar spacing — the point marker has no bar-spacing term', () => {
    const o = seriesOptionsForPlot(plot('dotNH'), { scaleId: 'rsLine' })
    for (const bs of BAR_SPACINGS) expect(pointDiameterPx(o.pointMarkersRadius), `bs ${bs}`).toBe(4)
  })
})

// ⭐ Decision L1 (owner-delegated, 2026-11-07): the glyph went from size 2.0 to
// 1.6, so the floor case (phone, grid cell, zoomed out) draws 13 px, not 15. The
// pins below moved with it; the ORDER rails (small < gold at every spacing, gold
// never under the old 9 px dots) are unchanged in kind.
describe('the gold before-price dot is a glyph at size 1.6 — the floor can only make it larger', () => {
  it('is the circle glyph, inBar, size 1.6', () => {
    const p = plot('dotNHbeforePx')
    expect(p.style).toBe('markers')
    expect(p.marker).toEqual({ shape: 'circle', position: 'inBar', size: 1.6 })
  })

  it('13 px at the floor (bar spacing ≤ 12), 17 px at 15, 23 px from 20 — the table', () => {
    const table = Object.fromEntries(BAR_SPACINGS.map((bs) => [bs, glyphCircleSize(1.6, bs)]))
    expect(table).toEqual({ 4: 13, 6: 13, 8: 13, 12: 13, 15: 17, 20: 23, 30: 23 })
    // ⛔ CONTROL: the Phase 1 size drew 15 px at the floor — the look L1 retired.
    expect(glyphCircleSize(2.0, 12)).toBe(15)
  })

  it('markersFor hands LWC exactly that spec; a plain plot never reaches the glyph layer', () => {
    const times = [1, 2, 3]
    const gold = markersFor({ column: [NaN, 1.3, NaN], times, marker: plot('dotNHbeforePx').marker, color: '#c9a84c' })
    expect(gold).toEqual([{ time: 2, position: 'inBar', shape: 'circle', color: '#c9a84c', size: 1.6 }])
    expect(markersFor({ column: [1.2, 1.3, 1.4], times, marker: plot('dotNH').marker, color: '#6ba3be' })).toEqual([])
  })
})

// ─── 4. small < large, at every bar spacing ─────────────────────────────────

describe('⭐ small < large at bar spacings 4, 6, 8, 12, 15, 20, 30', () => {
  const small = seriesOptionsForPlot(plot('dotNH'), { scaleId: 'rsLine' }).pointMarkersRadius
  const partial = seriesOptionsForPlot(plot('dotNHpartial'), { scaleId: 'rsLine' }).pointMarkersRadius
  const gold = plot('dotNHbeforePx').marker.size

  for (const bs of BAR_SPACINGS) {
    // L1 (2026-11-07): the 1.6 glyph paints a 12 px disc at the floor, so the
    // ratio bar is 3× (it was 3.5× at 2.0's 14 px) and the floor pin is 12 px.
    it(`bar spacing ${bs}: 4 px small dot, ${glyphDiameterPx(gold, bs)} px gold disc (≥ 3×)`, () => {
      const smallPx = pointDiameterPx(small)
      const goldPx = glyphDiameterPx(gold, bs)
      expect(pointDiameterPx(partial)).toBe(smallPx)
      expect(smallPx).toBeLessThan(goldPx)
      expect(goldPx / smallPx).toBeGreaterThanOrEqual(3)
      // The gold disc is never smaller than the 9 px the old dots drew, at any zoom.
      expect(goldPx).toBeGreaterThanOrEqual(12)
    })
  }

  it('…and a member\'s Dot size keeps the order: even Large (radius 4 → 8 px) sits under the gold 12 px floor', () => {
    const large = presentedPlot(plot('dotNH'), { presentation: { dotSize: 'large' } })
    expect(large.width).toBe(DOT_SIZES.large)
    for (const bs of BAR_SPACINGS) {
      expect(pointDiameterPx(large.width)).toBeLessThan(glyphDiameterPx(gold, bs))
    }
  })
})

// ─── 5. presentation.dotSize reaches a declared-markers plot ────────────────

describe('presentation.dotSize is honoured on a plot DECLARED markers', () => {
  it('a stored instance-level size sets the radius; a per-output size outranks it', () => {
    expect(presentedPlot(plot('dotNH'), { presentation: { dotSize: 'large' } }).width).toBe(DOT_SIZES.large)
    expect(presentedPlot(plot('dotNH'), { presentation: { dotSize: 'small' } }).width).toBe(DOT_SIZES.small)
    expect(presentedPlot(plot('dotNH'), {
      presentation: { dotSize: 'large', plots: { dotNH: { dotSize: 'small' } } },
    }).width).toBe(DOT_SIZES.small)
    // `medium` IS a stored choice, and it is the medium radius, not the declared 2.
    expect(presentedPlot(plot('dotNH'), { presentation: { dotSize: 'medium' } }).width).toBe(DOT_SIZES.medium)
  })

  it('⛔ CONTROL: with nothing stored the declared radius stands and the plot is returned by identity', () => {
    const p = plot('dotNH')
    expect(presentedPlot(p, {})).toBe(p)
    expect(presentedPlot(p, { presentation: {} })).toBe(p)
    expect(presentedPlot(p, { presentation: { plots: { rsLine: { style: 'area' } } } })).toBe(p)
    // SAR: declared radius 3 survives a presentation that changes something ELSE
    // (a renderLook used to push it past the early return and onto the 2.5 default).
    const sar = getDefinition('sar').plots.find((q) => q.key === 'sar')
    expect(sar.width).toBe(3)
    expect(presentedPlot(sar, { renderLook: { autoscale: 'exclude' } }).width).toBe(3)
    expect(presentedPlot(sar, { renderLook: { autoscale: 'exclude' } }).autoscale).toBe('exclude')
  })

  it('a LINE restyled to dots still takes the chosen (or default) size — unchanged behaviour', () => {
    const line = plot('rsLine')
    const dots = presentedPlot(line, { presentation: { plots: { rsLine: { style: 'dots' } } } })
    expect(dots.style).toBe('markers')
    expect(dots.width).toBe(DOT_SIZES.medium)
    const big = presentedPlot(line, { presentation: { plots: { rsLine: { style: 'dots', dotSize: 'large' } } } })
    expect(big.width).toBe(DOT_SIZES.large)
  })
})

// ─── 5b. presentation.dotSize reaches a GLYPH plot (2a-13 / 2a-15) ──────────
//
// Stress's `dotSize: {dotNHbeforePx: 'large'}` was stored and detected at 2a-14
// and visually inert: `presentedPlot` scaled only `width`, which a glyph never
// reads, and the pool drew a 2 px point marker under the glyph. The word is now a
// MULTIPLIER on the declared `marker.size` (`DOT_GLYPH_SCALE`), and the series
// under a glyph draws no point marker at all.

describe('⭐ a stored dot size SCALES the gold glyph — the Stress reading becomes pixels', () => {
  const gold = plot('dotNHbeforePx')
  const red = plot('dotNHred')

  it('the glyph scale is 0.6× / 1× / 1.4× of the DECLARED size; Default is the declared look by identity of value', () => {
    expect(DOT_GLYPH_SCALE).toEqual({ small: 0.6, medium: 1, large: 1.4 })
    expect(Object.isFrozen(DOT_GLYPH_SCALE)).toBe(true)
    expect(Object.keys(DOT_GLYPH_SCALE)).toEqual(Object.keys(DOT_SIZES))
    // 1.6 × 1.4 and 1.6 × 0.6 are not exact in binary, so the size is matched close
    expect(scaledMarker(gold.marker, 'large')).toEqual({ shape: 'circle', position: 'inBar', size: expect.closeTo(2.24, 10) })
    expect(scaledMarker(gold.marker, 'small')).toEqual({ shape: 'circle', position: 'inBar', size: expect.closeTo(0.96, 10) })
    expect(scaledMarker(gold.marker, 'medium')).toEqual(gold.marker)
    // the red-day glyph is the same text-free circle (visual round A3), the same
    // declared size (L1), and scales the same way
    expect(red.marker).toEqual(gold.marker)
    expect(scaledMarker(red.marker, 'large')).toEqual({ shape: 'circle', position: 'inBar', size: expect.closeTo(2.24, 10) })
    // a block with no declared size is at LWC's multiplier 1 and scales from there
    expect(scaledMarker({ shape: 'square', position: 'aboveBar' }, 'large').size).toBeCloseTo(1.4)
    // an unknown word, or no block, is a no-op
    expect(scaledMarker(gold.marker, 'huge')).toBe(gold.marker)
    expect(scaledMarker(undefined, 'large')).toBeUndefined()
  })

  it('presentedPlot: a per-output or instance-level word scales `marker.size`; `width` is left alone', () => {
    const perOutput = presentedPlot(gold, { presentation: { plots: { dotNHbeforePx: { dotSize: 'large' } } } })
    expect(perOutput.marker).toEqual({ shape: 'circle', position: 'inBar', size: expect.closeTo(2.24, 10) })
    expect(perOutput.width, 'the glyph reads marker.size, not width').toBe(gold.width)
    expect(perOutput.style).toBe('markers')
    const instanceLevel = presentedPlot(gold, { presentation: { dotSize: 'small' } })
    expect(instanceLevel.marker.size).toBeCloseTo(0.96)
    // per-output outranks the instance level, as it does for the plain dots
    expect(presentedPlot(gold, { presentation: { dotSize: 'small', plots: { dotNHbeforePx: { dotSize: 'large' } } } }).marker.size).toBeCloseTo(2.24)
    // a stored `medium` is a stored choice: the plot is re-made, the glyph is the declared one
    expect(presentedPlot(gold, { presentation: { dotSize: 'medium' } }).marker).toEqual(gold.marker)
  })

  it('⛔ CONTROL: with nothing stored the declared glyph stands and the plot is returned by identity', () => {
    expect(presentedPlot(gold, {})).toBe(gold)
    expect(presentedPlot(gold, { presentation: {} })).toBe(gold)
    expect(presentedPlot(gold, { presentation: { plots: { dotNH: { dotSize: 'large' } } } })).toBe(gold)
    expect(gold.marker).toEqual({ shape: 'circle', position: 'inBar', size: 1.6 })
    // the glyph plot never takes the point-radius path: a Large word does not touch `width`
    expect(presentedPlot(gold, { presentation: { dotSize: 'large' } }).width).toBe(1)
  })

  it('the pixel table (L1, size 1.6): Default 13 / 17 / 23; Large 17 then 23; Small 9 / 11 / 13 / 21', () => {
    const at = (word) => Object.fromEntries(BAR_SPACINGS.map((bs) => [bs, glyphCircleSize(scaledMarker(gold.marker, word).size, bs)]))
    expect(at('medium')).toEqual({ 4: 13, 6: 13, 8: 13, 12: 13, 15: 17, 20: 23, 30: 23 })
    expect(at('large')).toEqual({ 4: 17, 6: 17, 8: 17, 12: 17, 15: 23, 20: 23, 30: 23 })
    expect(at('small')).toEqual({ 4: 9, 6: 9, 8: 9, 12: 9, 15: 11, 20: 13, 30: 21 })
    // Stress's Large dot renders at a LARGER circle than Default wherever Default is
    // under the ceiling (phone, grid cell, zoomed out, desktop daily: spacing ≤ 15)…
    for (const bs of [4, 6, 8, 12, 15]) expect(at('large')[bs], `bs ${bs}`).toBeGreaterThan(at('medium')[bs])
    // …and EQUAL to it from bar spacing 20, because 23 is the largest circle LWC
    // draws: `size()` clamps the multiplied height to 30, × 0.8 = 24, ceiled odd = 23,
    // and Default (18 × 1.6 = 28.8 → 23.04 → 23) is already there.
    for (const bs of [15, 20, 30]) expect(at('large')[bs], `bs ${bs}`).toBe(23)
    expect(glyphCircleSize(100, 15), 'the ceiling, whatever the multiplier').toBe(23)
    expect(glyphCircleSize(100, 4), 'at any spacing').toBe(23)
    // Small stays under Default at every spacing but the 30 px ceiling
    for (const bs of [4, 6, 8, 12, 15, 20]) expect(at('small')[bs], `bs ${bs}`).toBeLessThan(at('medium')[bs])
  })

  it('the Stress preset, applied through the writer, stores the word the glyph lane reads', () => {
    const ids = (c) => new Set(c.indicatorInstances.map((i) => i.instanceId))
    let cs = mergeChartSettings({})
    const before = ids(cs)
    cs = addInstance(cs, 'rsLine', nativeRegistry)
    const a = [...ids(cs)].find((id) => !before.has(id))
    const stress = rs.meta.presets.find((p) => p.id === 'stress')
    // visual round A3: the red-day high is Stress's ONE large gold mark
    expect(stress.dotSize).toEqual({ dotNHred: 'large' })
    cs = applyPresetInputs(cs, a, rs, stress, nativeRegistry)
    const inst = findInstance(cs, a)
    expect(inst.presentation).toMatchObject({ plots: { dotNHred: { dotSize: 'large' } } })
    // …and the plan's plot for that instance carries the scaled glyph
    expect(presentedPlot(red, inst).marker.size).toBeCloseTo(2.24)
    // the before-price glyph is NOT named by Stress (and is switched off there), so it keeps the declared 1.6
    expect(presentedPlot(gold, inst)).toBe(gold)
  })
})

// ─── 6. the binder draws the plain dot ON the RS value, only on event bars ──

describe('⭐⭐ the real binder: a plain dot is a point of the series at the RS value, and the gold dot is a glyph above it', () => {
  const BARS = Array.from({ length: 8 }, (_, i) => ({ t: 1700000000 + i * 86400, c: 10 + i }))
  const rsLine = [1, 1.1, 1.2, 1.15, 1.3, 1.25, 1.4, 1.35]
  const NONE = [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN]
  const COLUMNS = {
    rsLine,
    rsAbove: [1, 1, 1, 0, 1, 0, 1, 0],
    rsMa: [1, 1.05, 1.1, 1.12, 1.16, 1.18, 1.22, 1.25],
    dotNH: [NaN, NaN, 1.2, NaN, 1.3, NaN, 1.4, NaN],
    dotNHbeforePx: [NaN, NaN, NaN, NaN, 1.3, NaN, NaN, NaN],
    dotNHpartial: NONE,
    // 2a-14: the server blanks these unless their toggle is on; the red-day glyph
    // fires on bar 6 here, the Mansfield cross dot sits BELOW zero on bar 3.
    mansfield: [NaN, NaN, -2.1, -0.4, 0.8, 1.6, 2.2, 1.9],
    dotNHred: [NaN, NaN, NaN, NaN, NaN, NaN, 1.4, NaN],
    dotNL: NONE,
    dotMansfieldCross: [NaN, NaN, NaN, -0.4, NaN, NaN, NaN, NaN],
  }

  function drive(inputs = {}, presentation = undefined) {
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const glyphs = []
    const registry = {
      getDefinition: (id) => (id === 'rsLine' ? rs : null),
      computeFor: () => COLUMNS,
      hasAnyFinite: (col) => Array.isArray(col) && col.some(Number.isFinite),
      columnKeys: (d) => (d.plots || []).map((p) => p.key),
    }
    binder.sync({
      enabled: true,
      instances: [{ instanceId: 'inst:rsLine:1', defId: 'rsLine', inputs, ...(presentation ? { presentation } : {}) }],
      registry,
      bars: BARS,
      adjustTime: (t) => t,
      plan: { fresh: true },
      applyData: (series, data) => series.setData(data),
      resolvePlacement: () => ({ paneIndex: 1, scaleId: 'rsLine', scaleOptions: {} }),
      createSeriesMarkers: (series, markers) => {
        glyphs.push({ series, markers })
        return { setMarkers: (m) => glyphs.push({ series, markers: m }) }
      },
    })
    const dataOf = (series) => {
      const call = fake.calls.filter((c) => c.on === 'series' && c.id === series.__id && c.method === 'setData').pop()
      return call ? call.args[0] : null
    }
    const byColour = (hex, dots) => fake.seriesCreated.find((s) => s.__options.color === hex && !!s.__options.pointMarkersVisible === dots)
    return { fake, glyphs, dataOf, byColour }
  }

  it('dotNH: whitespace everywhere but the event bars, where the point IS the RS value; no glyph layer', () => {
    const { glyphs, dataOf, byColour } = drive()
    const dot = byColour('#6ba3be', true)
    expect(dot, 'the blue dot series').toBeTruthy()
    expect(dot.__options).toMatchObject({ lineWidth: 0, pointMarkersVisible: true, pointMarkersRadius: 2, lineVisible: false })
    const points = dataOf(dot)
    expect(points.map((p) => ('value' in p ? p.value : null))).toEqual([null, null, 1.2, null, 1.3, null, 1.4, null])
    expect(points.map((p) => p.time)).toEqual(BARS.map((b) => b.t))
    expect(points[2].value).toBe(rsLine[2])
    expect(glyphs.some((g) => g.series === dot), 'a plain dot never reaches createSeriesMarkers').toBe(false)
  })

  it('dotNHbeforePx: ONE glyph, inBar, size 1.6, on the event bar — above a series that holds the value and draws NOTHING itself', () => {
    const { fake, glyphs, byColour } = drive()
    // ⭐ 2a-13: the glyph's host series draws no point marker (there used to be a 2 px
    // disc under every gold circle) and no line — `byColour(…, false)` is the proof.
    expect(byColour('#c9a84c', true), 'no gold series draws point markers').toBeUndefined()
    const gold = byColour('#c9a84c', false)
    expect(gold, 'the gold dot series').toBeTruthy()
    expect(gold.__options).toMatchObject({ lineWidth: 0, pointMarkersVisible: false, lineVisible: false })
    // both gold glyph hosts (before-price and red-day) are point-marker-free
    for (const s of fake.seriesCreated.filter((x) => x.__options.color === '#c9a84c')) {
      expect(s.__options.pointMarkersVisible).toBe(false)
    }
    const mine = glyphs.filter((g) => g.series === gold)
    expect(mine.length).toBe(1)
    expect(mine[0].markers).toEqual([{ time: BARS[4].t, position: 'inBar', shape: 'circle', color: '#c9a84c', size: 1.6 }])
  })

  it('⭐ a Stress-shaped instance (dotSize large on dotNHred) hands the glyph lane size 2.24 (1.6 × 1.4), and ONLY that glyph', () => {
    const { glyphs } = drive({ showRedDay: true }, { plots: { dotNHred: { dotSize: 'large' } } })
    const all = glyphs.flatMap((g) => g.markers)
    expect(all.filter((mk) => mk.time === BARS[6].t).map((mk) => mk.size)).toEqual([expect.closeTo(2.24, 10)])
    // the before-price glyph is not named by Stress's dotSize: declared 1.6
    expect(all.filter((mk) => mk.time === BARS[4].t).map((mk) => mk.size)).toEqual([1.6])
    // and an instance-level word reaches BOTH glyphs
    const both = drive({ showRedDay: true }, { dotSize: 'small' }).glyphs.flatMap((g) => g.markers)
    expect(both.length).toBe(2)
    for (const mk of both) expect(mk.size).toBeCloseTo(0.96)
  })

  it('dotNHred (visual round A3): ONE text-free glyph on its event bar, the info blue by default, gold under Stress', () => {
    const { glyphs } = drive({ showRedDay: true })
    const all = glyphs.flatMap((g) => g.markers)
    const red = all.filter((mk) => mk.time === BARS[6].t)
    expect(red).toEqual([{ time: BARS[6].t, position: 'inBar', shape: 'circle', color: IND_TOKENS.classic.info, size: 1.6 }])
    // ⛔ no glyph carries text: platform §7 keeps text off the canvas
    expect(all.some((mk) => 'text' in mk)).toBe(false)
    // the default is the info blue (never the bear red: plan §3, red is for losses)…
    expect(rs.inputs.find((i) => i.key === 'dotRedColor').default).toBe(IND_TOKENS.classic.info)
    // …and the Stress preset makes it the preset's one gold mark
    const stress = rs.meta.presets.find((p) => p.id === 'stress')
    const gold = drive(stress.inputs).glyphs.flatMap((g) => g.markers)
    expect(gold.filter((mk) => mk.time === BARS[6].t)).toEqual([{ time: BARS[6].t, position: 'inBar', shape: 'circle', color: IND_TOKENS.classic.premium, size: 1.6 }])
  })

  it('dotMansfieldCross (2a-14): a point of its own series at a NEGATIVE Mansfield value — a glyph could not draw it', () => {
    const { glyphs, dataOf, byColour } = drive({ showMansfield: true })
    const dot = byColour(IND_TOKENS.classic.neutral, true)
    expect(dot, 'the neutral cross-dot series').toBeTruthy()
    const points = dataOf(dot)
    expect(points.map((p) => ('value' in p ? p.value : null))).toEqual([null, null, null, -0.4, null, null, null, null])
    expect(glyphs.some((g) => g.series === dot), 'a plain dot never reaches createSeriesMarkers').toBe(false)
    // the Mansfield line itself draws as a line in the info blue
    const line = byColour(IND_TOKENS.classic.info, false)
    expect(line).toBeTruthy()
  })

  it('the RS line itself keeps its line: width 1, visible, no point markers', () => {
    const { byColour } = drive()
    const line = byColour('#6ba3be', false)
    expect(line).toBeTruthy()
    expect(line.__options).toMatchObject({ lineWidth: 1, lineVisible: true, pointMarkersVisible: false })
  })

  it('a member\'s dot colour reaches the point series; the Phase preset\'s neutral too', () => {
    const { byColour } = drive({ dotColor: '#123456' })
    expect(byColour('#123456', true)).toBeTruthy()
    const phase = rs.meta.presets.find((p) => p.id === 'phase')
    const { byColour: phaseBy } = drive(phase.inputs)
    expect(phaseBy(phase.inputs.dotColor, true)).toBeTruthy()
  })
})

// ─── 7. the palette budget (review finding F6, folded in here; grown at 2a-14) ──
//
// ⭐ COUNTED OVER THE PLOTS A PRESET DRAWS, not over every colour input. The
// engine has no per-plot visibility, so a toggle that is OFF means the server
// sends a blank column and the plot paints nothing (`_RS_TOGGLE_BLANKS` in
// `api/routers/signature.py`); a hue on a plot nobody sees is not on the chart.
// `TOGGLE_OF` is that server table restated here, so a new dot plot without a
// toggle (or with one this table does not know) is counted as ALWAYS drawn —
// the conservative direction for a budget.

describe('the hue budget per preset — ≤ 2 non-neutral hues + the neutral over the plots a preset DRAWS; Phase ≤ 3 (its documented exception)', () => {
  const NEUTRAL = IND_TOKENS.classic.neutral
  const colourInputs = rs.inputs.filter((i) => i.type === 'color')
  const defaults = Object.fromEntries(rs.inputs.map((i) => [i.key, i.default]))
  const TOGGLE_OF = Object.freeze({
    dotNH: 'showNewHigh', dotNHbeforePx: 'showNewHighBeforePrice', dotNHpartial: 'shortHistoryDots',
    dotNHred: 'showRedDay', dotNL: 'showNewLow',
    // design round (2026-11-08): the client-derived cross triangles, absent while
    // their switch is off (`plots[].derive.activeWhen`, `derivedColumns.js`)
    dotCrossUp: 'showCrossMarkers', dotCrossDown: 'showCrossMarkers',
  })
  // ⭐ v4 (unit 3-08): THE READING decides which family draws. The server keeps
  // the chosen view's family and blanks every other one
  // (`rs_provider._RS_VIEW_FAMILIES`, restated here); the legacy `showMansfield:
  // true` reads as the Mansfield view while `view` is ratio (`_rs_view`). A guide
  // draws when its own `activeWhen` holds (the client's evaluator, on the stored
  // `view`).
  const VIEW_FAMILIES = Object.freeze({
    // + the cross triangles: they ride `rsLine`, so its blanking is theirs (design round)
    ratio: ['rsLine', 'rsMa', 'rsAbove', 'dotNH', 'dotNHbeforePx', 'dotNHred', 'dotNHpartial', 'dotNL', 'dotCrossUp', 'dotCrossDown'],
    mansfield: ['mansfield', 'dotMansfieldCross'],
    rotation: ['rsRatio', 'rsMomentum'],
    quality: ['clenowScore', 'dotClenowGap'],
    vars: ['vars', 'varsMa'],
    // rev 5 (Deepvue round 2): the RS Rating Reading
    rating: ['ratingLine', 'ratingMa'],
  })
  const viewOf = (inputs) => (inputs.view === 'ratio' && inputs.showMansfield === true ? 'mansfield' : inputs.view)
  const blankedBy = (inputs) => new Set(Object.entries(VIEW_FAMILIES)
    .filter(([v]) => v !== viewOf(inputs)).flatMap(([, keys]) => keys))
  const drawn = (inputs) => rs.plots.filter((p) => !p.hidden
    && (TOGGLE_OF[p.key] === undefined || inputs[TOGGLE_OF[p.key]] === true)
    && !blankedBy(inputs).has(p.key)
    && !(p.activeWhen && inputs[p.activeWhen.key] !== p.activeWhen.equals))
  /** The non-neutral hues on the plots a preset draws, each plot's colour fields
   *  read through its `$refs` (the member's inputs) exactly as the pool resolves them. */
  const huesOf = (presetInputs) => {
    const inputs = { ...defaults, ...presetInputs }
    const hues = new Set()
    for (const plot of drawn(inputs)) {
      for (const field of ['color', 'colorUp', 'colorDown']) {
        const ref = plot.$refs && plot.$refs[field]
        const hex = ref ? inputs[ref] : plot[field]
        if (typeof hex === 'string' && hex.toLowerCase() !== NEUTRAL) hues.add(hex.toLowerCase())
      }
      // design round (2026-11-08): a band the plot owns paints its two colours while
      // its own switch holds (`plots[].fill.activeWhen`)
      const aw = plot.fill && plot.fill.activeWhen
      if (aw && inputs[aw.key] === aw.equals) {
        for (const f of ['colorUp', 'colorDown']) {
          const hex = plot.fill[f]
          if (typeof hex === 'string' && hex.toLowerCase() !== NEUTRAL) hues.add(hex.toLowerCase())
        }
      }
    }
    return hues
  }
  const preset = (id) => rs.meta.presets.find((p) => p.id === id).inputs
  const TWO = [IND_TOKENS.classic.info, IND_TOKENS.classic.premium].sort()

  it('the colour inputs are the ten the dialog shows, every default a Classic token role, and the neutral is the token', () => {
    // In declaration order, which follows the VA2 groups (Line, New highs, Stress
    // test, Method); v4 adds no colour input (the Phase 3 plots draw the info blue
    // and the neutral as declared).
    expect(colourInputs.map((i) => i.key)).toEqual(['color', 'lineDownColor', 'maColor',
      'dotColor', 'dotBeforePriceColor', 'dotPartialColor', 'dotLowColor', 'dotRedColor', 'mansfieldColor', 'dotCrossColor'])
    expect(NEUTRAL).toBe('#8a8574')
    const roles = new Set(Object.values(IND_TOKENS.classic).map((h) => String(h).toLowerCase()))
    for (const i of colourInputs) expect(roles.has(String(i.default).toLowerCase()), `${i.key} default ${i.default}`).toBe(true)
    // every toggle the table names is a declared bool input
    for (const key of new Set(Object.values(TOGGLE_OF))) {
      expect(rs.inputs.find((i) => i.key === key && i.type === 'bool'), key).toBeTruthy()
    }
  })

  it('Classic (and Classic weekly): info blue + the premium gold, nothing else; Mansfield, red-day and new-low dots are OFF', () => {
    for (const id of ['classic', 'classicWeekly']) {
      const hues = huesOf(preset(id))
      expect(hues.size, id).toBeLessThanOrEqual(2)
      expect([...hues].sort(), id).toEqual(TWO)
      expect(drawn({ ...defaults, ...preset(id) }).map((p) => p.key), id)
        .toEqual(['rsLine', 'rsMa', 'dotNH', 'dotNHbeforePx', 'dotNHpartial'])
      expect(preset(id), id).toMatchObject({ showNewHighBeforePrice: true, dotRedColor: IND_TOKENS.classic.info })
    }
  })

  it('Phase: bull, bear and the gold — three, with the plain dots dropped to the neutral', () => {
    const hues = huesOf(preset('phase'))
    expect(hues.size).toBeLessThanOrEqual(3)
    expect([...hues].sort()).toEqual([IND_TOKENS.classic.bull, IND_TOKENS.classic.bear, IND_TOKENS.classic.premium].sort())
    expect(preset('phase').dotColor).toBe(NEUTRAL)
    // design round (2026-11-08): Phase sets neither the band nor the cross triangles
    // (owner decision), so it draws what it drew before the round…
    expect(preset('phase')).not.toHaveProperty('shadeVsAverage')
    expect(preset('phase')).not.toHaveProperty('showCrossMarkers')
    expect(drawn({ ...defaults, ...preset('phase') }).map((p) => p.key))
      .toEqual(['rsLine', 'rsMa', 'dotNH', 'dotNHbeforePx', 'dotNHpartial'])
    // …and a member who turns both on over Phase adds no hue: they take the line's own bull and bear
    const tuned = { ...preset('phase'), shadeVsAverage: true, showCrossMarkers: true }
    expect(drawn({ ...defaults, ...tuned }).map((p) => p.key))
      .toEqual(['rsLine', 'rsMa', 'dotNH', 'dotCrossUp', 'dotCrossDown', 'dotNHbeforePx', 'dotNHpartial'])
    expect([...huesOf(tuned)].sort()).toEqual([...hues].sort())
  })

  it('design round: Classic with the band switched on is the member\'s choice of the bull and bear tint; with the triangles on, still one blue', () => {
    const markers = huesOf({ ...preset('classic'), showCrossMarkers: true })
    expect([...markers].sort()).toEqual(TWO)
    const shaded = huesOf({ ...preset('classic'), shadeVsAverage: true })
    expect([...shaded].sort()).toEqual([...TWO, IND_TOKENS.classic.bull, IND_TOKENS.classic.bear].sort())
  })

  it('Trend (and Trend weekly): Mansfield view — the Mansfield line, its cross-up dots and the zero line alone, info blue plus the neutral, no gold', () => {
    for (const id of ['trend', 'trendWeekly']) {
      expect([...huesOf(preset(id))].sort(), id).toEqual([IND_TOKENS.classic.info])
      expect(preset(id), id).toMatchObject({ showMansfield: true, mansfieldColor: IND_TOKENS.classic.info,
        dotCrossColor: IND_TOKENS.classic.info, showRedDay: false, showNewLow: false })
      const keys = drawn({ ...defaults, ...preset(id) }).map((p) => p.key)
      expect(keys, id).toEqual(['mansfield', 'mansfieldZero', 'dotMansfieldCross'])
    }
    expect(preset('trend').mansfieldLength).toBe(200)
    expect(preset('trendWeekly').mansfieldLength).toBe(52)
    expect(preset('trendWeekly').lookback).toBe(52)
  })

  it('Stress: info blue on the line and the plain dots, gold on the red-day glyph ALONE — two hues (red is for losses and errors, plan §3)', () => {
    expect([...huesOf(preset('stress'))].sort()).toEqual(TWO)
    const keys = drawn({ ...defaults, ...preset('stress') }).map((p) => p.key)
    expect(keys).toEqual(['rsLine', 'rsMa', 'dotNH', 'dotNHred', 'dotNHpartial'])
    expect(defaults.dotRedColor).toBe(IND_TOKENS.classic.info)
    expect(preset('stress')).toMatchObject({ showRedDay: true, showNewHighBeforePrice: false, showMansfield: false,
      dotRedColor: IND_TOKENS.classic.premium })
  })

  it('Custom (Classic plus red-day highs): large gold before price and large BLUE red day — still two hues', () => {
    const custom = { ...preset('classic'), showRedDay: true }
    expect([...huesOf(custom)].sort()).toEqual(TWO)
    expect(drawn({ ...defaults, ...custom }).map((p) => p.key)).toEqual(['rsLine', 'rsMa', 'dotNH', 'dotNHred', 'dotNHbeforePx', 'dotNHpartial'])
  })

  it('the untouched definition (no preset) is Classic', () => {
    expect([...huesOf({})].sort()).toEqual(TWO)
  })

  it('v4 — Rotation, Quality and Volatility-adjusted: info blue plus the neutral each, NO gold, and each draws its own family alone', () => {
    const INFO = [IND_TOKENS.classic.info]
    const want = {
      rotation: ['rsRatio', 'rsMomentum', 'rotationCentre'],
      rotationWeekly: ['rsRatio', 'rsMomentum', 'rotationCentre'],
      quality: ['clenowScore', 'dotClenowGap'],
      volAdjusted: ['vars', 'varsMa', 'varsZero'],
    }
    for (const [id, keys] of Object.entries(want)) {
      const inputs = { ...defaults, ...preset(id) }
      expect([...huesOf(preset(id))].sort(), id).toEqual(INFO)
      expect(huesOf(preset(id)).has(IND_TOKENS.classic.premium), `${id} draws no gold`).toBe(false)
      expect(drawn(inputs).map((p) => p.key), id).toEqual(keys)
    }
    // the neutral carries the second line of each pair and every guide
    for (const k of ['rsMomentum', 'rotationCentre', 'varsMa', 'varsZero', 'dotClenowGap']) {
      expect(rs.plots.find((p) => p.key === k).color.toLowerCase(), k).toBe(NEUTRAL)
    }
  })

  it('rev 5 — the RS Rating Reading: info blue plus the neutral, NO gold, its line, average and guides alone', () => {
    const inputs = { ...defaults, view: 'rating' }
    expect([...huesOf({ view: 'rating' })].sort()).toEqual([IND_TOKENS.classic.info])
    expect(drawn(inputs).map((p) => p.key)).toEqual(['ratingLine', 'ratingMa', 'ratingGuides'])
    for (const k of ['ratingMa', 'ratingGuides']) {
      expect(rs.plots.find((p) => p.key === k).color.toLowerCase(), k).toBe(NEUTRAL)
    }
  })

  it('v4 — a saved Trend layout (showMansfield on, no Reading stored) still draws the Mansfield family alone on a v4 server', () => {
    const saved = { maLength: 21, maType: 'EMA', lookback: 252, showMansfield: true, mansfieldLength: 200,
      mansfieldColor: IND_TOKENS.classic.info, dotCrossColor: IND_TOKENS.classic.info, showRedDay: false, showNewLow: false }
    const keys = drawn({ ...defaults, ...saved }).map((p) => p.key)
    // the server draws the Mansfield line and its dots; the zero guide reads the
    // stored Reading (ratio), so it is the one thing a saved Trend layout loses
    // until Trend is applied again (unit 3-08 report)
    expect(keys).toEqual(['mansfield', 'dotMansfieldCross'])
    expect([...huesOf(saved)].sort()).toEqual([IND_TOKENS.classic.info])
  })

  it('⛔ CONTROL: a bear red-day dot is a hue the counter sees under Stress — by plot, not by input', () => {
    const bear = huesOf({ ...preset('stress'), dotRedColor: IND_TOKENS.classic.bear })
    expect(bear.has(IND_TOKENS.classic.bear)).toBe(true)
    expect([...bear].sort()).not.toEqual(TWO)
    // and a third hue once before-price is back on beside it
    expect(huesOf({ ...preset('stress'), showNewHighBeforePrice: true, dotRedColor: IND_TOKENS.classic.bear }).size).toBe(3)
    // …and the same recolour under Classic, where the dot is OFF, changes nothing on the chart
    expect([...huesOf({ ...preset('classic'), dotRedColor: IND_TOKENS.classic.bear })].sort()).toEqual(TWO)
  })
})
