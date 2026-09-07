// app/src/components/chart/engine/__tests__/dynamicColourColumn.test.js
//
// ─── ⭐⭐ C1-A: A PLOT COLOURED BY A COMPUTED COLUMN ─────────────────────────
//
// Pine's commonest visual idiom, measured over the frozen 60-script corpus:
// **49 of the 60** colour a plot from an EXPRESSION rather than a literal.
//
//     up = close > ma
//     plot(close, color = up ? color.green : color.red)
//
// `colorMode: 'sign'` cannot express any of them — it colours by the sign of the
// plot's OWN value, and here the deciding quantity is a different series.
// `colorMode: 'column:<key>'` has been legal, validated and reference-checked
// since v1 and drawn by NOBODY; the schema's own note said the day a definition
// declared one, `signColorsForPlot` and `binder.toPoints` were the two places
// that had to learn it "and a test asserting per-point colours is the thing to
// write first". This is that test.
//
// ⛔ IT ASSERTS THE POINTS THE RENDERER IS HANDED, not a helper's return value.
// The failure this guards is a colour rule that resolves correctly and never
// reaches `setData` — which is indistinguishable from working, in every unit
// test that stops at the resolver.
import { describe, it, expect } from 'vitest'
import { columnColorsForPlot, signColorsForPlot } from '../pool'
import { createBinder } from '../binder'
import { createFakeChart } from './fakeChart'

const UP = '#4caf50'
const DOWN = '#f44336'

const BARS = Array.from({ length: 6 }, (_, i) => ({ t: 1700000000 + i * 60, c: 10 + i }))

/** A definition with one visible plot coloured by a hidden condition column. */
const DEF = {
  id: 'u_dyn', schemaVersion: 2, label: 'Dyn',
  inputs: [],
  plots: [
    { key: 'value', label: 'Value', style: 'line', legend: { decimals: 2 },
      colorMode: 'column:trend', colorUp: UP, colorDown: DOWN },
    // ⛔ THE CONDITION IS AN ORDINARY HIDDEN COLUMN. One evaluator, one answer —
    // see `columnColorsForPlot`'s note on why the rule is not an expression.
    { key: 'trend', label: 'Trend', style: 'line', hidden: true, legend: { decimals: 0 } },
  ],
}

/** trend: 1,1,0,0,NaN,1 → up,up,down,down,(none),up */
const COLUMNS = {
  value: [1, 2, 3, 4, 5, 6],
  trend: [1, 1, 0, 0, NaN, 1],
}

/** Drive the REAL binder over the repo's own fake chart, and hand back the data
 *  the VISIBLE plot was `setData`'d with. */
function pointsDrawn(def = DEF, columns = COLUMNS) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const registry = {
    getDefinition: (id) => (id === def.id ? def : null),
    computeFor: () => columns,
    hasAnyFinite: (col) => Array.isArray(col) && col.some(Number.isFinite),
    columnKeys: (d) => (d.plots || []).map((p) => p.key),
  }
  binder.sync({
    enabled: true,
    instances: [{ instanceId: 'inst:u_dyn:1', defId: def.id, inputs: {} }],
    registry,
    bars: BARS,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    resolvePlacement: () => ({ paneIndex: 1, scaleId: 'u_dyn', scaleOptions: {} }),
  })
  // The visible plot is bound first (declaration order); the hidden one draws
  // nothing at all, which is itself asserted below.
  const setDatas = fake.calls.filter((c) => c.method === 'setData')
  expect(setDatas.length, 'exactly one series should be drawn').toBe(1)
  return setDatas[0].args[0]
}

describe('columnColorsForPlot — the resolver', () => {
  it('resolves the column name and both colours', () => {
    expect(columnColorsForPlot(DEF.plots[0])).toEqual({ key: 'trend', up: UP, down: DOWN })
  })

  it('is null without both colours — a mode that cannot alternate', () => {
    expect(columnColorsForPlot({ colorMode: 'column:trend', colorUp: UP })).toBeNull()
    expect(columnColorsForPlot({ colorMode: 'column:trend' })).toBeNull()
  })

  it('is null for an empty column name, and for every other mode', () => {
    expect(columnColorsForPlot({ colorMode: 'column:', colorUp: UP, colorDown: DOWN })).toBeNull()
    expect(columnColorsForPlot({ colorMode: 'sign', colorUp: UP, colorDown: DOWN })).toBeNull()
    expect(columnColorsForPlot({ colorMode: 'fixed' })).toBeNull()
  })

  it('⛔ the two modes do not answer for each other', () => {
    // A single resolver serving both would let a `sign` plot silently start
    // reading a column, and vice versa.
    expect(signColorsForPlot(DEF.plots[0])).toBeNull()
    expect(columnColorsForPlot({ colorMode: 'sign', colorUp: UP, colorDown: DOWN })).toBeNull()
  })
})

describe('⭐⭐ the points handed to the renderer carry the per-point colour', () => {
  it('one colour per bar, decided by the condition column', () => {
    const points = pointsDrawn()
    expect(points.map((p) => p.color)).toEqual([UP, UP, DOWN, DOWN, undefined, UP])
    // ⛔ AND THE VALUES ARE UNTOUCHED. A colour rule that moved a number would be
    // a far worse defect than one that drew the wrong colour.
    expect(points.map((p) => p.value)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('⛔ a NON-FINITE condition leaves the point uncoloured, not "down"', () => {
    // Bar 4's condition is NaN. Painting it `down` would show the "false" colour
    // through every warmup bar of the condition's own lookback — a real signal,
    // invented. `na` means the author said nothing.
    const points = pointsDrawn()
    expect(points[4]).toEqual({ time: BARS[4].t, value: 5 })
    expect('color' in points[4]).toBe(false)
  })

  it('⛔ NON-VACUITY: flipping the condition column flips the colours', () => {
    // Without this, a harness that emitted one constant colour would pass the
    // case above by accident.
    const flipped = { value: COLUMNS.value, trend: [0, 0, 1, 1, NaN, 0] }
    const points = pointsDrawn(DEF, flipped)
    expect(points.map((p) => p.color)).toEqual([DOWN, DOWN, UP, UP, undefined, DOWN])
  })

  it('⛔ MUTATION CONTROL: a plot with no colorMode gets no per-point colours', () => {
    const plain = { ...DEF, plots: [{ ...DEF.plots[0], colorMode: undefined, colorUp: undefined, colorDown: undefined }, DEF.plots[1]] }
    const points = pointsDrawn(plain)
    expect(points.every((p) => !('color' in p))).toBe(true)
  })
})
