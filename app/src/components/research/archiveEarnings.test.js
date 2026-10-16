// callsAroundReports pairs the team's archived calls with past earnings reports by DATE.
// Synthetic data only: the repo is public.
import { describe, it, expect } from 'vitest'

import { callsAroundReports, AROUND_REPORT_DAYS } from './archiveEarnings'

const q = (quarter, report_date, reported = true) => ({ quarter, report_date, reported })
const c = (call_id, posted) => ({ call_id, posted, outcome: { r20: 0.01 } })

describe('callsAroundReports', () => {
  it('pairs a call within the window with its report, and drops one outside it', () => {
    const rows = callsAroundReports(
      [q('Q1 25', '2025-04-24')],
      [c('a', '2025-04-22T14:00:00'), c('b', `2025-04-${24 + AROUND_REPORT_DAYS + 1}T14:00:00`)],
    )
    expect(rows).toEqual([{ quarter: 'Q1 25', report_date: '2025-04-24', calls: [c('a', '2025-04-22T14:00:00')] }])
  })

  it('places a call beside the NEAREST report only, never both', () => {
    const rows = callsAroundReports(
      [q('Q1', '2025-01-10'), q('Q2', '2025-01-16')],
      [c('mid', '2025-01-14')],                                   // 4 days from Q1, 2 from Q2
    )
    expect(rows.map((r) => [r.quarter, r.calls.map((x) => x.call_id)])).toEqual([['Q2', ['mid']]])
  })

  it('skips a quarter with no report date rather than pairing calls to a period end', () => {
    const rows = callsAroundReports([q('Q3', null), q('Q4', '2025-10-30')], [c('x', '2025-10-29')])
    expect(rows.map((r) => r.quarter)).toEqual(['Q4'])
  })

  it('ignores unreported quarters and orders a report\'s calls oldest first', () => {
    const rows = callsAroundReports(
      [q('next', '2026-01-20', false), q('Q4', '2025-10-30')],
      [c('late', '2025-11-02'), c('early', '2025-10-28'), c('upcoming', '2026-01-19')],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].calls.map((x) => x.call_id)).toEqual(['early', 'late'])
  })

  it('answers [] for missing inputs (control: the same call pairs once a report exists)', () => {
    expect(callsAroundReports(null, [c('a', '2025-01-01')])).toEqual([])
    expect(callsAroundReports([q('Q1', '2025-01-02')], null)).toEqual([])
    expect(callsAroundReports([q('Q1', '2025-01-02')], [c('a', '2025-01-01')])).toHaveLength(1)
  })
})
