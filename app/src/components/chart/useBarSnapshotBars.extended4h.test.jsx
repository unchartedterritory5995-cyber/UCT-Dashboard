// ⭐ THE CHART'S OWN 4h BARS IN THE EXTENDED VIEW START AT 04:00 ET (TradingView's extended 4h grid, Fred RS captures
// runs/fred-4h-2026-11-24: 04:00 / 08:00 / 12:00 / 16:00 ET only). The store path builds a custom timeframe from its
// native base key (60m on the view's session: the clock grid when extended) and resamples it at the view's session
// start. Before: 01:30 / 05:30 / 09:30 / 13:30 / 17:30. The regular view is unchanged (09:30, 13:30) until TradingView's
// regular 4h is captured.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { pinWallClock } from '../../testing/pinnedWallClock'
import { useBarSnapshotBars } from './useBarSnapshotBars'
import { getBarStore, _resetBarStoreForTests } from '../../data/barStore/index'
import { keyOf } from '../../data/barStore/types'
import { memClear } from '../../utils/barsMemCache'

const clock = pinWallClock('2026-09-22T17:17:00Z')   // 13:17 EDT
afterAll(() => clock.restore())
const et = (h, m) => Math.floor(Date.UTC(2026, 8, 22, h + 4, m) / 1000)
const row = (t, k) => ({ t, o: k, h: k + 0.5, l: k - 0.5, c: k + 0.25, v: 1 })

beforeEach(() => {
  _resetBarStoreForTests()
  memClear()
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

function params(over = {}) {
  const ref = (v = null) => ({ current: v })
  return {
    sym: 'SIMX', resolvedTf: '240', _barsTf: '240', _econId: null, showExtended: true, isIntraday: false,
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

const answer = (session, rows) => act(() => {
  const st = getBarStore()
  const K = keyOf({ sym: 'SIMX', tf: '60', session })
  st.registry.dispatch(K, { key: K, gen: st.getSnapshot(K).gen, type: 'rest-full', payload: { ticker: 'SIMX', tf: '60', bars: rows } })
})

describe('the chart\'s own 4h bars (store path)', () => {
  it('extended: the clock-grid hours 04:00..13:00 make the 04:00, 08:00 and (forming) 12:00 bars', () => {
    const { result } = renderHook(() => useBarSnapshotBars(params()))
    answer('eth', Array.from({ length: 10 }, (_, k) => row(et(4 + k, 0), k)))
    const bars = result.current.bars
    expect(bars.map((b) => b.t)).toEqual([et(4, 0), et(8, 0), et(12, 0)])   // before: 01:30, 05:30, 09:30
  })

  it('CONTROL regular: the session-grid hours 09:30..12:30 make the 09:30 bar, as before', () => {
    const { result } = renderHook(() => useBarSnapshotBars(params({ showExtended: false })))
    answer('rth', Array.from({ length: 4 }, (_, k) => row(et(9 + k, 30), k)))
    expect(result.current.bars.map((b) => b.t)).toEqual([et(9, 30)])
  })

  // (review of #2753) an EXT toggle replaces the series wholesale: no bar left at the other view's times, so every indicator
  // and script reading these bars recomputes on the new buckets (nothing stays at an old 05:30 / 09:30 time)
  it("TOGGLE regular -> extended -> regular: every bar on the view's own grid, none left at the other's times", () => {
    const regTimes = new Set([et(9, 30), et(13, 30)])
    const extTimes = new Set([et(4, 0), et(8, 0), et(12, 0)])
    const { result, rerender } = renderHook(({ ext }) => useBarSnapshotBars(params({ showExtended: ext })), { initialProps: { ext: false } })
    answer('rth', Array.from({ length: 4 }, (_, k) => row(et(9 + k, 30), k)))
    answer('eth', Array.from({ length: 10 }, (_, k) => row(et(4 + k, 0), k)))
    expect(result.current.bars.map((b) => b.t)).toEqual([et(9, 30)])
    rerender({ ext: true })
    expect(result.current.bars.map((b) => b.t)).toEqual([et(4, 0), et(8, 0), et(12, 0)])
    expect(result.current.bars.some((b) => regTimes.has(b.t))).toBe(false)
    rerender({ ext: false })
    expect(result.current.bars.map((b) => b.t)).toEqual([et(9, 30)])
    expect(result.current.bars.some((b) => extTimes.has(b.t))).toBe(false)
  })
})
