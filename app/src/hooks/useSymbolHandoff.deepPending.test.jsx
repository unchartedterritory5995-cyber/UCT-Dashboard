// ONE PAINT, THE WHOLE DAILY CHART (2026-11-19, owner: "about 200 bars instantly and then the rest
// shortly after, definitely in 2 phases"). On the store path a held D/W/M set paints at once only when
// its deep sealed history is not still due; otherwise the handoff takes the bounded daily prepare
// (which waits for the join), and B is committed when it reports, or at DAILY_HOLD_MAX_MS at worst.
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
const st = { held: true, deep: true }
let resolveDaily = null
const dailyMock = vi.fn(() => new Promise((r) => { resolveDaily = r }))
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: () => true,
  peekBars: () => (st.held ? [{ t: 1 }, { t: 2 }] : null),
  holdsBars: () => !!st.held,
  deepPending: vi.fn(() => st.deep),
  lakePending: () => false,
  prepareForDisplay: () => new Promise(() => {}),
  prepareDailyForDisplay: (...a) => dailyMock(...a),
  prefetchBarsToIDB: () => {},
}))
vi.mock('../utils/prefetchBars', () => ({ prefetchBarsToIDB: () => {}, prepareForDisplay: () => new Promise(() => {}), prepareDailyForDisplay: () => new Promise(() => {}) }))
vi.mock('../utils/barsMemCache', () => ({ memPeek: () => null }))
vi.mock('../components/chart/engine/serverCompute', () => ({
  columnsReadyFor: () => true,
  whenColumnsReady: () => Promise.resolve(true),
  warmColumnsFor: () => {},
}))

import useSymbolHandoff, { DAILY_HOLD_MAX_MS } from './useSymbolHandoff'

beforeEach(() => { vi.useFakeTimers(); st.held = true; st.deep = true; dailyMock.mockClear(); resolveDaily = null })
afterEach(() => { vi.useRealTimers() })

describe('the store path: a held daily set whose deep history is still due', () => {
  it('is NOT committed shallow: the daily prepare runs, and B lands when it reports', async () => {
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, 'D'), { initialProps: { s: 'AAA' } })
    act(() => { rerender({ s: 'BBB' }) })
    expect(result.current).toBe('AAA')                       // not the pack's ~300 rows
    expect(dailyMock).toHaveBeenCalledWith('BBB', 'D', expect.anything())
    await act(async () => { resolveDaily('current'); await Promise.resolve() })
    expect(result.current).toBe('BBB')
  })

  it('the wait is bounded: a prepare that never reports commits B at DAILY_HOLD_MAX_MS', async () => {
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, 'D'), { initialProps: { s: 'AAA' } })
    act(() => { rerender({ s: 'BBB' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(DAILY_HOLD_MAX_MS - 10) })
    expect(result.current).toBe('AAA')
    await act(async () => { await vi.advanceTimersByTimeAsync(20) })
    expect(result.current).toBe('BBB')
  })

  it('a held set whose deep history is not due commits at once, with no prepare', () => {
    st.deep = false
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, 'D'), { initialProps: { s: 'AAA' } })
    act(() => { rerender({ s: 'BBB' }) })
    expect(result.current).toBe('BBB')
    expect(dailyMock).not.toHaveBeenCalled()
  })

  it('a set not held at all still takes the prepare (as before)', async () => {
    st.held = false
    st.deep = false
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, 'D'), { initialProps: { s: 'AAA' } })
    act(() => { rerender({ s: 'BBB' }) })
    expect(result.current).toBe('AAA')
    expect(dailyMock).toHaveBeenCalled()
    await act(async () => { resolveDaily('current'); await Promise.resolve() })
    expect(result.current).toBe('BBB')
  })
})
