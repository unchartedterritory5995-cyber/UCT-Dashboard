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

  // Requirement 3 (P2 T8b) — off-calendar fiscal year. AAPL's fiscal Q1 ends
  // in December, so a period end of 2025-12-27 is fiscal Q1 2026 by AAPL's own
  // calendar, NOT "Q4 25" (what the period-end-only derivation above would
  // say). The provider's own quarter/year must win when present.
  it('labels an off-calendar fiscal year from the providers own quarter/year, not the period end', () => {
    expect(quarterLabel('2025-12-27', 1, 2026)).toBe('Q1 26')
    // Same period end, no provider fields: falls back to the (here, WRONG for
    // an off-calendar filer) calendar derivation — demonstrates exactly why
    // the provider fields must be preferred when available.
    expect(quarterLabel('2025-12-27')).toBe('Q4 25')
  })

  it('ignores a partial provider pair (only one of quarter/year present) and falls back', () => {
    expect(quarterLabel('2025-12-27', 1, null)).toBe('Q4 25')
    expect(quarterLabel('2025-12-27', null, 2026)).toBe('Q4 25')
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
    // fiscal_year/fiscal_quarter (P2 T8b) are an ADDITIVE extension of the
    // frozen shape — the provider's own fiscal identity, carried so a client
    // can pair a past row against its implied snapshot without report_date.
    expect(Object.keys(rows[0]).sort()).toEqual([
      'drift_pct', 'eps_actual', 'eps_estimate', 'eps_estimate_high', 'eps_estimate_low',
      'fiscal_quarter', 'fiscal_year',
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

// SUPPLEMENTARY — appended on top of the brief's verbatim test suite (not a
// replacement). `reaction_pct` and `surprise_pct` already get explicit 0-vs-null
// coverage above, but they all route through the same shared `num()` helper as
// `eps_actual`/`eps_estimate`/`revenue_estimate`/`revenue_actual`, and the
// phantom-zero trap ("Number(null) === 0") is field-specific in its blast
// radius — a regression in one call site doesn't necessarily show up via
// another field's assertion. Each field gets its own real-0-survives /
// absent-stays-null pair.
//
// The "absent" half is deliberately an explicit `null` (what a JSON API sends
// for a field it has nothing for), NOT an omitted key. `Number(undefined)` is
// already `NaN` under EITHER implementation of `num()`, so an omitted-key
// fixture can't actually distinguish the correct guard from the
// `Number(null) === 0` bug — only an explicit `null` does.
describe('phantom-zero guard — both directions on every computed numeric field', () => {
  it('eps_actual: a genuine breakeven print (0) survives; an explicit null stays null', () => {
    const zeroPrint = [{ ...beatHistory[0], actual: 0 }]
    const reported = buildQuarters({
      beatHistory: zeroPrint, histStats: { last_n: [1.0] }, reportDate: '2026-08-06', row,
    })
    expect(reported[0].eps_actual).toBe(0)

    const noEps = buildQuarters({
      beatHistory: [], histStats: null, reportDate: '2026-08-06',
      row: { eps_estimate: 0.94, reported_eps: null },
    })
    expect(noEps[0].eps_actual).toBeNull()
  })

  it('eps_estimate: a genuine 0 estimate survives; an explicit null stays null (not phantom 0)', () => {
    const zeroEst = buildQuarters({
      beatHistory: [], histStats: null, reportDate: '2026-08-06',
      row: { eps_estimate: 0, reported_eps: null },
    })
    expect(zeroEst[0].eps_estimate).toBe(0)

    const noEst = buildQuarters({
      beatHistory: [], histStats: null, reportDate: '2026-08-06',
      row: { eps_estimate: null, reported_eps: null },
    })
    expect(noEst[0].eps_estimate).toBeNull()
  })

  it('revenue_estimate/revenue_actual: genuine 0 survives; explicit null stays null', () => {
    const zeroRev = buildQuarters({
      beatHistory: [], histStats: null, reportDate: '2026-08-06',
      row: { rev_estimate: 0, rev_actual: 0 },
    })
    expect(zeroRev[0].revenue_estimate).toBe(0)
    expect(zeroRev[0].revenue_actual).toBe(0)

    const noRev = buildQuarters({
      beatHistory: [], histStats: null, reportDate: '2026-08-06',
      row: { rev_estimate: null, rev_actual: null },
    })
    expect(noRev[0].revenue_estimate).toBeNull()
    expect(noRev[0].revenue_actual).toBeNull()
  })

  // CODE-REVIEW FOLLOWUP (see task-7-report.md addendum): these three closed a
  // gap the reviewer proved by mutation — every case above exercises `num()`
  // through the CURRENT-quarter call sites (`row?.eps_estimate` /
  // `row?.reported_eps` / `row?.rev_estimate` / `row?.rev_actual`), but the
  // HISTORICAL call sites (`h?.estimate` / `h?.surprise` inside the
  // `hist.map(...)` at buildQuarters:70/72) had no null-direction fixture
  // anywhere — every `beatHistory` entry in this file always carries a real
  // number. A naive-cast regression on either line passed all 14 tests before
  // these were added.
  it('eps_estimate (historical): a genuine 0 estimate survives; an explicit null stays null', () => {
    const zeroEst = [{ ...beatHistory[0], estimate: 0 }]
    const reportedZero = buildQuarters({
      beatHistory: zeroEst, histStats: { last_n: [1.0] }, reportDate: '2026-08-06', row,
    })
    expect(reportedZero[0].eps_estimate).toBe(0)

    const nullEst = [{ ...beatHistory[0], estimate: null }]
    const reportedNull = buildQuarters({
      beatHistory: nullEst, histStats: { last_n: [1.0] }, reportDate: '2026-08-06', row,
    })
    expect(reportedNull[0].eps_estimate).toBeNull()
  })

  it('surprise_pct (historical): an explicit null stays null (0-survives already covered above)', () => {
    const nullSurprise = [{ ...beatHistory[0], surprise: null }]
    const rows = buildQuarters({
      beatHistory: nullSurprise, histStats: { last_n: [1.0] }, reportDate: '2026-08-06', row,
    })
    expect(rows[0].surprise_pct).toBeNull()
  })
})

// CODE-REVIEW FOLLOWUP — the `if (!rd) return past` branch (buildQuarters:78)
// had no coverage at all: deleting it outright still left 14/14 green, because
// every other test passes a real `reportDate`. This is a real production path
// (a symbol with beat history but no known/scheduled next earnings date) and a
// regression here would silently append a blank current-quarter row regardless
// of `rd`.
describe('buildQuarters — no report date', () => {
  it('returns just the reported history, unmodified, when reportDate is explicitly null', () => {
    const rows = buildQuarters({ beatHistory, histStats, reportDate: null, row })
    expect(rows).toHaveLength(beatHistory.length)
    expect(rows.every((r) => r.reported)).toBe(true)
    expect(rows.map((r) => r.quarter)).toEqual(['Q3 25', 'Q4 25', 'Q1 26', 'Q2 26'])
  })
})

// P2 T8b — the fiscal key carried onto every historical row: what
// ImpliedVsRealized.pairQuarters pairs on instead of report_date.
describe('buildQuarters — fiscal key (P2 T8b)', () => {
  it('carries the period_end and the fiscal key as DISTINCT fields, and leaves report_date null', () => {
    const oneQuarter = [
      { period: '2026-06-30', actual: 0.91, estimate: 0.88, surprise: 3.4, quarter: 2, year: 2026 },
    ]
    const rows = buildQuarters({
      beatHistory: oneQuarter, histStats: { last_n: [4.1] }, reportDate: null, row: {},
    })
    expect(rows[0].period_end).toBe('2026-06-30')
    expect(rows[0].fiscal_quarter).toBe(2)
    expect(rows[0].fiscal_year).toBe(2026)
    // The true announcement date isn't in this source (only the period end
    // is) — leaving it null, not silently filled with the period end, is
    // the whole point of this task (DECISION 3).
    expect(rows[0].report_date).toBeNull()
  })

  // Requirement 3, end-to-end through buildQuarters (quarterLabel is
  // exercised directly above; this proves the full row gets it too).
  it('off-calendar fiscal year: period end 2025-12-27 with quarter=1/year=2026 labels Q1 26, not Q4 25', () => {
    const oneQuarter = [
      { period: '2025-12-27', actual: 1.91, estimate: 1.85, surprise: 3.2, quarter: 1, year: 2026 },
    ]
    const rows = buildQuarters({
      beatHistory: oneQuarter, histStats: { last_n: [2.0] }, reportDate: null, row: {},
    })
    expect(rows[0].quarter).toBe('Q1 26')
  })

  it('fiscal_year/fiscal_quarter: a genuine 0 survives; an explicit null stays null (not phantom 0)', () => {
    const zeroFiscal = [{ ...beatHistory[0], quarter: 0, year: 0 }]
    const reportedZero = buildQuarters({
      beatHistory: zeroFiscal, histStats: { last_n: [1.0] }, reportDate: '2026-08-06', row,
    })
    expect(reportedZero[0].fiscal_quarter).toBe(0)
    expect(reportedZero[0].fiscal_year).toBe(0)

    const nullFiscal = [{ ...beatHistory[0], quarter: null, year: null }]
    const reportedNull = buildQuarters({
      beatHistory: nullFiscal, histStats: { last_n: [1.0] }, reportDate: '2026-08-06', row,
    })
    expect(reportedNull[0].fiscal_quarter).toBeNull()
    expect(reportedNull[0].fiscal_year).toBeNull()
  })

  it('a beatHistory row with no quarter/year at all (older source shape) leaves the fiscal key null', () => {
    const noFiscal = [{ period: '2026-06-30', actual: 0.91, estimate: 0.88, surprise: 3.4 }]
    const rows = buildQuarters({
      beatHistory: noFiscal, histStats: { last_n: [4.1] }, reportDate: null, row: {},
    })
    expect(rows[0].fiscal_quarter).toBeNull()
    expect(rows[0].fiscal_year).toBeNull()
    // Falls back to the period-end derivation for the label.
    expect(rows[0].quarter).toBe('Q2 26')
  })
})
