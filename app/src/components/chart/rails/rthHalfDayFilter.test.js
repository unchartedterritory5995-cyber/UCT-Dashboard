// RAIL — ONE RTH VIEW TEST, HALF-DAY AWARE, IN PARITY WITH THE SERVER'S SESSION GRID.
//
// ⛔ The defect: StockChart's regular-hours filter (and four live-writer gates, the
// engine's RTH frame and session shading) hard-coded 09:30 ≤ m < 16:00, so on an NYSE
// half-day (13:00 close: 2026-11-27, 2026-12-24) the RTH view drew the 13:00-16:00
// POST-market bars as regular session. Every reader now asks barTime.isRthBar.
//
// INVARIANT (all 365 days of 2026, every 5th minute 04:00-20:00): a bar is RTH iff
// 09:30 ≤ ET minute < the close the SERVER's session grid ends RTH at
// (tests/fixtures/bar_bucket_grid_2026.json, 60m 'rth' grid: the session-anchored run that
// starts 09:30 ends at the day's close).
import { describe, it, expect } from 'vitest'
import { isRthBar, isRthChartTime, rthCloseMinuteOfChartTime, toChartTime } from '../barTime'
import { classifySession } from '../sessionShadingPrimitive'
import { viewTailT } from '../../../utils/marketSession'
import { readRepo } from './railSupport'

const FIX = JSON.parse(readRepo('tests/fixtures/bar_bucket_grid_2026.json'))
const W0 = FIX.window_min[0]
const unixOf = (day, min) => day.base + (min - W0) * 60

// The server's RTH close for a day, read off its 60m session grid: the run starting at
// 09:30 is followed by one (possibly short) bucket that ends exactly at the close.
function serverCloseMin(day) {
  const runs = day.grids['60/rth']
  const i = runs.findIndex(([s]) => s === 570)
  if (i < 0 || i + 1 >= runs.length) throw new Error(`${day.date}: no 09:30 run`)
  const [s0, ln0, n0] = runs[i]
  const afterOpen = s0 + ln0 * n0
  const [s1, ln1, n1] = runs[i + 1]
  return s1 === afterOpen && ln1 < 60 && n1 === 1 ? s1 + ln1 : afterOpen
}

describe('isRthBar ≡ the server session grid, every day of 2026', () => {
  it('the fixture really has half-days, and they are the days the server closes at 13:00', () => {
    const half = FIX.days.filter((d) => d.half_day).map((d) => d.date)
    expect(half).toEqual(['2026-11-27', '2026-12-24'])
    for (const d of FIX.days) expect({ date: d.date, close: serverCloseMin(d) }).toEqual({ date: d.date, close: d.half_day ? 780 : 960 })
  })

  it('per minute: RTH iff 09:30 ≤ m < the server close (unix and chart-time forms agree)', () => {
    const bad = []
    for (const d of FIX.days) {
      const close = serverCloseMin(d)
      for (let m = FIX.window_min[0]; m < FIX.window_min[1]; m += 5) {
        const t = unixOf(d, m)
        const want = m >= 570 && m < close
        if (isRthBar(t) !== want || isRthChartTime(toChartTime(t)) !== want) bad.push(`${d.date} ${m}`)
      }
      if (rthCloseMinuteOfChartTime(toChartTime(unixOf(d, 600))) !== close) bad.push(`${d.date} close`)
    }
    expect(bad.slice(0, 10)).toEqual([])
  })
})

describe('the readers use it (half-day 2026-11-27, ordinary day 2026-11-25)', () => {
  const day = (iso) => FIX.days.find((d) => d.date === iso)
  it('session shading: 13:30 is POST on the half-day, regular on an ordinary day', () => {
    expect(classifySession(toChartTime(unixOf(day('2026-11-27'), 13 * 60 + 30)))).toBe('post')
    expect(classifySession(toChartTime(unixOf(day('2026-11-25'), 13 * 60 + 30)))).toBe(null)
    expect(classifySession(toChartTime(unixOf(day('2026-11-25'), 16 * 60 + 30)))).toBe('post')
    expect(classifySession(toChartTime(unixOf(day('2026-11-27'), 8 * 60)))).toBe('pre')
  })
  it('viewTailT: the RTH view of a half-day series ends at 12:55, not 15:55', () => {
    const d = day('2026-11-27')
    const bars = []
    for (let m = 240; m < 1200; m += 5) bars.push({ t: unixOf(d, m) })
    expect(viewTailT(bars, bars[bars.length - 1].t, { session: 'rth' })).toBe(unixOf(d, 12 * 60 + 55))
  })
})
