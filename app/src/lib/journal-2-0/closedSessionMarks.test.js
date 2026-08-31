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
import { preferBrokerMarks, brokerLiveSummary, currentPriceFor, todayReferenceFor, vintageLabel, sessionLabel } from './calculations'
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

// ── Today measured broker-mark to BROKER-mark ───────────────────────────────
// The other half of the 2026-08-29 report: the hero was $19.96 off AND Today
// read −$61.06 against Robinhood's −$23.29. Valuing at the broker's mark while
// still measuring FROM our vendor's prev_close leaves the two vendors'
// disagreement at both ends of the subtraction.
describe('the Today reference under broker marks', () => {
  // Thursday's broker marks, as the live sentinel recorded them 2026-08-28.
  const PREV = { DELL: 471.80, ORCL: 151.9399, SNAP: 5.335, SPY: 771.07, TH: 18.93 }
  const withPrev = POSITIONS.map((p) => ({ ...p, brokerPricePrev: PREV[p.symbol] }))

  it('prefers the broker prior mark over the feed prev_close', () => {
    const p = { symbol: 'SNAP', shares: 2000, brokerPrice: 5.445, brokerPricePrev: 5.335 }
    expect(todayReferenceFor(p, PRICES.SNAP, '2026-08-29', true)).toBe(5.335)
    // …but only when we are on broker marks; the live path is unchanged.
    expect(todayReferenceFor(p, PRICES.SNAP, '2026-08-29', false)).toBe(5.33)
  })

  it('falls back to the feed when no prior broker mark has synced yet', () => {
    // brokerPricePrev is null until a SECOND session has synced. Honest
    // degradation to exactly the previous behaviour, never a fabricated zero.
    const p = { symbol: 'SNAP', shares: 2000, brokerPrice: 5.445 }
    expect(todayReferenceFor(p, PRICES.SNAP, '2026-08-29', true)).toBe(5.33)
  })

  it('a genuine same-day fill still measures from the fill', () => {
    const p = { symbol: 'SNAP', shares: 10, entryPrice: 5.50, entryDate: '2026-08-29T14:00:00Z',
                brokerPrice: 5.445, brokerPricePrev: 5.335 }
    expect(todayReferenceFor(p, PRICES.SNAP, '2026-08-29', true)).toBe(5.50)
  })

  it('a placeholder broker entry date is NOT a same-day fill', () => {
    // entryEstimated rows carry the sync time as their entry date.
    const p = { symbol: 'SNAP', shares: 10, entryPrice: 5.50, entryEstimated: true,
                entryDate: '2026-08-29T07:40:00Z', brokerPricePrev: 5.335 }
    expect(todayReferenceFor(p, PRICES.SNAP, '2026-08-29', true)).toBe(5.335)
  })

  // Our option feed reported the LEAP's prior close as 675 (the broker's own
  // Thursday mark was 655) — options are deliberately outside this change, so
  // the option leg is identical either side.
  const MARKS = { s1: { currentValue: 665, prevCloseValue: 675 } }
  const STRATEGIES = [{ id: 's1', brokerCurrentValue: 675, netEntry: 610, source: 'broker' }]

  it('moves Today from -$61.06 toward the broker figure', () => {
    const before = brokerLiveSummary(ACCOUNT, POSITIONS, STRATEGIES, PRICES,
                                     '2026-08-29', MARKS, false)
    const after = brokerLiveSummary(ACCOUNT, withPrev, STRATEGIES, PRICES,
                                    '2026-08-29', MARKS, true)
    expect(before.today).toBeCloseTo(-61.06, 2)   // exactly what the owner reported
    // Equities mark-to-mark = -36.58; the option leg stays -10.00.
    expect(after.today).toBeCloseTo(-46.58, 2)
    const rh = -23.29
    expect(Math.abs(after.today - rh)).toBeLessThan(Math.abs(before.today - rh))
  })

  it('leaves the OPTION as the dominant remaining residual — pinned, not fixed', () => {
    // Our option feed says the LEAP fell 675 -> 665 on Friday (-$10); the
    // broker's own marks say it ROSE 655 -> 665 (+$10). A $20 swing on one
    // wide-spread Jan-2028 contract, and the bulk of what still separates us
    // from Robinhood's -23.29. Which prior mark is right is NOT decidable from
    // one Saturday, so nothing here guesses: the equity legs moved, the option
    // leg did not. This test exists so the next session sees the number.
    const after = brokerLiveSummary(ACCOUNT, withPrev, STRATEGIES, PRICES,
                                    '2026-08-29', MARKS, true)
    const equitiesOnly = brokerLiveSummary(ACCOUNT, withPrev, [], PRICES,
                                           '2026-08-29', {}, true)
    expect(equitiesOnly.today).toBeCloseTo(-36.58, 2)
    expect(after.today - equitiesOnly.today).toBeCloseTo(-10.00, 2)
  })

  it('keeps the rows summing to the hero on the new reference too', () => {
    const rows = buildEquityRows(withPrev, PRICES, '2026-08-29', true)
    const hero = brokerLiveSummary(ACCOUNT, withPrev, [], PRICES, '2026-08-29', {}, true)
    expect(rows.reduce((s, r) => s + r.todayDollar, 0)).toBeCloseTo(hero.today, 6)
  })
})

// ── the label a member actually reads ───────────────────────────────────────
describe('vintageLabel', () => {
  const V = (over) => ({ basis: null, session: null, conflicts: [],
                         components: { live: 0, broker: 0, cost: 0 }, ...over })

  it('says nothing when everything is live — the LIVE chip already does', () => {
    expect(vintageLabel(V({ basis: 'live', components: { live: 5, broker: 0, cost: 0 } })))
      .toBeNull()
  })

  it('names the session when the whole book is on broker marks', () => {
    expect(vintageLabel(V({ basis: 'broker', session: '2026-08-28',
                            components: { live: 0, broker: 5, cost: 0 } })))
      .toBe('As of Fri Aug 28 close')
  })

  it('admits when the broker marks are undated rather than inventing a day', () => {
    expect(vintageLabel(V({ basis: 'broker',
                            components: { live: 0, broker: 5, cost: 0 } })))
      .toBe("At your broker's last marks")
  })

  it('quantifies a blend instead of picking one side to claim', () => {
    expect(vintageLabel(V({ basis: 'mixed', session: '2026-08-28',
                            components: { live: 4, broker: 2, cost: 0 } })))
      .toBe("2 of 6 at your broker's Fri Aug 28 close")
  })

  it('calls a just-filled option what it is', () => {
    expect(vintageLabel(V({ basis: 'cost', components: { live: 0, broker: 0, cost: 1 } })))
      .toBe('At cost — no marks yet')
  })

  it('never slips the session a day, at any UTC offset', () => {
    // `new Date('2026-08-28')` is UTC midnight and renders as Aug 27 for anyone
    // west of Greenwich. This repo has paid for that bug four times.
    expect(sessionLabel('2026-08-28')).toBe('Fri Aug 28')
    expect(sessionLabel('2026-01-01')).toBe('Thu Jan 1')
  })

  it('returns the raw string rather than throwing on junk', () => {
    expect(sessionLabel('')).toBe('')
    expect(sessionLabel('not-a-date')).toBe('not-a-date')
  })
})
