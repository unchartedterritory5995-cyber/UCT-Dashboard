// The arithmetic behind RRG / REL / CORR, on series whose answer is known by construction.
import { describe, it, expect } from 'vitest'
import {
  alignCloses, closesFromBars, collectSymbols, correlationMatrix, maxDrawdown, pearson, quadrantOf,
  rebase, relativePerformance, rrgPath, sma, windowSessions, MIN_CORR_SESSIONS,
} from './relativeMath'
import { series, weekdays, wiggle } from './__fixtures__/compareFixtures'

describe('closes and alignment', () => {
  it('reads ISO and unix-second bars, sorts them, and keeps the LAST bar of a date', () => {
    const out = closesFromBars({ bars: [
      { t: '2026-01-06', c: 11 }, { t: 1767571200, c: 10 }, { t: '2026-01-06T00:00:00', c: 12 }, { t: 'junk', c: 1 }, { t: '2026-01-07', c: 0 },
    ] })
    expect(out).toEqual([{ d: '2026-01-05', c: 10 }, { d: '2026-01-06', c: 12 }])
  })

  it('aligns ONLY on sessions both series traded (a halt never borrows a neighbour)', () => {
    const a = [{ d: '2026-01-05', c: 1 }, { d: '2026-01-06', c: 2 }, { d: '2026-01-07', c: 3 }]
    const b = [{ d: '2026-01-05', c: 10 }, { d: '2026-01-07', c: 30 }]
    const { dates, closes } = alignCloses({ A: a, B: b })
    expect(dates).toEqual(['2026-01-05', '2026-01-07'])
    expect(closes).toEqual({ A: [1, 3], B: [10, 30] })
  })

  it('sma is null until n values exist, then the plain mean', () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5])
    expect(sma([1, 2], 3)).toEqual([null, null])
  })

  it('rebase, drawdown', () => {
    expect(rebase([100, 110, 99], 0).map((v) => Math.round(v * 10) / 10)).toEqual([0, 10, -1])
    expect(Math.round(maxDrawdown([100, 120, 90, 130]))).toBe(-25)
    expect(maxDrawdown([1, 2, 3])).toBe(0)
  })

  it('YTD counts from the last close of the previous year', () => {
    const dates = ['2025-12-30', '2025-12-31', '2026-01-02', '2026-01-05']
    expect(windowSessions('YTD', dates)).toBe(2)   // base = 2025-12-31
    expect(windowSessions('6M', dates)).toBe(3)    // capped at what the data holds
    expect(windowSessions('1M', ['2026-01-02'])).toBe(0)
  })

  it('collectSymbols: own security first, $ stripped, de-duplicated, capped', () => {
    expect(collectSymbols('nvda', { with0: '$AMD', with1: 'NVDA', with2: 'smh' })).toEqual(['NVDA', 'AMD', 'SMH'])
    expect(collectSymbols(null, { with0: 'A', with1: 'B', with2: 'C' }, 2)).toEqual(['A', 'B'])
  })
})

describe('REL', () => {
  const dates = weekdays(300)
  it('A rising 0.2%/day vs a flat B: A leads, the excess and the ratio say so, the base reads "base"', () => {
    const A = series(dates, () => 0.002)
    const B = series(dates, () => 0)
    const r = relativePerformance({ A, B }, ['A', 'B'], '6M')
    expect(r.sessions).toBe(126)
    expect(r.rows[0]).toMatchObject({ sym: 'A', excess: null })
    expect(r.rows[0].ret).toBeCloseTo((1.002 ** 126 - 1) * 100, 6)
    expect(r.rows[1].ret).toBeCloseTo(0, 9)
    expect(r.rows[1].excess).toBeCloseTo(-r.rows[0].ret, 9)
    expect(r.ratio).toMatchObject({ a: 'A', b: 'B', aboveAvg: true })
    expect(r.ratio.change).toBeGreaterThan(20)
    expect(r.lines[0].pct[0]).toBe(0)
  })

  it('non-vacuity: swap the roles and every sign flips', () => {
    const A = series(dates, () => 0.002)
    const B = series(dates, () => 0)
    const r = relativePerformance({ A, B }, ['B', 'A'], '6M')
    expect(r.ratio.change).toBeLessThan(-15)
    expect(r.ratio.aboveAvg).toBe(false)
    expect(r.rows[1].excess).toBeGreaterThan(20)
  })
})

describe('RRG', () => {
  const dates = weekdays(60)
  const bench = series(dates, () => 0.001)
  // the symbol's RELATIVE path is shaped by `rel(i)`; the benchmark's own move is layered on top
  const shaped = (rel) => series(dates, (i) => (1.001 * (1 + rel(i))) - 1)

  it('an accelerating out-performer is Leading; its mirror image is Lagging', () => {
    const lead = rrgPath(shaped((i) => 0.0004 * i), bench)
    const lag = rrgPath(shaped((i) => -0.0004 * i), bench)
    expect(lead.quadrant).toBe('Leading')
    expect(lead.ratio).toBeGreaterThan(100)
    expect(lead.momentum).toBeGreaterThan(100)
    expect(lead.relRet).toBeGreaterThan(0)
    expect(lag.quadrant).toBe('Lagging')
    expect(lag.relRet).toBeLessThan(0)
    expect(lead.tail).toHaveLength(8)
  })

  it('a long out-performance that has just stalled is Weakening; a long fall that has stalled is Improving', () => {
    const n = dates.length
    const weak = rrgPath(shaped((i) => (i < n - 3 ? 0.01 : 0)), bench)
    const imp = rrgPath(shaped((i) => (i < n - 3 ? -0.01 : 0)), bench)
    expect(weak.quadrant).toBe('Weakening')
    expect(imp.quadrant).toBe('Improving')
    expect(weak.inQuadrant).toBeGreaterThanOrEqual(1)
  })

  it('quadrantOf covers all four and refuses a missing coordinate', () => {
    expect([quadrantOf(101, 101), quadrantOf(101, 99), quadrantOf(99, 99), quadrantOf(99, 101)])
      .toEqual(['Leading', 'Weakening', 'Lagging', 'Improving'])
    expect(quadrantOf(null, 100)).toBeNull()
  })

  it('too little common history is null, not a point at 100', () => {
    expect(rrgPath(bench.slice(0, 8), bench)).toBeNull()
  })
})

describe('CORR', () => {
  it('pearson: +1, −1, and null on a constant series', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8]).r).toBeCloseTo(1, 12)
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2]).r).toBeCloseTo(-1, 12)
    expect(pearson([1, 2, 3], [5, 5, 5]).r).toBeNull()
  })

  it('a twin reads +1, a mirror −1, an unrelated wiggle near 0; strongest and weakest pairs are named', () => {
    const dates = weekdays(120)
    const A = series(dates, (i) => wiggle(i, 1))
    const TWIN = series(dates, (i) => wiggle(i, 1), 50)
    const MIRROR = series(dates, (i) => -wiggle(i, 1))
    const OTHER = series(dates, (i) => wiggle(i * 3.1, 7))
    const m = correlationMatrix({ A, TWIN, MIRROR, OTHER }, ['A', 'TWIN', 'MIRROR', 'OTHER'], 63)
    expect(m.matrix[0][1].r).toBeCloseTo(1, 6)
    expect(m.matrix[0][1].n).toBe(63)
    expect(m.matrix[0][2].r).toBeLessThan(-0.95)
    expect(Math.abs(m.matrix[0][3].r)).toBeLessThan(0.5)
    expect(m.most).toMatchObject({ a: 'A', b: 'TWIN' })
    expect(m.least.r).toBeLessThan(-0.95)
  })

  it(`a pair with fewer than ${MIN_CORR_SESSIONS} shared sessions reads null with its n`, () => {
    const dates = weekdays(120)
    const A = series(dates, (i) => wiggle(i, 1))
    const NEW = series(dates.slice(-10), (i) => wiggle(i, 2))
    const m = correlationMatrix({ A, NEW }, ['A', 'NEW'], 63)
    expect(m.matrix[0][1]).toEqual({ r: null, n: 9 })
    expect(m.most).toBeNull()
  })
})
