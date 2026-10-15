// The chart header's RVOL is the screener's live `rvol_live` ("volume vs usual by now"):
// today's volume over (30-session average × the share of a normal day usually done by
// this minute). Before 9:45 ET, outside the session, or with no stored curve it is
// blank — never the raw today/full-day ratio, which reads ~0.8x at 10:00 for a 3x name.
import { describe, expect, it } from 'vitest'
import { CURVE_HEADER_KEYS, META_HEADER_KEYS, QUOTE_HEADER_KEYS, resolveHeaderField } from './headerFields'

const LINEAR = Array.from({ length: 391 }, (_, m) => m / 390)
const volCurve = { curve: LINEAR, session: { date: '2026-08-24', open_min: 570, close_min: 960 }, suppress_first_min: 15, full_session_min: 390 }
const AT_1042 = new Date('2026-08-24T14:42:00Z')
const ctx = (over = {}) => ({
  quote: { volume: 1_000_000 },
  meta: { avg_vol_30d: 2_000_000, avg_vol_20d: 500_000 },
  volCurve,
  now: AT_1042,
  ...over,
})

describe("header field 'rvol'", () => {
  it('divides by the usual volume BY NOW, not by a full day', () => {
    // 1e6 / (2e6 × 72/390) = 2.71 -> "2.7x". The old raw ratio would read 0.5x.
    expect(resolveHeaderField('rvol', ctx()).value).toBe('2.7x')
  })
  it('uses the 30-session average (the screener\'s), never the 20-session one', () => {
    expect(resolveHeaderField('rvol', ctx({ meta: { avg_vol_20d: 500_000 } })).value).toBeNull()
    expect(resolveHeaderField('rvol', ctx({ meta: { avg_vol_30d: 4_000_000 } })).value).toBe('1.4x')
  })
  it('is blank before 9:45 ET, with no curve, on a non-session day, or with no volume', () => {
    expect(resolveHeaderField('rvol', ctx({ now: new Date('2026-08-24T13:40:00Z') })).value).toBeNull()
    expect(resolveHeaderField('rvol', ctx({ volCurve: null })).value).toBeNull()
    expect(resolveHeaderField('rvol', ctx({ volCurve: { ...volCurve, session: null } })).value).toBeNull()
    expect(resolveHeaderField('rvol', ctx({ quote: {} })).value).toBeNull()
  })
  it('still needs the quote and the meta, and now the curve', () => {
    expect(QUOTE_HEADER_KEYS.has('rvol')).toBe(true)
    expect(META_HEADER_KEYS.has('rvol')).toBe(true)
    expect(CURVE_HEADER_KEYS.has('rvol')).toBe(true)
    expect(CURVE_HEADER_KEYS.has('vol')).toBe(false)
  })
})
