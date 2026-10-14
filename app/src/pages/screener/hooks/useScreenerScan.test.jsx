import { act, renderHook, waitFor } from '@testing-library/react'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import useScreenerScan from './useScreenerScan'

beforeEach(() => {
  globalThis.fetch = vi.fn(() => Promise.resolve({
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
  expect(globalThis.fetch).toHaveBeenCalledWith('/api/screener/scan',
    expect.objectContaining({ method: 'POST' }))
})

test('null spec does not fetch', () => {
  renderHook(() => useScreenerScan(null))
  expect(globalThis.fetch).not.toHaveBeenCalled()
})

test('a failed scan carries its HTTP status, so the shell can word it (quality pass 2026-10-05)', async () => {
  globalThis.fetch = vi.fn(() => Promise.resolve({
    ok: false, status: 400, json: () => Promise.resolve({ detail: "unknown filter 'xyz'" }),
  }))
  const { result } = renderHook(() => useScreenerScan({ filters: [], view: 'overview' }, { debounce: 0 }))
  await waitFor(() => expect(result.current.error).toBeTruthy())
  expect(result.current.error.status).toBe(400)
})

// ── leading mode (polish round 2026-10-14): the first request and a deliberate switch do not
// wait out the debounce; only rapid edits inside the window are debounced. Off by default, so
// ScannerShell keeps its 300 ms wait.
describe('leading option', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const scanCalls = () => globalThis.fetch.mock.calls.filter(([u]) => u === '/api/screener/scan')

  test('the default still debounces the first request', () => {
    renderHook(() => useScreenerScan({ filters: [], view: 'overview' }))
    expect(scanCalls()).toHaveLength(0)
    act(() => { vi.advanceTimersByTime(299) })
    expect(scanCalls()).toHaveLength(0)
    act(() => { vi.advanceTimersByTime(1) })
    expect(scanCalls()).toHaveLength(1)
  })

  test('leading fires the first request at once, without the 300 ms wait', () => {
    renderHook(() => useScreenerScan({ filters: [], view: 'overview' }, { leading: true }))
    expect(scanCalls()).toHaveLength(1)
  })

  test('leading debounces rapid edits inside the window, and fires again at once after a quiet spell', () => {
    const { rerender } = renderHook(({ s }) => useScreenerScan(s, { leading: true }),
      { initialProps: { s: { filters: [], page: 1 } } })
    expect(scanCalls()).toHaveLength(1)
    rerender({ s: { filters: [{ key: 'a' }], page: 1 } })
    rerender({ s: { filters: [{ key: 'b' }], page: 1 } })
    expect(scanCalls()).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(300) })
    expect(scanCalls()).toHaveLength(2)
    expect(JSON.parse(scanCalls()[1][1].body).filters).toEqual([{ key: 'b' }])
    act(() => { vi.advanceTimersByTime(300) }) // the window after that fire closes
    rerender({ s: { filters: [{ key: 'c' }], page: 1 } })
    expect(scanCalls()).toHaveLength(3)
  })

  test('the answer carries the spec it was asked for', async () => {
    vi.useRealTimers()
    const asked = { filters: [{ key: 'x' }], view: 'overview' }
    const { result } = renderHook(() => useScreenerScan(asked, { leading: true }))
    await waitFor(() => expect(result.current.result?.total).toBe(1))
    expect(result.current.answeredSpec).toBe(asked)
  })
})
