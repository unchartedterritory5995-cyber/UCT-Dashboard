import { describe, it, expect } from 'vitest'
import { yourPositionModel, statsModel, analystModel, fmtVolume } from './positionDetail'

const TODAY = '2026-07-02'

describe('yourPositionModel', () => {
  const long = { id: 1, symbol: 'AAPL', side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-01' }
  const snap = { price: 110, change_pct: 2, prev_close: 107.84 }

  it('computes the six RH Your Position figures (long)', () => {
    const m = yourPositionModel(long, snap, 5500, TODAY)
    expect(m.shares).toBe(10)
    expect(m.marketValue).toBe(1100)
    expect(m.avgCost).toBe(100)
    expect(m.diversityPct).toBeCloseTo(0.2)               // 1100 / 5500
    expect(m.todayDollar).toBeCloseTo(10 * (110 - 107.84))
    expect(m.totalReturnDollar).toBe(100)
    expect(m.totalReturnPct).toBeCloseTo(0.1)
  })

  it('short: today and total return sign-flip; market value stays positive', () => {
    const short = { id: 2, symbol: 'TSLA', side: 'Short', shares: 5, entryPrice: 200, entryDate: '2026-06-01' }
    const m = yourPositionModel(short, { price: 190, change_pct: -1, prev_close: 191.92 }, null, TODAY)
    expect(m.marketValue).toBe(950)
    expect(m.todayDollar).toBeCloseTo(9.6)                 // -5 × (190 − 191.92)
    expect(m.totalReturnDollar).toBe(50)                   // (200 − 190) × 5
    expect(m.diversityPct).toBeNull()                      // no netLiq
  })

  it('same-day entry measures today from the fill', () => {
    const p = { id: 3, symbol: 'NVDA', side: 'Long', shares: 2, entryPrice: 150, entryDate: TODAY }
    const m = yourPositionModel(p, { price: 155, change_pct: 4 }, null, TODAY)
    expect(m.todayDollar).toBeCloseTo(10)
  })

  it('null position → null', () => {
    expect(yourPositionModel(null, snap, 1000, TODAY)).toBeNull()
  })
})

describe('statsModel', () => {
  const metrics = {
    market_cap: '$3.30T', pe_forward: 28.5, div_yield_pct: 0.5,
    week52_high: 260, week52_low: 164,
  }
  const bars = [
    { t: 1, o: 100, h: 105, l: 99, c: 104, v: 1_000_000 },
    { t: 2, o: 104, h: 111, l: 103, c: 110, v: 2_000_000 },
  ]

  it('produces the closed RH stats list in order', () => {
    const rows = statsModel(metrics, bars)
    expect(rows.map((r) => r.label)).toEqual([
      'Market cap', 'P/E ratio', 'Div yield', 'Avg volume',
      'High today', 'Low today', 'Open', 'Volume',
      '52wk high', '52wk low',
    ])
    const by = Object.fromEntries(rows.map((r) => [r.label, r.value]))
    expect(by['Market cap']).toBe('$3.30T')
    expect(by['High today']).toBe('$111.00')
    expect(by.Open).toBe('$104.00')
    expect(by.Volume).toBe('2.00M')
    expect(by['Avg volume']).toBe('1.50M')                 // mean of 1M + 2M
    expect(by['52wk high']).toBe('$260.00')
  })

  it('missing feeds render as dashes, never crash', () => {
    const rows = statsModel({}, [])
    expect(rows).toHaveLength(10)
    expect(rows.every((r) => r.value === '—')).toBe(true)
  })
})

describe('analystModel', () => {
  it('buckets per RH: Buy=strongBuy+buy, Sell=sell+strongSell', () => {
    const m = analystModel({
      consensus: { strongBuy: 12, buy: 8, hold: 5, sell: 3, strongSell: 2, total: 30, label: 'Buy' },
    })
    expect(m.total).toBe(30)
    expect(m.buyPct).toBeCloseTo(20 / 30)
    expect(m.holdPct).toBeCloseTo(5 / 30)
    expect(m.sellPct).toBeCloseTo(5 / 30)
    expect(m.label).toBe('Buy')
  })

  it('null/empty consensus → null', () => {
    expect(analystModel(null)).toBeNull()
    expect(analystModel({ consensus: null })).toBeNull()
    expect(analystModel({ consensus: { total: 0 } })).toBeNull()
  })
})

describe('fmtVolume', () => {
  it('formats K/M/B', () => {
    expect(fmtVolume(950)).toBe('950')
    expect(fmtVolume(12_500)).toBe('12.50K')
    expect(fmtVolume(2_000_000)).toBe('2.00M')
    expect(fmtVolume(3_100_000_000)).toBe('3.10B')
    expect(fmtVolume(null)).toBe('—')
  })
})
