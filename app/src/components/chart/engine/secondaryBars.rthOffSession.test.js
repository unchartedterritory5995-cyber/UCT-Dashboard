/**
 * OTHER-SYMBOL BARS ON A REGULAR-SESSION CUSTOM TIMEFRAME, ON A 60m BASE (2026-11-26, follow-up to the regular-rows fix).
 *
 * A regular 2h/3h/4h is built from 60m rows on the session grid (09:30, 10:30 ... 15:30). A stock's page carries its
 * extended hours beside them (04:00-09:00 and 16:00-20:00, clock hours, off the 09:30 grid), and `offSessionRowOf`
 * refused the whole window over them by name ("not built here"): request.security on a regular 4h answered nothing for
 * any symbol with extended rows. The resample now uses the regular-session rows only, so only those are judged.
 *   O1 a stock's page (regular rows plus clock-hour extended rows and a 20:00 row) is AVAILABLE on regular 4h/3h/2h
 *      (red before: refused by name)
 *   O2 and its bars are the chart's own regular custom-timeframe bars for the same rows (resampleForSpec)
 *   O3 extended specs are judged as before: every row (an off-grid pre-market row still refuses the 04:00 grid)
 *   O4 a base that truly cannot build it is still refused: clock hours inside the session (a 24-hour symbol), a weekend row
 *      (in the session's hours or not)
 *   O5 a page with NO regular-session row is judged on its extended rows as before: a lone clock-hour or overnight row,
 *      or a page of extended rows only, is another session (coordinator ruling 2026-11-22)
 */
import { afterEach, describe, expect, it } from 'vitest'
import { SOURCE_STATUS, clearSecondaryBars, fetchSecondaryBars, offSessionRowOf } from './secondaryBars'
import { resampleSpec } from '../timeframes'
import { resampleForSpec } from '../../../utils/resampleBars'

afterEach(() => clearSecondaryBars())

const DAYS = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']   // EST: ET = UTC-5
const at = (day, min) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + 5 * 3600 + min * 60

/** A stock's 60m page on the session grid: clock hours 04:00-09:00, the session 09:30-15:30, clock hours 16:00-20:00. */
function stockPage(days = DAYS) {
  const out = []
  let k = 0
  for (const d of days) {
    const mins = [240, 300, 360, 420, 480, 540, 570, 630, 690, 750, 810, 870, 930, 960, 1020, 1080, 1140, 1200]
    for (const m of mins) {
      const p = 100 + k++
      const regular = m >= 570 && m < 960
      out.push({ t: at(d, m), o: p, h: regular ? p + 1 : 999, l: regular ? p - 1 : 1, c: regular ? p + 0.5 : 777, v: regular ? 10 : 1e9 })
    }
  }
  return out
}
const routeOf = (rows) => (url) => {
  const q = new URL(url, 'http://x').searchParams
  return Promise.resolve({ bars: q.get('tf') === '60' ? rows.slice(-Number(q.get('bars'))) : [] })
}

describe('other-symbol bars on a regular custom timeframe judge only the rows it keeps', () => {
  it.each(['240', '180', '120'])('O1 + O2 %s regular: a stock\'s page is available, and its bars are the chart\'s own', async (tf) => {
    const rows = stockPage()
    const spec = resampleSpec(tf)
    expect(spec.base).toBe('60')
    expect(offSessionRowOf(rows, spec)).toBe(null)
    const entry = await fetchSecondaryBars('QQQ', tf, 2000, routeOf(rows), { extended: false })   // a page that does not fill
    expect(entry.status).toBe(SOURCE_STATUS.AVAILABLE)
    expect(entry.bars).toEqual(resampleForSpec(rows, spec))
    expect(entry.bars.length).toBeGreaterThan(0)
    expect(entry.bars.some((b) => b.h === 999 || b.l === 1 || b.c === 777)).toBe(false)
  })

  it('O3 extended specs are judged as before: every row', () => {
    const clock = DAYS.flatMap((d) => Array.from({ length: 16 }, (_, i) => ({ t: at(d, 240 + i * 60), o: 1, h: 1, l: 1, c: 1, v: 1 })))
    const ext = resampleSpec('240', { extended: true })
    expect(offSessionRowOf(clock, ext)).toBe(null)                                    // the clock grid builds it
    const stray = [...clock, { t: at('2026-11-18', 330), o: 1, h: 1, l: 1, c: 1, v: 1 }].sort((a, b) => a.t - b.t)   // 05:30
    expect(offSessionRowOf(stray, ext)).toMatch(/at 05:30 ET/)                       // an off-grid pre-market row refuses it
    expect(offSessionRowOf(stockPage(), ext)).toMatch(/at 09:30 ET/)                 // the session grid is not the clock grid
  })

  it('O4 a base that truly cannot build it is still refused', () => {
    const spec = resampleSpec('240')
    // a 24-hour symbol: clock hours every hour, the session's included (10:00 is off the 09:30 grid)
    const clockAll = DAYS.flatMap((d) => Array.from({ length: 24 }, (_, h) => ({ t: at(d, h * 60), o: 1, h: 1, l: 1, c: 1, v: 1 })))
    expect(offSessionRowOf(clockAll, spec)).toMatch(/at 10:00 ET/)
    // a weekend row in the session's hours
    const weekend = [...stockPage(), { t: at('2026-11-21', 630), o: 1, h: 1, l: 1, c: 1, v: 1 }]
    expect(offSessionRowOf(weekend, spec)).toMatch(/on a Sat/)
    // a weekend row OUTSIDE the session's hours too (an extended hour is skipped only on a weekday)
    expect(offSessionRowOf([...stockPage(), { t: at('2026-11-21', 480), o: 1, h: 1, l: 1, c: 1, v: 1 }], spec)).toMatch(/at 08:00 ET on a Sat/)
  })

  it('O5 a page with no regular-session row is judged on its extended rows, as before (another session)', () => {
    const spec = resampleSpec('240')
    expect(offSessionRowOf([{ t: at('2026-11-16', 540), o: 1, h: 1, l: 1, c: 1, v: 1 }], spec)).toMatch(/at 09:00 ET/)   // a lone clock hour
    expect(offSessionRowOf([{ t: at('2026-11-16', 150), o: 1, h: 1, l: 1, c: 1, v: 1 }], spec)).toMatch(/at 02:30 ET/)   // overnight
    const extOnly = stockPage().filter((r) => { const m = (r.t - 5 * 3600) % 86400 / 60; return m < 570 || m >= 960 })
    expect(offSessionRowOf(extOnly, spec)).toMatch(/at 04:00 ET/)
  })
})
