// 2026-11-10 60m grid move: old-layout 60m caches are discarded per entry on
// read (no global CACHE_LOGIC_VERSION bump → no all-timeframe herd).
import { describe, it, expect } from 'vitest'
import { _hasOldSixtyMinGrid } from './barsIDB'

const et = (d, h, m) => Date.UTC(2026, 10, d, h + 5, m) / 1000   // November: EST
const day = (d, rth) => rth.map(([h, m]) => ({ t: et(d, h, m), o: 1, h: 1, l: 1, c: 1, v: 1 }))
const OLD = [[9, 0], [9, 30], [10, 0], [11, 0], [12, 0], [13, 0], [14, 0], [15, 0], [16, 0]]
const NEW = [[9, 0], [9, 30], [10, 30], [11, 30], [12, 30], [13, 30], [14, 30], [15, 30], [16, 0]]

describe('_hasOldSixtyMinGrid', () => {
  it('flags an old clock-hour 60m entry', () => {
    expect(_hasOldSixtyMinGrid([...day(2, OLD), ...day(3, OLD)], '60')).toBe(true)
  })
  it('keeps a TradingView-grid entry, incl. a half-day (13:00 post bars are on-grid)', () => {
    const half = day(27, [[9, 30], [10, 30], [11, 30], [12, 30], [13, 0], [14, 0]])
    expect(_hasOldSixtyMinGrid([...day(2, NEW), ...half], '60')).toBe(false)
  })
  it('flags a mixed entry (old history + new delta) and never touches other TFs', () => {
    expect(_hasOldSixtyMinGrid([...day(2, OLD), ...day(3, NEW)], '60')).toBe(true)
    expect(_hasOldSixtyMinGrid(day(2, OLD), '30')).toBe(false)
  })
})

// 2026-11-10 session grids: '60' = session grid (RTH view), '60e' = clock grid (ETH view).
// An entry on the OTHER grid — or a mixed one — is absent, so a session toggle can never
// merge one grid into the other.
const CLOCK = [[4, 0], [5, 0], [8, 0], [9, 0], [10, 0], [11, 0], [15, 0], [16, 0], [19, 0]]
describe('_hasOldSixtyMinGrid — per-session keys', () => {
  it("'60e' keeps a clock-hour entry and refuses a session-grid one", () => {
    expect(_hasOldSixtyMinGrid([...day(2, CLOCK), ...day(3, CLOCK)], '60e')).toBe(false)
    expect(_hasOldSixtyMinGrid(day(2, NEW), '60e')).toBe(true)
  })
  it("'60' refuses a clock-hour entry (the ETH series written under the RTH key)", () => {
    expect(_hasOldSixtyMinGrid(day(2, CLOCK), '60')).toBe(true)
  })
  it('a mixed session/clock entry is refused under either key', () => {
    const mixed = [...day(2, NEW), ...day(3, CLOCK)]
    expect(_hasOldSixtyMinGrid(mixed, '60')).toBe(true)
    expect(_hasOldSixtyMinGrid(mixed, '60e')).toBe(true)
  })
})
