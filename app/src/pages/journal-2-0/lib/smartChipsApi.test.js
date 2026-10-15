// app/src/pages/journal-2-0/lib/smartChipsApi.test.js
import { describe, expect, it, vi } from 'vitest'
import { canonicalSymbol, confirmsSymbol, tickersIn, __clearTickerCacheForTests } from './smartChipsApi'

const ok = (tickers) => vi.fn(async () => ({ ok: true, json: async () => ({ tickers }) }))

describe('tickersIn', () => {
  it('posts the text once and caches the answer', async () => {
    __clearTickerCacheForTests()
    const f = ok([{ symbol: 'NVDA', tier: 'exact' }])
    expect(await tickersIn('alert me if NVDA closes below 120', f)).toEqual([{ symbol: 'NVDA', tier: 'exact' }])
    await tickersIn('alert me if NVDA closes below 120', f)
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][0]).toBe('/api/j2/smart-chips/tickers')
  })
  it('a refusal or a dropped network is null, and is not cached', async () => {
    __clearTickerCacheForTests()
    const bad = vi.fn(async () => ({ ok: false, status: 402 }))
    expect(await tickersIn('x NVDA', bad)).toBeNull()
    const down = vi.fn(async () => { throw new TypeError('offline') })
    expect(await tickersIn('x NVDA', down)).toBeNull()
    expect(down).toHaveBeenCalledTimes(1)
  })
  it('sends the text as the body, with the session cookie, capped at 2,000 characters', async () => {
    __clearTickerCacheForTests()
    const f = ok([])
    await tickersIn('a'.repeat(2500), f)
    const [, init] = f.mock.calls[0]
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(JSON.parse(init.body).text).toHaveLength(2000)
  })
  it('an empty sentence is not worth a request', async () => {
    __clearTickerCacheForTests()
    const f = ok([])
    expect(await tickersIn('   ', f)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
  it('a body without a tickers list is "could not check", not "no tickers"', async () => {
    __clearTickerCacheForTests()
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ nope: 1 }) }))
    expect(await tickersIn('x NVDA y', f)).toBeNull()
  })
})

describe('confirmsSymbol', () => {
  it('matches the canonical form', () => {
    expect(canonicalSymbol('brk.b')).toBe('BRK-B')
    expect(confirmsSymbol([{ symbol: 'BRK-B', tier: 'exact' }], 'BRK.B')).toBe(true)
    expect(confirmsSymbol([], 'NVDA')).toBe(false)
    expect(confirmsSymbol(null, 'NVDA')).toBe(false)
  })
})
