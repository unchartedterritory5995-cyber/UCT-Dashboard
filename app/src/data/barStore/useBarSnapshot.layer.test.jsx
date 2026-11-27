// useBarSnapshot on a hidden LAYER board (2026-11-27, the board keep-alive's layer mode; boardVisibility.js). The board
// stays mounted, so the hook's own subscription is what keeps its key's network loop, live feed and persist running.
//   B1 (red first) a hidden layer board subscribes to nothing: its key's I/O stops as at an unmount; the subscription
//      comes back after the show's first paint (never in the show's own task)
//   B2 (red first) while hidden the hook returns the snapshot it held at the hide, whatever the store does meanwhile;
//      neither the hide nor the show re-renders it when nothing moved
//   B3 the <Activity> mode's handle (no `layer`) and no handle at all change nothing
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBarSnapshot } from './useBarSnapshot'
import { createBarStore } from './index'
import { keyOf } from './types'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { BoardVisibilityContext, createBoardVisibility } from '../../components/chart/boardVisibility'

afterEach(() => { vi.useRealTimers() })

function store() {
  const request = vi.fn(() => new Promise(() => {}))
  const io = { memPeekEntry: () => null, idbGet: async () => null, memPutMonotonic: () => null, idbPutMonotonic: async () => null }
  return { request, s: createBarStore({ request, io, stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {} }) }
}
const K = keyOf({ sym: 'AAA', tf: '5' })
const LIVE = (t, c) => ({ sym: 'AAA', tf: '5', t_s: t, bar: { t: t * 1000, o: c, h: c, l: c, c, v: 1 }, rev: t })
function mount(s, vis) {
  const wrapper = ({ children }) => (vis === undefined ? children : <BoardVisibilityContext.Provider value={vis}>{children}</BoardVisibilityContext.Provider>)
  return renderHook(() => useBarSnapshot(K, { store: s }), { wrapper })
}

describe('useBarSnapshot on a hidden layer board', () => {
  it('B4 (red first) a hide and a show with nothing new re-render nothing', async () => {
    vi.useFakeTimers()
    const { s } = store()
    const vis = createBoardVisibility({ layer: true })
    let renders = 0
    const wrapper = ({ children }) => <BoardVisibilityContext.Provider value={vis}>{children}</BoardVisibilityContext.Provider>
    const view = renderHook(() => { renders++; return useBarSnapshot(K, { store: s }) }, { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => { s.applyLive(K, LIVE(1762786800, 1)) })
    const before = renders
    act(() => { vis.set('hidden') })
    act(() => { vis.set('visible') })
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(renders - before, 'a hide and a show with nothing new re-rendered the reader').toBe(0)
    view.unmount()
  })

  it('B1 (red first) a hidden layer board subscribes nothing; the show subscribes again', async () => {
    vi.useFakeTimers()
    const { s } = store()
    const vis = createBoardVisibility({ layer: true })
    const view = mount(s, vis)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(s.network.stats().keys, 'NON-VACUITY: the visible board runs its key').toBe(1)
    act(() => { vis.set('hidden') })
    expect(s.network.stats().keys, 'a hidden board kept its key running').toBe(0)
    act(() => { vis.set('visible') })
    expect(s.network.stats().keys, 'the show subscribed in its own task').toBe(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(s.network.stats().keys, 'the show did not subscribe again').toBe(1)
    view.unmount()
    expect(s.network.stats().keys).toBe(0)
  })

  it('B2 (red first) while hidden it returns the snapshot held at the hide', async () => {
    vi.useFakeTimers()
    const { s } = store()
    const vis = createBoardVisibility({ layer: true })
    const view = mount(s, vis)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => { s.applyLive(K, LIVE(1762786800, 1)) })
    const held = view.result.current
    act(() => { vis.set('hidden') })
    expect(view.result.current).toBe(held)
    // the store moves on (another reader keeps the key alive); a re-render of the hidden board still reads the held one
    const other = s.subscribe(K, () => {}, {})
    act(() => { s.applyLive(K, LIVE(1762787100, 2)) })
    expect(s.getSnapshot(K), 'NON-VACUITY: the store moved on while the board was hidden').not.toBe(held)
    view.rerender()
    expect(view.result.current, 'a hidden board read a snapshot newer than its hide').toBe(held)
    act(() => { vis.set('visible') })
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(view.result.current, 'the show did not read the current snapshot').toBe(s.getSnapshot(K))
    other()
    view.unmount()
  })

  it('B3 the <Activity> handle and no handle change nothing', async () => {
    vi.useFakeTimers()
    for (const vis of [createBoardVisibility(), undefined]) {
      const { s } = store()
      const view = mount(s, vis)
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      if (vis) act(() => { vis.set('hidden') })
      expect(s.network.stats().keys).toBe(1)
      view.unmount()
    }
  })
})
