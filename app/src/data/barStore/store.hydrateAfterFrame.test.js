// ⭐ A CHART'S SUBSCRIBE READS THE BAR CACHE AFTER THE FRAME WHEN THE KEY ALREADY PAINTS (2026-11-23, live-session CPU
// profile: IndexedDB result handlers of the bar cache ran ~24 ms per next-row press inside the window the charts were
// drawing in). The first subscriber of a key (index.js _start) hydrates it: the mem record, the IDB tail (up to 3,000
// rows) and the IDB deep-history segment (up to 20,000 rows), each a whole structured-clone read. For a key that ALREADY
// HOLDS a server answer covering the chart's default view (the prewarmed next row), those reads can only add rows OLDER
// than the answer (the reducer refuses an older local copy over an answer and only prepends history): off screen at the
// default zoom. So they run after the frame now; nothing else changes:
//   H1 a prewarmed key: no IDB read in the subscribe; both reads after the frame
//   H2 a cold key: read at once, as today
//   H3 a held answer shorter than the default view (HYDRATE_AFTER_FRAME_MIN_ROWS = COVER_ROWS): read at once
//   H4 released before the frame: never read
//   H5 coalesced: two keys subscribed in one task wait for ONE frame
//   H6 the floor is the switch's own "rows that cover the view" (hooks/useSymbolHandoff COVER_ROWS)
//   H7 the final entry equals the immediate path's (a real cache: a 3,000-row tail and a 5,000-row history record)
//   H8 store ON: a key the device holds (no server answer) is read at once, as today
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createBarStore } from './index'
import { keyOf, ACTION } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { etUnix } from './__fixtures__/seededSeries'
import { memClear } from '../../utils/barsMemCache'
import { idbPutMonotonic, idbPutHistory, idbGet, idbGetHistoryEntry } from '../../utils/barsIDB'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

/** 5m regular-session rows for the `days` sessions ending Tue 2026-11-10. */
function sessions(days) {
  const dates = []
  for (let d = new Date(Date.UTC(2026, 10, 10)); dates.length < days; d = new Date(d.getTime() - 86400000)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.unshift(d.toISOString().slice(0, 10))
  }
  const out = []
  for (const iso of dates) for (let m = 570; m < 960; m += 5) { const i = out.length; const c = 50 + (i % 37) * 0.01; out.push({ t: etUnix(iso, m), o: c, h: c + 0.05, l: c - 0.05, c, v: 100 + i }) }
  return out
}
const NOW = Date.UTC(2026, 10, 10, 23, 0)                    // Tue 18:00 ET: after the session
const ALL = sessions(110)                                     // ~8,580 rows
const ANSWER = ALL.slice(-702)                                // nine sessions: covers the default view
const rest = (key, sym, bars) => ({ type: ACTION.REST_FULL, key, payload: { ticker: sym, tf: '5', bars } })
const rowsOf = (s) => s.bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v])

function spyIO() {
  return {
    idbGet: vi.fn(async () => null), idbGetHistoryEntry: vi.fn(async () => null),
    idbPutMonotonic: vi.fn(async () => null), idbPutHistory: vi.fn(async () => null), memPutMonotonic: vi.fn(() => {}),
  }
}
function boot({ io, frames, device, afterPaint } = {}) {
  const store = createBarStore({
    request: vi.fn(() => new Promise(() => {})), io, history: null, ...(device !== undefined ? { device } : {}),
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {},
    idle: () => {},
    afterPaint: afterPaint ?? ((fn) => { frames.push(fn); return () => { const i = frames.indexOf(fn); if (i >= 0) frames.splice(i, 1); return i >= 0 } }),
  })
  return store
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const runFrames = (frames) => { for (const fn of frames.splice(0)) fn() }

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

describe("a chart's subscribe reads the bar cache after the frame when the key already paints", () => {
  it('H1 a prewarmed key: no IDB read in the subscribe; both reads after the frame', async () => {
    const io = spyIO(); const frames = []
    const store = boot({ io, frames })
    const k = keyOf({ sym: 'AAA', tf: '5' })
    store.registry.dispatch(k, rest(k, 'AAA', ANSWER))
    const off = store.subscribe(k, () => {})
    await settle()
    expect(io.idbGet).not.toHaveBeenCalled()
    expect(io.idbGetHistoryEntry).not.toHaveBeenCalled()
    expect(frames).toHaveLength(1)
    runFrames(frames)
    await settle()
    expect(io.idbGet).toHaveBeenCalledTimes(1)
    expect(io.idbGetHistoryEntry).toHaveBeenCalledTimes(1)
    off(); store.dispose()
  })

  it('H2 a cold key: read at once, as today', async () => {
    const io = spyIO(); const frames = []
    const store = boot({ io, frames })
    const k = keyOf({ sym: 'AAA', tf: '5' })
    const off = store.subscribe(k, () => {})
    expect(io.idbGet).toHaveBeenCalledTimes(1)
    expect(frames).toHaveLength(0)
    off(); store.dispose()
  })

  it('H3 a held answer shorter than the default view: read at once', async () => {
    const io = spyIO(); const frames = []
    const store = boot({ io, frames })
    const k = keyOf({ sym: 'AAA', tf: '5' })
    store.registry.dispatch(k, rest(k, 'AAA', ANSWER.slice(-300)))
    const off = store.subscribe(k, () => {})
    expect(io.idbGet).toHaveBeenCalledTimes(1)
    expect(frames).toHaveLength(0)
    off(); store.dispose()
  })

  it('H4 released before the frame: never read', async () => {
    const io = spyIO(); const frames = []
    const store = boot({ io, frames })
    const k = keyOf({ sym: 'AAA', tf: '5' })
    store.registry.dispatch(k, rest(k, 'AAA', ANSWER))
    const off = store.subscribe(k, () => {})
    off()
    runFrames(frames)
    await settle()
    expect(io.idbGet).not.toHaveBeenCalled()
    expect(io.idbGetHistoryEntry).not.toHaveBeenCalled()
    store.dispose()
  })

  it('H5 two keys subscribed in one task wait for ONE frame', async () => {
    const io = spyIO(); const frames = []
    const store = boot({ io, frames })
    const k1 = keyOf({ sym: 'AAA', tf: '5' }); const k2 = keyOf({ sym: 'BBB', tf: '5' })
    store.registry.dispatch(k1, rest(k1, 'AAA', ANSWER))
    store.registry.dispatch(k2, rest(k2, 'BBB', ANSWER))
    const o1 = store.subscribe(k1, () => {}); const o2 = store.subscribe(k2, () => {})
    expect(frames).toHaveLength(1)
    runFrames(frames)
    await settle()
    expect(io.idbGet).toHaveBeenCalledTimes(2)
    o1(); o2(); store.dispose()
  })

  it("H6 the floor is the switch's own rows-that-cover-the-view (useSymbolHandoff COVER_ROWS)", async () => {
    const { HYDRATE_AFTER_FRAME_MIN_ROWS } = await import('./index')
    // (by path from the app root, found from the cwd as entryExcludesChartEngine does: this environment's import.meta.url
    // is not a file URL)
    let dir = process.cwd()
    for (let i = 0; i < 8 && !fs.existsSync(path.join(dir, 'src', 'hooks', 'useSymbolHandoff.js')); i++) {
      if (fs.existsSync(path.join(dir, 'app', 'src', 'hooks', 'useSymbolHandoff.js'))) { dir = path.join(dir, 'app'); break }
      dir = path.dirname(dir)
    }
    const src = fs.readFileSync(path.join(dir, 'src', 'hooks', 'useSymbolHandoff.js'), 'utf8')
    const cover = Number(/export const COVER_ROWS = (\d+)/.exec(src)?.[1])
    expect(cover).toBe(600)
    expect(HYDRATE_AFTER_FRAME_MIN_ROWS).toBe(cover)
  })

  it('H7 the final entry equals the immediate path (a 3,000-row tail and a 5,000-row history record)', async () => {
    // the cache: a 3,000-row tail record (reaching back past the answer) and a deep-history record of 5,010 rows behind it
    await idbPutMonotonic('AAA', '5', ALL.slice(-3000))
    await idbPutHistory('AAA', '5', ALL.slice(-8000, -2990))
    expect((await idbGet('AAA', '5'))?.bars.length).toBe(3000)
    expect((await idbGetHistoryEntry('AAA', '5'))?.bars.length).toBe(5010)
    const noWrites = { idbPutMonotonic: async () => null, idbPutHistory: async () => null, memPutMonotonic: () => {} }
    const k = keyOf({ sym: 'AAA', tf: '5' })
    const run = async (afterPaint) => {
      const frames = []
      const store = boot({ io: noWrites, frames, afterPaint })
      store.registry.dispatch(k, rest(k, 'AAA', ANSWER))
      const off = store.subscribe(k, () => {})
      runFrames(frames)
      for (let i = 0; i < 10; i++) { await settle(); await new Promise((r) => setTimeout(r, 0)) }
      const s = store.peek(k)
      off(); store.dispose()
      return s
    }
    const deferred = await run(undefined)
    const immediate = await run((fn) => { fn(); return () => false })
    expect(deferred.bars.length).toBeGreaterThan(ANSWER.length)   // the depth did join
    expect(rowsOf(deferred)).toEqual(rowsOf(immediate))
    expect(deferred.depth).toBe(immediate.depth)
  })

  it('H8 store ON: a key the device holds (no server answer) is read at once', async () => {
    const io = spyIO(); const frames = []
    const hit = { n: ANSWER.length, rows: ANSWER, through: ANSWER[ANSWER.length - 1].t + 300, savedAt: NOW, formingT: null }
    const device = { peek: vi.fn(() => hit), read: vi.fn(async () => hit) }
    const store = boot({ io, frames, device })
    const k = keyOf({ sym: 'AAA', tf: '5' })
    await store.persist.refreshDevice(k)
    expect(store.peek(k).source).toBe('device')
    const off = store.subscribe(k, () => {})
    expect(io.idbGet).toHaveBeenCalledTimes(1)
    expect(frames).toHaveLength(0)
    off(); store.dispose()
  })
})
