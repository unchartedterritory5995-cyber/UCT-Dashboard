// The streamed chain's shared pool (FT-015 under TERM-024): one probe and one EventSource per
// (underlying, expiration), however many panels hold it; the last one out closes it.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { subscribe, getSnapshot, _resetForTests, EMPTY_CHAIN } from './chainStreamManager'

class FakeES {
  static opened = []
  constructor(url) { this.url = url; this.closed = false; FakeES.opened.push(this) }
  close() { this.closed = true }
}
const C = 'O:TST261016C00100000'
const armed = () => vi.fn(() => Promise.resolve({ status: 200, json: () => Promise.resolve({ quotes: { [C]: { last: 1 } }, coverage: null }) }))
const flush = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => { _resetForTests(); vi.unstubAllGlobals(); FakeES.opened = [] })

describe('chainStreamManager', () => {
  it('two subscribers to one chain share ONE probe and ONE stream; the last one out closes it', async () => {
    vi.stubGlobal('EventSource', FakeES)
    vi.stubGlobal('fetch', armed())
    const a = vi.fn(); const b = vi.fn()
    const offA = subscribe('TST', '2026-10-16', a)
    const offB = subscribe('TST', '2026-10-16', b)
    await flush(); await flush()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(FakeES.opened).toHaveLength(1)
    FakeES.opened[0].onmessage({ data: JSON.stringify({ quotes: { [C]: { bid: 0.9 } } }) })
    expect(getSnapshot('TST', '2026-10-16').quotes[C]).toEqual({ last: 1, bid: 0.9 })
    expect(a).toHaveBeenLastCalledWith(expect.objectContaining({ on: true }))
    expect(b).toHaveBeenLastCalledWith(expect.objectContaining({ on: true }))
    offA()
    expect(FakeES.opened[0].closed).toBe(false)
    offB()
    expect(FakeES.opened[0].closed).toBe(true)
    expect(getSnapshot('TST', '2026-10-16')).toBe(EMPTY_CHAIN)
  })

  it('a second expiration is its own entry (CONTROL: sharing is per chain, not global)', async () => {
    vi.stubGlobal('EventSource', FakeES)
    vi.stubGlobal('fetch', armed())
    subscribe('TST', '2026-10-16', () => {})
    subscribe('TST', '2026-10-23', () => {})
    await flush(); await flush()
    expect(FakeES.opened.map((e) => e.url.split('expiration=')[1])).toEqual(['2026-10-16', '2026-10-23'])
  })

  it('switched off (404): no stream, and the state stays off', async () => {
    vi.stubGlobal('EventSource', FakeES)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ status: 404, json: () => Promise.resolve({}) })))
    subscribe('TST', '2026-10-16', () => {})
    await flush(); await flush()
    expect(FakeES.opened).toEqual([])
    expect(getSnapshot('TST', '2026-10-16').on).toBe(false)
  })
})
