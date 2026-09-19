// app/src/components/chart/engine/__tests__/fillPrimitive.test.js
//
// ─── ⭐⭐ C1-B: THE GEOMETRY OF A BAND, TESTED WHERE IT CAN BE ───────────────
//
// `fill(plotA, plotB, color)` is 33 of the frozen corpus' 35 fill calls. The
// renderer is canvas code and canvas code cannot be asserted, so everything that
// can be got wrong lives in `fillRuns`/`runPolygon`/`fillPolygons` — pure
// functions over two columns — and this file is where they are held to account.
//
// ⛔ THE RULE WORTH MOST: A GAP IS NEVER BRIDGED. Two series that both go `na`
// and come back must leave a HOLE. A band drawn across missing data asserts a
// relationship the indicator never computed, and it is invisible as a bug —
// it looks exactly like a band.
import { describe, it, expect } from 'vitest'
import { fillRuns, runPolygon, fillPolygons } from '../fillPrimitive'

const N = NaN
// Trivial, invertible coordinate functions: x is the index, y is the price.
const times = [0, 1, 2, 3, 4, 5, 6, 7]
const timeToX = (t) => t
const priceToY = (p) => p

describe('fillRuns — which spans get filled', () => {
  it('one run when both columns are finite throughout', () => {
    expect(fillRuns([1, 2, 3], [0, 0, 0])).toEqual([{ from: 0, to: 2 }])
  })

  it('⛔⛔ A GAP SPLITS THE RUN — it does not bridge it', () => {
    expect(fillRuns([1, 2, N, 4, 5], [0, 0, 0, 0, 0])).toEqual([
      { from: 0, to: 1 }, { from: 3, to: 4 },
    ])
  })

  it('EITHER column missing ends the span', () => {
    // The lower edge is the one with the hole here; a fill needs both.
    expect(fillRuns([1, 2, 3, 4], [0, N, 0, 0])).toEqual([
      { from: 0, to: 0 }, { from: 2, to: 3 },
    ])
  })

  it('a leading and trailing warmup produces no run of its own', () => {
    expect(fillRuns([N, N, 3, 4, N], [N, N, 0, 0, N])).toEqual([{ from: 2, to: 3 }])
  })

  it('a single shared bar IS a run — the renderer decides what it looks like', () => {
    expect(fillRuns([N, 2, N], [N, 0, N])).toEqual([{ from: 1, to: 1 }])
  })

  it('nothing in common is no runs at all', () => {
    expect(fillRuns([1, N, 3], [N, 2, N])).toEqual([])
    expect(fillRuns([], [])).toEqual([])
  })

  it('⛔ the SHORTER column bounds the walk — no reading past the end', () => {
    expect(fillRuns([1, 2, 3, 4, 5], [0, 0])).toEqual([{ from: 0, to: 1 }])
  })

  it('⛔⛔ A TYPED ARRAY IS A COLUMN — this engine does not hand out plain ones', () => {
    // ⚰️ THE BUG THIS FILE EXISTED FOR AND STILL MISSED. Every case above passes a
    // plain array; the engine passes `Float64Array`, `Array.isArray` answers
    // false for it, and the length collapsed to 0 — so the band drew NOTHING on
    // the real chart while all sixteen tests stayed green. Only an A/B pixel diff
    // caught it. A fixture that cannot take the shape the caller actually sends
    // is not a fixture.
    const up = Float64Array.from([1, 2, N, 4])
    const lo = Float64Array.from([0, 0, 0, 0])
    expect(fillRuns(up, lo)).toEqual([{ from: 0, to: 1 }, { from: 3, to: 3 }])
    expect(fillPolygons({ upper: up, lower: lo, times, timeToX, priceToY }).length).toBe(2)
  })
})

describe('runPolygon — the shape of one span', () => {
  it('walks the upper edge forward and the lower edge BACK', () => {
    const [poly] = runPolygon({ from: 0, to: 2 }, [10, 11, 12], [0, 1, 2], times, timeToX, priceToY)
    expect(poly).toEqual([
      { x: 0, y: 10 }, { x: 1, y: 11 }, { x: 2, y: 12 },
      { x: 2, y: 2 }, { x: 1, y: 1 }, { x: 0, y: 0 },
    ])
  })

  it('⭐ stays a simple polygon when the two edges CROSS', () => {
    // A ribbon crossover. Walking both edges forward would produce a bow-tie
    // that fills the wrong halves; the reversed lower edge is what prevents it.
    const [poly] = runPolygon({ from: 0, to: 1 }, [0, 10], [10, 0], times, timeToX, priceToY)
    expect(poly).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 10 }, { x: 1, y: 0 }, { x: 0, y: 10 },
    ])
  })

  it('a one-bar run gets the thinnest honest area, not nothing', () => {
    const [poly] = runPolygon({ from: 1, to: 1 }, [N, 5, N], [N, 1, N], times, timeToX, priceToY)
    expect(poly).toHaveLength(4)
    expect(poly.map((p) => p.x)).toEqual([0.5, 1.5, 1.5, 0.5])
  })

  // ⚰️ THIS CASE USED TO ASSERT THAT AN UNRESOLVABLE POINT **ENDED** THE POLYGON,
  // and that was the bug. `timeToCoordinate` answers null for every bar outside
  // the VISIBLE range, and a chart holds 5,000 bars while showing ~200 — so the
  // FIRST bar is always off-screen and every polygon came back empty. Fifteen
  // green tests, `attach ok=true` on the live chart, and the band drew NOTHING;
  // only an A/B pixel diff against the same definition with the fill removed
  // caught it. The rule it was protecting (never stitch across a gap) is kept —
  // by SPLITTING instead of stopping.
  it('⛔⛔ AN UNRESOLVABLE COORDINATE SPLITS THE RUN — it neither ends it nor is bridged', () => {
    const offAt2 = (t) => (t === 2 ? null : t)
    const polys = runPolygon({ from: 0, to: 3 }, [10, 11, 12, 13], [0, 1, 2, 3], times, offAt2, priceToY)
    expect(polys).toHaveLength(2)
    expect(polys[0].map((p) => p.x)).toEqual([0, 1, 1, 0])
    expect(polys[1].map((p) => p.x)).toEqual([3 - 0.5, 3 + 0.5, 3 + 0.5, 3 - 0.5])
    // ⛔ AND NOTHING SPANS THE MISSING BAR.
    for (const poly of polys) expect(poly.some((p) => p.x === 2)).toBe(false)
  })

  it('⭐ an OFF-SCREEN HEAD is skipped, not fatal — the live failure, reduced', () => {
    // Bars 0 and 1 are off-screen (null x), 2 and 3 are visible. The band must
    // still draw for the visible stretch.
    const onlyLate = (t) => (t >= 2 ? t : null)
    const polys = runPolygon({ from: 0, to: 3 }, [10, 11, 12, 13], [0, 1, 2, 3], times, onlyLate, priceToY)
    expect(polys).toHaveLength(1)
    expect(polys[0].map((p) => p.x)).toEqual([2, 3, 3, 2])
  })

  it('an entirely unresolvable run draws nothing', () => {
    expect(runPolygon({ from: 0, to: 2 }, [1, 2, 3], [0, 0, 0], times, () => null, priceToY)).toEqual([])
  })
})

describe('fillPolygons — the whole frame', () => {
  it('⛔⛔ a gap yields TWO polygons, never one spanning it', () => {
    const polys = fillPolygons({
      upper: [10, 10, N, 10, 10], lower: [0, 0, N, 0, 0], times, timeToX, priceToY,
    })
    expect(polys).toHaveLength(2)
    // Neither polygon contains the missing bar's x.
    for (const poly of polys) expect(poly.some((p) => p.x === 2)).toBe(false)
  })

  it('⛔ NON-VACUITY: with no gap it is ONE polygon covering every bar', () => {
    // Without this, a bug that returned one polygon per BAR would satisfy the
    // case above and be caught by nothing.
    const polys = fillPolygons({
      upper: [10, 10, 10, 10, 10], lower: [0, 0, 0, 0, 0], times, timeToX, priceToY,
    })
    expect(polys).toHaveLength(1)
    expect(polys[0]).toHaveLength(10)
  })

  it('a degenerate polygon is dropped rather than drawn', () => {
    // Fewer than 4 points cannot bound an area.
    expect(fillPolygons({ upper: [1], lower: [N], times, timeToX, priceToY })).toEqual([])
  })
})
