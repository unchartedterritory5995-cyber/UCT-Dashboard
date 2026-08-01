import { describe, it, expect } from 'vitest'
import { zoneRects } from './levelZonesPrimitive'

// House convention (see sessionShadingPrimitive.test.js): a primitive's canvas
// path is never vitest-booted — there is no chart, no series, no CanvasRenderingContext.
// Only the pure geometry helper is tested, and draw() is kept thin enough that
// testing the helper IS testing the drawing.

describe('zoneRects', () => {
  const priceToY = p => 500 - p  // simple linear fake

  it('maps price range to rect', () => {
    const rects = zoneRects([{ lo: 100, hi: 110, rank: 1 }], priceToY, 800)
    expect(rects).toEqual([{ x: 0, y: 390, w: 800, h: 10, rank: 1 }])
  })

  it('skips zones that fail to map', () => {
    expect(zoneRects([{ lo: 100, hi: 110 }], () => null, 800)).toEqual([])
    expect(zoneRects(null, priceToY, 800)).toEqual([])
  })

  it('skips a zone whose coordinate is non-finite, keeping its neighbours', () => {
    // priceToCoordinate returns null off-scale, but a series mid-teardown can
    // hand back undefined/NaN — one bad zone must not blank the whole overlay.
    const flaky = p => (p === 200 || p === 210 ? NaN : 500 - p)
    const rects = zoneRects(
      [{ lo: 100, hi: 110, rank: 1 }, { lo: 200, hi: 210, rank: 2 }, { lo: 300, hi: 310, rank: 3 }],
      flaky,
      800,
    )
    expect(rects.map(r => r.rank)).toEqual([1, 3])
  })

  it('carries a null rank through as null so it reads as lowest emphasis', () => {
    // dpToZones emits rank:null for an unranked level. It must never be coerced
    // to a number that could be mistaken for rank 1, and never used as an index.
    expect(zoneRects([{ lo: 100, hi: 110, rank: null }], priceToY, 800))
      .toEqual([{ x: 0, y: 390, w: 800, h: 10, rank: null }])
    expect(zoneRects([{ lo: 100, hi: 110 }], priceToY, 800)[0].rank).toBe(null)
    expect(zoneRects([{ lo: 100, hi: 110, rank: '1' }], priceToY, 800)[0].rank).toBe(null)
  })

  it('preserves a real rank verbatim', () => {
    expect(zoneRects([{ lo: 100, hi: 110, rank: 3 }], priceToY, 800)[0].rank).toBe(3)
  })

  it('normalizes an inverted lo/hi instead of dropping the band', () => {
    // dpToZones already min/maxes the pair, so this is belt-and-braces: the
    // primitive draws the band either way rather than emitting a rect of
    // negative height (which fillRect renders as nothing, silently).
    expect(zoneRects([{ lo: 110, hi: 100, rank: 1 }], priceToY, 800))
      .toEqual([{ x: 0, y: 390, w: 800, h: 10, rank: 1 }])
  })

  it('keeps a sub-pixel band visible at one pixel', () => {
    // Zoomed far out, a tight band rounds to 0px and the indicator silently
    // disappears. Mirrors sessionShadingPrimitive's Math.max(1, right - left).
    const [r] = zoneRects([{ lo: 100, hi: 100, rank: 1 }], priceToY, 800)
    expect(r.h).toBe(1)
  })

  it('returns an empty list for an empty zone list', () => {
    expect(zoneRects([], priceToY, 800)).toEqual([])
  })
})
