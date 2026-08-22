import { describe, it, expect, beforeEach } from 'vitest'
import {
  GRID_WARM_TFS, prefetchGridWarm, _packStillIngesting,
  _noteWarmResult, _holdBackgroundWarm,
} from './prefetchBars'

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

describe('_holdBackgroundWarm — server backpressure (503 shed)', () => {
  beforeEach(() => {
    try { localStorage.setItem('barspack.version', '2026-08-21') } catch { /* ignore */ }
    _noteWarmResult({ bars: [{ t: 1 }] }) // clear any backoff from a prior test
  })

  it('a 503 shed ({error:"warming"}) engages the hold; a real success clears it', () => {
    expect(_holdBackgroundWarm()).toBe(false)      // healthy server, pack ingested
    _noteWarmResult({ bars: [], error: 'warming' }) // server said back off
    expect(_holdBackgroundWarm()).toBe(true)        // background warms now hold
    _noteWarmResult({ bars: [{ t: 1 }] })           // genuine data → server healthy
    expect(_holdBackgroundWarm()).toBe(false)       // warming resumes
  })

  it('a null/failed warm result also engages the hold', () => {
    _noteWarmResult(null)
    expect(_holdBackgroundWarm()).toBe(true)
  })

  it('the pack-ingest gate holds even when the server is healthy', () => {
    localStorage.removeItem('barspack.version')
    _noteWarmResult({ bars: [{ t: 1 }] })           // no backoff
    expect(_holdBackgroundWarm()).toBe(true)        // still held by pack-ingest
  })
})
