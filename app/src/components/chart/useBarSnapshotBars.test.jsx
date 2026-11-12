// P3-S1 — chart/useBarSnapshotBars.js: what a BarStore snapshot may put on screen.
// Every legacy-selector rule it carries is stated here against the snapshot's STATUS (the one
// freshness contract, data/barStore/status.js), not against a cache layer. Synthetic prices only.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { pinWallClock } from '../../testing/pinnedWallClock'
import { useBarSnapshotBars, chartKeyFor } from './useBarSnapshotBars'
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
  memClear()   // persist writes server-backed snapshots to mem; a fresh store would hydrate them
  // The store's own request never answers here: every state is dispatched by the test.
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

describe('useBarSnapshotBars — status → frame (intraday)', () => {
  it('returns the 24-binding shape of useLegacyChartBars', () => {
    const { result } = renderHook(() => useBarSnapshotBars(params()))
    expect(Object.keys(result.current).sort()).toEqual([
      '_customBaseIntraday', '_hasOverride', '_histMutateRef', '_histPrependOn', '_idbBasisMismatch',
      '_intradayLike', '_isCustomTf', '_lastTailStatusRef', '_loadOlder', '_resolveDailyTodaySeed',
      '_staleContext', '_symU', '_tailCatchupRef', '_tfSwitchHold', 'bars', 'compareData', 'dailyRepairTodayRef',
      'data', 'error', 'idbBarsRef', 'idbReadyForRef', 'isValidating', 'mutate', 'paintSymRef',
    ])
  })

  it('empty → nothing; provisional → CONTEXT minus its last candle, live writers FROZEN', () => {
    const p = params()
    const { result } = renderHook(() => useBarSnapshotBars(p))
    expect(result.current.bars).toBeNull()
    // A local copy that stops at 10:00 (behind the 13:15 frontier).
    const local = fiveMin(9, 30, 10, 0)
    dispatch({ type: 'idb-hit', payload: { bars: local } })
    const r = result.current
    expect(r.bars).toHaveLength(local.length - 1)
    expect(r.bars).toBe(r._staleContext)
    expect(p.provisionalStaleRef.current).toBe(true)
    expect(r.data).toBeUndefined()                   // no server answer yet
  })

  it('a server answer that reaches the frontier paints the snapshot (developing included), writers live', () => {
    const p = params()
    const { result } = renderHook(() => useBarSnapshotBars(p))
    const rows = fiveMin(9, 30, 13, 15)               // 13:15 is forming at 13:17
    dispatch({ type: 'rest-full', payload: { ticker: 'SIMX', tf: '5', bars: rows } })
    const r = result.current
    expect(r.bars).toHaveLength(rows.length)
    expect(r.bars[r.bars.length - 1].t).toBe(et(13, 15))
    expect(p.provisionalStaleRef.current).toBe(false)
    expect(r._staleContext).toBeNull()
    // `data.developing` is THE developing bar Writer D re-tops from.
    expect(r.data.developing).toEqual({ t: et(13, 15), o: 10, h: 11, l: 9, c: 10.5, v: 100 })
    expect(r.data.ticker).toBe('SIMX')
  })

  it('a push frame moves the developing bar: same rows, new developing (Writer D input follows)', () => {
    const { result } = renderHook(() => useBarSnapshotBars(params()))
    dispatch({ type: 'rest-full', payload: { ticker: 'SIMX', tf: '5', bars: fiveMin(9, 30, 13, 15) } })
    dispatch({ type: 'push-bar', event: { sym: 'SIMX', bar: { t: et(13, 15) * 1000, o: 10, h: 11.6, l: 9, c: 11.4, v: 180 }, rev: Date.now() } })
    expect(result.current.data.developing).toMatchObject({ t: et(13, 15), o: 10, h: 11.6, c: 11.4 })
    expect(result.current.bars[result.current.bars.length - 1]).toMatchObject({ h: 11.6, c: 11.4 })
  })

  it('a prior-session tail (> 8 h) freezes the writers even after the server answered', () => {
    const p = params()
    renderHook(() => useBarSnapshotBars(p))
    const y = (h, m) => et(h, m) - 86400
    const rows = []
    for (let t = y(9, 30); t <= y(15, 55); t += 300) rows.push(b(t))
    dispatch({ type: 'rest-full', payload: { ticker: 'SIMX', tf: '5', bars: rows } })
    expect(p.provisionalStaleRef.current).toBe(true)
  })

  it('no_data → data.no_data, no error; warming → error.warming (the legacy SWR shapes)', () => {
    const { result } = renderHook(() => useBarSnapshotBars(params()))
    dispatch({ type: 'rest-error', payload: { error: 'warming' } })
    expect(result.current.error?.warming).toBe(true)
    expect(result.current.data).toBeUndefined()
    dispatch({ type: 'rest-error', payload: { error: 'no_data', terminal: true } })
    expect(result.current.error).toBeUndefined()
    expect(result.current.data?.no_data).toBe(true)
    expect(result.current.bars).toBeNull()
  })

  it('a timeframe switch with nothing current locally HOLDS the previous frame until the server answers', () => {
    const p = params({ _onScreenSrcRef: { current: { sym: 'SIMX', tf: '15', ext: false, bars: [] } } })
    const { result } = renderHook(() => useBarSnapshotBars(p))
    expect(result.current._tfSwitchHold).toBe(true)
    expect(p.tfSwitchHoldRef.current).toBe(true)
    dispatch({ type: 'rest-full', payload: { ticker: 'SIMX', tf: '5', bars: fiveMin(9, 30, 13, 15) } })
    expect(result.current._tfSwitchHold).toBe(false)
    expect(result.current.bars?.length).toBeGreaterThan(0)
  })
})

describe('useBarSnapshotBars — keys and the daily paint authority', () => {
  it('the chart key: session-aware 60m, custom tf on its native base, replay windowed, override none', () => {
    expect(chartKeyFor({ sym: 'aaa', resolvedTf: '60', showExtended: true })).toBe('AAA_60e')
    expect(chartKeyFor({ sym: 'aaa', resolvedTf: '60', showExtended: false })).toBe('AAA_60')
    expect(chartKeyFor({ sym: 'aaa', resolvedTf: '5', showExtended: true })).toBe('AAA_5')
    expect(chartKeyFor({ sym: 'aaa', resolvedTf: 'D' })).toBe('AAA_D')
    expect(chartKeyFor({ sym: 'aaa', resolvedTf: 'D', replayCutoff: '2026-03-02' })).toMatch(/^AAA_D@to=\d+$/)
    expect(chartKeyFor({ sym: 'aaa', resolvedTf: 'D', hasOverride: true })).toBeNull()
  })

  it('D local copy: painted only when the daily paint verdict is ok (here: two sessions behind → refused)', () => {
    const KD = keyOf({ sym: 'SIMD', tf: 'D' })
    const p = params({ sym: 'SIMD', resolvedTf: 'D', _barsTf: 'D', isIntraday: false })
    const { result } = renderHook(() => useBarSnapshotBars(p))
    const days = ['2026-09-16', '2026-09-17', '2026-09-18'].map((d) => ({ t: d, o: 10, h: 11, l: 9, c: 10.5, v: 100 }))
    act(() => { const st = getBarStore(); st.registry.dispatch(KD, { type: 'idb-hit', key: KD, gen: st.getSnapshot(KD).gen, payload: { bars: days } }) })
    expect(result.current.bars).toBeNull()
    act(() => { const st = getBarStore(); st.registry.dispatch(KD, { type: 'rest-full', key: KD, gen: st.getSnapshot(KD).gen, payload: { ticker: 'SIMD', tf: 'D', bars: [...days, { t: '2026-09-21', o: 10, h: 11, l: 9, c: 10.5, v: 1 }, { t: '2026-09-22', o: 10, h: 11, l: 9, c: 10.5, v: 1 }] } }) })
    expect(result.current.bars?.[result.current.bars.length - 1]?.t).toBe('2026-09-22')
  })
})
