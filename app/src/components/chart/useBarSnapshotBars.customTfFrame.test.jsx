// ⭐ A CUSTOM TIMEFRAME CHART'S BARS ARE THE FILED RESAMPLE (2026-11-27, key-task budget). The store path builds a 4h
// chart from its 60m base key; its bars are now `customTfRows.deriveCustomTf(base rows, spec)`, the ONE array the idle
// preparer of the next row also asks for (useNeighborFrames.prepareRow), so every array the chart derives from them is
// found on the press. Before: a `useMemo` over `resampleForSpec`, a new array per switch that no prepared value matched.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { pinWallClock } from '../../testing/pinnedWallClock'
import { useBarSnapshotBars } from './useBarSnapshotBars'
import { getBarStore, _resetBarStoreForTests } from '../../data/barStore/index'
import { keyOf } from '../../data/barStore/types'
import { legacyBars } from '../../data/barStore/adapter'
import { memClear } from '../../utils/barsMemCache'
import { resampleForSpec } from '../../utils/resampleBars'
import { deriveCustomTf, customSpecOf } from './customTfRows'
import * as nf from './neighborFrames'

const clock = pinWallClock('2026-09-22T17:17:00Z')   // 13:17 EDT
afterAll(() => clock.restore())
const et = (h, m) => Math.floor(Date.UTC(2026, 8, 22, h + 4, m) / 1000)
const row = (t, k) => ({ t, o: k, h: k + 0.5, l: k - 0.5, c: k + 0.25, v: 1 })

beforeEach(() => {
  _resetBarStoreForTests()
  memClear()
  nf.__resetDerivedForTests()
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})
afterEach(() => nf.__setNeighborFramesForTests(null))

function params(over = {}) {
  const ref = (v = null) => ({ current: v })
  return {
    sym: 'SIMX', resolvedTf: '240', _barsTf: '240', _econId: null, showExtended: false, isIntraday: false,
    breadthSeries: false, replayCutoff: null, compareSymbol: null, backgroundWarm: false, deepWarm: false,
    barsOverride: null, barsOverridePending: false, _liveSane: () => true, _gridQ: '', instFetcher: vi.fn(),
    _pinnedFull: false, _overlayActive: false, barCount: 600, _intradayDeepArmed: false,
    _setIntradayDeepArmed: () => {}, axisWidthRatchetRef: ref(0), barsMutateRef: ref(), _timingIdRef: ref(),
    activeTfRef: ref('240'), _onScreenSrcRef: ref(), tfSwitchHoldRef: ref(false), provisionalStaleRef: ref(false),
    _developingBarISO: () => null, _effLivePrice: () => null,
    _intradayDeepBackfillEnabled: () => false, _intradaySmoothSwitchEnabled: () => false,
    ...over,
  }
}
const K = keyOf({ sym: 'SIMX', tf: '60', session: 'rth' })
const answer = (rows) => act(() => {
  const st = getBarStore()
  st.registry.dispatch(K, { key: K, gen: st.getSnapshot(K).gen, type: 'rest-full', payload: { ticker: 'SIMX', tf: '60', bars: rows } })
})
const rows = () => Array.from({ length: 4 }, (_, k) => row(et(9 + k, 30), k))

describe("a custom timeframe chart's bars (store path)", () => {
  it('neighbour frames on: the bars ARE the filed resample of the base rows (the array a preparer asks for)', () => {
    nf.__setNeighborFramesForTests(true)
    const { result } = renderHook(() => useBarSnapshotBars(params()))
    answer(rows())
    const all = legacyBars(getBarStore().getBaseSnapshot(K))
    const bars = result.current.bars
    expect(bars.map((b) => b.t)).toEqual([et(9, 30)])
    expect(bars).toBe(deriveCustomTf(all, customSpecOf('240', false)))
  })

  it('two charts on the same symbol and custom timeframe hold one array', () => {
    nf.__setNeighborFramesForTests(true)
    const a = renderHook(() => useBarSnapshotBars(params()))
    const b = renderHook(() => useBarSnapshotBars(params()))
    answer(rows())
    expect(a.result.current.bars).toBe(b.result.current.bars)
  })

  it('CONTROL neighbour frames off: the same numbers, resampled as before', () => {
    nf.__setNeighborFramesForTests(false)
    const { result } = renderHook(() => useBarSnapshotBars(params()))
    answer(rows())
    const all = legacyBars(getBarStore().getBaseSnapshot(K))
    expect(result.current.bars).toEqual(resampleForSpec(all, customSpecOf('240', false)))
    expect(nf.hasDerived(all, 'customTf', nf.stableSig(customSpecOf('240', false)))).toBe(false)
  })
})
