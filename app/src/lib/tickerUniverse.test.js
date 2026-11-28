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

// ⭐⭐ (2026-11-28, zero-network plan 1.4) THE TICKERS THE TYPED TEXT CAN STILL BECOME, best first.
describe('rankedCompletions', () => {
  const SYMS = ['CRBG', 'CRBN', 'CRM', 'CRWD', 'CR', 'XCRM']
  const POP = [40, 300, 2, 3, 0, 1]     // CR has no number (0)
  const load = (pop = POP) => ensureTickerUniverse({ fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({ v: 'p', symbols: SYMS, pop }) })) })

  it('nothing while no list is held, for empty text, or when nothing starts with the text', async () => {
    const { rankedCompletions } = await import('./tickerUniverse')
    expect(rankedCompletions('CR')).toEqual([])
    await load()
    expect(rankedCompletions('')).toEqual([])
    expect(rankedCompletions('ZZ')).toEqual([])
  })

  it('prefix only (never a contains match), the exact text first, then popularity; at most k', async () => {
    const { rankedCompletions } = await import('./tickerUniverse')
    await load()
    expect(rankedCompletions('CR', 3)).toEqual(['CR', 'CRM', 'CRWD'])
    expect(rankedCompletions('CRB', 3)).toEqual(['CRBG', 'CRBN'])
    expect(rankedCompletions('CR', 10)).not.toContain('XCRM')
    expect(rankedCompletions('C', 2)).toEqual(['CRM', 'CRWD'])
  })

  it('the member\'s score leads popularity; the excluded symbol is never returned', async () => {
    const { rankedCompletions } = await import('./tickerUniverse')
    await load()
    const score = (s) => (s === 'CRBN' ? 2 : 0)
    expect(rankedCompletions('CRB', 3, { score })).toEqual(['CRBN', 'CRBG'])
    expect(rankedCompletions('C', 3, { score, exclude: 'crm' })).toEqual(['CRBN', 'CRWD', 'CRBG'])
  })

  it('without `pop` (an older answer or copy): shorter first, then A-Z', async () => {
    const { rankedCompletions } = await import('./tickerUniverse')
    await load(null)
    expect(rankedCompletions('CR', 4)).toEqual(['CR', 'CRM', 'CRBG', 'CRBN'])
  })

  it('the ranks are kept in this browser\'s copy', async () => {
    const { rankedCompletions } = await import('./tickerUniverse')
    await load()
    __resetTickerUniverseForTests({ cache: false })
    await ensureTickerUniverse({ fetchImpl: vi.fn() })
    expect(rankedCompletions('C', 2)).toEqual(['CRM', 'CRWD'])
  })
})
