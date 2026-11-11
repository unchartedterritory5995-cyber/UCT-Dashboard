/**
 * Extended-hours charts: a tail that stops at the 16:00 close is NOT complete.
 *
 * 2026-11-11 01:22Z (20:22 ET) production: AAPL/TSLA/SOFI 1m first answers ended at
 * 16:53 ET — three hours of post-market missing. With no extended expectation
 * (00:00-04:00, weekends, holidays) the RTH classifier waved such a tail through as
 * complete on an extended-hours chart. The server's `unverified` must also win.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { intradayBarCurrentness, CURRENTNESS, isCurrentnessSettled } from './marketSession'

// ET wall clock → unix seconds (EST, UTC-5, for November).
const at = (iso, off = 5) => {
  const [d, t] = iso.split(' ')
  const [y, m, dd] = d.split('-').map(Number)
  const [h, mi] = t.split(':').map(Number)
  return Math.floor(Date.UTC(y, m - 1, dd, h + off, mi) / 1000)
}
const setNow = (iso) => vi.setSystemTime(at(iso) * 1000)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const ext = (tailT, extra = {}) => intradayBarCurrentness({ tf: '1', tailT, session: 'extended', ...extra })

describe('20:22 ET — the production clock (extended expectation exists)', () => {
  beforeEach(() => setNow('2026-11-10 20:22'))
  it('a 16:53 tail is not settled on an extended chart', () => {
    expect(isCurrentnessSettled(ext(at('2026-11-10 16:53')))).toBe(false)
  })
  it('a tail through 19:59 is current', () => {
    expect(ext(at('2026-11-10 19:59'))).toBe(CURRENTNESS.CURRENT)
  })
})

describe('overnight 02:00 ET — no extended expectation', () => {
  beforeEach(() => setNow('2026-11-11 02:00'))
  it('a tail that stopped at 16:53 is NOT complete', () => {
    expect(isCurrentnessSettled(ext(at('2026-11-10 16:53')))).toBe(false)
  })
  it('a tail through the extended close is settled', () => {
    expect(ext(at('2026-11-10 19:59'))).toBe(CURRENTNESS.NO_EXPECTATION)
  })
  it('the server saying unverified is never overridden', () => {
    expect(isCurrentnessSettled(ext(at('2026-11-10 19:59'), { serverStatus: 'unverified' }))).toBe(false)
  })
  it('the server saying verified settles a thin name', () => {
    expect(ext(at('2026-11-10 16:53'), { serverStatus: 'verified' })).toBe(CURRENTNESS.NO_EXPECTATION)
  })
  it('CONTROL: an RTH chart is unchanged (16:00 close is its close)', () => {
    expect(intradayBarCurrentness({ tf: '1', tailT: at('2026-11-10 15:59'), session: 'rth' }))
      .toBe(CURRENTNESS.NO_EXPECTATION)
  })
})

describe('weekend — Friday post-market', () => {
  beforeEach(() => setNow('2026-11-15 12:00'))         // Sunday
  it('a Friday tail at 16:00 is missing the post-market on an extended chart', () => {
    expect(isCurrentnessSettled(ext(at('2026-11-13 16:00')))).toBe(false)
  })
  it('a Friday tail at 19:59 is settled', () => {
    expect(ext(at('2026-11-13 19:59'))).toBe(CURRENTNESS.NO_EXPECTATION)
  })
  it('5m / 60m tolerances: final bucket starts 19:55 / 19:00', () => {
    expect(intradayBarCurrentness({ tf: '5', tailT: at('2026-11-13 19:55'), session: 'extended' }))
      .toBe(CURRENTNESS.NO_EXPECTATION)
    expect(intradayBarCurrentness({ tf: '60', tailT: at('2026-11-13 19:00'), session: 'extended' }))
      .toBe(CURRENTNESS.NO_EXPECTATION)
  })
})

describe('early close (Black Friday 13:00 → extended ends 17:00)', () => {
  beforeEach(() => setNow('2026-11-28 12:00'))          // Saturday after
  it('a 16:59 tail is complete; a 13:00 tail is not', () => {
    expect(ext(at('2026-11-27 16:59'))).toBe(CURRENTNESS.NO_EXPECTATION)
    expect(isCurrentnessSettled(ext(at('2026-11-27 13:00')))).toBe(false)
  })
})
