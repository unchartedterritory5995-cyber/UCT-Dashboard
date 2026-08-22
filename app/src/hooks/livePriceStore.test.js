import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerTickers, getSnapshot, subscribe, pollNow, __resetForTest } from './livePriceStore'

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

  it('keeps last-good when a later poll returns a degraded entry (price<=0)', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ AAPL: { price: 10, change_pct: 2.5 } }) }),
    )
    registerTickers(['AAPL'])
    await flush()
    expect(getSnapshot().AAPL).toEqual({ price: 10, change_pct: 2.5 })
    // A degraded poll (Massive returned an empty/zero entry) must NOT blank it.
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ AAPL: { price: 0, change_pct: 0 } }) }),
    )
    pollNow()
    await flush()
    expect(getSnapshot().AAPL).toEqual({ price: 10, change_pct: 2.5 }) // unchanged
  })

  it('keeps last-good for a ticker omitted from a later poll', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ AAPL: { price: 10 }, MSFT: { price: 20 } }) }),
    )
    registerTickers(['AAPL', 'MSFT'])
    await flush()
    // A later poll drops MSFT entirely (timeout / partial batch).
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ AAPL: { price: 11 } }) }),
    )
    pollNow()
    await flush()
    expect(getSnapshot().AAPL).toEqual({ price: 11 })   // updated
    expect(getSnapshot().MSFT).toEqual({ price: 20 })   // preserved
  })

  it('preserves the after-hours ext price when a static-price poll drops it', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ AAPL: { price: 100, ext_price: 101, ext_session: 'post' } }) }),
    )
    registerTickers(['AAPL'])
    await flush()
    expect(getSnapshot().AAPL.ext_price).toBe(101)
    // Poll momentarily drops ext but the price is UNCHANGED → keep the last-good ext.
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ AAPL: { price: 100, ext_price: null, ext_session: null } }) }),
    )
    pollNow(); await flush()
    expect(getSnapshot().AAPL.ext_price).toBe(101)     // preserved
    // A poll where the price actually MOVED + no ext → real new activity → ext clears.
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ AAPL: { price: 105, ext_price: null, ext_session: null } }) }),
    )
    pollNow(); await flush()
    expect(getSnapshot().AAPL.ext_price == null).toBe(true)  // cleared
  })

  it('splits a union over 250 tickers into multiple ≤250-ticker requests and merges the results', async () => {
    const many = Array.from({ length: 260 }, (_, i) => `T${i}`)
    global.fetch = vi.fn((url) => {
      const qs = new URL(url, 'http://x').searchParams.get('tickers')
      const syms = qs.split(',')
      const body = {}
      for (const s of syms) body[s] = { price: 1 }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
    })
    registerTickers(many)
    await flush()
    expect(global.fetch.mock.calls.length).toBeGreaterThanOrEqual(2)
    for (const call of global.fetch.mock.calls) {
      const url = call[0]
      const qs = new URL(url, 'http://x').searchParams.get('tickers')
      expect(qs.split(',').length).toBeLessThanOrEqual(250)
    }
    expect(getSnapshot().T0).toEqual({ price: 1 })
    expect(getSnapshot().T259).toEqual({ price: 1 })
  })

  it('keeps last-good prices when every chunk of a split request fails', async () => {
    const many = Array.from({ length: 260 }, (_, i) => `T${i}`)
    global.fetch = vi.fn((url) => {
      const qs = new URL(url, 'http://x').searchParams.get('tickers')
      const syms = qs.split(',')
      const body = {}
      for (const s of syms) body[s] = { price: 5 }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
    })
    registerTickers(many)
    await flush()
    expect(getSnapshot().T0).toEqual({ price: 5 })
    global.fetch = vi.fn(() => Promise.resolve({ ok: false }))
    pollNow()
    await flush()
    expect(getSnapshot().T0).toEqual({ price: 5 }) // unchanged, both chunks failed
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
