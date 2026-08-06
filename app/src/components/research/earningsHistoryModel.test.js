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

  // RESTORED to its original partial-pairing expectation (P2 T8b review r3):
  // review r2 briefly required this to drop ALL reactions on a length
  // mismatch, reasoning a mismatch signals a hidden gap. review r3 reversed
  // that ruling as factually wrong for the dominant case — beat_history
  // (Finnhub, <=4) and last_n (FMP/AV, <=8) are two INDEPENDENT provider
  // caps, not a gap, and live measurement across 12 symbols found the
  // length-match rate was 1-in-12, so requiring equality blanked
  // reaction_pct for ~92% of symbols. Both sides are newest-first anchored
  // at the same newest quarter, so partial pairing over the shorter list
  // (the two newest quarters get real reactions, the two oldest — beyond
  // last_n's shorter bound — get null) is correct, not a gap-guessing risk.
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

  // P2 T8b review r3, Minor — the "reactions aligned by index" clause must
  // not assert an alignment method that produced NOTHING (§2: every number
  // carries its denominator).
  it('omits "reactions aligned by index" when no reaction was actually paired (last_n empty)', () => {
    const rows = buildQuarters({
      beatHistory: [beatHistory[0]], histStats: null, reportDate: null, row: {},
    })
    expect(rows[0].reported).toBe(true)
    expect(rows[0].reaction_pct).toBeNull()
    expect(historyBasis(rows)).toBe('1 reported quarters')
  })

  it('omits "reactions aligned by index" when an unparseable period revoked trust for the whole zip', () => {
    const rows = buildQuarters({
      beatHistory: [{ period: 'garbage', actual: 1, estimate: 1, surprise: 0 }],
      histStats: { last_n: [1.0] }, reportDate: null, row: {},
    })
    expect(rows.every((r) => r.reaction_pct == null)).toBe(true)
    expect(historyBasis(rows)).toBe('1 reported quarters')
  })

  it('still states the method when at least one reaction paired, even if others in the set did not', () => {
    const rows = buildQuarters({
      beatHistory, histStats: { last_n: [8.2] }, reportDate: '2026-08-06', row,
    })
    expect(historyBasis(rows)).toBe('4 reported quarters · reactions aligned by index')
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

// DECISION 4 (P2 T8b review r1, IMPORTANT) — the current row must not
// duplicate a quarter that already landed in beat_history, and when it is
// still genuinely current, it must label + key the SAME way as a past row
// for the identical print.
describe('buildQuarters — current-row suppression on a fiscal-identity match (DECISION 4)', () => {
  // The print already landed in beat_history under fiscal Q2 2026 (Finnhub's
  // /stock/earnings has caught up), but `reportDate` (from the calendar) still
  // names that same announcement — the exact print-night race the reviewer
  // reproduced.
  const justPrinted = [
    { period: '2026-06-30', actual: 0.91, estimate: 0.88, surprise: 3.4, quarter: 2, year: 2026 },
  ]

  it('does not append a duplicate current row when its fiscal identity already reported', () => {
    const rows = buildQuarters({
      beatHistory: justPrinted, histStats: { last_n: [4.1] }, reportDate: '2026-07-30',
      row: { quarter: 2, year: 2026, eps_estimate: 0.88, reported_eps: 0.91 },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].reported).toBe(true)
    expect(rows[0].fiscal_year).toBe(2026)
    expect(rows[0].fiscal_quarter).toBe(2)
  })

  it('still appends the current row when its fiscal identity has NOT reported yet', () => {
    const rows = buildQuarters({
      beatHistory: justPrinted, histStats: { last_n: [4.1] }, reportDate: '2026-10-28',
      row: { quarter: 3, year: 2026, eps_estimate: 0.95, reported_eps: null },
    })
    expect(rows).toHaveLength(2)
    expect(rows[1].reported).toBe(false)
    expect(rows[1].fiscal_year).toBe(2026)
    expect(rows[1].fiscal_quarter).toBe(3)
  })

  it('still appends the current row when the caller has not threaded quarter/year onto it '
    + '(no fiscal key to compare — the pre-existing, unchanged behavior)', () => {
    const rows = buildQuarters({
      beatHistory: justPrinted, histStats: { last_n: [4.1] }, reportDate: '2026-07-30',
      row: { eps_estimate: 0.88, reported_eps: 0.91 },   // no quarter/year at all
    })
    expect(rows).toHaveLength(2)
    expect(rows[1].reported).toBe(false)
  })

  it('labels the current row from its own quarter/year, matching a past row for the same print', () => {
    // Off-calendar fiscal year (AAPL-style): period end 2026-09-30 is fiscal
    // Q1 2027, announced 2026-10-28 — the review's exact "Q1 27 vs ±Q4 26"
    // mislabel scenario, here with a DIFFERENT (not-yet-reported) quarter so
    // the row is not suppressed.
    const rows = buildQuarters({
      beatHistory: justPrinted, histStats: { last_n: [4.1] }, reportDate: '2026-10-28',
      row: { quarter: 1, year: 2027, eps_estimate: 2.0, reported_eps: null },
    })
    const current = rows[rows.length - 1]
    expect(current.quarter).toBe('Q1 27')
  })

  it('falls back to the period-end derivation for the current row label when no fiscal key is supplied', () => {
    const rows = buildQuarters({
      beatHistory: [], histStats: null, reportDate: '2026-10-28', row: {},
    })
    expect(rows[0].quarter).toBe('Q4 26')   // pre-existing calendar-fiscal derivation, unchanged
  })

  it('fiscal_year/fiscal_quarter on the current row: a genuine 0 survives; explicit null stays null', () => {
    const zero = buildQuarters({
      beatHistory: [], histStats: null, reportDate: '2026-10-28',
      row: { quarter: 0, year: 0 },
    })
    expect(zero[0].fiscal_quarter).toBe(0)
    expect(zero[0].fiscal_year).toBe(0)

    const none = buildQuarters({
      beatHistory: [], histStats: null, reportDate: '2026-10-28',
      row: { quarter: null, year: null },
    })
    expect(none[0].fiscal_quarter).toBeNull()
    expect(none[0].fiscal_year).toBeNull()
  })
})

// DECISION 1 amendment (P2 T8b review r2, REVERSED in part by review r3) —
// beat_history is NOT guaranteed newest-first by the provider, so it's
// sorted before zipping against hist_stats.last_n. Real GLOO shape:
// /stock/earnings returned periods NON-MONOTONIC (2026-06-30, 2025-12-31,
// 2026-03-31 — chronologically 06-30 > 03-31 > 12-31, i.e. scrambled).
// review r2 ALSO required last_n's length to match exactly (a length
// mismatch = distrust); review r3 reversed that specific piece as wrong for
// the dominant real case — beat_history (Finnhub, <=4) and last_n (FMP/AV,
// <=8) are two INDEPENDENT provider caps, not a gap, and requiring equality
// blanked reaction_pct for ~92% of symbols live. The sort + the
// unparseable-period guard both survive review r3 unchanged.
describe('buildQuarters — beat_history sort + index-alignment trust (DECISION 1, review r2/r3)', () => {
  // Finnhub's ACTUAL raw order for this shape — NOT newest-first.
  const glooRawOrder = [
    { period: '2026-06-30', actual: 0.50, estimate: 0.40, surprise: 25.0, quarter: 2, year: 2026 },
    { period: '2025-12-31', actual: 0.30, estimate: 0.35, surprise: -14.3, quarter: 4, year: 2025 },
    { period: '2026-03-31', actual: 0.45, estimate: 0.40, surprise: 12.5, quarter: 1, year: 2026 },
  ]

  it('sorts beat_history by period before zipping, so a scrambled provider order still pairs the RIGHT reaction to the RIGHT quarter', () => {
    // TRUE newest-first reaction sequence: 06-30 (newest) -> 03-31 -> 12-31 (oldest).
    const rows = buildQuarters({
      beatHistory: glooRawOrder, histStats: { last_n: [5.0, -2.0, 3.0] },
      reportDate: null, row: {},
    })
    expect(rows).toHaveLength(3)
    // Oldest-first output.
    expect(rows[0].period_end).toBe('2025-12-31')
    expect(rows[0].reaction_pct).toBe(3.0)
    expect(rows[1].period_end).toBe('2026-03-31')
    expect(rows[1].reaction_pct).toBe(-2.0)
    expect(rows[2].period_end).toBe('2026-06-30')
    expect(rows[2].reaction_pct).toBe(5.0)
    // Without the sort (the pre-fix behavior), index 1 would have paired
    // 2025-12-31 (the OLDEST of the three, third in raw order) with
    // moves[1]=-2.0 (actually 2026-03-31's reaction) — a wrong-quarter
    // assignment. This test fails against that code (rows[0].reaction_pct
    // would be -2.0, not 3.0).
  })

  // REVERSED (P2 T8b review r3): review r2 asserted this dropped ALL
  // reactions on a length mismatch. Live measurement across 12 real symbols
  // (AAPL/MSFT/NVDA/TSLA/AMZN/GOOGL/META/AMD/JPM/WMT/COST all beat_history=4
  // vs last_n=8; only GLOO length-matched) proved that wrong for the
  // DOMINANT case: the two providers cap differently, so a mismatch is a
  // CAP, not a gap. This is the realistic AAPL-style shape: 4-quarter
  // beat_history vs 8-move last_n — the dominant real-world ratio.
  it('a length mismatch (the DOMINANT real-world case: 4-quarter beat_history vs 8-move last_n) pairs the overlap, not nothing', () => {
    const fourQuarters = [
      { period: '2026-06-30', actual: 0.91, estimate: 0.88, surprise: 3.4, quarter: 2, year: 2026 },
      { period: '2026-03-31', actual: 0.80, estimate: 0.82, surprise: -2.4, quarter: 1, year: 2026 },
      { period: '2025-12-31', actual: 0.75, estimate: 0.70, surprise: 7.1, quarter: 4, year: 2025 },
      { period: '2025-09-30', actual: 0.66, estimate: 0.66, surprise: 0, quarter: 3, year: 2025 },
    ]
    const eightMoves = [8.2, -4.1, 5.5, -1.0, 3.0, -2.0, 1.5, -0.5]  // only the first 4 correspond
    const rows = buildQuarters({
      beatHistory: fourQuarters, histStats: { last_n: eightMoves }, reportDate: null, row: {},
    })
    expect(rows).toHaveLength(4)
    expect(rows.every((r) => r.reaction_pct != null)).toBe(true)
    // oldest-first: Q3 25 -> Q4 25 -> Q1 26 -> Q2 26
    expect(rows.map((r) => r.reaction_pct)).toEqual([-1.0, 5.5, -4.1, 8.2])
  })

  it('a SHORTER last_n than beat_history still pairs the overlap, leaving the untouched OLDER quarters null (never invents beyond what it has)', () => {
    const fourQuarters = [
      { period: '2026-06-30', actual: 0.91, estimate: 0.88, surprise: 3.4, quarter: 2, year: 2026 },
      { period: '2026-03-31', actual: 0.80, estimate: 0.82, surprise: -2.4, quarter: 1, year: 2026 },
      { period: '2025-12-31', actual: 0.75, estimate: 0.70, surprise: 7.1, quarter: 4, year: 2025 },
      { period: '2025-09-30', actual: 0.66, estimate: 0.66, surprise: 0, quarter: 3, year: 2025 },
    ]
    const rows = buildQuarters({
      beatHistory: fourQuarters, histStats: { last_n: [8.2, -4.1] }, reportDate: null, row: {},
    })
    expect(rows.map((r) => r.reaction_pct)).toEqual([null, null, -4.1, 8.2])
  })

  it('an unparseable period anywhere in beat_history STILL revokes trust for the WHOLE zip (unaffected by the r3 reversal)', () => {
    const withGarbage = [
      ...glooRawOrder,
      { period: 'garbage', actual: 0.10, estimate: 0.10, surprise: 0, quarter: 3, year: 2026 },
    ]
    const rows = buildQuarters({
      beatHistory: withGarbage, histStats: { last_n: [1, 2, 3, 4] },
      reportDate: null, row: {},
    })
    expect(rows).toHaveLength(4)
    expect(rows.every((r) => r.reaction_pct === null)).toBe(true)
    // The garbage row still renders (period_end/quarter null-guarded
    // separately) — it just carries no reaction, and neither does anything else.
    expect(rows.some((r) => r.period_end === null)).toBe(true)
  })

  it('a matching length still pairs everything (the GLOO shape itself, unaffected by the r3 reversal)', () => {
    const rows = buildQuarters({
      beatHistory: glooRawOrder, histStats: { last_n: [5.0, -2.0, 3.0] },
      reportDate: null, row: {},
    })
    expect(rows.every((r) => r.reaction_pct != null)).toBe(true)
  })
})

describe('one print must not render as two quarters', () => {
  // Live on prod 2026-08-06: JAZZ's 2026-08-03 print appeared as BOTH
  // "Q2 26" (from history) and "Q3 26" (a label invented by quarterLabel's
  // calendar-month fallback), because the calendar row carried no fiscal
  // identity so the fiscal-key dedupe could not fire. Every existing fixture
  // supplied the fiscal fields the real row lacks, so no test saw it.
  const fmpHistory = [
    { period: '2026-06-30', report_date: '2026-08-03', actual: 5.71,
      estimate: 6.18, year: 2026, quarter: 2, revenue_actual: 1208300000 },
    { period: '2026-03-31', report_date: '2026-05-05', actual: 6.34,
      estimate: 4.64, year: 2026, quarter: 1, revenue_actual: 1068900000 },
  ]

  it('dedupes on the announcement date when the row has no fiscal identity', () => {
    const out = buildQuarters({
      beatHistory: fmpHistory,
      histStats: null,
      reportDate: '2026-08-03',
      row: { sym: 'JAZZ', reported_eps: 5.71, eps_estimate: 6.30 },  // no year/quarter
    })
    expect(out).toHaveLength(2)
    const labels = out.map((q) => q.quarter)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).not.toContain('Q3 26')
  })

  it('still dedupes on fiscal identity when the row does carry it', () => {
    const out = buildQuarters({
      beatHistory: fmpHistory,
      histStats: null,
      reportDate: '2026-08-03',
      row: { sym: 'JAZZ', year: 2026, quarter: 2, reported_eps: 5.71 },
    })
    expect(out).toHaveLength(2)
  })

  it('still appends a genuinely NEW upcoming report', () => {
    // The guard must not swallow a real future quarter — that would delete
    // the implied-move bar the section exists to draw.
    const out = buildQuarters({
      beatHistory: fmpHistory,
      histStats: null,
      reportDate: '2026-11-04',
      row: { sym: 'JAZZ', eps_estimate: 6.42 },
    })
    expect(out).toHaveLength(3)
    expect(out[out.length - 1].reported).toBe(false)
  })

  it('carries revenue through from the FMP leg', () => {
    const out = buildQuarters({
      beatHistory: fmpHistory, histStats: null,
      reportDate: '2026-11-04', row: { sym: 'JAZZ' },
    })
    const q1 = out.find((q) => q.quarter === 'Q1 26')
    expect(q1.revenue_actual).toBeCloseTo(1068.9, 1)   // millions
  })
})
