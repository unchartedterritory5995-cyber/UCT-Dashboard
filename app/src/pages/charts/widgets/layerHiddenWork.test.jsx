// Per-path rails for work a hidden LAYER keep-alive board must not do (2026-11-27, review of #2901, H3). A kept board
// stays mounted; each of these kept running on every hidden widget. (The full widget census is not mounted here: see
// the PR. Covered paths here: the chart header's market clock, the realtime bar prices behind ChartDayGain and the
// Theme Tracker, the trade-exchange news days poll and clock; the crosshair bus is CX1 in ChartWidget.layerCapture. The
// Scatter poll, the trade-exchange age tick, the dock news clock and the AI search phase timer use the same
// forwardWhileShown and are not railed.)
//   HW1 (red first) the market clock ticks no render on a hidden board; the show sets the time once, in its own task
//   HW2 (red first) realtime bar prices: ticks on a hidden board re-render nothing (the shared stream stays); the show
//       sets what landed, in its own task
//   HW3 (red first) the trade-exchange news days poll fetches nothing and its clock renders nothing on a hidden board
//       over 30 minutes; the show polls once and sets the clock, in its own task
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, renderHook, act, cleanup } from '@testing-library/react'
import { Profiler } from 'react'

const bars = vi.hoisted(() => ({ subs: new Map() }))
vi.mock('../../../lib/barsStreamManager', () => ({
  subscribe: (sym, tf, { onBar }) => { bars.subs.set(sym, onBar); return () => bars.subs.delete(sym) },
}))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: true, isPremarket: false, isExtended: false }) }))
const ten = vi.hoisted(() => ({ days: 0 }))
vi.mock('../../../lib/tradeExchangeNewsStreamManager', () => ({
  fetchDays: () => { ten.days++; return Promise.resolve({ today: null, days: [] }) },
  fetchDay: () => Promise.resolve({ rows: [], total: 0 }),
}))

const { default: ChartMarketClock } = await import('./ChartMarketClock')
const { default: useRealtimeBarPrices } = await import('../../../hooks/useRealtimeBarPrices')
const { default: useTradeExchangeNewsDay } = await import('./useTradeExchangeNewsDay')
const { BoardVisibilityContext, createBoardVisibility } = await import('../../../components/chart/boardVisibility')

afterEach(() => { cleanup(); vi.useRealTimers(); bars.subs.clear() })

describe('work a hidden layer board does not do', () => {
  it('HW1 (red first) the market clock ticks no render on a hidden board', () => {
    vi.useFakeTimers()
    const vis = createBoardVisibility({ layer: true })
    let commits = 0
    render(<BoardVisibilityContext.Provider value={vis}><Profiler id="clock" onRender={() => { commits++ }}><ChartMarketClock /></Profiler></BoardVisibilityContext.Provider>)
    act(() => { vi.advanceTimersByTime(3000) })
    expect(commits, 'NON-VACUITY: a shown clock ticks').toBeGreaterThan(1)
    act(() => { vis.set('hidden') })
    const before = commits
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(commits - before, 'a hidden board clock rendered').toBe(0)
    act(() => { vis.set('visible') })
    expect(commits - before, 'the show did not set the time in its own task').toBe(1)
  })

  it('HW2 (red first) realtime bar prices re-render nothing while hidden; the show sets what landed', async () => {
    const vis = createBoardVisibility({ layer: true })
    let renders = 0
    const view = renderHook(() => { renders++; return useRealtimeBarPrices(['AAPL']) }, {
      wrapper: ({ children }) => <BoardVisibilityContext.Provider value={vis}>{children}</BoardVisibilityContext.Provider>,
    })
    const frame = () => act(async () => { await new Promise((r) => setTimeout(r, 40)) })
    act(() => { bars.subs.get('AAPL')({ bar: { t: 1, c: 10 } }) })
    await frame()
    expect(view.result.current.AAPL?.price, 'NON-VACUITY: a shown board takes a tick').toBe(10)
    act(() => { vis.set('hidden') })
    const before = renders
    act(() => { bars.subs.get('AAPL')({ bar: { t: 2, c: 11 } }) })
    await frame()
    expect(bars.subs.has('AAPL'), 'the shared stream was left (a stale price at the show)').toBe(true)
    expect(renders - before, 'a tick re-rendered a hidden board').toBe(0)
    act(() => { vis.set('visible') })
    expect(view.result.current.AAPL?.price, 'the show did not set what landed, in its own task').toBe(11)
  })

  it('HW3 (red first) the trade-exchange days poll and clock do nothing on a hidden board; the show runs each once', async () => {
    vi.useFakeTimers()
    ten.days = 0
    const vis = createBoardVisibility({ layer: true })
    let renders = 0
    const feed = { epoch: 1, rows: [] }
    const args = { feed, matches: [], request: { q: '' }, enabled: true }
    renderHook(() => { renders++; return useTradeExchangeNewsDay(args) }, {
      wrapper: ({ children }) => <BoardVisibilityContext.Provider value={vis}>{children}</BoardVisibilityContext.Provider>,
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000) })
    expect(ten.days, 'NON-VACUITY: a shown board polls the days').toBeGreaterThan(1)
    act(() => { vis.set('hidden') })
    const days = ten.days, before = renders
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000) })
    expect(ten.days - days, 'a hidden board polled the days').toBe(0)
    expect(renders - before, 'a hidden board clock rendered').toBe(0)
    act(() => { vis.set('visible') })
    expect(ten.days - days, 'the show did not poll once, in its own task').toBe(1)
  })
})
