// @vitest-environment jsdom
// Tests for useTracingsSync — the newer-wins bridge between the drawingsStore
// tracings layer and the preferences server. usePreferences is mocked so we drive
// prefs/setPref/loading directly; timers are faked to exercise the debounce.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import * as drawingsStore from './drawingsStore'

let mockPrefs = {}
let mockLoading = false
const setPref = vi.fn()

vi.mock('../../hooks/usePreferences', async (orig) => {
  const actual = await orig()
  return { ...actual, default: () => ({ prefs: mockPrefs, setPref, loading: mockLoading }) }
})

// Import AFTER the mock is registered.
const { default: useTracingsSync } = await import('./useTracingsSync')

const hz = (price) => ({ type: 'horizontal', points: [{ price }] })
const serverBlob = (price) => ({
  v: 1,
  tracings: [{ id: 'srv', name: 'Server', color: '#ffffff', order: 0 }],
  activeId: 'srv',
  visibleIds: ['srv'],
  byTracing: { srv: { NVDA: [{ id: 'd', ...hz(price) }] } },
})

beforeEach(() => {
  localStorage.clear()
  drawingsStore._reset()
  mockPrefs = {}
  mockLoading = false
  setPref.mockClear()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useTracingsSync', () => {
  it('adopts the server copy when it is newer than the highwatermark', () => {
    mockPrefs = { tracings_doc: JSON.stringify({ updatedAt: 5000, doc: serverBlob(42) }) }
    renderHook(() => useTracingsSync())
    expect(drawingsStore.getActiveTracingId()).toBe('srv')
    expect(drawingsStore.peekDrawings('NVDA')[0].points[0].price).toBe(42)
    expect(Number(localStorage.getItem('uct-tracings-sync-hw'))).toBe(5000)
    expect(setPref).not.toHaveBeenCalled()          // adopting must not echo a push
  })

  it('does NOT adopt a server copy that is not newer than the highwatermark', () => {
    localStorage.setItem('uct-tracings-sync-hw', '9999')
    mockPrefs = { tracings_doc: JSON.stringify({ updatedAt: 5000, doc: serverBlob(42) }) }
    renderHook(() => useTracingsSync())
    expect(drawingsStore.getActiveTracingId()).toBe('default')   // kept local
  })

  it('pushes local content up when there is no server copy', () => {
    drawingsStore.subscribe('NVDA', () => {})
    drawingsStore.addDrawing('NVDA', hz(7))
    renderHook(() => useTracingsSync())
    act(() => { vi.advanceTimersByTime(1600) })
    expect(setPref).toHaveBeenCalledTimes(1)
    const [key, value] = setPref.mock.calls[0]
    expect(key).toBe('tracings_doc')
    expect(value.doc.byTracing.default.NVDA[0].points[0].price).toBe(7)
    expect(typeof value.updatedAt).toBe('number')
  })

  it('debounces a push on any change made after hydration', () => {
    renderHook(() => useTracingsSync())                // empty store → no initial push
    act(() => { vi.advanceTimersByTime(1600) })
    expect(setPref).not.toHaveBeenCalled()
    act(() => {
      drawingsStore.subscribe('SPY', () => {})
      drawingsStore.addDrawing('SPY', hz(3))
    })
    expect(setPref).not.toHaveBeenCalled()             // still within debounce window
    act(() => { vi.advanceTimersByTime(1600) })
    expect(setPref).toHaveBeenCalledTimes(1)
  })

  it('flushes a pending push on unmount (a last-second drawing is not lost)', () => {
    const { unmount } = renderHook(() => useTracingsSync())
    act(() => {
      drawingsStore.subscribe('SPY', () => {})
      drawingsStore.addDrawing('SPY', hz(9))
    })
    expect(setPref).not.toHaveBeenCalled()             // debounce hasn't fired yet
    act(() => { unmount() })
    expect(setPref).toHaveBeenCalledTimes(1)           // flushed on unmount
  })
})
