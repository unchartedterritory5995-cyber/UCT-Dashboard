/**
 * A REGULAR-SESSION CUSTOM TIMEFRAME IS BUILT FROM REGULAR-SESSION ROWS ONLY (2026-11-26).
 *
 * TradingView's SPY 240 regular-hours capture against production's served base, on the merged #2753 path: every bar START
 * matched (586/586, half-days included), but only 8 of the last 30 bars' OHLC did. The regular view's 60m answer carries
 * the extended rows too (04:00-09:00 and 16:00-20:00 beside 09:30-15:30), and `resampleForSpec` resampled them all:
 * anchored at 09:30, the 16:00 and 17:00 rows fell in the 13:30 bucket (13:30-17:30), so each regular 4h day's last bar
 * closed on the 17:00 row's close with post-market highs, lows and volume; on a half-day the 13:00 row fell in 09:30's.
 * Filtered to the regular session first, 22 of 30 matched (the 8 left: 09:30 opens a few cents apart, vendor prints, and
 * one single-row high). Synthetic prices only: every extended row carries a SENTINEL high, low, close and volume.
 *   G1 4h regular: the 13:30 bucket takes no 16:00/17:00 row (close = the 15:30 row's, volume = the regular rows')
 *   G2 a half-day (2026-11-27, 13:00 close): the 09:30 bucket takes no 13:00 row, and no bar starts at 13:30
 *   G3 2h / 3h / 45m / 65m / 195m regular on their own bases over whole extended days: no bar takes an extended row,
 *      every bar starts in the session and its members end by 16:00 (13:00 on the half-day)
 *   G4 extended specs (04:00 anchor) are unchanged, byte for byte
 *   G5 native timeframes are unchanged (no spec: the same array back)
 *   G6 other-symbol bars (secondaryBars, request.security) and benchmark tails (liveTail) on those timeframes are filtered too
 *   G7 rows the resampler cannot bucket (null, no time, a date string) are still dropped there, as before
 *   G8 a spec naming no anchor is the regular session (resampleIntradaySession's own default)
 */
import { describe, it, expect, afterEach } from 'vitest'
import { resampleForSpec, resampleIntradaySession } from './resampleBars'
import { resampleSpec, INTRADAY_ANCHOR_MIN } from '../components/chart/timeframes'
import { clearSecondaryBars, fetchSecondaryBars } from '../components/chart/engine/secondaryBars'
import { tailBarsFromWire } from '../components/chart/engine/liveTail'

afterEach(() => clearSecondaryBars())

const HALF = '2026-11-27'
const DAYS = ['2026-11-23', '2026-11-24', '2026-11-25', HALF, '2026-11-30']   // EST: ET = UTC-5
const at = (day, min) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + 5 * 3600 + min * 60
const closeOf = (day) => (day === HALF ? 780 : 960)
const SENT = { h: 999, l: 1, c: 777, v: 1e9 }

/** A day of `step`-minute rows, 04:00 to 20:00 ET. 60m follows the session grid (09:30, 10:30 ... in the session; clock
 *  hours outside it, from the close). Regular rows get real prices; extended rows the sentinels. */
function dayRows(day, step, k0 = 0) {
  const close = closeOf(day)
  let mins = []
  if (step === 60) {
    for (let m = 240; m < 570; m += 60) mins.push(m)                 // 04:00 .. 09:00
    for (let m = 570; m < close; m += 60) mins.push(m)               // 09:30 .. 15:30 (12:30 on a half-day)
    for (let m = close; m <= 1200; m += 60) mins.push(m)             // the close .. 20:00
  } else {
    for (let m = 240; m < 1200; m += step) mins.push(m)
  }
  mins = [...new Set(mins)].sort((a, b) => a - b)
  return mins.map((m, i) => {
    const regular = m >= 570 && m < close
    const p = 100 + k0 + i
    return regular
      ? { t: at(day, m), o: p, h: p + 1, l: p - 1, c: p + 0.5, v: 10 }
      : { t: at(day, m), o: p, h: SENT.h, l: SENT.l, c: SENT.c, v: SENT.v }
  })
}
const rowsOf = (step, days = DAYS) => days.flatMap((d, i) => dayRows(d, step, i * 1000))
const etMin = (t) => { const d = new Date((t - 5 * 3600) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes() }
const dayOf = (t) => new Date((t - 5 * 3600) * 1000).toISOString().slice(0, 10)
const clean = (b) => b.h !== SENT.h && b.l !== SENT.l && b.c !== SENT.c && b.v < SENT.v

describe('a regular-session custom timeframe is built from regular-session rows only', () => {
  it('G1 4h regular: the 13:30 bucket takes no 16:00 or 17:00 row', () => {
    const rows = dayRows('2026-11-24', 60)
    const out = resampleForSpec(rows, resampleSpec('240'))
    expect(out.map((b) => etMin(b.t))).toEqual([570, 810])            // 09:30 and 13:30 only
    const last = out[1]
    const r1530 = rows.find((r) => r.t === at('2026-11-24', 930))
    expect(last.c).toBe(r1530.c)                                      // closes on the 15:30 row, not the 17:00 row
    expect(last.v).toBe(30)                                           // 13:30, 14:30, 15:30
    expect(clean(last)).toBe(true)
  })

  it('G2 a half-day: the 09:30 bucket takes no 13:00 row, and no bar starts at 13:30', () => {
    const rows = dayRows(HALF, 60)
    const out = resampleForSpec(rows, resampleSpec('240'))
    expect(out.map((b) => etMin(b.t))).toEqual([570])
    expect(out[0].c).toBe(rows.find((r) => r.t === at(HALF, 750)).c)  // the 12:30 row's close
    expect(out[0].v).toBe(40)
    expect(clean(out[0])).toBe(true)
  })

  it.each([['120', 60], ['180', 60], ['45', 15], ['65', 5], ['195', 15]])(
    'G3 %sm regular on its base: no extended row in any bar, every bar inside the session',
    (tf, base) => {
      const spec = resampleSpec(tf)
      expect(spec.base).toBe(String(base))
      const out = resampleForSpec(rowsOf(base), spec)
      expect(out.length).toBeGreaterThan(0)
      for (const b of out) {
        const day = dayOf(b.t)
        expect([tf, day, etMin(b.t), clean(b)]).toEqual([tf, day, etMin(b.t), true])
        expect(etMin(b.t)).toBeGreaterThanOrEqual(570)
        expect(etMin(b.t)).toBeLessThan(closeOf(day))
      }
    })

  it('G4 extended specs are unchanged, byte for byte', () => {
    for (const [tf, base] of [['240', 60], ['120', 60], ['45', 15], ['65', 5], ['195', 15]]) {
      const rows = rowsOf(base)
      const spec = resampleSpec(tf, { extended: true })
      expect(spec.anchorMin).toBe(INTRADAY_ANCHOR_MIN.extended)
      expect(JSON.stringify(resampleForSpec(rows, spec)))
        .toBe(JSON.stringify(resampleIntradaySession(rows, spec.minutes, { anchorMin: spec.anchorMin })))
    }
  })

  it('G5 native timeframes are unchanged: no spec, the same array back', () => {
    for (const tf of ['1', '5', '15', '30', '60']) {
      const rows = rowsOf(Number(tf) >= 60 ? 60 : Number(tf), ['2026-11-24'])
      expect(resampleSpec(tf)).toBe(null)
      expect(resampleForSpec(rows, resampleSpec(tf))).toBe(rows)
    }
  })

  it('G6 other-symbol bars and benchmark tails on a regular custom timeframe are filtered too', async () => {
    // (other-symbol bars on a 60m base are refused by name when the page holds extended rows, offSessionRowOf: a 15m
    // base, whose extended rows are on its grid, is the one that reached request.security)
    const rows15 = rowsOf(15)
    const get = (url) => {
      const q = new URL(url, 'http://x').searchParams
      return Promise.resolve({ bars: q.get('tf') === '15' ? rows15.slice(-Number(q.get('bars'))) : [] })
    }
    const entry = await fetchSecondaryBars('QQQ', '45', 400, get, { extended: false })
    expect(entry.bars.length).toBeGreaterThan(0)
    expect(entry.bars.every(clean)).toBe(true)
    const rows = rowsOf(60)
    const tail = tailBarsFromWire({ bars: rows }, '240', { extended: false })
    expect(tail.length).toBeGreaterThan(0)
    expect(tail.some((b) => b.c === SENT.c)).toBe(false)
    // the extended view keeps every row (its buckets anchor at 04:00 and include the extended hours)
    expect(tailBarsFromWire({ bars: rows }, '240', { extended: true }).some((b) => b.c === SENT.c)).toBe(true)
  })

  it('G7 rows the resampler cannot bucket are still dropped there, as before', () => {
    const rows = dayRows('2026-11-24', 60)
    const dirty = [null, { t: null, o: 1, h: 1, l: 1, c: 1, v: 1 }, { t: '2026-11-24', o: 1, h: 1, l: 1, c: 1, v: 1 }, ...rows]
    expect(resampleForSpec(dirty, resampleSpec('240'))).toEqual(resampleForSpec(rows, resampleSpec('240')))
  })

  it('G8 a spec naming no anchor is the regular session (resampleIntradaySession\'s default)', () => {
    const rows = dayRows('2026-11-24', 60)
    const out = resampleForSpec(rows, { kind: 'intradaySession', minutes: 240, base: '60' })
    expect(out.map((b) => etMin(b.t))).toEqual([570, 810])
    expect(out.every(clean)).toBe(true)
  })
})
