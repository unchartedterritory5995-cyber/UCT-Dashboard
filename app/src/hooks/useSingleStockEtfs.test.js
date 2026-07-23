// app/src/hooks/useSingleStockEtfs.test.js
import React from 'react'
import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { SWRConfig, useSWRConfig } from 'swr'
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

  it('a non-ok first load yields no family without crashing', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 503 }))
    const { result } = renderHook(() => useSingleStockEtfs('NBIS'))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(result.current.hasFamily).toBe(false)   // nothing to show yet; SWR will retry
    expect(result.current.family).toBeNull()
  })

  it('KEEPS the last-good family through a transient failure (the deploy-blip bug)', async () => {
    // First fetch succeeds; a later revalidation blips (503). The pill must NOT
    // vanish — SWR retains data for the key on error because the fetcher throws.
    let n = 0
    global.fetch = vi.fn(async () => {
      n += 1
      return n === 1 ? { ok: true, json: async () => FAMILY } : { ok: false, status: 503 }
    })
    const wrapper = ({ children }) => React.createElement(
      SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children)
    const { result } = renderHook(() => {
      const fam = useSingleStockEtfs('NBIS')
      const { mutate } = useSWRConfig()
      return { fam, mutate }
    }, { wrapper })
    await waitFor(() => expect(result.current.fam.hasFamily).toBe(true))
    // force a revalidation that fails (simulates the /api blip during a deploy)
    await act(async () => {
      await result.current.mutate('/api/single-stock-etfs/NBIS').catch(() => {})
    })
    expect(n).toBeGreaterThan(1)                        // the failing refetch actually ran
    expect(result.current.fam.hasFamily).toBe(true)     // pill STILL shows (last-good retained)
    expect(result.current.fam.family.best_long).toBe('NBIL')
  })
})
