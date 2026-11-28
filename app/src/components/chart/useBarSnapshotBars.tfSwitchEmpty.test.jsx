// ⭐ (lane C, 2026-11-28: the cloud rig's BLANK on a D -> 1m press, base and #3008 alike) A TIMEFRAME PRESS NEVER PAINTS
// AN EMPTY CHART. The switch hold (useBarSnapshotBars `_tfSwitchHold`) kept the previous timeframe on screen only when
// the store already held a snapshot of the new key; with NOTHING held yet (a cold 1m key) it handed StockChart no bars,
// and updateChart's empty arm cleared every series: a black chart until the answer landed (~160 ms on production).
//   B1 (red first) a switch onto a key the store holds nothing of: the hold is on, the previous frame stays
//   B2 the hold ends once the new key's bars are in (the switch then paints them)
//   B4 (red first) from a DAILY chart to an extended-hours intraday one: still a timeframe switch (a daily chart has no
//      session, so the session of the outgoing frame is not compared), the hold is on
//   B5 CONTROL: another symbol on screen is not a timeframe switch
//   B6 bounded: the daily-to-intraday hold ends after TF_SWITCH_EMPTY_HOLD_MS (the symbol hand-off's HANDOFF_HANG_MS)
//   B7 a TERMINAL empty answer (no_data: the key is UNAVAILABLE) releases the hold at once, well inside the bound
//   B8 (red at 9e0c8514ca) an EARLY empty answer that fills later never releases it: a 503 `warming`, then rows
//   B9 (red at 9e0c8514ca) the same for an answer `filling: true` with no rows
// (the harness below is the lake-hold test's: the real hook over a real store, fake server)
// ---- original harness header follows ----
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

function world({ lakeDelayMs = 200, lake = true, restDelayMs = 80, emptyTf = null, earlyTf = null, early = null } = {}) {
  let earlyLeft = early ? 1 : 0
  const request = vi.fn((url) => new Promise((resolve, reject) => {
    const tf = Number(/[?&]tf=(\w+)/.exec(url)?.[1])
    // an EARLY empty answer that fills later: the first ask of `earlyTf` answers `early`, every later one rows
    if (tf === earlyTf && earlyLeft > 0) {
      earlyLeft--
      if (early === 'warming') {
        const e = Object.assign(new Error('warming'), { status: 503, warming: true, retryAfterMs: 400 })
        setTimeout(() => reject(e), restDelayMs)
      } else {
        setTimeout(() => resolve({ ...answer(tf, Date.now()), bars: [], developing: null, filling: true }), restDelayMs)
      }
      return
    }
    const body = tf === emptyTf
      ? { bars: [], no_data: true, contract: 1, grid: 'session', session: 'rth', series_rev: Date.now(), history_rev: 7, developing: null }
      : answer(tf, Date.now())
    setTimeout(() => resolve(body), restDelayMs)
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
    activeTfRef: ref('5'), _onScreenSrcRef: ref(), _shownTfRef: ref(null), tfSwitchHoldRef: ref(false), provisionalStaleRef: ref(false),
    _developingBarISO: () => null, _effLivePrice: () => null,
    _intradayDeepBackfillEnabled: () => false, _intradaySmoothSwitchEnabled: () => false,
    _storeDevRef: ref(), _storeDevPaintRef: ref(() => {}),
    ...over,
  }
}




beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(SWITCH - 2000); S.saved60 = null })
afterEach(() => { S.store?.dispose(); vi.useRealTimers(); S.saved60 = null })

async function switchTo1m(h, p) {
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  h.rerender(p)
  const q = { ...p, resolvedTf: '1', _barsTf: '1' }
  q._onScreenSrcRef.current = { sym: SYM, tf: '5', ext: false, bars: h.result.current.bars }
  h.rerender(q)
  return q
}

describe('a timeframe press never paints an empty chart', () => {
  it('B1 (red first) onto a key the store holds nothing of: the hold is on, no empty set handed to the chart', async () => {
    world({ lake: false, restDelayMs: 300 })
    const p = params()
    const h = renderHook((pp) => useBarSnapshotBars(pp), { initialProps: p })
    const q = await switchTo1m(h, p)
    for (let i = 0; i < 3; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(20) })
      h.rerender(q)
      const b = h.result.current.bars
      // either the hold is on (the previous frame stays), or the new key's bars are in: never an empty set unheld
      expect(h.result.current._tfSwitchHold || (Array.isArray(b) && b.length > 0), `empty and unheld at +${(i + 1) * 20} ms`).toBe(true)
    }
  })

  it('B2 the hold ends once the new key answered: its bars paint', async () => {
    world({ lake: false, restDelayMs: 300 })
    const p = params()
    const h = renderHook((pp) => useBarSnapshotBars(pp), { initialProps: p })
    const q = await switchTo1m(h, p)
    for (let i = 0; i < 10; i++) { await act(async () => { await vi.advanceTimersByTimeAsync(100) }); h.rerender(q) }
    expect(h.result.current._tfSwitchHold).toBe(false)
    expect(h.result.current.bars?.length).toBeGreaterThan(0)
  })

  it('B4 (red first) from a DAILY chart (no session) to an extended-hours 1m chart with nothing held: the hold is on', async () => {
    // the production case (cloud rig, COV-tf-def press 0, D -> 1m, 2 of 4 reps blank for ~110 ms): the outgoing daily
    // chart was recorded with ext false, the 1m chart shows extended hours, so `_isTfSwitch` (ext equal) was false
    world({ lake: false, restDelayMs: 300 })
    const p = params({ showExtended: true })
    const h = renderHook((pp) => useBarSnapshotBars(pp), { initialProps: p })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    const q = { ...p, resolvedTf: '1', _barsTf: '1' }
    // a DAILY chart records no intraday on-screen source (StockChart `_onScreenSrcRef` is intraday-only): only what it showed
    q._onScreenSrcRef.current = null
    q._shownTfRef.current = { sym: SYM, tf: 'D' }
    h.rerender(q)
    for (let i = 0; i < 3; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(20) })
      h.rerender(q)
      const b = h.result.current.bars
      expect(h.result.current._tfSwitchHold || (Array.isArray(b) && b.length > 0), `empty and unheld at +${(i + 1) * 20} ms`).toBe(true)
    }
  })

  it('B6 the daily-to-intraday hold is BOUNDED: a key that never answers is released after TF_SWITCH_EMPTY_HOLD_MS', async () => {
    const { TF_SWITCH_EMPTY_HOLD_MS } = await import('./useBarSnapshotBars')
    world({ lake: false, restDelayMs: 600_000 })
    const p = params({ showExtended: true })
    const h = renderHook((pp) => useBarSnapshotBars(pp), { initialProps: p })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    const q = { ...p, resolvedTf: '1', _barsTf: '1' }
    q._onScreenSrcRef.current = null
    q._shownTfRef.current = { sym: SYM, tf: 'D' }
    h.rerender(q)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    h.rerender(q)
    expect(h.result.current._tfSwitchHold).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(TF_SWITCH_EMPTY_HOLD_MS + 50) })
    h.rerender(q)
    expect(h.result.current._tfSwitchHold).toBe(false)
  })

  it('B7 a TERMINAL empty answer (no_data) releases the daily-to-intraday hold at once (no old candles over a no-data answer)', async () => {
    const { TF_SWITCH_EMPTY_HOLD_MS } = await import('./useBarSnapshotBars')
    world({ lake: false, restDelayMs: 100, emptyTf: 1 })
    const p = params({ showExtended: true })
    const h = renderHook((pp) => useBarSnapshotBars(pp), { initialProps: p })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    const q = { ...p, resolvedTf: '1', _barsTf: '1' }
    q._onScreenSrcRef.current = null
    q._shownTfRef.current = { sym: SYM, tf: 'D' }
    h.rerender(q)
    await act(async () => { await vi.advanceTimersByTimeAsync(20) })
    h.rerender(q)
    expect(h.result.current._tfSwitchHold, 'held while the answer is in flight').toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    h.rerender(q)
    expect(TF_SWITCH_EMPTY_HOLD_MS).toBeGreaterThan(1000)
    expect(h.result.current._tfSwitchHold, 'released by the terminal no_data answer, not by the bound').toBe(false)
  })

  for (const [early, label] of [['warming', 'B8 a 503 warming'], ['filling', 'B9 an answer filling with no rows']]) {
    it(`${label}, then rows: the daily-to-intraday hold stays until the rows land (never empty and unheld)`, async () => {
      const { request } = world({ lake: false, restDelayMs: 60, earlyTf: 1, early })
      const p = params({ showExtended: true })
      const h = renderHook((pp) => useBarSnapshotBars(pp), { initialProps: p })
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      const q = { ...p, resolvedTf: '1', _barsTf: '1' }
      q._onScreenSrcRef.current = null
      q._shownTfRef.current = { sym: SYM, tf: 'D' }
      h.rerender(q)
      for (let i = 0; i < 150; i++) {
        await act(async () => { await vi.advanceTimersByTimeAsync(25) })
        h.rerender(q)
        const b = h.result.current.bars
        expect(h.result.current._tfSwitchHold || (Array.isArray(b) && b.length > 0), `empty and unheld at +${(i + 1) * 25} ms`).toBe(true)
      }
      // the early answer came first, then the rows: the case is the one it claims
      expect(request.mock.calls.filter(([u]) => /[?&]tf=1(&|$)/.test(String(u))).length, 'the 1m key asked again').toBeGreaterThanOrEqual(2)
      expect(h.result.current.bars?.length, 'the rows landed').toBeGreaterThan(0)
    })
  }

  it('B5 CONTROL: a symbol change (another symbol on screen) is not a timeframe switch: no hold here', async () => {
    world({ lake: false, restDelayMs: 300 })
    const p = params({ showExtended: true })
    const h = renderHook((pp) => useBarSnapshotBars(pp), { initialProps: p })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    const q = { ...p, resolvedTf: '1', _barsTf: '1' }
    q._onScreenSrcRef.current = null
    q._shownTfRef.current = { sym: 'OTHER', tf: 'D' }
    h.rerender(q)
    await act(async () => { await vi.advanceTimersByTimeAsync(20) })
    h.rerender(q)
    expect(h.result.current._tfSwitchHold).toBe(false)
  })
})
