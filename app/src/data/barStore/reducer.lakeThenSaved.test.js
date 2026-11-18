// A SAVED COPY THAT LANDS AFTER THE LAKE (2026-11-18). The open's lake load no longer waits for a slow
// cache read (prefetch _lakeLoad, HYDRATE_WAIT_MS), so an IDB/mem copy can land on an entry the lake
// filled first. The lake's rows carry no stamp, so the copy joins them only on a basis its rows prove;
// otherwise it replaces them. Synthetic prices only.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { reduce, initialState } from './reducer'
import { keyOf } from './types'
import { etUnix } from './__fixtures__/seededSeries'

const DAYS = ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09']
const TODAY = '2026-11-10'
const T = (d, m) => etUnix(d, m)
const NOW = T(TODAY, 10 * 60 + 12) * 1000                 // 10:12 ET
const ctx = { nowMs: NOW, streamLive: true }
const K = keyOf({ sym: 'SIM', tf: '5' })
const bar = (t, k = 1, rev) => ({ t, o: 100 * k, h: 101 * k, l: 99 * k, c: 100.5 * k, v: 10, ...(rev != null ? { rev } : {}) })
const day = (d, k = 1, rev) => { const o = []; for (let m = 570; m < 960; m += 5) o.push(bar(T(d, m), k, rev)); return o }
const morning = (k = 1, rev) => [570, 575, 580, 585].map((m) => bar(T(TODAY, m), k, rev))
const lakeHit = (bars) => ({ type: 'lake-hit', payload: { sym: 'SIM', bars } })
const saved = (type, bars, x = {}) => ({ type, payload: { bars, cache_key: 'b1:SIM:5:session', history_rev: 5, series_rev: 1000, ...x } })
const scales = (s) => [...new Set([...s.bars, ...(s.developing ? [s.developing] : [])].map((b) => b.o / 100))]

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

const lakeFirst = () => reduce(initialState(K, ctx), lakeHit(DAYS.flatMap((d) => day(d))), ctx)

describe('a saved copy after the lake', () => {
  it('same basis, newer: joins the lake\'s depth; its rows win where they overlap; its tail is added', () => {
    const s0 = lakeFirst()
    const s = reduce(s0, saved('idb-hit', [...day('2026-11-09', 1, 900), ...morning(1, 900)]), ctx)
    expect(s.bars[0].t).toBe(s0.bars[0].t)                                  // the lake's depth is kept
    const last = s.developing ?? s.bars.at(-1)
    expect(last.t).toBe(T(TODAY, 585))                                      // the copy's tail is added
    expect(s.bars.find((b) => b.t === T('2026-11-09', 600)).rev).toBe(1000) // its rows win the overlap (its series_rev)
    expect(scales(s)).toEqual([1])
    expect(s.cacheKey).toBe('b1:SIM:5:session')
  })

  it('bars the lake lacks, sharing some with it: added on the lake\'s proven basis', () => {
    const s0 = lakeFirst()
    const s = reduce(s0, saved('idb-hit', [bar(T('2026-11-09', 955), 1, 900), ...morning(1, 900)]), ctx)
    expect(s.bars[0].t).toBe(s0.bars[0].t)
    expect((s.developing ?? s.bars.at(-1)).t).toBe(T(TODAY, 585))
  })

  it('no bar in common (they could straddle a hole): the saved copy replaces the lake\'s rows', () => {
    const s = reduce(lakeFirst(), saved('idb-hit', morning(1, 900)), ctx)
    const all = [...s.bars, ...(s.developing ? [s.developing] : [])]
    expect(all.every((b) => b.t >= T(TODAY, 570))).toBe(true)
    expect(s.source).toBe('idb')
  })

  it('another basis (a 2:1 split between the two): the saved copy replaces the lake\'s rows, never a mixed series', () => {
    const s = reduce(lakeFirst(), saved('idb-hit', [...day('2026-11-09', 0.5, 900), ...morning(0.5, 900)]), ctx)
    expect(scales(s)).toEqual([0.5])
    expect(s.bars[0].t).toBe(T('2026-11-09', 570))
  })

  it('an OLDER series_rev than a copy already held: still only deeper rows (the old rule)', () => {
    const mem = reduce(initialState(K, ctx), saved('mem-hit', [...day('2026-11-09', 1, 2000), ...morning(1, 2000)], { series_rev: 2000 }), ctx)
    const withLake = reduce(mem, lakeHit(DAYS.flatMap((d) => day(d))), ctx)
    const s = reduce(withLake, saved('idb-hit', day('2026-11-09', 1, 900), { series_rev: 900 }), ctx)
    expect(s.seriesRev).toBe(2000)
    expect(s.bars.find((b) => b.t === T('2026-11-09', 600)).rev).toBe(2000)   // the newer copy's rows stay
    expect((s.developing ?? s.bars.at(-1)).t).toBe(T(TODAY, 585))
  })

  it('a server answer held: the old rule decides (a saved copy only adds proven deeper rows)', () => {
    const s0 = lakeFirst()
    const answered = reduce(s0, { type: 'rest-full', payload: { bars: [...day('2026-11-09'), ...morning()], contract: 1, grid: 'session',
      session: 'rth', cache_key: 'b1:SIM:5:session', series_rev: 3000, history_rev: 5, verified_through: Math.floor(NOW / 1000) - 5, tail_status: 'verified' } }, ctx)
    const s = reduce(answered, saved('idb-hit', day('2026-11-09', 0.5, 900)), ctx)
    expect(s).toBe(answered)
    expect(answered.lakeOnly).toBe(false)
  })
})

// Review of #1884: the replace fires ONLY over rows that are the lake's alone (`lakeOnly`), never wipes a
// saved copy the lake had joined, is never done by a pack seed, and keeps what the stream added.
describe('the replace is the lake-only entry\'s alone', () => {
  it('lakeOnly: set by a lake hit onto an empty entry, cleared by any other fill', () => {
    const s0 = lakeFirst()
    expect(s0.lakeOnly).toBe(true)
    expect(reduce(s0, saved('idb-hit', [...day('2026-11-09', 1, 900), ...morning(1, 900)]), ctx).lakeOnly).toBe(false)
    const mem = reduce(initialState(K, ctx), saved('mem-hit', day('2026-11-09', 1, 2000), { series_rev: 2000 }), ctx)
    expect(reduce(mem, lakeHit(DAYS.flatMap((d) => day(d))), ctx).lakeOnly).toBe(false)   // the lake joined a saved copy
  })

  it('scenario A: a newer stamped mem copy + the lake, then an OLDER unstamped IDB copy on another basis: the newer copy is never wiped', () => {
    const mem = reduce(initialState(K, ctx), saved('mem-hit', [...day('2026-11-09', 1, 2000), ...morning(1, 2000)], { series_rev: 2000 }), ctx)
    const withLake = reduce(mem, lakeHit(DAYS.flatMap((d) => day(d))), ctx)
    const s = reduce(withLake, { type: 'idb-hit', payload: { bars: day('2026-11-09', 0.5) } }, ctx)
    expect(s.invalidatedFor).not.toBe('lake_basis')
    expect(s.seriesRev).toBe(2000)
    expect(s.bars[0].t).toBe(withLake.bars[0].t)                            // the lake's depth stays
    expect(s.bars.find((b) => b.t === T('2026-11-09', 600)).o).toBe(100)     // the newer copy's rows stay
    expect((s.developing ?? s.bars.at(-1)).t).toBe(T(TODAY, 585))
  })

  it('scenario B: a pack seed sharing no bar never replaces the lake (lake-only, or joined to a saved copy): history never shrinks', () => {
    const pack = { type: 'pack-seed', payload: { bars: morning(1) } }
    const lakeOnly = lakeFirst()
    expect(reduce(lakeOnly, { ...pack, type: 'seed-from-pack' }, ctx).bars.length).toBeGreaterThanOrEqual(lakeOnly.bars.length)
    const idb = reduce(initialState(K, ctx), saved('idb-hit', day('2026-11-09', 1, 900)), ctx)
    const joined = reduce(idb, lakeHit(DAYS.flatMap((d) => day(d))), ctx)
    const s = reduce(joined, { type: 'seed-from-pack', payload: { bars: [bar(T(TODAY, 600), 0.5)] } }, ctx)
    expect(s.bars.length).toBeGreaterThanOrEqual(joined.bars.length)
    expect(s.bars[0].t).toBe(joined.bars[0].t)
    // ...and a pack the lake-only rows do not prove is refused outright
    expect(reduce(lakeOnly, { type: 'seed-from-pack', payload: { bars: day('2026-11-09', 0.5) } }, ctx)).toBe(lakeOnly)
  })

  it('the replace keeps the depth floor, the stream\'s rows and its live forming bar', () => {
    const s0 = Object.freeze({ ...lakeFirst(), depthFloor: 300 })
    const pushed = reduce(s0, { type: 'push-bar', event: { bar: { ...bar(T(TODAY, 590)), t: T(TODAY, 590) * 1000 }, rev: 5000 } }, ctx)
    expect(pushed.developing?.src).toBe('push')
    expect(pushed.lakeOnly).toBe(true)
    const s = reduce(pushed, saved('idb-hit', [...day('2026-11-09', 0.5, 900), ...morning(0.5, 900)]), ctx)
    expect(s.invalidatedFor).toBe('lake_basis')
    expect(s.depthFloor).toBe(300)
    expect(s.developing?.t).toBe(T(TODAY, 590))                             // the live forming bar stays
    expect(s.developing?.src).toBe('push')
    expect(s.bars[0].t).toBe(T('2026-11-09', 570))                          // the lake's rows are gone
    expect(s.lakeOnly).toBe(false)
  })
})
