// ⛔ (2026-11-20) What useBarSnapshotBars hands StockChart must not reach an OLD render of the hook. A
// function made in a render points at that render's V8 context, which holds `snap` (and through it the
// store's bars and their legacy copy); StockChart's closures hold what the hook returns, and every old
// StockChart render a closure chain kept alive reached its own old snapshot that way
// (StockChart.closureChains.test.jsx). So `_resolveDailyTodaySeed` and `mutate` are ONE function each for
// the hook's life, calling the newest implementation: the same identity across a symbol switch, and the
// call acts for the CURRENT symbol (never the one the function was first made under).
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { renderHook } from '@testing-library/react'
import { pinWallClock } from '../../testing/pinnedWallClock'
import { useBarSnapshotBars } from './useBarSnapshotBars'
import { getBarStore, _resetBarStoreForTests } from '../../data/barStore/index'
import { keyOf } from '../../data/barStore/types'
import { memClear } from '../../utils/barsMemCache'

const clock = pinWallClock('2026-09-22T17:17:00Z')
afterAll(() => clock.restore())

beforeEach(() => {
  _resetBarStoreForTests()
  memClear()
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

function params(over = {}) {
  const ref = (v = null) => ({ current: v })
  return {
    sym: 'SIMX', resolvedTf: 'D', _barsTf: 'D', _econId: null, showExtended: false, isIntraday: false,
    breadthSeries: false, replayCutoff: null, compareSymbol: null, backgroundWarm: false, deepWarm: false,
    barsOverride: null, barsOverridePending: false, _liveSane: () => true, _gridQ: '', instFetcher: vi.fn(),
    _pinnedFull: false, _overlayActive: false, barCount: 600, _intradayDeepArmed: false,
    _setIntradayDeepArmed: () => {}, axisWidthRatchetRef: ref(0), barsMutateRef: ref(), _timingIdRef: ref(),
    activeTfRef: ref('D'), _onScreenSrcRef: ref(), tfSwitchHoldRef: ref(false), provisionalStaleRef: ref(false),
    _developingBarISO: () => null, _effLivePrice: () => null,
    _intradayDeepBackfillEnabled: () => false, _intradaySmoothSwitchEnabled: () => false,
    ...over,
  }
}

describe('useBarSnapshotBars returns stable functions that act for the current symbol', () => {
  it('mutate and _resolveDailyTodaySeed keep one identity across a symbol switch; mutate kicks the new key', () => {
    const store = getBarStore()
    const kick = vi.spyOn(store.network, 'kick')
    const live = vi.fn(() => 101.5)
    const { result, rerender } = renderHook((p) => useBarSnapshotBars(p), { initialProps: params({ sym: 'AAA', _effLivePrice: live }) })
    const first = { mutate: result.current.mutate, seed: result.current._resolveDailyTodaySeed }
    rerender(params({ sym: 'BBB', _effLivePrice: live }))
    expect(result.current.mutate).toBe(first.mutate)
    expect(result.current._resolveDailyTodaySeed).toBe(first.seed)
    kick.mockClear()
    first.mutate()
    expect(kick).toHaveBeenCalledWith(keyOf({ sym: 'BBB', tf: 'D' }))
    expect(kick).not.toHaveBeenCalledWith(keyOf({ sym: 'AAA', tf: 'D' }))
  })
})
