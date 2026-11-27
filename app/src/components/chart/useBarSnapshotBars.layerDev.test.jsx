// The developing-bar channel on a hidden LAYER board (2026-11-27, the board keep-alive's layer mode;
// boardVisibility.js). A kept board stays mounted; another board on the same key keeps the key's feed alive, so without
// the board's pause every developing tick would paint the hidden chart.
//   DV1 (red first) a hidden layer board's chart is handed no developing bar; after the show's first paint the
//       subscription is back (never in the show's own task) and the next tick is painted
//   DV2 the <Activity> mode's handle changes nothing
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { pinWallClock } from '../../testing/pinnedWallClock'
import { getBarStore, _resetBarStoreForTests } from '../../data/barStore/index'
import { keyOf } from '../../data/barStore/types'
import { memClear } from '../../utils/barsMemCache'
import { BoardVisibilityContext, createBoardVisibility } from './boardVisibility'

vi.mock('../../data/barStore/useBarSnapshot', () => ({
  useBarSnapshot: (key, o) => (key ? o.store.getBaseSnapshot(key) : null),
}))
const { useBarSnapshotBars } = await import('./useBarSnapshotBars')

// Tue 2026-09-22 13:17 ET (EDT): mid-session
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
const frame = () => act(() => new Promise((r) => setTimeout(r, 60)))
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
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

function mount(vis) {
  const painted = []
  const devRef = { current: null }
  const paintRef = { current: vi.fn(() => painted.push(devRef.current)) }
  const p = params({ _storeDevRef: devRef, _storeDevPaintRef: paintRef })
  dispatch({ type: 'rest-full', payload: { ticker: 'SIMX', tf: '5', bars: fiveMin(9, 30, 13, 15) } })
  const wrapper = ({ children }) => <BoardVisibilityContext.Provider value={vis}>{children}</BoardVisibilityContext.Provider>
  const view = renderHook(() => useBarSnapshotBars(p), { wrapper })
  // a NEW bucket (a base change), rendered: the developing bar every push below changes
  push(et(13, 20), { h: 10.2, l: 10.1, c: 10.15, v: 5 }, Date.now())
  view.rerender()
  return { view, painted, devRef }
}

describe('the developing-bar channel on a hidden layer board', () => {
  it('DV1 (red first) a hidden layer board is handed no developing bar; the show resumes after its first paint', async () => {
    const vis = createBoardVisibility({ layer: true })
    const { painted, devRef } = mount(vis)
    const t0 = Date.now()
    push(et(13, 20), { h: 11.2, l: 9, c: 11.1, v: 120 }, t0 + 1)   // the same bucket: a developing change only
    await frame()
    expect(devRef.current, 'NON-VACUITY: a shown board is handed the developing bar').toMatchObject({ c: 11.1 })
    act(() => { vis.set('hidden') })
    const before = painted.length
    push(et(13, 20), { h: 11.4, l: 9, c: 11.3, v: 140 }, t0 + 2)
    await frame()
    expect(painted.length - before, 'a hidden board painted a developing tick').toBe(0)
    expect(devRef.current.c).toBe(11.1)
    act(() => { vis.set('visible') })
    push(et(13, 20), { h: 11.5, l: 9, c: 11.45, v: 150 }, t0 + 3)
    expect(devRef.current.c, 'the show resubscribed in its own task').toBe(11.1)
    await frame()
    push(et(13, 20), { h: 11.6, l: 9, c: 11.55, v: 160 }, t0 + 4)
    await frame()
    expect(devRef.current, 'the shown board is not handed the developing bar again').toMatchObject({ c: 11.55 })
  })

  it('DV2 the <Activity> handle changes nothing', async () => {
    const vis = createBoardVisibility()
    const { devRef } = mount(vis)
    vis.state = 'hidden'
    push(et(13, 20), { h: 11.2, l: 9, c: 11.1, v: 120 }, Date.now() + 1)
    await frame()
    expect(devRef.current).toMatchObject({ c: 11.1 })
    vis.state = 'visible'
  })
})
