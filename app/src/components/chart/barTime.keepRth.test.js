// keepRthBars: the regular-session view of a series, the same bars the old per-bar filter kept,
// without copying the series when every bar already is regular session (2026-11-19).
import { describe, it, expect } from 'vitest'
import { keepRthBars, isRthBar, etOffsetSec, rthCloseMinuteOf } from './barTime'

const oldWay = (bars) => bars.filter((b) => typeof b.t !== 'number' || isRthBar(b.t))
// 2026-11-27 is an NYSE half-day (13:00 close); 2026-11-02 is the Monday after the DST change.
const et = (iso) => Date.parse(iso) / 1000
const mixed = [
  { t: et('2026-10-30T08:00:00-04:00') },           // pre-market
  { t: et('2026-10-30T09:30:00-04:00') },
  { t: et('2026-10-30T15:30:00-04:00') },
  { t: et('2026-10-30T16:00:00-04:00') },           // post-market
  { t: et('2026-11-02T09:30:00-05:00') },           // after the clocks changed
  { t: et('2026-11-27T12:30:00-05:00') },           // half-day, before its 13:00 close
  { t: et('2026-11-27T13:00:00-05:00') },           // half-day, after its close
  { t: '2026-11-27' },                              // a date, never filtered
  { t: et('2026-11-30T15:59:00-05:00') },
]

describe('keepRthBars', () => {
  it('keeps exactly the bars the per-bar filter kept, in order', () => {
    const got = keepRthBars(mixed)
    expect(got).toEqual(oldWay(mixed))
    expect(got.map((b) => b.t)).not.toContain(mixed[0].t)
    expect(got.map((b) => b.t)).not.toContain(mixed[6].t)
  })

  it('returns the very same array when every bar is regular session (no copy)', () => {
    const rth = oldWay(mixed)
    expect(keepRthBars(rth)).toBe(rth)
    expect(keepRthBars([])).toEqual([])
  })

  it('a new array when the first, a middle or the last bar is outside the session', () => {
    const rth = oldWay(mixed)
    for (const at of [0, 3, rth.length]) {
      const withOne = [...rth.slice(0, at), mixed[0], ...rth.slice(at)]
      const got = keepRthBars(withOne)
      expect(got).not.toBe(withOne)
      expect(got).toEqual(rth)
    }
  })

  it('the same-day memo answers like a cold lookup, whatever order the days are asked in', () => {
    const days = mixed.filter((b) => typeof b.t === 'number').map((b) => b.t)
    const forward = days.map((t) => [etOffsetSec(t), rthCloseMinuteOf(t)])
    const backward = [...days].reverse().map((t) => [etOffsetSec(t), rthCloseMinuteOf(t)]).reverse()
    const interleaved = days.map((t, i) => { etOffsetSec(days[days.length - 1 - i]); rthCloseMinuteOf(days[days.length - 1 - i]); return [etOffsetSec(t), rthCloseMinuteOf(t)] })
    expect(backward).toEqual(forward)
    expect(interleaved).toEqual(forward)
    expect(forward[0][0]).toBe(-14400)
    expect(forward[4][0]).toBe(-18000)
    expect(rthCloseMinuteOf(et('2026-11-27T12:30:00-05:00'))).toBe(780)
    expect(rthCloseMinuteOf(et('2026-11-30T12:30:00-05:00'))).toBe(960)
  })
})
