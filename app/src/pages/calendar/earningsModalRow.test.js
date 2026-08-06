import { describe, it, expect } from 'vitest'
import { toModalRow, calcSurprise, timingLabel } from './earningsModalRow'
import { mergeEnrichment } from './useCalendarData'
import { buildQuarters } from '../../components/research/earningsHistoryModel'

// GATE a (Task 12) found in a LIVE browser: the Earnings History section
// rendered "No reported quarters yet" for every symbol on every path — CAT
// included, on a day it had reported $8.17 vs $6.25 est. Root cause: this
// module dropped the enrichment overlay, so the section's
// `buildQuarters({beatHistory: row?.beat_history, ...})` always got undefined.
//
// Nothing caught it because every section test hand-authored a `row` fixture
// that ALREADY contained `beat_history`. The gap was between the real calendar
// entry and the real row — so these tests drive the REAL pipeline
// (mergeEnrichment → toModalRow → buildQuarters) rather than a fixture.

// Shaped exactly like the live payloads observed at :8077 on 2026-08-04.
const entry = { sym: 'CAT', eps_act: 8.17, eps_est: 6.25, rev_act: 20.5e9, rev_est: 19.3e9 }
const enrichment = {
  CAT: {
    expected_move: { pct: 4.2, dollar: 18.1 },
    beat_history: [
      { period: '2026-06-30', actual: 8.17, estimate: 6.25, surprise: 30.7, quarter: 2, year: 2026 },
      { period: '2026-03-31', actual: 4.25, estimate: 4.11, surprise: 3.4, quarter: 1, year: 2026 },
      { period: '2025-12-31', actual: 5.14, estimate: 4.98, surprise: 3.2, quarter: 4, year: 2025 },
      { period: '2025-09-30', actual: 4.88, estimate: 4.70, surprise: 3.8, quarter: 3, year: 2025 },
    ],
    // last_n[0] === null is the real print-night shape: CAT reported that
    // morning, so its next-day reaction does not exist yet. The null is a
    // placeholder that preserves index alignment (P2 T9) — it must survive
    // the trip through toModalRow intact.
    hist_stats: { avg_abs_move: 5.1, up_count: 2, total: 3, last_n: [null, 5.8, 1.8, 6.4] },
  },
}

describe('toModalRow', () => {
  it('still carries the eight print fields', () => {
    const row = toModalRow(entry)
    expect(row.sym).toBe('CAT')
    expect(row.verdict).toBe('beat')
    expect(row.reported_eps).toBe(8.17)
    expect(row.eps_estimate).toBe(6.25)
    expect(row.surprise_pct).toBe('+30.7%')
  })

  // THE regression. Without the enrichment passthrough this is undefined and
  // the whole Earnings History section renders its EmptyState in production.
  it('carries the enrichment overlay through to the modal row', () => {
    const enriched = mergeEnrichment(entry, enrichment)
    const row = toModalRow(enriched)
    expect(row.beat_history).toHaveLength(4)
    expect(row.hist_stats.last_n).toEqual([null, 5.8, 1.8, 6.4])
    expect(row.expected_move).toEqual({ pct: 4.2, dollar: 18.1 })
  })

  // The end-to-end assertion: the REAL pipeline must produce quarters the
  // history section can draw. This is the assertion whose absence let the
  // defect ship.
  it('the real pipeline yields drawable quarters (not an empty history)', () => {
    const row = toModalRow(mergeEnrichment(entry, enrichment))
    const quarters = buildQuarters({
      beatHistory: row.beat_history, histStats: row.hist_stats,
      reportDate: '2026-08-04', row,
    })
    const reported = quarters.filter((q) => q.reported)
    expect(reported.length).toBe(4)
    expect(reported.map((q) => q.quarter)).toEqual(['Q3 25', 'Q4 25', 'Q1 26', 'Q2 26'])
    // oldest-first output, newest-first source: the newest quarter carries the
    // null placeholder, and a genuine reaction is never invented for it.
    expect(reported[reported.length - 1].reaction_pct).toBeNull()
    expect(reported.some((q) => q.reaction_pct === 6.4)).toBe(true)
  })

  it('an un-enriched entry degrades to explicit nulls, not undefined', () => {
    const row = toModalRow(entry)
    expect(row.beat_history).toBeNull()
    expect(row.hist_stats).toBeNull()
    expect(row.expected_move).toBeNull()
  })
})

describe('calcSurprise', () => {
  it('distinguishes an absent value from a genuine zero surprise', () => {
    expect(calcSurprise(null, 5)).toBeNull()
    expect(calcSurprise(5, null)).toBeNull()
    expect(calcSurprise(5, 0)).toBeNull()          // no denominator
    expect(calcSurprise(5, 5)).toBe('+0.0%')       // a real 0% surprise
  })
})

describe('timingLabel', () => {
  it('never presents an unconfirmed session as confirmed', () => {
    expect(timingLabel('bmo')).toBe('BEFORE MARKET OPEN')
    expect(timingLabel('amc')).toBe('AFTER MARKET CLOSE')
    expect(timingLabel(null)).toBe('TIME TBD')
    expect(timingLabel('')).toBe('TIME TBD')
  })
})

describe('history_unresolved survives BOTH allow-lists', () => {
  // There are two hand-maintained projections between the enrichment API and
  // the Earnings History section — mergeEnrichment() and toModalRow() — and a
  // field missing from either is dropped silently. That is not hypothetical:
  // the note in earningsModalRow.js records `beat_history` itself being lost
  // this way, passing tests that hand-authored a row while the real row never
  // carried it. These walk the actual chain instead.
  const apiEnrichment = {
    JAZZ: { expected_move: null, beat_history: null, hist_stats: null,
            history_unresolved: true },
  }

  it('carries the flag from the API payload all the way to the modal row', () => {
    const entry = { sym: 'JAZZ', eps_est: 6.3, eps_act: 5.71 }
    const merged = mergeEnrichment(entry, apiEnrichment)
    expect(merged.history_unresolved).toBe(true)      // survived allow-list #1
    const modalRow = toModalRow(merged)
    expect(modalRow.history_unresolved).toBe(true)    // survived allow-list #2
  })

  it('defaults to false when the server did answer, so real empties stay honest', () => {
    const merged = mergeEnrichment(
      { sym: 'NEWCO' },
      { NEWCO: { expected_move: null, beat_history: [], hist_stats: null } },
    )
    expect(merged.history_unresolved).toBe(false)
    expect(toModalRow(merged).history_unresolved).toBe(false)
  })

  it('defaults to false for an entry with no enrichment at all', () => {
    // `enrichReady` owns that case upstream; defaulting to unresolved here
    // would paint "unavailable" across every row before the batch lands.
    expect(toModalRow({ sym: 'ZZZ' }).history_unresolved).toBe(false)
  })
})
