// Lane w9-10 (terminal render storms): every useLivePrices caller used to re-render on every 2 s
// poll, even when nothing moved (after hours, weekends) and even when only ANOTHER caller's ticker
// moved. Four terminal panels plus four headlines = eight renders every two seconds, all static.
// The store now keeps an unmoved ticker's entry object and emits nothing when nothing moved; the
// hook skips a caller whose own slice holds the same entry objects.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { registerTickers, getSnapshot, subscribe, pollNow, __resetForTest } from './livePriceStore'
import useLivePrices from './useLivePrices'

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
let payload
const answer = () => Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(JSON.stringify(payload))) })

beforeEach(() => {
  __resetForTest()
  payload = { AAPL: { price: 10, change_pct: 1 }, MSFT: { price: 20, change_pct: 2 } }
  global.fetch = vi.fn(answer)
})
afterEach(() => {
  __resetForTest()
  vi.restoreAllMocks()
})

describe('livePriceStore: a poll that moved nothing changes nothing', () => {
  it('emits once for the first answer, then not at all for an identical one', async () => {
    const seen = vi.fn()
    subscribe(seen)
    const off = registerTickers(['AAPL', 'MSFT'])
    await flush()
    expect(seen).toHaveBeenCalledTimes(1)
    const snap = getSnapshot()
    pollNow(); await flush()
    expect(global.fetch.mock.calls.length).toBeGreaterThanOrEqual(2)   // control: it DID poll
    expect(seen).toHaveBeenCalledTimes(1)
    expect(getSnapshot()).toBe(snap)
    off()
  })

  it('a move in one ticker emits, and the unmoved ticker keeps its entry object', async () => {
    const seen = vi.fn()
    subscribe(seen)
    const off = registerTickers(['AAPL', 'MSFT'])
    await flush()
    const before = getSnapshot()
    payload.AAPL.price = 11
    pollNow(); await flush()
    expect(seen).toHaveBeenCalledTimes(2)
    expect(getSnapshot().AAPL).toEqual({ price: 11, change_pct: 1 })
    expect(getSnapshot().MSFT).toBe(before.MSFT)
    off()
  })
})

function Probe({ tickers, onRender }) {
  const { prices } = useLivePrices(tickers)
  onRender(prices)
  return null
}

describe('useLivePrices: a caller re-renders only for its own tickers', () => {
  it('an MSFT move does not re-render an AAPL caller; an AAPL move does', async () => {
    const aapl = vi.fn()
    const msft = vi.fn()
    render(<><Probe tickers={['AAPL']} onRender={aapl} /><Probe tickers={['MSFT']} onRender={msft} /></>)
    await act(async () => { await flush() })
    expect(aapl.mock.lastCall[0]).toEqual({ AAPL: { price: 10, change_pct: 1 } })
    const a0 = aapl.mock.calls.length
    const m0 = msft.mock.calls.length

    payload.MSFT.price = 21
    await act(async () => { pollNow(); await flush() })
    expect(msft.mock.calls.length).toBeGreaterThan(m0)            // control: the mover re-rendered
    expect(msft.mock.lastCall[0].MSFT.price).toBe(21)
    expect(aapl.mock.calls.length).toBe(a0)                       // the bystander did not

    await act(async () => { pollNow(); await flush() })           // nothing moved
    expect(aapl.mock.calls.length).toBe(a0)

    payload.AAPL.price = 12
    await act(async () => { pollNow(); await flush() })
    expect(aapl.mock.calls.length).toBeGreaterThan(a0)
    expect(aapl.mock.lastCall[0].AAPL.price).toBe(12)
  })

  it('a caller whose ticker set changes reads the store as it stands', async () => {
    const seen = vi.fn()
    const off = registerTickers(['AAPL', 'MSFT'])     // the store already holds MSFT
    await act(async () => { await flush() })
    const { rerender } = render(<Probe tickers={['AAPL']} onRender={seen} />)
    await act(async () => { await flush() })
    rerender(<Probe tickers={['MSFT']} onRender={seen} />)
    await act(async () => { await flush() })
    expect(seen.mock.lastCall[0]).toEqual({ MSFT: { price: 20, change_pct: 2 } })
    off()
  })
})
