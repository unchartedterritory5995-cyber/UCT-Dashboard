import { describe, test, expect } from 'vitest'
import { planPlacement, reflowOnClose } from './place'

const COLS = 24
const ROWS = 20

describe('planPlacement — owner screenshot scenarios', () => {
  // img 1 → img 3: adding Breadth to [chart + theme-rail] should drop it into the
  // empty bottom-right rail gap at the rail's width — NOT a full-width bottom strip.
  test('breadth fills the empty sidebar rail gap (img 3), no resize', () => {
    const layout = [
      { id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 },
      { id: 't1', type: 'themes', x: 18, y: 0, w: 6, h: 10 },
    ]
    const { place, mutations } = planPlacement(layout, 'breadth', COLS, ROWS)
    expect(place).toEqual({ x: 18, y: 10, w: 6, h: 10 })
    expect(mutations).toEqual([]) // fills empty space, touches nothing
  })

  // img 4 → img 6: adding a Chart to [chart + theme + breadth] (rail full) should
  // split the existing chart 50/50 vertically — NOT a full-width bottom strip.
  test('second chart splits the chart region 50/50 (img 6)', () => {
    const layout = [
      { id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 },
      { id: 't1', type: 'themes', x: 18, y: 0, w: 6, h: 10 },
      { id: 'b1', type: 'breadth', x: 18, y: 10, w: 6, h: 10 },
    ]
    const { place, mutations } = planPlacement(layout, 'chart', COLS, ROWS)
    expect(place).toEqual({ x: 0, y: 10, w: 18, h: 10 })   // new chart, bottom half
    expect(mutations).toEqual([{ id: 'c1', h: 10 }])       // existing chart → top half
  })
})

describe('planPlacement — general behavior', () => {
  test('empty workspace → newcomer lands at its default size, top-left', () => {
    const { place, mutations } = planPlacement([], 'chart', COLS, ROWS)
    expect(place).toEqual({ x: 0, y: 0, w: 12, h: 12 })
    expect(mutations).toEqual([])
  })

  test('a panel with no matching rail carves one beside the widest widget', () => {
    const layout = [{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20 }]
    const { place, mutations } = planPlacement(layout, 'themes', COLS, ROWS)
    // left half becomes the new rail; the chart shrinks to the right half
    expect(place).toEqual({ x: 0, y: 0, w: 12, h: 20 })
    expect(mutations).toEqual([{ id: 'c1', x: 12, w: 12 }])
  })

  test('a panel prefers a genuinely empty rectangle over resizing anything', () => {
    // chart occupies the left; the whole right half is empty.
    const layout = [{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }]
    const { place, mutations } = planPlacement(layout, 'breadth', COLS, ROWS)
    expect(mutations).toEqual([])           // no resize — empty space existed
    expect(place.x).toBeGreaterThanOrEqual(12)
    expect(place.y + place.h).toBeLessThanOrEqual(ROWS)
  })

})

describe('reflowOnClose — close reflow (symmetric inverse of add)', () => {
  // Inverse of img 3: closing the breadth panel → the theme tracker above it grows
  // to reclaim the full rail.
  test('rail panel grows to fill the space a closed panel leaves', () => {
    const layout = [
      { id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 },
      { id: 't1', type: 'themes', x: 18, y: 0, w: 6, h: 10 },
      { id: 'b1', type: 'breadth', x: 18, y: 10, w: 6, h: 10 },
    ]
    const next = reflowOnClose(layout, 'b1')
    expect(next.find(w => w.id === 'b1')).toBeUndefined()
    expect(next.find(w => w.id === 't1')).toMatchObject({ x: 18, y: 0, w: 6, h: 20 })
    expect(next.find(w => w.id === 'c1')).toMatchObject({ h: 20 }) // untouched
  })

  // Inverse of img 6: closing the bottom chart → the top chart grows back to full height.
  test('a split chart sibling grows back to full height (close bottom)', () => {
    const layout = [
      { id: 'a', type: 'chart', x: 0, y: 0, w: 18, h: 10 },
      { id: 'b', type: 'chart', x: 0, y: 10, w: 18, h: 10 },
    ]
    const next = reflowOnClose(layout, 'b')
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ id: 'a', x: 0, y: 0, w: 18, h: 20 })
  })

  test('closing the TOP of a stack pulls the survivor up to reclaim the space', () => {
    const layout = [
      { id: 'a', type: 'chart', x: 0, y: 0, w: 18, h: 10 },
      { id: 'b', type: 'chart', x: 0, y: 10, w: 18, h: 10 },
    ]
    const next = reflowOnClose(layout, 'a')
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ id: 'b', x: 0, y: 0, w: 18, h: 20 })
  })

  test('closing a lone widget leaves the rest untouched (nothing flush to reclaim)', () => {
    const layout = [
      { id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 },
      { id: 't1', type: 'themes', x: 18, y: 0, w: 6, h: 10 },
    ]
    const next = reflowOnClose(layout, 't1')
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ id: 'c1', x: 0, y: 0, w: 18, h: 20 }) // unchanged
  })

  test('a no-op close of an unknown id just returns the list', () => {
    const layout = [{ id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 }]
    expect(reflowOnClose(layout, 'nope')).toHaveLength(1)
  })
})

describe('planPlacement — grid bounds', () => {
  test('placement never leaves the grid', () => {
    const layout = [
      { id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 },
      { id: 't1', type: 'themes', x: 18, y: 0, w: 6, h: 10 },
      { id: 'b1', type: 'breadth', x: 18, y: 10, w: 6, h: 10 },
    ]
    for (const type of ['chart', 'breadth', 'watchlist', 'fundamentals']) {
      const { place } = planPlacement(layout, type, COLS, ROWS)
      expect(place.x).toBeGreaterThanOrEqual(0)
      expect(place.y).toBeGreaterThanOrEqual(0)
      expect(place.x + place.w).toBeLessThanOrEqual(COLS)
      expect(place.y + place.h).toBeLessThanOrEqual(ROWS)
    }
  })
})
