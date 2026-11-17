// EXMV, the pure half. Rails:
//   * the move read is asked with the report date when one is known (the route prices the
//     nearest expiry otherwise);
//   * the earnings read: a past "next report" is not next, a fund is its own state, and a report
//     whose next session has not closed is held back as too recent, never printed as the reaction;
//   * the move read: a percent stays the percent sent, a missing live number carries its reason
//     as words with no vocabulary kept here, and a row with no percent is dropped;
//   * one list of reports: a priced move is matched to its report on the day or within three
//     days, nothing is compared unless both sides are real, and the coming report is "upcoming".
// The fixtures are the routes' real shapes (api/routers/expected_move.py, implied_store
// get_implied_history, earnings_reaction.reaction_for), with a made-up ticker.
import { describe, it, expect } from 'vitest'
import {
  EXPECTED_MOVE_CODE, PAIR_WINDOW_DAYS, dayOf, earningsIntelUrl, earningsRead, expectedMoveUrl, expiryIsReportDay, moveRead,
  nextWeekday, pairedRecord, reasonWords, recordVsToday, reportRows, settled,
} from './expectedMoveModel'

const TODAY = '2026-11-17'   // a Tuesday
const EARN = {
  ticker: 'AAA',
  quarters: [{ label: 'Q2 FY26', report_date: '2026-08-20', reported: true }],
  summary: { next_report_date: '2026-11-19' },
  next_report_date: '2026-11-19',
  reaction: {
    events: [
      { quarter: 'Q3 FY25', report_date: '2025-11-20', reaction_pct: -3.2, eps_actual: 1.0, eps_estimate: 0.9 },
      { quarter: 'Q4 FY25', report_date: '2026-02-19', reaction_pct: 8.5, eps_actual: 1.1, eps_estimate: 1.0 },
      { quarter: 'Q1 FY26', report_date: '2026-05-21', reaction_pct: -11.0, eps_actual: 0.8, eps_estimate: 1.0 },
      { quarter: 'Q2 FY26', report_date: '2026-08-20', reaction_pct: 4.2, eps_actual: 1.2, eps_estimate: 1.1 },
    ],
    avg_abs_move_pct: 6.73,
    n_quarters: 4,
  },
}
const MOVE = {
  live: { pct: 7.1, dollar: 12.4, strike: 175, spot: 174.6, call_mid: 6.3, put_mid: 6.1, iv_atm: 0.62, expiry: '2026-11-20', horizon: 'through 2026-11-20', asof: '2026-11-17T15:02:11+00:00', source: 'massive-chain' },
  live_outcome: { kind: 'ok', reason: null },
  history: [
    { sym: 'AAA', report_date: '2026-11-19', captured_at: '2026-11-13T21:35:04+00:00', pct: 6.8, dollar: 11.9, expiry: '2026-11-20', fiscal_year: 2026, fiscal_quarter: 3 },
    { sym: 'AAA', report_date: '2026-08-20', captured_at: '2026-08-19T20:35:00+00:00', pct: 6.0, dollar: 9.1, expiry: '2026-08-21', fiscal_year: 2026, fiscal_quarter: 2 },
    { sym: 'AAA', report_date: '2026-05-20', captured_at: '2026-05-19T20:35:00+00:00', pct: 7.4, dollar: 10.0, expiry: '2026-05-22', fiscal_year: 2026, fiscal_quarter: 1 },
  ],
  history_since: '2026-05-20',
  grade: null,
}

describe('EXMV routes and days', () => {
  it('the code and the two routes: the report date rides on the move read when it is known', () => {
    expect(EXPECTED_MOVE_CODE).toBe('EXMV')
    expect(earningsIntelUrl('BRK-B')).toBe('/api/earnings-intel/BRK-B')
    expect(expectedMoveUrl('AAA', '2026-11-19')).toBe('/api/research/expected-move/AAA?grade=0&report_date=2026-11-19')
    expect(expectedMoveUrl('AAA')).toBe('/api/research/expected-move/AAA?grade=0')
    expect(expectedMoveUrl('AAA', null)).toBe('/api/research/expected-move/AAA?grade=0')
  })

  it('reads a calendar date off the front of a value, and nothing that is not a real day', () => {
    expect(dayOf('2026-11-19')).toBe('2026-11-19')
    expect(dayOf('2026-11-13T21:35:04+00:00')).toBe('2026-11-13')
    for (const bad of [null, undefined, '', 'Q3 FY25', '2026-02-30', '2026-13-01', '11/19/2026', 20261119]) expect(dayOf(bad), String(bad)).toBeNull()
  })

  it('a report is settled only once the session after it has closed', () => {
    expect(nextWeekday('2026-11-13')).toBe('2026-11-16')   // Friday -> Monday
    expect(nextWeekday('2026-11-16')).toBe('2026-11-17')
    expect(nextWeekday('2026-11-14')).toBe('2026-11-16')   // a Saturday date -> Monday
    expect(nextWeekday('soon')).toBeNull()
    expect(settled('2026-11-13', TODAY)).toBe(true)        // Friday report, Monday closed, today Tuesday
    expect(settled('2026-11-16', TODAY)).toBe(false)       // Monday report: today's session is still open
    expect(settled('2026-11-13', '2026-11-16')).toBe(false) // Friday report seen on Monday
    expect(settled('2026-11-13', '2026-11-14')).toBe(false) // and over the weekend
    expect(settled('2026-11-13', null)).toBe(false)
    expect(settled(null, TODAY)).toBe(false)
  })
})

describe('EXMV earningsRead', () => {
  it('the next report and the past reports, newest first, each a percent as sent', () => {
    const out = earningsRead(EARN, TODAY)
    expect(out).toMatchObject({ state: 'ok', nextReport: '2026-11-19', measured: true })
    expect(out.events).toEqual([
      { day: '2026-08-20', label: 'Q2 FY26', pct: 4.2, state: 'measured' },
      { day: '2026-05-21', label: 'Q1 FY26', pct: -11, state: 'measured' },
      { day: '2026-02-19', label: 'Q4 FY25', pct: 8.5, state: 'measured' },
      { day: '2025-11-20', label: 'Q3 FY25', pct: -3.2, state: 'measured' },
    ])
  })

  it('a next report that has passed is not next, and the summary date stands in for a missing one', () => {
    expect(earningsRead({ ...EARN, next_report_date: '2026-11-16', summary: {} }, TODAY).nextReport).toBeNull()
    expect(earningsRead({ ...EARN, next_report_date: TODAY }, TODAY).nextReport).toBe(TODAY)
    expect(earningsRead({ ...EARN, next_report_date: undefined }, TODAY).nextReport).toBe('2026-11-19')
    expect(earningsRead({ ...EARN, next_report_date: null, summary: null }, TODAY).nextReport).toBeNull()
    expect(earningsRead({ ...EARN, next_report_date: 'TBD', summary: {} }, TODAY).nextReport).toBeNull()
  })

  it('holds back a report too recent to measure, keeps a report with no move as missing, and never makes a 0', () => {
    const events = [
      { quarter: '2026-08-20', report_date: '2026-08-20', reaction_pct: null },
      { quarter: 'Q3 FY26', report_date: '2026-11-16', reaction_pct: 0.4 },      // yesterday: only the pre-report session exists
      { quarter: 'Q9', report_date: '2026-12-01', reaction_pct: 5 },             // after today: not a past report
      { quarter: 'Q2 FY26', report_date: '2026-08-20', reaction_pct: 9 },        // the same report twice
      { report_date: 'soon', reaction_pct: 1 }, null,
    ]
    const out = earningsRead({ ...EARN, reaction: { events } }, TODAY)
    expect(out.events).toEqual([
      { day: '2026-11-16', label: 'Q3 FY26', pct: null, state: 'too-recent' },
      { day: '2026-08-20', label: null, pct: null, state: 'missing' },
    ])
  })

  it('no reaction block is "not measured", a fund is its own state, and anything else is a failed read', () => {
    expect(earningsRead({ ...EARN, reaction: null }, TODAY)).toMatchObject({ state: 'ok', events: [], measured: false, nextReport: '2026-11-19' })
    expect(earningsRead({ ticker: 'SPY', not_applicable: 'fund', reason: 'SPY is a fund; funds do not report earnings', quarters: [], estimates: [] }, TODAY))
      .toMatchObject({ state: 'fund', reason: 'SPY is a fund; funds do not report earnings', events: [] })
    for (const body of [undefined, null, [], 'x', {}, { error: 'ticker required' }, { ticker: 'AAA' }, { detail: 'Not Found' }]) {
      expect(earningsRead(body, TODAY).state, JSON.stringify(body)).toBe('failed')
    }
  })
})

describe('EXMV moveRead', () => {
  it('the live straddle with its break-even prices, and the record of what was priced, newest first', () => {
    const out = moveRead(MOVE)
    expect(out.state).toBe('ok')
    expect(out.live).toMatchObject({ pct: 7.1, dollars: 12.4, strike: 175, spot: 174.6, callMid: 6.3, putMid: 6.1, expiry: '2026-11-20', asOf: '2026-11-17T15:02:11+00:00' })
    expect(out.live.low).toBeCloseTo(162.2, 6)
    expect(out.live.high).toBeCloseTo(187, 6)
    expect(out.outcome).toBeNull()
    expect(out.history.map((h) => [h.day, h.pct, h.dollars, h.expiry, h.capturedDay, h.fiscalYear, h.fiscalQuarter])).toEqual([
      ['2026-11-19', 6.8, 11.9, '2026-11-20', '2026-11-13', 2026, 3],
      ['2026-08-20', 6, 9.1, '2026-08-21', '2026-08-19', 2026, 2],
      ['2026-05-20', 7.4, 10, '2026-05-22', '2026-05-19', 2026, 1],
    ])
    expect(out.since).toBe('2026-05-20')
    // the percent is the percent the server sends: never multiplied again
    expect(out.live.pct).toBe(7.1)
  })

  it('no live number carries the server\'s kind and its reason as words; an unknown kind is "unavailable"', () => {
    expect(moveRead({ ...MOVE, live: null, live_outcome: { kind: 'refused', reason: 'no_atm_strike' } }).outcome).toEqual({ kind: 'refused', reason: 'no atm strike' })
    expect(moveRead({ ...MOVE, live: null, live_outcome: { kind: 'unavailable', reason: 'chain_timeout' } }).outcome).toEqual({ kind: 'unavailable', reason: 'chain timeout' })
    expect(moveRead({ ...MOVE, live: null, live_outcome: { kind: 'brand_new', reason: 'something_new' } }).outcome).toEqual({ kind: 'unavailable', reason: 'something new' })
    expect(moveRead({ ...MOVE, live: null, live_outcome: null }).outcome).toBeNull()
    expect(reasonWords('no_quoted_straddle')).toBe('no quoted straddle')
    expect(reasonWords(null)).toBe('')
    // a live block with no usable percent is no live number, never a 0% move
    for (const pct of [null, 0, -3, 'x', undefined]) expect(moveRead({ ...MOVE, live: { ...MOVE.live, pct } }).live, String(pct)).toBeNull()
  })

  it('a live number without a price has no break-even prices; a history row with no percent or date is dropped', () => {
    expect(moveRead({ ...MOVE, live: { pct: 5, expiry: '2026-11-20' } }).live).toMatchObject({ pct: 5, dollars: null, spot: null, low: null, high: null, asOf: null })
    expect(moveRead({ ...MOVE, live: { ...MOVE.live, spot: 10, dollar: 12 } }).live).toMatchObject({ low: null, high: 22 })
    const out = moveRead({ ...MOVE, history: [{ report_date: '2026-08-20', pct: null }, { report_date: 'soon', pct: 5 }, null, { report_date: '2026-05-20', pct: 7.4, fiscal_quarter: 7 }, { report_date: '2026-05-20', pct: 9 }], history_since: null })
    expect(out.history).toEqual([{ day: '2026-05-20', pct: 7.4, dollars: null, expiry: null, capturedDay: null, fiscalYear: null, fiscalQuarter: null }])
    expect(out.since).toBeNull()
  })

  it('anything that is not the route\'s shape is a failed read', () => {
    for (const body of [undefined, null, [], 'x', {}, { live: null }, { history: [] }, { live: null, history: 'none' }, { detail: 'Expected-move research requires a paid plan' }]) {
      expect(moveRead(body).state, JSON.stringify(body)).toBe('failed')
    }
    // the route's own degraded answer (both reads raised) is still its shape
    expect(moveRead({ live: null, live_outcome: { kind: 'unavailable', reason: 'read_error' }, history: [], history_since: null, grade: null }))
      .toMatchObject({ state: 'ok', live: null, history: [], outcome: { kind: 'unavailable', reason: 'read error' } })
  })

  it('flags a straddle that expires on the report day itself', () => {
    const live = moveRead(MOVE).live
    expect(expiryIsReportDay(live, '2026-11-20')).toBe(true)
    expect(expiryIsReportDay(live, '2026-11-19')).toBe(false)
    expect(expiryIsReportDay(live, null)).toBe(false)
    expect(expiryIsReportDay(null, '2026-11-20')).toBe(false)
  })
})

describe('EXMV reportRows and the two records', () => {
  const events = earningsRead(EARN, TODAY).events
  const history = moveRead(MOVE).history
  const rows = reportRows({ history, events, today: TODAY })

  it('one list, newest first: the coming report, the paired reports, and the reports with no record', () => {
    expect(PAIR_WINDOW_DAYS).toBe(3)
    expect(rows.map((r) => [r.day, r.label, r.impliedPct, r.actualPct, r.state, r.verdict])).toEqual([
      ['2026-11-19', 'Q3 2026', 6.8, null, 'upcoming', null],
      ['2026-08-20', 'Q2 FY26', 6, 4.2, 'measured', 'within'],
      // priced for 05-20, measured on 05-21: one report, matched a day apart
      ['2026-05-21', 'Q1 FY26', 7.4, -11, 'measured', 'beyond'],
      ['2026-02-19', 'Q4 FY25', null, 8.5, 'measured', null],
      ['2025-11-20', 'Q3 FY25', null, -3.2, 'measured', null],
    ])
    expect(rows[1]).toMatchObject({ impliedDollars: 9.1, capturedDay: '2026-08-19' })
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })

  it('nothing is compared unless both sides are real', () => {
    const recent = reportRows({
      history: [{ day: '2026-11-16', pct: 5, dollars: null, capturedDay: null, fiscalYear: null, fiscalQuarter: null }, { day: '2026-03-02', pct: 4, dollars: null, capturedDay: null, fiscalYear: null, fiscalQuarter: null }],
      events: [{ day: '2026-11-16', label: null, pct: null, state: 'too-recent' }, { day: '2026-08-20', label: null, pct: null, state: 'missing' }],
      today: TODAY,
    })
    expect(recent.map((r) => [r.day, r.state, r.actualPct, r.verdict])).toEqual([
      ['2026-11-16', 'too-recent', null, null],
      ['2026-08-20', 'no-actual', null, null],
      ['2026-03-02', 'no-actual', null, null],     // a priced move with no measured report within three days
    ])
    // a move exactly as big as priced stayed within it
    expect(reportRows({ history: [{ day: '2026-08-20', pct: 4.2 }], events, today: TODAY })[0].verdict).toBe('within')
    // four days apart is two different reports
    const far = reportRows({ history: [{ day: '2026-08-24', pct: 6 }], events: [events[0]], today: TODAY })
    expect(far.map((r) => [r.day, r.verdict])).toEqual([['2026-08-24', null], ['2026-08-20', null]])
    expect(reportRows()).toEqual([])
    expect(reportRows({ history: null, events: null, today: TODAY })).toEqual([])
  })

  it('the past reports against today\'s priced move', () => {
    const rec = recordVsToday(rows, 7.1)
    expect(rec.n).toBe(4)
    expect(rec.avgAbs).toBeCloseTo((4.2 + 11 + 8.5 + 3.2) / 4, 6)
    expect(rec.beyond).toBe(2)
    expect(rec.biggest).toBe(-11)
    expect(recordVsToday(rows, null)).toMatchObject({ n: 4, beyond: null })
    expect(recordVsToday([rows[0]], 7.1)).toEqual({ n: 0, avgAbs: null, beyond: null, biggest: null })
    expect(recordVsToday(null, 7.1).n).toBe(0)
  })

  it('the reports where the priced move was on record', () => {
    const p = pairedRecord(rows)
    expect(p).toMatchObject({ n: 2, beyond: 1 })
    expect(p.avgImplied).toBeCloseTo(6.7, 6)
    expect(p.avgAbs).toBeCloseTo(7.6, 6)
    expect(pairedRecord([rows[0], rows[3]])).toEqual({ n: 0, beyond: 0, avgImplied: null, avgAbs: null })
    expect(pairedRecord(null).n).toBe(0)
  })
})
