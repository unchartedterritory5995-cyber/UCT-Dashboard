import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { useTickerReturns } from './useTickerReturns'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

beforeEach(() => { vi.restoreAllMocks() })

describe('useTickerReturns', () => {
  it('null videoId fetches nothing and returns empties', () => {
    const spy = vi.spyOn(global, 'fetch')
    const { result } = renderHook(() => useTickerReturns(null), { wrapper })
    expect(result.current).toEqual({ anchorDate: null, returns: {} })
    expect(spy).not.toHaveBeenCalled()
  })
  it('maps the payload and hits the right URL', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({
      anchor_date: '2026-02-11', as_of: 'x',
      returns: { NVDA: { since_pct: 14.2, d5_pct: 3.1, d21_pct: 8.0 } } }) })
    const { result } = renderHook(() => useTickerReturns(42), { wrapper })
    await waitFor(() => expect(result.current.anchorDate).toBe('2026-02-11'))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/education/videos/42/ticker-returns', { credentials: 'include' })
    expect(result.current.returns.NVDA.since_pct).toBe(14.2)
  })
  it('error → empties (never throws into render)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false })
    const { result } = renderHook(() => useTickerReturns(42), { wrapper })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(result.current).toEqual({ anchorDate: null, returns: {} })
  })
})
