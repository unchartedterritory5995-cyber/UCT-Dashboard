import { describe, it, expect } from 'vitest'
import { GRID_WARM_TFS, prefetchGridWarm } from './prefetchBars'

describe('grid warm timeframe coverage', () => {
  it('GRID_WARM_TFS covers all 8 timeframes including W, M and 1', () => {
    expect(new Set(GRID_WARM_TFS)).toEqual(new Set(['D', '5', '15', '30', '60', 'W', 'M', '1']))
    expect(GRID_WARM_TFS.length).toBe(8)          // no dups
  })

  it('prefetchGridWarm is a no-op on empty/nullish input (never throws)', () => {
    expect(() => prefetchGridWarm([])).not.toThrow()
    expect(() => prefetchGridWarm(undefined)).not.toThrow()
  })
})
