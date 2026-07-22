// app/src/hooks/useSingleStockEtfs.test.js
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import useSingleStockEtfs from './useSingleStockEtfs'

const FAMILY = {
  underlying: 'NBIS',
  long: [{ ticker: 'NBIL', name: 'GraniteShares 2x Long NBIS', factor: 2, avg_dollar_vol: 5e7 }],
  short: [{ ticker: 'NBIZ', name: 'Tradr 2X Short NBIS', factor: 2, avg_dollar_vol: 9e6 }],
  best_long: 'NBIL', best_short: 'NBIZ',
}

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => FAMILY }))
})

describe('useSingleStockEtfs', () => {
  it('fetches the family for a plain symbol', async () => {
    const { result } = renderHook(() => useSingleStockEtfs('NBIS'))
    await waitFor(() => expect(result.current.hasFamily).toBe(true))
    expect(result.current.family.best_long).toBe('NBIL')
    expect(global.fetch).toHaveBeenCalledWith('/api/single-stock-etfs/NBIS', expect.anything())
  })

  it('skips theme pseudo-tickers and empty syms', () => {
    renderHook(() => useSingleStockEtfs('$IDX:ai-infrastructure'))
    renderHook(() => useSingleStockEtfs(''))
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('hasFamily false on the empty shape', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () =>
      ({ underlying: null, long: [], short: [], best_long: null, best_short: null }) }))
    const { result } = renderHook(() => useSingleStockEtfs('KO'))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(result.current.hasFamily).toBe(false)
  })
})
