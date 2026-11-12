// P3-S2 — the developing-bar channel of chart/useBarSnapshotBars.js: what the store's paint gets.
//
// Contracts, stated generally (synthetic prices only):
//   • review fix (a): a developing state that changed while a BASE change was still waiting for its
//     render is never lost — the render of that base takes the store's newest developing bar of the
//     same base (baseRev), and paints it, even when no further tick ever arrives;
//   • no frame paints an OLDER developing state after a newer one (devRev never goes back at the
//     paint), and after everything settles the bar handed to the paint IS the store's newest;
//   • a custom timeframe's developing bar equals the last bucket of the base path's own resample
//     (resampleForSpec over sealed + developing), for any developing value.
//
// The base render is DEFERRED by holding the snapshot `useBarSnapshot` returns (the mock below):
// the store moves on, the hook keeps rendering the held base until the test releases it.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { pinWallClock } from '../../testing/pinnedWallClock'
import { getBarStore, _resetBarStoreForTests } from '../../data/barStore/index'
import { keyOf } from '../../data/barStore/types'
import { legacyBars } from '../../data/barStore/adapter'
import { memClear } from '../../utils/barsMemCache'
import { resampleForSpec } from '../../utils/resampleBars'
import { resampleSpec } from './timeframes'

const H = vi.hoisted(() => ({ held: null }))
vi.mock('../../data/barStore/useBarSnapshot', () => ({
  // The chart's base snapshot: the store's base view, unless the test HOLDS an older one
  // (a base change whose render has not happened yet).
  useBarSnapshot: (key, o) => (H.held ?? (key ? o.store.getBaseSnapshot(key) : null)),
}))
const { useBarSnapshotBars, viewDevelopingOf } = await import('./useBarSnapshotBars')

// Tue 2026-09-22 13:17 ET (EDT) — mid-session.
const clock = pinWallClock('2026-09-22T17:17:00Z')
afterAll(() => clock.restore())
const et = (h, m) => Math.floor(Date.UTC(2026, 8, 22, h + 4, m) / 1000)
const b = (t, c = 10.5) => ({ t, o: 10, h: 11, l: 9, c, v: 100 })
const fiveMin = (fromH, fromM, toH, toM) => {
  const out = []
  for (let t = et(fromH, fromM); t <= et(toH, toM); t += 300) out.push(b(t))
  return out
}
const K = keyOf({ sym: 'SIMX', tf: '5' })
const frame = () => act(() => new Promise((r) => setTimeout(r, 40)))   // one dev-channel flush
const dispatch = (action) => {
  const st = getBarStore()
  st.registry.dispatch(K, { key: K, gen: st.getSnapshot(K).gen, ...action })
}
const push = (tMin, { h, l, c, v }, rev) => dispatch({
  type: 'push-bar', event: { sym: 'SIMX', bar: { t: tMin * 1000, o: 10, h, l, c, v }, rev },
})

function params(over = {}) {
  const ref = (v = null) => ({ current: v })
  return {
    sym: 'SIMX', resolvedTf: '5', _barsTf: '5', _econId: null, showExtended: false, isIntraday: true,
    breadthSeries: false, replayCutoff: null, compareSymbol: null, backgroundWarm: false, deepWarm: false,
    barsOverride: null, barsOverridePending: false, _liveSane: () => true, _gridQ: '', instFetcher: vi.fn(),
    _pinnedFull: false, _overlayActive: false, barCount: 600, _intradayDeepArmed: false,
    _setIntradayDeepArmed: () => {}, axisWidthRatchetRef: ref(0), barsMutateRef: ref(), _timingIdRef: ref(),
    activeTfRef: ref('5'), _onScreenSrcRef: ref(), tfSwitchHoldRef: ref(false), provisionalStaleRef: ref(false),
    _developingBarISO: () => null, _effLivePrice: () => null,
    _intradayDeepBackfillEnabled: () => false, _intradaySmoothSwitchEnabled: () => false,
    ...over,
  }
}

beforeEach(() => {
  _resetBarStoreForTests()
  memClear()
  H.held = null
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

describe('review fix (a): a developing state that lands before its base renders is painted', () => {
  it('flush dropped (base pending) → the deferred render takes the newest developing bar and paints it', async () => {
    const painted = []
    const devRef = { current: null }
    const paintRef = { current: vi.fn(() => painted.push(devRef.current)) }
    const p = params({ _storeDevRef: devRef, _storeDevPaintRef: paintRef })
    dispatch({ type: 'rest-full', payload: { ticker: 'SIMX', tf: '5', bars: fiveMin(9, 30, 13, 15) } })
    const { rerender } = renderHook(() => useBarSnapshotBars(p))
    expect(devRef.current).toMatchObject({ t: et(13, 15) })

    // The render is deferred from here: the hook keeps the base it last rendered.
    H.held = getBarStore().getBaseSnapshot(K)
    const t0 = Date.now()
    push(et(13, 20), { h: 10.2, l: 10.1, c: 10.15, v: 5 }, t0 + 1)        // a NEW bucket: base change
    push(et(13, 20), { h: 10.9, l: 9.8, c: 10.7, v: 40 }, t0 + 2)         // same bucket: developing only
    await frame()
    // Non-vacuity: the channel's flush was for a base this hook has not rendered → left to the render.
    expect(devRef.current.t).toBe(et(13, 15))
    const live = getBarStore().getSnapshot(K)
    const base = getBarStore().getBaseSnapshot(K)
    expect(base.baseRev).toBe(live.baseRev)
    expect(base.developing.c, 'the base view holds the OLDER developing state').toBe(10.15)
    expect(live.developing.c).toBe(10.7)

    // The base change's render finally happens — and no further tick ever comes.
    H.held = null
    const before = painted.length
    rerender()
    expect(devRef.current).toMatchObject({ t: et(13, 20), h: 10.9, l: 9.8, c: 10.7, v: 40 })
    expect(painted.length - before, 'the render paints it (no setData needed)').toBeGreaterThanOrEqual(1)
    expect(painted[painted.length - 1]).toMatchObject({ t: et(13, 20), c: 10.7 })
  })

  // INVARIANT (fuzz): over random interleavings of base changes, developing-only changes, channel
  // flushes and (deferred) renders, the bar handed to the paint never goes back (devRev), and once
  // everything has rendered and flushed it equals the store's newest developing bar.
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i: never an older developing state after a newer; settles on the newest', async (seed) => {
    let s = seed * 9301 + 49297
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
    const devRef = { current: null }
    const revs = []
    const paintRef = { current: vi.fn(() => { if (devRef.current) revs.push(devRef.current.devRev) }) }
    const p = params({ _storeDevRef: devRef, _storeDevPaintRef: paintRef })
    dispatch({ type: 'rest-full', payload: { ticker: 'SIMX', tf: '5', bars: fiveMin(9, 30, 13, 15) } })
    const { rerender } = renderHook(() => useBarSnapshotBars(p))
    let bucket = et(13, 15), hi = 11, lo = 9, c = 10.5, v = 100, rev = Date.now()
    for (let i = 0; i < 60; i++) {
      const r = rnd()
      if (r < 0.15) {
        bucket += 300; hi = lo = c; v = 1                                   // bucket roll (base change)
        push(bucket, { h: hi, l: lo, c, v }, ++rev)
      } else if (r < 0.7) {
        c = Math.round((c + (rnd() - 0.5) * 0.3) * 100) / 100
        hi = Math.max(hi, c); lo = Math.min(lo, c); v += 1 + Math.floor(rnd() * 9)
        push(bucket, { h: hi, l: lo, c, v }, ++rev)                        // developing only
      } else if (r < 0.8) {
        H.held = getBarStore().getBaseSnapshot(K)                          // defer renders
      } else if (r < 0.9) {
        H.held = null; rerender()                                          // the deferred render lands
      } else {
        await frame()                                                      // a channel flush
      }
    }
    H.held = null
    rerender()
    await frame()
    for (let i = 1; i < revs.length; i++) expect(revs[i], `paint #${i}`).toBeGreaterThanOrEqual(revs[i - 1])
    const newest = getBarStore().getSnapshot(K)
    expect(devRef.current).toMatchObject({
      t: newest.developing.t, o: newest.developing.o, h: newest.developing.h,
      l: newest.developing.l, c: newest.developing.c, v: newest.developing.v, devRev: newest.devRev,
    })
  })
})

describe('viewDevelopingOf — the developing bar a VIEW paints', () => {
  it('frozen view or no server answer → null', () => {
    dispatch({ type: 'rest-full', payload: { ticker: 'SIMX', tf: '5', bars: fiveMin(9, 30, 13, 15) } })
    const snap = getBarStore().getSnapshot(K)
    expect(viewDevelopingOf(snap, snap, {})).toMatchObject({ t: et(13, 15) })
    expect(viewDevelopingOf(snap, snap, { frozen: true })).toBeNull()
    expect(viewDevelopingOf({ ...snap, restSeen: false }, snap, {})).toBeNull()
    // P3-S2b: a live gap (the store's liveGapFrom) — a detached developing bar is never painted
    expect(viewDevelopingOf({ ...snap, liveGapFrom: et(13, 5) }, snap, {})).toBeNull()
  })

  // INVARIANT: a custom tf's developing bar = the last bucket of resampleForSpec(sealed + developing)
  // — the same bars the base path paints — for any developing value (open-once, H/L union, V sum).
  it.each(['10', '20', '45'].flatMap((code) => [1, 2, 3].map((seed) => [code, seed])))(
    'custom %s (seed %i): equals the base path resample of the forming bucket', (code, seed) => {
      const spec = resampleSpec(code)
      const base = spec.base
      const k = keyOf({ sym: 'SIMX', tf: base })
      const step = Number(base) * 60
      let s = seed
      const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
      const rows = []
      for (let t = et(9, 30); t <= et(13, 15); t += step) {
        const o = 10 + rnd(), c = 10 + rnd()
        rows.push({ t, o, h: Math.max(o, c) + rnd() * 0.2, l: Math.min(o, c) - rnd() * 0.2, c, v: 50 + Math.floor(rnd() * 50) })
      }
      const st = getBarStore()
      st.registry.dispatch(k, { key: k, gen: st.getSnapshot(k).gen, type: 'rest-full', payload: { ticker: 'SIMX', tf: base, bars: rows } })
      const snap = st.getSnapshot(k)
      if (!snap.developing) return   // this base's grid has no forming bucket at 13:17 — nothing to compare
      const got = viewDevelopingOf(snap, snap, { spec })
      const all = resampleForSpec(legacyBars(snap), spec)
      const want = all[all.length - 1]
      expect(got).toMatchObject({ t: want.t, o: want.o, h: want.h, l: want.l, c: want.c, v: want.v })
    })
})
