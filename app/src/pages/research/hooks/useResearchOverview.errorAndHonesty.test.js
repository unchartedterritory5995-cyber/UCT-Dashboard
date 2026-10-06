import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// TERM-088 -- the Overview tab (DES) composes four independent reads. A
// failed read on any of them keeps its HTTP outcome; it is never collapsed
// to `null`, which the tab would otherwise read as "nothing available" during
// a mere outage. Kept in its OWN file (no static vi.mock of useMobileSWR) so
// vi.doMock + dynamic import can vary the per-url SWR state per test --
// useResearchOverview.test.js's file-level vi.mock would otherwise win.

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.doUnmock('../../../hooks/useMobileSWR')
  vi.doUnmock('../../../hooks/useLivePrices')
})

function mockOk(body) { return { ok: true, httpStatus: 200, body } }

describe('fetchResearchOverviewPart', () => {
  it('keeps a refused request as ok:false with its status', async () => {
    const { fetchResearchOverviewPart } = await import('./useResearchOverview')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    expect(await fetchResearchOverviewPart('/x')).toEqual({ ok: false, httpStatus: 500, body: null })
  })

  it('keeps a network failure as ok:false, status 0 -- not an empty card', async () => {
    const { fetchResearchOverviewPart } = await import('./useResearchOverview')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await fetchResearchOverviewPart('/x')).toEqual({ ok: false, httpStatus: 0, body: null })
  })

  it('passes a readable answer through untouched', async () => {
    const { fetchResearchOverviewPart } = await import('./useResearchOverview')
    const body = { name: 'Apple Inc.' }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => body })
    expect(await fetchResearchOverviewPart('/x')).toEqual({ ok: true, httpStatus: 200, body })
  })
})

describe('useResearchOverview -- error / H14', () => {
  it('a failed read on ONE of the four endpoints sets error:true', async () => {
    vi.doMock('../../../hooks/useMobileSWR', () => ({
      default: (url) => {
        if (url?.includes('/api/ticker-meta/')) return { data: { ok: false, httpStatus: 500, body: null }, mutate: () => {} }
        if (url?.includes('/api/fundamentals/')) return { data: mockOk({ forward_pe: 1 }), mutate: () => {} }
        if (url?.includes('/api/earnings/intel/')) return { data: mockOk({}), mutate: () => {} }
        return { data: mockOk({}), mutate: () => {} }
      },
    }))
    vi.doMock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))
    const { default: useResearchOverview } = await import('./useResearchOverview')
    const { result } = renderHook(() => useResearchOverview('AAPL'))
    expect(result.current.error).toBe(true)
    expect(result.current.meta).toEqual({})
  })

  it('all four endpoints healthy but empty is NOT an error', async () => {
    vi.doMock('../../../hooks/useMobileSWR', () => ({
      default: () => ({ data: mockOk({}), mutate: () => {} }),
    }))
    vi.doMock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))
    const { default: useResearchOverview } = await import('./useResearchOverview')
    const { result } = renderHook(() => useResearchOverview('AAPL'))
    expect(result.current.error).toBe(false)
  })

  // tq-panels: a 404 from /api/earnings/intel means the vendor holds no record for the
  // name -- "no earnings record", not an outage. A 500 there is still an error.
  it('a 404 on the analyst read is analystMissing, NOT error; a 500 is error', async () => {
    for (const [status, missing, error] of [[404, true, false], [500, false, true]]) {
      vi.doMock('../../../hooks/useMobileSWR', () => ({
        default: (url) => (url?.includes('/api/earnings/intel/')
          ? { data: { ok: false, httpStatus: status, body: null }, mutate: () => {} }
          : { data: mockOk({}), mutate: () => {} }),
      }))
      vi.doMock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))
      const { default: useResearchOverview } = await import('./useResearchOverview')
      const { result } = renderHook(() => useResearchOverview('AAPL'))
      expect(result.current.analystMissing).toBe(missing)
      expect(result.current.error).toBe(error)
      vi.resetModules()
    }
  })

  it('returns the SAME object across re-renders with the same data (H14 shape)', async () => {
    // Real SWR's `mutate` is stable per key -- these stand in for that.
    const stableMutate = { meta: () => {}, stats: () => {}, analyst: () => {}, ai: () => {} }
    const swrData = { meta: mockOk({ name: 'Apple Inc.' }), stats: mockOk({}), analyst: mockOk({}), ai: mockOk({}) }
    vi.doMock('../../../hooks/useMobileSWR', () => ({
      default: (url) => {
        if (url?.includes('/api/ticker-meta/')) return { data: swrData.meta, mutate: stableMutate.meta }
        if (url?.includes('/api/fundamentals/')) return { data: swrData.stats, mutate: stableMutate.stats }
        if (url?.includes('/api/earnings/intel/')) return { data: swrData.analyst, mutate: stableMutate.analyst }
        return { data: swrData.ai, mutate: stableMutate.ai }
      },
    }))
    // Real useLivePrices (SWR-backed) returns the SAME `prices` object across
    // renders when the underlying data hasn't changed -- this stands in for
    // that stability.
    const stablePrices = {}
    vi.doMock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: stablePrices }) }))
    const { default: useResearchOverview } = await import('./useResearchOverview')
    const { result, rerender } = renderHook(({ sym }) => useResearchOverview(sym), { initialProps: { sym: 'aapl' } })
    const first = result.current
    rerender({ sym: 'aapl' })
    expect(result.current).toBe(first)
    swrData.meta = mockOk({ name: 'Apple Inc. Updated' })
    rerender({ sym: 'aapl' })
    expect(result.current).not.toBe(first)
  })
})
