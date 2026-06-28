import { describe, test, expect } from 'vitest'
import { findOpenSlot } from './findOpenSlot'

const COLS = 12
const ROWS = 20

describe('findOpenSlot', () => {
  test('empty grid → top-left', () => {
    expect(findOpenSlot([], 4, 10, COLS, ROWS)).toEqual({ x: 0, y: 0 })
  })

  test('left column full → places to the right at the top, not stacked at x:0', () => {
    // watchlist occupies x:0-2 for the full height
    const widgets = [{ x: 0, y: 0, w: 3, h: 20 }]
    // a 4-wide widget should land at x:3, y:0 (free), NOT x:0
    expect(findOpenSlot(widgets, 4, 10, COLS, ROWS)).toEqual({ x: 3, y: 0 })
  })

  test('uses a logical open spot on the BOTTOM-RIGHT (x:0 stacking would overflow)', () => {
    // top half full width; bottom-left occupied; bottom-RIGHT (x:6-11, y:10-19) open
    const widgets = [
      { x: 0, y: 0, w: 12, h: 10 },   // full-width top
      { x: 0, y: 10, w: 6, h: 10 },   // bottom-left
    ]
    // a 6-wide 10-tall widget must find the bottom-right gap, not stack at x:0 (overflow)
    expect(findOpenSlot(widgets, 6, 10, COLS, ROWS)).toEqual({ x: 6, y: 10 })
  })

  test('row-major: earliest row wins, then leftmost column', () => {
    // a small block removed from the middle-left leaves a gap at x:0,y:0
    const widgets = [
      { x: 4, y: 0, w: 8, h: 20 },  // right 8 cols full height
      { x: 0, y: 6, w: 4, h: 14 },  // left col occupied from row 6 down
    ]
    // gap is x:0-3, rows 0-5 → a 4x4 fits at {x:0,y:0}
    expect(findOpenSlot(widgets, 4, 4, COLS, ROWS)).toEqual({ x: 0, y: 0 })
  })

  test('over-wide widget is clamped to grid width', () => {
    expect(findOpenSlot([], 99, 5, COLS, ROWS)).toEqual({ x: 0, y: 0 })
  })

  test('full grid → null (no fit)', () => {
    const widgets = [{ x: 0, y: 0, w: 12, h: 20 }]
    expect(findOpenSlot(widgets, 4, 6, COLS, ROWS)).toBeNull()
  })

  test('ignores not-yet-placed widgets (non-finite x/y)', () => {
    const widgets = [{ x: 0, y: Infinity, w: 4, h: 10 }]
    // the phantom widget must not be treated as occupying row 0
    expect(findOpenSlot(widgets, 4, 10, COLS, ROWS)).toEqual({ x: 0, y: 0 })
  })
})
