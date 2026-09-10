// @vitest-environment jsdom
/* The conversion is the bug surface, so the conversion is what this pins.
 *
 * ⛔ AN UNCONVERTED ANCHOR DOES NOT THROW. A drawing's `time` is in the chart's
 * DISPLAY epoch; the server checker compares against true UTC. Get it wrong and
 * an intraday alert fires hours off, and a DAILY alert is never created at all
 * (`Math.round("2026-09-08")` is NaN → the caller bails silently). Neither says
 * anything on screen, which is why the round trip is asserted in seconds here
 * rather than "it returned an object".
 */
import { describe, it, expect } from 'vitest'
import { anchorsForDrawing, alertKindFor, toUtcSec, barSeconds, geometrySignature } from './drawingAlertAnchors'

const ET = -14400   // EDT, the offset StockChart computes at module load

describe('alertKindFor', () => {
  it('flat lines are a fixed level; sloped lines need two anchors', () => {
    expect(alertKindFor('horizontal')).toBe('line')
    expect(alertKindFor('hray')).toBe('line')
    expect(alertKindFor('trendline')).toBe('trendline')
    expect(alertKindFor('ray')).toBe('trendline')
    expect(alertKindFor('extended')).toBe('trendline')
  })
  it('a shape that has no level cannot carry an alert', () => {
    for (const t of ['rect', 'circle', 'text', 'measure', 'arrow', undefined])
      expect(alertKindFor(t)).toBeNull()
  })

  it('⭐ A FIB IS A PRICE LINE, which is the whole of the Phase 8 integration', () => {
    // A Fibonacci LEVEL is a horizontal price level and the server already knows
    // how to evaluate one — so there is no new alert semantics, no second engine
    // and no schema change. What a Fib adds is only WHICH level, and that rides
    // in the bound id (see `boundIdFor`).
    expect(alertKindFor('fib')).toBe('line')
    expect(alertKindFor('fibext')).toBe('line')
  })
})

describe('toUtcSec', () => {
  it('reverses the intraday ET axis shift', () => {
    // A bar displayed at 13:30 "ET-shifted" epoch is 4h later in true UTC.
    expect(toUtcSec(1_700_000_000, ET)).toBe(1_700_000_000 + 14400)
  })
  it('resolves a D/W/M date STRING to ~noon ET, not NaN', () => {
    const sec = toUtcSec('2026-09-08', ET)
    expect(Number.isFinite(sec)).toBe(true)
    expect(new Date(sec * 1000).toISOString()).toBe('2026-09-08T16:00:00.000Z')
  })
  it('refuses what it cannot read rather than inventing a time', () => {
    expect(Number.isNaN(toUtcSec('not-a-date', ET))).toBe(true)
    expect(Number.isNaN(toUtcSec(null, ET))).toBe(true)
  })
})

describe('anchorsForDrawing', () => {
  it('a horizontal line is a fixed level with no anchors', () => {
    const g = anchorsForDrawing({ type: 'horizontal', points: [{ price: 114.26 }] }, { tf: 'D', etOffset: ET })
    expect(g).toEqual({ alert_type: 'line', target_price: 114.26 })
  })

  it('a DAILY trendline produces real anchors — the case that silently produced none', () => {
    const g = anchorsForDrawing({
      type: 'trendline',
      points: [{ time: '2026-09-01', price: 100 }, { time: '2026-09-08', price: 110 }],
    }, { tf: 'D', etOffset: ET })
    expect(g.alert_type).toBe('trendline')
    expect(Number.isFinite(g.anchor_t1)).toBe(true)
    expect(Number.isFinite(g.anchor_t2)).toBe(true)
    expect(g.anchor_t2 - g.anchor_t1).toBe(7 * 86400)
    expect(g.anchor_p1).toBe(100)
    expect(g.anchor_p2).toBe(110)
    expect(g.target_price).toBe(110)   // display fallback = the latest anchor
  })

  it('a point placed PAST the last candle resolves through the bar spacing', () => {
    const bars = [{ t: 1_700_000_000 }]
    const g = anchorsForDrawing({
      type: 'trendline',
      points: [{ time: 1_700_000_000, price: 100 }, { futureBars: 5, price: 120 }],
    }, { bars, tf: '30', etOffset: ET })
    expect(g.anchor_t2 - g.anchor_t1).toBe(5 * barSeconds('30'))
  })

  it('returns null rather than a half-built alert when a price is missing', () => {
    expect(anchorsForDrawing({ type: 'trendline', points: [{ time: '2026-09-01' }] }, { tf: 'D' })).toBeNull()
    expect(anchorsForDrawing({ type: 'horizontal', points: [] }, { tf: 'D' })).toBeNull()
    expect(anchorsForDrawing({ type: 'rect', points: [{ price: 1 }, { price: 2 }] }, { tf: 'D' })).toBeNull()
  })
})

describe('geometrySignature', () => {
  it('is stable across a SQLite float round trip — no PATCH storm', () => {
    const drawn = { alert_type: 'line', target_price: 114.26 }
    const fromDb = { alert_type: 'line', target_price: 114.25999999999999 }
    expect(geometrySignature(fromDb)).toBe(geometrySignature(drawn))
  })
  it('changes when the line actually moves', () => {
    const a = { alert_type: 'trendline', target_price: 110, anchor_t1: 1, anchor_p1: 100, anchor_t2: 2, anchor_p2: 110 }
    expect(geometrySignature({ ...a, anchor_p2: 111 })).not.toBe(geometrySignature(a))
    expect(geometrySignature({ ...a, anchor_t2: 3 })).not.toBe(geometrySignature(a))
  })
})
