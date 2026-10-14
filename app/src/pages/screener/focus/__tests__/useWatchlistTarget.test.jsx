import { renderHook, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { vi } from 'vitest'
import useWatchlistTarget from '../useWatchlistTarget'

const wrapper = ({ children }) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
// REAL shape of GET /api/watchlists (api/routers/watchlists.py::list_watchlists):
// a bare array of watchlist rows (SELECT *), string ids, is_flagged_list rows
// already excluded server-side, is_prebuilt rows present unless include_prebuilt=0.
const LISTS = [
  { id: 'wl-7', name: 'Semis', is_flagged_list: 0, is_prebuilt: 0, item_count: 4 },
  { id: 'wl-9', name: 'IPOs', is_flagged_list: 0, is_prebuilt: 0, item_count: 2 },
]

beforeEach(() => { localStorage.clear(); global.fetch = vi.fn() })

test('defaults to the first list and adds to it', async () => {
  fetch.mockResolvedValueOnce({ ok: true, json: async () => LISTS })
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  await waitFor(() => expect(result.current.target?.id).toBe('wl-7'))
  let out
  await act(async () => { out = await result.current.add('MU') })
  expect(fetch).toHaveBeenLastCalledWith('/api/watchlists/wl-7/items', expect.objectContaining({ method: 'POST' }))
  expect(out).toEqual({ ok: true, message: 'Added MU to Semis' })
})
test('remembers the chosen list', async () => {
  localStorage.setItem('uct.screener.watchlistTarget', 'wl-9')
  fetch.mockResolvedValueOnce({ ok: true, json: async () => LISTS })
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  await waitFor(() => expect(result.current.target?.id).toBe('wl-9'))
})
test('curated lists are never offered as a target', async () => {
  fetch.mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'p1', name: 'S&P 500', is_prebuilt: 1 }, ...LISTS] })
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  await waitFor(() => expect(result.current.target?.id).toBe('wl-7'))
  expect(result.current.lists.map(l => l.id)).toEqual(['wl-7', 'wl-9'])
})
test('no lists gives a plain message', async () => {
  fetch.mockResolvedValueOnce({ ok: true, json: async () => [] })
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  let out
  await act(async () => { out = await result.current.add('MU') })
  expect(out).toEqual({ ok: false, message: 'Create a watchlist first, then press W again.' })
})
test('a refused add says so', async () => {
  fetch.mockResolvedValueOnce({ ok: true, json: async () => LISTS })
    .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ detail: 'already there' }) })
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  await waitFor(() => expect(result.current.target).not.toBeNull())
  let out
  await act(async () => { out = await result.current.add('MU') })
  expect(out.ok).toBe(false)
  expect(out.message).toMatch(/MU was not added/)
})
