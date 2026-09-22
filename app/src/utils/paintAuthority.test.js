// ── CACHE USEFULNESS IS NOT PAINT AUTHORITY ─────────────────────────────────
//
// ⛔⛔ THE PRODUCTION REPORT THESE RAILS PIN. Scanning Theme Tracker on a 5m
// chart, colder tickers painted an OLD intraday state first — sometimes
// premarket, sometimes earlier that morning — and the current candle arrived
// roughly a second later.
//
// Root cause was NOT the IDB gate (that one was already tight). It was the
// SYNC MEM CACHE, which is also a paint source and had no intraday gate at
// all: `_memTailStaleDaily` returns false immediately for any tf that is not
// 'D'. And `_memPromoteFresh` promoted an intraday entry up to
// `max(6*tf, 20min)` old — THIRTY MINUTES behind on 5m — so the ±6 neighbour
// warmer actively hoisted stale series into the fast path.
//
// The sequence the member saw:
//   handoff verifies B is current (from IDB) and commits
//   -> StockChart's first render for B has idbBars still null (async idbGet)
//   -> the selector falls through to the ungated mem entry
//   -> a stale morning frame paints
//   -> ~1s later IDB/network resolves and current candles replace it
//
// A stale cache remains USEFUL: it seeds `since=` repair and keeps payloads
// small. It simply may not BE the visible frame.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isCurrentEnoughForPaint, expectedBarsBehind } from './marketSession'

// Mid-session Wednesday, so there is a real frontier to be behind.
const NOW = new Date('2026-09-16T15:55:00-04:00').getTime()
const at = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return Math.floor(new Date(`2026-09-16T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-04:00`).getTime() / 1000)
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

describe('the mem-promotion gate — a warmed intraday ticker means CURRENT', () => {
  // The exact predicate prefetchBars._memPromoteFresh now uses for intraday.
  const promote = (tf, lastT) => isCurrentEnoughForPaint(lastT, tf)

  it('⛔ THE OLD RULE PROMOTED HALF-HOUR-OLD 5m DATA — the new one refuses', () => {
    const halfHourBehind = at('15:25')
    // The retired rule, restated so the regression is visible, not asserted:
    const oldRule = (Date.now() / 1000 - halfHourBehind) <= Math.max(6 * 300, 20 * 60)
    expect(oldRule).toBe(true)                 // it really did allow this
    expect(promote('5', halfHourBehind)).toBe(false)   // and now it does not
  })

  it('a premarket tail is refused on an afternoon chart', () => {
    expect(promote('5', at('08:30'))).toBe(false)
  })

  it('an earlier-this-morning tail is refused', () => {
    expect(promote('5', at('10:00'))).toBe(false)
    expect(expectedBarsBehind(at('10:00'), '5')).toBeGreaterThan(1)
  })

  it('⭐ a tail AT the frontier is promoted — the fast path must stay fast', () => {
    const frontier = at('15:50')
    expect(promote('5', frontier)).toBe(true)
  })

  it('one bucket behind is still promoted: expectation is not existence', () => {
    // An illiquid name with no print in the newest bucket must not be locked
    // out of the sync cache forever.
    expect(promote('5', at('15:45'))).toBe(true)
  })

  it('every intraday timeframe agrees — the rule is canonical, not 5m-only', () => {
    for (const tf of ['1', '5', '15', '30', '60']) {
      expect(promote(tf, at('10:00'))).toBe(false)
    }
  })

  it('a non-numeric tail is refused rather than trusted', () => {
    expect(promote('5', undefined)).toBe(false)
    expect(promote('5', '2026-09-16')).toBe(false)
  })
})

describe('NEGATIVE CONTROL — the rails detect a bypassed gate', () => {
  // §30: prove the check can FAIL. If weakening the gate does not flip these,
  // the rails above are decoration.
  it('a deliberately widened tolerance ACCEPTS the stale frame the product rejects', () => {
    const stale = at('10:00')
    expect(isCurrentEnoughForPaint(stale, '5')).toBe(false)
    // Widen it past the real gap and the same input passes — which is exactly
    // the "relabel stale as current" failure mode the brief forbids.
    const behind = expectedBarsBehind(stale, '5')
    expect(isCurrentEnoughForPaint(stale, '5', { toleranceBars: behind })).toBe(true)
  })

  it('a gate that ignored its input would pass everything — it does not', () => {
    const verdicts = ['08:30', '10:00', '15:25', '15:45', '15:50']
      .map(t => isCurrentEnoughForPaint(at(t), '5'))
    // Non-vacuity: a mix of both answers proves the predicate reads its input.
    expect(new Set(verdicts).size).toBe(2)
  })
})
