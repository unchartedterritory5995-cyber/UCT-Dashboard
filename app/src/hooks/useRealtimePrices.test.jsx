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

  it('REST change_pct wins over the stream (a stream 0 must not blank the %)', async () => {
    vi.useFakeTimers()
    const { default: useLivePrices } = await import('./useLivePrices')
    useLivePrices.mockReturnValue({
      prices: { AAPL: { price: 100, change_pct: 5.2, change: 4.9, prev_close: 95 } },
      isLoading: false,
    })
    const { default: useRealtimePrices } = await import('./useRealtimePrices')
    const mgr = await import('../lib/priceStreamManager')

    const a = renderHook(() => useRealtimePrices(['AAPL']))
    act(() => { vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS + 10) })
    const es = openInstances()[0]
    act(() => {
      es.emitOpen()
      es.emitMessage({ AAPL: { price: 100.5, change_pct: 0, change: 0 } }) // spurious stream 0
    })

    const px = a.result.current.prices.AAPL
    expect(px.price).toBe(100.5)     // stream drives the live price
    expect(px.change_pct).toBe(5.2)  // …but REST's change_pct WINS (not the stream's 0)
    expect(px.change).toBe(4.9)
    a.unmount()
  })

  it('an empty-ticker hook never registers with the pool and never re-renders on publishes', async () => {
    vi.useFakeTimers()
    const { default: useRealtimePrices } = await import('./useRealtimePrices')
    const mgr = await import('../lib/priceStreamManager')

    let idleRenders = 0
    const idle = renderHook(() => { idleRenders++; return useRealtimePrices([]) })
    const active = renderHook(() => useRealtimePrices(['AAPL']))
    act(() => { vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS + 10) })

    expect(openInstances()).toHaveLength(1)   // only the active hook's ticker
    expect(openInstances()[0].url).toBe('/api/stream/prices?tickers=AAPL')

    const rendersBefore = idleRenders
    const es = openInstances()[0]
    act(() => {
      es.emitOpen()
      es.emitMessage({ AAPL: { price: 42 } })
      es.emitMessage({ AAPL: { price: 43 } })
    })
    expect(active.result.current.prices.AAPL.price).toBe(43)
    expect(idleRenders).toBe(rendersBefore)   // idle consumer untouched by publishes
    expect(idle.result.current.prices).toEqual({})
    expect(idle.result.current.isStreaming).toBe(false)

    idle.unmount(); active.unmount()
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
