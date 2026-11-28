// ⛔⛔ (review of #3034, the owner's decision: a short chart must be impossible) A CUT SHORT IS NEVER PAINTED. A D/W/M key
// whose tail was cut to EDGE_TAIL_BARS while its deep history and its cover page are still out (network.cutShort) shows the
// chart's loading state (no bars, no error), never its 30 rows; it paints the moment the rows land; still short
// CUT_SHORT_GIVE_UP_MS later the chart says so honestly (`error.historyShort`), and a retry waits its own bound again.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBarSnapshotBars, CUT_SHORT_GIVE_UP_MS } from './useBarSnapshotBars'
import { getBarStore, _resetBarStoreForTests } from '../../data/barStore/index'
import { keyOf } from '../../data/barStore/types'
import { memClear } from '../../utils/barsMemCache'

const day = 86400
const rows = (n) => {
  const end = Math.floor(Date.UTC(2026, 10, 25) / 1000)
  return Array.from({ length: n }, (_, i) => ({ t: end - (n - 1 - i) * day, o: 10, h: 11, l: 9, c: 10.5, v: 100 }))
}

beforeEach(() => {
  _resetBarStoreForTests()
  memClear()
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

function params(over = {}) {
  const ref = (v = null) => ({ current: v })
  return {
    sym: 'CUTX', resolvedTf: 'D', _barsTf: 'D', _econId: null, showExtended: false, isIntraday: false,
    breadthSeries: false, replayCutoff: null, compareSymbol: null, backgroundWarm: true, deepWarm: false,
    barsOverride: null, barsOverridePending: false, _liveSane: () => true, _gridQ: '', instFetcher: vi.fn(),
    _pinnedFull: false, _overlayActive: false, barCount: 600,
    axisWidthRatchetRef: ref(0), barsMutateRef: ref(), _timingIdRef: ref(),
    activeTfRef: ref('D'), _onScreenSrcRef: ref(), tfSwitchHoldRef: ref(false), provisionalStaleRef: ref(false),
    _developingBarISO: () => null, _effLivePrice: () => null,
    _intradayDeepBackfillEnabled: () => true, _intradaySmoothSwitchEnabled: () => false,
    ...over,
  }
}
const K = keyOf({ sym: 'CUTX', tf: 'D' })
const land = (n) => act(() => {
  const st = getBarStore()
  st.registry.dispatch(K, { key: K, gen: st.getSnapshot(K).gen, type: 'rest-full', payload: { ticker: 'CUTX', tf: 'D', bars: rows(n) } })
})
const wait = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('a cut short D key in the chart', () => {
  it('never paints the 30 rows: loading, then the rows that landed; never an error before the bound', async () => {
    vi.useFakeTimers()
    const st = getBarStore()
    let short = true
    vi.spyOn(st, 'cutShort').mockImplementation((k) => k === K && short)
    const { result } = renderHook((p) => useBarSnapshotBars(p), { initialProps: params() })
    land(30)
    expect(result.current.bars, 'a cut short painted').toBeNull()
    expect(result.current.error).toBeUndefined()
    short = false
    land(1400)                                                         // the cover page lands
    expect(result.current.bars?.length).toBe(1400)
    vi.useRealTimers()
  })

  it('still short at CUT_SHORT_GIVE_UP_MS: the honest note (error.historyShort); a retry waits its own bound again', async () => {
    vi.useFakeTimers()
    const st = getBarStore()
    vi.spyOn(st, 'cutShort').mockImplementation((k) => k === K)
    const { result } = renderHook((p) => useBarSnapshotBars(p), { initialProps: params() })
    land(30)
    await wait(CUT_SHORT_GIVE_UP_MS - 100)
    expect(result.current.error).toBeUndefined()
    await wait(200)
    expect(result.current.error?.historyShort).toBe(true)
    expect(result.current.bars).toBeNull()
    act(() => { result.current.mutate() })
    expect(result.current.error, 'the retry is loading again').toBeUndefined()
    vi.useRealTimers()
  })

  it('CONTROL: a D key that is not a cut short paints its rows at once', () => {
    const st = getBarStore()
    vi.spyOn(st, 'cutShort').mockReturnValue(false)
    const { result } = renderHook((p) => useBarSnapshotBars(p), { initialProps: params() })
    land(30)
    expect(result.current.bars?.length).toBe(30)
  })
})
