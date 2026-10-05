import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// TERM-088 -- the Model Book appearances hook (MB). A failed read keeps its
// HTTP outcome; it is never collapsed to `null`, which the tab would
// otherwise read as "never in the Model Book" during a mere outage.

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock('../../../hooks/useMobileSWR') })

describe('fetchModelBookAppearances', () => {
  it('keeps a refused request as ok:false with its status', async () => {
    const { fetchModelBookAppearances } = await import('./useModelBookAppearances')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    expect(await fetchModelBookAppearances('/x')).toEqual({ ok: false, httpStatus: 500, body: null })
  })

  it('keeps a network failure as ok:false, status 0 -- not an empty appearance list', async () => {
    const { fetchModelBookAppearances } = await import('./useModelBookAppearances')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await fetchModelBookAppearances('/x')).toEqual({ ok: false, httpStatus: 0, body: null })
  })

  it('passes a readable answer through untouched', async () => {
    const { fetchModelBookAppearances } = await import('./useModelBookAppearances')
    const body = { appearances: [{ id: 1, year: 2024 }] }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => body })
    expect(await fetchModelBookAppearances('/x')).toEqual({ ok: true, httpStatus: 200, body })
  })
})

describe('useModelBookAppearances', () => {
  it('renders a 200-with-data body as data, with no error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { appearances: [{ id: 1, year: 2024 }] } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useModelBookAppearances } = await import('./useModelBookAppearances')
    const { result } = renderHook(() => useModelBookAppearances('nvda'))
    expect(result.current.data).toEqual({ appearances: [{ id: 1, year: 2024 }] })
    expect(result.current.error).toBe(false)
  })

  it('renders a 200-with-empty appearances array as empty data, not an error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { appearances: [] } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useModelBookAppearances } = await import('./useModelBookAppearances')
    const { result } = renderHook(() => useModelBookAppearances('zzzz'))
    expect(result.current.data).toEqual({ appearances: [] })
    expect(result.current.error).toBe(false)
  })

  it('renders a failed fetch (500/404/network) as error:true, never silently "not in the Model Book"', async () => {
    const swr = { data: { ok: false, httpStatus: 500, body: null }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useModelBookAppearances } = await import('./useModelBookAppearances')
    const { result } = renderHook(() => useModelBookAppearances('nvda'))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe(true)
  })
})
