// The Monitor's universe switcher in the windowed data source: per-universe SWR keys, block
// URLs, EXACT localStorage keys, separate row caches, and a body for another universe is never
// cached as this one's rows.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useMonitorGrid, { monitorDatesKey } from './useMonitorGrid'

const D = ['2026-11-17', '2026-11-16', '2026-11-13']
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>
)

function server({ liveRow = null, wrongUniverse = false } = {}) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn((u) => {
    const url = String(u)
    calls.push(url)
    const m = /universe=(\w+)/.exec(url)
    const uni = m ? m[1] : 'uct'
    if (url.includes('/dates')) {
      return ok({ dates: D, min: D[2], max: D[0], ...(uni !== 'uct' ? { universe: uni, live_row: liveRow } : {}) })
    }
    const rows = D.map((date) => ({ date, pct_above_50sma: uni === 'uct' ? 50 : 40, _universe: uni }))
    return ok({ rows, ...(uni !== 'uct' ? { universe: wrongUniverse ? 'uct' : uni } : {}) })
  }))
  return calls
}

beforeEach(() => { try { localStorage.clear() } catch { /* jsdom */ } })
afterEach(() => vi.unstubAllGlobals())

describe('useMonitorGrid per universe', () => {
  it('UCT keeps its historical SWR key and URLs (no universe param anywhere)', async () => {
    const calls = server()
    expect(monitorDatesKey()).toBe('/api/breadth-monitor/dates')
    expect(monitorDatesKey('uct')).toBe('/api/breadth-monitor/dates')
    const { result } = renderHook(() => useMonitorGrid({ enabled: true, liveRow: null }), { wrapper })
    await waitFor(() => expect(result.current.count).toBe(3))
    act(() => { result.current.ensureRange(0, 2) })
    await waitFor(() => expect(result.current.getRow(0)?.pct_above_50sma).toBe(50))
    expect(calls.every((u) => !u.includes('universe='))).toBe(true)
    expect(JSON.parse(localStorage.getItem('uct.breadth.dates.v1')).dates).toEqual(D)
    expect(JSON.parse(localStorage.getItem('uct.breadth.recent.v1'))).toHaveLength(3)
  })

  it('a universe reads its own dates + blocks and writes its own EXACT localStorage keys', async () => {
    const calls = server()
    expect(monitorDatesKey('nasdaq')).toBe('/api/breadth-monitor/dates?universe=nasdaq')
    const { result } = renderHook(() => useMonitorGrid({ enabled: true, liveRow: null, universe: 'nasdaq' }), { wrapper })
    await waitFor(() => expect(result.current.count).toBe(3))
    act(() => { result.current.ensureRange(0, 2) })
    await waitFor(() => expect(result.current.getRow(0)?.pct_above_50sma).toBe(40))
    expect(calls).toContain('/api/breadth-monitor/dates?universe=nasdaq')
    expect(calls.some((u) => u.startsWith('/api/breadth-monitor?days=3&end=2026-11-17&anchor=le&universe=nasdaq'))).toBe(true)
    expect(JSON.parse(localStorage.getItem('uct.breadth.dates.v1.nasdaq')).dates).toEqual(D)
    expect(JSON.parse(localStorage.getItem('uct.breadth.recent.v1.nasdaq'))[0]._universe).toBe('nasdaq')
    expect(localStorage.getItem('uct.breadth.dates.v1')).toBeNull()
    expect(localStorage.getItem('uct.breadth.recent.v1')).toBeNull()
  })

  it('switching universes never shows the other universe’s rows, and switching back is from memory', async () => {
    const calls = server()
    const { result, rerender } = renderHook(({ u }) => useMonitorGrid({ enabled: true, liveRow: null, universe: u }),
      { wrapper, initialProps: { u: 'uct' } })
    await waitFor(() => expect(result.current.count).toBe(3))
    act(() => { result.current.ensureRange(0, 2) })
    await waitFor(() => expect(result.current.getRow(0)?.pct_above_50sma).toBe(50))
    rerender({ u: 'nyse' })
    expect(result.current.universe).toBe('nyse')
    expect(result.current.getRow(0)?.pct_above_50sma ?? null).not.toBe(50)   // never UCT's row
    await waitFor(() => expect(result.current.count).toBe(3))
    act(() => { result.current.ensureRange(0, 2) })
    await waitFor(() => expect(result.current.getRow(0)?._universe).toBe('nyse'))
    const before = calls.filter((u) => !u.includes('/dates')).length
    rerender({ u: 'uct' })
    expect(result.current.getRow(0)?.pct_above_50sma).toBe(50)              // instant: from memory
    act(() => { result.current.ensureRange(0, 2) })
    await new Promise((r) => setTimeout(r, 150))
    expect(calls.filter((u) => !u.includes('/dates')).length).toBe(before)  // no refetch of loaded blocks
  })

  it('a body stamped for another universe is never cached as this universe’s rows', async () => {
    server({ wrongUniverse: true })
    const { result } = renderHook(() => useMonitorGrid({ enabled: true, liveRow: null, universe: 'us' }), { wrapper })
    await waitFor(() => expect(result.current.count).toBe(3))
    act(() => { result.current.ensureRange(0, 2) })
    await waitFor(() => expect(result.current.blocksFailed).toBe(1))
    expect(result.current.getRow(0)).toBeNull()
  })

  it("off UCT the live row is the universe's own, with UCT's live market-wide readings", async () => {
    server({ liveRow: { date: '2026-11-18', universe_count: 2900, pct_above_50sma: 41, vix: null, _live: true } })
    const uctLive = { date: '2026-11-18', universe_count: 3700, pct_above_50sma: 55, vix: 17, _live: true }
    const { result } = renderHook(() => useMonitorGrid({ enabled: true, liveRow: uctLive, universe: 'nasdaq' }), { wrapper })
    await waitFor(() => expect(result.current.count).toBe(4))
    expect(result.current.allDates[0]).toBe('2026-11-18')
    const live = result.current.getRow(0)
    expect(live.universe_count).toBe(2900)
    expect(live.pct_above_50sma).toBe(41)
    expect(live.vix).toBe(17)
  })
})
