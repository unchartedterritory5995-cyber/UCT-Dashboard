// Task 11: the notebook browse path must survive a migrated library. This
// pins the hook-level contract that the rest of the fix depends on — an
// honest `total` from the server (never `notes.length`) and offset-based
// "Load more" pagination that appends without dropping or duplicating rows.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useJ2Notes from './useJ2Notes'

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

  it('falls back to the page length only when the response predates `total`', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ notes: noteRange(0, 3) }), // no `total` key
    }))
    const { result } = renderHook(() => useJ2Notes({ sort: 'updated' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.total).toBe(3)
  })

  it('a request disabled via `enabled:false` never fetches and reports an empty, non-crashing shape', () => {
    const { result } = renderHook(() => useJ2Notes({ enabled: false }))
    expect(global.fetch).not.toHaveBeenCalled()
    expect(result.current.notes).toEqual([])
    expect(result.current.total).toBe(0)
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
