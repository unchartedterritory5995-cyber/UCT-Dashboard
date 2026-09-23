import { describe, it, expect } from 'vitest'
import { projectAsOf, referenceTime, closeUtcSeconds } from './fundamentalAsOf'
import { projectSymbolField } from './symbolProjection'

// Parity with api/services/fundamentals_pit/asof.py — the same cases, the same
// answers, so the chart and the server can never disagree about "known when".

const et = (iso, hh, mm) => {
  // hh:mm America/New_York on `iso`, as unix seconds (DST via closeUtcSeconds)
  return closeUtcSeconds(iso) + (hh - 16) * 3600 + mm * 60
}
const pt = (iso, hh, mm, v, pe = '2024-12-31') => ({ t: et(iso, hh, mm), v, pe })
const bars = (...ts) => ts.map((t) => ({ t }))

describe('projectAsOf — known by the bar’s close', () => {
  it('⭐ a filing after the close reaches the NEXT daily bar, never the one it missed', () => {
    const p = [pt('2025-02-14', 16, 42, 0.18)]
    expect(projectAsOf(p, bars('2025-02-14', '2025-02-18'), 'D')).toEqual([NaN, 0.18])
  })

  it('a filing before the close applies to that day', () => {
    const p = [pt('2025-02-14', 10, 5, 0.18)]
    expect(projectAsOf(p, bars('2025-02-13', '2025-02-14'), 'D')).toEqual([NaN, 0.18])
  })

  it('⭐ the previous value holds until the next is public — step, never interpolated', () => {
    const p = [pt('2025-02-14', 16, 42, 0.18), pt('2025-05-01', 16, 10, 0.20, '2025-03-31')]
    expect(projectAsOf(p, bars('2025-04-30', '2025-05-01', '2025-05-02'), 'D')).toEqual([0.18, 0.18, 0.20])
  })

  it('intraday bars use their END time', () => {
    const start = et('2025-02-14', 16, 40)
    const p = [pt('2025-02-14', 16, 42, 0.18)]
    expect(projectAsOf(p, bars(start - 300, start, start + 300), '5m')).toEqual([NaN, 0.18, 0.18])
  })

  it('weekly and monthly bars use the bucket end', () => {
    const p = [pt('2025-02-12', 16, 30, 0.18)]
    expect(projectAsOf(p, bars('2025-02-10'), 'W')).toEqual([0.18])
    expect(projectAsOf(p, bars('2025-01-01', '2025-02-01'), 'M')).toEqual([NaN, 0.18])
  })

  it('⛔ a value older than the staleness cap goes BLANK, not flat', () => {
    const p = [pt('2017-05-10', 16, 51, 0.05, '2017-03-31')]
    expect(projectAsOf(p, bars('2017-06-01', '2018-06-01'), 'D')).toEqual([0.05, NaN])
  })

  it('the 16:00 close follows DST', () => {
    expect(new Date(closeUtcSeconds('2025-01-15') * 1000).getUTCHours()).toBe(21)
    expect(new Date(closeUtcSeconds('2025-07-15') * 1000).getUTCHours()).toBe(20)
  })

  it('no value exists before the first disclosure', () => {
    expect(projectAsOf([pt('2025-02-14', 16, 42, 1)], bars('2025-01-02'), 'D')).toEqual([NaN])
    expect(projectAsOf([], bars('2025-01-02'), 'D')).toEqual([NaN])
  })

  it('an in-progress weekly bar is capped at now', () => {
    const now = et('2025-02-12', 12, 0)
    expect(referenceTime('2025-02-10', 'W', now)).toBe(now)
  })
})

describe('⛔⛔ sym: stays exact-t — the as-of operator does not leak into it', () => {
  it('a missing secondary bar is still NaN under projectSymbolField', () => {
    const primary = [{ t: '2026-01-02', c: 1 }, { t: '2026-01-05', c: 1 }]
    const secondary = [{ t: '2026-01-02', c: 500 }]
    expect(projectSymbolField(secondary, 'close', primary)).toEqual([500, NaN])
  })
})
