// A TIMEFRAME SWITCH'S LAKE HOLD WAITS ON A LOAD THAT NEVER YIELDS (review of #2786, smoothness 2b).
// The lake's pieces decode one per task unless a paint waits on the load (network.lakeSeed `awaited`). The switch hold
// (useBarSnapshotBars: the previous timeframe stays on screen until the lake's depth joins, LAKE_JOIN_WAIT_MS at most)
// IS such a wait: a per-piece yield there could miss it and paint shallow, then deep. Through the real hook over a real
// store (fake server, fake lake, synthetic prices), with a SAVED 60m copy (so the chart's own subscribe load of the 60m
// key is not awaited and cannot hide this one):
//   H1 while the hold waits, the 60m key's lake load answers its per-piece wait with nothing (decodes at once)
//   H2 control: with no switch (the 60m chart mounted directly over its saved copy), the same load yields per piece
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createBarStore } from '../../data/barStore/index'
import { LAKE_JOIN_WAIT_MS } from '../../data/barStore/prefetch'
import { keyOf } from '../../data/barStore/types'

const S = vi.hoisted(() => ({ store: null, saved60: null }))
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
  memPeekEntry: (sym, tf) => (tf === '60' && S.saved60 ? { bars: S.saved60, savedAt: Date.now() - 60_000 } : null), idbGet: async () => null, idbGetHistoryEntry: async () => null,
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


const k60 = keyOf({ sym: SYM, tf: '60' })
const loadOf = (w) => w.history.olderBars.mock.calls.find((c) => c[0] === k60)
const waitsNow = (w) => { const w0 = loadOf(w)?.[2]?.yieldTask?.(); return w0 && typeof w0.then === 'function' ? 'yields' : 'at once' }

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(SWITCH - 2000); S.saved60 = null })
afterEach(() => { S.store?.dispose(); vi.useRealTimers(); S.saved60 = null })

describe("a timeframe switch's lake hold waits on a load that never yields", () => {
  it('H1 while the hold waits, the 60m lake load decodes its pieces at once', async () => {
    S.saved60 = [9, 10, 11].flatMap((d) => dayBars(60, d, SWITCH))   // a saved copy, three sessions deep
    const w = world({ lakeDelayMs: 400, restDelayMs: 80 })
    let p = params()
    const h = renderHook((pp) => useBarSnapshotBars(pp), { initialProps: p })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    h.rerender(p)
    p = { ...p, resolvedTf: '60', _barsTf: '60' }
    p._onScreenSrcRef.current = { sym: SYM, tf: '5', ext: false, bars: h.result.current.bars }
    h.rerender(p)
    for (let i = 0; i < 5; i++) { await act(async () => { await vi.advanceTimersByTimeAsync(10) }); h.rerender(p) }
    expect(h.result.current._tfSwitchHold).toBe(true)        // the hold is on, waiting for the lake (400 ms)
    expect(loadOf(w)).toBeTruthy()
    expect(waitsNow(w)).toBe('at once')
  })

  it('H2 control: no switch, the 60m chart over its saved copy: its lake load yields per piece', async () => {
    S.saved60 = [9, 10, 11].flatMap((d) => dayBars(60, d, SWITCH))
    const w = world({ lakeDelayMs: 400, restDelayMs: 80 })
    const p = params({ resolvedTf: '60', _barsTf: '60', activeTfRef: { current: '60' } })
    const h = renderHook((pp) => useBarSnapshotBars(pp), { initialProps: p })
    for (let i = 0; i < 5; i++) { await act(async () => { await vi.advanceTimersByTimeAsync(10) }); h.rerender(p) }
    expect(loadOf(w)).toBeTruthy()
    expect(waitsNow(w)).toBe('yields')
  })
})
