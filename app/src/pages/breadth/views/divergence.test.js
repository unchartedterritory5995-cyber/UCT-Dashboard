import { describe, it, expect } from 'vitest'
import { zscore, divergenceRuns } from './divergence'

describe('zscore', () => {
  it('centers on the mean and scales by the standard deviation', () => {
    expect(zscore([1, 2, 3])).toEqual([-1.224744871391589, 0, 1.224744871391589])
  })
  it('preserves gaps rather than zero-filling them', () => {
    expect(zscore([1, null, 3])[1]).toBeNull()
  })
  it('returns zeros when every value is identical (no spurious divergence)', () => {
    expect(zscore([5, 5, 5])).toEqual([0, 0, 0])
  })
})

describe('divergenceRuns', () => {
  it('flags a run only when the gap holds for minGap consecutive sessions', () => {
    const zPrice = [0, 0, 2, 2, 2, 0]
    const zPart  = [0, 0, 0, 0, 0, 0]
    expect(divergenceRuns(zPrice, zPart, 3)).toEqual([{ start: 2, end: 4, dir: 'price-leads' }])
  })
  it('does not flag a gap shorter than minGap', () => {
    expect(divergenceRuns([0, 2, 2, 0], [0, 0, 0, 0], 3)).toEqual([])
  })
  it('names the direction when breadth leads price', () => {
    const runs = divergenceRuns([0, 0, 0, 0], [2, 2, 2, 2], 3)
    expect(runs[0].dir).toBe('breadth-leads')
  })
  it('ignores sessions with a missing value instead of treating them as agreement', () => {
    expect(divergenceRuns([2, null, 2, 2], [0, 0, 0, 0], 3)).toEqual([])
  })
})
