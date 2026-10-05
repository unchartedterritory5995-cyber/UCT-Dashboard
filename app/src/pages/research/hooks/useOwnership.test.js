import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// TERM-088 -- the ownership hook (OWN). A failed read keeps its HTTP
// outcome; it is never collapsed to `null`, which the tab would otherwise
// read as "ownership data is unavailable" during a mere outage.

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock('../../../hooks/useMobileSWR') })

describe('fetchOwnership', () => {
  it('keeps a refused request as ok:false with its status', async () => {
    const { fetchOwnership } = await import('./useOwnership')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    expect(await fetchOwnership('/x')).toEqual({ ok: false, httpStatus: 404, body: null })
  })

  it('keeps a network failure as ok:false, status 0 -- not an empty record', async () => {
    const { fetchOwnership } = await import('./useOwnership')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await fetchOwnership('/x')).toEqual({ ok: false, httpStatus: 0, body: null })
  })

  it('passes a readable answer through untouched', async () => {
    const { fetchOwnership } = await import('./useOwnership')
    const body = { institutional: { pct_held: 61 } }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => body })
    expect(await fetchOwnership('/x')).toEqual({ ok: true, httpStatus: 200, body })
  })
})

describe('useOwnership', () => {
  it('renders a 200-with-data body as data, with no error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { institutional: { pct_held: 61 } } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useOwnership } = await import('./useOwnership')
    const { result } = renderHook(() => useOwnership('aapl'))
    expect(result.current.data).toEqual({ institutional: { pct_held: 61 } })
    expect(result.current.error).toBe(false)
  })

  it('renders a 200-with-empty body as empty data, not an error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: {} }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useOwnership } = await import('./useOwnership')
    const { result } = renderHook(() => useOwnership('aapl'))
    expect(result.current.data).toEqual({})
    expect(result.current.error).toBe(false)
  })

  it('renders a failed fetch (500/404/network) as error:true, never silently empty', async () => {
    const swr = { data: { ok: false, httpStatus: 0, body: null }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useOwnership } = await import('./useOwnership')
    const { result } = renderHook(() => useOwnership('aapl'))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe(true)
  })

  it('exposes mutate so the tab can retry without a full page reload', async () => {
    const mutate = () => {}
    const swr = { data: { ok: false, httpStatus: 500, body: null }, isLoading: false, mutate }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useOwnership } = await import('./useOwnership')
    const { result } = renderHook(() => useOwnership('aapl'))
    expect(result.current.mutate).toBe(mutate)
  })
})
