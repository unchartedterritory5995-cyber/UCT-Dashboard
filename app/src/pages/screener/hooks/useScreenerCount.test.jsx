import { renderHook, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import useScreenerCount from './useScreenerCount'

// PACKET-AB CP1 (fingerprint bc19457cf)

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ count: 42, empty: false, top_n: null }),
  }))
})

test('posts spec to /api/screener/count and returns count+empty', async () => {
  const { result } = renderHook(() => useScreenerCount({ filters: [], view: 'overview' }, { debounce: 0 }))
  await waitFor(() => expect(result.current.count).toBe(42))
  expect(result.current.empty).toBe(false)
  expect(global.fetch).toHaveBeenCalledWith('/api/screener/count',
    expect.objectContaining({ method: 'POST' }))
})

test('null spec does not fetch', () => {
  renderHook(() => useScreenerCount(null))
  expect(global.fetch).not.toHaveBeenCalled()
})

test('a zero-match response is distinguished from "not yet loaded"', async () => {
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ count: 0, empty: true, top_n: null }),
  }))
  const { result } = renderHook(() => useScreenerCount({ filters: [] }, { debounce: 0 }))
  await waitFor(() => expect(result.current.count).toBe(0))
  expect(result.current.empty).toBe(true)
})

test('an error response surfaces on .error without throwing', async () => {
  global.fetch = vi.fn(() => Promise.resolve({
    ok: false,
    status: 400,
    json: () => Promise.resolve({ detail: 'bad spec' }),
  }))
  const { result } = renderHook(() => useScreenerCount({ filters: [] }, { debounce: 0 }))
  await waitFor(() => expect(result.current.error).toBeTruthy())
  expect(result.current.error.message).toBe('bad spec')
})
