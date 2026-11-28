// ⭐⭐ THE 2026-11-28 COLD-COVERAGE RUN (production, fresh never-viewed tickers, typed Enter), two switch defects:
//
//  (1) 4h + 2h zoomed out: a SHORT first page and then the jump on 6 of 6 presses. A custom intraday timeframe resamples
//      its native base (60m for 4h and 2h) and the switch passed every custom code straight through ('now'), so it
//      painted whatever 60m rows were held (287 4h bars under a ~790-bar view) and the lake's depth then rebuilt it.
//      Now the switch asks the base the native questions, with the view's need in base rows (routeView).
//  (2) W + M: the previous chart held ~4 s (the hang guard) on 4 of 6 presses. A monthly view asks 600 months, more than
//      most listings have, so the daily hold waits for the deep history's join to say "nothing more is coming"; it asked
//      that only at the prepare's report and the DAILY_HOLD_MAX_MS bound (~400 ms), and the monthly history (a cold
//      origin build) settled later, so only the hang guard ended the wait. The watcher now asks it on every wake.
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
const st = { displayable: true, lake: true, deep: true, held: true, rows: 0, answered: false, device: false }
const prepareMock = vi.fn(() => new Promise(() => {}))
const heldRows = vi.fn((sym, tf, opts = {}) => (opts.answered && !st.answered ? 0 : st.rows))
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: () => st.displayable,
  lakePending: () => st.lake,
  deepPending: () => st.deep,
  holdsBars: () => st.held,
  devicePaints: () => st.device,
  heldRows: (...a) => heldRows(...a),
  prepareForDisplay: (...a) => prepareMock(...a),
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
vi.mock('../data/deviceStore/switch', () => ({ deviceStoreEnabled: () => false }))

import useSymbolHandoff, { COVER_ROWS, VIEW_LOOKBACK_ROWS, routeView } from './useSymbolHandoff'
import { noteMemberView } from '../components/chart/paintLog'
import { baseBarsFor } from '../components/chart/timeframes'

beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(st, { displayable: true, lake: true, deep: true, held: true, rows: 0, answered: false, device: false })
  prepareMock.mockClear(); heldRows.mockClear()
})
afterEach(() => { vi.useRealTimers() })

const flip = (tf, member = null) => {
  const h = renderHook(({ s }) => useSymbolHandoff(s, tf, { member }), { initialProps: { s: 'AAA' } })
  act(() => { h.rerender({ s: 'BBB' }) })
  return h
}
const zoomedOut = (span = 791) => { const m = {}; noteMemberView(m, span); return m }

describe('(1) a custom intraday timeframe is decided on its native base, in base rows', () => {
  it('routeView: 4h and 2h map to the 60m key with the need in 60m rows; native and D/W/M-based codes are unchanged', () => {
    expect(routeView('240', 1191)).toEqual({ tf: '60', need: baseBarsFor('240', 1191) })
    expect(routeView('120', 1191)).toEqual({ tf: '60', need: baseBarsFor('120', 1191) })
    expect(routeView('45', 600)).toEqual({ tf: '15', need: baseBarsFor('45', 600) })
    expect(routeView('60', 600)).toEqual({ tf: '60', need: 600 })
    expect(routeView('2D', 600)).toEqual({ tf: '2D', need: 600 })
  })

  it('4h zoomed out, the 60m first page held (~1,000 rows) and the lake still due: the previous chart stays (no short page)', () => {
    st.rows = 1000; st.answered = true
    const { result } = flip('240', zoomedOut())
    expect(result.current).toBe('AAA')
    expect(prepareMock).toHaveBeenCalled()
    expect(prepareMock.mock.calls[0][1]).toBe('60')                  // the base key is prepared
    expect(heldRows.mock.calls.some((c) => c[1] === '60')).toBe(true) // and counted
  })

  it('...and shows the moment the base rows cover the 4h view (the lake joined)', async () => {
    st.rows = 1000; st.answered = true
    const { result } = flip('240', zoomedOut())
    expect(result.current).toBe('AAA')
    st.rows = baseBarsFor('240', 791 + VIEW_LOOKBACK_ROWS)
    await act(async () => { await vi.advanceTimersByTimeAsync(30) })
    expect(result.current).toBe('BBB')
  })

  it('control: base rows that already cover the 4h view show at once', () => {
    st.rows = baseBarsFor('240', 791 + VIEW_LOOKBACK_ROWS); st.answered = true
    expect(flip('240', zoomedOut()).result.current).toBe('BBB')
  })

  it('control: a young listing (the lake settled, the server answered, short of the view) shows what there is', () => {
    st.rows = 300; st.answered = true; st.lake = false
    expect(flip('120', zoomedOut()).result.current).toBe('BBB')
  })
})

describe('(2) the daily hold ends when nothing more is coming, not at the hang guard', () => {
  it('M, a 145-month listing (short of the 600-month view): the deep join settling after the bound shows it at once', async () => {
    st.rows = 145; st.answered = true; st.deep = true
    const { result } = flip('M')
    expect(result.current).toBe('AAA')                                // the deep history is still due: hold
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })  // past DEEP_JOIN_WAIT_MS and DAILY_HOLD_MAX_MS
    expect(result.current).toBe('AAA')
    st.deep = false                                                   // the monthly history's join settles (adds nothing)
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    expect(result.current).toBe('BBB')                                // ~1 s, not the 4 s hang guard
  })

  it('W zoomed out wider than the whole history: the same exit', async () => {
    st.rows = 629; st.answered = true; st.deep = true
    const { result } = flip('W', zoomedOut(791))
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(result.current).toBe('AAA')
    st.deep = false
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    expect(result.current).toBe('BBB')
  })

  it("control: the join settled but this life's answer is not held yet: still waits (more is coming)", async () => {
    st.rows = 145; st.answered = false; st.deep = true
    const { result } = flip('M')
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    st.deep = false
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    expect(result.current).toBe('AAA')
  })

  it('control: while the deep history is still due, a short set never shows before the hang guard', async () => {
    st.rows = 145; st.answered = true; st.deep = true
    const { result } = flip('M')
    await act(async () => { await vi.advanceTimersByTimeAsync(3800) })
    expect(result.current).toBe('AAA')
    expect(COVER_ROWS).toBeGreaterThan(145)
  })
})
