import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useTickerMeta from './useTickerMeta'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

describe('useTickerMeta', () => {
  let origFetch
  beforeEach(() => { origFetch = global.fetch })
  afterEach(() => { global.fetch = origFetch; vi.restoreAllMocks() })

  it('returns null-safe defaults before/without data', () => {
    global.fetch = vi.fn(() => new Promise(() => {}))
    const { result } = renderHook(() => useTickerMeta('TSLA'), { wrapper })
    expect(result.current).toEqual({ name: null, sector: null, industry: null })
  })

  it('returns fetched meta', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'Tesla Inc', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers' }),
    })
    const { result } = renderHook(() => useTickerMeta('TSLA'), { wrapper })
    await waitFor(() => expect(result.current.name).toBe('Tesla Inc'))
    expect(global.fetch).toHaveBeenCalledWith('/api/ticker-meta/TSLA', expect.objectContaining({ credentials: 'include' }))
  })

  it('null-safe when fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false })
    const { result } = renderHook(() => useTickerMeta('TSLA'), { wrapper })
    await waitFor(() => expect(result.current).toEqual({ name: null, sector: null, industry: null }))
  })

  it('null-safe when JSON parsing throws', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('bad json') } })
    const { result } = renderHook(() => useTickerMeta('TSLA'), { wrapper })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(result.current).toEqual({ name: null, sector: null, industry: null })
  })

  it('does not fetch when sym is falsy', () => {
    global.fetch = vi.fn()
    renderHook(() => useTickerMeta(null), { wrapper })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
