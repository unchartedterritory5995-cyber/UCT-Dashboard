// ⭐⭐ (2026-11-18) THE BARSTORE SOURCE CARRIES THE ROUTE'S `newest_bar_is_forming`, for the bar it describes.
// StockChart reads `data.newest_bar_is_forming` into every run's context (a strategy runs its newest bar only when
// it is KNOWN closed). The legacy source hands the route's payload as `data`, flag included; this source built
// `data` without it, so every chart on it told its runs "unknown" at every hour, and after the close a strategy
// read its closed newest bar as forming. Synthetic prices only.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { pinWallClock } from '../../testing/pinnedWallClock'
import { useBarSnapshotBars } from './useBarSnapshotBars'
import { getBarStore, _resetBarStoreForTests } from '../../data/barStore/index'
import { keyOf } from '../../data/barStore/types'
import { memClear } from '../../utils/barsMemCache'

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

beforeEach(() => {
  _resetBarStoreForTests()
  memClear()
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
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

const K = keyOf({ sym: 'SIMX', tf: '5' })
const dispatch = (action) => act(() => {
  const st = getBarStore()
  st.registry.dispatch(K, { key: K, gen: st.getSnapshot(K).gen, ...action })
})
const answer = (rows, extra = {}) => ({ type: 'rest-full', payload: { ticker: 'SIMX', tf: '5', bars: rows, ...extra } })

describe('useBarSnapshotBars — data.newest_bar_is_forming', () => {
  it('⭐ the route\'s tri-state reaches `data`, for the newest row: forming, then closed', () => {
    const { result } = renderHook(() => useBarSnapshotBars(params()))
    const rows = fiveMin(9, 30, 13, 15)
    dispatch(answer(rows, { newest_bar_is_forming: true }))
    expect(result.current.data.newest_bar_is_forming).toBe(true)
    // the next answer says the same newest bar has closed: it lands, a new `data` (the runs re-read it)
    const before = result.current.data
    dispatch(answer(rows, { newest_bar_is_forming: false }))
    expect(result.current.data.newest_bar_is_forming).toBe(false)
    expect(result.current.data).not.toBe(before)
  })

  it('an answer that states none keeps the last statement, which still names its own bar', () => {
    const { result } = renderHook(() => useBarSnapshotBars(params()))
    const rows = fiveMin(9, 30, 13, 15)
    dispatch(answer(rows, { newest_bar_is_forming: false }))
    dispatch(answer(rows))
    expect(result.current.data.newest_bar_is_forming).toBe(false)
  })

  it('⛔ a newer bar than the statement names (the live feed opened the next bucket): UNKNOWN, never the old answer', async () => {
    const { result } = renderHook(() => useBarSnapshotBars(params()))
    dispatch(answer(fiveMin(9, 30, 13, 10), { newest_bar_is_forming: false }))
    expect(result.current.data.newest_bar_is_forming).toBe(false)
    dispatch({ type: 'push-bar', event: { sym: 'SIMX', bar: { t: et(13, 15) * 1000, o: 10, h: 11, l: 9, c: 10.5, v: 50 }, rev: Date.now() } })
    await act(() => new Promise((r) => setTimeout(r, 40)))
    expect(result.current.bars[result.current.bars.length - 1].t).toBe(et(13, 15))
    expect(result.current.data.newest_bar_is_forming).toBeNull()
  })

  it('CONTROL: no statement at all is unknown (null), as the chart reads a payload without the field', () => {
    const { result } = renderHook(() => useBarSnapshotBars(params()))
    dispatch(answer(fiveMin(9, 30, 13, 15)))
    expect(result.current.data.newest_bar_is_forming).toBeNull()
  })
})
