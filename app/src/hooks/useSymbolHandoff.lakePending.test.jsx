// ONE PAINT, THE WHOLE CHART (2026-11-17, owner: "it'll flash a good chunk of them and then load the rest
// just a quick blink later"). On the store path a held key paints at once only when the lake's whole depth
// is not still due for it; otherwise the handoff prepares, and the prepare (which waits for the join,
// bounded) decides when B is committed.
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
const st = { displayable: true, pending: true }
let resolvePrepare = null
const prepareMock = vi.fn(() => new Promise((r) => { resolvePrepare = r }))
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: () => st.displayable,
  lakePending: vi.fn(() => st.pending),
  prepareForDisplay: (...a) => prepareMock(...a),
  prepareDailyForDisplay: () => new Promise(() => {}),
  prefetchBarsToIDB: () => {},
}))
vi.mock('../utils/prefetchBars', () => ({ prefetchBarsToIDB: () => {}, prepareForDisplay: () => new Promise(() => {}), prepareDailyForDisplay: () => new Promise(() => {}) }))

import useSymbolHandoff from './useSymbolHandoff'

beforeEach(() => { vi.useFakeTimers(); st.displayable = true; st.pending = true; prepareMock.mockClear(); resolvePrepare = null })
afterEach(() => { vi.useRealTimers() })

describe('the store path: a held key whose lake depth is still due', () => {
  it('is NOT committed shallow: the prepare runs, and B lands when it reports', async () => {
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, '5'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    expect(result.current).toBe('A')                          // not the ~1,150-bar copy
    expect(prepareMock).toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(result.current).toBe('A')                          // the poll does not commit it either
    await act(async () => { resolvePrepare('current'); await Promise.resolve() })
    expect(result.current).toBe('B')
  })

  it('a held key whose depth is not due commits at once, with no prepare', () => {
    st.pending = false
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, '5'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    expect(result.current).toBe('B')
    expect(prepareMock).not.toHaveBeenCalled()
  })

  it('the poll commits it once the depth has joined (no longer due)', async () => {
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, '5'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    expect(result.current).toBe('A')
    st.pending = false                                        // the join landed
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(result.current).toBe('B')
  })
})
