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
const cols = { ready: true, resolve: null }
const warmColumnsFor = vi.fn()
vi.mock('../components/chart/engine/serverCompute', () => ({
  columnsReadyFor: () => cols.ready,
  whenColumnsReady: () => new Promise((r) => { cols.resolve = r }),
  warmColumnsFor: (...a) => warmColumnsFor(...a),
}))

import useSymbolHandoff from './useSymbolHandoff'

beforeEach(() => { vi.useFakeTimers(); st.displayable = true; st.pending = true; prepareMock.mockClear(); resolvePrepare = null; cols.ready = true; cols.resolve = null; warmColumnsFor.mockClear() })
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

  // 2026-11-18, production 60m (URI): the columns request left only from the commit's wait, after the
  // prepare reported (~235 ms); the wait ran out at 535 ms and the RS lines landed 167 ms after the candles.
  it("the panes' columns are asked for at Enter, beside the bars, before the prepare reports", () => {
    const { rerender } = renderHook(({ s }) => useSymbolHandoff(s, '5'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    expect(prepareMock).toHaveBeenCalled()
    expect(resolvePrepare).not.toBe(null)                    // the prepare is still running
    expect(warmColumnsFor).toHaveBeenCalledWith('B', '5')
  })

  it('a held key whose depth is not due commits at once, with no prepare', () => {
    st.pending = false
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, '5'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    expect(result.current).toBe('B')
    expect(prepareMock).not.toHaveBeenCalled()
  })

  it('B whose panes\' server columns have not landed is shown only when they land (one paint)', async () => {
    st.pending = false
    cols.ready = false
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, '5'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    expect(result.current).toBe('A')                          // candles held, not shown without the panes
    await act(async () => { cols.resolve(true); await Promise.resolve() })
    expect(result.current).toBe('B')
  })

  it('the bounded wait commits B even when the columns never land', async () => {
    st.pending = false
    cols.ready = false
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, '5'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    await act(async () => { cols.resolve(false); await Promise.resolve() })   // whenColumnsReady's bound passed
    expect(result.current).toBe('B')
  })

  it('a newer request wins over a columns wait still running: B is never rendered after C', async () => {
    st.pending = false
    cols.ready = false
    const seen = []
    const { result, rerender } = renderHook(({ s }) => { const v = useSymbolHandoff(s, '5'); seen.push(v); return v }, { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    const resolveB = cols.resolve
    cols.ready = true
    act(() => { rerender({ s: 'C' }) })
    expect(result.current).toBe('C')
    await act(async () => { resolveB(true); await Promise.resolve(); await Promise.resolve() })
    expect(result.current).toBe('C')
    expect(seen.slice(seen.indexOf('C'))).not.toContain('B')   // not even one frame of B over C
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
