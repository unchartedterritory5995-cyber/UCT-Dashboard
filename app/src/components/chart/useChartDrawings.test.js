// @vitest-environment jsdom
// Tests for useChartDrawings — persistence + undo/redo history stack.
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useChartDrawings from './useChartDrawings'

const hz = (price) => ({ type: 'horizontal', points: [{ price }] })
const STORE = 'uct-chart-drawings'
const stored = (sym) => (JSON.parse(localStorage.getItem(STORE) || '{}')[sym] || [])

beforeEach(() => localStorage.clear())

describe('useChartDrawings', () => {
  it('adds, returns an id, and persists to localStorage', () => {
    const { result } = renderHook(() => useChartDrawings('SPY'))
    let id
    act(() => { id = result.current.addDrawing(hz(100)) })
    expect(result.current.drawings).toHaveLength(1)
    expect(result.current.drawings[0].id).toBe(id)
    expect(stored('SPY')).toHaveLength(1)
  })

  it('undo then redo a single add', () => {
    const { result } = renderHook(() => useChartDrawings('SPY'))
    act(() => { result.current.addDrawing(hz(100)) })
    expect(result.current.canUndo).toBe(true)
    act(() => result.current.undo())
    expect(result.current.drawings).toHaveLength(0)
    expect(stored('SPY')).toHaveLength(0)
    expect(result.current.canRedo).toBe(true)
    act(() => result.current.redo())
    expect(result.current.drawings).toHaveLength(1)
  })

  it('coalesces a drag (snapshot + record:false) into ONE undo step', () => {
    const { result } = renderHook(() => useChartDrawings('SPY'))
    let id
    act(() => { id = result.current.addDrawing(hz(100)) })
    act(() => result.current.snapshotHistory())                            // drag start
    act(() => result.current.updateDrawing(id, { points: [{ price: 101 }] }, { record: false }))
    act(() => result.current.updateDrawing(id, { points: [{ price: 105 }] }, { record: false }))
    expect(result.current.drawings[0].points[0].price).toBe(105)
    act(() => result.current.undo())                                       // one undo → pre-drag
    expect(result.current.drawings[0].points[0].price).toBe(100)
  })

  it('a plain update IS recorded (undoable) by default', () => {
    const { result } = renderHook(() => useChartDrawings('SPY'))
    let id
    act(() => { id = result.current.addDrawing(hz(100)) })
    act(() => result.current.updateDrawing(id, { color: '#ef4444' }))
    expect(result.current.drawings[0].color).toBe('#ef4444')
    act(() => result.current.undo())
    expect(result.current.drawings[0].color).toBeUndefined()
  })

  it('remove then undo restores the drawing', () => {
    const { result } = renderHook(() => useChartDrawings('SPY'))
    let id
    act(() => { id = result.current.addDrawing(hz(100)) })
    act(() => result.current.removeDrawing(id))
    expect(result.current.drawings).toHaveLength(0)
    act(() => result.current.undo())
    expect(result.current.drawings).toHaveLength(1)
  })

  it('a new action after undo clears the redo stack', () => {
    const { result } = renderHook(() => useChartDrawings('SPY'))
    act(() => { result.current.addDrawing(hz(100)) })
    act(() => result.current.undo())
    expect(result.current.canRedo).toBe(true)
    act(() => { result.current.addDrawing(hz(200)) })
    expect(result.current.canRedo).toBe(false)
  })

  it('clearAll empties, deletes the key, and is undoable', () => {
    const { result } = renderHook(() => useChartDrawings('SPY'))
    act(() => { result.current.addDrawing(hz(100)) })
    act(() => result.current.clearAll())
    expect(result.current.drawings).toHaveLength(0)
    expect(stored('SPY')).toHaveLength(0)
    act(() => result.current.undo())
    expect(result.current.drawings).toHaveLength(1)
  })

  it('resets drawings AND history on symbol change (no undo across symbols)', () => {
    const { result, rerender } = renderHook(({ sym }) => useChartDrawings(sym), { initialProps: { sym: 'SPY' } })
    act(() => { result.current.addDrawing(hz(100)) })
    rerender({ sym: 'QQQ' })
    expect(result.current.drawings).toHaveLength(0)
    expect(result.current.canUndo).toBe(false)
  })

  it('reorderDrawing front/back moves the drawing in the z-stack and is undoable', () => {
    const { result } = renderHook(() => useChartDrawings('SPY'))
    let a, b, c
    act(() => { a = result.current.addDrawing(hz(1)) })
    act(() => { b = result.current.addDrawing(hz(2)) })
    act(() => { c = result.current.addDrawing(hz(3)) })
    expect(result.current.drawings.map(d => d.id)).toEqual([a, b, c])
    act(() => result.current.reorderDrawing(a, 'front'))   // a → end (top)
    expect(result.current.drawings.map(d => d.id)).toEqual([b, c, a])
    act(() => result.current.reorderDrawing(a, 'back'))    // a → start (bottom)
    expect(result.current.drawings.map(d => d.id)).toEqual([a, b, c])
    act(() => result.current.undo())                       // undo the send-to-back
    expect(result.current.drawings.map(d => d.id)).toEqual([b, c, a])
  })

  it('loads existing drawings for a symbol from localStorage on mount', () => {
    localStorage.setItem(STORE, JSON.stringify({ SPY: [{ id: 'x', ...hz(123) }] }))
    const { result } = renderHook(() => useChartDrawings('SPY'))
    expect(result.current.drawings).toHaveLength(1)
    expect(result.current.drawings[0].points[0].price).toBe(123)
  })
})
