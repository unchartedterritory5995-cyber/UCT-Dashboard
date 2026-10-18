import { act, renderHook, waitFor } from '@testing-library/react'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import useScreenerScan, { ANSWER_FRESH_MS } from './useScreenerScan'

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

describe('leading option: returning and clearing', () => {
  afterEach(() => { vi.useRealTimers() })
  const scanCalls = () => globalThis.fetch.mock.calls.filter(([u]) => u === '/api/screener/scan')

  test('returning to the spec still in flight drops the queued edit, and its answer is delivered for it', async () => {
    let release
    globalThis.fetch = vi.fn(() => new Promise(r => { release = () => r({ ok: true, json: async () => ({ total: 7, rows: [] }) }) }))
    vi.useFakeTimers()
    const A = { filters: [{ key: 'a' }], page: 1 }
    const { result, rerender } = renderHook(({ s }) => useScreenerScan(s, { leading: true }), { initialProps: { s: A } })
    expect(scanCalls()).toHaveLength(1)
    rerender({ s: { filters: [{ key: 'b' }], page: 1 } }) // queued on the debounce
    rerender({ s: { ...A } }) // back to A: same key as the request on the wire
    act(() => { vi.advanceTimersByTime(1000) })
    expect(scanCalls()).toHaveLength(1) // B never fired, A was not asked twice
    vi.useRealTimers()
    await act(async () => { release() })
    await waitFor(() => expect(result.current.result?.total).toBe(7))
    expect(result.current.answeredSpec).toBe(A)
  })

  test('a spec that goes null drops the queued edit', () => {
    vi.useFakeTimers()
    const { rerender } = renderHook(({ s }) => useScreenerScan(s, { leading: true }),
      { initialProps: { s: { filters: [], page: 1 } } })
    expect(scanCalls()).toHaveLength(1)
    rerender({ s: { filters: [{ key: 'b' }], page: 1 } })
    rerender({ s: null })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(scanCalls()).toHaveLength(1)
  })
})

// ── revisits are instant (2026-10-17): a mount keeps its page-1 answers by spec.
describe('revisits', () => {
  const A = { filters: [{ k: 'a' }], view: 'overview' }
  const B = { filters: [{ k: 'b' }], view: 'overview' }
  const answerFor = body => {
    const f = JSON.parse(body).filters?.[0]?.k || 'none'
    return { total: 1, page: 1, rows: [{ ticker: f.toUpperCase() }] }
  }
  beforeEach(() => {
    vi.useFakeTimers()
    globalThis.fetch = vi.fn((u, o) => Promise.resolve({ ok: true, json: () => Promise.resolve(answerFor(o.body)) }))
  })
  afterEach(() => { vi.useRealTimers() })
  const scans = () => globalThis.fetch.mock.calls.filter(([u]) => u === '/api/screener/scan').length
  const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(400) })

  test('back to a screen answered moments ago: its answer at once, no request', async () => {
    const { result, rerender } = renderHook(({ s }) => useScreenerScan(s, { leading: true }), { initialProps: { s: A } })
    await settle()
    rerender({ s: B }); await settle()
    expect(scans()).toBe(2)
    const A2 = { ...A }                                   // the caller's NEW object for the same spec
    rerender({ s: A2 })
    expect(result.current.result.rows[0].ticker).toBe('A')
    expect(result.current.answeredSpec).toBe(A2)         // filed under the spec held now
    await settle()
    expect(scans()).toBe(2)
  })

  test('an older answer shows at once and is asked again', async () => {
    const { result, rerender } = renderHook(({ s }) => useScreenerScan(s, { leading: true }), { initialProps: { s: A } })
    await settle()
    rerender({ s: B }); await settle()
    await act(async () => { await vi.advanceTimersByTimeAsync(ANSWER_FRESH_MS) })
    rerender({ s: { ...A } })
    expect(result.current.result.rows[0].ticker).toBe('A')
    await settle()
    expect(scans()).toBe(3)
  })

  test('CONTROL: a screen never answered is asked for', async () => {
    const { result, rerender } = renderHook(({ s }) => useScreenerScan(s, { leading: true }), { initialProps: { s: A } })
    await settle()
    rerender({ s: B })
    expect(result.current.result.rows[0].ticker).toBe('A')   // B not answered yet
    await settle()
    expect(result.current.result.rows[0].ticker).toBe('B')
    expect(scans()).toBe(2)
  })

  test('later pages are not kept', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ total: 9, page: 2, rows: [] }) }))
    const P2 = { ...A, page: 2 }
    const { rerender } = renderHook(({ s }) => useScreenerScan(s, { leading: true }), { initialProps: { s: P2 } })
    await settle()
    rerender({ s: B }); await settle()
    rerender({ s: { ...P2 } }); await settle()
    expect(scans()).toBe(3)
  })

  test('the debounced default mode serves a revisit too', async () => {
    const { result, rerender } = renderHook(({ s }) => useScreenerScan(s), { initialProps: { s: A } })
    await settle()
    rerender({ s: B }); await settle()
    rerender({ s: { ...A } })
    expect(result.current.result.rows[0].ticker).toBe('A')
    await settle()
    expect(scans()).toBe(2)
  })
})
