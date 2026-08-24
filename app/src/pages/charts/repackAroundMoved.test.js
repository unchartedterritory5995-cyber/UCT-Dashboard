// Drop-repack guarantee: when a widget is dropped, the moved widget keeps its slot
// and every OTHER widget re-tiles around it — always inside the 24x20 grid and never
// overlapping. This is the fix for "dragging a widget shoots the others off the bottom
// of the screen": a full-2D fit test can't push a displaced widget off-canvas the way
// the old vertical-only relocate did.
import { describe, it, expect } from 'vitest'
import { repackAroundMoved } from './ChartsWorkspace.jsx'

const COLS = 24, ROWS = 20

const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

function assertLegal(list) {
  for (const w of list) {
    expect(w.x, `${w.id} x>=0`).toBeGreaterThanOrEqual(0)
    expect(w.y, `${w.id} y>=0`).toBeGreaterThanOrEqual(0)
    expect(w.x + w.w, `${w.id} right edge in bounds`).toBeLessThanOrEqual(COLS)
    expect(w.y + w.h, `${w.id} bottom edge in bounds (never off-canvas)`).toBeLessThanOrEqual(ROWS)
  }
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      expect(overlaps(list[i], list[j]), `${list[i].id} vs ${list[j].id} overlap`).toBe(false)
}

describe('repackAroundMoved', () => {
  // The exact screenshot case: chart fills the left ~2/3, watchlist top-right,
  // theme bottom-right. Drag the watchlist to the top-left corner.
  const base = [
    { id: 'chart', type: 'chart', x: 0, y: 0, w: 16, h: 20 },
    { id: 'watch', type: 'watchlist', x: 16, y: 0, w: 8, h: 10 },
    { id: 'theme', type: 'themes', x: 16, y: 10, w: 8, h: 10 },
  ]

  it('drops the watchlist top-left without shoving anything off-screen', () => {
    const out = repackAroundMoved(base, 'watch', { x: 0, y: 0, w: 8, h: 10 })
    assertLegal(out)
    const watch = out.find(w => w.id === 'watch')
    expect({ x: watch.x, y: watch.y }).toEqual({ x: 0, y: 0 })
    // Every original widget still exists exactly once.
    expect(out.map(w => w.id).sort()).toEqual(['chart', 'theme', 'watch'])
  })

  it('keeps the big chart the biggest widget after the repack', () => {
    const out = repackAroundMoved(base, 'watch', { x: 0, y: 0, w: 8, h: 10 })
    const chart = out.find(w => w.id === 'chart')
    // The chart yields some width to make room but stays full-height and dominant.
    expect(chart.h).toBe(20)
    expect(chart.w).toBeGreaterThanOrEqual(8)
  })

  it('is legal for a drop anywhere on the grid', () => {
    for (let x = 0; x <= COLS - 4; x += 3) {
      for (let y = 0; y <= ROWS - 4; y += 3) {
        const out = repackAroundMoved(base, 'watch', { x, y, w: 8, h: 10 })
        assertLegal(out)
      }
    }
  })

  it('clamps an out-of-bounds drop back inside the canvas', () => {
    const out = repackAroundMoved(base, 'watch', { x: 100, y: 100, w: 8, h: 10 })
    assertLegal(out)
  })

  it('returns the list unchanged when the moved id is unknown', () => {
    const out = repackAroundMoved(base, 'nope', { x: 0, y: 0, w: 8, h: 10 })
    expect(out).toEqual(base)
  })
})
