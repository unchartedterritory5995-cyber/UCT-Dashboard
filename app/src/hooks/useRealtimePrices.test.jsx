import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('./useLivePrices', () => ({
  default: vi.fn(() => ({ prices: {}, isLoading: false })),
}))
vi.mock('../lib/realtimeCandle', () => ({
  applyTick: vi.fn(),
  applyBarClose: vi.fn(),
  applyCorrection: vi.fn(),
}))

class FakeEventSource {
  static instances = []
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.listeners = {}
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    this.closed = false
    FakeEventSource.instances.push(this)
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  close() { this.readyState = 2; this.closed = true }
  emitOpen() { this.readyState = 1; this.onopen?.() }
  emitMessage(obj) { this.onmessage?.({ data: JSON.stringify(obj) }) }
}

function openInstances() {
  return FakeEventSource.instances.filter(es => !es.closed)
}

beforeEach(() => {
  vi.resetModules()
  FakeEventSource.instances = []
  globalThis.EventSource = FakeEventSource
  localStorage.removeItem('uct.ssePool.disabled')
})

afterEach(async () => {
  const mgr = await import('../lib/priceStreamManager')
  mgr._resetForTests()
  vi.useRealTimers()
})

describe('pooled useRealtimePrices', () => {
  it('two hook instances share one connection and each sees only its own tickers', async () => {
    vi.useFakeTimers()
    const { default: useRealtimePrices } = await import('./useRealtimePrices')
    const mgr = await import('../lib/priceStreamManager')

    const a = renderHook(() => useRealtimePrices(['AAPL']))
    const b = renderHook(() => useRealtimePrices(['MSFT']))
    act(() => { vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS + 10) })

    expect(openInstances()).toHaveLength(1)
    const es = openInstances()[0]
    act(() => {
      es.emitOpen()
      es.emitMessage({ AAPL: { price: 111 }, MSFT: { price: 222 } })
    })

    expect(a.result.current.prices.AAPL.price).toBe(111)
    expect(a.result.current.prices.MSFT).toBeUndefined()   // per-ticker filter holds
    expect(b.result.current.prices.MSFT.price).toBe(222)
    expect(b.result.current.prices.AAPL).toBeUndefined()
    expect(a.result.current.isStreaming).toBe(true)

    a.unmount(); b.unmount()
    act(() => { vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS + 10) })
    expect(openInstances()).toHaveLength(0)
  })

  it('staleSymbols is filtered to the hook’s own tickers', async () => {
    vi.useFakeTimers()
    const { default: useRealtimePrices } = await import('./useRealtimePrices')
    const mgr = await import('../lib/priceStreamManager')

    const a = renderHook(() => useRealtimePrices(['AAPL']))
    const b = renderHook(() => useRealtimePrices(['MSFT']))
    act(() => { vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS + 10) })
    const es = openInstances()[0]
    act(() => {
      es.emitOpen()
      for (const fn of es.listeners['stale'] || []) {
        fn({ data: JSON.stringify({ sym: 'AAPL' }) })
      }
    })
    expect(a.result.current.staleSymbols.has('AAPL')).toBe(true)
    expect(b.result.current.staleSymbols.size).toBe(0)
    a.unmount(); b.unmount()
  })
})

describe('kill-switch', () => {
  it('uct.ssePool.disabled=1 selects the legacy per-instance path', async () => {
    localStorage.setItem('uct.ssePool.disabled', '1')
    const { default: useRealtimePrices } = await import('./useRealtimePrices')

    const a = renderHook(() => useRealtimePrices(['AAPL']))
    const b = renderHook(() => useRealtimePrices(['MSFT']))
    // Legacy path: one EventSource PER hook instance, immediately (no debounce)
    expect(FakeEventSource.instances).toHaveLength(2)
    const urls = FakeEventSource.instances.map(e => e.url).sort()
    expect(urls).toEqual([
      '/api/stream/prices?tickers=AAPL',
      '/api/stream/prices?tickers=MSFT',
    ])
    a.unmount(); b.unmount()
  })
})
