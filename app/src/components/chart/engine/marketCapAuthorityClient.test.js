import { describe, expect, it } from 'vitest'
import { createMarketCapAuthorityCache } from './marketCapAuthorityClient'

function server() {
  const s = { build: 'MCAP_V1-A', calls: 0, status: 200 }
  s.fetchImpl = async (url, { headers }) => {
    s.calls++
    const etag = `"${s.build}"`
    const hdr = { 'X-MCAP-Build': s.build, ETag: etag }
    const res = (status, body) => ({ status, headers: { get: (k) => hdr[k] ?? null }, json: async () => body })
    if (s.status !== 200) return res(s.status, { detail: 'x' })
    if (headers['If-None-Match'] === etag) return res(304, null)
    return res(200, { build_id: s.build, ticker: url.split('/').pop(), points: [['2026-10-01', s.build === 'MCAP_V1-A' ? 1 : 2]] })
  }
  return s
}

describe('market cap authority client cache', () => {
  it('reuses within the window, revalidates after it (304 keeps the entry)', async () => {
    const s = server()
    let t = 0
    const c = createMarketCapAuthorityCache({ fetchImpl: s.fetchImpl, now: () => t, revalidateMs: 100 })
    const a = await c.series('googl')
    expect(a.build_id).toBe('MCAP_V1-A')
    await c.series('GOOGL')
    expect(s.calls).toBe(1)
    t = 200
    expect((await c.series('GOOGL')).build_id).toBe('MCAP_V1-A')
    expect(s.calls).toBe(2)
  })

  it('a pointer advance A -> B is never answered from A', async () => {
    const s = server()
    let t = 0
    const c = createMarketCapAuthorityCache({ fetchImpl: s.fetchImpl, now: () => t, revalidateMs: 100 })
    await c.series('GOOGL')
    await c.series('AAPL')
    s.build = 'MCAP_V1-B'
    t = 200
    const b = await c.series('GOOGL')
    expect(b.build_id).toBe('MCAP_V1-B')
    expect(b.points[0][1]).toBe(2)
    expect(c.build()).toBe('MCAP_V1-B')
    expect(c.size()).toBe(1)                       // AAPL's A entry was evicted with build A
  })

  it('errors are never cached', async () => {
    const s = server()
    s.status = 503
    const c = createMarketCapAuthorityCache({ fetchImpl: s.fetchImpl })
    await expect(c.series('GOOGL')).rejects.toThrow('503')
    expect(c.size()).toBe(0)
    s.status = 200
    expect((await c.series('GOOGL')).build_id).toBe('MCAP_V1-A')
  })
})
