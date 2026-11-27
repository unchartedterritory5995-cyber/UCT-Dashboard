import { describe, it, expect } from 'vitest'
import { labelRoomOffset, makeRoomForLabels, MAX_LABEL_ROOM_FRAC, LABEL_ROOM_PAD_BARS } from './labelRoom'
import { paintObjects } from './engine/objectCanvas'

// a 2D context that measures every character at 7px (enough to place a label body)
const ctx = () => {
  const c = {
    font: '', textAlign: 'center', textBaseline: 'top', fillStyle: '', strokeStyle: '', lineWidth: 1,
    measureText: (t) => ({ width: String(t).length * 7 }),
  }
  for (const k of ['save', 'restore', 'fillText', 'strokeText', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'closePath',
    'fill', 'stroke', 'arc', 'rect', 'clip', 'setLineDash', 'strokeRect']) c[k] = () => {}
  return c
}
// Fred RS's two last-bar labels, as its script writes them (label.style_label_center, text.align_left, a clear body)
const fredLabels = (x) => ({
  labels: [
    { x, y: 4.6, style: 'label_center', size: 'normal', textalign: 'left', color: 'rgba(0,0,0,0)', textcolor: '#1848cc', text: '                RS Rating' },
    { x, y: 4.6, style: 'label_center', size: 'large', textalign: 'left', color: 'rgba(0,0,0,0)', textcolor: '#1848cc', text: '\n\n       94' },
  ],
})
const map = (anchorX) => ({ timeToX: () => anchorX, priceToY: () => 200, width: 900, height: 400, rightInset: 60 })

describe('⭐ room for labels at the newest bar (owner ruling 2026-11-24)', () => {
  it('the canvas reports how far Fred\'s label runs under the price scale', () => {
    const r = paintObjects(ctx(), fredLabels(1), map(830))      // plot ends at 900 - 60 = 840; anchor 10px before it
    expect(r.labelOverflowRight).toBeGreaterThan(40)
  })
  it('CONTROL: an anchor with room reports 0, and an anchor scrolled OFF the plot is not counted', () => {
    expect(paintObjects(ctx(), fredLabels(1), map(500)).labelOverflowRight || 0).toBe(0)
    expect(paintObjects(ctx(), fredLabels(1), map(870)).labelOverflowRight || 0).toBe(0)
  })

  it('the offset gives the px as bars (+ pad), only grows, and only while the newest bar is on the plot', () => {
    expect(labelRoomOffset({ overflowPx: 60, scrollPosition: 3, barSpacing: 6, visibleBars: 200 })).toBe(3 + 10 + LABEL_ROOM_PAD_BARS)
    expect(labelRoomOffset({ overflowPx: 0, scrollPosition: 3, barSpacing: 6, visibleBars: 200 })).toBeNull()
    expect(labelRoomOffset({ overflowPx: 60, scrollPosition: -2, barSpacing: 6, visibleBars: 200 })).toBeNull()
    expect(labelRoomOffset({ overflowPx: 60, scrollPosition: 3, barSpacing: 0, visibleBars: 200 })).toBeNull()
  })
  it('is capped at a fraction of the visible width', () => {
    expect(labelRoomOffset({ overflowPx: 5000, scrollPosition: 3, barSpacing: 6, visibleBars: 100 })).toBe(100 * MAX_LABEL_ROOM_FRAC)
  })
  it('makeRoomForLabels scrolls the time scale, bar spacing untouched', () => {
    const calls = []
    const ts = {
      scrollPosition: () => 3, options: () => ({ barSpacing: 6 }), getVisibleLogicalRange: () => ({ from: 0, to: 200 }),
      scrollToPosition: (p, animated) => calls.push([p, animated]), applyOptions: () => { throw new Error('must not change options') },
    }
    expect(makeRoomForLabels(ts, 60)).toBe(14)
    expect(calls).toEqual([[14, false]])
    expect(makeRoomForLabels(ts, 0)).toBeNull()
    expect(calls).toHaveLength(1)
  })
})
