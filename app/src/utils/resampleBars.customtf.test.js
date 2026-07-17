import { describe, it, expect } from 'vitest'
import {
  resampleIntradaySession, resampleNDaily, resampleNWeekly, resampleNMonthly, resampleForSpec,
} from './resampleBars'

// Intraday `t` is UTC seconds. Build ET wall-clock times on a Wed (2026-07-15, EDT=UTC-4).
const etSec = (h, m) => Math.floor(Date.UTC(2026, 6, 15, h + 4, m, 0) / 1000)
const bar = (t, o, h, l, c, v) => ({ t, o, h, l, c, v })

describe('resampleIntradaySession (45m, anchored to 9:30 ET)', () => {
  it('groups 15m bars into 45m buckets breaking at 9:30 / 10:15 / 11:00', () => {
    const bars = [
      bar(etSec(9, 30), 10, 11, 9.5, 10.5, 100),
      bar(etSec(9, 45), 10.5, 12, 10.4, 11, 200),
      bar(etSec(10, 0), 11, 11.5, 10.8, 11.2, 150),   // → first 45m bucket (9:30)
      bar(etSec(10, 15), 11.2, 11.3, 10.0, 10.2, 300), // → second bucket (10:15)
      bar(etSec(10, 30), 10.2, 10.4, 9.9, 10.1, 120),
    ]
    const out = resampleIntradaySession(bars, 45)
    expect(out).toHaveLength(2)
    // First bucket: open of 9:30 bar, close of 10:00 bar, high/low across the three.
    expect(out[0]).toMatchObject({ t: etSec(9, 30), o: 10, h: 12, l: 9.5, c: 11.2, v: 450 })
    // Second bucket starts at 10:15.
    expect(out[1]).toMatchObject({ t: etSec(10, 15), o: 11.2, c: 10.1, v: 420 })
  })

  it('65m (13×5m) is a valid clean bucket size', () => {
    const bars = []
    for (let i = 0; i < 13; i++) bars.push(bar(etSec(9, 30) + i * 300, 10, 10, 10, 10, 10))
    bars.push(bar(etSec(9, 30) + 13 * 300, 20, 20, 20, 20, 5)) // 10:35 → new bucket
    const out = resampleIntradaySession(bars, 65)
    expect(out).toHaveLength(2)
    expect(out[0].t).toBe(etSec(9, 30))
    expect(out[0].v).toBe(130)                 // thirteen 5m bars
    expect(out[1].t).toBe(etSec(9, 30) + 65 * 60)
  })
})

describe('nDaily / nWeekly / nMonthly (stable calendar buckets)', () => {
  const d = (s, c) => ({ t: s, o: c, h: c, l: c, c, v: 1 })

  it('nMonthly 3M aggregates to calendar quarters anchored to January', () => {
    const monthly = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01']
      .map((s, i) => d(s, 10 + i))
    const out = resampleNMonthly(monthly, 3)
    expect(out.map(b => b.t)).toEqual(['2026-01-01', '2026-04-01']) // Q1 (Jan-Mar), Q2 (Apr-)
    expect(out[0].c).toBe(12)   // close = March
  })

  it('nMonthly 12M = calendar year', () => {
    const monthly = ['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01'].map((s, i) => d(s, i))
    const out = resampleNMonthly(monthly, 12)
    expect(out.map(b => b.t)).toEqual(['2025-01-01', '2026-01-01'])
  })

  it('nDaily 2D buckets are stable regardless of how many bars precede', () => {
    const days = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16'].map((s, i) => d(s, i))
    const full = resampleNDaily(days, 2)
    const tail = resampleNDaily(days.slice(1), 2)   // drop the oldest bar
    // A given date lands in the SAME bucket key whether or not earlier bars exist.
    const keyOf = (out, date) => out.find(b => b.c === days.find(x => x.t === date).c)?.t
    expect(keyOf(full, '2026-07-15')).toBe(keyOf(tail, '2026-07-15'))
  })

  it('nWeekly 2W halves the weekly bar count (roughly)', () => {
    const weekly = ['2026-06-05', '2026-06-12', '2026-06-19', '2026-06-26'].map((s, i) => d(s, i))
    const out = resampleNWeekly(weekly, 2)
    expect(out.length).toBeLessThanOrEqual(weekly.length)
    expect(out.length).toBeGreaterThanOrEqual(2)
  })

  it('resampleForSpec dispatches by kind (and passes native through)', () => {
    const monthly = ['2026-01-01', '2026-02-01', '2026-03-01'].map((s, i) => d(s, i))
    expect(resampleForSpec(monthly, { kind: 'nMonthly', n: 3 })).toHaveLength(1)
    expect(resampleForSpec(monthly, null)).toBe(monthly)  // native → unchanged
  })
})
