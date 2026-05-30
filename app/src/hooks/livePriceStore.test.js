import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerTickers, getSnapshot, subscribe, __resetForTest } from './livePriceStore'

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }

describe('livePriceStore', () => {
  beforeEach(() => {
    __resetForTest()
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ AAPL: { price: 1 }, MSFT: { price: 2 } }) }),
    )
  })
  afterEach(() => {
    __resetForTest()
    vi.restoreAllMocks()
  })

  it('polls the UNION of all registered tickers in a single request', async () => {
    registerTickers(['AAPL'])
    registerTickers(['MSFT'])
    await flush()
    const urls = global.fetch.mock.calls.map((c) => c[0])
    // at least one request covers both tickers (the union), not one-per-caller
    expect(urls.some((u) => u.includes('AAPL') && u.includes('MSFT'))).toBe(true)
  })

  it('notifies subscribers and exposes prices via getSnapshot', async () => {
    const seen = vi.fn()
    subscribe(seen)
    registerTickers(['AAPL'])
    await flush()
    expect(seen).toHaveBeenCalled()
    expect(getSnapshot().AAPL).toEqual({ price: 1 })
  })

  it('ref-counts: prices clear only when the last subscriber unregisters', async () => {
    const unA = registerTickers(['AAPL'])
    const unB = registerTickers(['AAPL'])
    await flush()
    unA()
    expect(getSnapshot().AAPL).toBeDefined() // still one ref left
    unB()
    expect(getSnapshot()).toEqual({}) // last ref gone → cleared
  })
})
