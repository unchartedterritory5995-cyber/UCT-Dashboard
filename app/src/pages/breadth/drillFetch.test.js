import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchDrill, peekDrill, prefetchDrill, forgetDrill } from './drillFetch'
import { prefetchGroupSectors } from './grouping/useGroupMeta'

vi.mock('./grouping/useGroupMeta', () => ({ prefetchGroupSectors: vi.fn() }))

const ok = (items) => Promise.resolve({ ok: true, json: () => Promise.resolve({ items }) })

describe('drill list cache', () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); prefetchGroupSectors.mockClear() })

  it('a loaded list warms its sectors for the scan window', async () => {
    fetch.mockReturnValueOnce(ok([{ t: 'AAA' }, { t: 'BBB' }]))
    await fetchDrill('/sectors')
    expect(prefetchGroupSectors).toHaveBeenCalledWith(['AAA', 'BBB'])
  })

  it('a hover prefetch is reused by the click (one request)', async () => {
    fetch.mockReturnValueOnce(ok([{ t: 'AAA' }]))
    prefetchDrill('/u1')
    const data = await fetchDrill('/u1')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(data.items[0].t).toBe('AAA')
    expect(peekDrill('/u1').items).toHaveLength(1)
  })

  it('a failure is not cached', async () => {
    fetch.mockReturnValueOnce(Promise.resolve({ ok: false, status: 502 }))
    await expect(fetchDrill('/u2')).rejects.toThrow()
    expect(peekDrill('/u2')).toBeUndefined()
    fetch.mockReturnValueOnce(ok([]))
    await fetchDrill('/u2')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('forget makes the next fetch hit the network', async () => {
    fetch.mockReturnValue(ok([]))
    await fetchDrill('/u3')
    forgetDrill('/u3')
    await fetchDrill('/u3')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('the live list expires', async () => {
    vi.useFakeTimers()
    fetch.mockReturnValue(ok([]))
    await fetchDrill('/live', { live: true })
    vi.advanceTimersByTime(31_000)
    expect(peekDrill('/live')).toBeUndefined()
    vi.useRealTimers()
  })
})
