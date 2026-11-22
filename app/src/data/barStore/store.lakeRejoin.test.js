// THE DEPTH COMES BACK IN ONE STEP (review of #1884). Timeline: the lake seeds a chart deep before its
// first answer; a saved copy on another basis lands after it and replaces the lake's rows (reducer
// applyLocal, lakeOnly); a lake load in that window is refused (the saved copy's rows do not share the
// lake's basis). Then the server answers, on the lake's basis. Contract:
//   R1 the refused load never marks the depth done while the chart is shallow (lakePending stays true)
//   R2 after the answer the whole depth returns in ONE lake join (one LAKE_HIT, one lake read), not in
//      scroll-back windows
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { keyOf, ACTION } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'

const OPEN = Date.UTC(2026, 10, 10, 14, 30) / 1000     // Tue 09:30 ET
const NOW = (OPEN + 40 * 60) * 1000
const DAY = 86400
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

const row = (t, k = 1) => ({ t, o: 100 * k, h: 101 * k, l: 99 * k, c: 100.5 * k, v: 10 })
/** RTH 5m buckets of the session that opens at `open` (unix s), up to `upto`. */
const session = (open, upto = open + 390 * 60, k = 1) => {
  const out = []
  for (let t = open; t < open + 390 * 60 && t < upto; t += 300) out.push(row(t, k))
  return out
}
const today = (k = 1) => session(OPEN, OPEN + 35 * 60, k)
// the lake: four sessions before today (Thu, Fri, Mon...) plus today's closed buckets (they prove the basis)
const LAKE = [OPEN - 6 * DAY, OPEN - 5 * DAY, OPEN - 4 * DAY, OPEN - DAY].flatMap((o) => session(o)).concat(today())

const answer = () => ({
  bars: today(), contract: 1, grid: 'session', session: 'rth', cache_key: 'b1:SIM:5:session', series_rev: 5000, history_rev: 7,
  verified_through: OPEN + 35 * 60, complete_through: OPEN + 30 * 60, developing: null, tail_status: 'verified',
})

describe('the lake\'s depth after a saved copy replaced it', () => {
  it('R1 + R2: stays due through a refused load, and returns in ONE join after the answer', async () => {
    let release
    const request = vi.fn(() => new Promise((r) => { release = () => r(answer()) }))
    const olderBars = vi.fn(async (key, beforeT) => ({ bars: LAKE.filter((b) => b.t <= beforeT) }))
    const store = createBarStore({
      request, history: { olderBars }, stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
      isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
    })
    const key = keyOf({ sym: 'SIM', tf: '5' })
    const off = store.subscribe(key, () => {})
    await vi.advanceTimersByTimeAsync(50)
    const deep = store.getSnapshot(key)
    expect(deep.restSeen).toBe(false)
    expect(deep.bars[0].t).toBe(LAKE[0].t)                               // the lake painted the depth

    // a saved copy on another basis (a 2:1 split between the two) lands after it: it replaces the lake's rows
    store.registry.dispatch(key, { type: ACTION.IDB_HIT, key, payload: { bars: today(0.5), cache_key: 'b1:SIM:5:session', history_rev: 6, series_rev: 900 } })
    const shallow = store.getSnapshot(key)
    expect(shallow.bars.length).toBeLessThan(deep.bars.length)
    // a lake load now is refused (the held rows do not share its basis) ...
    expect(await store.lakeSeed(key)).toBe(false)
    // R1 ... and never marks the depth done while the chart is shallow
    expect(store.lakePending(key)).toBe(true)

    const dispatch = vi.spyOn(store.registry, 'dispatch')
    const readsBefore = olderBars.mock.calls.length
    release()
    await vi.advanceTimersByTimeAsync(200)
    const s = store.getSnapshot(key)
    expect(s.restSeen).toBe(true)
    // R2 the whole depth, in ONE lake join, one lake read, no scroll-back windows
    expect(s.bars[0].t).toBe(LAKE[0].t)
    const lakeHits = dispatch.mock.calls.filter(([, a]) => a?.type === ACTION.LAKE_HIT)
    expect(lakeHits.length).toBe(1)
    expect(dispatch.mock.calls.filter(([, a]) => a?.type === ACTION.SCROLL_BACK).length).toBe(0)
    expect(olderBars.mock.calls.length - readsBefore).toBe(1)
    expect(store.lakePending(key)).toBe(false)
    off()
    store.dispose?.()
  })
})
