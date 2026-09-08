// app/src/components/chart/builder/vendorMarkerParity.test.js
//
// ─── ⭐⭐ THE FIRST VENDOR OBSERVATION OF *VISUAL* SEMANTICS THIS REPO HOLDS ───
//
// Every other vendor fixture here is a NUMBER — `sma`, `rma`, `adx`. Not one of
// them can tell you whether a marker lands on the right BAR, on the right SIDE
// of it, carrying the right glyph, in the right colour. C3A shipped the marker
// lane against Pine's published semantics, which this repo grades `spec` tier —
// explicitly BELOW `confirmed`, because nobody had read the vendor's own answer.
//
// This file reads it.
//
// ⭐ THE OBSERVATION CARRIES THE VENDOR'S OWN BARS, which is the whole design of
// `tests/fixtures/vendor/` — our column is computed over TradingView's OHLCV, so
// a delta here CANNOT be a data delta. It is a semantics delta, and it is
// actionable the moment it appears.
//
// ⛔ AND IT DISCRIMINATES AN OFF-BY-ONE. The control at the bottom shifts our
// own column by one bar and asserts the comparison goes RED — without it this
// file could pass because both sides are empty, or because the assertion looks
// at something that cannot disagree.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from '../engine/ast/pine'
import { memberInputTranslation } from './builderInputs'
import { interpret } from '../engine/ast/interpret'

const OBS = JSON.parse(fs.readFileSync(path.resolve(process.cwd(),
  '../tests/fixtures/vendor/visual/marker-semantics-spy-1d-2026-09-07.json'), 'utf8'))

/** The vendor's own bars, in the shape our interpreter eats. */
const BARS = OBS.market.bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))

/** ⛔ THE WINDOW OUR ENGINE CAN ANSWER FOR. `sma(close, 20)` is undefined for
 *  the first 19 bars of the slice and `crossover` needs one more, so bars
 *  0..19 are OURS-UNKNOWN, not OURS-DISAGREEING. Comparing there would report a
 *  warmup as a divergence — the exact kind of false finding this directory is
 *  built to avoid. The vendor computed its MA20 from bars we do not hold. */
const WARMUP = 20
const COMPARABLE = BARS.slice(WARMUP).map((b) => b.t)

const T = memberInputTranslation(translatePine, OBS.script.source, { paramManifest: true })
const outputs = T.outputs || []
const byTitle = (title) => outputs.find((o) => o && o.title === title)

/** `markerPrimitive.markersFor`'s own predicate, restated so this file compares
 *  what the RENDERER would draw, not what the column happens to hold. */
const marks = (v) => Number.isFinite(v) && v > 0

const columnOf = (title) => {
  const out = byTitle(title)
  expect(out, `translator produced no output titled ${title}`).toBeTruthy()
  return Array.from(interpret(out.ast, BARS, {}))
}

const markedTimes = (title) => {
  const col = columnOf(title)
  return BARS
    .map((b, i) => (i >= WARMUP && marks(col[i]) ? b.t : null))
    .filter((t) => t !== null)
}

const vendorMarked = (title) =>
  OBS.vendor.markedBars[title].filter((t) => COMPARABLE.includes(t))

describe('TradingView vendor observation — marker semantics on the vendor own bars', () => {
  it('the observation is what it claims to be: real bars, a real window, real provenance', () => {
    expect(OBS.market.symbol).toBe('AMEX:SPY')
    expect(BARS.length).toBe(50)
    expect(OBS.provenance.chartUrl).toMatch(/tradingview\.com\/chart\//)
    // ⛔ A fixture whose comparable window holds no marker proves nothing.
    expect(vendorMarked('UP').length).toBeGreaterThanOrEqual(3)
    expect(vendorMarked('DN').length).toBeGreaterThanOrEqual(3)
  })

  it('⭐⭐ DISCRIMINATION A — our markers land on the vendor own event bars, not one early or one late', () => {
    expect(markedTimes('UP')).toEqual(vendorMarked('UP'))
    expect(markedTimes('DN')).toEqual(vendorMarked('DN'))
  })

  it('⭐ and the value a location.absolute marker sits at is the vendor own MA20', () => {
    const col = columnOf('ABS')
    const seen = []
    BARS.forEach((b, i) => {
      if (i < WARMUP || !marks(col[i])) return
      seen.push(b.t)
      // readDecimals 4 → the vendor's recorded precision, and nothing looser.
      expect(col[i]).toBeCloseTo(OBS.vendor.absoluteValues[String(b.t)], 4)
    })
    expect(seen).toEqual(vendorMarked('ABS'))
  })

  it('⭐ our MA20 equals the vendor MA20 on every comparable bar', () => {
    const col = columnOf('MA20')
    BARS.forEach((b, i) => {
      if (i < WARMUP - 1) return
      expect(col[i]).toBeCloseTo(OBS.vendor.ma20[String(b.t)], 4)
    })
  })

  it('⭐⭐ DISCRIMINATION B — above / below / at-value are three different answers, and ours match', () => {
    expect(byTitle('UP').presentation.marker.position).toBe('belowBar')
    expect(byTitle('DN').presentation.marker.position).toBe('aboveBar')
    expect(byTitle('CH').presentation.marker.position).toBe('aboveBar')
    // `location.absolute` → the marker sits at the series' own value.
    expect(byTitle('ABS').presentation.marker.position).toBe('inBar')
    // …and the vendor said the same, in its own words.
    expect(OBS.vendor.plotStyles.UP.location).toBe('BelowBar')
    expect(OBS.vendor.plotStyles.DN.location).toBe('AboveBar')
    expect(OBS.vendor.plotStyles.CH.location).toBe('AboveBar')
    expect(OBS.vendor.plotStyles.ABS.location).toBe('Absolute')
  })

  it('⭐⭐ DISCRIMINATION D — the glyph text and the size the author asked for survive', () => {
    expect(byTitle('UP').presentation.marker.text).toBe(OBS.vendor.plotStyles.UP.text)
    expect(byTitle('DN').presentation.marker.text).toBe(OBS.vendor.plotStyles.DN.text)
    expect(byTitle('CH').presentation.marker.text).toBe(OBS.vendor.plotStyles.CH.char)
    // `size.small` is a real reduction, not a rounding to default.
    expect(byTitle('UP').presentation.marker.size).toBeLessThan(1)
    expect(byTitle('DN').presentation.marker.size).toBeLessThan(1)
    expect(OBS.vendor.plotStyles.UP.size).toBe('small')
  })

  it('⛔ AND THE SHAPE APPROXIMATIONS ARE DECLARED, not quietly claimed as exact', () => {
    // The vendor draws a TRIANGLE; lightweight-charts has four shapes and no
    // triangle, so we draw the arrow that points the same way and SAY SO.
    expect(OBS.vendor.plotStyles.UP.plottype).toBe('shape_triangle_up')
    expect(byTitle('UP').presentation.marker.shape).toBe('arrowUp')
    expect(byTitle('UP').presentation.marker.shapeApprox).toBe(true)
    expect(OBS.vendor.plotStyles.DN.plottype).toBe('shape_triangle_down')
    expect(byTitle('DN').presentation.marker.shape).toBe('arrowDown')
    expect(byTitle('DN').presentation.marker.shapeApprox).toBe(true)
    // A circle IS a circle — an EXACT row, so the matrix is not uniformly "approx".
    expect(OBS.vendor.plotStyles.ABS.plottype).toBe('shape_circle')
    expect(byTitle('ABS').presentation.marker.shape).toBe('circle')
    expect(byTitle('ABS').presentation.marker.shapeApprox).toBeUndefined()
  })

  it('⭐⭐ DISCRIMINATION C — the vendor colours a conditional marker PER BAR, and says how', () => {
    // TradingView compiles `color = up ? color.aqua : color.fuchsia` into a
    // SEPARATE `colorer` plot targeting the shape plot, carrying one palette
    // index per bar. That is the vendor's own structural answer to "is the
    // colour per-bar or per-series": per bar.
    const c = OBS.vendor.plotStyles.DYN.colorer
    expect(c.target).toBe('plot_7')
    expect(Object.keys(c.colors).sort()).toEqual(['0', '1'])
    // aqua on the up-crossover bar, fuchsia on the down-crossunder bar — the
    // SAME plot, two colours, decided by each bar's own condition.
    const upT = vendorMarked('UP').filter((t) => String(t) in OBS.vendor.dynPaletteIndex)
    const dnT = vendorMarked('DN').filter((t) => String(t) in OBS.vendor.dynPaletteIndex)
    expect(upT.length).toBeGreaterThan(0)
    expect(dnT.length).toBeGreaterThan(0)
    for (const t of upT) expect(c.colors[String(OBS.vendor.dynPaletteIndex[String(t)])]).toBe('#00BCD4')
    for (const t of dnT) expect(c.colors[String(OBS.vendor.dynPaletteIndex[String(t)])]).toBe('#E040FB')
    // …and the bars our engine marks for DYN are the vendor's own DYN bars.
    const first = OBS.vendor.markedBars.DYN[0]
    const ours = markedTimes('DYN').filter((t) => t >= first)
    expect(ours).toEqual(OBS.vendor.markedBars.DYN.filter((t) => COMPARABLE.includes(t)))
  })

  it('⚰️⭐⭐ THE VENDOR OWNS THE HEXES — and this is where `color.red` was caught', () => {
    // `pine.js`'s colour table has said "THESE ARE THE VENDOR'S HEX VALUES"
    // since it was written, and no rail could falsify it: every colour test in
    // the repo asserted OUR constant, so a wrong hex was the expected hex
    // everywhere. This observation is the first thing able to disagree — and it
    // did, on exactly one of the seven colours it reaches.
    const eq = (ours, vendor) => expect(String(ours).toUpperCase()).toBe(String(vendor).toUpperCase())
    const V = OBS.vendor.plotStyles
    eq(byTitle('MA20').presentation.color, V.MA20.color)   // color.blue
    eq(byTitle('UP').presentation.color, V.UP.color)       // color.green
    eq(byTitle('DN').presentation.color, V.DN.color)       // ⚰️ color.red — was #F23645, the chart's down-candle red
    eq(byTitle('ABS').presentation.color, V.ABS.color)     // color.orange
    eq(byTitle('CH').presentation.color, V.CH.color)       // color.purple
    eq(byTitle('DYN').presentation.colorUp, V.DYN.colorer.colors['0'])   // color.aqua
    eq(byTitle('DYN').presentation.colorDown, V.DYN.colorer.colors['1']) // color.fuchsia
    // ⛔ AND THE CONDITION TRAVELS WITH THEM. Two hexes without the rule that
    // picks between them is a marker that cannot be coloured per bar, which is
    // the very thing discrimination C asks about.
    expect(byTitle('DYN').presentation.colorCondition.formula)
      .toBe('crossOver(close, sma(close, 20))')
  })

  it('⛔ CONTROL — a one-bar shift in our column FAILS this comparison', () => {
    const col = columnOf('UP')
    const shifted = [0].concat(col.slice(0, -1))
    const shiftedTimes = BARS
      .map((b, i) => (i >= WARMUP && marks(shifted[i]) ? b.t : null))
      .filter((t) => t !== null)
    expect(shiftedTimes).not.toEqual(vendorMarked('UP'))
    // …and it is a shift, not a wipeout: the same COUNT, different bars.
    expect(shiftedTimes.length).toBe(vendorMarked('UP').length)
  })
})
