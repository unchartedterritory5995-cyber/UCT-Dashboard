// THE MEMBER ON THE DEFAULT (no stored key), review of #2565 against #2563. #2563 runs the per-switch diagnostics only on a
// tester's page (diag.deviceDiagOn: 'uct.deviceStore.diag' = '1', or the store switched on BY HAND). Those diagnostics ask
// the device rule (prefetch.deviceVerdict), and the rule's re-read of a refused 'stale' copy is the one that asks the device
// for a NEWER copy than the 20 s recently-read cache holds (P4-L2). So on a tester's page a switch to a key whose held copy
// went stale at a minute boundary found the device's newer copy at once; a member on the default, with no diagnostics,
// waited for the server's answer instead. The switch's own look at the key (prefetch.peekDisplayable, its route and its
// every wake) now asks for the newer copy itself.
// Through the real switch (useSymbolHandoff), the real chart rule (useBarSnapshotBars), the real store and facade, the
// REAL device switch (switch.js: no stored key, its default made ON through its test seam; DEVICE_STORE_DEFAULT_ON is
// untouched) and the REAL device client over a worker that answers with the copy it holds now:
//   K0 the precondition: the store is on by default, no key is stored, and the diagnostics are OFF
//   K1 B's held copy went stale at the 10:05 boundary and the worker has applied the 10:04 minute: the switch re-reads it
//      NEWER before the chart is shown, and B paints from the device copy when its panes are ready, with no server
//      answer, never a blank frame
//   K2 ...the worker has NOT applied it yet: A stays, B's bars request leaves, and B is shown whole on its answer
//   K3 the 'now' route: B's copy is current at the press, the minute rolls in the columns wait and the worker has the
//      frame: the switch holds, re-reads newer, and shows B from the device copy (no blank, no answer needed)
import { render, act } from '@testing-library/react'
import { useLayoutEffect, useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const S = vi.hoisted(() => ({ store: null, colsMs: 300, colsAt: new Map(), calls: () => [] }))
vi.mock('../components/chart/barStoreSwitch', async (orig) => ({ ...(await orig()), BARSTORE: true }))
vi.mock('../data/deviceStore/source', async (orig) => ({ ...(await orig()), deviceSource: () => null }))
vi.mock('../data/barStore/index', async (orig) => ({ ...(await orig()), getBarStore: () => S.store }))
// the panes' server columns: asked at the press (warmColumnsFor), landed COLUMNS_WAIT_MS later; ready from then on
vi.mock('../components/chart/engine/serverCompute', async (orig) => ({
  ...(await orig()),
  warmColumnsFor: (sym, tf) => { const k = `${sym}|${tf}`; if (!S.colsAt.has(k)) S.colsAt.set(k, Date.now() + S.colsMs) },
  columnsReadyFor: (sym, tf) => { const at = S.colsAt.get(`${sym}|${tf}`); return at != null && Date.now() >= at },
  whenColumnsReady: (sym, tf) => {
    const at = S.colsAt.get(`${sym}|${tf}`) ?? Date.now() + S.colsMs
    return new Promise((resolve) => setTimeout(() => resolve(true), Math.max(0, at - Date.now())))
  },
}))

// THE DEFAULT, BEFORE ANYTHING READS THE SWITCH: no key stored, the default ON (the switch's own test seam)
const SW = await import('../data/deviceStore/switch')
try { localStorage.removeItem(SW.DEVICE_STORE_KEY); localStorage.removeItem('uct.deviceStore.diag') } catch { /* jsdom has it */ }
SW.__setDeviceStoreDefaultForTests(true)
SW.__resetDeviceStoreSwitchForTests()
const { deviceDiagOn } = await import('../data/deviceStore/diag')
const { createBarStore } = await import('../data/barStore/index')
const PF = await import('../data/barStore/prefetch')
const { keyOf } = await import('../data/barStore/types')
const { fakeCandle, fakePrices } = await import('../data/barStore/testing/fakeFeeds')
const { createDeviceClient } = await import('../data/deviceStore/client')
const { createDeviceSource } = await import('../data/deviceStore/source')
const { useBarSnapshotBars } = await import('../components/chart/useBarSnapshotBars')
const useSymbolHandoff = (await import('./useSymbolHandoff')).default
const { __resetHandoffGroupsForTests } = await import('./handoffGroups')

const DAY = 86400
const etMs = (hh, mm, ss = 0, ms = 0) => Date.UTC(2026, 10, 18, hh + 5, mm, ss, ms)   // Wed 2026-11-18 (EST)
const et = (hh, mm, ss = 0) => etMs(hh, mm, ss) / 1000
const px = (t) => { const i = (t / 60) % 31; const o = 50 + i / 8; return { o, h: o + 0.4, l: o - 0.4, c: o + 0.1, v: 100 + i } }
function rows(tf, from, upto) {
  const out = []
  for (let t = from; t + tf * 60 <= upto; t += tf * 60) out.push({ t, ...px(t) })
  return out
}
const yday = (tf) => rows(tf, et(9, 30) - DAY, et(16, 0) - DAY)
/** The worker's 1m columns for a copy complete through `through` (yesterday and today's closed minutes). */
function cols(through) {
  const r = [...yday(1), ...rows(1, et(9, 30), through)]
  const f = (k) => Float64Array.from(r, (b) => b[k])
  return { t: f('t'), o: f('o'), h: f('h'), l: f('l'), c: f('c'), v: f('v'), build: '20261118T0000Z', through }
}
/** A worker that answers each read, a moment later, with the copy it holds at that moment (`state[sym]`). */
function liveWorker(state) {
  const w = { onmessage: null, onerror: null, terminate: () => {}, reads: [] }
  w.postMessage = (m) => {
    if (m.op !== 'read') return
    w.reads.push(m.sym)
    Promise.resolve().then(() => w.onmessage({ data: { id: m.id, ok: true, res: m.tf === '1' ? (state[m.sym] ?? null) : null } }))
  }
  return w
}

const NO_IO = {
  memPeekEntry: () => null, idbGet: async () => null, idbGetHistoryEntry: async () => null,
  memPutMonotonic: () => {}, idbPutMonotonic: async () => {}, idbPutHistory: async () => {},
}
function answerFor(sym, tf) {
  const now = Math.floor(Date.now() / 1000)
  const cur = Math.floor((now - et(9, 30)) / (tf * 60)) * tf * 60 + et(9, 30)
  return {
    ticker: sym, tf: String(tf), bars: [...yday(tf), ...rows(tf, et(9, 30), cur)], contract: 1, grid: 'eth-clock', session: 'rth',
    cache_key: `b1:${sym}:${tf}:eth-clock`, series_rev: now, history_rev: 1, verified_through: now - 2, complete_through: cur,
    tail_status: 'verified', developing: { t: cur, ...px(cur), rev: now },
  }
}
const symOf = (url) => decodeURIComponent(/\/api\/bars\/([^?]+)/.exec(url)?.[1] || '')
const tfOf = (url) => Number(/[?&]tf=(\w+)/.exec(url)?.[1])

function world(state) {
  const pending = []
  const request = vi.fn((url) => new Promise((resolve) => pending.push({ url, resolve })))
  const worker = liveWorker(state)
  const client = createDeviceClient({ makeWorker: () => worker, afterPaint: () => {} })
  const device = createDeviceSource({ load: async () => client, current: () => client })
  const store = createBarStore({
    request, device, history: null, candle: fakeCandle(), prices: fakePrices(), pushEnabled: () => false,
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), io: NO_IO,
  })
  S.store = store
  S.calls = () => request.mock.calls.map((c) => c[0])
  const answer = (sym) => {
    const keep = []
    for (const r of pending.splice(0)) {
      if (sym && symOf(r.url) !== sym) { keep.push(r); continue }
      r.resolve(answerFor(symOf(r.url), tfOf(r.url)))
    }
    pending.push(...keep)
  }
  const asked = (sym) => request.mock.calls.filter((c) => symOf(c[0]) === sym).length
  return { store, worker, answer, asked }
}

const ref = (v = null) => ({ current: v })
const NOOP = () => {}
const NULLF = () => null
const FALSEF = () => false
const TRUEF = () => true
const INST = vi.fn()
function chartParams(sym, tf, refs) {
  return {
    sym, resolvedTf: tf, _barsTf: tf, _econId: null, showExtended: false, isIntraday: true,
    breadthSeries: false, replayCutoff: null, compareSymbol: null, backgroundWarm: false, deepWarm: false,
    barsOverride: null, barsOverridePending: false, _liveSane: TRUEF, _gridQ: '', instFetcher: INST,
    _pinnedFull: false, _overlayActive: false, barCount: 600, _intradayDeepArmed: false,
    _setIntradayDeepArmed: NOOP, _developingBarISO: NULLF, _effLivePrice: NULLF,
    _intradayDeepBackfillEnabled: FALSEF, _intradaySmoothSwitchEnabled: FALSEF,
    ...refs,
  }
}
function Chart({ sym, tf, log }) {
  const shown = useSymbolHandoff(sym, tf, { showExtended: false })
  const refs = useRef(null)
  if (!refs.current) {
    refs.current = {
      axisWidthRatchetRef: ref(0), barsMutateRef: ref(), _timingIdRef: ref(), activeTfRef: ref(tf), _onScreenSrcRef: ref(),
      tfSwitchHoldRef: ref(false), provisionalStaleRef: ref(false), _storeDevRef: ref(), _storeDevPaintRef: ref(NOOP),
    }
  }
  const r = useBarSnapshotBars(chartParams(shown, tf, refs.current))
  const n = r.bars?.length ?? 0
  useLayoutEffect(() => { log.push({ at: Date.now(), shown, n, calls: S.calls() }) })
  return null
}
async function mountChart(w) {
  const log = []
  const h = render(<Chart sym="AAA" tf="1" log={log} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(5) })
  await act(async () => { w.answer('AAA'); await vi.advanceTimersByTimeAsync(50) })
  const press = (sym) => act(() => { h.rerender(<Chart sym={sym} tf="1" log={log} />) })
  return { log, press }
}
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const last = (log) => log[log.length - 1]
function blanks(log) {
  let painted = false
  const out = []
  for (const f of log) { if (f.n > 0) painted = true; else if (painted) out.push(f) }
  return out
}
const KB = keyOf({ sym: 'BBB', tf: '1' })

beforeEach(() => {
  vi.useFakeTimers()
  PF._resetPrefetchForTests()
  __resetHandoffGroupsForTests()
  S.colsMs = 300
  S.colsAt.clear()
})
afterEach(() => { S.store?.dispose(); vi.useRealTimers() })

describe('a member on the default (no key, no diagnostics): the switch re-reads a stale device copy newer itself', () => {
  it('K0 the store is on by default, no key is stored, and the diagnostics are off', () => {
    expect(localStorage.getItem(SW.DEVICE_STORE_KEY)).toBeNull()
    expect(SW.DEVICE_STORE_DEFAULT_ON).toBe(false)                  // (the constant is untouched: the seam says ON)
    expect(SW.deviceStoreEnabled()).toBe(true)
    expect(deviceDiagOn()).toBe(false)
  })

  it('K1 the minute\'s frame is in the worker: re-read newer before the chart is shown; B paints from it, no answer, no blank', async () => {
    vi.setSystemTime(etMs(10, 4, 40))
    const state = { BBB: cols(et(10, 4)) }                           // complete through 10:04:00
    const w = world(state)
    const { log, press } = await mountChart(w)
    vi.setSystemTime(etMs(10, 4, 58))
    await act(async () => { PF.deviceWarm('BBB', '1', { showExtended: false }); await vi.advanceTimersByTimeAsync(5) })
    expect(w.store.persist.deviceThroughOf(KB)).toBe(et(10, 4))      // B held, and in the client's 20 s cache
    vi.setSystemTime(etMs(10, 5, 3))
    state.BBB = cols(et(10, 5))                                      // the worker applies the 10:04 minute
    vi.setSystemTime(etMs(10, 5, 5))
    press('BBB')                                                     // B's held copy is short of the 10:05 bucket
    await advance(310)                                               // its panes' columns land at +300
    expect(w.store.persist.deviceThroughOf(KB)).toBe(et(10, 5))      // re-read NEWER, inside the cache's 20 s
    const first = log.find((f) => f.shown === 'BBB')
    expect(first).toBeTruthy()                                       // shown with no server answer
    expect(first.n).toBeGreaterThan(0)                               // ...from the device copy
    expect(first.at).toBeLessThanOrEqual(etMs(10, 5, 5, 310))
    expect(blanks(log)).toEqual([])
  })

  it('K2 the frame is not in the worker yet: A stays, B\'s request leaves, B is shown whole on its answer', async () => {
    vi.setSystemTime(etMs(10, 4, 40))
    const state = { BBB: cols(et(10, 4)) }
    const w = world(state)
    const { log, press } = await mountChart(w)
    vi.setSystemTime(etMs(10, 4, 58))
    await act(async () => { PF.deviceWarm('BBB', '1', { showExtended: false }); await vi.advanceTimersByTimeAsync(5) })
    vi.setSystemTime(etMs(10, 5, 5))
    press('BBB')
    await advance(310)
    expect(last(log).shown).toBe('AAA')
    expect(w.store.persist.deviceThroughOf(KB)).toBe(et(10, 4))      // nothing newer to find
    expect(w.asked('BBB')).toBeGreaterThan(0)
    await act(async () => { w.answer('BBB'); await vi.advanceTimersByTimeAsync(50) })
    expect(last(log).shown).toBe('BBB')
    expect(last(log).n).toBeGreaterThan(0)
    expect(blanks(log)).toEqual([])
  })

  it('K3 the \'now\' route, the minute rolls in the columns wait with the frame in the worker: held, re-read newer, B from the device', async () => {
    vi.setSystemTime(etMs(10, 4, 40))
    const state = { BBB: cols(et(10, 4)) }
    const w = world(state)
    const { log, press } = await mountChart(w)
    vi.setSystemTime(etMs(10, 4, 58))
    await act(async () => { PF.deviceWarm('BBB', '1', { showExtended: false }); await vi.advanceTimersByTimeAsync(5) })
    vi.setSystemTime(etMs(10, 4, 59, 800))
    press('BBB')                                                     // current at the press: the 'now' route
    await advance(250)                                               // 10:05:00.050: the worker applies the 10:04 minute
    state.BBB = cols(et(10, 5))
    await advance(60)                                                // 10:05:00.110: the columns landed at .100
    expect(last(log).shown).toBe('BBB')
    expect(last(log).n).toBeGreaterThan(0)
    expect(w.store.persist.deviceThroughOf(KB)).toBe(et(10, 5))
    expect(blanks(log)).toEqual([])
  })
})
