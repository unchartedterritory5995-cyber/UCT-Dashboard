// The handle API for the double-buffered next row (2026-11-27; boardVisibility.js, boardLayer.js).
//   C1 (red first) forwardWhileCurrent: on a CURRENT hidden layer the feed is forwarded, coalesced, in an idle task
//      (never synchronously); the show flushes a pending one in its own task; on a plain layer it is forwardWhileShown
//   C2 (red first) useBarSnapshot's BASE feed on a hidden CURRENT layer re-renders in an idle task with the live
//      snapshot; any other feed on it stays muted and held
//   Q1 (red first) a QUIET set: the feeds and gates in its own task, useBoardHidden readers only after the next paint
//   N1 (red first) a NESTED handle is hidden whenever its own layer or its parent board is; it is told of the parent's
//      changes (as quietly), and a parent change it does not see (it is hidden itself) tells it nothing
//   N2 (red first) useNestedBoardVisibility under a board: a reader inside the slot re-renders when the board hides
//   L1 (red first) boardLayerProps: the one definition of the hidden layer's wrapper
// Review of #2918:
//   C3 (red first, LOW 1) forwardWhileCurrent on a DISPOSED current layer (still mounted, about to go): a feed call
//      schedules no idle re-render, and a call pending at the dispose never runs
//   N3 (red first, LOW 2) a NESTED handle's dispose: its listeners and readers are told once, then dropped, and it
//      stops following its parent (no subscription left on the parent, none made again by a late subscribe)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, renderHook, act } from '@testing-library/react'
import {
  BoardVisibilityContext, createBoardVisibility, forwardWhileCurrent, forwardWhileShown, boardHiddenNow, boardLoopGate,
  useBoardHidden, useNestedBoardVisibility,
} from './boardVisibility'
import { boardLayerProps } from './boardLayer'
import { useBarSnapshot } from '../../data/barStore/useBarSnapshot'
import { createBarStore } from '../../data/barStore/index'
import { keyOf } from '../../data/barStore/types'
import { fakeStream, fakeCandle, fakePrices } from '../../data/barStore/testing/fakeFeeds'

afterEach(() => { vi.useRealTimers() })

function store() {
  const io = { memPeekEntry: () => null, idbGet: async () => null, memPutMonotonic: () => null, idbPutMonotonic: async () => null }
  return createBarStore({ request: vi.fn(() => new Promise(() => {})), io, stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {} })
}
const K = keyOf({ sym: 'AAA', tf: '5' })
const LIVE = (t, c) => ({ sym: 'AAA', tf: '5', t_s: t, bar: { t: t * 1000, o: c, h: c, l: c, c, v: 1 }, rev: t })

describe('the double-buffered row handle API', () => {
  it('C1 (red first) forwardWhileCurrent forwards a hidden CURRENT layer in an idle task; a plain layer stays muted', async () => {
    vi.useFakeTimers()
    const cur = createBoardVisibility({ layer: true, current: true })
    const notify = vi.fn()
    const f = forwardWhileCurrent(cur, notify)
    f.cb()
    expect(notify, 'NON-VACUITY: a shown board forwards at once').toHaveBeenCalledTimes(1)
    cur.set('hidden')
    expect(boardHiddenNow(cur), 'a current layer is still paused for everything else').toBe(true)
    f.cb(); f.cb(); f.cb()
    expect(notify, 'a hidden current layer forwarded in the task of the feed').toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(600)
    expect(notify, 'not forwarded, or not coalesced, in an idle task').toHaveBeenCalledTimes(2)
    f.cb()
    cur.set('visible')
    expect(notify, 'the show did not flush the pending call in its own task').toHaveBeenCalledTimes(3)
    f.stop()
    const plain = createBoardVisibility({ layer: true })
    const n2 = vi.fn()
    const g = forwardWhileCurrent(plain, n2)
    plain.set('hidden')
    g.cb()
    await vi.advanceTimersByTimeAsync(600)
    expect(n2, 'a plain layer forwarded while hidden').not.toHaveBeenCalled()
    plain.set('visible')
    expect(n2).toHaveBeenCalledTimes(1)
  })

  it('C2 (red first) the BASE feed of a hidden CURRENT layer re-renders in an idle task; other feeds stay held', async () => {
    vi.useFakeTimers()
    for (const [wake, live] of [['base', true], ['all', false]]) {
      const s = store()
      const vis = createBoardVisibility({ layer: true, current: true })
      let renders = 0
      const wrapper = ({ children }) => <BoardVisibilityContext.Provider value={vis}>{children}</BoardVisibilityContext.Provider>
      const view = renderHook(() => { renders++; return useBarSnapshot(K, { store: s, wake }) }, { wrapper })
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      act(() => { s.applyLive(K, LIVE(1762786800, 1)) })
      act(() => { vis.set('hidden') })
      const held = view.result.current
      const before = renders
      act(() => { s.applyLive(K, LIVE(1762787100, 2)) })      // a new 5m bucket: a BASE change
      expect(renders - before, `${wake}: a hidden board re-rendered in the feed's own task`).toBe(0)
      await act(async () => { await vi.advanceTimersByTimeAsync(600) })
      if (live) {
        expect(renders - before, 'base: the idle re-render did not happen').toBeGreaterThan(0)
        expect(view.result.current, 'base: a current layer read a held snapshot').toBe(s.getBaseSnapshot(K))
        expect(view.result.current).not.toBe(held)
      } else {
        expect(renders - before, 'all: a non-base feed of a current layer re-rendered while hidden').toBe(0)
        expect(view.result.current).toBe(held)
      }
      view.unmount()
    }
  })

  it('Q1 (red first) a quiet set tells feeds and gates in its task, useBoardHidden readers after the paint', async () => {
    const vis = createBoardVisibility({ layer: true })
    const feed = vi.fn()
    vis.subscribe(feed)
    const gate = boardLoopGate(vis)
    let renders = 0
    const view = renderHook(() => { renders++; return useBoardHidden() }, {
      wrapper: ({ children }) => <BoardVisibilityContext.Provider value={vis}>{children}</BoardVisibilityContext.Provider>,
    })
    const before = renders
    act(() => { vis.flip('hidden') })
    expect(feed, 'a quiet set did not tell the feeds in its own task').toHaveBeenCalledTimes(1)
    expect(gate.paused()).toBe(true)
    expect(renders - before, 'a quiet set re-rendered a reader in its own task').toBe(0)
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
    expect(view.result.current, 'the reader was not told after the paint').toBe(true)
    act(() => { vis.set('visible') })
    expect(view.result.current, 'a plain set tells readers at once').toBe(false)
  })

  it('N1 (red first) a nested handle is hidden whenever its own layer or its board is', () => {
    const board = createBoardVisibility({ layer: true })
    const slot = createBoardVisibility({ layer: true, parent: board })
    const told = vi.fn()
    slot.subscribe(told)
    const notify = vi.fn()
    const f = forwardWhileShown(slot, notify)
    expect(boardHiddenNow(slot)).toBe(false)
    board.set('hidden')
    expect(boardHiddenNow(slot), 'the board hid and its slot did not').toBe(true)
    expect(told, 'the slot was not told of its board').toHaveBeenCalledTimes(1)
    f.cb()
    expect(notify, 'a feed of the slot forwarded while its board was hidden').not.toHaveBeenCalled()
    board.set('visible')
    expect(boardHiddenNow(slot)).toBe(false)
    expect(notify, 'the show of the board did not catch the slot up').toHaveBeenCalledTimes(1)
    slot.set('hidden')
    expect(boardHiddenNow(slot)).toBe(true)
    expect(boardHiddenNow(board)).toBe(false)
    const n = told.mock.calls.length
    board.set('hidden')
    board.set('visible')
    expect(told.mock.calls.length - n, 'a hidden slot was told of board changes it cannot see').toBe(0)
    expect(boardHiddenNow(slot)).toBe(true)
    const gate = boardLoopGate(slot)
    expect(gate && gate.paused()).toBe(true)
    f.stop()
  })

  it('N2 (red first) a reader in a nested slot re-renders when its board hides', () => {
    const board = createBoardVisibility({ layer: true })
    const seen = []
    function Reader() { seen.push(useBoardHidden()); return null }
    function Slot() {
      const vis = useNestedBoardVisibility()
      return <BoardVisibilityContext.Provider value={vis}><Reader /></BoardVisibilityContext.Provider>
    }
    render(<BoardVisibilityContext.Provider value={board}><Slot /></BoardVisibilityContext.Provider>)
    expect(seen.at(-1)).toBe(false)
    act(() => { board.set('hidden') })
    expect(seen.at(-1), 'the slot reader did not see its board hide').toBe(true)
    act(() => { board.set('visible') })
    expect(seen.at(-1)).toBe(false)
  })

  it('L1 (red first) boardLayerProps is the hidden layer wrapper', () => {
    const hidden = boardLayerProps(true, 'front')
    expect(hidden.className).toMatch(/boardSlotLayer/)
    expect(hidden.inert).toBe(true)
    expect(hidden['aria-hidden']).toBe(true)
    expect(boardLayerProps(false, 'front')).toEqual({ className: 'front', inert: false, 'aria-hidden': undefined })
  })

  it('L2 (red first) keepLayout: the hidden layer keeps the shown class (a flip never changes display); without a shown class, the bare layer', () => {
    const hidden = boardLayerProps(true, 'front', { keepLayout: true })
    expect(hidden.className.split(' ')).toContain('front')
    expect(hidden.className).toMatch(/boardSlotLayer/)
    expect(hidden.inert).toBe(true)
    expect(boardLayerProps(true, 'front').className).not.toMatch(/front/)
    expect(boardLayerProps(true, undefined, { keepLayout: true }).className).toBe(boardLayerProps(true).className)
    expect(boardLayerProps(false, 'front', { keepLayout: true })).toEqual(boardLayerProps(false, 'front'))
  })
})

describe('the double-buffered row handle API, disposal (review of #2918)', () => {
  it('C3 (red first) a disposed current layer forwards nothing: no idle re-render scheduled, a pending one cancelled', async () => {
    vi.useFakeTimers()
    const cur = createBoardVisibility({ layer: true, current: true })
    const notify = vi.fn()
    const f = forwardWhileCurrent(cur, notify)
    cur.set('hidden')
    f.cb()                                         // pending in an idle task
    cur.dispose()
    await vi.advanceTimersByTimeAsync(600)
    expect(notify, 'a call pending at the dispose re-rendered the disposed slot').not.toHaveBeenCalled()
    f.cb()
    await vi.advanceTimersByTimeAsync(600)
    expect(notify, 'a disposed slot scheduled an idle re-render').not.toHaveBeenCalled()
    f.stop()
    // CONTROL: the same calls on a hidden current layer not disposed do re-render, once, in an idle task
    const live = createBoardVisibility({ layer: true, current: true })
    const n2 = vi.fn()
    const g = forwardWhileCurrent(live, n2)
    live.set('hidden')
    g.cb(); g.cb()
    await vi.advanceTimersByTimeAsync(600)
    expect(n2).toHaveBeenCalledTimes(1)
    g.stop()
  })

  it('N3 (red first) a nested handle disposed drops its listeners and readers and unfollows its parent', () => {
    const board = createBoardVisibility({ layer: true })
    let onParent = 0
    const sub = board.subscribe
    board.subscribe = (cb) => { onParent++; const un = sub(cb); return () => { onParent--; un() } }
    const slot = createBoardVisibility({ layer: true, parent: board })
    const listener = vi.fn()
    const reader = vi.fn()
    slot.subscribe(listener)
    slot.subscribeReaders(reader)
    expect(onParent, 'NON-VACUITY: the slot follows its board while listened to').toBe(1)
    board.set('hidden')
    expect(listener, 'NON-VACUITY: the slot is told of its board').toHaveBeenCalledTimes(1)
    board.set('visible')
    listener.mockClear(); reader.mockClear()
    slot.dispose()
    expect(listener, 'the dispose is told once').toHaveBeenCalledTimes(1)
    expect(reader).toHaveBeenCalledTimes(1)
    expect(onParent, 'the disposed slot still follows its board').toBe(0)
    listener.mockClear(); reader.mockClear()
    board.set('hidden'); board.set('visible')
    expect(listener, 'a board change reached a disposed slot').not.toHaveBeenCalled()
    expect(reader).not.toHaveBeenCalled()
    slot.subscribe(vi.fn())                         // a late subscribe (a cleanup and an effect crossing)
    expect(onParent, 'a late subscribe made the disposed slot follow its board again').toBe(0)
  })
})
