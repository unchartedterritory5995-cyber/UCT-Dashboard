import { renderHook, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import useScreenerScan from './useScreenerScan'

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      total: 1, rows: [{ ticker: 'AAA' }],
      view_columns: ['ticker'], snapshot_date: '2026-06-19',
    }),
  }))
})

test('posts spec and returns result', async () => {
  const { result } = renderHook(() => useScreenerScan({ filters: [], view: 'overview' }, { debounce: 0 }))
  await waitFor(() => expect(result.current.result?.total).toBe(1))
  expect(global.fetch).toHaveBeenCalledWith('/api/screener/scan',
    expect.objectContaining({ method: 'POST' }))
})

test('null spec does not fetch', () => {
  renderHook(() => useScreenerScan(null))
  expect(global.fetch).not.toHaveBeenCalled()
})

test('a failed scan carries its HTTP status, so the shell can word it (quality pass 2026-10-05)', async () => {
  global.fetch = vi.fn(() => Promise.resolve({
    ok: false, status: 400, json: () => Promise.resolve({ detail: "unknown filter 'xyz'" }),
  }))
  const { result } = renderHook(() => useScreenerScan({ filters: [], view: 'overview' }, { debounce: 0 }))
  await waitFor(() => expect(result.current.error).toBeTruthy())
  expect(result.current.error.status).toBe(400)
})
