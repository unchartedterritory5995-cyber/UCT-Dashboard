/**
 * The three-way tail classification — the seam that makes an authoritative
 * session tail possible.
 *
 * ⛔ THE DEFECT IT REPLACES. `isIntradayTailStale` answered one bit, so a cache
 * that was merely BEHIND (continuous history that stopped three hours ago) was
 * treated exactly like one missing a whole session: drop `since=`, re-download
 * the entire window. That is "re-download thousands of bars to obtain today's
 * last twenty" — the request is biggest precisely when the user is waiting, and
 * sound history is discarded to recover a handful of bars.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { classifyIntradayTail, isIntradayTailStale } from './marketSession'

// Tue 2026-09-15, 13:17 ET — the exact clock in the bug report.
const NOW = new Date('2026-09-15T17:17:00Z').getTime()
const et = (h, m, d = 15) => Math.floor(Date.UTC(2026, 8, d, h + 4, m) / 1000)

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

describe('classifyIntradayTail', () => {
  it('⭐ the reported case is BEHIND, not gapped — its history is sound', () => {
    expect(classifyIntradayTail(et(10, 0), '5')).toBe('behind')
  })

  it('a tail at the current bucket is fresh', () => {
    expect(classifyIntradayTail(et(13, 10), '5')).toBe('fresh')
  })

  it('a tail from an EARLIER session is gapped — continuity cannot be vouched for', () => {
    expect(classifyIntradayTail(et(15, 55, 11), '5')).toBe('gapped')   // prior Friday
  })

  it('a non-finite tail is gapped, never optimistically reused', () => {
    for (const bad of [null, undefined, NaN, 'x']) {
      expect(classifyIntradayTail(bad, '5')).toBe('gapped')
    }
  })

  it('the freshness window scales with the timeframe', () => {
    // 13:10 is 7 min back: inside 1h's tolerance, outside 1m's.
    expect(classifyIntradayTail(et(13, 10), '60')).toBe('fresh')
    expect(classifyIntradayTail(et(13, 10), '1')).toBe('behind')
  })

  it('⛔ only GAPPED may discard history — behind and fresh both keep it', () => {
    const keepsHistory = (c) => c !== 'gapped'
    expect(keepsHistory(classifyIntradayTail(et(10, 0), '5'))).toBe(true)
    expect(keepsHistory(classifyIntradayTail(et(13, 10), '5'))).toBe(true)
    expect(keepsHistory(classifyIntradayTail(et(15, 55, 11), '5'))).toBe(false)
  })

  it('isIntradayTailStale stays a projection of this, so the two cannot drift', () => {
    for (const t of [et(10, 0), et(13, 10), et(15, 55, 11), null]) {
      expect(isIntradayTailStale(t, '5')).toBe(classifyIntradayTail(t, '5') !== 'fresh')
    }
  })

  it('CONTROL — the old one-bit answer really did conflate behind with gapped', () => {
    // Both were simply "stale", which is why both lost their history.
    expect(isIntradayTailStale(et(10, 0), '5')).toBe(true)
    expect(isIntradayTailStale(et(15, 55, 11), '5')).toBe(true)
    // The classifier is what tells them apart.
    expect(classifyIntradayTail(et(10, 0), '5'))
      .not.toBe(classifyIntradayTail(et(15, 55, 11), '5'))
  })

  it('a weekend read of a complete Friday tail is fresh — no needless refetch', () => {
    vi.setSystemTime(new Date('2026-09-20T21:00:00Z').getTime())   // Sun
    expect(classifyIntradayTail(Math.floor(Date.UTC(2026, 8, 18, 23, 55) / 1000), '5')).toBe('fresh')
  })
})

describe('the IDB eviction policy rides on this classifier', () => {
  // ⚰️ THE DEFECT THE BROWSER HARNESS FOUND. `barsIDB.idbGet` gated on
  // `isIntradayTailStale`, which is true for BEHIND as well as GAPPED — so a
  // cache that was merely a few hours short was nulled at the IDB layer.
  // StockChart never saw it, never classified it, and fell back to a full
  // refetch: the session tail existed on paper and never fired.
  //
  // ⛔ EVERY UNIT TEST IN THIS FILE PASSED WHILE THAT WAS TRUE. The classifier
  // was correct in isolation; the consumer upstream of it was not. Only
  // tools/intraday_tail_harness.py caught it — FRESH sent `since=`, BEHIND did
  // not. This asserts the POLICY so the wiring has something to be wrong about.
  const evicts = (cls) => cls === 'gapped'

  it('only GAPPED may be evicted from the cache', () => {
    expect(evicts(classifyIntradayTail(et(10, 0), '5'))).toBe(false)     // behind
    expect(evicts(classifyIntradayTail(et(13, 10), '5'))).toBe(true === false)  // fresh
    expect(evicts(classifyIntradayTail(et(15, 55, 11), '5'))).toBe(true) // gapped
  })

  it('CONTROL — the old one-bit gate would have evicted BEHIND too', () => {
    expect(isIntradayTailStale(et(10, 0), '5')).toBe(true)               // would evict
    expect(evicts(classifyIntradayTail(et(10, 0), '5'))).toBe(false)     // must not
  })
})
