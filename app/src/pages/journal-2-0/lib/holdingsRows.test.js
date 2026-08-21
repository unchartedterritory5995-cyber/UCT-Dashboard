import { describe, it, expect } from 'vitest'
import { buildEquityRows, sortRows, SORT_OPTIONS } from './holdingsRows'

const TODAY = '2026-07-02'

const long = {
  id: 1, symbol: 'AAPL', side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-01',
}
const short = {
  id: 2, symbol: 'TSLA', side: 'Short', shares: 5, entryPrice: 200, entryDate: '2026-06-01',
}
const openedToday = {
  id: 3, symbol: 'NVDA', side: 'Long', shares: 2, entryPrice: 150, entryDate: TODAY,
}

const prices = {
  AAPL: { price: 110, change_pct: 2, prev_close: 107.84 },
  TSLA: { price: 190, change_pct: -1, prev_close: 191.92 },
  NVDA: { price: 155, change_pct: 4, prev_close: 149.04 },
}

describe('buildEquityRows', () => {
  it('computes price, market value and total return (long)', () => {
    const [row] = buildEquityRows([long], prices, TODAY)
    expect(row.kind).toBe('equity')
    expect(row.price).toBe(110)
    expect(row.marketValue).toBe(1100)
    expect(row.totalReturnDollar).toBe(100)          // (110-100)*10
    expect(row.totalReturnPct).toBeCloseTo(0.1)
    expect(row.changePct).toBe(2)
  })

  it('today$ = signedShares × (price − prev_close); shorts flip sign', () => {
    const [row] = buildEquityRows([short], prices, TODAY)
    // short: -5 × (190 − 191.92) = +9.6
    expect(row.todayDollar).toBeCloseTo(9.6)
    expect(row.changePct).toBe(-1)                   // stock-centric, not flipped
  })

  it('same-day entries measure today from the fill price', () => {
    const [row] = buildEquityRows([openedToday], prices, TODAY)
    expect(row.todayDollar).toBeCloseTo((155 - 150) * 2)  // ref = entry, not prev_close
  })

  it('same-day rule fires with FULL ISO timestamps (the real API shape)', () => {
    const p = { ...openedToday, entryDate: `${TODAY}T14:32:11+00:00` }
    const [row] = buildEquityRows([p], prices, TODAY)
    expect(row.todayDollar).toBeCloseTo((155 - 150) * 2)
  })

  it('derives prev_close from change_pct when snapshot lacks it', () => {
    const p = { ...long }
    const noPc = { AAPL: { price: 110, change_pct: 10 } }  // implied prev_close = 100
    const [row] = buildEquityRows([p], noPc, TODAY)
    expect(row.todayDollar).toBeCloseTo(100)               // 10 × (110 − 100)
  })

  it('falls back to broker mark and nulls today when no live entry', () => {
    const p = { ...long, brokerPrice: 105 }
    const [row] = buildEquityRows([p], {}, TODAY)
    expect(row.price).toBe(105)
    expect(row.todayDollar).toBeNull()
    expect(row.changePct).toBeNull()
    expect(row.marketValue).toBe(1050)
  })
})

describe('sortRows', () => {
  const rows = buildEquityRows([long, short, openedToday], prices, TODAY)

  it('exposes the RH sort options', () => {
    expect(SORT_OPTIONS.map((o) => o.key)).toEqual(
      ['symbol', 'price', 'changePct', 'marketValue', 'todayDollar', 'totalReturnDollar'],
    )
  })

  it('sorts text asc and numeric desc', () => {
    expect(sortRows(rows, 'symbol', 'asc').map((r) => r.symbol)).toEqual(['AAPL', 'NVDA', 'TSLA'])
    expect(sortRows(rows, 'price', 'desc').map((r) => r.symbol)).toEqual(['TSLA', 'NVDA', 'AAPL'])
  })

  it('sinks null sort values last regardless of direction', () => {
    const withNull = [...rows, { kind: 'equity', key: 'x', symbol: 'ZZZ', price: null }]
    expect(sortRows(withNull, 'price', 'desc').at(-1).symbol).toBe('ZZZ')
    expect(sortRows(withNull, 'price', 'asc').at(-1).symbol).toBe('ZZZ')
  })

  it('does not mutate the input', () => {
    const before = rows.map((r) => r.symbol)
    sortRows(rows, 'price', 'desc')
    expect(rows.map((r) => r.symbol)).toEqual(before)
  })
})

describe('buildEquityRows — reconnect fidelity (2026-08-20)', () => {
  it('an ESTIMATED entry stamped today uses prev close, not the avg cost', () => {
    const positions = [{
      id: 'p1', symbol: 'DELL', side: 'Long', shares: 5,
      entryPrice: 132.726, entryDate: '2026-08-20T20:58:48Z', entryEstimated: true,
    }]
    const prices = { DELL: { price: 434.78, prev_close: 437.55, change_pct: -0.63 } }
    const rows = buildEquityRows(positions, prices, '2026-08-20')
    expect(rows[0].todayDollar).toBeCloseTo(5 * (434.78 - 437.55), 2)
  })
  it('prev_close 0 falls back to the change_pct derivation', () => {
    const positions = [{ id: 'p2', symbol: 'ORCL', side: 'Long', shares: 100, entryPrice: 126, entryDate: '2026-07-21T16:36:20Z' }]
    const prices = { ORCL: { price: 142.07, prev_close: 0, change_pct: -1.2099 } }
    const rows = buildEquityRows(positions, prices, '2026-08-20')
    const ref = 142.07 / (1 + -1.2099 / 100)
    expect(rows[0].todayDollar).toBeCloseTo(100 * (142.07 - ref), 6)
  })
})
