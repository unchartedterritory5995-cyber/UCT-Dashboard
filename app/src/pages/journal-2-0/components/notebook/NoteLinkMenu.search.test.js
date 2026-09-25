import { describe, it, expect, vi, afterEach } from 'vitest'
import { makeNoteSearch } from './NoteLinkMenu'

afterEach(() => { vi.useRealTimers() })

describe('makeNoteSearch — the ONE note search ([[ menu and Ask insert picker)', () => {
  it('a superseded query never fires its own request', async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ notes: [{ id: 'n1', title: 'NVDA' }] }) })
    const search = makeNoteSearch({ debounceMs: 150 })
    const first = search('NV')
    const second = search('NVD')
    await vi.advanceTimersByTimeAsync(200)
    await expect(second).resolves.toEqual([{ id: 'n1', title: 'NVDA' }])
    await first
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch.mock.calls[0][0]).toBe('/api/j2/notes?q=NVD&limit=8')
  })

  it('an empty query returns an empty list without a request', () => {
    global.fetch = vi.fn()
    expect(makeNoteSearch()('   ')).toEqual([])
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
