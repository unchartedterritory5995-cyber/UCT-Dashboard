// ROWS THAT COVER THE VIEW PAINT AT ONCE (2026-11-20, the owner's cold path). Reproduced in his layout
// (D + 30m, four averages, a fresh profile): every cold 30m switch waited for the lake's depth AFTER the
// server's 1,120 rows had landed (median 564 ms, p90 711), the 30m chart showing the previous ticker all
// that time; the daily side waited the deep join the same way. A held key that holds COVER_ROWS rows (the
// visible bars plus the averages' longest lookback, with a margin) now paints at once, and the depth joins
// behind the view. Fewer rows still wait, exactly as before.
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
const st = { displayable: true, lake: true, deep: true, held: true, rows: 0, answered: true }
let resolvePrepare = null
const prepareMock = vi.fn(() => new Promise((r) => { resolvePrepare = r }))
const dailyMock = vi.fn(() => new Promise(() => {}))          // the deep join never settles in these cases
const heldRows = vi.fn((sym, tf, opts = {}) => (opts.answered && !st.answered ? 0 : st.rows))
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: () => st.displayable,
  lakePending: () => st.lake,
  deepPending: () => st.deep,
  holdsBars: () => st.held,
  heldRows: (...a) => heldRows(...a),
  prepareForDisplay: (...a) => prepareMock(...a),
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

import useSymbolHandoff, { COVER_ROWS, DAILY_HOLD_MAX_MS } from './useSymbolHandoff'

beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(st, { displayable: true, lake: true, deep: true, held: true, rows: 0, answered: true })
  prepareMock.mockClear(); dailyMock.mockClear(); heldRows.mockClear(); resolvePrepare = null
})
afterEach(() => { vi.useRealTimers() })

const flip = (tf) => {
  const h = renderHook(({ s }) => useSymbolHandoff(s, tf), { initialProps: { s: 'AAA' } })
  act(() => { h.rerender({ s: 'BBB' }) })
  return h
}

describe('intraday: the lake depth still due', () => {
  it('a held key with the server\'s 1,120 rows paints at once: no prepare, no lake wait', () => {
    st.rows = 1120
    const { result } = flip('30')
    expect(result.current).toBe('BBB')
    expect(prepareMock).not.toHaveBeenCalled()
  })

  it('exactly COVER_ROWS covers the view', () => {
    st.rows = COVER_ROWS
    expect(flip('30').result.current).toBe('BBB')
  })

  it('control: one row short of COVER_ROWS still waits for the prepare (the old one-paint rule)', async () => {
    st.rows = COVER_ROWS - 1
    const { result } = flip('30')
    expect(result.current).toBe('AAA')
    expect(prepareMock).toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(result.current).toBe('AAA')
    await act(async () => { resolvePrepare('current'); await Promise.resolve() })
    expect(result.current).toBe('BBB')
  })

  it('a COLD key commits within one poll of the server\'s rows landing, the lake still loading', async () => {
    st.displayable = false
    const { result } = flip('30')
    expect(result.current).toBe('AAA')
    await act(async () => { await vi.advanceTimersByTimeAsync(110) })      // the answer: ~110 ms after Enter
    st.displayable = true; st.rows = 1120
    await act(async () => { await vi.advanceTimersByTimeAsync(25) })       // one POLL_MS
    expect(result.current).toBe('BBB')
    expect(resolvePrepare).not.toBe(null)                                  // the prepare (lake join) still running
  })
})

describe('daily: the deep history still due', () => {
  it('a cold symbol commits when the tail ANSWER covers the view, long before the deep join or the bound', async () => {
    st.held = false
    const { result } = flip('D')
    expect(dailyMock).toHaveBeenCalled()
    expect(result.current).toBe('AAA')
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    st.held = true; st.rows = 600                                          // the tail: bars=600
    await act(async () => { await vi.advanceTimersByTimeAsync(25) })
    expect(result.current).toBe('BBB')
    expect(DAILY_HOLD_MAX_MS).toBeGreaterThan(125)                         // it was not the bound that committed
  })

  it('a SAVED copy alone never commits on its rows: the answer of this life is required', async () => {
    st.rows = 3000; st.answered = false
    const { result } = flip('D')
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(result.current).toBe('AAA')
    expect(heldRows.mock.calls.some(([, , o]) => o && o.answered === true)).toBe(true)
  })

  it('control: an answer one row short of COVER_ROWS waits for the deep join (or the bound)', async () => {
    st.rows = COVER_ROWS - 1
    const { result } = flip('D')
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(result.current).toBe('AAA')
    await act(async () => { await vi.advanceTimersByTimeAsync(DAILY_HOLD_MAX_MS) })
    expect(result.current).toBe('BBB')                                     // the hold's bound, as before
  })
})
