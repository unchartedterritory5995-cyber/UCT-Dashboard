// ⭐ A FINAL CLOSES THE BAR THE SERVER CALLED FORMING (review of #2639, M1).
// The store keeps the route's `newest_bar_is_forming` WITH the bar it describes (`newestForming {t, forming}`), and
// hands it to the chart's runs for the snapshot's newest row (adapter.newestBarIsFormingOf): Pine reads it as
// barstate.isconfirmed. A push FINAL for that bar closes it, and the flag still said "forming": a closed newest bar
// was handed to the runs as unconfirmed. On a chart's own key that lasted the milliseconds until its stream opened
// the next bucket; on a copy the minute feed keeps current it lasted most of every minute.
//   N1 the answer names its forming bar: true (the precondition)
//   N2 a FINAL of that bar closes it: false                      N3 a NON-final frame for it: still true
//   N4 a FINAL for an EARLIER bar: still true                    N5 the forming bar held as a closed ROW: a FINAL -> false
//   N6 a FINAL whose values lose (an older rev) still closes it: the bucket is over, whoever's values stand
//   N7 a FINAL for a bar the flag does not name changes nothing (the same object)
//   N8 the next answer naming a new forming bar: true for that bar
import { describe, it, expect } from 'vitest'
import { reduce, initialState } from './reducer'
import { newestBarIsFormingOf } from './adapter'
import { ACTION, keyOf } from './types'

const OPEN = Date.UTC(2026, 10, 10, 14, 30) / 1000               // Tue 2026-11-10 09:30 ET
const T = (n) => OPEN + n * 60
const KEY = keyOf({ sym: 'AAA', tf: '1' })
const ctxAt = (n, sec = 0) => ({ nowMs: (T(n) + sec) * 1000 })
const bar = (n, px = 0) => ({ t: T(n), o: 10 + n + px, h: 11 + n + px, l: 9 + n + px, c: 10.5 + n + px, v: 100 + n })
const forming = (n) => ({ t: T(n), o: 10 + n, h: 10.2 + n, l: 9.9 + n, c: 10.1 + n, v: 7 })

/** The server's answer at 09:30+`dev` min 20 s: closed rows 0..dev-1 and, LAST in `bars` as the route sends it, the
 *  forming bar it names (`newest_bar_is_forming: true`). `asRow`: no `developing` field value (the bar is only a row). */
function answered(dev, { asRow = false } = {}) {
  const ctx = ctxAt(dev, 20)
  const bars = Array.from({ length: dev }, (_, n) => bar(n))
  bars.push(forming(dev))
  return reduce(initialState(KEY, ctx), {
    type: ACTION.REST_FULL,
    payload: {
      ticker: 'AAA', tf: '1', contract: 1, grid: 'eth-clock', cache_key: 'b1:AAA:1:eth-clock', history_rev: 1,
      series_rev: ctx.nowMs, verified_through: ctx.nowMs / 1000, complete_through: T(dev - 1), tail_status: 'verified',
      bars, developing: asRow ? null : { ...forming(dev), rev: ctx.nowMs }, newest_bar_is_forming: true,
    },
  }, ctx)
}
const push = (s, n, { final, rev, px = 0 }, ctx = ctxAt(n + 1, 8)) => reduce(s, {
  type: final ? ACTION.PUSH_FINAL : ACTION.PUSH_BAR, event: { sym: 'AAA', tf: '1', ...bar(n, px), rev },
}, ctx)

describe('a FINAL closes the bar the server called forming', () => {
  it('N1 the answer names its forming bar', () => {
    const s = answered(30)
    expect(s.developing.t).toBe(T(30))
    expect(s.newestForming).toEqual({ t: T(30), forming: true })
    expect(newestBarIsFormingOf(s)).toBe(true)
  })

  it('N2 a FINAL of that bar closes it: the newest row is a closed bar, and the runs are told so', () => {
    const s = push(answered(30), 30, { final: true, rev: (T(31)) * 1000 })
    expect(s.developing).toBe(null)
    expect(s.bars[s.bars.length - 1]).toMatchObject({ ...bar(30), src: 'final' })
    expect(newestBarIsFormingOf(s)).toBe(false)
    expect(s.newestForming).toEqual({ t: T(30), forming: false })
  })

  it('N3 a NON-final frame for it leaves it forming', () => {
    const s = push(answered(30), 30, { final: false, rev: (T(30) + 40) * 1000 }, ctxAt(30, 40))
    expect(s.developing.t).toBe(T(30))
    expect(newestBarIsFormingOf(s)).toBe(true)
  })

  it('N4 a FINAL for an EARLIER bar leaves it forming', () => {
    const s0 = answered(30)
    const s = push(s0, 29, { final: true, rev: T(30) * 1000, px: 0.25 }, ctxAt(30, 30))
    expect(s.developing.t).toBe(T(30))
    expect(newestBarIsFormingOf(s)).toBe(true)
    expect(s.newestForming).toBe(s0.newestForming)
  })

  it('N5 the forming bar held as a closed ROW (the answer carried no developing bar): a FINAL closes it too', () => {
    const s0 = answered(30, { asRow: true })
    expect(s0.developing).toBe(null)
    expect(newestBarIsFormingOf(s0)).toBe(true)
    const s = push(s0, 30, { final: true, rev: T(31) * 1000 })
    expect(s.bars[s.bars.length - 1]).toMatchObject({ ...bar(30), src: 'final' })
    expect(newestBarIsFormingOf(s)).toBe(false)
  })

  it('N6 a FINAL whose values lose (an older rev) still closes it: the bucket is over', () => {
    const s0 = answered(30)
    const s = push(s0, 30, { final: true, rev: s0.developing.rev - 1000, px: 0.25 })
    expect(s.developing).toBe(null)
    expect(s.bars[s.bars.length - 1]).toMatchObject({ t: T(30), v: 7 })   // the newer observation's values stand
    expect(newestBarIsFormingOf(s)).toBe(false)
  })

  it('N7 a FINAL for a bar the flag does not name changes nothing about it', () => {
    const s0 = push(answered(30), 30, { final: true, rev: T(31) * 1000 })
    const s = push(s0, 31, { final: true, rev: T(32) * 1000 }, ctxAt(32, 8))
    expect(s.newestForming).toBe(s0.newestForming)
    expect(newestBarIsFormingOf(s)).toBe(null)                     // nothing was said about 10:01: unknown
  })

  it('N8 the next answer naming a new forming bar says forming again, about that bar', () => {
    const s0 = push(answered(30), 30, { final: true, rev: T(31) * 1000 })
    const ctx = ctxAt(31, 20)
    const s = reduce(s0, {
      type: ACTION.REST_FULL,
      payload: {
        ticker: 'AAA', tf: '1', contract: 1, grid: 'eth-clock', cache_key: 'b1:AAA:1:eth-clock', history_rev: 1,
        series_rev: ctx.nowMs, verified_through: ctx.nowMs / 1000, complete_through: T(30), tail_status: 'verified',
        bars: [...Array.from({ length: 31 }, (_, n) => bar(n)), forming(31)],
        developing: { ...forming(31), rev: ctx.nowMs }, newest_bar_is_forming: true,
      },
    }, ctx)
    expect(s.newestForming).toEqual({ t: T(31), forming: true })
    expect(newestBarIsFormingOf(s)).toBe(true)
  })
})
