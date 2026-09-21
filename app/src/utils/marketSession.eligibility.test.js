// ── "Current enough to be the FIRST THING THE USER SEES" ─────────────────────
//
// The defect: opening MU at 15:55 ET with a cache whose newest bar was 10:00
// painted SIX HOURS of missing price action as though it were the present
// session, then caught up ~0.5s later. Every existing gate passed it, because
// every existing gate was asking `classifyIntradayTail` — which answers "is
// this a sound base for repair?" (it is) and not "may this be shown?" (it is
// not). These rails pin the second question as its own property.

import { describe, test, expect, vi, afterEach } from 'vitest'
import {
  expectedBarsBehind, isCurrentEnoughForPaint, expectedLatestCompletedBar,
  classifyIntradayTail,
} from './marketSession'

// A Wednesday, regular session. 1568...: 2026-09-16 is a Wednesday.
const at = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(`2026-09-16T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00-04:00`).getTime()
}
const bar = (hhmm) => Math.floor(at(hhmm) / 1000)

afterEach(() => { vi.useRealTimers() })

describe('expectedBarsBehind — counted in BUCKETS, not wall-clock seconds', () => {
  test('a tail at the frontier is zero behind', () => {
    const now = at('15:55')
    const frontier = expectedLatestCompletedBar('5', now)
    expect(expectedBarsBehind(frontier, '5', now)).toBe(0)
  })

  test('THE MU CASE: a 10:00 tail on 5m at 15:55 is ~70 buckets behind', () => {
    const n = expectedBarsBehind(bar('10:00'), '5', at('15:55'))
    // 10:00 → 15:50 frontier = 70 five-minute buckets.
    expect(n).toBe(70)
  })

  test('one bucket behind is one, not a rounded-up guess', () => {
    const now = at('15:55')
    const frontier = expectedLatestCompletedBar('5', now)   // 15:45..15:50 → 15:45? frontier start
    expect(expectedBarsBehind(frontier - 1, '5', now)).toBe(1)
  })

  test('a null expectation (weekend) is reported as null, never as 0', () => {
    const sat = new Date('2026-09-19T12:00:00-04:00').getTime()
    expect(expectedBarsBehind(bar('10:00'), '5', sat)).toBeNull()
  })

  test('a non-finite tail is Infinity behind, not 0', () => {
    expect(expectedBarsBehind(undefined, '5', at('15:55'))).toBe(Infinity)
  })

  test('⛔ the opening bucket is irregular on tf=60 and is walked, not divided', () => {
    // 09:30-10:00 is a THIRTY minute bucket. At 11:05 the frontier is the
    // 10:00-11:00 bar; a 09:30 tail is exactly ONE bucket behind, and naive
    // (frontier - lastT)/3600 would say 0.5 and round wrong.
    expect(expectedBarsBehind(bar('09:30'), '60', at('11:05'))).toBe(1)
  })
})

describe('isCurrentEnoughForPaint — the FIRST VISIBLE FRAME gate', () => {
  test('⛔⛔ the MU cache is NOT eligible to paint', () => {
    expect(isCurrentEnoughForPaint(bar('10:00'), '5', { nowMs: at('15:55') })).toBe(false)
  })

  test('…yet it REMAINS a sound repair base — the two answers stay separate', () => {
    // ⚠️ FAKE CLOCK REQUIRED: `classifyIntradayTail` reads Date.now() internally
    // rather than taking an instant, so without this it judges a 2026-09-16 tail
    // against the real today and correctly says 'gapped' — a fact about the test
    // clock, not about the cache under test.
    vi.useFakeTimers()
    vi.setSystemTime(at('15:55'))
    try {
      // If this ever becomes 'gapped' the cache would be DISCARDED, and we would be
      // back to re-downloading the whole window to recover today's last twenty bars.
      // Sound-as-a-repair-base and eligible-to-paint must stay two separate answers.
      expect(classifyIntradayTail(bar('10:00'), '5')).toBe('behind')
      expect(isCurrentEnoughForPaint(bar('10:00'), '5', { nowMs: at('15:55') })).toBe(false)
    } finally { vi.useRealTimers() }
  })

  test('a tail at the frontier is eligible', () => {
    const now = at('15:55')
    expect(isCurrentEnoughForPaint(expectedLatestCompletedBar('5', now), '5', { nowMs: now })).toBe(true)
  })

  test('⚠️ ONE bucket of tolerance: an illiquid name with no print in the newest bucket still paints', () => {
    const now = at('15:55')
    const frontier = expectedLatestCompletedBar('5', now)
    expect(isCurrentEnoughForPaint(frontier - 1, '5', { nowMs: now })).toBe(true)
  })

  test('two buckets behind is NOT eligible at the default tolerance', () => {
    const now = at('15:55')
    const f = expectedLatestCompletedBar('5', now)
    const twoBack = f - 6 * 60   // comfortably two 5m buckets back
    expect(expectedBarsBehind(twoBack, '5', now)).toBeGreaterThanOrEqual(2)
    expect(isCurrentEnoughForPaint(twoBack, '5', { nowMs: now })).toBe(false)
  })

  test('tolerance is a parameter, so the latency tradeoff can be MEASURED not argued', () => {
    const now = at('15:55')
    const f = expectedLatestCompletedBar('5', now)
    expect(isCurrentEnoughForPaint(f - 1, '5', { nowMs: now, toleranceBars: 0 })).toBe(false)
    expect(isCurrentEnoughForPaint(f - 1, '5', { nowMs: now, toleranceBars: 1 })).toBe(true)
  })

  test('⭐ market shut → eligible. Nothing newer exists, so blocking on a fetch is pure latency', () => {
    const sat = new Date('2026-09-19T12:00:00-04:00').getTime()
    expect(isCurrentEnoughForPaint(bar('10:00'), '5', { nowMs: sat })).toBe(true)
  })

  test('every intraday timeframe agrees on the MU case — the rule is not per-tf tuned', () => {
    for (const tf of ['1', '5', '15', '30', '60']) {
      expect(isCurrentEnoughForPaint(bar('10:00'), tf, { nowMs: at('15:55') })).toBe(false)
    }
  })

  test('…and every one of them accepts its own frontier', () => {
    const now = at('15:55')
    for (const tf of ['1', '5', '15', '30', '60']) {
      const f = expectedLatestCompletedBar(tf, now)
      expect(isCurrentEnoughForPaint(f, tf, { nowMs: now })).toBe(true)
    }
  })
})
