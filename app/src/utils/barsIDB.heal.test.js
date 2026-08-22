// Rails for the stale-wrong-scale daily-bar heal (Fix C, 2026-08-19).
// _importBatch normally never-downgrades a deep-enough cached entry; it now falls
// through and REPLACES with the sanitized pack when the pack's authoritative last
// (closed) bar materially disagrees with the cached bar at that timestamp — the
// ticker-reuse-cutoff / split-heal case (WYFI cached ~$220 vs the correct ~$27).
import { describe, it, expect } from 'vitest'
import { _findRecentBarByT, _closeMismatch } from './barsIDB'

const bar = (t, c) => ({ t, o: c, h: c, l: c, c })

describe('_findRecentBarByT', () => {
  it('finds a bar at the shared timestamp near the tail', () => {
    const bars = [bar('2026-08-14', 1), bar('2026-08-17', 2), bar('2026-08-18', 3), bar('2026-08-19', 4)]
    expect(_findRecentBarByT(bars, '2026-08-18')).toEqual(bar('2026-08-18', 3))
  })
  it('returns null when the ts is older than the tail window (only scans last 8)', () => {
    const bars = Array.from({ length: 20 }, (_, i) => bar(`d${i}`, i))
    expect(_findRecentBarByT(bars, 'd0')).toBeNull()      // far from the tail
    expect(_findRecentBarByT(bars, 'd19')).toEqual(bar('d19', 19))
  })
  it('is null-safe on empty/missing input', () => {
    expect(_findRecentBarByT(null, 'd')).toBeNull()
    expect(_findRecentBarByT([bar('d', 1)], null)).toBeNull()
  })
})

describe('_closeMismatch', () => {
  it('flags a wrong-scale cached bar (WYFI ~$220 vs correct ~$27)', () => {
    expect(_closeMismatch(bar('2026-08-18', 219.74), bar('2026-08-18', 27.07))).toBe(true)
  })
  it('flags the HIVE case (~$43 vs ~$2.78)', () => {
    expect(_closeMismatch(bar('2026-08-18', 42.46), bar('2026-08-18', 2.78))).toBe(true)
  })
  it('does NOT flag a matching bar (identical closes)', () => {
    expect(_closeMismatch(bar('2026-08-18', 27.07), bar('2026-08-18', 27.07))).toBe(false)
  })
  it('does NOT flag a tiny legitimate revision (<2%, e.g. a dividend/wick tweak)', () => {
    expect(_closeMismatch(bar('2026-08-18', 100), bar('2026-08-18', 101))).toBe(false)   // 1%
  })
  it('DOES flag a >2% closed-session divergence', () => {
    expect(_closeMismatch(bar('2026-08-18', 100), bar('2026-08-18', 103))).toBe(true)    // 3%
  })
  it('is conservative when there is no shared bar to compare (returns false → keep local)', () => {
    expect(_closeMismatch(null, bar('d', 27))).toBe(false)
    expect(_closeMismatch(bar('d', 27), null)).toBe(false)
  })
  it('is null-safe on non-finite / zero closes', () => {
    expect(_closeMismatch(bar('d', NaN), bar('d', 27))).toBe(false)
    expect(_closeMismatch(bar('d', 27), bar('d', 0))).toBe(false)
  })
})
