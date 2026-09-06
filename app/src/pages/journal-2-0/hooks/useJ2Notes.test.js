// Task 11: the notebook browse path must survive a migrated library. This
// pins the hook-level contract that the rest of the fix depends on — an
// honest `total` from the server (never `notes.length`) and offset-based
// "Load more" pagination that appends without dropping or duplicating rows.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useJ2Notes, {
  useJ2Favorites, useJ2Recents, setNoteFavorite, recordNoteOpened,
} from './useJ2Notes'

// A fresh Map-backed cache per test -- these hooks use STABLE URLs
// (/api/j2/notes/favorites, /api/j2/notes/recents), so without an isolated
// provider one test's cached response would leak into the next. Plain
// `createElement` (this is a .js file, not .jsx -- no JSX transform here).
function freshCacheWrapper({ children }) {
  return createElement(SWRConfig, { value: { provider: () => new Map() } }, children)
}

function noteRange(start, count) {
  return Array.from({ length: count }, (_, i) => ({ id: `n${start + i}`, title: `Note ${start + i}` }))
}

function mockPagedFetch(total, { pageSize = 100 } = {}) {
  return vi.fn((url) => {
    const u = new URL(url, 'http://localhost')
    const offset = Number(u.searchParams.get('offset') || 0)
    const limit = Number(u.searchParams.get('limit') || pageSize)
    const notes = noteRange(offset, Math.max(0, Math.min(limit, total - offset)))
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ notes, total, limit, offset }),
    })
  })
}

beforeEach(() => {
  global.fetch = mockPagedFetch(121)
})
afterEach(() => vi.restoreAllMocks())

describe('useJ2Notes — total (Task 11)', () => {
  it('reports the true SQL total, not the length of the loaded page', async () => {
    const { result } = renderHook(() => useJ2Notes({ sort: 'updated' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.notes.length).toBe(100)   // one page
    expect(result.current.total).toBe(121)           // the honest total — this is
                                                        // what the old `notes.length`
                                                        // badge could never show
  })

  it('reports `total` as undefined (never a coerced number) when the response predates that field', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ notes: noteRange(0, 3) }), // no `total` key
    }))
    const { result } = renderHook(() => useJ2Notes({ sort: 'updated' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    // Final-review C2: the hook itself no longer guesses a total from page
    // length — `total` stays undefined so a CONSUMER decides its own
    // fallback (FolderSidebar's `?? unfiledCountFromPage`, e.g.). The hook
    // silently synthesizing a number here is exactly what made a real
    // "unknown total" indistinguishable from a real "zero notes" one layer
    // up.
    expect(result.current.total).toBeUndefined()
  })

  it('a request disabled via `enabled:false` never fetches, and `total` is undefined (not 0) — unknown, not zero', () => {
    const { result } = renderHook(() => useJ2Notes({ enabled: false }))
    expect(global.fetch).not.toHaveBeenCalled()
    expect(result.current.notes).toEqual([])
    // Final-review C2: `total` must be undefined here, not `0`. The bug this
    // pins: `data?.total ?? firstPage.length` degrades an unknown total to a
    // DEFINED `0` (since `firstPage` is always `[]` when `data` is
    // undefined) — and `0 ?? x` is `0`, so a consumer's own `?? fallback`
    // could never run. `hasMore` must independently still read `false`.
    expect(result.current.total).toBeUndefined()
    expect(result.current.hasMore).toBe(false)
  })
})

describe('useJ2Notes — "Load more" pagination (Task 11)', () => {
  it('hasMore is true while more of the total remains unloaded', async () => {
    const { result } = renderHook(() => useJ2Notes({ sort: 'updated' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.hasMore).toBe(true)
  })

  it('loadMore fetches the NEXT page (offset = what is already loaded) and appends it', async () => {
    const { result } = renderHook(() => useJ2Notes({ sort: 'updated' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.notes.length).toBe(100)

    await act(async () => { await result.current.loadMore() })

    expect(result.current.notes.length).toBe(121)      // 100 + 21, nothing dropped
    expect(result.current.hasMore).toBe(false)          // fully loaded now

    // The offset requested for the second page must equal how many rows were
    // already on screen (100) — not re-requesting the first page.
    const secondCallUrl = global.fetch.mock.calls[1][0]
    expect(new URL(secondCallUrl, 'http://localhost').searchParams.get('offset')).toBe('100')
  })

  it('appending never duplicates a row that lands on both sides of the page boundary', async () => {
    // A row shifted into the overlap (e.g. its updated_at changed between the
    // two fetches) must be de-duped by id, not rendered twice.
    global.fetch = vi.fn((url) => {
      const u = new URL(url, 'http://localhost')
      const offset = Number(u.searchParams.get('offset') || 0)
      if (offset === 0) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ notes: noteRange(0, 100), total: 121, limit: 100, offset: 0 }),
        })
      }
      // Second page re-includes n99 (boundary drift) plus the genuinely new rows.
      const overlapPlusNew = [{ id: 'n99', title: 'Note 99' }, ...noteRange(100, 21)]
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ notes: overlapPlusNew, total: 121, limit: 100, offset: 100 }),
      })
    })
    const { result } = renderHook(() => useJ2Notes({ sort: 'updated' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => { await result.current.loadMore() })

    const ids = result.current.notes.map((n) => n.id)
    expect(ids.filter((id) => id === 'n99')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(result.current.notes.length).toBe(121)
  })

  it('a folder/tag/sort change resets pagination instead of keeping a stale loaded-more tail', async () => {
    const { result, rerender } = renderHook(
      ({ folderId }) => useJ2Notes({ folderId, sort: 'updated' }),
      { initialProps: { folderId: null } },
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => { await result.current.loadMore() })
    expect(result.current.notes.length).toBe(121)

    // Switch filters — a different folder, only 2 notes.
    global.fetch = mockPagedFetch(2)
    rerender({ folderId: 'f1' })
    await waitFor(() => expect(result.current.notes.length).toBe(2))
    expect(result.current.total).toBe(2)
    expect(result.current.hasMore).toBe(false)
  })

  it('refresh() resets an accumulated "load more" tail back to page one', async () => {
    const { result } = renderHook(() => useJ2Notes({ sort: 'updated' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => { await result.current.loadMore() })
    expect(result.current.notes.length).toBe(121)

    await act(async () => { await result.current.refresh() })
    await waitFor(() => expect(result.current.notes.length).toBe(100))
  })
})

describe('useJ2Notes — Wave 4 (Search Evolution I) params', () => {
  it('includes dateFrom/dateTo/sector/theme in the request URL when set', async () => {
    const { result } = renderHook(() => useJ2Notes({
      q: 'nvda', dateFrom: '2026-03-01', dateTo: '2026-03-31', sector: 'Technology', theme: 'AI Infrastructure',
    }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const url = new URL(global.fetch.mock.calls[0][0], 'http://localhost')
    expect(url.searchParams.get('dateFrom')).toBe('2026-03-01')
    expect(url.searchParams.get('dateTo')).toBe('2026-03-31')
    expect(url.searchParams.get('sector')).toBe('Technology')
    expect(url.searchParams.get('theme')).toBe('AI Infrastructure')
  })

  it('omits dateFrom/dateTo/sector/theme entirely when unset -- byte-identical to pre-Wave-4 requests', async () => {
    const { result } = renderHook(() => useJ2Notes({ sort: 'updated' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const url = new URL(global.fetch.mock.calls[0][0], 'http://localhost')
    expect(url.searchParams.has('dateFrom')).toBe(false)
    expect(url.searchParams.has('dateTo')).toBe(false)
    expect(url.searchParams.has('sector')).toBe(false)
    expect(url.searchParams.has('theme')).toBe(false)
  })

  it('"Load more" (page 2) carries the SAME date/sector/theme filters forward -- a filtered search must not lose its filter mid-pagination', async () => {
    const { result } = renderHook(() => useJ2Notes({
      dateFrom: '2026-03-01', sector: 'Technology', sort: 'updated',
    }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => { await result.current.loadMore() })

    const secondCallUrl = new URL(global.fetch.mock.calls[1][0], 'http://localhost')
    expect(secondCallUrl.searchParams.get('dateFrom')).toBe('2026-03-01')
    expect(secondCallUrl.searchParams.get('sector')).toBe('Technology')
  })
})

describe('useJ2Favorites / useJ2Recents (Wave B)', () => {
  it('useJ2Favorites fetches /api/j2/notes/favorites and returns the notes array', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ notes: [{ id: 'n1', title: 'Fav' }] }),
    }))
    const { result } = renderHook(() => useJ2Favorites(), { wrapper: freshCacheWrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(global.fetch.mock.calls[0][0]).toBe('/api/j2/notes/favorites')
    expect(result.current.notes).toEqual([{ id: 'n1', title: 'Fav' }])
  })

  it('useJ2Favorites returns an empty array (never undefined) before data resolves oddly shaped', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    const { result } = renderHook(() => useJ2Favorites(), { wrapper: freshCacheWrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.notes).toEqual([])
  })

  it('useJ2Recents fetches /api/j2/notes/recents and returns the notes array', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ notes: [{ id: 'n2', title: 'Recent' }] }),
    }))
    const { result } = renderHook(() => useJ2Recents(), { wrapper: freshCacheWrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(global.fetch.mock.calls[0][0]).toBe('/api/j2/notes/recents')
    expect(result.current.notes).toEqual([{ id: 'n2', title: 'Recent' }])
  })
})

describe('setNoteFavorite (Wave B)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('POSTs to favorite when isFavorite=true and returns the server value', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ isFavorite: true }),
    }))
    const result = await setNoteFavorite('n1', true)
    expect(result).toBe(true)
    expect(global.fetch.mock.calls[0][0]).toBe('/api/j2/notes/n1/favorite')
    expect(global.fetch.mock.calls[0][1].method).toBe('POST')
  })

  it('DELETEs to unfavorite when isFavorite=false', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ isFavorite: false }),
    }))
    await setNoteFavorite('n1', false)
    expect(global.fetch.mock.calls[0][1].method).toBe('DELETE')
  })

  it('throws on a failed response so the caller can revert its optimistic state', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 404, json: () => Promise.resolve({ detail: 'note not found' }),
    }))
    await expect(setNoteFavorite('ghost', true)).rejects.toThrow('note not found')
  })
})

describe('recordNoteOpened (Wave B)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('POSTs the opened beacon and never throws even on failure', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network down')))
    expect(() => recordNoteOpened('n1')).not.toThrow()
    expect(global.fetch.mock.calls[0][0]).toBe('/api/j2/notes/n1/opened')
    expect(global.fetch.mock.calls[0][1].method).toBe('POST')
  })
})
