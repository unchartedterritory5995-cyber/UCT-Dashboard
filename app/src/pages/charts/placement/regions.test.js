import { describe, test, expect } from 'vitest'
import { inferRegions, tallestGap, familyOf } from './regions'

const COLS = 24
const ROWS = 20

// Owner layout: a wide chart on the left + the theme tracker in a top-right rail,
// leaving the bottom-right corner empty (screenshot img 1).
const CHART_PLUS_THEME = [
  { id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 },
  { id: 't1', type: 'themes', x: 18, y: 0, w: 6, h: 10 },
]

describe('familyOf', () => {
  test('charts are the chart family, panels are the panel family', () => {
    expect(familyOf('chart')).toBe('chart')
    expect(familyOf('themes')).toBe('panel')
    expect(familyOf('breadth')).toBe('panel')
    expect(familyOf('unknown-widget')).toBe('panel') // safe default
  })
})

describe('inferRegions', () => {
  test('splits a chart+rail layout into two column-band regions', () => {
    const regions = inferRegions(CHART_PLUS_THEME, COLS, ROWS)
    expect(regions).toHaveLength(2)

    const [left, right] = regions
    expect(left.x).toBe(0)
    expect(left.w).toBe(18)
    expect(left.dominantFamily).toBe('chart')

    expect(right.x).toBe(18)
    expect(right.w).toBe(6)
    expect(right.dominantFamily).toBe('panel')
  })

  test('the left chart region has no gap (chart fills it top to bottom)', () => {
    const [left] = inferRegions(CHART_PLUS_THEME, COLS, ROWS)
    expect(tallestGap(left.gaps)).toBeNull()
  })

  test('the right rail exposes the empty bottom gap at the rail width', () => {
    const [, right] = inferRegions(CHART_PLUS_THEME, COLS, ROWS)
    const gap = tallestGap(right.gaps)
    expect(gap).toEqual({ x: 18, y: 10, w: 6, h: 10 })
  })

  test('two stacked panels of identical span collapse into one rail region', () => {
    const layout = [
      { id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 },
      { id: 't1', type: 'themes', x: 18, y: 0, w: 6, h: 10 },
      { id: 'b1', type: 'breadth', x: 18, y: 10, w: 6, h: 10 },
    ]
    const regions = inferRegions(layout, COLS, ROWS)
    expect(regions).toHaveLength(2)
    const rail = regions[1]
    expect(rail.members.map(m => m.id).sort()).toEqual(['b1', 't1'])
    expect(rail.dominantFamily).toBe('panel')
    expect(tallestGap(rail.gaps)).toBeNull() // rail is now full
  })

  test('ignores widgets with non-finite geometry (unplaced / floating)', () => {
    const regions = inferRegions(
      [...CHART_PLUS_THEME, { id: 'f1', type: 'chart', x: NaN, y: NaN, w: 6, h: 6 }],
      COLS,
      ROWS,
    )
    expect(regions).toHaveLength(2)
  })
})
