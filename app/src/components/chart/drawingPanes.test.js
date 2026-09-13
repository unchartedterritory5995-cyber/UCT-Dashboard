/* Pane ownership and pane rectangles.
 *
 * ⛔ THE TWO VOLUME LAYOUTS ARE BOTH REAL, AND THE AWKWARD ONE IS THE DEFAULT.
 * `cs.volume.separatePane` ships FALSE, so on a stock /charts widget the volume
 * histogram is a BAND inside pane 0 with its own overlay price scale — there is
 * no pane boundary to read, only that scale's `scaleMargins.top`. Grid cells and
 * Review cards force the separate pane. Every test below runs the case it names,
 * because code that assumed either layout would be wrong on most charts or on
 * some charts, and both failures look like "my drawing is in the wrong place".
 */
import { describe, it, expect } from 'vitest'
import {
  PRICE, VOLUME, resolveZones, zoneAtY, paneKeyAtY, rectForKey,
  inferPaneKey, toPaneFraction, fromPaneFraction,
} from './drawingPanes'

// A chart 800×500: 460px of plot, 40px of time axis, 56px of price axis.
const base = { width: 800, height: 500, axisWidth: 56, timeAxisHeight: 40 }

/** Volume as an overlay BAND inside pane 0 — the DEFAULT layout. */
const band = (top = 0.78) => resolveZones({ ...base, paneHeights: [460], volumeBandTop: top })

/** Volume in its OWN pane — grid cells, Review cards. */
const separate = () => resolveZones({ ...base, paneHeights: [360, 99], volumePaneIndex: 1 })

/** No volume at all — the Model Book index pane, embeds. */
const noVolume = () => resolveZones({ ...base, paneHeights: [460] })

describe('the plot rect', () => {
  it('excludes the right price axis and the bottom time axis', () => {
    const { plot } = band()
    expect(plot.x0).toBe(0)
    expect(plot.x1).toBe(800 - 56 - 1)   // the SHIPPED horizontal clip, unchanged
    expect(plot.y0).toBe(0)
    expect(plot.y1).toBe(460)
  })

  it('keeps the `- 1` that has always kept drawings off the scale', () => {
    // Not cosmetic: without it a 1px line lands ON the axis border.
    expect(resolveZones({ ...base, axisWidth: 0, paneHeights: [460] }).plot.x1).toBe(799)
  })
})

describe('BAND layout (volume overlaid inside pane 0 — the default)', () => {
  it('splits pane 0 at the volume overlay’s own scale margin', () => {
    const { zones } = band(0.78)
    expect(zones.map((z) => z.key)).toEqual([PRICE, VOLUME])
    expect(zones[0].y1).toBeCloseTo(460 * 0.78, 6)
    expect(zones[1].y0).toBeCloseTo(460 * 0.78, 6)
    expect(zones[1].y1).toBe(460)
  })

  it('the two zones tile pane 0 with no gap and no overlap', () => {
    const { zones } = band(0.82)
    expect(zones[0].y1).toBe(zones[1].y0)
  })

  it('moves the divider when the band margin moves — a pane RESIZE', () => {
    expect(band(0.6).zones[1].y0).toBeCloseTo(276, 6)
    expect(band(0.9).zones[1].y0).toBeCloseTo(414, 6)
  })

  it('ignores a nonsense band margin rather than inventing a zero-height zone', () => {
    for (const bad of [0, 1, -0.2, 1.5]) {
      expect(resolveZones({ ...base, paneHeights: [460], volumeBandTop: bad }).zones.map((z) => z.key))
        .toEqual([PRICE])
    }
  })
})

describe('SEPARATE-PANE layout', () => {
  it('gives volume its own rect below the candles, past the separator', () => {
    const { zones } = separate()
    expect(zones.map((z) => z.key)).toEqual([PRICE, VOLUME])
    expect(zones[0]).toMatchObject({ y0: 0, y1: 360 })
    expect(zones[1].y0).toBe(361)          // 360 + 1px separator
    expect(zones[1].y1).toBe(460)
  })

  it('never lets a zone spill past the CANVAS', () => {
    // The panes are the authority on where the plot ends (see resolveZones), so
    // the only remaining ceiling is the canvas itself. A pane stack taller than
    // the canvas is a chart mid-relayout, not a reason to invent a boundary.
    const { zones } = resolveZones({ ...base, paneHeights: [360, 400], volumePaneIndex: 1 })
    expect(zones[1].y1).toBe(500)
  })

  it('derives the plot bottom from the pane stack, not from height - timeAxis', () => {
    // MEASURED IN-BROWSER: the overlay canvas does not reliably include the time
    // axis. Subtracting it from a canvas that never contained it collapsed the
    // volume zone to zero height and every volume drawing vanished.
    const g = resolveZones({
      width: 1829, height: 697, axisWidth: 76, timeAxisHeight: 28,
      paneHeights: [668, 28], volumePaneIndex: 1,
    })
    expect(g.plot.y1).toBe(697)
    const vol = g.zones.find((z) => z.key === 'volume')
    expect(vol.y0).toBe(669)
    expect(vol.y1).toBe(697)
    expect(vol.y1 - vol.y0).toBeGreaterThan(0)   // NOT a zero-height zone
  })
})

describe('extra panes (oscillators under Flip C)', () => {
  it('are keyed in render order, after price and volume', () => {
    const { zones } = resolveZones({
      ...base, paneHeights: [260, 100, 98], volumePaneIndex: 1,
    })
    expect(zones.map((z) => z.key)).toEqual([PRICE, VOLUME, 'pane1'])
  })

  it('work when the candles are NOT pane 0 (the index pane is hoisted above)', () => {
    const { zones } = resolveZones({
      ...base, paneHeights: [120, 240, 98], candlePaneIndex: 1, volumePaneIndex: 2,
    })
    const price = zones.find((z) => z.key === PRICE)
    expect(price.y0).toBe(121)
    expect(zones.find((z) => z.key === VOLUME).y0).toBe(362)
  })
})

describe('no volume at all', () => {
  it('gives the whole candle pane to price', () => {
    const { zones } = noVolume()
    expect(zones.map((z) => z.key)).toEqual([PRICE])
    expect(zones[0].y1).toBe(460)
  })

  it('degrades to one plot-wide zone when nothing could be measured', () => {
    // A chart that has not laid out yet, or a disposed one. Clipping then
    // reduces to today's horizontal-only behaviour rather than blanking.
    const g = resolveZones({ ...base, paneHeights: [] })
    expect(g.zones).toHaveLength(1)
    expect(g.zones[0].key).toBe(PRICE)
    expect(g.zones[0].y1).toBe(460)
  })
})

describe('paneKeyAtY / zoneAtY', () => {
  it('reads the band divider exactly', () => {
    const g = band(0.78)
    const split = 460 * 0.78
    expect(paneKeyAtY(g, split - 1)).toBe(PRICE)
    expect(paneKeyAtY(g, split + 1)).toBe(VOLUME)
  })

  it('clamps above the first zone and below the last, rather than returning null', () => {
    const g = separate()
    expect(paneKeyAtY(g, -50)).toBe(PRICE)
    expect(paneKeyAtY(g, 9999)).toBe(VOLUME)
  })

  it('puts a click in the separator gap in the pane below it', () => {
    // y = 360 is the 1px separator between the panes. Somewhere is better than
    // nowhere, and "the pane you were heading into" is the kinder guess.
    expect(paneKeyAtY(separate(), 360.5)).toBe(VOLUME)
  })
})

describe('rectForKey — the fallback is DON’T CLIP, never CLIP TO NOTHING', () => {
  it('returns the named zone', () => {
    expect(rectForKey(band(), VOLUME).y1).toBe(460)
  })

  it('returns the WHOLE PLOT for a key this chart does not have', () => {
    // ⭐ The user who drew in the volume pane and then switched volume OFF. A
    // strict reading would clip that drawing to nothing and it would vanish with
    // no way to know it still existed. Falling back to unclipped puts it exactly
    // where it rendered before Phase 1.
    const g = noVolume()
    expect(rectForKey(g, VOLUME)).toBe(g.plot)
    expect(rectForKey(g, 'pane7')).toBe(g.plot)
    expect(rectForKey(g, null)).toBe(g.plot)
  })

  it('returns the PLOT for a zone that has not been laid out yet', () => {
    // MEASURED IN-BROWSER: right after mount a sub-pane can report height 0, so
    // its zone is {y0: 669, y1: 669}. Clipping to that blinks every drawing in it
    // out until the layout settles. Same rule as an unknown key.
    const g = { plot: { x0: 0, y0: 0, x1: 800, y1: 700 },
                zones: [{ key: PRICE, x0: 0, y0: 0, x1: 800, y1: 669 },
                        { key: VOLUME, x0: 0, y0: 669, x1: 800, y1: 669 }] }
    expect(rectForKey(g, VOLUME)).toBe(g.plot)
    expect(rectForKey(g, PRICE)).toBe(g.zones[0])
  })

  it('returns null only when there is no geometry at all', () => {
    expect(rectForKey(null, PRICE)).toBeNull()
  })
})

describe('inferPaneKey — legacy drawings with no `pane` field', () => {
  const g = band(0.78)
  const split = 460 * 0.78            // 358.8

  it('a drawing wholly in the candles is price', () => {
    expect(inferPaneKey(g, [{ x: 10, y: 100, valid: true }, { x: 20, y: 200, valid: true }])).toBe(PRICE)
  })

  it('a drawing wholly in the volume band is volume', () => {
    expect(inferPaneKey(g, [{ x: 10, y: 400, valid: true }, { x: 20, y: 430, valid: true }])).toBe(VOLUME)
  })

  it('⭐ a STRADDLING legacy drawing takes the LOWEST anchor — the roomier reading', () => {
    // Ownership used to be per point, so a legacy line can genuinely have one
    // anchor in each pane and something has to break the tie deterministically.
    // Taking the FIRST anchor would call this a price drawing and clip its lower
    // half away — hiding part of a drawing the user can currently see. Taking the
    // lowest keeps the whole thing visible.
    expect(inferPaneKey(g, [{ x: 10, y: 100, valid: true }, { x: 20, y: 420, valid: true }])).toBe(VOLUME)
    expect(inferPaneKey(g, [{ x: 10, y: 420, valid: true }, { x: 20, y: 100, valid: true }])).toBe(VOLUME)
  })

  it('ignores anchors that could not be resolved', () => {
    expect(inferPaneKey(g, [
      { x: null, y: 440, valid: false },
      { x: 20, y: 100, valid: true },
    ])).toBe(PRICE)
  })

  it('falls back to price when nothing resolves at all', () => {
    expect(inferPaneKey(g, [{ x: null, y: null, valid: false }])).toBe(PRICE)
    expect(inferPaneKey(g, [])).toBe(PRICE)
    expect(inferPaneKey(null, [])).toBe(PRICE)
  })

  it('a legacy anchor sitting exactly ON the divider resolves deterministically', () => {
    expect(inferPaneKey(g, [{ x: 1, y: split, valid: true }])).toBe(VOLUME)
    expect(inferPaneKey(g, [{ x: 1, y: split - 0.001, valid: true }])).toBe(PRICE)
  })
})

describe('pane fractions — why a volume drawing stops sliding on a resize', () => {
  it('round-trips through the same rect', () => {
    const rect = { x0: 0, y0: 300, x1: 800, y1: 400 }
    expect(fromPaneFraction(rect, toPaneFraction(rect, 340))).toBeCloseTo(340, 10)
  })

  it('⭐ keeps a drawing in the same place among the volume bars when the pane resizes', () => {
    // THIS IS THE POINT OF THE UNIT CHANGE. The legacy field is a fraction of the
    // WHOLE CANVAS, so shrinking the volume pane slid every volume drawing across
    // the bars it was marking. A fraction of the OWN PANE cannot.
    const before = { x0: 0, y0: 300, x1: 800, y1: 400 }
    const after = { x0: 0, y0: 250, x1: 800, y1: 400 }   // divider dragged up
    const frac = toPaneFraction(before, 350)             // halfway down the band
    expect(frac).toBeCloseTo(0.5, 10)
    expect(fromPaneFraction(after, frac)).toBeCloseTo(325, 10)   // still halfway
  })

  it('refuses a zero-height or missing rect rather than dividing by it', () => {
    expect(toPaneFraction({ x0: 0, y0: 10, x1: 5, y1: 10 }, 10)).toBeNull()
    expect(toPaneFraction(null, 10)).toBeNull()
    expect(fromPaneFraction(null, 0.5)).toBeNull()
    expect(fromPaneFraction({ x0: 0, y0: 0, x1: 1, y1: 1 }, null)).toBeNull()
  })
})
