import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// TERM-088 -- the financials hook (FA). A failed read keeps its HTTP
// outcome; it is never collapsed to `null`, which the tab would otherwise
// read as "statement history is unavailable" during a mere outage.

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock('../../../hooks/useMobileSWR') })

describe('fetchFinancials', () => {
  it('keeps a refused request as ok:false with its status', async () => {
    const { fetchFinancials } = await import('./useFinancials')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    expect(await fetchFinancials('/x')).toEqual({ ok: false, httpStatus: 500, body: null })
  })

  it('keeps a network failure as ok:false, status 0 -- not an empty statement history', async () => {
    const { fetchFinancials } = await import('./useFinancials')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await fetchFinancials('/x')).toEqual({ ok: false, httpStatus: 0, body: null })
  })

  it('passes a readable answer through untouched', async () => {
    const { fetchFinancials } = await import('./useFinancials')
    const body = { quarterly: [{ period: 'Q4 2024' }] }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => body })
    expect(await fetchFinancials('/x')).toEqual({ ok: true, httpStatus: 200, body })
  })
})

describe('useFinancials', () => {
  it('renders a 200-with-data body as data, with no error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { quarterly: [{ period: 'Q4 2024' }] } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useFinancials } = await import('./useFinancials')
    const { result } = renderHook(() => useFinancials('aapl'))
    expect(result.current.data).toEqual({ quarterly: [{ period: 'Q4 2024' }] })
    expect(result.current.error).toBe(false)
  })

  it('renders a 200-with-empty body as empty data, not an error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: {} }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useFinancials } = await import('./useFinancials')
    const { result } = renderHook(() => useFinancials('aapl'))
    expect(result.current.data).toEqual({})
    expect(result.current.error).toBe(false)
  })

  it('renders a failed fetch (500/404/network) as error:true, never silently empty', async () => {
    const swr = { data: { ok: false, httpStatus: 0, body: null }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useFinancials } = await import('./useFinancials')
    const { result } = renderHook(() => useFinancials('aapl'))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe(true)
  })
})
