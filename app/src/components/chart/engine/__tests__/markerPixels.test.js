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
// keeps the gold before-price dot as a glyph at size 2.0, which the floor can only
// make LARGER. This file MIRRORS LWC's arithmetic from the installed source
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
import { getDefinition } from '../nativeRegistry'
import { seriesOptionsForPlot } from '../pool'
import { presentedPlot, DOT_SIZES } from '../presentation'
import { markersFor } from '../markerPrimitive'
import { createBinder } from '../binder'
import { IND_TOKENS } from '../../designTokens'
import { createFakeChart } from './fakeChart'

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

describe('the two small dots are the series\' own point markers — radius 2, no floor', () => {
  for (const key of ['dotNH', 'dotNHpartial']) {
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

describe('the gold before-price dot is a glyph at size 2.0 — the floor can only make it larger', () => {
  it('is the circle glyph, inBar, size 2.0', () => {
    const p = plot('dotNHbeforePx')
    expect(p.style).toBe('markers')
    expect(p.marker).toEqual({ shape: 'circle', position: 'inBar', size: 2.0 })
  })

  it('15 px at the floor (bar spacing ≤ 12), 23 px from bar spacing 15 — the table', () => {
    const table = Object.fromEntries(BAR_SPACINGS.map((bs) => [bs, glyphCircleSize(2.0, bs)]))
    expect(table).toEqual({ 4: 15, 6: 15, 8: 15, 12: 15, 15: 23, 20: 23, 30: 23 })
  })

  it('markersFor hands LWC exactly that spec; a plain plot never reaches the glyph layer', () => {
    const times = [1, 2, 3]
    const gold = markersFor({ column: [NaN, 1.3, NaN], times, marker: plot('dotNHbeforePx').marker, color: '#c9a84c' })
    expect(gold).toEqual([{ time: 2, position: 'inBar', shape: 'circle', color: '#c9a84c', size: 2 }])
    expect(markersFor({ column: [1.2, 1.3, 1.4], times, marker: plot('dotNH').marker, color: '#6ba3be' })).toEqual([])
  })
})

// ─── 4. small < large, at every bar spacing ─────────────────────────────────

describe('⭐ small < large at bar spacings 4, 6, 8, 12, 15, 20, 30', () => {
  const small = seriesOptionsForPlot(plot('dotNH'), { scaleId: 'rsLine' }).pointMarkersRadius
  const partial = seriesOptionsForPlot(plot('dotNHpartial'), { scaleId: 'rsLine' }).pointMarkersRadius
  const gold = plot('dotNHbeforePx').marker.size

  for (const bs of BAR_SPACINGS) {
    it(`bar spacing ${bs}: 4 px small dot, ${glyphDiameterPx(gold, bs)} px gold disc (≥ 3.5×)`, () => {
      const smallPx = pointDiameterPx(small)
      const goldPx = glyphDiameterPx(gold, bs)
      expect(pointDiameterPx(partial)).toBe(smallPx)
      expect(smallPx).toBeLessThan(goldPx)
      expect(goldPx / smallPx).toBeGreaterThanOrEqual(3.5)
      // The gold disc is never smaller than the 9 px the old dots drew, at any zoom.
      expect(goldPx).toBeGreaterThanOrEqual(14)
    })
  }

  it('…and a member\'s Dot size keeps the order: even Large (radius 4 → 8 px) sits under the gold 14 px floor', () => {
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

// ─── 6. the binder draws the plain dot ON the RS value, only on event bars ──

describe('⭐⭐ the real binder: a plain dot is a point of the series at the RS value, and the gold dot is a glyph above it', () => {
  const BARS = Array.from({ length: 8 }, (_, i) => ({ t: 1700000000 + i * 86400, c: 10 + i }))
  const rsLine = [1, 1.1, 1.2, 1.15, 1.3, 1.25, 1.4, 1.35]
  const COLUMNS = {
    rsLine,
    rsAbove: [1, 1, 1, 0, 1, 0, 1, 0],
    rsMa: [1, 1.05, 1.1, 1.12, 1.16, 1.18, 1.22, 1.25],
    dotNH: [NaN, NaN, 1.2, NaN, 1.3, NaN, 1.4, NaN],
    dotNHbeforePx: [NaN, NaN, NaN, NaN, 1.3, NaN, NaN, NaN],
    dotNHpartial: [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN],
  }

  function drive(inputs = {}) {
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
      instances: [{ instanceId: 'inst:rsLine:1', defId: 'rsLine', inputs }],
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

  it('dotNHbeforePx: ONE glyph, inBar, size 2, on the event bar — above the series that holds the same value', () => {
    const { glyphs, byColour } = drive()
    const gold = byColour('#c9a84c', true)
    expect(gold, 'the gold dot series').toBeTruthy()
    const mine = glyphs.filter((g) => g.series === gold)
    expect(mine.length).toBe(1)
    expect(mine[0].markers).toEqual([{ time: BARS[4].t, position: 'inBar', shape: 'circle', color: '#c9a84c', size: 2 }])
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

// ─── 7. the palette budget (review finding F6, folded in here) ──────────────

describe('the hue budget per preset — Classic ≤ 2 non-neutral hues, Phase ≤ 3 (its documented exception)', () => {
  const NEUTRAL = IND_TOKENS.classic.neutral
  const colourInputs = rs.inputs.filter((i) => i.type === 'color')
  const huesOf = (presetInputs) => new Set(
    colourInputs.map((i) => String(presetInputs[i.key] !== undefined ? presetInputs[i.key] : i.default).toLowerCase())
      .filter((h) => h !== NEUTRAL),
  )
  const preset = (id) => rs.meta.presets.find((p) => p.id === id).inputs

  it('the colour inputs are the six the dialog shows, and the neutral is the token', () => {
    expect(colourInputs.map((i) => i.key)).toEqual(['color', 'lineDownColor', 'maColor', 'dotColor', 'dotBeforePriceColor', 'dotPartialColor'])
    expect(NEUTRAL).toBe('#8a8574')
  })

  it('Classic (and Classic weekly): info blue + the premium gold, nothing else', () => {
    for (const id of ['classic', 'classicWeekly']) {
      const hues = huesOf(preset(id))
      expect(hues.size, id).toBeLessThanOrEqual(2)
      expect([...hues].sort(), id).toEqual([IND_TOKENS.classic.info, IND_TOKENS.classic.premium].sort())
    }
  })

  it('Phase: bull, bear and the gold — three, with the plain dots dropped to the neutral', () => {
    const hues = huesOf(preset('phase'))
    expect(hues.size).toBeLessThanOrEqual(3)
    expect([...hues].sort()).toEqual([IND_TOKENS.classic.bull, IND_TOKENS.classic.bear, IND_TOKENS.classic.premium].sort())
    expect(preset('phase').dotColor).toBe(NEUTRAL)
  })

  it('the untouched definition (no preset) is Classic', () => {
    expect([...huesOf({})].sort()).toEqual([IND_TOKENS.classic.info, IND_TOKENS.classic.premium].sort())
  })
})
