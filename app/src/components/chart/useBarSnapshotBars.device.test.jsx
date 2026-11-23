// P3-M2 (review of #2554): THE CHART'S OWN PAINT RULE CONSULTS THE DEVICE REFUSAL. The switch's doors (prefetch) refuse
// a device copy that is short of the current bucket, an extended view of a shared key, or a stale copy; but a chart's
// FIRST MOUNT (a new widget, a multi-chart grid cell, the phone workspace) and a same-symbol TIMEFRAME CHANGE are decided
// by the chart's own rule (useBarSnapshotBars), which read the store's status alone. Through the real hook over a real
// store (createBarStore with a fake device source and a server that answers when told to), mid-session:
//   FM1 a first mount on a 5m copy whose bucket has just rolled (short its last minute): the loading state, then the answer
//   FM2 a first mount on an EXTENDED view of the shared 5m key: the loading state (the device copy is the regular
//       session: today's pre-market bars are not in it), then the answer
//   FM3 a first mount on a 1m copy that lacks the minute that just closed: the loading state, then the answer
//   FM4 a chart already SHOWING the device copy is never blanked when the copy later reads refused (the bucket ends
//       before the answer): what is on screen stays until the answer replaces it
//   FM5 ...per VIEW: the same shared key switched from the regular to the extended view is refused again
//   TF1 a same-symbol timeframe change on an EXTENDED view onto a fresh device copy: the previous timeframe holds until
//       the new key is answered (the change held for a rolled or stale copy already; not for this one)
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

const SYM = 'NEWB'
const DAY = 86400
const et = (hh, mm, ss = 0) => Date.UTC(2026, 10, 18, hh + 5, mm, ss) / 1000   // Wed 2026-11-18 (EST)
const px = (t) => { const i = (t / 60) % 31; const o = 50 + i / 8; return { o, h: o + 0.4, l: o - 0.4, c: o + 0.1, v: 100 + i } }
/** `tf` buckets from `from` (unix s) whose END is at or before `upto`, closed. */
function rows(tf, from, upto) {
  const out = []
  for (let t = from; t + tf * 60 <= upto; t += tf * 60) out.push({ t, ...px(t) })
  return out
}
const session = (tf, open, close) => rows(tf, open, close)
const yday = (tf) => session(tf, et(9, 30) - DAY, et(16, 0) - DAY)

const NO_IO = {
  memPeekEntry: () => null, idbGet: async () => null, idbGetHistoryEntry: async () => null,
  memPutMonotonic: () => {}, idbPutMonotonic: async () => {}, idbPutHistory: async () => {},
}

/** The server's answer for `tf` at the clock: yesterday, today's PRE-MARKET bar (the key is shared by both sessions),
 *  today's closed buckets and the forming one. */
function answerFor(tf) {
  const now = Math.floor(Date.now() / 1000)
  const cur = Math.floor((now - et(9, 30)) / (tf * 60)) * tf * 60 + et(9, 30)
  const closed = [...yday(tf), { t: et(9, 0), ...px(et(9, 0)) }, ...rows(tf, et(9, 30), cur)]
  return {
    ticker: SYM, tf: String(tf), bars: closed, contract: 1, grid: 'eth-clock', session: 'rth', cache_key: `b1:${SYM}:${tf}:eth-clock`,
    series_rev: now, history_rev: 1, verified_through: now - 2, complete_through: cur, tail_status: 'verified',
    developing: { t: cur, ...px(cur), rev: now },
  }
}

/** A store whose device holds `byTf[tf]` ({rows, through, formingT}) and whose server answers on `answerAll()`. */
function world(byTf) {
  const pending = []
  const request = vi.fn((url) => new Promise((resolve) => pending.push({ url, resolve })))
  const hit = (t) => { const c = byTf[t]; return c ? { rows: c.rows, through: c.through, savedAt: c.through * 1000, formingT: c.formingT ?? null } : null }
  const device = { peek: vi.fn((s, t) => (s === SYM ? hit(t) : null)), read: vi.fn(async (s, t) => (s === SYM ? hit(t) : null)) }
  const store = createBarStore({
    request, device, history: null, candle: fakeCandle(), prices: fakePrices(), pushEnabled: () => false,
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), io: NO_IO,
  })
  S.store = store
  const answerAll = () => {
    for (const r of pending.splice(0)) r.resolve(answerFor(Number(/[?&]tf=(\w+)/.exec(r.url)?.[1])))
  }
  return { store, device, request, answerAll }
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
async function mount(p) {
  const h = renderHook((pp) => useBarSnapshotBars(pp), { initialProps: p })
  await act(async () => { await vi.advanceTimersByTimeAsync(5) })
  h.rerender(p)
  return h
}
async function answered(w, h, p) {
  await act(async () => { w.answerAll(); await vi.advanceTimersByTimeAsync(50) })
  h.rerender(p)
}
const K = (tf) => keyOf({ sym: SYM, tf: String(tf) })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { S.store?.dispose(); vi.useRealTimers() })

describe('P3-M2 the chart\'s first mount and timeframe change consult the device refusal', () => {
  it('FM1 a first mount on a 5m copy whose bucket just rolled (10:05:05, short its 10:04 minute): loading, then the answer', async () => {
    vi.setSystemTime(et(10, 5, 5) * 1000)
    const SHORT = { t: et(10, 0), ...px(et(10, 0)), c: 51.9 }
    const w = world({ 5: { rows: [...yday(5), ...rows(5, et(9, 30), et(10, 0)), SHORT], through: et(10, 4), formingT: et(10, 0) } })
    const p = params()
    const h = await mount(p)
    expect(w.store.peek(K(5)).source).toBe('device')                 // the copy is held...
    expect(h.result.current.bars).toBeNull()                           // ...and not painted
    await answered(w, h, p)
    expect(h.result.current.bars?.length).toBeGreaterThan(0)
    expect(w.store.peek(K(5)).restSeen).toBe(true)
  })

  it('FM2 a first mount on an EXTENDED view of the shared 5m key onto a fresh device copy: loading, then the answer', async () => {
    vi.setSystemTime(et(10, 7, 30) * 1000)
    const w = world({ 5: { rows: [...yday(5), ...rows(5, et(9, 30), et(10, 5)), { t: et(10, 5), ...px(et(10, 5)) }], through: et(10, 7), formingT: et(10, 5) } })
    const p = params({ showExtended: true })
    const h = await mount(p)
    expect(w.store.peek(K(5)).source).toBe('device')
    expect(h.result.current.bars).toBeNull()
    await answered(w, h, p)
    expect(h.result.current.bars?.some((b) => b.t === et(9, 0))).toBe(true)   // the answer, with today's pre-market bar
  })

  it('FM3 a first mount on a 1m copy that lacks the minute that just closed: loading, then the answer', async () => {
    vi.setSystemTime(et(10, 5, 5) * 1000)
    const w = world({ 1: { rows: [...yday(1), ...rows(1, et(9, 30), et(10, 4))], through: et(10, 4) } })
    const p = params({ resolvedTf: '1', _barsTf: '1', activeTfRef: { current: '1' } })
    const h = await mount(p)
    expect(w.store.peek(K(1)).source).toBe('device')
    expect(h.result.current.bars).toBeNull()
    await answered(w, h, p)
    expect(h.result.current.bars?.length).toBeGreaterThan(0)
  })

  it('FM4 a chart already showing the device copy is not blanked when the copy later reads refused', async () => {
    vi.setSystemTime(et(10, 4, 30) * 1000)
    const FORMING = { t: et(10, 0), ...px(et(10, 0)) }
    const w = world({ 5: { rows: [...yday(5), ...rows(5, et(9, 30), et(10, 0)), FORMING], through: et(10, 4), formingT: et(10, 0) } })
    const p = params()
    const h = await mount(p)
    const shown = h.result.current.bars
    expect(shown?.length).toBeGreaterThan(0)                           // fresh at 10:04:30: painted
    vi.setSystemTime(et(10, 5, 5) * 1000)                              // the 10:00 bucket ends; no answer yet
    await act(async () => { await vi.advanceTimersByTimeAsync(5) })
    h.rerender(p)
    expect(h.result.current.bars?.length).toBe(shown.length)           // still on screen
    expect(w.store.peek(K(5)).restSeen).toBe(false)
  })

  it('FM5 ...but a chart that showed the device copy on the REGULAR view, switched to the EXTENDED view of the same key: not that copy', async () => {
    vi.setSystemTime(et(10, 7, 30) * 1000)
    const w = world({ 5: { rows: [...yday(5), ...rows(5, et(9, 30), et(10, 5)), { t: et(10, 5), ...px(et(10, 5)) }], through: et(10, 7), formingT: et(10, 5) } })
    let p = params()
    const h = await mount(p)
    expect(h.result.current.bars?.length).toBeGreaterThan(0)           // the regular view paints the device copy
    const sent = w.request.mock.calls.length
    p = { ...p, showExtended: true }                                    // the member turns extended hours on: same key
    h.rerender(p)
    expect(h.result.current.bars).toBeNull()                           // no pre-market bars in it: not shown
    // the session change re-subscribes the key: the regular-session request is dropped and an extended one goes out
    await act(async () => { await vi.advanceTimersByTimeAsync(5) })
    h.rerender(p)
    expect(w.request.mock.calls.length).toBeGreaterThan(sent)
    expect(h.result.current.bars).toBeNull()                           // still not shown while it is unanswered
    await answered(w, h, p)
    expect(h.result.current.bars?.some((b) => b.t === et(9, 0))).toBe(true)
  })

  it('TF1 a timeframe change on an EXTENDED view onto a fresh device copy holds the previous timeframe until answered', async () => {
    vi.setSystemTime(et(10, 7, 30) * 1000)
    const w = world({ 5: { rows: [...yday(5), ...rows(5, et(9, 30), et(10, 5)), { t: et(10, 5), ...px(et(10, 5)) }], through: et(10, 7), formingT: et(10, 5) } })
    let p = params({ resolvedTf: '15', _barsTf: '15', showExtended: true, activeTfRef: { current: '15' } })
    const h = await mount(p)
    await answered(w, h, p)                                            // 15m on screen, answered
    const on15 = h.result.current.bars
    expect(on15?.length).toBeGreaterThan(0)
    p._onScreenSrcRef.current = { sym: SYM, tf: '15', ext: true, bars: on15 }
    p = { ...p, resolvedTf: '5', _barsTf: '5' }                         // the member presses 5m
    h.rerender(p)
    await act(async () => { await vi.advanceTimersByTimeAsync(5) })
    h.rerender(p)
    expect(w.store.peek(K(5)).source).toBe('device')
    expect(h.result.current._tfSwitchHold).toBe(true)                  // the previous timeframe stays
    expect(h.result.current.bars).toBeNull()
    await answered(w, h, p)
    expect(h.result.current._tfSwitchHold).toBe(false)
    expect(h.result.current.bars?.some((b) => b.t === et(9, 0))).toBe(true)
  })
})
