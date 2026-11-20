// Currency pairs on the client (lib/cryptoPairs.js). Rails:
//   * only a symbol in the short candidate list is ever asked about: a stock, `BTC` (the fund),
//     an empty or non-string symbol send NOTHING;
//   * a 404 (the switch off, or a member it does not admit), a failed read, a read in flight and
//     an answer of the wrong shape all mean "not a pair", and a 404 is not asked again;
//   * the quote is read only for a candidate, only when asked, and again on a timer;
//   * no price is null (never "0.00"); the change keeps its sign; the time is FMP's, in New
//     York time, and absent when FMP sent none;
//   * nothing this module says contains the word "live".
// Every price here is invented.
import { createElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../utils/jsonFetcher'
import {
  PAIR_CANDIDATES, PAIR_QUOTE_POLL_MS, PAIR_TFS, PAIRS_URL, admittedPair, pairAsOfText, pairCandidate, pairDirection,
  pairPct, pairPrice, pairQuoteKey, pairQuoteUrl, pairQuoteView, pairSourceLine, pairsKey, useCryptoPair, useCryptoQuote,
} from './cryptoPairs'

const PAIRS = { source: 'FMP', pairs: [{ symbol: 'BTCUSD', name: 'Bitcoin', base: 'BTC', quote: 'USD' }] }
const QUOTE = {
  symbol: 'BTCUSD', name: 'Bitcoin', source: 'FMP', state: 'fresh', price: 41234.5, change: 494.81, change_pct: 1.2,
  open: 40800, day_high: 41500.25, day_low: 40511, prev_close: 40739.69, year_high: 50000, year_low: 20000,
  as_of: 1794657600,   // 2026-11-14 12:00:00 UTC = 7:00 AM in New York
}
const fail = (status) => Object.assign(new Error(`http ${status}`), { status })
const wrapper = ({ children }) => createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children)

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('which symbols are asked about', () => {
  it('the candidate list is BTCUSD, and BTC alone is not in it', () => {
    expect([...PAIR_CANDIDATES]).toEqual(['BTCUSD'])
    expect(pairCandidate('btcusd ')).toBe('BTCUSD')
    for (const not of ['BTC', 'NVDA', 'BTC-USD', 'BTCUSDT', 'XBTCUSD', '', null, undefined, 7, {}]) expect(pairCandidate(not), String(not)).toBe(null)
    expect([...PAIR_TFS]).toEqual(['D', 'W', 'M'])
  })

  it('a stock, the fund BTC and an empty symbol have no key at all, for the list or the quote', () => {
    for (const sym of ['NVDA', 'BTC', 'SPY', '', null, undefined]) {
      expect(pairsKey(sym), String(sym)).toBe(null)
      expect(pairQuoteKey(sym), String(sym)).toBe(null)
    }
    expect(pairsKey('BTCUSD')).toEqual([PAIRS_URL, 'crypto-pairs'])
    expect(pairQuoteKey('btcusd')).toEqual(['/api/crypto/quote/BTCUSD', 'crypto-quote'])
    expect(pairQuoteUrl('BTCUSD')).toBe('/api/crypto/quote/BTCUSD')
  })

  it.each(['NVDA', 'BTC', '', null])('useCryptoPair(%s) sends nothing and answers null', async (sym) => {
    const { result } = renderHook(() => useCryptoPair(sym), { wrapper })
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current).toBe(null)
    expect(jsonFetcher).not.toHaveBeenCalled()
  })
})

describe('what the server admits', () => {
  it('an admitted pair comes back with its name and source', async () => {
    jsonFetcher.mockResolvedValue(PAIRS)
    const { result } = renderHook(() => useCryptoPair('btcusd'), { wrapper })
    expect(result.current).toBe(null)                       // in flight: not a pair yet
    await waitFor(() => expect(result.current).not.toBe(null))
    expect(result.current).toEqual({ symbol: 'BTCUSD', name: 'Bitcoin', base: 'BTC', quote: 'USD', source: 'FMP' })
    expect(jsonFetcher.mock.calls.map(([u]) => u)).toEqual([PAIRS_URL])
  })

  it('a 404 (the switch off) is "not a pair", and is not asked again', async () => {
    jsonFetcher.mockRejectedValue(fail(404))
    const { result, rerender } = renderHook(() => useCryptoPair('BTCUSD'), { wrapper })
    await waitFor(() => expect(jsonFetcher).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 60))
    rerender()
    expect(result.current).toBe(null)
    expect(jsonFetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a failed read', null],
    ['an empty list', { source: 'FMP', pairs: [] }],
    ['a list without this pair', { source: 'FMP', pairs: [{ symbol: 'ETHUSD', name: 'Ether' }] }],
    ['pairs that is not a list', { pairs: { BTCUSD: {} } }],
    ['a string', 'BTCUSD'],
    ['rows that are not objects', { pairs: [null, 'BTCUSD', 5] }],
  ])('%s admits nothing', (_name, body) => {
    expect(admittedPair(body, 'BTCUSD')).toBe(null)
  })

  it('an admitted list never admits a symbol that is not a candidate', () => {
    const body = { source: 'FMP', pairs: [{ symbol: 'NVDA', name: 'Not a pair' }, ...PAIRS.pairs] }
    expect(admittedPair(body, 'NVDA')).toBe(null)
    expect(admittedPair(body, 'BTC')).toBe(null)
    expect(admittedPair(body, 'BTCUSD').name).toBe('Bitcoin')
  })

  it('a row with no name falls back to the symbol', () => {
    expect(admittedPair({ pairs: [{ symbol: 'btcusd', name: '  ' }] }, 'BTCUSD')).toEqual({ symbol: 'BTCUSD', name: 'BTCUSD', base: '', quote: '', source: '' })
  })
})

describe('the quote read', () => {
  it('reads the one quote route for a candidate', async () => {
    jsonFetcher.mockResolvedValue(QUOTE)
    const { result } = renderHook(() => useCryptoQuote('BTCUSD'), { wrapper })
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.quote).toEqual(QUOTE))
    expect(result.current.loading).toBe(false)
    expect(jsonFetcher.mock.calls.map(([u]) => u)).toEqual(['/api/crypto/quote/BTCUSD'])
  })

  it('sends nothing when switched off by its caller, or for a symbol that is not a candidate', async () => {
    renderHook(() => useCryptoQuote('BTCUSD', false), { wrapper })
    renderHook(() => useCryptoQuote('NVDA'), { wrapper })
    renderHook(() => useCryptoQuote('BTC'), { wrapper })
    await new Promise((r) => setTimeout(r, 20))
    expect(jsonFetcher).not.toHaveBeenCalled()
  })

  it('a failed read is an error, not a quote', async () => {
    jsonFetcher.mockRejectedValue(fail(500))
    const { result } = renderHook(() => useCryptoQuote('BTCUSD'), { wrapper: ({ children }) => createElement(SWRConfig, { value: { provider: () => new Map(), shouldRetryOnError: false } }, children) })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.quote).toBe(null)
    expect(result.current.loading).toBe(false)
    expect(result.current.error.status).toBe(500)
  })

  it('asks again on its timer, no faster than twice the server\'s own hold', async () => {
    expect(PAIR_QUOTE_POLL_MS).toBeGreaterThanOrEqual(30000)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    jsonFetcher.mockResolvedValue(QUOTE)
    renderHook(() => useCryptoQuote('BTCUSD'), { wrapper })
    await vi.waitFor(() => expect(jsonFetcher).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(PAIR_QUOTE_POLL_MS - 2000)
    expect(jsonFetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4000)
    await vi.waitFor(() => expect(jsonFetcher).toHaveBeenCalledTimes(2))
  })
})

describe('what a price is drawn as', () => {
  it('a price has two decimals and thousands separators; no price is null, never 0.00', () => {
    expect(pairPrice(41234.5)).toBe('41,234.50')
    expect(pairPrice(0.123456789)).toBe('0.123457')
    for (const none of [0, -1, null, undefined, NaN, Infinity, '41234.5', {}]) expect(pairPrice(none), String(none)).toBe(null)
  })

  it('the change keeps its sign and its direction', () => {
    expect(pairPct(1.2)).toBe('+1.20%')
    expect(pairPct(-0.456)).toBe('−0.46%')
    expect(pairPct(0)).toBe('0.00%')
    expect(pairPct(null)).toBe(null)
    expect(pairPct('1.2')).toBe(null)
    expect([pairDirection(1.2), pairDirection(-3), pairDirection(0), pairDirection(null)]).toEqual(['up', 'down', 'flat', 'flat'])
  })

  it('the time is the one FMP sent, in New York time, from seconds or milliseconds', () => {
    expect(pairAsOfText(1794657600)).toBe('Nov 14, 7:00 AM ET')
    expect(pairAsOfText(1794657600000)).toBe('Nov 14, 7:00 AM ET')
    for (const none of [null, undefined, 0, -5, NaN, '1794657600']) expect(pairAsOfText(none), String(none)).toBe(null)
  })
})

describe('what a surface says about a quote', () => {
  it('a priced quote: price, change, source and FMP\'s time', () => {
    const view = pairQuoteView(QUOTE)
    expect(view).toEqual({ kind: 'price', price: '41,234.50', pct: '+1.20%', dir: 'up', source: 'FMP', asOf: 'Nov 14, 7:00 AM ET', stale: false, failed: false })
    expect(pairSourceLine(view)).toBe('Source: FMP, price as of Nov 14, 7:00 AM ET')
  })

  it('a quote with no time says so instead of inventing one', () => {
    const view = pairQuoteView({ ...QUOTE, as_of: null })
    expect(view.asOf).toBe(null)
    expect(pairSourceLine(view)).toBe('Source: FMP, which sent no time for this price')
  })

  it('a held price after a failed read is stale and says the read failed', () => {
    const view = pairQuoteView({ ...QUOTE, state: 'failed' })
    expect([view.kind, view.stale, view.failed]).toEqual(['price', true, true])
    expect(pairSourceLine(view)).toBe('Source: FMP, price as of Nov 14, 7:00 AM ET (the last read failed)')
    expect(pairQuoteView({ ...QUOTE, state: 'stale' }).stale).toBe(true)
    expect(pairQuoteView({ ...QUOTE, state: 'stale' }).failed).toBe(false)
  })

  it.each([
    ['warming', { state: 'warming', price: null }, 'waiting'],
    ['failed with nothing held', { state: 'failed', price: null }, 'none'],
    ['a price of zero', { state: 'fresh', price: 0 }, 'none'],
    ['no quote at all', null, 'none'],
    ['a price that is text', { state: 'fresh', price: '41234.5' }, 'none'],
  ])('%s is not a price', (_name, quote, kind) => {
    const view = pairQuoteView(quote)
    expect(view.kind).toBe(kind)
    expect(view.price).toBe(null)
    expect(pairSourceLine(view)).toBe('Source: FMP')
  })

  it('never says "live"', () => {
    const said = [
      pairSourceLine(pairQuoteView(QUOTE)), pairSourceLine(pairQuoteView({ ...QUOTE, as_of: null })),
      pairSourceLine(pairQuoteView({ ...QUOTE, state: 'failed' })), pairSourceLine(pairQuoteView(null)),
    ].join(' ')
    expect(said).not.toMatch(/\blive\b|real.?time|streaming/i)
  })
})
