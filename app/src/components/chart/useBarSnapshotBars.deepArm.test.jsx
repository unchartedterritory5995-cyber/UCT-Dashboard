// ⭐ (2026-11-20) THE INTRADAY DEEP BACKFILL ARMS BY DEADLINE, NOT BY STATE — and still only after a rest.
//
// A chart the member rests on asks older windows (`store.scrollBack`, `grid` rank) DEEP_ARM_MS after the symbol or
// timeframe changed, so a held key or a fast scan never starts a window per row. That wait used to be StockChart
// state (`_intradayDeepArmed`), flipped true 250 ms after each switch and false at the next: two renders of the
// whole chart per intraday switch for an effect's timer. It is a deadline now; these pin what the state did:
//   * nothing is asked before the rest is over, and the first window is asked once it is;
//   * a row left before its rest is over asks nothing (the next row's own rest starts again);
//   * the hook never sets the state any more (the legacy source keeps arming through it).
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { pinWallClock } from '../../testing/pinnedWallClock'
import { useBarSnapshotBars, DEEP_ARM_MS } from './useBarSnapshotBars'
import { getBarStore, _resetBarStoreForTests } from '../../data/barStore/index'
import { keyOf } from '../../data/barStore/types'
import { memClear } from '../../utils/barsMemCache'

// Tue 2026-09-22 13:17 ET (EDT) — mid-session.
const clock = pinWallClock('2026-09-22T17:17:00Z')
afterAll(() => clock.restore())
const et = (h, m) => Math.floor(Date.UTC(2026, 8, 22, h + 4, m) / 1000)
const rows = () => {
  const out = []
  for (let t = et(9, 30); t <= et(13, 15); t += 300) out.push({ t, o: 10, h: 11, l: 9, c: 10.5, v: 100 })
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
    breadthSeries: false, replayCutoff: null, compareSymbol: null, backgroundWarm: true, deepWarm: false,
    barsOverride: null, barsOverridePending: false, _liveSane: () => true, _gridQ: '', instFetcher: vi.fn(),
    _pinnedFull: false, _overlayActive: false, barCount: 600,
    axisWidthRatchetRef: ref(0), barsMutateRef: ref(), _timingIdRef: ref(),
    activeTfRef: ref('5'), _onScreenSrcRef: ref(), tfSwitchHoldRef: ref(false), provisionalStaleRef: ref(false),
    _developingBarISO: () => null, _effLivePrice: () => null,
    _intradayDeepBackfillEnabled: () => true, _intradaySmoothSwitchEnabled: () => false,
    ...over,
  }
}

const land = (sym) => act(() => {
  const st = getBarStore()
  const K = keyOf({ sym, tf: '5' })
  st.registry.dispatch(K, { key: K, gen: st.getSnapshot(K).gen, type: 'rest-full', payload: { ticker: sym, tf: '5', bars: rows() } })
})
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

describe('the intraday deep backfill, armed by a deadline', () => {
  it('asks its first older window only once the rest is over', async () => {
    const st = getBarStore()
    const scroll = vi.spyOn(st, 'scrollBack').mockImplementation(() => new Promise(() => {}))
    renderHook((p) => useBarSnapshotBars(p), { initialProps: params() })
    land('SIMX')
    await wait(DEEP_ARM_MS - 120)
    expect(scroll, 'asked before the rest was over').not.toHaveBeenCalled()
    await wait(240)
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll.mock.calls[0][0]).toBe(keyOf({ sym: 'SIMX', tf: '5' }))
    expect(scroll.mock.calls[0][1]).toMatchObject({ priority: 'grid' })
  })

  it('a row left before its rest is over asks nothing; the row the member stops on asks after its own rest', async () => {
    const st = getBarStore()
    const scroll = vi.spyOn(st, 'scrollBack').mockImplementation(() => new Promise(() => {}))
    const { rerender } = renderHook((p) => useBarSnapshotBars(p), { initialProps: params({ sym: 'AAAX' }) })
    land('AAAX')
    await wait(DEEP_ARM_MS - 150)
    rerender(params({ sym: 'BBBX' }))
    land('BBBX')
    await wait(DEEP_ARM_MS - 100)
    expect(scroll, 'a row the member left (or one whose rest is not over) asked').not.toHaveBeenCalled()
    await wait(200)
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll.mock.calls[0][0]).toBe(keyOf({ sym: 'BBBX', tf: '5' }))
  })

  it('never sets the legacy arm state (no render of the chart for a timer)', async () => {
    const setArmed = vi.fn()
    vi.spyOn(getBarStore(), 'scrollBack').mockImplementation(() => new Promise(() => {}))
    renderHook((p) => useBarSnapshotBars(p), { initialProps: params({ _intradayDeepArmed: false, _setIntradayDeepArmed: setArmed }) })
    land('SIMX')
    await wait(DEEP_ARM_MS + 150)
    expect(setArmed).not.toHaveBeenCalled()
  })
})
