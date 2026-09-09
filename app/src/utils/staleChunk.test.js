/* A deploy landing under an open tab must not look like a broken page.

   Production, 8 Sep 2026: after a run of deploys, PopoutShell-Cnc5g7lA.js
   returned 404 while the current chunk returned 200. Opening a chart pulls a
   lazy chunk, so /charts crashed to "Something went wrong on this page" on an
   app that was perfectly healthy — a fresh load of the same ticker worked. */
import { describe, it, expect, vi } from 'vitest'
import { isStaleChunkError, recoverFromStaleChunk } from './staleChunk'

const mkStorage = (initial = {}) => {
  const data = { ...initial }
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    _data: data,
  }
}

describe('isStaleChunkError', () => {
  it('recognises every browser wording, not just Chrome', () => {
    for (const msg of [
      'Failed to fetch dynamically imported module: https://x/assets/a.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',                 // Safari
      'Unable to preload CSS for /assets/a.css',           // Vite helper
      "Expected a JavaScript module script but the server responded with a MIME type of 'text/html'",
      'Loading chunk 42 failed',
    ]) {
      expect(isStaleChunkError(new Error(msg)), msg).toBe(true)
    }
  })

  it('recognises ChunkLoadError by name', () => {
    const e = new Error('boom'); e.name = 'ChunkLoadError'
    expect(isStaleChunkError(e)).toBe(true)
  })

  it('does NOT swallow ordinary application errors', () => {
    for (const msg of ["Cannot read properties of undefined (reading 'map')",
                       'x is not a function', 'Network request failed',
                       'Unexpected token <']) {
      expect(isStaleChunkError(new Error(msg)), msg).toBe(false)
    }
    expect(isStaleChunkError(null)).toBe(false)
    expect(isStaleChunkError(undefined)).toBe(false)
  })
})

describe('recoverFromStaleChunk', () => {
  const stale = () => new Error('Failed to fetch dynamically imported module: /assets/a.js')

  it('reloads once on a stale chunk', () => {
    const reload = vi.fn()
    const ok = recoverFromStaleChunk(stale(), { storage: mkStorage(), reload, now: () => 1000 })
    expect(ok).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does NOT reload twice — a refresh loop hides the real error', () => {
    const storage = mkStorage()
    const reload = vi.fn()
    recoverFromStaleChunk(stale(), { storage, reload, now: () => 1000 })
    const second = recoverFromStaleChunk(stale(), { storage, reload, now: () => 2000 })
    expect(second).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('heals again after the cooldown, for a later deploy', () => {
    const storage = mkStorage()
    const reload = vi.fn()
    recoverFromStaleChunk(stale(), { storage, reload, now: () => 1000 })
    recoverFromStaleChunk(stale(), { storage, reload, now: () => 1000 + 61_000 })
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('never reloads for an ordinary error', () => {
    const reload = vi.fn()
    const ok = recoverFromStaleChunk(new Error('x is not a function'),
                                     { storage: mkStorage(), reload })
    expect(ok).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('still reloads when storage is unavailable (private mode)', () => {
    const reload = vi.fn()
    const ok = recoverFromStaleChunk(stale(), {
      storage: { getItem() { throw new Error('denied') },
                 setItem() { throw new Error('denied') } },
      reload,
    })
    expect(ok).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
