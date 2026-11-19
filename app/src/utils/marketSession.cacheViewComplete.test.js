/**
 * ⛔ A COPY THAT STOPS MID-SESSION IS NEVER THE FIRST FRAME WHILE NO BUCKET OF TODAY IS EXPECTED
 * (2026-11-18). Measured on production at 02:56 ET with the flip proof, 5m, ten never-opened
 * tickers: the chart painted a held copy ending 11:35 ET the day before (ROL, +101 ms after the key)
 * and the server's answer then added the session's last 52 bars in view. `isCacheCurrentForView`
 * judged it with `isCurrentEnoughForPaint`, which answers "current" whenever no bucket of today is
 * expected (overnight, weekends, holidays, pre-open) without asking whether the last session reached
 * its close. The store's status rule (`intradayBarCurrentness`) already asks; the paint rule now uses it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isCacheCurrentForView, intradayBarCurrentness, isCurrentnessSettled } from './marketSession'

// ET wall clock -> unix seconds (EST, UTC-5, for November dates).
const et = (d, hm) => { const [h, m] = hm.split(':').map(Number); const [y, mo, dd] = d.split('-').map(Number); return Math.floor(Date.UTC(y, mo - 1, dd, h + 5, m) / 1000) }
const setNow = (d, hm) => vi.setSystemTime(et(d, hm) * 1000)
const rows = (d, from, to, tf = 5) => {
  const out = []
  for (let t = et(d, from); t <= et(d, to); t += tf * 60) out.push({ t, o: 1, h: 1, l: 1, c: 1 })
  return out
}
const view = (bars, tf, session) => isCacheCurrentForView(bars, bars[bars.length - 1].t, tf, { session, nowMs: Date.now() })

beforeEach(() => { vi.useFakeTimers(); try { localStorage.removeItem('uct.intradayComplete.enabled') } catch { /* jsdom */ } })
afterEach(() => vi.useRealTimers())

describe('no bucket of today expected: the last session must reach its close', () => {
  const cases = [
    ['overnight Wed 02:56', '2026-11-18', '02:56', '2026-11-17'],
    ['pre-open Wed 08:00 (RTH view)', '2026-11-18', '08:00', '2026-11-17'],
    ['Saturday noon', '2026-11-21', '12:00', '2026-11-20'],
  ]
  for (const [label, day, hm, prior] of cases) {
    it(`${label}: a regular-hours copy that stops at 11:35 is not current; one reaching 15:55 is`, () => {
      setNow(day, hm)
      expect(view(rows(prior, '09:30', '11:35'), '5', 'rth')).toBe(false)
      expect(view(rows(prior, '09:30', '15:55'), '5', 'rth')).toBe(true)
    })
  }

  it('the production case: ROL, a copy ending 11:35 ET, judged at 02:56 ET the next morning', () => {
    setNow('2026-11-18', '02:56')
    expect(view(rows('2026-11-17', '04:00', '11:35'), '5', 'rth')).toBe(false)
    expect(view(rows('2026-11-17', '04:00', '11:35'), '5', 'extended')).toBe(false)
  })

  it('an extended view needs the post-market too: 15:55 is not its close, 19:55 is', () => {
    setNow('2026-11-18', '02:56')
    expect(view(rows('2026-11-17', '04:00', '15:55'), '5', 'extended')).toBe(false)
    expect(view(rows('2026-11-17', '04:00', '19:55'), '5', 'extended')).toBe(true)
  })

  it('every intraday timeframe: the final regular bucket is complete, two buckets short is not', () => {
    setNow('2026-11-18', '02:56')
    for (const tf of [1, 5, 15, 30, 60]) {
      // the session's final bucket on the tf's grid (60m is 09:30-anchored: 15:30), and two short
      const last = tf === 60 ? 930 : 960 - tf, short = last - 2 * tf
      const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
      expect(view(rows('2026-11-17', '09:30', hm(last), tf), String(tf), 'rth')).toBe(true)
      expect(view(rows('2026-11-17', '09:30', hm(short), tf), String(tf), 'rth')).toBe(false)
    }
  })
})

describe('the paint rule and the store status rule give one answer', () => {
  it('for every quarter hour of a day and tails across the prior session, both sessions', () => {
    let checked = 0
    for (let m = 0; m < 24 * 60; m += 15) {
      const hm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
      setNow('2026-11-18', hm)
      for (const end of ['10:00', '13:30', '15:50', '15:55', '17:30', '19:55']) {
        const bars = rows('2026-11-17', '04:00', end)
        for (const session of ['rth', 'extended']) {
          const tail = session === 'rth' ? bars.filter((b) => b.t <= et('2026-11-17', '15:55')).at(-1).t : bars.at(-1).t
          const store = isCurrentnessSettled(intradayBarCurrentness({ tf: '5', tailT: tail, nowMs: Date.now(), session, pending: true }))
          expect(view(bars, '5', session)).toBe(store)
          checked++
        }
      }
    }
    expect(checked).toBe(96 * 12)
  })
})
