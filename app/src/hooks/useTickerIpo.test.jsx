import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useTickerIpo, { fetcher, prefetchTickerIpo } from './useTickerIpo'

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
