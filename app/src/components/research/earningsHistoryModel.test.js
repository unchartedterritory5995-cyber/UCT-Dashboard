// app/src/components/research/earningsHistoryModel.test.js
import { describe, it, expect } from 'vitest'
import { buildQuarters, historyBasis, quarterLabel } from './earningsHistoryModel'

const beatHistory = [   // newest-first, as Finnhub returns it
  { period: '2026-06-30', actual: 0.91, estimate: 0.88, beat: true, surprise: 3.4 },
  { period: '2026-03-31', actual: 0.80, estimate: 0.82, beat: false, surprise: -2.4 },
  { period: '2025-12-31', actual: 0.75, estimate: 0.70, beat: true, surprise: 7.1 },
  { period: '2025-09-30', actual: 0.66, estimate: 0.66, beat: true, surprise: 0 },
]
const histStats = { avg_abs_move: 6.4, up_count: 3, total: 4, last_n: [8.2, -4.1, 5.5, -1.0] }
const row = { sym: 'NVDA', eps_estimate: 0.94, reported_eps: null }

describe('quarterLabel', () => {
  it('maps a period end to a fiscal-quarter label', () => {
    expect(quarterLabel('2026-06-30')).toBe('Q2 26')
    expect(quarterLabel('2026-01-31')).toBe('Q1 26')
    expect(quarterLabel('2025-12-31')).toBe('Q4 25')
    expect(quarterLabel(null)).toBe('')
    expect(quarterLabel('garbage')).toBe('')
  })
})

describe('buildQuarters', () => {
  it('returns oldest-first rows plus the current unreported quarter', () => {
    const rows = buildQuarters({ beatHistory, histStats, reportDate: '2026-08-06', row })
    expect(rows).toHaveLength(5)
    expect(rows.map(r => r.quarter)).toEqual(['Q3 25', 'Q4 25', 'Q1 26', 'Q2 26', 'Q3 26'])
    expect(rows.slice(0, 4).every(r => r.reported)).toBe(true)
    expect(rows[4].reported).toBe(false)
    expect(rows[4].eps_estimate).toBe(0.94)
    expect(rows[4].eps_actual).toBeNull()
  })

  it('aligns reactions by index over the shorter list, oldest-first', () => {
    const rows = buildQuarters({ beatHistory, histStats, reportDate: '2026-08-06', row })
    // last_n is newest-first: 8.2 belongs to the NEWEST reported quarter (Q2 26)
    expect(rows.map(r => r.reaction_pct)).toEqual([-1.0, 5.5, -4.1, 8.2, null])
  })

  it('never invents a reaction it does not have', () => {
    const rows = buildQuarters({
      beatHistory, histStats: { last_n: [8.2, -4.1] }, reportDate: '2026-08-06', row,
    })
    expect(rows.map(r => r.reaction_pct)).toEqual([null, null, -4.1, 8.2, null])
  })

  it('keeps a genuine 0 reaction instead of turning it into null', () => {
    const rows = buildQuarters({
      beatHistory: [beatHistory[0]], histStats: { last_n: [0] },
      reportDate: '2026-08-06', row,
    })
    expect(rows[0].reaction_pct).toBe(0)
  })

  it('keeps a genuine 0 surprise instead of dropping it', () => {
    const rows = buildQuarters({ beatHistory, histStats, reportDate: '2026-08-06', row })
    expect(rows[0].surprise_pct).toBe(0)      // Q3 25 surprise: 0
  })

  it('the report-date row stays unreported until its REACTION is known', () => {
    const printed = { ...row, reported_eps: 0.98, surprise_pct: '+4.3%' }
    const rows = buildQuarters({ beatHistory, histStats, reportDate: '2026-08-06', row: printed })
    const current = rows[rows.length - 1]
    // EPS is carried so the table can show it...
    expect(current.eps_actual).toBe(0.98)
    // ...but `reported` stays false so the Setup hero keeps tonight's implied bar
    // (pairQuarters uses reported===false to mean "this is the current quarter").
    expect(current.reported).toBe(false)
    expect(current.reaction_pct).toBeNull()
  })

  it('degrades to just the current quarter when there is no history at all', () => {
    const rows = buildQuarters({ beatHistory: null, histStats: null,
                                 reportDate: '2026-08-06', row })
    expect(rows).toHaveLength(1)
    expect(rows[0].reported).toBe(false)
  })

  it('returns an empty list when there is nothing at all to say', () => {
    expect(buildQuarters({})).toEqual([])
  })

  it('emits every field of the frozen row shape', () => {
    const rows = buildQuarters({ beatHistory, histStats, reportDate: '2026-08-06', row })
    expect(Object.keys(rows[0]).sort()).toEqual([
      'drift_pct', 'eps_actual', 'eps_estimate', 'eps_estimate_high', 'eps_estimate_low',
      'gap_pct', 'period_end', 'quarter', 'reaction_pct', 'report_date', 'reported',
      'revenue_actual', 'revenue_estimate', 'revenue_surprise_pct', 'session', 'surprise_pct',
    ])
  })
})

describe('historyBasis', () => {
  it('states the denominator and the method', () => {
    const rows = buildQuarters({ beatHistory, histStats, reportDate: '2026-08-06', row })
    expect(historyBasis(rows)).toBe('4 reported quarters · reactions aligned by index')
    expect(historyBasis([])).toBeNull()
  })
})
