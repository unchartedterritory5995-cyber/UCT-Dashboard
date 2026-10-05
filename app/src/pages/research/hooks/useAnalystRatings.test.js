import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// TERM-088 -- the analyst ratings hook (ANR). A failed read keeps its HTTP
// outcome; it is never collapsed to `null`, which the tab would otherwise
// read as "analyst rating data is unavailable" during a mere outage.

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock('../../../hooks/useMobileSWR') })

describe('fetchAnalystRatings', () => {
  it('keeps a refused request as ok:false with its status', async () => {
    const { fetchAnalystRatings } = await import('./useAnalystRatings')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    expect(await fetchAnalystRatings('/x')).toEqual({ ok: false, httpStatus: 503, body: null })
  })

  it('keeps a network failure as ok:false, status 0 -- not an empty record', async () => {
    const { fetchAnalystRatings } = await import('./useAnalystRatings')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await fetchAnalystRatings('/x')).toEqual({ ok: false, httpStatus: 0, body: null })
  })

  it('passes a readable answer through untouched', async () => {
    const { fetchAnalystRatings } = await import('./useAnalystRatings')
    const body = { consensus: { label: 'Buy' } }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => body })
    expect(await fetchAnalystRatings('/x')).toEqual({ ok: true, httpStatus: 200, body })
  })
})

describe('useAnalystRatings', () => {
  it('renders a 200-with-data body as data, with no error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { consensus: { label: 'Buy' } } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useAnalystRatings } = await import('./useAnalystRatings')
    const { result } = renderHook(() => useAnalystRatings('aapl'))
    expect(result.current.data).toEqual({ consensus: { label: 'Buy' } })
    expect(result.current.error).toBe(false)
  })

  it('renders a 200-with-empty body as empty data, not an error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: {} }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useAnalystRatings } = await import('./useAnalystRatings')
    const { result } = renderHook(() => useAnalystRatings('aapl'))
    expect(result.current.data).toEqual({})
    expect(result.current.error).toBe(false)
  })

  it('renders a failed fetch (500/404/network) as error:true, never silently empty', async () => {
    const swr = { data: { ok: false, httpStatus: 404, body: null }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useAnalystRatings } = await import('./useAnalystRatings')
    const { result } = renderHook(() => useAnalystRatings('aapl'))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe(true)
  })
})
