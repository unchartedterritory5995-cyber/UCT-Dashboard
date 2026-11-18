// A TIMEFRAME SWITCH PAINTS THE WHOLE DEPTH ONCE (2026-11-18). Measured on production before this:
// a 5m -> 1h click on AAPL painted the server's 475 bars, then grew 3,884 -> 6,950 -> 10,261 over
// ~1.1 s as lake windows landed. Contract, through the real hook over a real store (fake server,
// fake lake, synthetic prices):
//   L1  while the lake's depth is due for the new key, the previous timeframe stays on screen
//       (bars null, the switch hold) even after the server answers, and the first frame that
//       paints already holds the lake's depth;
//   L2  the wait is bounded: a lake slower than LAKE_JOIN_WAIT_MS never holds the chart longer;
//   L3  a store without the lake holds only until the server's answer, exactly as before.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createBarStore } from '../../data/barStore/index'
import { LAKE_JOIN_WAIT_MS } from '../../data/barStore/prefetch'
import { keyOf } from '../../data/barStore/types'

const S = vi.hoisted(() => ({ store: null }))
vi.mock('../../data/barStore/index', async (orig) => {
  const m = await orig()
  return { ...m, getBarStore: () => S.store }
})
const { useBarSnapshotBars } = await import('./useBarSnapshotBars')

const SYM = 'SIMH'
const utc = (d, h, m, s = 0) => Date.UTC(2026, 10, d, h, m, s)          // Nov 2026 is EST (UTC-5)
const SWITCH = utc(13, 16, 50, 28)                                         // Fri 11:50:28 ET
const OPEN = (d) => utc(d, 14, 30) / 1000
const px = (ms) => Math.round((100 + Math.sin(ms / 7000) * 2 + (ms % 997) / 1000) * 100) / 100

function agg(tfMin, b, uptoMs) {
  const end = Math.min(uptoMs, (b + tfMin * 60) * 1000 - 1)
  if (end < b * 1000) return null
  let o = px(b * 1000), h = o, l = o, c = o
  for (let ms = b * 1000; ms <= end; ms += 1000) { const p = px(ms); h = Math.max(h, p); l = Math.min(l, p); c = p }
  return { t: b, o, h, l, c, v: 100 }
}
/** RTH buckets of `tfMin` on day `d` (09:30 grid, 6.5 h), closed by `uptoMs`. */
function dayBars(tfMin, d, uptoMs) {
  const out = []
  for (let b = OPEN(d); b < OPEN(d) + 390 * 60; b += tfMin * 60) {
    if ((b + tfMin * 60) * 1000 > uptoMs) break
    const a = agg(tfMin, b, uptoMs); if (a) out.push(a)
  }
  return out
}
/** The server's answer at `nowMs`: today's session only (a few bars), developing bar included. */
function answer(tfMin, nowMs) {
  const bars = []
  for (let b = OPEN(13); b * 1000 <= nowMs; b += tfMin * 60) { const a = agg(tfMin, b, nowMs); if (a) bars.push(a) }
  const nowS = Math.floor(nowMs / 1000)
  const last = bars.at(-1)
  return {
    bars, contract: 1, grid: 'session', session: 'rth', cache_key: `b1:${SYM}:${tfMin}:session`, series_rev: nowMs, history_rev: 7,
    verified_through: nowS - 2, complete_through: null,
    developing: last && last.t + tfMin * 60 > nowS ? { ...last, rev: nowMs } : null, tail_status: 'verified',
  }
}
/** The lake: the four sessions before today plus today's closed buckets (they prove the basis). */
function lakeRows(tfMin, nowMs) {
  const rows = []
  for (const d of [9, 10, 11, 12, 13]) rows.push(...dayBars(tfMin, d, nowMs))
  return rows
}

const NO_IO = {
  memPeekEntry: () => null, idbGet: async () => null, idbGetHistoryEntry: async () => null,
  memPutMonotonic: () => {}, idbPutMonotonic: async () => {}, idbPutHistory: async () => {},
}

function world({ lakeDelayMs = 200, lake = true, restDelayMs = 80 } = {}) {
  const request = vi.fn((url) => new Promise((resolve) => {
    const tf = Number(/[?&]tf=(\w+)/.exec(url)?.[1])
    setTimeout(() => resolve(answer(tf, Date.now())), restDelayMs)
  }))
  const history = lake ? {
    olderBars: vi.fn((key) => new Promise((resolve) => {
      const tf = Number(String(key).split('_').pop()) || 60
      setTimeout(() => resolve({ bars: lakeRows(tf, Date.now()), exhausted: false }), lakeDelayMs)
    })),
    prime: () => {},
    hasSymbol: async () => true,
  } : null
  const store = createBarStore({
    request, history, pushEnabled: () => false,
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), io: NO_IO,
  })
  S.store = store
  return { store, request, history }
}

function params(over) {
  const ref = (v = null) => ({ current: v })
  return {
    sym: SYM, resolvedTf: '5', _barsTf: '5', _econId: null, showExtended: false, isIntraday: true,
    breadthSeries: false, replayCutoff: null, compareSymbol: null, backgroundWarm: false, deepWarm: false,
    barsOverride: null, barsOverridePending: false, _liveSane: () => true, _gridQ: '', instFetcher: vi.fn(),
    _pinnedFull: false, _overlayActive: false, barCount: 600, _intradayDeepArmed: false,
    _setIntradayDeepArmed: () => {}, axisWidthRatchetRef: ref(0), barsMutateRef: ref(), _timingIdRef: ref(),
    activeTfRef: ref('5'), _onScreenSrcRef: ref(), tfSwitchHoldRef: ref(false), provisionalStaleRef: ref(false),
    _developingBarISO: () => null, _effLivePrice: () => null,
    _intradayDeepBackfillEnabled: () => false, _intradaySmoothSwitchEnabled: () => false,
    _storeDevRef: ref(), _storeDevPaintRef: ref(() => {}),
    ...over,
  }
}

/** Mount on 5m, let it settle, switch to 60m the way StockChart does, then step 10 ms at a time. */
async function switchTo60() {
  let p = params()
  const h = renderHook((pp) => useBarSnapshotBars(pp), { initialProps: p })
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  h.rerender(p)
  const t0 = Date.now()
  p = { ...p, resolvedTf: '60', _barsTf: '60' }
  p._onScreenSrcRef.current = { sym: SYM, tf: '5', ext: false, bars: h.result.current.bars }
  h.rerender(p)
  const frames = []
  for (let i = 0; i < 80; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    h.rerender(p)
    const bars = h.result.current.bars
    frames.push({ ms: Date.now() - t0, n: bars ? bars.length : null, hold: h.result.current._tfSwitchHold })
  }
  return frames
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(SWITCH - 2000) })
afterEach(() => { S.store?.dispose(); vi.useRealTimers() })

describe('a timeframe switch paints the lake depth once', () => {
  it('L1 the server answers first, the lake 200 ms later: one paint, already deep', async () => {
    const w = world({ lakeDelayMs: 200, restDelayMs: 80 })
    const frames = await switchTo60()
    const painted = frames.filter((f) => f.n != null)
    expect(painted.length).toBeGreaterThan(0)
    const first = painted[0]
    // held through the server's answer (~80 ms) until the lake landed (~200 ms)
    expect(first.ms).toBeGreaterThanOrEqual(190)
    expect(first.ms).toBeLessThanOrEqual(LAKE_JOIN_WAIT_MS + 20)
    // the first painted frame already holds the prior sessions (4 days x 7 + today's)
    expect(first.n).toBeGreaterThanOrEqual(28)
    // ...and never grows after it (one paint)
    expect(Math.max(...painted.map((f) => f.n))).toBe(first.n)
    expect(w.history.olderBars).toHaveBeenCalled()
  })

  it('L2 a lake slower than the bound never holds the chart past LAKE_JOIN_WAIT_MS', async () => {
    world({ lakeDelayMs: 5000, restDelayMs: 80 })
    const frames = await switchTo60()
    const first = frames.find((f) => f.n != null)
    expect(first).toBeTruthy()
    expect(first.ms).toBeLessThanOrEqual(LAKE_JOIN_WAIT_MS + 20)
    expect(first.ms).toBeGreaterThanOrEqual(LAKE_JOIN_WAIT_MS - 20)
  })

  it('L4 a key whose lake already landed never holds (paints on the answer)', async () => {
    const w = world({ lakeDelayMs: 200, restDelayMs: 80 })
    const k60 = keyOf({ sym: SYM, tf: '60' })
    // build and seed the 60m key first, exactly as the neighbor warm does
    const un = w.store.subscribe(k60, () => {})
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    const seeded = w.store.lakeSeed(k60)
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    await seeded
    expect(w.store.lakePending(k60)).toBe(false)
    const frames = await switchTo60()
    un()
    const first = frames.find((f) => f.n != null)
    expect(first).toBeTruthy()
    expect(first.ms).toBeLessThan(150)
  })

  it('L3 without the lake the hold ends on the server answer, as before', async () => {
    world({ lake: false, restDelayMs: 80 })
    const frames = await switchTo60()
    const first = frames.find((f) => f.n != null)
    expect(first).toBeTruthy()
    expect(first.ms).toBeLessThan(150)
  })
})
