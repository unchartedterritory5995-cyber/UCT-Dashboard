// Hardening sweep (2026-08-11, item 2): `toMs` was `Date.parse(String(v))`-only, so a
// NUMERIC unix-seconds bar time (every native intraday series) stringified to a
// 10-digit number, was fed to `Date.parse('1738800000T00:00:00Z')` (not a valid ISO
// string), and came back NaN. `nearestBarIndex` then compared a NaN diff against every
// bar, no comparison ever won `< bestDiff`, and it returned -1 for every bar — the
// gold Custom-Period-Sort line silently never drew on any intraday chart.
//
// The draw path itself is canvas/chart-ref bound (jsdom has no real 2D context and no
// lightweight-charts instance here), so this tests the extracted pure helpers directly
// — `toMs` and `nearestBarIndex` — the exact logic `barIndexForDate` used to inline.
import { describe, it, expect } from 'vitest'
import { toMs, nearestBarIndex } from './ChartVLineOverlay'

// Five RTH bars/weekday, unix SECONDS — the shape every native intraday series feeds
// this component (t < 1e12, so toMs must multiply by 1000, not hand it to Date.parse).
const INTRADAY_BARS = (() => {
  const out = []
  for (let day = Date.UTC(2026, 0, 5); out.length < 20; day += 86400000) {
    const dow = new Date(day).getUTCDay()
    if (dow === 0 || dow === 6) continue
    for (const hour of [15, 16, 17, 18, 19]) out.push({ t: (day + hour * 3600000) / 1000 })
  }
  return out
})()

// Weekday-only daily bars (real daily series skip weekends) — needed so the
// "nearest bar" test below has a genuine gap to land next to.
const DAILY_BARS = (() => {
  const out = []
  for (let day = Date.UTC(2026, 0, 5); out.length < 10; day += 86400000) {
    const dow = new Date(day).getUTCDay()
    if (dow === 0 || dow === 6) continue
    out.push({ t: new Date(day).toISOString().slice(0, 10) })
  }
  return out
})()

describe('toMs', () => {
  it('multiplies unix-SECONDS numbers (< 1e12) up to milliseconds', () => {
    expect(toMs(1738800000)).toBe(1738800000 * 1000)
  })

  it('passes a unix-MILLISECONDS number (>= 1e12) through unchanged', () => {
    const ms = 1738800000123
    expect(toMs(ms)).toBe(ms)
  })

  it('still parses a bare YYYY-MM-DD string as UTC midnight (unchanged behavior)', () => {
    expect(toMs('2026-01-05')).toBe(Date.parse('2026-01-05T00:00:00Z'))
  })

  it('still parses a full ISO string (unchanged behavior)', () => {
    const iso = '2026-01-05T19:00:00.000Z'
    expect(toMs(iso)).toBe(Date.parse(iso))
  })

  // ⛔ THE REGRESSION: before the fix, `String(1738800000)` is 10 characters, so this
  // fell into the `${s}T00:00:00Z` branch — `Date.parse('1738800000T00:00:00Z')` is
  // NaN, not a real timestamp.
  it('a numeric epoch is NOT run through Date.parse (that path returns NaN)', () => {
    expect(Number.isNaN(toMs(1738800000))).toBe(false)
  })
})

describe('nearestBarIndex', () => {
  it('resolves the correct index for numeric-seconds bars given a numeric target date', () => {
    const target = INTRADAY_BARS[7].t   // exact hit, expressed as a number
    expect(nearestBarIndex(INTRADAY_BARS, target)).toBe(7)
  })

  it('resolves the correct index for numeric-seconds bars given a string target date', () => {
    // Custom-Period Sort always hands `date` as 'YYYY-MM-DD' — the day of the first
    // bar in INTRADAY_BARS. Nearest-bar search should land on that day's first bar.
    const dayStr = new Date(INTRADAY_BARS[0].t * 1000).toISOString().slice(0, 10)
    expect(nearestBarIndex(INTRADAY_BARS, dayStr)).toBe(0)
  })

  // Regression guard: the daily/weekly (string-`t`) path must keep working exactly as
  // before — this component's other real caller (StockChart's anchorMarker) always
  // projects onto ISO strings for both `bars` and `date`.
  it('still resolves the correct index for ISO-string bars given a string target date', () => {
    expect(nearestBarIndex(DAILY_BARS, DAILY_BARS[4].t)).toBe(4)
  })

  it('picks the NEAREST bar when there is no exact match (weekend/holiday gap)', () => {
    // DAILY_BARS[4] is 2026-01-09 (a Friday); the next bar (index 5) is 2026-01-12
    // (Monday). A Saturday target should land on the Friday bar, not the Monday one.
    const saturday = '2026-01-10'
    expect(nearestBarIndex(DAILY_BARS, saturday)).toBe(4)
  })

  it('returns -1 for empty/missing bars, a missing date, or an unparseable date', () => {
    expect(nearestBarIndex([], '2026-01-05')).toBe(-1)
    expect(nearestBarIndex(null, '2026-01-05')).toBe(-1)
    expect(nearestBarIndex(DAILY_BARS, null)).toBe(-1)
    expect(nearestBarIndex(DAILY_BARS, undefined)).toBe(-1)
    expect(nearestBarIndex(DAILY_BARS, 'not-a-date')).toBe(-1)
  })
})
