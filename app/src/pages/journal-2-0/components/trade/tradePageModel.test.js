import { describe, it, expect } from 'vitest'
import { outcomeModel, buildTradeMarkers, neighborIds } from './tradePageModel'

const emptyFilters = () => ({
  dateFrom: '', dateTo: '', symbol: '', sides: new Set(), setups: new Set(),
})

describe('outcomeModel', () => {
  it('detects the no-stop contract: null R + stop == entry → noStop, special rLabel', () => {
    const m = outcomeModel({
      side: 'Long', entryPrice: 50, originalStop: 50, rMultiple: null,
      pnlDollar: 120, pnlPercent: 0.06, holdDays: 3,
    })
    expect(m.noStop).toBe(true)
    expect(m.r).toBeNull()
    expect(m.rLabel).toBe('R: — (no stop logged)')
  })

  it('a distinct stop with a real R is NOT no-stop', () => {
    const m = outcomeModel({
      side: 'Long', entryPrice: 50, originalStop: 47, rMultiple: 2, pnlDollar: 90,
    })
    expect(m.noStop).toBe(false)
    expect(m.r).toBe(2)
    expect(m.rLabel).toBe('R: +2.0R')
  })

  it('a distinct stop but null R shows R: — (not the no-stop copy)', () => {
    const m = outcomeModel({
      side: 'Long', entryPrice: 50, originalStop: 47, rMultiple: null,
    })
    expect(m.noStop).toBe(false)
    expect(m.rLabel).toBe('R: —')
  })

  it('net P&L falls back pnlDollarNet ?? pnlDollar', () => {
    expect(outcomeModel({ pnlDollarNet: 88, pnlDollar: 100 }).netPnl).toBe(88)
    expect(outcomeModel({ pnlDollar: 100 }).netPnl).toBe(100)
    expect(outcomeModel({ pnlDollarNet: 0, pnlDollar: 100 }).netPnl).toBe(0)
  })

  it('pnlPct is passed through as the raw fraction', () => {
    expect(outcomeModel({ pnlPercent: 0.1234 }).pnlPct).toBe(0.1234)
  })

  it('hold label reads as human days; exitEfficiency slot is null (P2 fills it)', () => {
    expect(outcomeModel({ holdDays: 0 }).holdLabel).toBe('Same day')
    expect(outcomeModel({ holdDays: 1 }).holdLabel).toBe('1 day')
    expect(outcomeModel({ holdDays: 4 }).holdLabel).toBe('4 days')
    expect(outcomeModel({}).holdLabel).toBe('—')
    expect(outcomeModel({ holdDays: 4 }).exitEfficiency).toBeNull()
  })
})

describe('buildTradeMarkers', () => {
  const base = {
    side: 'Long', shares: 100, entryPrice: 50, exitPrice: 60,
    entryDate: '2026-05-01', exitDate: '2026-05-10', originalStop: 47,
  }

  it('emits exactly 2 markers (entry + exit) for one closed trade', () => {
    const { markers } = buildTradeMarkers({ ...base, result: 'Win' }, 'D')
    expect(markers).toHaveLength(2)
  })

  it('colors the exit marker by result', () => {
    const exit = (result) => buildTradeMarkers({ ...base, result }, 'D').markers
      .find((mk) => mk.text.startsWith('SELL'))
    expect(exit('Win').color).toBe('#22c55e')
    expect(exit('Loss').color).toBe('#ef4444')
    expect(exit('BE').color).toBe('#eab308')
  })

  it('draws entry + stop price lines; the no-stop case draws only entry', () => {
    const withStop = buildTradeMarkers({ ...base, result: 'Win' }, 'D').priceLines
    expect(withStop.map((l) => l.title).sort()).toEqual(['Entry', 'Stop'])

    const noStop = buildTradeMarkers(
      { ...base, originalStop: 50, result: 'Win' }, 'D',
    ).priceLines
    expect(noStop.map((l) => l.title)).toEqual(['Entry'])
  })

  it('returns empty results when trade or tf is missing', () => {
    expect(buildTradeMarkers(null, 'D')).toEqual({ markers: [], priceLines: [] })
    expect(buildTradeMarkers(base, null)).toEqual({ markers: [], priceLines: [] })
  })
})

describe('neighborIds', () => {
  const trades = [
    { id: 'a', symbol: 'AAA', side: 'Long', setup: 'VCP', entryDate: '2026-05-01' },
    { id: 'b', symbol: 'BBB', side: 'Short', setup: 'HTF', entryDate: '2026-05-02' },
    { id: 'c', symbol: 'CCC', side: 'Long', setup: 'VCP', entryDate: '2026-05-03' },
  ]

  it('returns the neighbors around the current id in array order', () => {
    expect(neighborIds(trades, emptyFilters(), 'b')).toEqual({ prevId: 'a', nextId: 'c' })
  })

  it('returns null at each end', () => {
    expect(neighborIds(trades, emptyFilters(), 'a')).toEqual({ prevId: null, nextId: 'b' })
    expect(neighborIds(trades, emptyFilters(), 'c')).toEqual({ prevId: 'b', nextId: null })
  })

  it('honors active filters so neighbors stay within the filtered set', () => {
    const f = { ...emptyFilters(), setups: new Set(['VCP']) }  // → [a, c]
    expect(neighborIds(trades, f, 'a')).toEqual({ prevId: null, nextId: 'c' })
    expect(neighborIds(trades, f, 'c')).toEqual({ prevId: 'a', nextId: null })
  })

  it('returns nulls when the current id is not in the filtered set', () => {
    const f = { ...emptyFilters(), symbol: 'ZZZ' }
    expect(neighborIds(trades, f, 'a')).toEqual({ prevId: null, nextId: null })
  })
})
