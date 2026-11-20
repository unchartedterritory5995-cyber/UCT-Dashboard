// THE DEVICE COPY MEETS A SAVED COPY (data/deviceStore → persist DEVICE_HIT). The device store's rows are
// an UNSTAMPED bulk copy built elsewhere, exactly like the lake's, so they follow the lake's join rules:
//   R1 a device copy landing on a saved copy it shares NO bar with is refused (they could straddle a hole)
//   R2 ...one it shares bars with on the same basis joins it (its newer rows are added)
//   R3 a saved copy landing after a device copy on ANOTHER basis (a split between them) replaces it whole
//   R4 the lake joining a device copy on the same basis adds its deeper rows (one series, both bulk)
// Synthetic prices only.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { reduce, initialState } from './reducer'
import { keyOf, ACTION } from './types'
import { etUnix } from './__fixtures__/seededSeries'

const TODAY = '2026-11-10'
const T = (d, m) => etUnix(d, m)
const NOW = T(TODAY, 17 * 60) * 1000                     // 17:00 ET, after the close
const ctx = { nowMs: NOW, streamLive: true }
const K = keyOf({ sym: 'SIM', tf: '5' })
const bar = (t, k = 1) => ({ t, o: 100 * k, h: 101 * k, l: 99 * k, c: 100.5 * k, v: 10 })
const day = (d, k = 1) => { const o = []; for (let m = 570; m < 960; m += 5) o.push(bar(T(d, m), k)); return o }
const device = (bars) => ({ type: ACTION.DEVICE_HIT, payload: { sym: 'SIM', bars } })
const saved = (bars) => ({ type: ACTION.IDB_HIT, payload: { bars, cache_key: 'b1:SIM:5:eth-clock', history_rev: 5, series_rev: 1000 } })
const lake = (bars) => ({ type: ACTION.LAKE_HIT, payload: { sym: 'SIM', bars } })
const scales = (s) => [...new Set(s.bars.map((b) => b.o / 100))]

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

describe('a device copy and a saved copy', () => {
  it('R1 device onto a saved copy with no bar in common: refused, the saved copy stays as it was', () => {
    const s0 = reduce(initialState(K, ctx), saved(day('2026-11-05')), ctx)
    const s = reduce(s0, device(day(TODAY)), ctx)
    expect(s).toBe(s0)
  })

  it('R2 device onto a saved copy it overlaps on the same basis: joined, its newer rows added', () => {
    const s0 = reduce(initialState(K, ctx), saved(day('2026-11-09')), ctx)
    const s = reduce(s0, device([...day('2026-11-09'), ...day(TODAY)]), ctx)
    expect(s.bars[0].t).toBe(T('2026-11-09', 570))
    expect(s.bars.at(-1).t).toBe(T(TODAY, 955))
    expect(scales(s)).toEqual([1])
    expect(s.source).toBe('device')
    expect(s.restSeen).toBe(false)
  })

  it('R3 a saved copy after a device copy on another basis replaces it whole (never a mixed series)', () => {
    const s0 = reduce(initialState(K, ctx), device([...day('2026-11-09'), ...day(TODAY)]), ctx)
    expect(s0.lakeOnly).toBe(true)                          // a bulk copy alone
    const s = reduce(s0, saved(day(TODAY, 0.5)), ctx)
    expect(scales(s)).toEqual([0.5])
    expect(s.bars[0].t).toBe(T(TODAY, 570))
    expect(s.source).toBe('idb')
  })

  it('R4 the lake joining a device copy on the same basis adds its deeper rows', () => {
    const s0 = reduce(initialState(K, ctx), device(day(TODAY)), ctx)
    const s = reduce(s0, lake([...day('2026-11-06'), ...day('2026-11-09'), ...day(TODAY)]), ctx)
    expect(s.bars[0].t).toBe(T('2026-11-06', 570))
    expect(s.bars.at(-1).t).toBe(T(TODAY, 955))
    expect(scales(s)).toEqual([1])
  })
})
