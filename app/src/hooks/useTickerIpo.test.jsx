import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useTickerIpo, { fetcher, prefetchTickerIpo, NON_FINAL_POLL_MS } from './useTickerIpo'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

describe('useTickerIpo', () => {
  let origFetch
  beforeEach(() => { origFetch = global.fetch; localStorage.clear() })
  afterEach(() => { global.fetch = origFetch; vi.restoreAllMocks(); localStorage.clear() })

  it('returns null-safe default before/without data', () => {
    global.fetch = vi.fn(() => new Promise(() => {}))
    const { result } = renderHook(() => useTickerIpo('ABNB'), { wrapper })
    expect(result.current).toEqual({ list_date: null })
  })

  it('returns the fetched listing date', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ list_date: '2020-12-10' }) })
    const { result } = renderHook(() => useTickerIpo('ABNB'), { wrapper })
    await waitFor(() => expect(result.current.list_date).toBe('2020-12-10'))
    expect(global.fetch).toHaveBeenCalledWith('/api/ticker-ipo/ABNB', expect.objectContaining({ credentials: 'include' }))
  })

  it('carries first_trade_date through when the server sends it (the listing reference)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ list_date: '1993-01-22', first_trade_date: '1993-01-29' }) })
    const { result } = renderHook(() => useTickerIpo('SPY'), { wrapper })
    await waitFor(() => expect(result.current.first_trade_date).toBe('1993-01-29'))
    expect(result.current.list_date).toBe('1993-01-22')
  })

  it('null-safe when fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false })
    const { result } = renderHook(() => useTickerIpo('ABNB'), { wrapper })
    await waitFor(() => expect(result.current).toEqual({ list_date: null }))
  })

  it('does not fetch when sym is falsy', () => {
    global.fetch = vi.fn()
    renderHook(() => useTickerIpo(null), { wrapper })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('persists a real listing date to localStorage', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ list_date: '2020-12-10' }) })
    const { result } = renderHook(() => useTickerIpo('ABNB'), { wrapper })
    await waitFor(() => expect(result.current.list_date).toBe('2020-12-10'))
    expect(JSON.parse(localStorage.getItem('tipo:ABNB')).d).toEqual({ list_date: '2020-12-10' })
  })

  it('does NOT persist a null miss (a cold ticker must re-resolve later)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ list_date: null }) })
    const { result } = renderHook(() => useTickerIpo('OLD'), { wrapper })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(result.current).toEqual({ list_date: null })
    expect(localStorage.getItem('tipo:OLD')).toBeNull()
  })

  it('does NOT persist a non-final first-trade answer (the server is still resolving it)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ list_date: '1993-01-22', first_trade_date: '1993-01-22', first_trade_final: false }) })
    const { result } = renderHook(() => useTickerIpo('SPY'), { wrapper })
    await waitFor(() => expect(result.current.first_trade_final).toBe(false))
    expect(localStorage.getItem('tipo:SPY')).toBeNull()
  })

  it('persists a FINAL first-trade answer', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ list_date: '1993-01-22', first_trade_date: '1993-01-29', first_trade_final: true }) })
    const { result } = renderHook(() => useTickerIpo('SPY'), { wrapper })
    await waitFor(() => expect(result.current.first_trade_final).toBe(true))
    expect(JSON.parse(localStorage.getItem('tipo:SPY')).d).toEqual({ list_date: '1993-01-22', first_trade_date: '1993-01-29', first_trade_final: true })
  })

  it('asks again while non-final and stops once final', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const answers = [
        { list_date: '1993-01-22', first_trade_date: '1993-01-22', first_trade_final: false },
        { list_date: '1993-01-22', first_trade_date: '1993-01-29', first_trade_final: true },
      ]
      global.fetch = vi.fn().mockImplementation(async () => ({ ok: true, json: async () => answers[Math.min(global.fetch.mock.calls.length - 1, 1)] }))
      const { result } = renderHook(() => useTickerIpo('SPY'), { wrapper })
      await waitFor(() => expect(result.current.first_trade_final).toBe(false))
      await vi.advanceTimersByTimeAsync(NON_FINAL_POLL_MS + 50)
      await waitFor(() => expect(result.current.first_trade_date).toBe('1993-01-29'))
      const calls = global.fetch.mock.calls.length
      await vi.advanceTimersByTimeAsync(NON_FINAL_POLL_MS * 3)
      expect(global.fetch.mock.calls.length).toBe(calls)
    } finally {
      vi.useRealTimers()
    }
  })

  it('paints synchronously from a warm localStorage entry', () => {
    localStorage.setItem('tipo:ABNB', JSON.stringify({ t: Date.now(), d: { list_date: '2020-12-10' } }))
    global.fetch = vi.fn(() => new Promise(() => {}))
    const { result } = renderHook(() => useTickerIpo('ABNB'), { wrapper })
    expect(result.current).toEqual({ list_date: '2020-12-10' })
  })

  describe('fetcher', () => {
    it('throws on a non-ok response (so SWR retries, never caches null)', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 })
      await expect(fetcher('/api/ticker-ipo/ABNB')).rejects.toThrow(/ticker-ipo 503/)
    })
    it('maps list_date on success', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ list_date: '2019-03-14', symbol: 'X' }) })
      await expect(fetcher('/api/ticker-ipo/X')).resolves.toEqual({ list_date: '2019-03-14' })
    })
  })

  describe('prefetchTickerIpo', () => {
    it('fetches + writes localStorage when cold', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ list_date: '2012-05-18' }) })
      prefetchTickerIpo('META')
      await waitFor(() => expect(localStorage.getItem('tipo:META')).not.toBeNull())
      expect(JSON.parse(localStorage.getItem('tipo:META')).d.list_date).toBe('2012-05-18')
    })
    it('skips the network when already warm', () => {
      localStorage.setItem('tipo:META', JSON.stringify({ t: Date.now(), d: { list_date: '2012-05-18' } }))
      global.fetch = vi.fn()
      prefetchTickerIpo('META')
      expect(global.fetch).not.toHaveBeenCalled()
    })
  })
})
