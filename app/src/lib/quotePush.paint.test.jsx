// Owner target (2026-11-25): <= 40 ms p50 from a trade at our servers to the ROW PAINTED. A pushed batch is
// applied on the next animation frame; the rows it changes must COMMIT in that same frame. A plain setState
// from a store listener is a default-priority render scheduled as a task, which runs after the frame has
// painted: the row would show the price one frame (~16 ms) later. So the push path commits synchronously.
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'

vi.mock('./realtimeCandle', () => ({ applyTick: vi.fn(), applyBarClose: vi.fn(), applyCorrection: vi.fn() }))

import * as qp from './quotePush'
import { __setQuotePushForTest } from './quotePushGate'
import * as store from '../hooks/livePriceStore'
import useLivePrices from '../hooks/useLivePrices'

class FakeEventSource {
  static instances = []
  constructor(url) { this.url = url; this.listeners = {}; this.closed = false; FakeEventSource.instances.push(this) }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  close() { this.closed = true }
  emitOpen() { this.onopen?.() }
  frame(...quotes) { this.onmessage?.({ data: JSON.stringify([Date.now(), ...quotes]) }) }
  emitEvent(type, obj) { for (const fn of this.listeners[type] || []) fn({ data: JSON.stringify(obj) }) }
}

let rafQueue = []
const runFrame = () => { const q = rafQueue; rafQueue = []; for (const cb of q) cb(0) }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

function Row() {
  const { prices } = useLivePrices(['AAPL'])
  return <span data-testid="px">{prices.AAPL ? String(prices.AAPL.price) : '-'}</span>
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-24T15:00:00Z'))   // a Tuesday, 10:00 ET
  FakeEventSource.instances = []
  globalThis.EventSource = FakeEventSource
  rafQueue = []
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length }
  globalThis.cancelAnimationFrame = () => {}
  localStorage.clear()
  localStorage.setItem('uct.quotePush', '1')
  globalThis.fetch = vi.fn(() => Promise.resolve({
    ok: true, status: 200, headers: { get: () => null },
    json: () => Promise.resolve({ AAPL: { price: 100, prev_close: 99, change_pct: 1, change: 1, volume: 500, ext_session: null } }),
  }))
  qp._resetForTests()
  __setQuotePushForTest(qp)   // the stores reach the lazy module through the gate
  store.__resetForTest()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  cleanup()
  store.__resetForTest()
  qp._resetForTests()
  vi.useRealTimers()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

describe('a pushed price commits in the frame that applies it', () => {
  it('the row shows the pushed price as soon as the animation frame runs, with no further task', async () => {
    let view
    await act(async () => {
      view = render(<Row />)
      await flush()                       // the first REST poll lands
    })
    expect(view.getByTestId('px').textContent).toBe('100')
    vi.advanceTimersByTime(qp.SET_DEBOUNCE_MS + 5)
    const es = FakeEventSource.instances.find((e) => !e.closed && e.url.startsWith('/api/stream/quotes'))
    es.emitOpen()
    es.emitEvent('hello', { v: 2, symbols: 1 })
    es.emitEvent('status', { live: true })
    globalThis.IS_REACT_ACT_ENVIRONMENT = false   // a real browser: no act() to flush renders for us
    es.frame(['AAPL', 101.98, 900, Date.now()])
    expect(view.getByTestId('px').textContent).toBe('100')     // not before the frame
    runFrame()
    expect(view.getByTestId('px').textContent).toBe('101.98') // committed inside the frame callback
  })
})
