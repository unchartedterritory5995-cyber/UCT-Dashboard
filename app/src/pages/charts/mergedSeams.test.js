import { describe, it, expect } from 'vitest'
import {
  computeSeams, clampVerticalDelta, applyVerticalDrag,
  clampHorizontalDelta, applyHorizontalDrag,
} from './mergedSeams'

const minW = () => 2
const minH = () => 2

// A simple 2×2 tiled board on a 24×20 grid:
//   A(0..12,0..10)  B(12..24,0..10)
//   C(0..12,10..20) D(12..24,10..20)
const board = [
  { id: 'A', x: 0,  y: 0,  w: 12, h: 10 },
  { id: 'B', x: 12, y: 0,  w: 12, h: 10 },
  { id: 'C', x: 0,  y: 10, w: 12, h: 10 },
  { id: 'D', x: 12, y: 10, w: 12, h: 10 },
]

describe('computeSeams', () => {
  it('finds the shared vertical + horizontal seams of a tiled board', () => {
    const { vertical, horizontal } = computeSeams(board, 24, 20)
    expect(vertical).toHaveLength(1)
    expect(vertical[0].c).toBe(12)
    expect(vertical[0].y0).toBe(0)
    expect(vertical[0].y1).toBe(20)               // spans both stacked rows
    expect(new Set(vertical[0].leftIds)).toEqual(new Set(['A', 'C']))
    expect(new Set(vertical[0].rightIds)).toEqual(new Set(['B', 'D']))
    expect(horizontal).toHaveLength(1)
    expect(horizontal[0].r).toBe(10)
    expect(horizontal[0].x0).toBe(0)
    expect(horizontal[0].x1).toBe(24)
  })

  it('reports no seam at a boundary with widgets on only one side', () => {
    const single = [{ id: 'A', x: 0, y: 0, w: 12, h: 20 }]
    expect(computeSeams(single, 24, 20).vertical).toHaveLength(0)
  })
})

describe('applyVerticalDrag', () => {
  it('grows left-enders and shrinks right-starters, keeping the board tiled', () => {
    const { widgets, applied } = applyVerticalDrag(board, 12, 3, minW)
    expect(applied).toBe(3)
    const by = Object.fromEntries(widgets.map(w => [w.id, w]))
    expect(by.A.w).toBe(15)                 // 12 + 3
    expect(by.C.w).toBe(15)
    expect(by.B.x).toBe(15); expect(by.B.w).toBe(9)   // moved right, narrower
    expect(by.D.x).toBe(15); expect(by.D.w).toBe(9)
    // Still gapless: left widgets end where right widgets begin.
    expect(by.A.x + by.A.w).toBe(by.B.x)
    expect(by.C.x + by.C.w).toBe(by.D.x)
  })

  it('drags the other way (shrinks left, grows right)', () => {
    const { widgets, applied } = applyVerticalDrag(board, 12, -4, minW)
    expect(applied).toBe(-4)
    const by = Object.fromEntries(widgets.map(w => [w.id, w]))
    expect(by.A.w).toBe(8)
    expect(by.B.x).toBe(8); expect(by.B.w).toBe(16)
  })

  it('clamps so no widget drops below its min width', () => {
    // Right widgets are 12 wide, min 2 → max grow-right delta is 10.
    expect(clampVerticalDelta(board, 12, 50, minW)).toBe(10)
    // Left widgets are 12 wide, min 2 → max shrink-left delta is -10.
    expect(clampVerticalDelta(board, 12, -50, minW)).toBe(-10)
    const { widgets } = applyVerticalDrag(board, 12, 50, minW)
    const by = Object.fromEntries(widgets.map(w => [w.id, w]))
    expect(by.B.w).toBe(2)   // clamped to min, not negative
    expect(by.A.w).toBe(22)
  })

  it('leaves widgets that merely span across the seam untouched', () => {
    const withSpanner = [
      { id: 'TALL', x: 0, y: 0, w: 8, h: 20 },   // ends at 8
      { id: 'T', x: 8, y: 0, w: 16, h: 10 },      // starts at 8 (top)
      { id: 'B', x: 8, y: 10, w: 16, h: 10 },     // starts at 8 (bottom)
      { id: 'FAR', x: 20, y: 0, w: 4, h: 20 },    // spans across nothing at c=8
    ]
    const { widgets } = applyVerticalDrag(withSpanner, 8, 2, minW)
    const by = Object.fromEntries(widgets.map(w => [w.id, w]))
    expect(by.TALL.w).toBe(10)
    expect(by.T.x).toBe(10); expect(by.B.x).toBe(10)
    expect(by.FAR.x).toBe(20)   // untouched — not at the c=8 boundary
  })

  it('is a no-op for a zero delta or a non-seam column', () => {
    expect(applyVerticalDrag(board, 12, 0, minW).applied).toBe(0)
    expect(applyVerticalDrag(board, 6, 3, minW).applied).toBe(0) // no widget edge at 6
  })
})

describe('applyHorizontalDrag', () => {
  it('grows top and shrinks bottom, staying tiled + min-clamped', () => {
    const { widgets, applied } = applyHorizontalDrag(board, 10, 4, minH)
    expect(applied).toBe(4)
    const by = Object.fromEntries(widgets.map(w => [w.id, w]))
    expect(by.A.h).toBe(14); expect(by.B.h).toBe(14)
    expect(by.C.y).toBe(14); expect(by.C.h).toBe(6)
    expect(by.A.y + by.A.h).toBe(by.C.y)   // gapless
    expect(clampHorizontalDelta(board, 10, 99, minH)).toBe(8) // bottom 10, min 2
  })
})
