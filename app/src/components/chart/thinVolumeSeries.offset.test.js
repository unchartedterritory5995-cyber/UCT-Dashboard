// The column series' horizontal offset (2026-09-30) — what lets several histograms
// share one pane side by side. Offset 0, the volume pane's case, must draw exactly as
// before; a non-zero offset moves the column within its own slot and nothing else.

import { describe, it, expect } from 'vitest'
import { ThinVolumeSeries } from './thinVolumeSeries'

function drawRects(options, bars) {
  const s = new ThinVolumeSeries()
  s.update({ bars, barSpacing: 12, visibleRange: { from: 0, to: bars.length } },
    { ...s.defaultOptions(), ...options })
  const rects = []
  const ctx = { set fillStyle(v) { this._f = v }, get fillStyle() { return this._f },
    fillRect: (x, y, w, h) => rects.push({ x, y, w, h }) }
  const target = { useBitmapCoordinateSpace: (fn) => fn({ context: ctx, horizontalPixelRatio: 1,
    verticalPixelRatio: 1, mediaSize: { height: 100 } }) }
  // value v → y = 50 - v (zero at y 50)
  s.renderer().draw(target, (v) => 50 - v)
  return rects
}

const bars = [
  { x: 100, originalData: { value: 20 } },
  { x: 112, originalData: { value: -10 } },
]

describe('column series offset', () => {
  it('offset 0 is the unchanged centred column (the volume pane)', () => {
    const r = drawRects({ widthRatio: 0.5 }, bars)
    expect(r[0]).toEqual({ x: 97, y: 30, w: 6, h: 20 })
    expect(r[1]).toEqual({ x: 109, y: 50, w: 6, h: 10 })
  })

  it('a positive / negative offset shifts the column within its slot, height untouched', () => {
    const right = drawRects({ widthRatio: 0.28, offsetRatio: 0.28 }, bars)
    const left = drawRects({ widthRatio: 0.28, offsetRatio: -0.28 }, bars)
    const mid = drawRects({ widthRatio: 0.28, offsetRatio: 0 }, bars)
    expect(right[0].x - mid[0].x).toBe(3)   // round(12 * 0.28)
    expect(mid[0].x - left[0].x).toBe(3)
    for (const set of [right, left, mid]) {
      expect(set[0].y).toBe(30); expect(set[0].h).toBe(20)    // grows up from zero
      expect(set[1].y).toBe(50); expect(set[1].h).toBe(10)    // grows down from zero
    }
  })

  it('autoscale always includes zero, so a shared pane keeps one zero line', () => {
    expect(new ThinVolumeSeries().priceValueBuilder({ value: -62340 })).toEqual([0, -62340])
  })
})
