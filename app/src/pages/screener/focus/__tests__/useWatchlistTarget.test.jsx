import { renderHook, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { vi, beforeEach, expect, test } from 'vitest'
import useWatchlistTarget, { LISTS_URL, PICKS_NAME } from '../useWatchlistTarget'

const wrapper = ({ children }) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
// REAL shape of GET /api/watchlists (api/routers/watchlists.py::list_watchlists):
// a bare array of watchlist rows (SELECT *), string ids, is_flagged_list rows
// already excluded server-side, is_prebuilt rows present unless include_prebuilt=0.
const LISTS = [
  { id: 'wl-7', name: 'Semis', is_flagged_list: 0, is_prebuilt: 0, item_count: 4 },
  { id: 'wl-9', name: 'IPOs', is_flagged_list: 0, is_prebuilt: 0, item_count: 2 },
]

beforeEach(() => { localStorage.clear(); globalThis.fetch = vi.fn() })

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
// A fake server for the zero-lists path: GET answers `lists`, POST /api/watchlists creates,
// POST .../items adds. Every call is recorded.
function server({ lists = [], freshOk = true, createOk = true, itemOk = true } = {}) {
  const calls = []
  let have = [...lists]
  fetch.mockImplementation(async (url, opts = {}) => {
    calls.push([url, opts.method || 'GET', opts.cache])
    if (url === LISTS_URL && (opts.method || 'GET') === 'GET') {
      if (opts.cache === 'no-store' && !freshOk) return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, json: async () => have }
    }
    if (url === '/api/watchlists' && opts.method === 'POST') {
      if (!createOk) return { ok: false, status: 500, json: async () => ({}) }
      const row = { id: 'wl-new', name: JSON.parse(opts.body).name, is_flagged_list: 0, is_prebuilt: 0 }
      have = [...have, row]
      return { ok: true, json: async () => row }
    }
    if (/\/items$/.test(url)) return { ok: itemOk, status: itemOk ? 200 : 500, json: async () => ({}) }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  return { calls, creates: () => calls.filter(([u, m]) => u === '/api/watchlists' && m === 'POST'), items: () => calls.filter(([u]) => /\/items$/.test(u)) }
}

test('B15: with no watchlist, W creates "Screener picks", adds the stock, says so, and re-reads the lists', async () => {
  const srv = server()
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  await waitFor(() => expect(srv.calls.length).toBeGreaterThan(0))
  let out
  await waitFor(async () => {
    await act(async () => { out = await result.current.add('MU') })
    expect(out.ok).toBe(true)
  })
  expect(out.created).toBe(true)
  expect(out.message).toBe(`Created a watchlist "${PICKS_NAME}" and added MU to it`)
  expect(srv.creates()).toHaveLength(1)
  expect(JSON.parse(fetch.mock.calls.find(([u, o]) => u === '/api/watchlists' && o?.method === 'POST')[1].body))
    .toEqual({ name: 'Screener picks', description: '', is_public: false })
  expect(srv.items().map(([u]) => u)).toEqual(['/api/watchlists/wl-new/items'])
  // the SWR key is revalidated: the new list becomes the target without a reload
  await waitFor(() => expect(result.current.target?.id).toBe('wl-new'))
  expect(localStorage.getItem('uct.screener.watchlistTarget')).toBe('wl-new')
})

test('B15: never creates when the member already has a list (the cache was just stale)', async () => {
  const srv = server({ lists: [] })
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  await waitFor(() => expect(srv.calls.length).toBeGreaterThan(0))
  await waitFor(() => expect(result.current.lists).toEqual([]))
  // a list appears on the server after the cached read (another tab, the shell's stale [])
  fetch.mockImplementation(async url => {
    if (url === LISTS_URL) return { ok: true, json: async () => LISTS }
    if (/\/items$/.test(url)) return { ok: true, json: async () => ({}) }
    return { ok: true, json: async () => ({ id: 'SHOULD-NOT', name: 'x' }) }
  })
  let out
  await act(async () => { out = await result.current.add('MU') })
  expect(out).toEqual({ ok: true, message: 'Added MU to Semis' })
  expect(fetch.mock.calls.some(([u, o]) => u === '/api/watchlists' && o?.method === 'POST')).toBe(false)
})

test('B15: a failed confirming read creates nothing (an empty cache may be a swallowed error)', async () => {
  const srv = server({ freshOk: false })
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  await waitFor(() => expect(srv.calls.length).toBeGreaterThan(0))
  let out
  await waitFor(async () => {
    await act(async () => { out = await result.current.add('MU') })
    expect(out.message).not.toMatch(/still loading/)
  })
  expect(out.message).toBe("Your watchlists couldn't be checked, so MU was not added.")
  expect(srv.creates()).toHaveLength(0)
  expect(srv.items()).toHaveLength(0)
})

test('B15: a member whose only lists are linked gets a message, never a new list', async () => {
  const srv = server({ lists: [{ id: 'wl-l', name: 'Linked', origin: { mode: 'link' } }] })
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  await waitFor(() => expect(srv.calls.length).toBeGreaterThan(0))
  let out
  await waitFor(async () => {
    await act(async () => { out = await result.current.add('MU') })
    expect(out.message).not.toMatch(/still loading/)
  })
  expect(out.message).toMatch(/linked/)
  expect(srv.creates()).toHaveLength(0)
})

test('B15: two quick presses create ONE list', async () => {
  const srv = server()
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  await waitFor(() => expect(result.current.lists).toEqual([]))
  await waitFor(() => expect(srv.calls.length).toBeGreaterThan(0))
  let outs
  await act(async () => { outs = await Promise.all([result.current.add('MU'), result.current.add('ECO')]) })
  expect(srv.creates()).toHaveLength(1)
  expect(outs.map(o => o.ok)).toEqual([true, true])
  expect(outs.filter(o => o.created)).toHaveLength(1)
})

test('B15: a refused create says so and adds nothing', async () => {
  const srv = server({ createOk: false })
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  let out
  await waitFor(async () => {
    await act(async () => { out = await result.current.add('MU') })
    expect(out.message).not.toMatch(/still loading/)
  })
  expect(out.message).toBe('"Screener picks" could not be created, so MU was not added.')
  expect(srv.items()).toHaveLength(0)
})
test('a refused add says so', async () => {
  fetch.mockResolvedValueOnce({ ok: true, json: async () => LISTS })
    .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ detail: 'Watchlist not found' }) })
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  await waitFor(() => expect(result.current.target).not.toBeNull())
  let out
  await act(async () => { out = await result.current.add('MU') })
  expect(out.ok).toBe(false)
  expect(out.message).toBe('MU was not added to Semis.')
})

test('a stored id that no longer exists falls back to the first list', async () => {
  localStorage.setItem('uct.screener.watchlistTarget', 'wl-gone')
  fetch.mockResolvedValueOnce({ ok: true, json: async () => LISTS })
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  await waitFor(() => expect(result.current.target?.id).toBe('wl-7'))
})
test('linked lists are not offered as a target', async () => {
  fetch.mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'wl-l', name: 'Linked', origin: { mode: 'link' } }, ...LISTS] })
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  await waitFor(() => expect(result.current.target?.id).toBe('wl-7'))
})
test('adding while the lists are still loading says so', async () => {
  fetch.mockReturnValueOnce(new Promise(() => {}))
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  let out
  await act(async () => { out = await result.current.add('MU') })
  expect(out).toEqual({ ok: false, message: 'Your watchlists are still loading. Try again in a moment.' })
})
test('a failed load is not reported as having no lists', async () => {
  fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  let out
  await waitFor(async () => {
    await act(async () => { out = await result.current.add('MU') })
    expect(out.message).toBe("Your watchlists couldn't be loaded, so nothing was added.")
  })
})
