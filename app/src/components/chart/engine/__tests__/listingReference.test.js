// ─── ⭐ THE LISTING STATEMENT'S REFERENCE DATE (B1P, 2026-10-04) ───────────────
//
// `historyFromListingOf` is exact by ruling R-W and stays exact. What this file
// pins is the DATE it is compared against: the server's corroborated first
// session (`first_trade_date`) when the payload carries one, else `list_date`.
//
// The dates are production's, measured 2026-10-04: `/api/ticker-ipo/SPY` answers
// `list_date: "1993-01-22"` (the fund's inception) and `/api/bars/SPY?tf=D&bars=12500`
// answers 8477 bars whose first is `1993-01-29` — the same bar 0 TradingView
// records (`vw-rt7-empty-reduce-fixnan-spy-1d-2026-10-04`, startsAtBar0).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { historyFromListingOf, listingReferenceDate } from '../listingSeed'

const SPY_BARS = [{ t: '1993-01-29' }, { t: '1993-02-01' }, { t: '1993-02-02' }]
const SPY_LIST_DATE = '1993-01-22'

describe('listingReferenceDate', () => {
  it('⭐ prefers the corroborated first session', () => {
    expect(listingReferenceDate({ list_date: SPY_LIST_DATE, first_trade_date: '1993-01-29' })).toBe('1993-01-29')
  })
  it.each([
    ['no first_trade_date', { list_date: SPY_LIST_DATE }, SPY_LIST_DATE],
    ['a null first_trade_date', { list_date: SPY_LIST_DATE, first_trade_date: null }, SPY_LIST_DATE],
    ['a malformed first_trade_date', { list_date: SPY_LIST_DATE, first_trade_date: '1993-1-29' }, SPY_LIST_DATE],
    ['nothing at all', { list_date: null }, null],
    ['no payload', undefined, null],
  ])('falls back to list_date: %s', (_why, ipo, want) => {
    expect(listingReferenceDate(ipo)).toBe(want)
  })
})

describe('SPY, end to end through the producer', () => {
  it('⛔ NON-VACUITY: on list_date alone SPY is off-listing (a week apart)', () => {
    expect(historyFromListingOf({ bars: SPY_BARS, tf: 'D', listDate: listingReferenceDate({ list_date: SPY_LIST_DATE }) })).toBe(false)
  })
  it('⭐ with the corroborated first session SPY reaches its listing', () => {
    const ipo = { list_date: SPY_LIST_DATE, first_trade_date: '1993-01-29' }
    expect(historyFromListingOf({ bars: SPY_BARS, tf: 'D', listDate: listingReferenceDate(ipo) })).toBe(true)
  })
  it('⛔ exactness is kept: a first session one day off is still NO', () => {
    const ipo = { list_date: SPY_LIST_DATE, first_trade_date: '1993-01-28' }
    expect(historyFromListingOf({ bars: SPY_BARS, tf: 'D', listDate: listingReferenceDate(ipo) })).toBe(false)
  })
})

describe('the chart wires the reference date, and the IPO badge keeps list_date', () => {
  // A source rail: StockChart is ~17k lines and does not mount in a unit test.
  // It pins the ONE call that produces the member chart's listing statement.
  const src = fs.readFileSync(path.resolve(__dirname, '../../../StockChart.jsx'), 'utf8')
  it('⭐ historyFromListingOf is fed listingReferenceDate(ipoInfo)', () => {
    const calls = src.match(/historyFromListingOf\(\{[\s\S]*?\}\)/g) || []
    expect(calls.length, 'NON-VACUITY: the producer call was not found').toBe(1)
    expect(calls[0]).toMatch(/listDate:\s*listingReferenceDate\(ipoInfo\)/)
  })
  it('⭐ the IPO badge still reads list_date', () => {
    expect(src).toMatch(/const ld = ipoInfo\?\.list_date/)
  })
})
