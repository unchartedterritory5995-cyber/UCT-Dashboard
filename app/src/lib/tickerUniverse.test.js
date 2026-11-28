// The ticker universe the symbol search reads at the keystroke (lib/tickerUniverse.js).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ensureTickerUniverse, isKnownTicker, uniqueCompletion, hasLongerCompletion, noteTickerUniverseVersion, __resetTickerUniverseForTests } from './tickerUniverse'

const LIST = ['GOOGL', 'GOOG', 'CRBG', 'CRBN', 'NVDA', 'nvo']
const fetchOk = (symbols = LIST, v = 'abc') => vi.fn(async () => ({ ok: true, json: async () => ({ v, symbols }) }))

beforeEach(() => { __resetTickerUniverseForTests() })

describe('tickerUniverse', () => {
  it('answers null before a list is held: callers keep their old behaviour', () => {
    expect(isKnownTicker('NVDA')).toBe(null)
    expect(uniqueCompletion('NV')).toBe(null)
  })

  it('once loaded: an exact ticker is known (any case), a non-ticker is not', async () => {
    expect(await ensureTickerUniverse({ fetchImpl: fetchOk() })).toBe(true)
    expect(isKnownTicker('nvda')).toBe(true)
    expect(isKnownTicker('NVO')).toBe(true)
    expect(isKnownTicker('NV')).toBe(false)
  })

  it('a unique completion only when exactly one ticker starts with the prefix', async () => {
    await ensureTickerUniverse({ fetchImpl: fetchOk() })
    expect(uniqueCompletion('NVD')).toBe('NVDA')
    expect(uniqueCompletion('NV')).toBe(null)          // NVDA and NVO
    expect(uniqueCompletion('GOO')).toBe(null)         // GOOG and GOOGL
    expect(uniqueCompletion('GOOG')).toBe(null)        // GOOG itself and GOOGL
    expect(uniqueCompletion('GOOGL')).toBe('GOOGL')
    expect(uniqueCompletion('ZZ')).toBe(null)
    expect(uniqueCompletion('')).toBe(null)
  })

  it('hasLongerCompletion: true only when a longer ticker starts with the text', async () => {
    expect(hasLongerCompletion('GOOG')).toBe(null)    // no list held
    await ensureTickerUniverse({ fetchImpl: fetchOk() })
    expect(hasLongerCompletion('GOOG')).toBe(true)
    expect(hasLongerCompletion('GOOGL')).toBe(false)
    expect(hasLongerCompletion('NVDA')).toBe(false)
    expect(hasLongerCompletion('NV')).toBe(true)
  })

  it('kept in this browser: a reload reads the copy without a request, while it is fresh', async () => {
    await ensureTickerUniverse({ fetchImpl: fetchOk() })
    __resetTickerUniverseForTests({ cache: false })
    const f = fetchOk()
    expect(await ensureTickerUniverse({ fetchImpl: f })).toBe(true)
    expect(f).not.toHaveBeenCalled()
    expect(isKnownTicker('CRBG')).toBe(true)
  })

  it('a search naming another version replaces the held list at once; the same version asks nothing', async () => {
    await ensureTickerUniverse({ fetchImpl: fetchOk(LIST, 'v1') })
    const same = fetchOk(LIST, 'v1')
    noteTickerUniverseVersion('v1', { fetchImpl: same })
    expect(same).not.toHaveBeenCalled()
    const next = fetchOk([...LIST, 'NEWCO'], 'v2')
    noteTickerUniverseVersion('v2', { fetchImpl: next })
    await new Promise((r) => setTimeout(r, 0))
    expect(next).toHaveBeenCalledTimes(1)
    expect(isKnownTicker('NEWCO')).toBe(true)
  })

  it('a failed request keeps what is held and never throws', async () => {
    const bad = vi.fn(async () => { throw new Error('offline') })
    expect(await ensureTickerUniverse({ fetchImpl: bad })).toBe(false)
    expect(isKnownTicker('NVDA')).toBe(null)
  })
})
