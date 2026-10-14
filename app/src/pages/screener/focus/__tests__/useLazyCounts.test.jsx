import { renderHook, waitFor } from '@testing-library/react'
import { vi, beforeEach, expect, test } from 'vitest'
import useLazyCounts, { __resetCountCache } from '../useLazyCounts'

beforeEach(() => { __resetCountCache(); globalThis.fetch = vi.fn() })

test('does nothing until enabled', () => {
  renderHook(() => useLazyCounts({ a: { filters: [] } }, false))
  expect(fetch).not.toHaveBeenCalled()
})
test('fetches each spec once and caches', async () => {
  fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ count: 42 }) }))
  const specs = { a: { filters: [{ key: 'rs_rank', op: 'gte', min: 90 }] } }
  const { result, rerender } = renderHook(({ e }) => useLazyCounts(specs, e), { initialProps: { e: true } })
  await waitFor(() => expect(result.current.a).toBe(42))
  rerender({ e: true })
  expect(fetch).toHaveBeenCalledTimes(1)
})
test('caps concurrency at 12', async () => {
  let inflight = 0, peak = 0
  fetch.mockImplementation(async () => {
    inflight++; peak = Math.max(peak, inflight)
    await new Promise(r => setTimeout(r, 5))
    inflight--
    return { ok: true, json: async () => ({ count: 1 }) }
  })
  const specs = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`s${i}`, { filters: [{ key: 'k', op: 'gte', min: i }] }]))
  const { result } = renderHook(() => useLazyCounts(specs, true))
  await waitFor(() => expect(Object.values(result.current).filter(v => v === 1)).toHaveLength(30))
  expect(peak).toBeLessThanOrEqual(12)
})
test('a failed count is null, not zero', async () => {
  fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
  const { result } = renderHook(() => useLazyCounts({ a: { filters: [] } }, true))
  await waitFor(() => expect(result.current.a).toBeNull())
})
test('a failure is not cached: reopening retries', async () => {
  fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
  fetch.mockResolvedValue({ ok: true, json: async () => ({ count: 7 }) })
  const specs = { a: { filters: [] } }
  const { result, rerender } = renderHook(({ e }) => useLazyCounts(specs, e), { initialProps: { e: true } })
  await waitFor(() => expect(result.current.a).toBeNull())
  rerender({ e: false })
  rerender({ e: true })
  await waitFor(() => expect(result.current.a).toBe(7))
  expect(fetch).toHaveBeenCalledTimes(2)
})
