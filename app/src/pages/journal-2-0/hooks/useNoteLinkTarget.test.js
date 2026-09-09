import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import useNoteLinkTarget from './useNoteLinkTarget'
import { _resetNoteLinkTargetsBatchForTests } from '../lib/noteLinkTargetsBatch'

beforeEach(() => {
  _resetNoteLinkTargetsBatchForTests()
})
afterEach(() => {
  delete global.fetch
})

describe('useNoteLinkTarget', () => {
  it('returns unavailable immediately for a missing id, without fetching', () => {
    global.fetch = vi.fn()
    const { result } = renderHook(() => useNoteLinkTarget(null))
    expect(result.current).toEqual({ status: 'unavailable' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('starts loading, then resolves to the fetched title once the batch flushes', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ targets: { n1: { title: 'Thesis', status: 'active' } } }),
    }))
    const { result } = renderHook(() => useNoteLinkTarget('n1'))
    expect(result.current).toEqual({ status: 'loading' })

    await waitFor(() => expect(result.current).toEqual({ status: 'active', title: 'Thesis' }))
  })

  it('resolves to unavailable when the target is not in the response', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ targets: {} }) }))
    const { result } = renderHook(() => useNoteLinkTarget('ghost'))
    await waitFor(() => expect(result.current).toEqual({ status: 'unavailable' }))
  })
})
