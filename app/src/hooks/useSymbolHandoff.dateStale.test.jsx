// ⭐ THE WIDE SWEEP, W2 (2026-11-25, production 07c26efed2): a held month set painted in the key task with an OLD close
// (23 of 30 presses, 68-284 ms; press 1 TXN 295.86 against 265.02): each was the answer of a warm the server had served
// from its stale store. On the store path a stale W/M copy (prefetch.dateCopyStale) takes the bounded daily prepare,
// which asks first, and B lands when it reports (or at DAILY_HOLD_MAX_MS at worst), never in the key task.
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
const st = { stale: true }
let resolveDaily = null
const dailyMock = vi.fn(() => new Promise((r) => { resolveDaily = r }))
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: () => true,
  peekBars: () => [{ t: 1 }, { t: 2 }],
  holdsBars: () => true,
  deepPending: () => false,
  dateCopyStale: vi.fn(() => st.stale),
  lakePending: () => false,
  prepareForDisplay: () => new Promise(() => {}),
  prepareDailyForDisplay: (...a) => dailyMock(...a),
  prefetchBarsToIDB: () => {},
  heldRows: () => 0,
}))
vi.mock('../utils/prefetchBars', () => ({ prefetchBarsToIDB: () => {}, prepareForDisplay: () => new Promise(() => {}), prepareDailyForDisplay: () => new Promise(() => {}) }))
vi.mock('../utils/barsMemCache', () => ({ memPeek: () => null }))
vi.mock('../components/chart/engine/serverCompute', () => ({
  columnsReadyFor: () => true,
  whenColumnsReady: () => Promise.resolve(true),
  warmColumnsFor: () => {},
}))

import useSymbolHandoff, { DAILY_HOLD_MAX_MS } from './useSymbolHandoff'

beforeEach(() => { vi.useFakeTimers(); st.stale = true; dailyMock.mockClear(); resolveDaily = null })
afterEach(() => { vi.useRealTimers() })

describe('the store path: a held week or month set the server served stale', () => {
  it('press 1 (TXN M): NOT committed in the key task; the daily prepare runs, and B lands when it reports', async () => {
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, 'M'), { initialProps: { s: 'META' } })
    act(() => { rerender({ s: 'TXN' }) })
    expect(result.current).toBe('META')                      // before: 'TXN' at once, on the old close
    expect(dailyMock).toHaveBeenCalledWith('TXN', 'M', expect.anything())
    await act(async () => { resolveDaily('current'); await Promise.resolve() })
    expect(result.current).toBe('TXN')
  })

  it('the wait is bounded: a prepare that never reports commits B at DAILY_HOLD_MAX_MS', async () => {
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, 'W'), { initialProps: { s: 'META' } })
    act(() => { rerender({ s: 'TXN' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(DAILY_HOLD_MAX_MS - 10) })
    expect(result.current).toBe('META')
    await act(async () => { await vi.advanceTimersByTimeAsync(20) })
    expect(result.current).toBe('TXN')
  })

  it('CONTROL: a held set that is not stale commits at once, with no prepare (as before)', () => {
    st.stale = false
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, 'M'), { initialProps: { s: 'META' } })
    act(() => { rerender({ s: 'RDDT' }) })
    expect(result.current).toBe('RDDT')
    expect(dailyMock).not.toHaveBeenCalled()
  })
})
