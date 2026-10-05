import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// TERM-088 -- the technical hook (TECH). A failed read keeps its HTTP
// outcome; it is never collapsed to `null`, which the tab would otherwise
// read as "nothing confirmed" during a mere outage -- collapsing the
// confirmed/rejected distinction this hook exists to carry into a false
// "nothing confirmed" bucket.

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock('../../../hooks/useMobileSWR') })

describe('fetchTechnical', () => {
  it('keeps a refused request as ok:false with its status', async () => {
    const { fetchTechnical } = await import('./useTechnical')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    expect(await fetchTechnical('/x')).toEqual({ ok: false, httpStatus: 500, body: null })
  })

  it('keeps a network failure as ok:false, status 0 -- not "nothing confirmed"', async () => {
    const { fetchTechnical } = await import('./useTechnical')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await fetchTechnical('/x')).toEqual({ ok: false, httpStatus: 0, body: null })
  })

  it('passes a readable answer through untouched', async () => {
    const { fetchTechnical } = await import('./useTechnical')
    const body = { verdicts: [{ setup: 'vcp' }], evaluated: 4 }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => body })
    expect(await fetchTechnical('/x')).toEqual({ ok: true, httpStatus: 200, body })
  })
})

describe('useTechnical', () => {
  it('renders a 200-with-confirmed-verdicts body as data, with no error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { verdicts: [{ setup: 'vcp', confirmed: 1 }], evaluated: 4 } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useTechnical } = await import('./useTechnical')
    const { result } = renderHook(() => useTechnical('aapl', 'D'))
    expect(result.current.data).toEqual({ verdicts: [{ setup: 'vcp', confirmed: 1 }], evaluated: 4 })
    expect(result.current.error).toBe(false)
  })

  it('renders a 200-with-zero-confirmed body as the genuine empty verdict set, not an error', async () => {
    // evaluated > 0, verdicts = [] -- a real "nothing confirmed" outcome,
    // distinct from a failed read. Must stay distinguishable from error:true.
    const swr = { data: { ok: true, httpStatus: 200, body: { verdicts: [], evaluated: 4 } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useTechnical } = await import('./useTechnical')
    const { result } = renderHook(() => useTechnical('aapl', 'D'))
    expect(result.current.data).toEqual({ verdicts: [], evaluated: 4 })
    expect(result.current.error).toBe(false)
  })

  it('renders a failed fetch (500/404/network) as error:true, never silently "nothing confirmed"', async () => {
    const swr = { data: { ok: false, httpStatus: 500, body: null }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useTechnical } = await import('./useTechnical')
    const { result } = renderHook(() => useTechnical('aapl', 'D'))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe(true)
  })
})
