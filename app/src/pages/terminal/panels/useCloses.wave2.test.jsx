// Wave 2 (audit 2026-10-08) — REL / RRG closes: a memoised read EXPIRES (it lived for the whole
// browser session), and today's still-forming bar is labelled as intraday, never as a close.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import RelPanel from './RelPanel'
import { CLOSES_TTL_MS, clearClosesCache, closesProvenance, etClock, fetchCloses, formingThrough } from './useCloses'
import { fakeBarsFetch, series, weekdays } from './__fixtures__/compareFixtures'

const realFetch = globalThis.fetch
beforeEach(() => { clearClosesCache() })
afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers() })

const ready = (newest) => ({ phase: 'ready', series: { A: [{ d: '2026-10-01', c: 1 }, { d: newest, c: 2 }] } })
// 2026-10-08 is a Thursday; EDT is UTC-4.
const at = (hhmm) => new Date(`2026-10-08T${hhmm}:00-04:00`)

describe('closes memo expires', () => {
  it('re-reads a name once the TTL has passed, and not before', async () => {
    const spy = vi.fn(fakeBarsFetch({ NVDA: series(weekdays(40), () => 0.001) }))
    globalThis.fetch = spy
    const t0 = 1_800_000_000_000
    await fetchCloses('NVDA', 'D', t0)
    await fetchCloses('NVDA', 'D', t0 + CLOSES_TTL_MS - 1)
    expect(spy).toHaveBeenCalledTimes(1)
    await fetchCloses('NVDA', 'D', t0 + CLOSES_TTL_MS + 1)
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

describe('the forming bar is labelled honestly', () => {
  it('reads the ET clock', () => {
    expect(etClock(at('15:59'))).toEqual({ date: '2026-10-08', minutes: 959 })
  })

  it('today before 4 PM ET is forming; after the close, or an older bar, is not', () => {
    expect(formingThrough(ready('2026-10-08'), at('11:30'))).toBe('2026-10-08')
    expect(formingThrough(ready('2026-10-08'), at('16:05'))).toBeNull()
    expect(formingThrough(ready('2026-10-07'), at('11:30'))).toBeNull()
    expect(formingThrough({ phase: 'loading' }, at('11:30'))).toBeNull()
  })

  it('the header says intraday, not a close, while the bar forms', () => {
    const live = closesProvenance(ready('2026-10-08'), 'D', at('11:30'))
    expect(live.age.asOfDate).toBe('2026-10-08, intraday (not a close)')
    expect(live.source).toContain('still forming')
    const closed = closesProvenance(ready('2026-10-08'), 'D', at('17:00'))
    expect(closed.age.asOfDate).toBe('2026-10-08')
    expect(closed.source).not.toContain('forming')
  })

  it('REL says the last point is intraday when it is today during the session', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at('11:30'))
    const days = weekdays(300, '2025-10-01').filter((d) => d <= '2026-10-08')
    expect(days[days.length - 1]).toBe('2026-10-08')
    globalThis.fetch = vi.fn(fakeBarsFetch({
      NVDA: series(days, () => 0.002), SPY: series(days, () => 0.001),
    }))
    render(<RelPanel sym="NVDA" />)
    expect((await screen.findByTestId('terminal-rel-lede')).textContent)
      .toContain("The last point is today's bar, still forming: it is intraday, not a close.")
  })
})
