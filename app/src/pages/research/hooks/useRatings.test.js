import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// TERM-088 -- the ratings hook (RTG). A failed read keeps its HTTP outcome;
// it is never collapsed to `null`, which the tab would otherwise read as
// "ratings are unavailable" during a mere outage.

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock('../../../hooks/useMobileSWR') })

describe('fetchRatings', () => {
  it('keeps a refused request as ok:false with its status', async () => {
    const { fetchRatings } = await import('./useRatings')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    expect(await fetchRatings('/x')).toEqual({ ok: false, httpStatus: 500, body: null })
  })

  it('keeps a network failure as ok:false, status 0 -- not an empty rating', async () => {
    const { fetchRatings } = await import('./useRatings')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await fetchRatings('/x')).toEqual({ ok: false, httpStatus: 0, body: null })
  })

  it('passes a readable answer through untouched', async () => {
    const { fetchRatings } = await import('./useRatings')
    const body = { composite: 91 }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => body })
    expect(await fetchRatings('/x')).toEqual({ ok: true, httpStatus: 200, body })
  })
})

describe('useRatings', () => {
  it('renders a 200-with-data body as data, with no error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { composite: 91 } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useRatings } = await import('./useRatings')
    const { result } = renderHook(() => useRatings('aapl'))
    expect(result.current.data).toEqual({ composite: 91 })
    expect(result.current.error).toBe(false)
  })

  it('renders a 200-with-empty body as empty data, not an error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: {} }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useRatings } = await import('./useRatings')
    const { result } = renderHook(() => useRatings('aapl'))
    expect(result.current.data).toEqual({})
    expect(result.current.error).toBe(false)
  })

  it('renders a failed fetch (500/404/network) as error:true, never silently empty', async () => {
    const swr = { data: { ok: false, httpStatus: 500, body: null }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useRatings } = await import('./useRatings')
    const { result } = renderHook(() => useRatings('aapl'))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe(true)
  })

  it('returns the SAME object across re-renders with the same data (H14 shape)', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { composite: 91 } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useRatings } = await import('./useRatings')
    const { result, rerender } = renderHook(({ sym }) => useRatings(sym), { initialProps: { sym: 'aapl' } })
    const first = result.current
    rerender({ sym: 'aapl' })
    expect(result.current).toBe(first)
  })
})
