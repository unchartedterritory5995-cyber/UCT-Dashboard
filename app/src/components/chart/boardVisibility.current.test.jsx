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

// ⭐ (2026-11-28, Lane G) a KEPT board is current: its opted-in feeds catch up in idle time
//   KC1 (red first) forwardWhileShown(..., { idle: true }) on a hidden KEPT current board handle: the catch-up runs in an
//       idle task (never in the feed's own task), at most once per KEPT_IDLE_CATCHUP_MS; a nested slot shown in its own
//       right under it likewise; a slot hidden in its own right (the double buffer's shadow), a plain current layer (no
//       `kept`) and a feed that did not opt in stay held to the show; the show catches up what arrived since, in its task
describe('a kept board is current (Lane G)', () => {
  it('KC1 (red first) opted-in feeds on a kept current board catch up in idle time, about once a second', async () => {
    vi.useFakeTimers()
    const { KEPT_IDLE_CATCHUP_MS, keptCurrentNow } = await import('./boardVisibility')
    const board = createBoardVisibility({ layer: true, current: true, kept: true })
    const front = createBoardVisibility({ layer: true, current: true, parent: board })
    const shadow = createBoardVisibility({ layer: true, current: true, parent: board })
    shadow.state = 'hidden'
    const plain = createBoardVisibility({ layer: true, current: true })
    const n = { board: 0, front: 0, shadow: 0, plain: 0, optOut: 0 }
    const feed = (vis, k, idle = true) => forwardWhileShown(vis, () => { n[k]++ }, undefined, { idle })
    const f = { board: feed(board, 'board'), front: feed(front, 'front'), shadow: feed(shadow, 'shadow'), plain: feed(plain, 'plain'), optOut: feed(board, 'optOut', false) }
    board.set('hidden'); plain.set('hidden')
    expect(keptCurrentNow(board)).toBe(true)
    expect(keptCurrentNow(front)).toBe(true)
    expect(keptCurrentNow(shadow), 'a slot hidden in its own right is kept-current').toBe(false)
    expect(keptCurrentNow(plain), 'a plain current layer (no kept) is kept-current').toBe(false)
    for (const k of Object.keys(f)) f[k].cb()
    expect(n, 'a hidden board was caught up in the feed\'s own task').toEqual({ board: 0, front: 0, shadow: 0, plain: 0, optOut: 0 })
    await vi.advanceTimersByTimeAsync(600)
    expect(n).toEqual({ board: 1, front: 1, shadow: 0, plain: 0, optOut: 0 })
    // a burst right after: the next idle catch-up waits out the second since the last one (600 ms ago)
    for (let i = 0; i < 5; i++) f.board.cb()
    await vi.advanceTimersByTimeAsync(KEPT_IDLE_CATCHUP_MS / 4)
    expect(n.board, 'the idle catch-up ran more than once a second').toBe(1)
    await vi.advanceTimersByTimeAsync(KEPT_IDLE_CATCHUP_MS)
    expect(n.board, 'one catch-up for the whole burst').toBe(2)
    // what arrived since the last idle pass is caught up by the show, in its own task
    f.board.cb(); f.front.cb()
    board.set('visible')
    expect(n.board, 'the show did not catch up the board\'s pending call').toBe(3)
    expect(n.front).toBe(2)
    expect(n.optOut, 'a feed that did not opt in was not caught up at the show').toBe(1)
    await vi.advanceTimersByTimeAsync(3 * KEPT_IDLE_CATCHUP_MS)
    expect(n.board, 'a cancelled idle catch-up ran after the show').toBe(3)
    for (const k of Object.keys(f)) f[k].stop()
  })
})

// ⭐ (review of #3052, G1-G3) THE KEPT BOARDS' CATCH-UP STAYS OUT OF A PRESS
//   KC2 (red first) K = 2 kept boards ticking (three feeds each, both forwarders): a key press on the page means no
//       kept-board catch-up runs for KEPT_QUIET_MS after it; then each board catches up in ONE task (all its feeds in
//       the same batch), at most once per KEPT_IDLE_CATCHUP_MS
describe('kept boards stay out of a press (review of #3052)', () => {
  it('KC2 (red first) no kept-board catch-up between a key and the quiet; one task per board', async () => {
    vi.useFakeTimers()
    const M = await import('./boardVisibility')
    M.__resetKeptCatchUpForTests()
    const boards = [0, 1].map(() => M.createBoardVisibility({ layer: true, current: true, kept: true }))
    const runs = []   // [board, feed, batch]
    const feeds = []
    boards.forEach((b, bi) => {
      const slot = M.createBoardVisibility({ layer: true, current: true, parent: b })
      const rec = (fi) => () => { runs.push([bi, fi, M.keptCatchUpStats().batches]) }
      feeds.push(M.forwardWhileShown(b, rec(0), undefined, { idle: true }))
      feeds.push(M.forwardWhileShown(slot, rec(1), undefined, { idle: true }))
      feeds.push(M.forwardWhileCurrent(b, rec(2)))
      b.set('hidden')
    })
    const tick = () => { for (const f of feeds) f.cb() }
    // quiet page: the ticks catch up (non-vacuity)
    tick()
    await vi.advanceTimersByTimeAsync(50)
    expect(runs.length, 'NON-VACUITY: a quiet page caught the kept boards up').toBe(6)
    runs.length = 0
    // a key press, the boards ticking every 100 ms through it
    await vi.advanceTimersByTimeAsync(M.KEPT_IDLE_CATCHUP_MS)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    const pressAt = Date.now()
    for (let t = 0; t < M.KEPT_QUIET_MS; t += 100) { tick(); await vi.advanceTimersByTimeAsync(100) }
    expect(runs.filter(() => Date.now() - pressAt <= M.KEPT_QUIET_MS).length, 'a kept board caught up within the quiet after a press').toBe(0)
    await vi.advanceTimersByTimeAsync(200)
    expect(runs.length, 'the boards did not catch up after the quiet').toBe(6)
    for (const bi of [0, 1]) {
      const batches = new Set(runs.filter((r) => r[0] === bi).map((r) => r[2]))
      expect(batches.size, `board ${bi} caught up in more than one task`).toBe(1)
    }
    // shown WHILE a catch-up is pending, then hidden again: the board's feeds go on catching up (a show leaves no feed
    // blocked behind the catch-up it cancelled)
    await vi.advanceTimersByTimeAsync(M.KEPT_IDLE_CATCHUP_MS)
    tick()
    boards[0].set('visible'); boards[0].set('hidden')
    runs.length = 0
    await vi.advanceTimersByTimeAsync(M.KEPT_IDLE_CATCHUP_MS)
    tick()
    await vi.advanceTimersByTimeAsync(M.KEPT_IDLE_CATCHUP_MS + 50)
    expect(runs.filter((r) => r[0] === 0).length, 'after a show and a hide, the board no longer catches up').toBe(3)
    for (const f of feeds) f.stop()
  })

  it('KC3 (red first) a press that lands after the catch-up was timed still holds it off (asked again at the run)', async () => {
    vi.useFakeTimers()
    const M = await import('./boardVisibility')
    M.__resetKeptCatchUpForTests()
    const b = M.createBoardVisibility({ layer: true, current: true, kept: true })
    let n = 0
    const f = M.forwardWhileShown(b, () => { n++ }, undefined, { idle: true })
    b.set('hidden')
    f.cb()
    await vi.advanceTimersByTimeAsync(50)
    expect(n, 'NON-VACUITY: a quiet page catches up').toBe(1)
    await vi.advanceTimersByTimeAsync(400)
    f.cb()   // timed for the second after the last run (~550 ms from now)
    await vi.advanceTimersByTimeAsync(540)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    await vi.advanceTimersByTimeAsync(M.KEPT_QUIET_MS - 50)
    expect(n, 'a catch-up timed before the press ran inside its quiet').toBe(1)
    await vi.advanceTimersByTimeAsync(200)
    expect(n).toBe(2)
    f.stop()
  })
})

