import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// The Flow tab's hook keeps the HTTP outcome. Before, a 5xx, a 404 and a dropped connection all
// became `null`, and the tab said "No qualifying options flow" about a read that never happened.

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock('../../../hooks/useMobileSWR') })

describe('fetchResearchFlow', () => {
  it('keeps a refused request as ok:false with its status', async () => {
    const { fetchResearchFlow } = await import('./useResearchFlow')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    expect(await fetchResearchFlow('/x')).toEqual({ ok: false, httpStatus: 503, body: null })
  })

  it('keeps a network failure as ok:false, status 0', async () => {
    const { fetchResearchFlow } = await import('./useResearchFlow')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await fetchResearchFlow('/x')).toEqual({ ok: false, httpStatus: 0, body: null })
  })

  it('a 200 whose body is not JSON is a failure, not an empty tape', async () => {
    const { fetchResearchFlow } = await import('./useResearchFlow')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('<html>') } })
    expect(await fetchResearchFlow('/x')).toEqual({ ok: false, httpStatus: 0, body: null })
  })

  it('passes a readable answer through untouched', async () => {
    const { fetchResearchFlow } = await import('./useResearchFlow')
    const body = { ok: true, contracts: [] }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => body })
    expect(await fetchResearchFlow('/x')).toEqual({ ok: true, httpStatus: 200, body })
  })
})

describe('useResearchFlow', () => {
  it('a failed read surfaces as error (data null); a good one as data (error null); retry revalidates', async () => {
    const mutate = vi.fn()
    let swr = { data: { ok: false, httpStatus: 502, body: null }, isLoading: false, mutate }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useResearchFlow } = await import('./useResearchFlow')
    const { result, rerender } = renderHook(() => useResearchFlow('aapl'))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toEqual({ httpStatus: 502 })
    result.current.retry()
    expect(mutate).toHaveBeenCalledTimes(1)
    swr = { data: { ok: true, httpStatus: 200, body: { ok: true, contracts: [] } }, isLoading: false, mutate }
    rerender()
    expect(result.current.error).toBeNull()
    expect(result.current.data).toEqual({ ok: true, contracts: [] })
  })
})
