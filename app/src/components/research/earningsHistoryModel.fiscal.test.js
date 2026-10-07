// Accuracy follow-up 2 (audit 2026-10-06): the ERN modal prints the backend's
// fiscal label (`fiscal_calendar.display_label`, the authority EE uses) instead
// of a calendar-month derivation. Reference values are Apple's own names for
// its quarters, written by hand.
import { describe, it, expect } from 'vitest'
import { buildQuarters } from './earningsHistoryModel'
import { mergeEnrichment } from '../../pages/calendar/useCalendarData'
import { toModalRow } from '../../pages/calendar/earningsModalRow'

const AAPL_HISTORY = [
  { period: '2025-12-27', year: 2026, quarter: 1, label: 'Q1 FY2026', actual: 2.4, estimate: 2.35 },
  { period: '2025-09-27', year: 2025, quarter: 4, label: 'Q4 FY2025', actual: 1.85, estimate: 1.77 },
]
const NEXT = { report_date: '2026-04-30', period_end: '2026-03-28', fiscal_year: 2026, fiscal_quarter: 2, label: 'Q2 FY2026' }

describe('ERN quarter labels come from the fiscal authority', () => {
  it('history rows print the backend label, not the calendar month', () => {
    const q = buildQuarters({ beatHistory: AAPL_HISTORY })
    // A calendar-month derivation would call the December quarter "Q4 25".
    expect(q.map((r) => r.quarter)).toEqual(['Q4 FY2025', 'Q1 FY2026'])
  })

  it('the upcoming row takes next_report_fiscal for THIS report', () => {
    const q = buildQuarters({
      beatHistory: AAPL_HISTORY, reportDate: '2026-04-30',
      row: { next_report_fiscal: NEXT },
    })
    const cur = q[q.length - 1]
    expect(cur.reported).toBe(false)
    expect(cur.quarter).toBe('Q2 FY2026')           // calendar month would say "Q2 26"... of the REPORT month
    expect(cur.fiscal_year).toBe(2026)
    expect(cur.fiscal_quarter).toBe(2)
  })

  it('a next_report_fiscal for a different report is ignored, never borrowed', () => {
    const q = buildQuarters({
      beatHistory: AAPL_HISTORY, reportDate: '2026-07-30',
      row: { next_report_fiscal: NEXT },
    })
    const cur = q[q.length - 1]
    expect(cur.quarter).toBe('Q3 26')               // the old fallback, unchanged
    expect(cur.fiscal_year).toBe(null)
  })

  it('a row without a label keeps the old derivation byte for byte', () => {
    const q = buildQuarters({ beatHistory: [{ period: '2026-03-31', year: 2026, quarter: 1, actual: 1, estimate: 1 }] })
    expect(q[0].quarter).toBe('Q1 26')
  })

  it('next_report_fiscal survives both allow-lists (enrichment merge + modal row)', () => {
    const entry = mergeEnrichment({ sym: 'AAPL' }, { AAPL: { beat_history: AAPL_HISTORY, next_report_fiscal: NEXT } })
    expect(toModalRow(entry).next_report_fiscal).toEqual(NEXT)
  })
})
