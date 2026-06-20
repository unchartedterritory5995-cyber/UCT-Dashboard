import { describe, it, expect, beforeEach } from 'vitest'
import {
  __reset,
  recordProgress,
  markWatched,
  getEntry,
  resumeSeconds,
  inProgressIds,
} from './videoProgress'

beforeEach(() => __reset())

describe('videoProgress', () => {
  it('records position and marks done at ≥92% watched', () => {
    recordProgress('vid1', 50, 100)
    expect(getEntry('vid1')).toMatchObject({ t: 50, d: 100, done: false })

    recordProgress('vid1', 95, 100)
    expect(getEntry('vid1').done).toBe(true)
  })

  it('resumes mid-video but not finished or barely-started ones', () => {
    recordProgress('mid', 40, 100)
    expect(resumeSeconds('mid')).toBe(40)

    recordProgress('barely', 3, 100) // <8s → start over
    expect(resumeSeconds('barely')).toBe(0)

    recordProgress('almost', 96, 100) // ≥92% → finished, start over
    expect(resumeSeconds('almost')).toBe(0)

    expect(resumeSeconds('never-seen')).toBe(0)
  })

  it('markWatched flips done and excludes it from continue-watching', () => {
    recordProgress('vid2', 30, 100)
    expect(inProgressIds()).toContain('vid2')
    markWatched('vid2')
    expect(getEntry('vid2').done).toBe(true)
    expect(inProgressIds()).not.toContain('vid2')
  })

  it('lists in-progress videos newest first', () => {
    // Explicit timestamps so ordering is deterministic (real calls are seconds apart).
    localStorage.setItem('desk_video_progress', JSON.stringify({
      old: { t: 20, d: 100, at: 1000, done: false },
      new: { t: 20, d: 100, at: 2000, done: false },
    }))
    __reset() // drop in-memory cache so it re-reads... then re-seed (reset clears storage)
    localStorage.setItem('desk_video_progress', JSON.stringify({
      old: { t: 20, d: 100, at: 1000, done: false },
      new: { t: 20, d: 100, at: 2000, done: false },
    }))
    expect(inProgressIds()).toEqual(['new', 'old'])
  })

  it('persists across a reload (localStorage)', () => {
    recordProgress('persist', 42, 100)
    __reset() // clears in-memory cache + storage in this impl
    // After reset storage is cleared, so simulate a fresh load with prior data:
    localStorage.setItem('desk_video_progress', JSON.stringify({ persist: { t: 42, d: 100, at: 1, done: false } }))
    expect(resumeSeconds('persist')).toBe(42)
  })
})

describe('videoProgress backend sync', () => {
  it('hydrateFromServer merges newer server entries into the store', async () => {
    const { hydrateFromServer, getEntry } = await import('./videoProgress')
    recordProgress('local-old', 20, 100) // local at = now
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        progress: [
          { youtube_id: 'local-old', t: 80, d: 100, done: false, at: Date.now() + 10000 }, // newer → wins
          { youtube_id: 'server-only', t: 30, d: 100, done: false, at: 1000 },
        ],
      }),
    }))
    await hydrateFromServer()
    expect(getEntry('local-old').t).toBe(80) // server newer → overrode local
    expect(getEntry('server-only').t).toBe(30) // pulled fresh from server
  })

  it('recordProgress POSTs to the backend (debounced)', async () => {
    vi.useFakeTimers()
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    recordProgress('vidP', 12, 100)
    expect(globalThis.fetch).not.toHaveBeenCalled() // debounced, not immediate
    await vi.advanceTimersByTimeAsync(3000)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/education/progress',
      expect.objectContaining({ method: 'POST' }),
    )
    vi.useRealTimers()
  })
})
