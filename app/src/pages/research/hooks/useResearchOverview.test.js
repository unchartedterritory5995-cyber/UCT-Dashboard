import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// Mock useMobileSWR to capture the URLs requested and return canned data.
const calls = []
vi.mock('../../../hooks/useMobileSWR', () => ({
  default: (url) => {
    calls.push(url)
    if (url?.includes('/api/ticker-meta/')) return { data: { name: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics' } }
    if (url?.includes('/api/fundamentals/')) return { data: { market_cap: '$2.95T', forward_pe: 28.5, beta: 1.22, week52_high: 243, week52_low: 164, div_yield: 0.42 } }
    if (url?.includes('/api/earnings/intel/')) return { data: { consensus: { buy: 37, hold: 8, sell: 1 }, price_target: { targetLow: 230, targetMean: 251, targetHigh: 280 } } }
    return { data: null }
  },
}))
vi.mock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: { AAPL: { price: 256.5, change_pct: 1.8 } } }) }))

import useResearchOverview from './useResearchOverview'

describe('useResearchOverview', () => {
  beforeEach(() => { calls.length = 0 })

  it('requests the composing endpoints for the upper-cased symbol', () => {
    renderHook(() => useResearchOverview('aapl'))
    expect(calls).toContain('/api/ticker-meta/AAPL')
    expect(calls).toContain('/api/fundamentals/AAPL')
    expect(calls).toContain('/api/earnings/intel/AAPL')
  })

  it('returns a normalized shape with meta, stats, analyst, live', () => {
    const { result } = renderHook(() => useResearchOverview('AAPL'))
    expect(result.current.meta.name).toBe('Apple Inc.')
    expect(result.current.stats.forward_pe).toBe(28.5)
    expect(result.current.analyst.consensus.buy).toBe(37)
    expect(result.current.live.change_pct).toBe(1.8)
  })
})
