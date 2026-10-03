import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import useThesisChips from './useThesisChips'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'

beforeEach(() => {
  __resetNotebookFlags()
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve({ NVDA: { stop: 90 }, AMD: { stop: 80 } }),
  }))
})
afterEach(() => {
  __resetNotebookFlags()
  vi.restoreAllMocks()
})

describe('useThesisChips', () => {
  it('posts the WHOLE symbol set in exactly ONE request, deduped and uppercased', async () => {
    latchNotebookFlags({ notebook_thesis_chips_enabled: true })
    const { result } = renderHook(() => useThesisChips(['nvda', 'AMD', 'nvda', 'TSLA']))
    await waitFor(() => expect(result.current.chips).toHaveProperty('NVDA'))
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/j2/thesis-chips')
    expect(opts.method).toBe('POST')
    expect(opts.credentials).toBe('include')
    const body = JSON.parse(opts.body)
    expect([...body.symbols].sort()).toEqual(['AMD', 'NVDA', 'TSLA'])
  })

  it('a larger row set still costs exactly one request (the N-rows-1-request rail)', async () => {
    latchNotebookFlags({ notebook_thesis_chips_enabled: true })
    const many = Array.from({ length: 40 }, (_, i) => `S${i}`)
    const { result } = renderHook(() => useThesisChips(many))
    await waitFor(() => expect(result.current.chips).toHaveProperty('NVDA'))
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('makes NO request while the flag is off', () => {
    const { result } = renderHook(() => useThesisChips(['NVDA']))
    expect(result.current.chips).toEqual({})
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('makes no request with an empty symbol list, even with the flag on', () => {
    latchNotebookFlags({ notebook_thesis_chips_enabled: true })
    const { result } = renderHook(() => useThesisChips([]))
    expect(result.current.chips).toEqual({})
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('a failed response resolves to an empty chip map, never a thrown error', async () => {
    latchNotebookFlags({ notebook_thesis_chips_enabled: true })
    global.fetch = vi.fn(() => Promise.resolve({ ok: false }))
    const { result } = renderHook(() => useThesisChips(['NVDA']))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.chips).toEqual({})
  })
})
