/**
 * Closed-session mark preference — the hero mirrors the broker when the tape is shut.
 *
 * 2026-08-29 (Saturday): Robinhood read $9,728.40, the journal hero $9,708.44. The
 * sync was not at fault — that morning's mirror check drifted $0.02 against the
 * broker's own reported total. The gap was created afterward, by re-valuing every
 * row with our market-data vendor's closes instead of the broker's marks. Two
 * vendors never agree to the penny, and a 1.5c gap on SNAP's close is $30 on 2,000
 * shares.
 *
 * The decision itself is parity-fixtured against the Python authority
 * (composition.py :: prefer_broker_marks). What THIS file pins is the part parity
 * cannot see: that the hero and the rows beneath it move together, and that Today
 * is measured on the same price the row was valued at.
 */
import { describe, it, expect } from 'vitest'
import { preferBrokerMarks, brokerLiveSummary, currentPriceFor } from './calculations'
import { buildEquityRows } from '../../pages/journal-2-0/lib/holdingsRows'

const LAST_CLOSE = '2026-08-28' // Friday
const SYNCED = '2026-08-29T07:40:30+00:00' // Saturday 03:40 ET — after that close

const ACCOUNT = {
  balanceSource: 'broker',
  brokerCash: -22165.75,
  brokerBalanceSyncedAt: SYNCED,
}
// brokerPrice = Robinhood's own mark; prices = our vendor's Friday close.
const POSITIONS = [
  { id: 1, symbol: 'DELL', side: 'Long', shares: 5, brokerPrice: 456.07, entryPrice: 132.726, source: 'broker' },
  { id: 2, symbol: 'ORCL', side: 'Long', shares: 100, brokerPrice: 150.72, entryPrice: 126.0049, source: 'broker' },
  { id: 3, symbol: 'SNAP', side: 'Long', shares: 2000, brokerPrice: 5.445, entryPrice: 5.495, source: 'broker' },
  { id: 4, symbol: 'SPY', side: 'Long', shares: 0.2606, brokerPrice: 769.39, entryPrice: 767.407, source: 'broker' },
  { id: 5, symbol: 'TH', side: 'Long', shares: 150, brokerPrice: 18.56, entryPrice: 18.89, source: 'broker' },
]
const PRICES = {
  DELL: { price: 456.24, prev_close: 472.26 },
  ORCL: { price: 150.85, prev_close: 151.94 },
  SNAP: { price: 5.43, prev_close: 5.33 },
  SPY: { price: 769.35, prev_close: 771.10 },
  TH: { price: 18.55, prev_close: 18.96 },
}

describe('preferBrokerMarks — JS-lane specifics', () => {
  it('reads a naive timestamp as UTC, never as browser-local time', () => {
    // A machine in Tokyo must not decide this differently than one in Denver.
    expect(preferBrokerMarks(
      { brokerBalanceSyncedAt: '2026-08-29T07:40:30' }, true, LAST_CLOSE,
    )).toBe(true)
  })

  it('refuses when the session is open, however fresh the sync', () => {
    expect(preferBrokerMarks(ACCOUNT, false, LAST_CLOSE)).toBe(false)
  })

  it('refuses a sync that predates the last close (the weekday-evening trap)', () => {
    // Friday 03:40 ET holds THURSDAY's marks; mirroring them on Friday night
    // would show a day-stale account — far worse than the gap this closes.
    expect(preferBrokerMarks(
      { brokerBalanceSyncedAt: '2026-08-28T07:40:30+00:00' }, true, LAST_CLOSE,
    )).toBe(false)
  })
})

describe('currentPriceFor', () => {
  it('is a preference, not a restriction — falls back when a mark is missing', () => {
    const provisional = { symbol: 'NEW', shares: 10 } // just-filled, no broker mark
    expect(currentPriceFor(provisional, { NEW: { price: 4 } }, true)).toBe(4)
  })

  it('still prefers the live price when the session is open', () => {
    expect(currentPriceFor(POSITIONS[2], PRICES, false)).toBe(5.43)
    expect(currentPriceFor(POSITIONS[2], PRICES, true)).toBe(5.445)
  })
})

describe('brokerLiveSummary under broker marks', () => {
  it('reproduces the reported hero with live marks', () => {
    const r = brokerLiveSummary(ACCOUNT, POSITIONS, [], PRICES, '2026-08-29', {}, false)
    expect(r.netLiq).toBeCloseTo(9043.44, 2) // no option strategy in this fixture
  })

  it('moves the hero onto the broker marks when the session is closed', () => {
    const live = brokerLiveSummary(ACCOUNT, POSITIONS, [], PRICES, '2026-08-29', {}, false)
    const broker = brokerLiveSummary(ACCOUNT, POSITIONS, [], PRICES, '2026-08-29', {}, true)
    // The broker's marks value the book $17.66 higher than our vendor's closes.
    expect(broker.marketValue - live.marketValue).toBeCloseTo(17.66, 2)
  })

  it('keeps netLiq and today on the SAME price', () => {
    // (netLiq − today) is the previous-close equity a member reads as their
    // starting point. If today came from live ticks while netLiq came from
    // broker marks, that figure would belong to neither vintage.
    const r = brokerLiveSummary(ACCOUNT, POSITIONS, [], PRICES, '2026-08-29', {}, true)
    const expectedToday = POSITIONS.reduce(
      (s, p) => s + p.shares * (p.brokerPrice - PRICES[p.symbol].prev_close), 0,
    )
    expect(r.today).toBeCloseTo(expectedToday, 6)
  })
})

describe('the rows must sum to the hero', () => {
  // The reason the flag is threaded through the row builders at all. A hero on
  // the broker's marks above rows on our vendor's closes is a new defect: the
  // member adds up what they can see and gets a different number.
  it.each([[false], [true]])('holds with preferBroker=%s', (prefer) => {
    const hero = brokerLiveSummary(ACCOUNT, POSITIONS, [], PRICES, '2026-08-29', {}, prefer)
    const rows = buildEquityRows(POSITIONS, PRICES, '2026-08-29', prefer)
    const summed = rows.reduce((s, r) => s + r.marketValue, 0)
    expect(summed).toBeCloseTo(hero.marketValue, 6)

    const summedToday = rows.reduce((s, r) => s + r.todayDollar, 0)
    expect(summedToday).toBeCloseTo(hero.today, 6)
  })

  it('derives each row percent from the price it actually shows', () => {
    // Otherwise SNAP renders the feed's +1.88% beside a broker-marked +$230.
    const [snap] = buildEquityRows([POSITIONS[2]], PRICES, '2026-08-29', true)
    expect(snap.price).toBe(5.445)
    expect(snap.todayDollar).toBeCloseTo(230, 6)
    expect(snap.changePct).toBeCloseTo(((5.445 - 5.33) / 5.33) * 100, 6)
  })
})
