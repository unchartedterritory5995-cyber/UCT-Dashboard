// The 5m → 1m TIMEFRAME SWITCH under the tick fallback (prod: VITE_REALTIME_BARS=0), driven
// through the real hook over a real store (createBarStore with fake feeds + a fake server).
// Reproduces the two 2026-11-13 NVDA glitches deterministically (synthetic prices only).
//
// Contracts, stated generally:
//   F1  the new key's live feed is attached at the switch itself — no later event (history merge,
//       verified_through, a prefetch) gates it. Under a LAGGING feed the developing bar stays
//       still exactly until the first print whose OWN trade time reaches its bucket: prints of an
//       older bucket belong to a closed row (reducer.tickAdmission). That silence is the feed's
//       lag minus the time since the bucket opened — the observed 34 s at 09:50:28 is a ~62 s lag.
//   N1  the bar the chart's readout calls newest (the BASE series' tail) is ALWAYS the developing
//       bar the store paints — a developing bar that opens a bucket is a base change
//       (reducer.isDevOnlyChange), so the legend can never sit on 09:50 under a painted 09:51.
//   H1  a switch never paints a provably stale right edge the server has not vouched for IN THIS
//       LIFE of the key: a prior-life answer / error held in the registry does not end the hold
//       (network.answered). It ends on this life's answer (or error), and a right edge the store
//       calls current paints at once.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createBarStore } from '../../data/barStore/index'
import { keyOf } from '../../data/barStore/types'
import { fakeCandle, fakePrices } from '../../data/barStore/testing/fakeFeeds'

const S = vi.hoisted(() => ({ store: null }))
vi.mock('../../data/barStore/index', async (orig) => {
  const m = await orig()
  return { ...m, getBarStore: () => S.store }
})
const { useBarSnapshotBars } = await import('./useBarSnapshotBars')

const SYM = 'SIMN'
const utc = (d, h, m, s = 0) => Date.UTC(2026, 10, d, h, m, s)          // Nov 2026 is EST (UTC-5)
const SWITCH = utc(13, 14, 50, 28)                                         // Fri 09:50:28 ET
const OPEN = (d) => utc(d, 14, 30) / 1000
const K1 = keyOf({ sym: SYM, tf: '1' })
/** The synthetic tape: a deterministic price for every trade second. */
const px = (ms) => Math.round((100 + Math.sin(ms / 7000) * 2 + (ms % 997) / 1000) * 100) / 100

/** The server's aggregate of bucket `b` (tf minutes) from trades up to `uptoMs`. */
function agg(tf, b, uptoMs) {
  const end = Math.min(uptoMs, (b + tf * 60) * 1000 - 1)
  if (end < b * 1000) return null
  let o = px(b * 1000), h = o, l = o, c = o
  for (let ms = b * 1000; ms <= end; ms += 1000) { const p = px(ms); h = Math.max(h, p); l = Math.min(l, p); c = p }
  return { t: b, o, h, l, c, v: 100 }
}
/** The server's answer at `nowMs`. `dataLagMs`: its own rows trail the clock (its feed lags);
 *  a bucket the server's CLOCK has passed is closed, so a lagging server answers with NO
 *  developing bar until the new bucket's first trade reaches it. */
function answer(tf, nowMs, { day = 13, dataLagMs = 0 } = {}) {
  const upto = nowMs - dataLagMs
  const bars = []
  for (let b = OPEN(day); b * 1000 <= upto; b += tf * 60) { const a = agg(tf, b, upto); if (a) bars.push(a) }
  const nowS = Math.floor(nowMs / 1000)
  const last = bars.at(-1)
  let C = null
  for (const b of bars) if (b.t + tf * 60 <= nowS - 45) C = b.t + tf * 60
  return {
    bars, contract: 1, grid: 'session', session: 'rth', cache_key: `b1:${SYM}:${tf}:session`, series_rev: nowMs, history_rev: 7,
    verified_through: Math.floor(upto / 1000) - 2, complete_through: C,
    developing: last && last.t + tf * 60 > nowS ? { ...last, rev: nowMs } : null, tail_status: 'verified',
  }
}

const NO_IO = {
  memPeekEntry: () => null, idbGet: async () => null, idbGetHistoryEntry: async () => null,
  memPutMonotonic: () => {}, idbPutMonotonic: async () => {}, idbPutHistory: async () => {},
}

function world({ feedLagMs = 0, serverLagMs = 0, restDelayMs = 300, fail = () => false } = {}) {
  const prices = fakePrices()
  const request = vi.fn((url) => new Promise((resolve, reject) => {
    const tf = Number(/[?&]tf=(\w+)/.exec(url)?.[1])
    setTimeout(() => (fail(url) ? reject(Object.assign(new Error('503'), { status: 503 })) : resolve(answer(tf, Date.now(), { dataLagMs: serverLagMs }))), restDelayMs)
  }))
  const store = createBarStore({
    request, candle: fakeCandle(), prices, pushEnabled: () => false,
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), io: NO_IO,
  })
  S.store = store
  // One Massive print per second, stamped with its OWN (lagging) trade time.
  const print = () => { const n = Date.now(); prices.set(SYM, px(n - feedLagMs), { trade_ts: n - feedLagMs }) }
  return { store, prices, request, print }
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

/** Mount on 5m two minutes before the switch, then switch to 1m at 09:50:28 the way StockChart
 *  does (the 5m series is what is on screen). Returns a stepper that advances one second, lets
 *  the feed print, re-renders and reports what the chart would show. */
async function mountAndSwitch(w, { print = true, beforeSwitch = null } = {}) {
  let p = params()
  const h = renderHook((pp) => useBarSnapshotBars(pp), { initialProps: p })
  while (Date.now() < SWITCH) {
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); if (print) w.print() })
    h.rerender(p)
  }
  vi.setSystemTime(SWITCH)
  beforeSwitch?.()
  p = { ...p, resolvedTf: '1', _barsTf: '1' }
  p._onScreenSrcRef.current = { sym: SYM, tf: '5', ext: false, bars: h.result.current.bars }
  h.rerender(p)
  const frame = () => {
    const bars = h.result.current.bars
    return { at: Date.now(), bars, tail: bars?.length ? bars.at(-1) : null, dev: p._storeDevRef.current, hold: h.result.current._tfSwitchHold }
  }
  const frames = [frame()]
  const step = async () => {
    // The async advance settles each answer at its own instant (before the next print), as a
    // real network answer would land.
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); if (print) w.print() })
    h.rerender(p)
    frames.push(frame())
    return frames.at(-1)
  }
  return { h, p, step, frames }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(SWITCH - 120_000) })
afterEach(() => { S.store?.dispose(); vi.useRealTimers() })

describe('F1 — the 1m feed is live from the switch; a lagging feed is silent exactly for its lag', () => {
  it.each([[62_000], [45_000], [20_000]])('feed lag %i ms: no gate — the bar moves on the first print that reaches its bucket', async (lag) => {
    const w = world({ feedLagMs: lag })
    const { step, frames } = await mountAndSwitch(w)
    // Attached at the switch: the 1m key's tick subscription exists before any answer lands.
    expect(w.store.live.stats().keys).toBeGreaterThanOrEqual(1)
    for (let i = 0; i < 70; i++) await step()
    const bucket = Math.floor(SWITCH / 60000) * 60   // 09:50 — the server's developing bucket
    // Every frame (once the first answer is in, from the second print on) on the 09:50 bar: the
    // bar shows the print just made exactly when that print's OWN trade time is in its bucket,
    // and never otherwise — no gate besides the trade time.
    const onBucket = frames.filter((f) => f.at >= SWITCH + 2000 && f.dev?.t === bucket)
    expect(onBucket.length).toBeGreaterThan(20)
    for (const f of onBucket) {
      const tradeMs = f.at - lag
      const showsPrint = f.dev.c === px(tradeMs)
      expect(showsPrint, `${new Date(f.at).toISOString()} (print stamped ${new Date(tradeMs).toISOString()})`).toBe(tradeMs >= bucket * 1000)
    }
    // With a ~62 s lag, a switch at 09:50:28 shows the 09:50 bar without a tick for 34 s — the observation.
    if (lag === 62_000) {
      const first = onBucket.find((f) => f.dev.c === px(f.at - lag))
      expect(Math.round((first.at - SWITCH) / 1000)).toBe(34)
    }
  })
})

describe('N1 — the base tail (the readout\'s newest bar) is always the bar the store paints', () => {
  it('a server whose own feed lags answers with NO developing bar; the tick that opens 09:51 rolls the base too', async () => {
    const w = world({ feedLagMs: 5_000, serverLagMs: 40_000 })
    const { step, frames } = await mountAndSwitch(w)
    for (let i = 0; i < 150; i++) await step()
    const painted = frames.filter((f) => f.dev && f.tail)
    expect(painted.length).toBeGreaterThan(100)
    // Non-vacuity: the developing bar opened buckets the server had not answered for.
    expect(new Set(painted.map((f) => f.dev.t)).size).toBeGreaterThanOrEqual(3)
    for (const f of painted) {
      expect(f.tail.t, `${new Date(f.at).toISOString()}: base tail vs painted developing bar`).toBe(f.dev.t)
    }
  })
})

describe('H1 — a switch never paints a right edge the server has not vouched for in this life', () => {
  const prevSession = (d) => d.toISOString().slice(0, 10)

  it('a PRIOR-SESSION server answer held in the registry (no subscriber since) does not end the hold', async () => {
    const w = world({ restDelayMs: 2_000 })
    // Yesterday 15:18:30 ET: something warmed the 1m key; nothing has subscribed it since.
    vi.setSystemTime(utc(12, 20, 18, 30))
    w.store.registry.dispatch(K1, { type: 'rest-full', key: K1, gen: 0, payload: answer(1, Date.now(), { day: 12 }) })
    expect(w.store.peek(K1).restSeen).toBe(true)
    vi.setSystemTime(SWITCH - 120_000)
    const { step, frames } = await mountAndSwitch(w)
    for (let i = 0; i < 6; i++) await step()
    const today = '2026-11-13'
    for (const f of frames) {
      if (!f.tail) continue
      expect(prevSession(new Date(f.tail.t * 1000)), `${new Date(f.at).toISOString()}: right edge on screen`).toBe(today)
    }
    // Non-vacuity: the hold was what kept it off screen, and the answer ended it.
    expect(frames[0].hold).toBe(true)
    expect(frames.at(-1).hold).toBe(false)
    expect(frames.at(-1).tail).toBeTruthy()
  })

  it('a prior-life ERROR (a shed warm) over a stale local copy does not end the hold', async () => {
    const w = world({ restDelayMs: 2_000 })
    vi.setSystemTime(utc(12, 20, 19, 30))
    w.store.registry.dispatch(K1, { type: 'mem-hit', key: K1, gen: 0, payload: { bars: answer(1, Date.now(), { day: 12 }).bars } })
    w.store.registry.dispatch(K1, { type: 'rest-error', key: K1, gen: 0, payload: { error: 'warming' } })
    expect(w.store.peek(K1).error).toBe('warming')
    vi.setSystemTime(SWITCH - 120_000)
    const { step, frames } = await mountAndSwitch(w)
    for (let i = 0; i < 6; i++) await step()
    for (const f of frames) {
      if (!f.tail) continue
      expect(prevSession(new Date(f.tail.t * 1000)), `${new Date(f.at).toISOString()}: right edge on screen`).toBe('2026-11-13')
    }
    expect(frames[0].hold).toBe(true)
    expect(frames.at(-1).tail).toBeTruthy()
  })

  it('this life\'s ERROR ends the hold (never an endless hold)', async () => {
    const w = world({ restDelayMs: 500, fail: (url) => /tf=1\b/.test(url) })
    vi.setSystemTime(utc(12, 20, 18, 30))
    w.store.registry.dispatch(K1, { type: 'rest-full', key: K1, gen: 0, payload: answer(1, Date.now(), { day: 12 }) })
    vi.setSystemTime(SWITCH - 120_000)
    const { step, frames } = await mountAndSwitch(w)
    expect(frames[0].hold).toBe(true)
    for (let i = 0; i < 3; i++) await step()
    expect(frames.at(-1).hold).toBe(false)
  })

  it('a CURRENT key (warmed moments ago) paints at the switch — no wait for the answer', async () => {
    const w = world({ restDelayMs: 5_000 })
    const { frames } = await mountAndSwitch(w, {
      print: false,
      beforeSwitch: () => w.store.registry.dispatch(K1, { type: 'rest-full', key: K1, gen: 0, payload: answer(1, SWITCH - 5_000) }),
    })
    expect(frames[0].hold).toBe(false)
    expect(frames[0].tail?.t).toBe(Math.floor(SWITCH / 60000) * 60)
  })
})
