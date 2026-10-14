import { renderHook, waitFor } from '@testing-library/react'
import { vi, afterEach, beforeEach, describe, expect, test } from 'vitest'
import useLazyCounts, { __resetCountCache } from '../useLazyCounts'

const BATCH = '/api/screener/count/batch'
const batchMissing = { ok: false, status: 404, json: async () => ({}) }

beforeEach(() => { __resetCountCache(); globalThis.fetch = vi.fn() })

test('does nothing until enabled', () => {
  renderHook(() => useLazyCounts({ a: { filters: [] } }, false))
  expect(fetch).not.toHaveBeenCalled()
})
test('fetches each spec once and caches', async () => {
  fetch.mockImplementation(async url => (url === BATCH
    ? { ok: true, json: async () => ({ counts: [{ count: 42 }] }) }
    : { ok: true, json: async () => ({ count: 42 }) }))
  const specs = { a: { filters: [{ key: 'rs_rank', op: 'gte', min: 90 }] } }
  const { result, rerender } = renderHook(({ e }) => useLazyCounts(specs, e), { initialProps: { e: true } })
  await waitFor(() => expect(result.current.a).toBe(42))
  rerender({ e: true })
  expect(fetch).toHaveBeenCalledTimes(1)
})
test('caps concurrency at 12 (single-count fallback path)', async () => {
  let inflight = 0, peak = 0
  fetch.mockImplementation(async url => {
    if (url === BATCH) return batchMissing
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
  fetch.mockResolvedValue({ ok: true, json: async () => ({ counts: [{ count: 7 }] }) })
  const specs = { a: { filters: [] } }
  const { result, rerender } = renderHook(({ e }) => useLazyCounts(specs, e), { initialProps: { e: true } })
  await waitFor(() => expect(result.current.a).toBeNull())
  rerender({ e: false })
  rerender({ e: true })
  await waitFor(() => expect(result.current.a).toBe(7))
  expect(fetch).toHaveBeenCalledTimes(2)
})
test('uses the batch endpoint when available', async () => {
  fetch.mockImplementation(async (url, opts) => {
    if (url === BATCH) {
      const n = JSON.parse(opts.body).specs.length
      return { ok: true, json: async () => ({ counts: Array.from({ length: n }, () => ({ count: 5 })) }) }
    }
    return { ok: true, json: async () => ({ count: 1 }) }
  })
  const specs = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`s${i}`, { filters: [{ key: 'k', op: 'gte', min: i }] }]))
  const { result } = renderHook(() => useLazyCounts(specs, true))
  await waitFor(() => expect(Object.values(result.current).filter(v => v === 5)).toHaveLength(40))
  const batches = fetch.mock.calls.filter(c => c[0] === BATCH)
  expect(batches).toHaveLength(2)
  expect(batches.map(c => JSON.parse(c[1].body).specs.length).sort((x, y) => x - y)).toEqual([10, 30])
  expect(fetch.mock.calls.filter(c => c[0] === '/api/screener/count')).toHaveLength(0)
})
test('falls back to single counts when batch is missing', async () => {
  fetch.mockImplementation(async url => (url === BATCH ? batchMissing : { ok: true, json: async () => ({ count: 3 }) }))
  const { result } = renderHook(() => useLazyCounts({ a: { filters: [] } }, true))
  await waitFor(() => expect(result.current.a).toBe(3))
})
test('falls back to single counts when the batch route answers 405 (SPA catch-all)', async () => {
  fetch.mockImplementation(async url => (url === BATCH ? { ok: false, status: 405, json: async () => ({}) } : { ok: true, json: async () => ({ count: 3 }) }))
  const { result } = renderHook(() => useLazyCounts({ a: { filters: [] } }, true))
  await waitFor(() => expect(result.current.a).toBe(3))
})
test('remembers a missing batch route: the next open does not probe again', async () => {
  fetch.mockImplementation(async url => (url === BATCH ? batchMissing : { ok: true, json: async () => ({ count: 3 }) }))
  const { result } = renderHook(() => useLazyCounts({ a: { filters: [{ key: 'x' }] } }, true))
  await waitFor(() => expect(result.current.a).toBe(3))
  const second = renderHook(() => useLazyCounts({ b: { filters: [{ key: 'y' }] } }, true))
  await waitFor(() => expect(second.result.current.b).toBe(3))
  expect(fetch.mock.calls.filter(c => c[0] === BATCH)).toHaveLength(1)
})
test('a per-item error is null and not cached; its neighbours still land', async () => {
  fetch.mockImplementation(async (url, opts) => {
    const n = JSON.parse(opts.body).specs.length
    return { ok: true, json: async () => ({ counts: Array.from({ length: n }, (_, i) => (n > 1 && i === 1 ? { error: 'bad' } : { count: 9 })) }) }
  })
  const specs = { a: { filters: [{ key: 'a' }] }, b: { filters: [{ key: 'b' }] }, c: { filters: [{ key: 'c' }] } }
  const { result, rerender } = renderHook(({ e }) => useLazyCounts(specs, e), { initialProps: { e: true } })
  await waitFor(() => expect(result.current).toEqual({ a: 9, b: null, c: 9 }))
  rerender({ e: false }); rerender({ e: true })
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))   // only b was asked again
  expect(JSON.parse(fetch.mock.calls[1][1].body).specs).toEqual([specs.b])
})
test('a network failure nulls every spec in the batch and caches none', async () => {
  fetch.mockRejectedValueOnce(new Error('offline'))
  fetch.mockResolvedValue({ ok: true, json: async () => ({ counts: [{ count: 4 }, { count: 4 }] }) })
  const specs = { a: { filters: [{ key: 'a' }] }, b: { filters: [{ key: 'b' }] } }
  const { result, rerender } = renderHook(({ e }) => useLazyCounts(specs, e), { initialProps: { e: true } })
  await waitFor(() => expect(result.current).toEqual({ a: null, b: null }))
  rerender({ e: false }); rerender({ e: true })
  await waitFor(() => expect(result.current).toEqual({ a: 4, b: 4 }))
})
test('two consumers asking for the same spec share one request', async () => {
  fetch.mockImplementation(async () => { await new Promise(r => setTimeout(r, 5)); return { ok: true, json: async () => ({ counts: [{ count: 8 }] }) } })
  const spec = { filters: [{ key: 'shared' }] }
  const one = renderHook(() => useLazyCounts({ a: spec }, true))
  const two = renderHook(() => useLazyCounts({ z: spec }, true))
  await waitFor(() => { expect(one.result.current.a).toBe(8); expect(two.result.current.z).toBe(8) })
  expect(fetch).toHaveBeenCalledTimes(1)
})

describe('cached counts expire after 10 minutes', () => {
  // Only the clock is faked: the hook's fetch and promise plumbing run as normal.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T14:00:00Z')) })
  afterEach(() => { vi.useRealTimers() })
  const specs = { a: { filters: [{ key: 'rs_rank', op: 'gte', min: 90 }] } }

  test('served from cache inside the window, asked again after it', async () => {
    let n = 40
    fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ counts: [{ count: ++n }] }) }))
    const first = renderHook(() => useLazyCounts(specs, true))
    await waitFor(() => expect(first.result.current.a).toBe(41))
    first.unmount()

    vi.setSystemTime(new Date('2026-10-14T14:09:59Z'))
    const second = renderHook(() => useLazyCounts(specs, true))
    await waitFor(() => expect(second.result.current.a).toBe(41))
    expect(fetch).toHaveBeenCalledTimes(1)
    second.unmount()

    vi.setSystemTime(new Date('2026-10-14T14:10:00Z'))
    const third = renderHook(() => useLazyCounts(specs, true))
    await waitFor(() => expect(third.result.current.a).toBe(42))
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('a failure is still never cached, and the reset clears fresh counts', async () => {
    fetch.mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    const failed = renderHook(() => useLazyCounts(specs, true))
    await waitFor(() => expect(failed.result.current.a).toBeNull())
    failed.unmount()
    fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ counts: [{ count: 7 }] }) }))
    const retry = renderHook(() => useLazyCounts(specs, true))
    await waitFor(() => expect(retry.result.current.a).toBe(7))
    expect(fetch).toHaveBeenCalledTimes(2)
    retry.unmount()
    __resetCountCache()
    const afterReset = renderHook(() => useLazyCounts(specs, true))
    await waitFor(() => expect(afterReset.result.current.a).toBe(7))
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})
