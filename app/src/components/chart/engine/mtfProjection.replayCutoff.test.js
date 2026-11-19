// AUDIT #1292 question 2 — evidence on the code as it is on master (both modules are untouched by D20): under a Replay Mode
// cutoff, is a HIGHER-timeframe calculation frame cut at the cutoff, and can a weekly / monthly / daily-calculated value on a
// visible bar use a session after it?
//   · The frame is NOT cut: its request has no `to` (secondaryBars.secondaryBarsUrl) — it holds the bars after the cutoff.
//   · No visible bar shows a value from the cutoff's own period or later: mtfProjection shows on each chart bar the value of
//     the last higher-timeframe period that had CLOSED before the chart bar's period began. Proven below by changing every
//     frame value from the cutoff's period on: not one projected value on the visible bars moves.
//   · (Caveat, not covered here: a column whose value at period j is itself computed from LATER frame bars — a non-causal
//     study, e.g. one plotted with a negative offset — would carry that look-ahead into a closed period's value.)
import { describe, it, expect } from 'vitest'
import { projectFrameColumns } from './mtfProjection'
import { secondaryBarsUrl } from './secondaryBars'
import * as O from '../__tests__/replayOracle'

const DAYS = O.sessions('2026-02-02', '2026-04-24')
const WEEKS = O.dwmBars(DAYS, 'W')                        // Friday-keyed, through Apr 24 (fetched with no `to`)
const MONTHS = O.dwmBars(DAYS, 'M')
const daily = (cut) => O.dwmBars(DAYS, 'D').filter(b => b.t <= cut)

function project(frameBars, frame, chartBars, chartTf, mutateFrom = null) {
  const col = Float64Array.from(frameBars.map((b, j) => (mutateFrom != null && j >= mutateFrom ? 1e9 + j : j)))
  return projectFrameColumns(frameBars, { v: col }, frame, chartBars, chartTf, { newestFinal: true }).columns.v
}

describe('Q2: the higher-timeframe calculation frame under a Replay Mode cutoff (master code)', () => {
  it('the frame request carries no `to`: it is NOT cut at the cutoff', () => {
    const u = secondaryBarsUrl('NVDA', 'W', 500)
    expect(u).toMatch(/tf=W&bars=500$/)
    expect(u).not.toMatch(/to=/)
  })
  it.each(['2026-03-11', '2026-03-13', '2026-04-02', '2026-04-15'])('weekly-calculated on a daily chart cut at %s: no visible bar uses the cutoff’s week or later', (cut) => {
    const chart = daily(cut)
    const base = project(WEEKS, 'W', chart, 'D')
    const cutWeek = WEEKS.findIndex(w => w.t >= O.fridayOf(cut))                      // the week holding the cutoff
    const moved = project(WEEKS, 'W', chart, 'D', cutWeek)                              // change that week and every later one
    expect([...moved]).toEqual([...base])
    // the last visible bar shows the PREVIOUS completed week
    expect(base[base.length - 1]).toBe(cutWeek - 1)
  })
  it('monthly-calculated on a daily chart cut mid-month: the month holding the cutoff is never read', () => {
    const chart = daily('2026-03-18')
    const m = MONTHS.findIndex(x => x.t === '2026-03-01')
    expect([...project(MONTHS, 'M', chart, 'D', m)]).toEqual([...project(MONTHS, 'M', chart, 'D')])
  })
  it('daily-calculated on a 5m chart cut at a PRECISE instant mid-day: each bar shows the day BEFORE its own', () => {
    const cut = O.etToUnix('2026-03-10', 605)
    const chart = O.intradayBars(DAYS, '5').filter(b => O.barEnd(b, '5', { allDays: DAYS }) <= cut)
    const D = O.dwmBars(DAYS, 'D')
    const today = D.findIndex(d => d.t === '2026-03-10')
    expect([...project(D, 'D', chart, '5', today)]).toEqual([...project(D, 'D', chart, '5')])
    expect(project(D, 'D', chart, '5').at(-1)).toBe(today - 1)
  })
})
