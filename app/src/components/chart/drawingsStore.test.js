// @vitest-environment jsdom
// Tests for drawingsStore — the shared per-symbol drawings registry behind
// useChartDrawings. Covers the same-sym multi-chart clobber regression, shared
// undo/redo history, keydown fan-out dedup (paste / Delete / Ctrl+Z), the
// pinned getSnapshot/subscribe contract, and the frame-coalesced notify path.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import useChartDrawings from './useChartDrawings'
import * as drawingsStore from './drawingsStore'

const {
  EMPTY_SNAPSHOT, getSnapshot, subscribe,
  addDrawing, removeDrawing, updateDrawing, clearAll, reorderDrawing,
  snapshotHistory, undo, redo,
} = drawingsStore

const hz = (price) => ({ type: 'horizontal', points: [{ price }] })
const STORE = 'uct-chart-drawings'
const stored = (sym) => (JSON.parse(localStorage.getItem(STORE) || '{}')[sym] || [])
const prices = (sym) => getSnapshot(sym).drawings.map((d) => d.points[0].price)
const tick = () => null   // `await tick()` = one microtask turn (clears the task guards)

beforeEach(() => {
  localStorage.clear()
  drawingsStore._reset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('drawingsStore — shared state + clobber regression', () => {
  it('a second same-sym writer preserves the first writer\'s drawings', () => {
    subscribe('SPY', () => {})            // chart B mounted BEFORE A's add
    addDrawing('SPY', hz(100))            // A draws
    addDrawing('SPY', hz(200))            // B draws — pre-store this wiped A's in LS
    expect(getSnapshot('SPY').drawings).toHaveLength(2)
    expect(stored('SPY')).toHaveLength(2)
  })

  it('notifies every same-sym subscriber; all reads share the SAME drawings array', () => {
    const cbA = vi.fn()
    const cbB = vi.fn()
    subscribe('SPY', cbA)
    subscribe('SPY', cbB)
    addDrawing('SPY', hz(1))
    expect(cbA).toHaveBeenCalledTimes(1)
    expect(cbB).toHaveBeenCalledTimes(1)
    const arr = getSnapshot('SPY').drawings
    expect(getSnapshot('SPY').drawings).toBe(arr)
  })

  it('per-sym RMW: an external write to ANOTHER sym between mutations survives', () => {
    addDrawing('SPY', hz(1))
    const all = JSON.parse(localStorage.getItem(STORE))
    all.QQQ = [{ id: 'q', ...hz(50) }]    // another surface/tab writes QQQ
    localStorage.setItem(STORE, JSON.stringify(all))
    addDrawing('SPY', hz(2))
    const after = JSON.parse(localStorage.getItem(STORE))
    expect(after.QQQ).toHaveLength(1)
    expect(after.SPY).toHaveLength(2)
  })
})

describe('drawingsStore — shared undo/redo history', () => {
  it('undo reverts the most recent same-sym mutation regardless of writer', async () => {
    addDrawing('SPY', hz(1))              // writer A
    addDrawing('SPY', hz(2))              // writer B
    undo('SPY')
    expect(prices('SPY')).toEqual([1])
    await tick()
    undo('SPY')
    expect(prices('SPY')).toEqual([])
    redo('SPY')
    expect(prices('SPY')).toEqual([1])
    await tick()
    redo('SPY')
    expect(prices('SPY')).toEqual([1, 2])
  })

  it('caps history at MAX_HISTORY=100 (oldest steps drop)', async () => {
    for (let i = 0; i < 105; i++) addDrawing('SPY', hz(i))
    expect(getSnapshot('SPY').drawings).toHaveLength(105)
    for (let i = 0; i < 100; i++) { undo('SPY'); await tick() }
    expect(getSnapshot('SPY').canUndo).toBe(false)          // stack exhausted at 100
    expect(getSnapshot('SPY').drawings).toHaveLength(5)     // 5 oldest adds fell off the stack
  })

  it('snapshotHistory + record:false updates coalesce a drag into ONE undo step', () => {
    const id = addDrawing('SPY', hz(100))
    snapshotHistory('SPY')                                   // drag start
    updateDrawing('SPY', id, { points: [{ price: 101 }] }, { record: false })
    updateDrawing('SPY', id, { points: [{ price: 105 }] }, { record: false })
    expect(prices('SPY')).toEqual([105])
    undo('SPY')                                              // one undo → pre-drag
    expect(prices('SPY')).toEqual([100])
  })

  it('snapshotHistory alone flips canUndo and notifies subscribers (drag START)', () => {
    const cb = vi.fn()
    subscribe('SPY', cb)
    expect(getSnapshot('SPY').canUndo).toBe(false)
    snapshotHistory('SPY')
    expect(cb).toHaveBeenCalledTimes(1)
    expect(getSnapshot('SPY').canUndo).toBe(true)
  })
})

describe('drawingsStore — keydown fan-out dedup', () => {
  it('double-paste: two synchronous identical adds → 1 drawing, 1 history step, same id', async () => {
    const payload = { type: 'trendline', points: [{ time: 10, price: 99 }, { time: 20, price: 101 }], locked: false }
    const id1 = addDrawing('SPY', { ...payload })
    const id2 = addDrawing('SPY', { ...payload })   // 2nd overlay, same keydown task
    expect(id2).toBe(id1)
    expect(getSnapshot('SPY').drawings).toHaveLength(1)
    expect(stored('SPY')).toHaveLength(1)
    undo('SPY')                                     // exactly ONE history step was recorded
    expect(getSnapshot('SPY').drawings).toHaveLength(0)
    expect(getSnapshot('SPY').canUndo).toBe(false)
    // separate gestures = separate tasks → identical content pastes twice legitimately
    await tick()
    addDrawing('SPY', { ...payload })
    await tick()
    addDrawing('SPY', { ...payload })
    expect(getSnapshot('SPY').drawings).toHaveLength(2)
  })

  it('double removeDrawing(sameId) records ONE history step (Delete fan-out)', async () => {
    const id = addDrawing('SPY', hz(1))
    removeDrawing('SPY', id)
    removeDrawing('SPY', id)                        // 2nd overlay: id already gone → true no-op
    expect(getSnapshot('SPY').drawings).toHaveLength(0)
    undo('SPY')                                     // ONE undo restores the drawing…
    expect(getSnapshot('SPY').drawings).toHaveLength(1)
    await tick()
    undo('SPY')                                     // …and the next step back is the add itself
    expect(getSnapshot('SPY').drawings).toHaveLength(0)
    expect(getSnapshot('SPY').canUndo).toBe(false)
  })

  it('two synchronous undos collapse into one step (Ctrl+Z fan-out); awaited ticks step again', async () => {
    addDrawing('SPY', hz(1))
    await tick()
    addDrawing('SPY', hz(2))
    undo('SPY')
    undo('SPY')                                     // same task = one keypress fan-out
    expect(prices('SPY')).toEqual([1])              // only ONE step reverted
    await tick()                                    // guard clears at end of task
    undo('SPY')
    expect(prices('SPY')).toEqual([])
    redo('SPY')
    redo('SPY')                                     // redo fan-out dedupes the same way
    expect(prices('SPY')).toEqual([1])
    await tick()
    redo('SPY')
    expect(prices('SPY')).toEqual([1, 2])
  })

  it('updateDrawing on an unknown id is a pure no-op (snapshot reference unchanged)', () => {
    addDrawing('SPY', hz(1))
    const snap = getSnapshot('SPY')
    updateDrawing('SPY', 'no-such-id', { color: '#fff' })
    expect(getSnapshot('SPY')).toBe(snap)
  })
})

describe('drawingsStore — getSnapshot/subscribe contract', () => {
  it('getSnapshot is side-effect free: unloaded sym → frozen EMPTY_SNAPSHOT, no entry created', () => {
    localStorage.setItem(STORE, JSON.stringify({ SPY: [{ id: 'x', ...hz(1) }] }))
    const s1 = getSnapshot('SPY')                   // render-time read BEFORE subscribe
    expect(s1).toBe(EMPTY_SNAPSHOT)
    expect(Object.isFrozen(s1)).toBe(true)
    expect(Object.isFrozen(s1.drawings)).toBe(true)
    expect(getSnapshot('SPY')).toBe(EMPTY_SNAPSHOT) // still no entry — no load happened in render
    subscribe('SPY', () => {})                      // refs 0→1 lazy-load replaces the snapshot object
    expect(getSnapshot('SPY')).not.toBe(EMPTY_SNAPSHOT)
    expect(getSnapshot('SPY').drawings).toHaveLength(1)
  })

  it('snapshot references are stable between changes and replaced on change', () => {
    subscribe('SPY', () => {})
    const s1 = getSnapshot('SPY')
    expect(getSnapshot('SPY')).toBe(s1)             // no infinite-render-loop bait
    addDrawing('SPY', hz(1))
    const s2 = getSnapshot('SPY')
    expect(s2).not.toBe(s1)
    expect(getSnapshot('SPY')).toBe(s2)
  })

  it('pre-seeded localStorage hydrates a mounted hook after subscribe (React recheck)', () => {
    localStorage.setItem(STORE, JSON.stringify({ SPY: [{ id: 'x', ...hz(123) }] }))
    const { result } = renderHook(() => useChartDrawings('SPY'))
    expect(result.current.drawings).toHaveLength(1)
    expect(result.current.drawings[0].points[0].price).toBe(123)
  })

  it('refcount eviction: last unsubscribe drops history; resubscribe reloads from LS', () => {
    const unsubA = subscribe('SPY', () => {})
    const unsubB = subscribe('SPY', () => {})
    addDrawing('SPY', hz(1))
    unsubA()
    expect(getSnapshot('SPY').canUndo).toBe(true)   // B keeps the shared history alive
    unsubB()
    expect(getSnapshot('SPY')).toBe(EMPTY_SNAPSHOT) // evicted with the last subscriber
    subscribe('SPY', () => {})
    expect(getSnapshot('SPY').drawings).toHaveLength(1)   // drawings reload from LS…
    expect(getSnapshot('SPY').canUndo).toBe(false)        // …history does not
  })

  it('falsy sym: frozen empty snapshot, mutations are no-ops, addDrawing still returns an id', () => {
    expect(getSnapshot('')).toBe(EMPTY_SNAPSHOT)
    const id = addDrawing('', hz(1))
    expect(typeof id).toBe('string')                // legacy-hook parity
    removeDrawing('', id)
    updateDrawing('', id, { color: '#fff' })
    clearAll('')
    reorderDrawing('', id, 'front')
    snapshotHistory('')
    undo('')
    redo('')
    expect(getSnapshot('')).toBe(EMPTY_SNAPSHOT)
    expect(localStorage.getItem(STORE)).toBeNull()
  })

  it('localStorage quota failure keeps the in-memory session consistent', () => {
    addDrawing('SPY', hz(1))
    const spy = vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => { throw new Error('QuotaExceededError') })
    addDrawing('SPY', hz(2))
    expect(getSnapshot('SPY').drawings).toHaveLength(2)   // memory advanced despite the throw
    expect(getSnapshot('SPY').canUndo).toBe(true)
    spy.mockRestore()
    expect(stored('SPY')).toHaveLength(1)                 // disk kept the last good write
    undo('SPY')
    expect(getSnapshot('SPY').drawings).toHaveLength(1)
    expect(stored('SPY')).toHaveLength(1)                 // next write reconverges disk
  })
})

describe('drawingsStore — frame-coalesced notify (browser path)', () => {
  it('latches multiple same-frame mutations into ONE rAF flush per subscriber', () => {
    const rafQ = []
    vi.stubGlobal('requestAnimationFrame', (cb) => { rafQ.push(cb); return rafQ.length })
    drawingsStore._setSyncNotify(false)
    const cb = vi.fn()
    subscribe('SPY', cb)
    addDrawing('SPY', hz(1))
    addDrawing('SPY', hz(2))
    // state + localStorage apply synchronously (no data-loss window)…
    expect(getSnapshot('SPY').drawings).toHaveLength(2)
    expect(stored('SPY')).toHaveLength(2)
    // …but delivery is latched: nothing yet, and only ONE frame callback scheduled
    expect(cb).not.toHaveBeenCalled()
    expect(rafQ).toHaveLength(1)
    rafQ.splice(0).forEach((f) => f())
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('one flush covers every pending sym', () => {
    const rafQ = []
    vi.stubGlobal('requestAnimationFrame', (cb) => { rafQ.push(cb); return rafQ.length })
    drawingsStore._setSyncNotify(false)
    const cbSpY = vi.fn()
    const cbQqq = vi.fn()
    subscribe('SPY', cbSpY)
    subscribe('QQQ', cbQqq)
    addDrawing('SPY', hz(1))
    addDrawing('QQQ', hz(2))
    expect(rafQ).toHaveLength(1)                    // one shared latch, not one per sym
    rafQ.splice(0).forEach((f) => f())
    expect(cbSpY).toHaveBeenCalledTimes(1)
    expect(cbQqq).toHaveBeenCalledTimes(1)
  })

  it('falls back to queueMicrotask when rAF is unavailable', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    drawingsStore._setSyncNotify(false)
    const cb = vi.fn()
    subscribe('SPY', cb)
    addDrawing('SPY', hz(1))
    addDrawing('SPY', hz(2))
    expect(cb).not.toHaveBeenCalled()
    await tick()
    expect(cb).toHaveBeenCalledTimes(1)             // coalesced to one microtask flush
  })
})

describe('peekDrawings — capture-time read without mounting a chart', () => {
  it('returns localStorage drawings for a sym no chart has loaded, creating no entry', () => {
    localStorage.setItem(STORE, JSON.stringify({ AMD: [{ id: 'd1', ...hz(100) }] }))
    const out = drawingsStore.peekDrawings('AMD')
    expect(out).toHaveLength(1)
    expect(out[0].points[0].price).toBe(100)
    // side-effect free: the registry still treats AMD as unloaded
    expect(getSnapshot('AMD')).toBe(EMPTY_SNAPSHOT)
  })

  it('prefers the live in-memory entry over localStorage', () => {
    subscribe('SPY', () => {})
    addDrawing('SPY', hz(1))
    addDrawing('SPY', hz(2))
    expect(drawingsStore.peekDrawings('SPY')).toHaveLength(2)
  })

  it('returns a deep copy — mutating the result never reaches the store', () => {
    subscribe('SPY', () => {})
    addDrawing('SPY', hz(7))
    const out = drawingsStore.peekDrawings('SPY')
    out[0].points[0].price = 999
    out.push({ id: 'rogue' })
    expect(getSnapshot('SPY').drawings).toHaveLength(1)
    expect(getSnapshot('SPY').drawings[0].points[0].price).toBe(7)
  })

  it('unknown sym → empty array', () => {
    expect(drawingsStore.peekDrawings('ZZZQ')).toEqual([])
  })
})
