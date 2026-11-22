// THE SETTLE IN THE HANDOFF (2026-11-20, the trace): a switch is ONE pass of the chart widget. The burst rule
// (useSymbolSettle.settleAction) is decided inside the handoff's own effect, so a quiet request costs no extra
// render; a request inside a burst waits BURST_SETTLE_MS unless its rows are warm, and the newest request wins.
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: () => true,
  lakePending: () => false,
  deepPending: () => false,
  holdsBars: () => true,
  heldRows: () => 0,
  prepareForDisplay: () => new Promise(() => {}),
  prepareDailyForDisplay: () => new Promise(() => {}),
  prefetchBarsToIDB: () => {},
}))
vi.mock('../utils/prefetchBars', () => ({ prefetchBarsToIDB: () => {}, prepareForDisplay: () => new Promise(() => {}), prepareDailyForDisplay: () => new Promise(() => {}) }))
vi.mock('../utils/barsMemCache', () => ({ memPeek: () => null }))
vi.mock('../components/chart/engine/serverCompute', () => ({
  columnsReadyFor: () => true,
  whenColumnsReady: () => Promise.resolve(true),
  warmColumnsFor: () => {},
}))

import useSymbolHandoff from './useSymbolHandoff'
import useSymbolSettle, { BURST_SETTLE_MS, QUIET_MS } from './useSymbolSettle'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000) })
afterEach(() => { vi.useRealTimers() })

const settle = (warm = false) => ({ debounceMs: 90, isWarm: () => warm })

describe('the settle decided in the handoff', () => {
  it('a quiet request: B is shown with ONE render after the request (no settle pass)', () => {
    let renders = 0
    const h = renderHook(({ s }) => { renders++; return useSymbolHandoff(s, '30', { settle: settle() }) }, { initialProps: { s: 'AAA' } })
    const r0 = renders
    act(() => { h.rerender({ s: 'BBB' }) })
    expect(h.result.current).toBe('BBB')
    expect(renders - r0).toBe(2)                 // the request's render + the commit's render
  })

  it('control: the old chain (useSymbolSettle, then the handoff) costs one render more for the same switch', () => {
    let renders = 0
    const h = renderHook(({ s }) => { renders++; return useSymbolHandoff(useSymbolSettle(s, { debounceMs: 90, isWarm: () => false }), '30') }, { initialProps: { s: 'AAA' } })
    const r0 = renders
    act(() => { h.rerender({ s: 'BBB' }) })
    expect(h.result.current).toBe('BBB')
    expect(renders - r0).toBe(3)
  })

  it('inside a burst a cold request waits BURST_SETTLE_MS, and the newest request wins (the replaced one never shows)', async () => {
    const seen = []
    const h = renderHook(({ s }) => { const v = useSymbolHandoff(s, '30', { settle: settle(false) }); seen.push(v); return v }, { initialProps: { s: 'AAA' } })
    act(() => { h.rerender({ s: 'BBB' }) })                 // quiet: at once
    expect(h.result.current).toBe('BBB')
    await act(async () => { await vi.advanceTimersByTimeAsync(40) })
    act(() => { h.rerender({ s: 'CCC' }) })                 // 40 ms later: a burst
    expect(h.result.current).toBe('BBB')
    await act(async () => { await vi.advanceTimersByTimeAsync(40) })
    act(() => { h.rerender({ s: 'DDD' }) })                 // replaces CCC
    await act(async () => { await vi.advanceTimersByTimeAsync(BURST_SETTLE_MS - 40 + 5) })   // CCC's own settle time
    expect(h.result.current).toBe('BBB')                    // CCC was replaced: its timer never shows it
    await act(async () => { await vi.advanceTimersByTimeAsync(45) })
    expect(h.result.current).toBe('DDD')
    expect(seen).not.toContain('CCC')
  })

  it('inside a burst a WARM request is shown at once once the last one is BURST_SETTLE_MS old', async () => {
    const h = renderHook(({ s }) => useSymbolHandoff(s, '30', { settle: settle(true) }), { initialProps: { s: 'AAA' } })
    act(() => { h.rerender({ s: 'BBB' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(BURST_SETTLE_MS + 10) })
    expect(BURST_SETTLE_MS + 10).toBeLessThan(QUIET_MS)    // still a burst by the clock
    act(() => { h.rerender({ s: 'CCC' }) })
    expect(h.result.current).toBe('CCC')
  })

  it('debounceMs 0 passes every request straight through (a host that warms its own rows)', async () => {
    const h = renderHook(({ s }) => useSymbolHandoff(s, '30', { settle: { debounceMs: 0 } }), { initialProps: { s: 'AAA' } })
    act(() => { h.rerender({ s: 'BBB' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    act(() => { h.rerender({ s: 'CCC' }) })
    expect(h.result.current).toBe('CCC')
  })
})
