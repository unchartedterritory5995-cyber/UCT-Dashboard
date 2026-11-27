// ⭐ A TIMEFRAME SWITCH AFTER A DWELL IS NOT SLOWER (2026-11-24, the dwell's warms first out of the registry: see
// prefetch.dwellFirstOut.test.js). The chart's background warm (this hook) loads the other timeframes of the symbol the
// member rests on, and their lake depth for 5m / 30m / 60m, so a timeframe click paints the whole depth at once. Those
// entries go first only once no chart shows their symbol; while one does they are ordinary.
//   W3 the member rests on the symbol and the registry fills (older entries, newer entries): the 60m entry the dwell
//      made, deep, is still held, and the 5m -> 60m switch paints the lake's depth at once, never held for the lake
//      (as today: tfLakeHold L4).
//   W4 the warm this hook runs marks what it made: once the chart has moved to another symbol, the first symbol's
//      entries go before older ordinary ones.
// Real hook, real store, the real mem cache (no IndexedDB), a fake server (80 ms) and a fake lake (200 ms), as
// useBarSnapshotBars.tfLakeHold.test.jsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createBarStore } from '../../data/barStore/index'
import { createRegistry } from '../../data/barStore/registry'
import { keyOf } from '../../data/barStore/types'
import { memClear } from '../../utils/barsMemCache'

const S = vi.hoisted(() => ({ store: null }))
vi.mock('../../data/barStore/index', async (orig) => {
  const m = await orig()
  return { ...m, getBarStore: () => S.store }
})
const { useBarSnapshotBars } = await import('./useBarSnapshotBars')
const P = await import('../../data/barStore/prefetch')

const SYM = 'SIMD'
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
function dayBars(tfMin, d, uptoMs) {
  const out = []
  for (let b = OPEN(d); b < OPEN(d) + 390 * 60; b += tfMin * 60) {
    if ((b + tfMin * 60) * 1000 > uptoMs) break
    const a = agg(tfMin, b, uptoMs); if (a) out.push(a)
  }
  return out
}
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
function lakeRows(tfMin, nowMs) {
  const rows = []
  for (const d of [9, 10, 11, 12, 13]) rows.push(...dayBars(tfMin, d, nowMs))
  return rows
}
// the REAL mem cache (barsMemCache), no IndexedDB
const NO_IDB = { idbGet: async () => null, idbGetHistoryEntry: async () => null, idbPutMonotonic: async () => {}, idbPutHistory: async () => {} }

function world({ lakeDelayMs = 200, restDelayMs = 80 } = {}) {
  const request = vi.fn((url) => new Promise((resolve) => {
    const tf = Number(/[?&]tf=(\w+)/.exec(url)?.[1])
    setTimeout(() => resolve(answer(tf, Date.now())), restDelayMs)
  }))
  const history = {
    olderBars: vi.fn((key) => new Promise((resolve) => {
      const tf = Number(String(key).split('_')[1]) || 60
      setTimeout(() => resolve({ bars: lakeRows(tf, Date.now()), exhausted: false }), lakeDelayMs)
    })),
    prime: () => {},
    hasSymbol: async () => true,
  }
  const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }) })
  const store = createBarStore({
    registry, request, history, pushEnabled: () => false,
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), io: NO_IDB,
  })
  S.store = store
  return { store, request, history, registry }
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

const K60 = keyOf({ sym: SYM, tf: '60' })


/** `n` idle entries (newer than everything held), then one release: the registry evicts down to its cap. */
let pads = 0
function pressure(registry, n) {
  for (let i = 0; i < n; i++) registry.getSnapshot(keyOf({ sym: `PAD${pads++}`, tf: '5' }))
  const x = keyOf({ sym: 'PAD0', tf: '5' })
  registry.acquire(x); registry.release(x)
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(SWITCH - 4000); memClear(); pads = 0 })
afterEach(() => { S.store?.dispose(); vi.useRealTimers(); memClear() })

describe('a timeframe switch after a dwell', () => {
  it("W3 the member stays: the dwell's deep 60m entry outlives older entries, and the switch paints its depth at once", async () => {
    const w = world()
    // 150 older ordinary entries (a list's rows)
    for (let i = 0; i < 150; i++) w.registry.getSnapshot(keyOf({ sym: `OLD${i}`, tf: '1' }))
    let p = params()
    const h = renderHook((pp) => useBarSnapshotBars(pp), { initialProps: p })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    // the dwell, as this hook's background warm makes it: the 60m answer, then its lake depth
    P.prefetch([K60], { priority: 'background', warm: true, dwell: true })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    const seeded = w.store.lakeSeed(K60)
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    await seeded
    expect(w.store.peek(K60)?.bars.length ?? 0).toBeGreaterThanOrEqual(28)   // the lake's depth joined
    expect(w.store.lakePending(K60)).toBe(false)
    // the registry fills while the member stays (newer entries: a list scrolled, a typed warm)
    pressure(w.registry, 200 - w.registry.keys().length + 20)
    expect(w.registry.has(keyOf({ sym: 'OLD0', tf: '1' }))).toBe(false)        // eviction ran
    expect(w.registry.has(K60), 'the dwell entry of the symbol on screen was evicted').toBe(true)
    h.rerender(p)
    const t0 = Date.now()
    p = { ...p, resolvedTf: '60', _barsTf: '60' }
    p._onScreenSrcRef.current = { sym: SYM, tf: '5', ext: false, bars: h.result.current.bars }
    h.rerender(p)
    const frames = []
    for (let i = 0; i < 40; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })
      h.rerender(p)
      const bars = h.result.current.bars
      frames.push({ ms: Date.now() - t0, n: bars ? bars.length : null })
    }
    const first = frames.find((f) => f.n != null)
    expect(first, JSON.stringify(frames.slice(0, 5))).toBeTruthy()
    // as today (tfLakeHold L4): never held for the lake (~200 ms here), and the first frame holds its depth
    expect(first.ms).toBeLessThan(150)
    expect(first.n).toBeGreaterThanOrEqual(28)                 // 4 prior sessions x 7 + today's
  }, 60_000)

  it('W4 the background warm marks what it made: once the chart shows another symbol, those entries go before older ones', async () => {
    const w = world()
    for (let i = 0; i < 100; i++) w.registry.getSnapshot(keyOf({ sym: `OLD${i}`, tf: '1' }))
    let p = params({ backgroundWarm: true })
    const h = renderHook((pp) => useBarSnapshotBars(pp), { initialProps: p })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })    // mounted, before its background warm (600 ms)
    const before = new Set(w.registry.keys())
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })   // the warm and its answers
    expect(w.store.peek(K60)?.restSeen).toBe(true)
    const made = w.registry.keys().filter((x) => !before.has(x) && x.startsWith(`${SYM}_`))
    expect(made.length).toBeGreaterThanOrEqual(4)              // the other timeframes (60m, 30m, 15m, 1m, D...)
    // the chart moves to another symbol (before that symbol's own warm)
    p = { ...p, sym: 'OTHR' }
    h.rerender(p)
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    // exactly as many evictions as the warm made entries: those go, not an older ordinary one
    pressure(w.registry, 200 - w.registry.keys().length + made.length)
    expect(made.filter((x) => w.registry.has(x)), "the warm's entries of a symbol no chart shows outlived older entries").toEqual([])
    expect(w.registry.has(keyOf({ sym: 'OLD0', tf: '1' })), 'an older ordinary entry went first').toBe(true)
    h.unmount()
  }, 60_000)
})
