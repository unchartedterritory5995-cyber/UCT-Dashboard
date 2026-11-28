// 2026-11-27 (#2951): an intraday entry cached from a pre-fix server answer can hold a
// SPLICE (an older stored island joined to a dense window across a hole nobody fetched).
// Such an entry reads as absent, per entry, on read; CACHE_LOGIC_VERSION is NOT bumped.
import { describe, it, expect, vi } from 'vitest'
import { _hasSplicedGap, _entryReadable, _CACHE_LOGIC_VERSION, SPLICE_GAP_S } from './barsIDB'

// The tail rule is the clock's; pinned here so only the splice can refuse an entry.
vi.mock('./marketSession', async (importOriginal) => ({
  ...(await importOriginal()),
  classifyIntradayTail: () => 'current',
}))

const et = (y, mo, d, h, m) => Date.UTC(y, mo - 1, d, h + 4, m) / 1000   // EDT
const bar = (t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 })
// one 15m session, 09:30 .. 15:45 ET
const session = (y, mo, d) => Array.from({ length: 26 }, (_, k) => bar(et(y, mo, d, 9, 30) + k * 900))
const june2016 = [1, 2, 3, 6, 7, 8, 9, 10, 13, 14].flatMap((d) => session(2016, 6, d))

describe('_hasSplicedGap', () => {
  it('flags the MSFT shape: one 2008 island row before dense June-2016 rows', () => {
    expect(_hasSplicedGap([bar(et(2008, 5, 13, 10, 0)), ...june2016], '15')).toBe(true)
  })
  it('keeps a dense series with weekends and a long holiday weekend', () => {
    // Thu Jun 30 15:45 -> Tue Jul 5 09:30: Fri Jul 1 has no bars here and Mon Jul 4 is closed
    const withHoliday = [...session(2016, 6, 29), ...session(2016, 6, 30), ...session(2016, 7, 5)]
    expect(_hasSplicedGap(withHoliday, '15')).toBe(false)
    expect(_hasSplicedGap(june2016, '15')).toBe(false)
  })
  it('the boundary is the server rule: exactly 7 days passes, one second more is a splice', () => {
    const t0 = et(2016, 6, 1, 9, 30)
    expect(_hasSplicedGap([bar(t0), bar(t0 + SPLICE_GAP_S)], '5')).toBe(false)
    expect(_hasSplicedGap([bar(t0), bar(t0 + SPLICE_GAP_S + 1)], '5')).toBe(true)
  })
  it('applies to every intraday key (60e included) and never to D/W/M', () => {
    const spliced = [bar(et(2008, 5, 13, 10, 0)), ...june2016]
    for (const tf of ['1', '5', '15', '30', '60', '60e']) expect(_hasSplicedGap(spliced, tf)).toBe(true)
    for (const tf of ['D', 'W', 'M']) expect(_hasSplicedGap(spliced, tf)).toBe(false)
  })
})

describe('_entryReadable refuses a spliced intraday entry', () => {
  const now = Date.now()
  const entry = (bars) => ({ bars, lastT: bars[bars.length - 1].t, savedAt: now, createdAt: now, v: _CACHE_LOGIC_VERSION })
  it('a deep-history segment', () => {
    expect(_entryReadable(entry(june2016), '15', now, { history: true })).toBe(true)
    expect(_entryReadable(entry([bar(et(2008, 5, 13, 10, 0)), ...june2016]), '15', now, { history: true })).toBe(false)
  })
  it('a tail entry', () => {
    const t = Math.floor(now / 1000)
    const tail = Array.from({ length: 50 }, (_, k) => bar(t - (50 - k) * 60))
    expect(_entryReadable(entry(tail), '1', now)).toBe(true)
    expect(_entryReadable(entry([bar(t - 400 * 86400), ...tail]), '1', now)).toBe(false)
  })
})
