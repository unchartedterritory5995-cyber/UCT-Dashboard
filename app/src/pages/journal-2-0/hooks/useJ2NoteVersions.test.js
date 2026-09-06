import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { useJ2NoteVersions, useJ2NoteVersion, restoreNoteVersion, isNoteListKey } from './useJ2NoteVersions'

// Fresh Map-backed cache per test -- these hooks use stable per-note URLs,
// so without an isolated provider one test's cached response would leak
// into the next (same reasoning as useJ2Notes.test.js's Wave B block).
function freshCacheWrapper({ children }) {
  return createElement(SWRConfig, { value: { provider: () => new Map() } }, children)
}

afterEach(() => vi.restoreAllMocks())

describe('useJ2NoteVersions', () => {
  it('fetches the versions list for the given note id', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ versions: [{ id: 'v1', title: 'Original' }] }),
    }))
    const { result } = renderHook(() => useJ2NoteVersions('n1'), { wrapper: freshCacheWrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(global.fetch.mock.calls[0][0]).toBe('/api/j2/notes/n1/versions')
    expect(result.current.versions).toEqual([{ id: 'v1', title: 'Original' }])
  })

  it('never fetches when noteId is missing', () => {
    global.fetch = vi.fn()
    renderHook(() => useJ2NoteVersions(null), { wrapper: freshCacheWrapper })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('never fetches when enabled is false', () => {
    global.fetch = vi.fn()
    renderHook(() => useJ2NoteVersions('n1', { enabled: false }), { wrapper: freshCacheWrapper })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns an empty array (never undefined) before data resolves', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    const { result } = renderHook(() => useJ2NoteVersions('n1'), { wrapper: freshCacheWrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.versions).toEqual([])
  })
})

describe('useJ2NoteVersion', () => {
  it('fetches one version by id', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ version: { id: 'v1', title: 'Original', bodyPlain: 'hello' } }),
    }))
    const { result } = renderHook(() => useJ2NoteVersion('n1', 'v1'), { wrapper: freshCacheWrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(global.fetch.mock.calls[0][0]).toBe('/api/j2/notes/n1/versions/v1')
    expect(result.current.version.title).toBe('Original')
  })

  it('never fetches when versionId is missing (no version selected yet)', () => {
    global.fetch = vi.fn()
    renderHook(() => useJ2NoteVersion('n1', null), { wrapper: freshCacheWrapper })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('restoreNoteVersion', () => {
  it('POSTs to the restore endpoint and returns the restored note', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ note: { id: 'n1', title: 'Original' } }),
    }))
    const note = await restoreNoteVersion('n1', 'v1', '2026-01-01T00:00:00Z')
    expect(note.title).toBe('Original')
    expect(global.fetch.mock.calls[0][0]).toBe('/api/j2/notes/n1/versions/v1/restore')
    const opts = global.fetch.mock.calls[0][1]
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ baseUpdatedAt: '2026-01-01T00:00:00Z' })
  })

  it('omits baseUpdatedAt from the body when not provided', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ note: {} }),
    }))
    await restoreNoteVersion('n1', 'v1')
    const opts = global.fetch.mock.calls[0][1]
    expect(JSON.parse(opts.body)).toEqual({})
  })

  it('throws with .status set on a 409 conflict', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 409, json: () => Promise.resolve({ detail: 'note changed — refresh and retry' }),
    }))
    await expect(restoreNoteVersion('n1', 'v1')).rejects.toMatchObject({
      status: 409, message: 'note changed — refresh and retry',
    })
  })

  it('throws on a 404 (nonexistent version)', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 404, json: () => Promise.resolve({ detail: 'Not found' }),
    }))
    await expect(restoreNoteVersion('n1', 'ghost')).rejects.toMatchObject({ status: 404 })
  })

  it('the exported list-key predicate matches every filtered Notebook list variant but not a single-note/sub-resource key', () => {
    // Real code path, not a duplicated regex -- found live via browser E2E:
    // a restored note's title/subtitle stayed stale in the sidebar list
    // until this predicate started reaching every cached list variant.
    expect(isNoteListKey('/api/j2/notes')).toBe(true)
    expect(isNoteListKey('/api/j2/notes?folder_id=f1&sort=updated')).toBe(true)
    expect(isNoteListKey('/api/j2/notes/n1')).toBe(false)
    expect(isNoteListKey('/api/j2/notes/n1/versions')).toBe(false)
    expect(isNoteListKey('/api/j2/notes/n1/versions/v1')).toBe(false)
    expect(isNoteListKey(null)).toBe(false)
  })
})
