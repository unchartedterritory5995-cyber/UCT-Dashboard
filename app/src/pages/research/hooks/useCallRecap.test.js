import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// TERM-088 -- the earnings call recap hook (TRAN). A failed read keeps its
// HTTP outcome; it is never collapsed to `null`, which the tab would
// otherwise read as "no recap available" during a mere outage.

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock('../../../hooks/useMobileSWR') })

describe('fetchCallRecap', () => {
  it('keeps a refused request as ok:false with its status', async () => {
    const { fetchCallRecap } = await import('./useCallRecap')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 402, json: async () => ({}) })
    expect(await fetchCallRecap('/x')).toEqual({ ok: false, httpStatus: 402, body: null })
  })

  it('keeps a network failure as ok:false, status 0 -- not an empty recap', async () => {
    const { fetchCallRecap } = await import('./useCallRecap')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await fetchCallRecap('/x')).toEqual({ ok: false, httpStatus: 0, body: null })
  })

  it('passes a readable answer through untouched', async () => {
    const { fetchCallRecap } = await import('./useCallRecap')
    const body = { recap: { headline: 'x' } }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => body })
    expect(await fetchCallRecap('/x')).toEqual({ ok: true, httpStatus: 200, body })
  })
})

describe('useCallRecap', () => {
  it('renders a 200-with-data body as data, with no error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { recap: { headline: 'x' } } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useCallRecap } = await import('./useCallRecap')
    const { result } = renderHook(() => useCallRecap('aapl'))
    expect(result.current.data).toEqual({ recap: { headline: 'x' } })
    expect(result.current.error).toBe(false)
  })

  it('renders a 200-with-empty body as empty data, not an error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: {} }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useCallRecap } = await import('./useCallRecap')
    const { result } = renderHook(() => useCallRecap('aapl'))
    expect(result.current.data).toEqual({})
    expect(result.current.error).toBe(false)
  })

  it('renders a failed fetch (500/404/network) as error:true, never silently empty', async () => {
    // tq-panels: this used 402 -- the paid gate -- and pinned it as an error, which is the
    // bug (a paywalled member read "Couldn't load"). 500 is a failure; 402 is paywalled.
    const swr = { data: { ok: false, httpStatus: 500, body: null }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useCallRecap } = await import('./useCallRecap')
    const { result } = renderHook(() => useCallRecap('aapl'))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe(true)
    expect(result.current.paywalled).toBe(false)
  })

  it('a 402 is paywalled, not an error', async () => {
    const swr = { data: { ok: false, httpStatus: 402, body: null }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useCallRecap } = await import('./useCallRecap')
    const { result } = renderHook(() => useCallRecap('aapl'))
    expect(result.current.paywalled).toBe(true)
    expect(result.current.error).toBe(false)
  })

  it('returns the SAME object across re-renders with the same data (H14 shape)', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { recap: { headline: 'x' } } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useCallRecap } = await import('./useCallRecap')
    const { result, rerender } = renderHook(({ sym }) => useCallRecap(sym), { initialProps: { sym: 'aapl' } })
    const first = result.current
    rerender({ sym: 'aapl' })
    expect(result.current).toBe(first)
    swr.data = { ok: true, httpStatus: 200, body: { recap: { headline: 'y' } } }
    rerender({ sym: 'aapl' })
    expect(result.current).not.toBe(first)
  })
})
