import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// TERM-088 -- the catalyst history hook (CATS). A failed read keeps its HTTP
// outcome; it is never collapsed to `null`, which the tab would otherwise
// read as "no catalysts recorded" during a mere outage.

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock('../../../hooks/useMobileSWR') })

describe('fetchCatalystHistory', () => {
  it('keeps a refused request as ok:false with its status', async () => {
    const { fetchCatalystHistory } = await import('./useCatalystHistory')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    expect(await fetchCatalystHistory('/x')).toEqual({ ok: false, httpStatus: 404, body: null })
  })

  it('keeps a network failure as ok:false, status 0 -- not an empty history', async () => {
    const { fetchCatalystHistory } = await import('./useCatalystHistory')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await fetchCatalystHistory('/x')).toEqual({ ok: false, httpStatus: 0, body: null })
  })

  it('passes a readable answer through untouched', async () => {
    const { fetchCatalystHistory } = await import('./useCatalystHistory')
    const body = { entries: [{ market_date: '2026-01-01', tag: 'Earnings' }] }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => body })
    expect(await fetchCatalystHistory('/x')).toEqual({ ok: true, httpStatus: 200, body })
  })
})

describe('useCatalystHistory', () => {
  it('renders a 200-with-data body as data, with no error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { entries: [{ market_date: '2026-01-01' }] } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useCatalystHistory } = await import('./useCatalystHistory')
    const { result } = renderHook(() => useCatalystHistory('aapl'))
    expect(result.current.data).toEqual({ entries: [{ market_date: '2026-01-01' }] })
    expect(result.current.error).toBe(false)
  })

  it('renders a 200-with-empty body as empty data, not an error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { entries: [] } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useCatalystHistory } = await import('./useCatalystHistory')
    const { result } = renderHook(() => useCatalystHistory('aapl'))
    expect(result.current.data).toEqual({ entries: [] })
    expect(result.current.error).toBe(false)
  })

  it('renders a failed fetch (500/404/network) as error:true, never silently empty', async () => {
    const swr = { data: { ok: false, httpStatus: 404, body: null }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useCatalystHistory } = await import('./useCatalystHistory')
    const { result } = renderHook(() => useCatalystHistory('aapl'))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe(true)
  })

  it('a 402 is the paid gate (paywalled), never an outage error', async () => {
    const swr = { data: { ok: false, httpStatus: 402, body: null }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useCatalystHistory } = await import('./useCatalystHistory')
    const { result } = renderHook(() => useCatalystHistory('aapl'))
    expect(result.current.paywalled).toBe(true)
    expect(result.current.error).toBe(false)
  })

  it('returns the SAME object across re-renders with the same data (H14 shape)', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { entries: [] } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useCatalystHistory } = await import('./useCatalystHistory')
    const { result, rerender } = renderHook(({ sym }) => useCatalystHistory(sym), { initialProps: { sym: 'aapl' } })
    const first = result.current
    rerender({ sym: 'aapl' })
    expect(result.current).toBe(first)
    swr.data = { ok: true, httpStatus: 200, body: { entries: [{ market_date: '2026-02-02' }] } }
    rerender({ sym: 'aapl' })
    expect(result.current).not.toBe(first)
  })
})
