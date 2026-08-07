// app/src/pages/breadth/ftdMarkers.test.js
import { describe, it, expect } from 'vitest'
import { ftdMarkers } from './ftdMarkers'

/** rows with is_ftd true at the given indices, dates d000..dNNN */
const build = (n, hits) =>
  Array.from({ length: n }, (_, i) => ({
    date: `d${String(i).padStart(3, '0')}`,
    is_ftd: hits.includes(i),
  }))

describe('ftdMarkers', () => {
  it('returns nothing when no session is a follow-through day', () => {
    expect(ftdMarkers(build(10, []))).toEqual([])
  })

  it('marks every hit but labels only the first of a cluster', () => {
    const out = ftdMarkers(build(10, [2, 3, 4]))
    expect(out.map(m => m.date)).toEqual(['d002', 'd003', 'd004'])
    expect(out.map(m => m.label)).toEqual([true, false, false])
  })

  it('reopens labelling after a gap of five sessions', () => {
    expect(ftdMarkers(build(20, [2, 7])).map(m => m.label)).toEqual([true, true])
    expect(ftdMarkers(build(20, [2, 6])).map(m => m.label)).toEqual([true, false])
  })

  // The real series: seven hits dating the April bottom, one on 2026-08-04.
  // Unthinned this stacks seven labels into mush inside three weeks.
  it('thins the measured April cluster to two labels', () => {
    const out = ftdMarkers(build(151, [66, 69, 70, 71, 73, 76, 78, 148]))
    expect(out).toHaveLength(8)
    expect(out.filter(m => m.label).map(m => m.date)).toEqual(['d066', 'd148'])
  })

  it('ignores rows where the flag is absent or falsy rather than true', () => {
    const rows = [{ date: 'a' }, { date: 'b', is_ftd: false }, { date: 'c', is_ftd: 1 }]
    expect(ftdMarkers(rows)).toEqual([])
  })

  it('tolerates an empty or missing row list', () => {
    expect(ftdMarkers([])).toEqual([])
    expect(ftdMarkers(undefined)).toEqual([])
  })
})
