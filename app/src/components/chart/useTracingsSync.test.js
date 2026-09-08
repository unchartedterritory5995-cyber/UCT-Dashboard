// @vitest-environment jsdom
// Tests for useTracingsSync — the newer-wins bridge between the drawingsStore
// tracings layer and the preferences server. usePreferences is mocked so we drive
// prefs/setPref/loading directly; timers are faked to exercise the debounce.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import * as drawingsStore from './drawingsStore'

let mockPrefs = {}
let mockLoading = false
// ⭐ RESOLVES A BOOLEAN, because `setPref` now reports whether the write landed
// and MOB-09's whole contract is 'the highwatermark moves only on a confirmed
// write'. A mock returning `undefined` would make every push read as FAILED and
// quietly pass the tests for the wrong reason.
let pushConfirms = true
const setPref = vi.fn(async () => pushConfirms)

vi.mock('../../hooks/usePreferences', async (orig) => {
  const actual = await orig()
  return { ...actual, default: () => ({ prefs: mockPrefs, setPref, loading: mockLoading }) }
})

// Import AFTER the mock is registered.
const { default: useTracingsSync, hasTracingContent } = await import('./useTracingsSync')

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
  pushConfirms = true
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

  it('does NOT adopt an older server copy when THIS device has its own content', () => {
    // The surviving half of the newer-wins rule. Two devices editing at once must
    // not have the older document pushed over the newer one.
    localStorage.setItem('uct-tracings-sync-hw', '9999')
    drawingsStore.subscribe('NVDA', () => {})
    drawingsStore.addDrawing('NVDA', hz(11))
    mockPrefs = { tracings_doc: JSON.stringify({ updatedAt: 5000, doc: serverBlob(42) }) }
    renderHook(() => useTracingsSync())
    expect(drawingsStore.getActiveTracingId()).toBe('default')        // kept local
    expect(drawingsStore.peekDrawings('NVDA')[0].points[0].price).toBe(11)
  })

  it('🔴 MOB-09 · HEALS A PINNED DEVICE — server has drawings, we have none', () => {
    // ⛔ THE STATE THE RESEARCH OBSERVED LIVE: the server held two SPY drawings,
    // the device held none, and the highwatermark was at or past the server's
    // version — so the strict `>` gate meant it could NEVER adopt them. The
    // drawings were invisible on that device forever.
    //
    // ⚠️ THE OLD TEST ASSERTED THIS EXACT SCENARIO STAYS PINNED. It encoded the
    // defect as the contract, which is why the defect survived a green suite.
    localStorage.setItem('uct-tracings-sync-hw', '9999')
    mockPrefs = { tracings_doc: JSON.stringify({ updatedAt: 5000, doc: serverBlob(42) }) }
    renderHook(() => useTracingsSync())
    expect(drawingsStore.getActiveTracingId(), 'the device is still pinned').toBe('srv')
    expect(drawingsStore.peekDrawings('NVDA')[0].points[0].price).toBe(42)
    // …and the mark must not travel BACKWARDS, or the heal re-fires every load.
    expect(Number(localStorage.getItem('uct-tracings-sync-hw'))).toBe(9999)
  })

  // ⚠️ NO BEHAVIOURAL RAIL FOR THE EMPTY-DOCUMENT GUARD, AND THAT IS THE HONEST
  // ANSWER. A mutation making `hasTracingContent` return true for everything
  // stayed GREEN twice: adopting an empty document is indistinguishable from not
  // adopting it (the store rejects an `activeId` naming no tracing and falls back
  // to `default`, and neither path pushes when the local store is empty). The
  // guard is DEFENSIVE — it keeps the predicate honest if `hasLocalTracingContent`
  // ever changes meaning — not load-bearing. So it is gated where it can actually
  // fail: as a pure function. A rail that cannot go red is worse than none,
  // because it reads as coverage.
  describe('hasTracingContent — the predicate, tested where it can fail', () => {
    it('an empty or malformed document is NOT content', () => {
      for (const d of [null, undefined, 0, 'x', {}, { tracings: [], byTracing: {} }]) {
        expect(hasTracingContent(d), `${JSON.stringify(d)} counted as content`).toBe(false)
      }
    })
    it('a document carrying anything IS content', () => {
      expect(hasTracingContent({ tracings: [{ id: 'a' }] })).toBe(true)
      expect(hasTracingContent({ byTracing: { default: { SPY: [{ id: 'd' }] } } })).toBe(true)
    })
  })

  it('🔴 MOB-09 · the highwatermark does NOT move when the push is not confirmed', async () => {
    // The ordering defect itself. A lost push used to advance the mark anyway,
    // which is what created the pinned devices above.
    pushConfirms = false
    renderHook(() => useTracingsSync())
    await act(async () => {
      drawingsStore.subscribe('SPY', () => {})
      drawingsStore.addDrawing('SPY', hz(3))
      vi.advanceTimersByTime(1600)
      await Promise.resolve()
    })
    expect(setPref).toHaveBeenCalledTimes(1)
    expect(Number(localStorage.getItem('uct-tracings-sync-hw')) || 0,
      'the mark advanced on a write that never landed',
    ).toBe(0)
  })

  it('…and DOES move when the push is confirmed', async () => {
    pushConfirms = true
    renderHook(() => useTracingsSync())
    await act(async () => {
      drawingsStore.subscribe('SPY', () => {})
      drawingsStore.addDrawing('SPY', hz(3))
      vi.advanceTimersByTime(1600)
      await Promise.resolve()
    })
    expect(Number(localStorage.getItem('uct-tracings-sync-hw')),
      'a confirmed write left the mark unmoved — the next load will re-adopt forever',
    ).toBeGreaterThan(0)
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
