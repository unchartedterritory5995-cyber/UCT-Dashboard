/* Prefetching the panel's other tabs. The server is already fast once warm
   (news feed 1-12ms, earnings 0.9ms cached); what a member felt on a tab click
   was the round trip, because each tab only started its request on mount. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  clearNewsPrefetch, newsKey, panelKeys, takeNewsPrefetch, prefetchPanel,
} from './dockPrefetch'
import { feedQuery } from './newsFeedModel'

beforeEach(() => { clearNewsPrefetch() })

describe('panelKeys', () => {
  it('covers every tab that fetches', () => {
    const keys = panelKeys('MU').join(' ')
    for (const p of ['/api/fundamentals-full/MU', '/api/fundamentals/MU',
                     '/api/earnings-intel/MU', '/api/fundamentals-statements/MU',
                     '/api/research/ownership/MU']) {
      expect(keys).toContain(p)
    }
  })

  it('encodes the symbol', () => {
    expect(panelKeys('BRK.B')[0]).toContain('BRK.B')
    expect(panelKeys('A B')[0]).toContain('A%20B')
  })
})

describe('newsKey', () => {
  it('is the EXACT url DockNews builds — a different key is a wasted request', () => {
    expect(newsKey('MU')).toBe(`/api/company-news/MU?${feedQuery({ limit: 25 })}`)
  })
})

describe('takeNewsPrefetch', () => {
  it('hands back the in-flight response for that url', async () => {
    const res = { status: 200 }
    global.fetch = vi.fn(() => Promise.resolve(res))
    prefetchPanel('MU', { fetcher: vi.fn() })
    const got = await takeNewsPrefetch(newsKey('MU'))
    expect(got).toBe(res)
  })

  it('is SINGLE USE, so a stale page is never served twice', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ status: 200 }))
    prefetchPanel('MU', { fetcher: vi.fn() })
    await takeNewsPrefetch(newsKey('MU'))
    expect(takeNewsPrefetch(newsKey('MU'))).toBeUndefined()
  })

  it('returns nothing for a url that was not prefetched', () => {
    expect(takeNewsPrefetch('/api/company-news/NVDA?limit=25')).toBeUndefined()
  })

  it('clearNewsPrefetch drops a previous symbol', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ status: 200 }))
    prefetchPanel('MU', { fetcher: vi.fn() })
    clearNewsPrefetch()
    expect(takeNewsPrefetch(newsKey('MU'))).toBeUndefined()
  })
})

describe('prefetchPanel', () => {
  it('does nothing without a symbol', () => {
    const fetcher = vi.fn()
    global.fetch = vi.fn()
    prefetchPanel('', { fetcher })
    prefetchPanel(null, { fetcher })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('asks for the news page once even if called repeatedly', () => {
    global.fetch = vi.fn(() => Promise.resolve({ status: 200 }))
    prefetchPanel('MU', { fetcher: vi.fn() })
    prefetchPanel('MU', { fetcher: vi.fn() })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('a rejected prefetch never throws into the caller', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('offline')))
    expect(() => prefetchPanel('MU', { fetcher: vi.fn() })).not.toThrow()
    await expect(takeNewsPrefetch(newsKey('MU'))).resolves.toBeNull()
  })
})
