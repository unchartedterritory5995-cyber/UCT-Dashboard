// #1275 (AUDIT): the capreg `charts.tiled` / `charts.sizes` assertions (testing/tiling.js) — each catches what it claims to.
import { describe, it, expect } from 'vitest'
import { tilingProblems, sizesOf } from './testing/tiling'
import { pinClock } from './testing/clock'

pinClock()                   // one fixed instant (testing/clock.js): the suite never reads the wall clock

const R = (id, x, y, w, h) => ({ id, x, y, w, h })
const GW19 = [R('c1', 0, 0, 12, 10), R('a', 12, 0, 12, 10), R('b', 0, 10, 24, 10)]

describe('capreg charts.tiled', () => {
  it("GW-19's 3 charts (12x10, 12x10, 24x10) tile one rectangle", () => expect(tilingProblems(GW19)).toEqual([]))
  it('a 2×2 and a single chart tile', () => {
    expect(tilingProblems([R('a', 0, 0, 12, 10), R('b', 12, 0, 12, 10), R('c', 0, 10, 12, 10), R('d', 12, 10, 12, 10)])).toEqual([])
    expect(tilingProblems([R('a', 0, 0, 24, 20)])).toEqual([])
  })
  it('an overlap is caught', () => expect(tilingProblems([R('a', 0, 0, 12, 10), R('b', 6, 0, 12, 10)])).toEqual(['a overlaps b']))
  it('a gap is caught (the third chart only half as wide as the row above)', () => {
    expect(tilingProblems([R('a', 0, 0, 12, 10), R('b', 12, 0, 12, 10), R('c', 0, 10, 12, 10)])[0]).toMatch(/a gap/)
  })
  it('a chart that touches only at an edge is not an overlap', () => expect(tilingProblems([R('a', 0, 0, 12, 10), R('b', 12, 0, 12, 10)])).toEqual([]))
  it('no charts is a problem, never a pass', () => expect(tilingProblems([])).toEqual(['no charts']))
})

describe('capreg charts.sizes', () => {
  it('is order-free and exact', () => {
    expect(sizesOf(GW19)).toEqual(['12x10', '12x10', '24x10'])
    expect(sizesOf([...GW19].reverse())).toEqual(sizesOf(GW19))
    expect(sizesOf([R('a', 0, 0, 12, 10), R('b', 12, 0, 12, 10), R('c', 0, 10, 12, 10), R('d', 12, 10, 12, 10)])).not.toEqual(sizesOf(GW19))
  })
})
