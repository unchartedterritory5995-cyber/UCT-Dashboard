// @vitest-environment jsdom
// Tests for useTracings — the React binding over the tracings layer of drawingsStore.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useTracings from './useTracings'
import * as drawingsStore from './drawingsStore'

beforeEach(() => {
  localStorage.clear()
  drawingsStore._reset()
})
afterEach(() => { vi.restoreAllMocks() })

describe('useTracings', () => {
  it('exposes the default sheet + ids on first render', () => {
    const { result } = renderHook(() => useTracings())
    expect(result.current.tracings).toHaveLength(1)
    expect(result.current.activeId).toBe('default')
    expect(result.current.visibleIds).toEqual(['default'])
  })

  it('re-renders when a sheet is created', () => {
    const { result } = renderHook(() => useTracings())
    act(() => { result.current.createTracing() })
    expect(result.current.tracings).toHaveLength(2)
  })

  it('re-renders when the active sheet switches', () => {
    const { result } = renderHook(() => useTracings())
    let bId
    act(() => { bId = result.current.createTracing() })
    act(() => { result.current.setActiveTracing(bId) })
    expect(result.current.activeId).toBe(bId)
  })

  it('rename + recolor flow through to the snapshot', () => {
    const { result } = renderHook(() => useTracings())
    act(() => { result.current.renameTracing('default', 'Levels') })
    act(() => { result.current.recolorTracing('default', '#123456') })
    const t = result.current.tracings[0]
    expect(t.name).toBe('Levels')
    expect(t.color).toBe('#123456')
  })

  it('reflects a store change made outside the hook', () => {
    const { result } = renderHook(() => useTracings())
    act(() => { drawingsStore.createTracing({ name: 'External' }) })
    expect(result.current.tracings.map((t) => t.name)).toContain('External')
  })
})
