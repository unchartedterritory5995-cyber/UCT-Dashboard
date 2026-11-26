/**
 * SMOOTHNESS PART 2, ITEM (3): THE REGULAR-SESSION TEST KEEPS ONE DAY'S WINDOW (2026-11-26).
 *
 * Trace (local dist 4bc325e4ae, 5 traced switches per board): `sessionBarsOf` (StockChart's session view and the
 * neighbor-frames preparer) passed every bar through `foldOffGridBars` and `keepRthBars` for each new bars array, 2-3.5 ms
 * a flip, each bar an ET offset lookup, an ET minute and a session-close lookup. Inside a stretch where the ET offset and
 * the ET date are constant, "regular session" is two compares against two unix seconds of that date.
 *   W1 isRthBar answers what it did (the reference is its body as it was, ed7605b405) for every minute of a regular day,
 *      a half-day, both DST-change days and their neighbours, a holiday and a weekend, in time order, reversed and
 *      shuffled; for seeded seconds 1990-2035; fractional seconds; and anything that is not a finite number
 *   W2 the bars of one day after its first take no arithmetic (red before the change: an offset, a minute and a close each)
 *   W3 offGrid answers what it did for every timeframe and every 30-minute slot of those days (the 60m session grid's :30
 *      test is the regular-session test, read for read)
 */
import { describe, it, expect, vi } from 'vitest'
import { isRthBar, isRthChartTime, toChartTime, etMinuteOfDay, rthCloseMinuteOf, keepRthBars } from './barTime'
import { offGrid } from './offGridBars'

// the references: as they were (ed7605b405)
const refIsRthBar = (u) => {
  if (typeof u !== 'number' || !Number.isFinite(u)) return false
  return isRthChartTime(toChartTime(u))
}
const STEP = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600 }
const refOffGrid = (t, tf) => {
  if (tf !== '60') return t % STEP[tf] !== 0
  if (t % 1800 !== 0) return true
  if (t % 3600 === 0) return false
  const m = etMinuteOfDay(t)
  return !(m >= 570 && m < rthCloseMinuteOf(t))
}

const DAYS = ['2026-11-24', '2026-11-27', '2026-12-24', '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09',
  '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-26', '2026-11-28', '2008-03-10', '2030-11-03']
// every minute of each day (UTC midnight -6 h .. +30 h, so each ET day is covered whole whatever the offset)
const minutesOf = (day) => {
  const z = Date.parse(`${day}T00:00:00Z`) / 1000
  const out = []
  for (let t = z - 6 * 3600; t < z + 30 * 3600; t += 60) out.push(t)
  return out
}
let seed = 20261126
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const check = (ts, label) => {
  for (const t of ts) {
    const got = isRthBar(t), want = refIsRthBar(t)
    if (got !== want) expect([label, t, got]).toEqual([label, t, want])
  }
}

describe('the regular-session test keeps one day\'s window', () => {
  it('W1 isRthBar answers as before: every minute of the days above in any order; seeded seconds; odd inputs', () => {
    const all = DAYS.flatMap(minutesOf)
    check(all, 'in time order')
    check([...all].reverse(), 'reversed')
    const shuffled = [...all]
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]] }
    check(shuffled, 'shuffled')
    const seeded = []
    for (let i = 0; i < 20000; i++) seeded.push(Date.parse('1990-01-01T00:00:00Z') / 1000 + Math.floor(rnd() * 46 * 365.25 * 86400))
    check(seeded, 'seeded')
    check(seeded.map((t) => t + 0.5), 'fractional')
    check(all.filter((_, i) => i % 7 === 0).map((t) => t + 59.999), 'last fraction of a minute')
    for (const odd of [NaN, Infinity, -Infinity, '1764000000', null, undefined, {}, 1764000000n]) {
      let got, want
      try { got = isRthBar(odd) } catch (e) { got = `throws ${e?.constructor?.name}` }
      try { want = refIsRthBar(odd) } catch (e) { want = `throws ${e?.constructor?.name}` }
      expect([String(odd), got]).toEqual([String(odd), want])
    }
  })

  it('W2 the bars of one day after its first take no arithmetic', () => {
    const day = minutesOf('2026-11-24').filter((t) => t >= Date.parse('2026-11-24T09:00:00Z') / 1000 && t < Date.parse('2026-11-24T23:00:00Z') / 1000)
    const bars = day.map((t) => ({ t }))
    isRthBar(day[0])                                     // the day's first bar builds its window
    const spy = vi.spyOn(Math, 'floor')
    let n = -1, kept
    try {
      kept = keepRthBars(bars)
      n = spy.mock.calls.length                          // read BEFORE mockRestore, which resets it
    } finally { spy.mockRestore() }
    expect(kept.length).toBe(390)                        // 14:30Z .. 21:00Z: the regular session, 09:30-16:00 ET
    expect(n).toBe(0)
  })

  it('W3 offGrid answers as before for every timeframe and every 30-minute slot', () => {
    for (const tf of ['1', '5', '15', '30', '60']) {
      for (const day of DAYS) {
        for (const t of minutesOf(day)) {
          for (const x of [t, t + 30, t + 0.5]) {
            if (offGrid(x, tf) !== refOffGrid(x, tf)) expect([tf, x, offGrid(x, tf)]).toEqual([tf, x, refOffGrid(x, tf)])
          }
        }
      }
    }
  })
})
