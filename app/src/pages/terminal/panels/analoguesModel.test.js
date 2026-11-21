// ANLG's model: the breadth analogues answer -> the panel's rows, cells and summary. Rails:
//   * the count is a whole number from 3 to 10, the default 5 writes nothing into the command;
//   * the read states (failed, thin history, no match, ok) are told apart from the body alone;
//   * a forward window the calendar has not reached is "not yet", is left out of that window's
//     count and median, and is never a 0;
//   * every summary sentence carries its count; the median of an even set is the middle two's mean.
// Every number is invented; the fixtures are the route's real shape.
import { describe, it, expect } from 'vitest'
import {
  ANLG_CODE, ANLG_COUNT_DEFAULT, ANLG_COUNT_MAX, ANLG_COUNT_MIN, ANLG_RECORD_LINE, ANLG_WINDOWS, anlgCommandArgs, anlgRead, anlgUrl,
  cellFor, countLine, dayWithYear, matchText, normAnlgCount, parseAnlgCount, returnSign, returnText, summaryFor, windowSummary,
} from './analoguesModel'

const match = (date, similarity, forward_returns, over = {}) => ({
  date, similarity, distance: 0.03, metrics_then: { breadth_score: 61, vix: 17.2, sp500_close: 5120.4 }, forward_returns, ...over,
})
const A = match('2025-03-04', 97.3, { fwd_5d: 1.2, fwd_10d: 2.4, fwd_20d: -0.8, fwd_60d: 6.1 })
const B = match('2024-09-12', 95.8, { fwd_5d: -0.6, fwd_10d: 0.4, fwd_20d: 1.9, fwd_60d: 4.4 })
const C = match('2026-10-21', 94.1, { fwd_5d: 0.9, fwd_10d: -1.1, fwd_20d: 2.6 })              // 60 days not reached
const D = match('2026-11-03', 93.6, { fwd_5d: 0, fwd_10d: 1.5 })                                // 20 and 60 not reached
const E = match('2025-06-18', 92.2, {})                                                          // no stored close
const body = (analogues, over = {}) => ({ reference_date: '2026-11-19', reference_metrics: { breadth_score: 63 }, analogues, ...over })

describe('ANLG the count', () => {
  it('is the route\'s own bounds and default', () => {
    expect([ANLG_CODE, ANLG_COUNT_MIN, ANLG_COUNT_MAX, ANLG_COUNT_DEFAULT]).toEqual(['ANLG', 3, 10, 5])
    expect(ANLG_WINDOWS.map((w) => [w.key, w.days])).toEqual([['fwd_5d', 5], ['fwd_10d', 10], ['fwd_20d', 20], ['fwd_60d', 60]])
    expect(ANLG_RECORD_LINE).toBe('A record of what followed similar days, not a forecast.')
  })

  it('takes a whole number from 3 to 10 and nothing else', () => {
    for (const n of [3, 4, 5, 6, 7, 8, 9, 10]) expect(parseAnlgCount(String(n)), String(n)).toBe(n)
    expect(parseAnlgCount(7)).toBe(7)
    expect(parseAnlgCount(' 8 ')).toBe(8)
    for (const bad of ['2', '11', '0', '-5', '5.5', '5X', 'FIVE', '', null, undefined, '007', '1e1']) expect(parseAnlgCount(bad), String(bad)).toBeNull()
  })

  it('anything else is the default; the default writes nothing into the command', () => {
    expect(normAnlgCount('8')).toBe(8)
    expect(normAnlgCount('99')).toBe(5)
    expect(normAnlgCount(undefined)).toBe(5)
    expect(anlgCommandArgs({ count: 5 })).toEqual([])
    expect(anlgCommandArgs({ count: 8 })).toEqual(['8'])
    expect(anlgCommandArgs({ count: 'x' })).toEqual([])
    expect(anlgCommandArgs()).toEqual([])
    expect(anlgUrl(8)).toBe('/api/breadth-monitor/analogues?top_n=8')
    expect(anlgUrl()).toBe('/api/breadth-monitor/analogues?top_n=5')
    expect(anlgUrl(40)).toBe('/api/breadth-monitor/analogues?top_n=5')
  })
})

describe('ANLG words', () => {
  it('a day carries its year; a return carries its sign; a match its percent', () => {
    expect(dayWithYear('2025-03-04')).toBe('Tue Mar 4, 2025')
    expect(dayWithYear('2025-02-30')).toBe('an unknown day')
    expect(dayWithYear(null)).toBe('an unknown day')
    expect([returnText(1.234), returnText(-0.4), returnText(0), returnText(-0.001), returnText(null), returnText('3')])
      .toEqual(['+1.23%', '-0.40%', '0.00%', '0.00%', 'n/a', 'n/a'])
    expect([returnSign(2), returnSign(-2), returnSign(0), returnSign(undefined)]).toEqual(['up', 'down', 'flat', null])
    expect([matchText(97.3), matchText(100), matchText(null)]).toEqual(['97.3% match', '100.0% match', 'n/a'])
  })
})

describe('ANLG the read', () => {
  it('tells a failed read, thin history, no match and an answer apart', () => {
    for (const bad of [null, undefined, [], 'x', { status: 'ok' }, { reference_date: '2026-11-19' }, { analogues: {} }]) {
      expect(anlgRead(bad).state, JSON.stringify(bad)).toBe('failed')
    }
    expect(anlgRead({ reference_date: null, analogues: [], reference_metrics: {} })).toEqual({ state: 'thin', reference: null, rows: [] })
    expect(anlgRead(body([]))).toEqual({ state: 'nomatch', reference: '2026-11-19', rows: [] })
    // rows with no reference day are not the route's answer
    expect(anlgRead({ reference_date: null, analogues: [A] }).state).toBe('failed')
    const view = anlgRead(body([A, B, C]))
    expect(view.state).toBe('ok')
    expect(view.reference).toBe('2026-11-19')
    expect(view.rows.map((r) => r.date)).toEqual(['2025-03-04', '2024-09-12', '2026-10-21'])
  })

  it('keeps the route\'s order, drops a row with no date, and reads an absent window as null, never 0', () => {
    const view = anlgRead(body([A, { similarity: 90, forward_returns: { fwd_5d: 1 } }, 'x', C, D, E]))
    expect(view.rows).toHaveLength(4)
    expect(view.rows[1]).toEqual({ date: '2026-10-21', similarity: 94.1, returns: { fwd_5d: 0.9, fwd_10d: -1.1, fwd_20d: 2.6, fwd_60d: null }, noReturns: false })
    expect(view.rows[2].returns).toEqual({ fwd_5d: 0, fwd_10d: 1.5, fwd_20d: null, fwd_60d: null })
    expect(view.rows[3]).toEqual({ date: '2025-06-18', similarity: 92.2, returns: { fwd_5d: null, fwd_10d: null, fwd_20d: null, fwd_60d: null }, noReturns: true })
    // a figure that is not a number is no figure
    const odd = anlgRead(body([match('2025-01-02', '97', { fwd_5d: '1.0', fwd_10d: NaN, fwd_20d: null })])).rows[0]
    expect(odd.similarity).toBeNull()
    expect(odd.noReturns).toBe(true)
  })

  it('a cell is a value, "not yet" (the calendar has not reached it) or no figure (no stored close)', () => {
    const [a, c, d, e] = anlgRead(body([A, C, D, E])).rows
    expect(cellFor(a, 'fwd_60d')).toEqual({ kind: 'value', text: '+6.10%', sign: 'up' })
    expect(cellFor(a, 'fwd_20d')).toEqual({ kind: 'value', text: '-0.80%', sign: 'down' })
    expect(cellFor(d, 'fwd_5d')).toEqual({ kind: 'value', text: '0.00%', sign: 'flat' })   // a real zero stays a value
    expect(cellFor(c, 'fwd_60d')).toEqual({ kind: 'notyet' })
    expect(cellFor(d, 'fwd_20d')).toEqual({ kind: 'notyet' })
    expect(cellFor(e, 'fwd_5d')).toEqual({ kind: 'none' })
  })
})

describe('ANLG what followed', () => {
  const rows = anlgRead(body([A, B, C, D])).rows

  it('counts higher and lower over the sessions that have the window, and says the count', () => {
    const [d5, d10, d20, d60] = summaryFor(rows)
    expect(d5).toMatchObject({ key: 'fwd_5d', days: 5, label: '5 trading days later', of: 4, n: 4, higher: 2, lower: 1, flat: 1 })
    expect(d5.median).toBeCloseTo(0.45, 10)                      // -0.6, 0, 0.9, 1.2 -> (0 + 0.9) / 2
    expect(d5.text).toBe('2 of 4 higher, 1 lower, median +0.45% (4 sessions)')
    expect(d10.text).toBe('3 of 4 higher, 1 lower, median +0.95% (4 sessions)')
    expect(d20).toMatchObject({ n: 3, higher: 2, lower: 1 })
    expect(d20.median).toBe(1.9)                                 // -0.8, 1.9, 2.6 -> the middle one
    expect(d20.text).toBe('2 of 3 higher, 1 lower, median +1.90% (3 sessions; 1 not yet)')
    expect(d60.text).toBe('2 of 2 higher, 0 lower, median +5.25% (2 sessions; 2 not yet)')
  })

  it('a window no session has reached says "not yet" with the count, and has no median', () => {
    const young = anlgRead(body([C, D])).rows
    const d60 = windowSummary(young, ANLG_WINDOWS[3])
    expect(d60).toMatchObject({ n: 0, of: 2, higher: 0, lower: 0, median: null })
    expect(d60.text).toBe('Not yet: none of the 2 sessions has 60 trading days of history after it.')
    expect(windowSummary(anlgRead(body([D])).rows, ANLG_WINDOWS[2]).text).toBe('Not yet: none of the 1 session has 20 trading days of history after it.')
    // a session with no stored close is "no figure", which is not the same as "not yet"
    const mixed = windowSummary(anlgRead(body([A, D, E])).rows, ANLG_WINDOWS[2])
    expect(mixed).toMatchObject({ n: 1, of: 3, notYet: 1, noFigure: 1 })
    expect(mixed.text).toBe('0 of 1 higher, 1 lower, median -0.80% (1 session; 1 not yet; 1 with no figure)')
    expect(windowSummary(anlgRead(body([E])).rows, ANLG_WINDOWS[0]).text).toBe('No figure: no S&P 500 close is stored to measure the 1 session from.')
  })

  it('one session reads "1 session", never a rate', () => {
    expect(windowSummary(anlgRead(body([A])).rows, ANLG_WINDOWS[0]).text).toBe('1 of 1 higher, 0 lower, median +1.20% (1 session)')
  })

  it('the count line says how many came back, for which day, and calls it a small sample', () => {
    const view = anlgRead(body([A, B, C, D, E]))
    expect(countLine(view, 5)).toBe('The 5 past sessions whose breadth looked most like Thu Nov 19, closest first, and what the S&P 500 did after each. 5 sessions is a small sample.')
    const few = anlgRead(body([A, B]))
    expect(countLine(few, 5)).toBe('Only 2 sessions came back of the 5 asked for, compared with Thu Nov 19. That is too few to read as a pattern.')
    expect(countLine(anlgRead(body([A])), 3)).toBe('Only 1 session came back of the 3 asked for, compared with Thu Nov 19. That is too few to read as a pattern.')
  })
})
