import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useCotNarrativeArchive } from './useCotNarrativeArchive'

const payload = {
  symbol: 'ES',
  rows: [
    { report_date: '2026-08-18', text: 'Latest read.', created_at: '2026-08-21T21:10:00Z' },
    { report_date: '2026-08-11', text: 'Prior read.',  created_at: '2026-08-14T21:10:00Z' },
  ],
}

describe('useCotNarrativeArchive', () => {
  let fetchMock
  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }))
    globalThis.fetch = fetchMock
  })
  afterEach(() => vi.restoreAllMocks())

  it('loads the archive once per symbol and keys it by report date', async () => {
    const { result } = renderHook(() => useCotNarrativeArchive('ES'))
    await waitFor(() => expect(result.current['2026-08-11']).toBe('Prior read.'))
    expect(result.current['2026-08-18']).toBe('Latest read.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/cot/ES/narratives?limit=260')
  })

  it('is empty (not undefined) before load, on a failed request, and without a symbol', async () => {
    const { result: none } = renderHook(() => useCotNarrativeArchive(null))
    expect(none.current).toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockImplementation(() => Promise.resolve({ ok: false, status: 402, json: () => Promise.resolve({}) }))
    const { result } = renderHook(() => useCotNarrativeArchive('NQ'))
    expect(result.current).toEqual({})
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(result.current).toEqual({})
  })

  it('swaps to the new symbol and never shows the old symbol\'s reads', async () => {
    const { result, rerender } = renderHook(sym => useCotNarrativeArchive(sym), { initialProps: 'ES' })
    await waitFor(() => expect(result.current['2026-08-18']).toBe('Latest read.'))
    fetchMock.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ symbol: 'GC', rows: [] }) }))
    rerender('GC')
    expect(result.current).toEqual({})
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(result.current).toEqual({})
  })
})
