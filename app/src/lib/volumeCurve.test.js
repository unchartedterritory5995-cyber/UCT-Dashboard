// The browser mirror of api/services/screener/volume_curve.py. These pin the same cases
// tests/test_screener_volume_curve.py pins, so the chart header and the screener cannot
// drift apart on what "volume vs usual by now" means.
import { describe, expect, it } from 'vitest'
import { etParts, liveShare, rvolByNow, shareAt } from './volumeCurve'

const LINEAR = Array.from({ length: 391 }, (_, m) => m / 390)

describe('shareAt', () => {
  it('is blank for the first 15 minutes and linear-reads the curve after', () => {
    expect(shareAt(LINEAR, 14.9)).toBeNull()
    expect(shareAt(LINEAR, 15)).toBeCloseTo(15 / 390, 9)
    expect(shareAt(LINEAR, 72.5)).toBeCloseTo(72.5 / 390, 9)
  })
  it('scales an early close to its own length and holds at the close', () => {
    expect(shareAt(LINEAR, 105, 210)).toBeCloseTo(195 / 390, 9)
    expect(shareAt(LINEAR, 500, 210)).toBeCloseTo(1, 9)
  })
  it('refuses a malformed curve', () => {
    expect(shareAt(null, 60)).toBeNull()
    expect(shareAt(LINEAR.slice(1), 60)).toBeNull()
  })
})

describe('etParts', () => {
  it('reads the ET wall clock in both DST regimes', () => {
    expect(etParts(new Date('2026-08-24T14:42:00Z'))).toEqual({ ymd: '2026-08-24', minutes: 10 * 60 + 42 })
    expect(etParts(new Date('2026-01-15T15:42:00Z'))).toEqual({ ymd: '2026-01-15', minutes: 10 * 60 + 42 })
  })
})

describe('liveShare', () => {
  const payload = (session) => ({ curve: LINEAR, session, suppress_first_min: 15, full_session_min: 390 })
  const REGULAR = { date: '2026-08-24', open_min: 570, close_min: 960 }
  it('reads minutes since the open from the ET clock', () => {
    expect(liveShare(payload(REGULAR), new Date('2026-08-24T14:42:00Z'))).toBeCloseTo(72 / 390, 9)
  })
  it('is blank before 09:45, before the open, on another day, or with no curve/session', () => {
    expect(liveShare(payload(REGULAR), new Date('2026-08-24T13:40:00Z'))).toBeNull()   // 09:40
    expect(liveShare(payload(REGULAR), new Date('2026-08-24T12:00:00Z'))).toBeNull()   // 08:00
    expect(liveShare(payload(REGULAR), new Date('2026-08-25T14:42:00Z'))).toBeNull()   // stale payload
    expect(liveShare(payload(null), new Date('2026-08-24T14:42:00Z'))).toBeNull()
    expect(liveShare({ ...payload(REGULAR), curve: null }, new Date('2026-08-24T14:42:00Z'))).toBeNull()
    expect(liveShare(null)).toBeNull()
  })
  it('scales a half-day to its own close', () => {
    const half = { date: '2025-11-28', open_min: 570, close_min: 780 }
    // 12:00 EST = 17:00Z, minute 150 of 210
    expect(liveShare(payload(half), new Date('2025-11-28T17:00:00Z'))).toBeCloseTo((150 * 390) / 210 / 390, 9)
  })
})

describe('rvolByNow', () => {
  it('is today over the usual volume by now, 2 dp', () => {
    expect(rvolByNow(1_000_000, 2_000_000, 72 / 390)).toBe(2.71)
  })
  it('refuses any missing or non-positive input', () => {
    for (const args of [[0, 1, 0.5], [1, 0, 0.5], [1, 1, 0], [null, 1, 0.5], [1, undefined, 0.5], [1, 1, null]]) {
      expect(rvolByNow(...args)).toBeNull()
    }
  })
})
