// app/src/components/chart/engine/__tests__/serverWarm.standIn.test.js
//
// ARMING NEVER THROWS. `armServerWarm()` runs at the chart module's load. A host whose bars
// prefetch is a stand-in without the companion registry (a suite's partial `vi.mock` double is
// the real case: accessing an export a mock factory did not return THROWS) must still get its
// chart, with nothing warmed ahead, rather than no chart at all.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))
// A partial double: none of the exports serverWarm reads.
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: vi.fn() }))

beforeEach(() => { vi.resetModules() })

describe('a bars prefetch module that is a stand-in', () => {
  it('⛔ the double really does throw on the missing export (or this file proves nothing)', async () => {
    const pf = await import('../../../../utils/prefetchBars')
    expect(() => pf.registerSymbolWarmer).toThrow(/registerSymbolWarmer/)
  })

  it('arming does not throw, however often it is called', async () => {
    const { armServerWarm, serverWarmStats } = await import('../serverWarm')
    expect(() => armServerWarm()).not.toThrow()
    expect(() => armServerWarm()).not.toThrow()
    expect(serverWarmStats()).toMatchObject({ queued: 0, active: 0 })
  })

  it('a warm asked for directly still runs: the missing pack-ingest probe is read as "not ingesting"', async () => {
    const lane = await import('../serverCompute')
    const { warmSymbols, __resetServerWarm } = await import('../serverWarm')
    const { getDefinition } = await import('../nativeRegistry')
    vi.useFakeTimers()
    try {
      const calls = []
      lane.__setServerBatchFetcherForTests((url) => {
        calls.push(url)
        const n = JSON.parse(new URL(url, 'http://x').searchParams.get('asks')).length
        return Promise.resolve({ results: Array.from({ length: n }, () => ({ status: 200, envelope: { times: [1], columns: { rsLine: [1] } } })) })
      })
      __resetServerWarm({ painted: true })
      lane.serverColumnsFor(getDefinition('rsLine'), [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }], { benchmark: 'SPY' },
        { sym: 'SPY', tf: 'D', fetcher: () => new Promise(() => {}) })
      // a background (held-able) row: `_held` asks the missing probe, which must not throw
      expect(() => warmSymbols(['NVDA'], 'D', { visible: true })).not.toThrow()
      await vi.advanceTimersByTimeAsync(2000)
      expect(calls.length).toBe(1)
    } finally {
      lane.__setServerBatchFetcherForTests(null)
      vi.useRealTimers()
    }
  })
})
