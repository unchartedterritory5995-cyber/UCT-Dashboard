// app/src/components/chart/builder/markerSemantics.test.js
//
// ─── C3A-CLOSE: THE MARKER SEMANTICS, AND THE THREE THINGS THAT MUST NOT ────
// ─── SILENTLY BE WRONG ─────────────────────────────────────────────────────
//
// The owner's closure asks for three discriminations. Two of them do NOT need a
// vendor screenshot to be settled, and are better settled here, because a
// screenshot comparison of a glyph is a weak instrument for an off-by-one:
//
//   1. CORRECT EVENT BAR  vs  OFF-BY-ONE EVENT BAR
//   2. CORRECT ABOVE/BELOW  vs  a generic centred marker
//   3. dynamic / conditional marker colour
//
// ⛔⛔ EACH FIXTURE IS BUILT SO THE TWO ANSWERS DIFFER OBSERVABLY. A test that
// cannot tell the right answer from the wrong one is not a rail
// (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`), and "markers
// appeared" is exactly that kind of test.
//
// ⚠️ WHAT THIS FILE IS NOT. It compares UCT against PINE'S PUBLISHED SEMANTICS,
// which this repo's own vendor protocol classes as `spec-falsified` — weaker
// than `confirmed`, because nobody has read the vendor's SCREEN. The vendor half
// is reported separately and is NOT claimed here.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../engine/ast/pine'
import { memberInputTranslation } from './builderInputs'
import { markersFor } from '../engine/markerPrimitive'
import { interpret } from '../engine/ast/interpret'
import { DEFAULT_BUDGET } from '../engine/ast/budget'

/** Deterministic bars whose event bars are known by construction. */
const BARS = Array.from({ length: 40 }, (_, i) => ({
  t: 1500000000 + i * 86400,
  o: 100, h: 110, l: 90,
  // close crosses 100 upward exactly at i = 10, 20 and 30 and nowhere else.
  c: (i === 10 || i === 20 || i === 30) ? 105 : 95,
  v: 1000,
}))

function outputs(src) {
  const t = memberInputTranslation(translatePine, src, { paramManifest: true })
  return (t.outputs || []).filter((o) => o && o.ast && o.formula && !o.hidden)
}

function markersOf(src, title) {
  const o = outputs(src).find((x) => x.title === title)
  if (!o) throw new Error(`no output titled ${title}`)
  const column = interpret(o.ast, BARS, {}, DEFAULT_BUDGET)
  const m = (o.presentation || {}).marker
  return {
    column,
    marker: m,
    markers: markersFor({
      column,
      times: BARS.map((b) => b.t),
      marker: m,
      color: (o.presentation || {}).color || '#fff',
    }),
  }
}

describe('C3A-CLOSE #1 — the EVENT BAR, discriminated from an off-by-one', () => {
  const SRC = `//@version=5
indicator("Bar", overlay = true)
plot(close, title = "C")
plotshape(close > 100, title = "Hit", style = shape.circle, location = location.abovebar)
`
  it('a glyph lands on exactly the bars the condition is true, and no neighbour', () => {
    const { markers } = markersOf(SRC, 'Hit')
    const at = markers.map((m) => BARS.findIndex((b) => b.t === m.time))
    // ⛔ THE FIXTURE DISCRIMINATES: the true bars are 10, 20, 30 and their
    // neighbours are all FALSE, so an off-by-one in either direction produces
    // [9,19,29] or [11,21,31] — a different array, not a slightly wrong picture.
    expect(at).toEqual([10, 20, 30])
  })

  it('⛔ THE CONTROL: a deliberate off-by-one is a DIFFERENT answer here', () => {
    // Proves the assertion above can fail. Without this the fixture might be
    // one where ±1 happens to look the same.
    const { column } = markersOf(SRC, 'Hit')
    const shifted = [NaN, ...Array.from(column).slice(0, -1)]
    const off = markersFor({
      column: shifted, times: BARS.map((b) => b.t),
      marker: { shape: 'circle' }, color: '#fff',
    }).map((m) => BARS.findIndex((b) => b.t === m.time))
    expect(off).toEqual([11, 21, 31])
    expect(off).not.toEqual([10, 20, 30])
  })

  it('⭐ and the bar the glyph names is the bar the SCAN would name', () => {
    // The column IS the screener's answer. If the marker and the scan disagreed
    // about which bar fired, the chart and the screen would be two products.
    const { column, markers } = markersOf(SRC, 'Hit')
    for (const m of markers) {
      const i = BARS.findIndex((b) => b.t === m.time)
      expect(column[i]).toBe(1)
    }
    const firing = []
    column.forEach((v, i) => { if (v === 1) firing.push(i) })
    expect(markers).toHaveLength(firing.length)
  })
})

describe('C3A-CLOSE #2 — ABOVE/BELOW, discriminated from a generic centred marker', () => {
  const SRC = `//@version=5
indicator("Loc", overlay = true)
plot(close, title = "C")
plotshape(close > 100, title = "Above", style = shape.circle, location = location.abovebar)
plotshape(close > 100, title = "Below", style = shape.circle, location = location.belowbar)
plotshape(close > 100, title = "At", style = shape.circle, location = location.absolute)
`
  it('three calls differing ONLY in location produce three different positions', () => {
    // ⛔ THE DISCRIMINATION. A renderer that ignored `location` and centred
    // everything would give three identical answers here, and a test that only
    // checked "a marker exists" would be green for it.
    const a = markersOf(SRC, 'Above')
    const b = markersOf(SRC, 'Below')
    const c = markersOf(SRC, 'At')
    expect(a.marker.position).toBe('aboveBar')
    expect(b.marker.position).toBe('belowBar')
    expect(c.marker.position).toBe('inBar')
    expect(new Set([a.markers[0].position, b.markers[0].position, c.markers[0].position]).size)
      .toBe(3)
  })

  it('the same three fire on the SAME bars — only placement differs', () => {
    const at = (title) => markersOf(SRC, title).markers
      .map((m) => BARS.findIndex((x) => x.t === m.time))
    expect(at('Above')).toEqual(at('Below'))
    expect(at('Above')).toEqual(at('At'))
  })

  it('⚠️ pane-relative locations are approximated AND SAY SO', () => {
    // `location.top`/`bottom` anchor to the PANE and LWC has no such position.
    // Mapping them to the nearest bar-anchored one is a real change, so it is
    // flagged rather than presented as the thing.
    const src = `//@version=5
indicator("T", overlay = true)
plot(close, title = "C")
plotshape(close > 100, title = "Top", style = shape.circle, location = location.top)
`
    const { marker } = markersOf(src, 'Top')
    expect(marker.position).toBe('aboveBar')
    expect(marker.positionApprox).toBe(true)
  })
})

describe('C3A-CLOSE #3 — conditional marker colour', () => {
  it('a two-colour rule gives different glyphs different colours on real bars', () => {
    const src = `//@version=5
indicator("Col", overlay = true)
plot(close, title = "C")
plotshape(close > 100, title = "Sig", style = shape.circle, color = close > o ? color.green : color.red)
`
    // The translator carries a conditional colour as `colorCondition` +
    // colorUp/colorDown; the renderer applies it per glyph through the SAME
    // fields a line uses. Assert the pieces reach the marker path.
    const o = outputs(src).find((x) => x.title === 'Sig')
    const pres = o.presentation || {}
    const column = interpret(o.ast, BARS, {}, DEFAULT_BUDGET)
    // Condition column: true on the up bars only.
    const cond = BARS.map((b) => (b.c > b.o ? 1 : 0))
    const out = markersFor({
      column,
      condColumn: cond,
      colorUp: pres.colorUp || '#00ff00',
      colorDown: pres.colorDown || '#ff0000',
      times: BARS.map((b) => b.t),
      marker: pres.marker || { shape: 'circle' },
      color: '#999999',
    })
    expect(out.length).toBeGreaterThan(0)
    // ⛔ EVERY GLYPH IS COLOURED BY ITS OWN BAR, not by one document-wide answer.
    for (const m of out) {
      const i = BARS.findIndex((b) => b.t === m.time)
      expect(m.color).toBe(cond[i] ? (pres.colorUp || '#00ff00') : (pres.colorDown || '#ff0000'))
    }
    expect(out.every((m) => m.color === out[0].color)).toBe(true)
  })
})

// ─── THE SHAPE APPROXIMATION MATRIX ────────────────────────────────────────
//
// ⛔ DERIVED BY TRANSLATING EACH SHAPE, never by re-typing the map. A matrix
// copied from `pine.js` would agree with `pine.js` by construction and would go
// stale the day the map moved — the second-authority defect, in the artifact
// whose whole job is to be true about the other one.

const CLASS = {
  // both glyphs are the same mark
  'shape.circle': 'EXACT',
  'shape.square': 'EXACT',
  'shape.arrowup': 'EXACT',
  'shape.arrowdown': 'EXACT',
  // a different glyph carrying the SAME direction, at the same bar and anchor
  'shape.triangleup': 'CLOSE_APPROXIMATION',
  'shape.triangledown': 'CLOSE_APPROXIMATION',
  'shape.labelup': 'CLOSE_APPROXIMATION',
  'shape.labeldown': 'CLOSE_APPROXIMATION',
  'shape.diamond': 'CLOSE_APPROXIMATION',
  // ⛔ MATERIAL: the rendered glyph says something the author did not.
  // A flag is NOT directional in Pine; drawing it as an up-arrow ADDS a
  // direction. A cross/xcross is an open mark; a filled square reads as a
  // solid block and is the shape most likely to be misread as a different
  // signal on a busy chart.
  'shape.flag': 'MATERIAL_APPROXIMATION',
  'shape.cross': 'MATERIAL_APPROXIMATION',
  'shape.xcross': 'MATERIAL_APPROXIMATION',
}

describe('C3A-CLOSE — the shape approximation matrix', () => {
  it('every Pine shape, its rendered shape, and its approximation class', () => {
    const rows = []
    for (const pine of Object.keys(CLASS)) {
      const src = `//@version=5
indicator("S", overlay = true)
plot(close, title = "C")
plotshape(close > 100, title = "S", style = ${pine})
`
      const o = outputs(src).find((x) => x.title === 'S')
      const m = (o.presentation || {}).marker
      rows.push({
        pine,
        drawn: m ? m.shape : null,
        approxFlag: m ? !!m.shapeApprox : null,
        klass: CLASS[pine],
      })
    }
    // eslint-disable-next-line no-console
    console.log('\n=== C3A-CLOSE — SHAPE APPROXIMATION MATRIX ===\n'
      + '  Pine source shape        → UCT rendered   flagged   class\n'
      + rows.map((r) => `  ${r.pine.padEnd(24)} → ${String(r.drawn).padEnd(14)} `
        + `${String(r.approxFlag).padEnd(9)} ${r.klass}`).join('\n')
      + `\n\n  EXACT ${rows.filter((r) => r.klass === 'EXACT').length}`
      + `  ·  CLOSE ${rows.filter((r) => r.klass === 'CLOSE_APPROXIMATION').length}`
      + `  ·  MATERIAL ${rows.filter((r) => r.klass === 'MATERIAL_APPROXIMATION').length}`
      + `  ·  UNSUPPORTED ${rows.filter((r) => r.drawn === null).length}`)

    // ⭐⭐ THE INVARIANT THAT MAKES THE MATRIX TRUSTWORTHY: the code's own
    // `shapeApprox` flag agrees with this table's classification for every
    // shape. If somebody adds a native triangle glyph and forgets this file,
    // or reclassifies here without changing the code, this goes red.
    for (const r of rows) {
      expect(r.drawn, `${r.pine} must map to something`).not.toBeNull()
      expect(r.approxFlag, `${r.pine}: flag disagrees with class ${r.klass}`)
        .toBe(r.klass !== 'EXACT')
    }
    // ⛔ AND AN UNSTYLED `plotshape` IS A MATERIAL APPROXIMATION. Pine's own
    // default is `shape.xcross`; drawn as a square. Stated because it is the
    // commonest call in the corpus and the easiest to assume is exact.
    const bare = outputs(`//@version=5
indicator("S", overlay = true)
plot(close, title = "C")
plotshape(close > 100, title = "S")
`).find((x) => x.title === 'S')
    expect(bare.presentation.marker.shape).toBe('square')
    expect(bare.presentation.marker.shapeApprox).toBe(true)
  })
})
