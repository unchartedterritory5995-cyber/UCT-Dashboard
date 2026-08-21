import { describe, it, expect, beforeEach } from 'vitest'
import { GRID_WARM_TFS, prefetchGridWarm, _packStillIngesting } from './prefetchBars'

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

describe('_packStillIngesting — cold-start flood guard', () => {
  beforeEach(() => { try { localStorage.clear() } catch { /* ignore */ } })

  it('is TRUE on a fresh browser (no barspack.version) → background warms hold origin', () => {
    // The fresh-user HAR flood case: pack not yet ingested, so list-warming must not
    // race the pack to the origin.
    expect(_packStillIngesting()).toBe(true)
  })

  it('is FALSE once the daily pack has ingested (version stamped) → warming resumes', () => {
    localStorage.setItem('barspack.version', '2026-08-21')
    expect(_packStillIngesting()).toBe(false)
  })
})
