import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// TERM-088 -- the decision record's hook.
// (1) A failed read keeps its HTTP outcome; it is never collapsed to `null`,
//     which the tab would otherwise have to guess about.
// (2) The returned object is memoized: re-rendering with the same SWR answer
//     hands back the SAME object, so a consumer keyed on it cannot loop (H14).

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock('../../../hooks/useMobileSWR') })

describe('fetchDecisionRecord', () => {
  it('keeps a refused request as ok:false with its status', async () => {
    const { fetchDecisionRecord } = await import('./useDecisionRecord')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 402, json: async () => ({}) })
    expect(await fetchDecisionRecord('/x')).toEqual({ ok: false, httpStatus: 402, body: null })
  })

  it('keeps a network failure as ok:false, status 0 -- not an empty record', async () => {
    const { fetchDecisionRecord } = await import('./useDecisionRecord')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await fetchDecisionRecord('/x')).toEqual({ ok: false, httpStatus: 0, body: null })
  })

  it('passes a readable answer through untouched', async () => {
    const { fetchDecisionRecord } = await import('./useDecisionRecord')
    const body = { status: 'not_considered' }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => body })
    expect(await fetchDecisionRecord('/x')).toEqual({ ok: true, httpStatus: 200, body })
  })
})

describe('useDecisionRecord', () => {
  it('returns the SAME object across re-renders with the same data, and a new one when it changes', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { status: 'considered' } }, isLoading: false }
    const seenKeys = []
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: (key) => { seenKeys.push(key); return swr } }))
    const { default: useDecisionRecord } = await import('./useDecisionRecord')
    const { result, rerender } = renderHook(({ sym }) => useDecisionRecord(sym), { initialProps: { sym: 'amd' } })
    const first = result.current
    rerender({ sym: 'amd' })
    rerender({ sym: 'amd' })
    expect(result.current).toBe(first)
    expect(seenKeys[0]).toBe('/api/decision-record/ticker/AMD?limit=50&offset=0')
    swr.data = { ok: true, httpStatus: 200, body: { status: 'not_considered' } }
    rerender({ sym: 'amd' })
    expect(result.current).not.toBe(first)
  })

  it('asks for nothing without a ticker', async () => {
    const seenKeys = []
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: (key) => { seenKeys.push(key); return { data: undefined, isLoading: false } } }))
    const { default: useDecisionRecord } = await import('./useDecisionRecord')
    renderHook(() => useDecisionRecord(''))
    expect(seenKeys.every((k) => k === null)).toBe(true)
  })
})
