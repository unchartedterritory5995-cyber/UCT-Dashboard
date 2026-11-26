// (review of #2749) /api/live-prices rows carry INSTRUMENT fields (fetched_at_ms, observed_ms,
// last_trade_ms): times that move on every server refetch while the price does not. The w9-10
// render-storm fix compares every field of an entry, so without this rule every poll after a
// refetch would emit and re-render every subscriber with identical prices (every closed-market
// poll; about every 15 s in session). An unchanged row keeps the entry, and so the fetch time, of
// the poll that first delivered its price.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerTickers, getSnapshot, subscribe, pollNow, __resetForTest } from './livePriceStore'

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
let payload
const answer = () => Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(JSON.stringify(payload))) })

beforeEach(() => {
  __resetForTest()
  payload = { AAPL: { price: 10, change_pct: 1, fetched_at_ms: 1000, observed_ms: 900, last_trade_ms: 890 } }
  global.fetch = vi.fn(answer)
})
afterEach(() => {
  __resetForTest()
  vi.restoreAllMocks()
})

describe('livePriceStore: instrument fields alone never make a change', () => {
  it('two polls, same prices, new fetch/observe/trade times: no emit, the first entry kept', async () => {
    const seen = vi.fn()
    subscribe(seen)
    const off = registerTickers(['AAPL'])
    await flush()
    expect(seen).toHaveBeenCalledTimes(1)
    const first = getSnapshot().AAPL
    payload.AAPL = { ...payload.AAPL, fetched_at_ms: 16000, observed_ms: 15900, last_trade_ms: 15800 }
    pollNow(); await flush()
    expect(global.fetch.mock.calls.length).toBeGreaterThanOrEqual(2)   // control: it DID poll
    expect(seen).toHaveBeenCalledTimes(1)
    expect(getSnapshot().AAPL).toBe(first)
    expect(getSnapshot().AAPL.fetched_at_ms).toBe(1000)                 // the poll that first delivered it
    off()
  })

  it('a moved price still emits, carrying its own fetch time', async () => {
    const seen = vi.fn()
    subscribe(seen)
    const off = registerTickers(['AAPL'])
    await flush()
    payload.AAPL = { ...payload.AAPL, price: 10.5, fetched_at_ms: 16000 }
    pollNow(); await flush()
    expect(seen).toHaveBeenCalledTimes(2)
    expect(getSnapshot().AAPL.price).toBe(10.5)
    expect(getSnapshot().AAPL.fetched_at_ms).toBe(16000)
    off()
  })

  it('an instrument field appearing for the first time is not a change either', async () => {
    payload = { AAPL: { price: 10, change_pct: 1 } }
    const seen = vi.fn()
    subscribe(seen)
    const off = registerTickers(['AAPL'])
    await flush()
    payload = { AAPL: { price: 10, change_pct: 1, fetched_at_ms: 2000 } }
    pollNow(); await flush()
    expect(seen).toHaveBeenCalledTimes(1)
    off()
  })
})
