import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// TERM-088 -- the company news hook (CN). A failed read keeps its HTTP outcome;
// it is never collapsed to `null`, which the tab would otherwise read as
// "no recent news" during a mere outage.

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock('../../../hooks/useMobileSWR') })

describe('fetchCompanyNews', () => {
  it('keeps a refused request as ok:false with its status', async () => {
    const { fetchCompanyNews } = await import('./useCompanyNews')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    expect(await fetchCompanyNews('/x')).toEqual({ ok: false, httpStatus: 500, body: null })
  })

  it('keeps a network failure as ok:false, status 0 -- not an empty news feed', async () => {
    const { fetchCompanyNews } = await import('./useCompanyNews')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await fetchCompanyNews('/x')).toEqual({ ok: false, httpStatus: 0, body: null })
  })

  it('passes a readable answer through untouched', async () => {
    const { fetchCompanyNews } = await import('./useCompanyNews')
    const body = { items: [{ id: 1, headline: 'x' }] }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => body })
    expect(await fetchCompanyNews('/x')).toEqual({ ok: true, httpStatus: 200, body })
  })
})

describe('useCompanyNews', () => {
  it('renders a 200-with-data body as data, with no error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { items: [{ id: 1 }] } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useCompanyNews } = await import('./useCompanyNews')
    const { result } = renderHook(() => useCompanyNews('aapl'))
    expect(result.current.data).toEqual({ items: [{ id: 1 }] })
    expect(result.current.error).toBe(false)
  })

  it('renders a 200-with-empty body as empty data, not an error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { items: [] } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useCompanyNews } = await import('./useCompanyNews')
    const { result } = renderHook(() => useCompanyNews('aapl'))
    expect(result.current.data).toEqual({ items: [] })
    expect(result.current.error).toBe(false)
  })

  it('renders a failed fetch (500/404/network) as error:true, never silently empty', async () => {
    const swr = { data: { ok: false, httpStatus: 500, body: null }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useCompanyNews } = await import('./useCompanyNews')
    const { result } = renderHook(() => useCompanyNews('aapl'))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe(true)
  })

  it('returns the SAME object across re-renders with the same data (H14 shape)', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { items: [] } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useCompanyNews } = await import('./useCompanyNews')
    const { result, rerender } = renderHook(({ sym }) => useCompanyNews(sym), { initialProps: { sym: 'aapl' } })
    const first = result.current
    rerender({ sym: 'aapl' })
    expect(result.current).toBe(first)
    swr.data = { ok: true, httpStatus: 200, body: { items: [{ id: 1 }] } }
    rerender({ sym: 'aapl' })
    expect(result.current).not.toBe(first)
  })
})
