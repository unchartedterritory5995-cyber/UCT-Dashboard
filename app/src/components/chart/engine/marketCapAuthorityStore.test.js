import { describe, expect, it } from 'vitest'
import { createMarketCapAuthorityStore } from './marketCapAuthorityStore'
import { fundamentalColumnWithAuthority } from './marketCapAuthority'

const flush = () => new Promise((r) => setTimeout(r, 0))

function server({ status = 200, build = 'MCAP_V1-20261005T234206Z', series = {} } = {}) {
  const calls = []
  const s = {
    status, build, series, calls,
    fetchImpl: async (url) => {
      calls.push(url)
      const h = (o) => ({ get: (k) => o[k] ?? null })
      if (url === '/api/marketcap/pit-status') return { status: s.status, headers: h({}), json: async () => ({}) }
      const t = decodeURIComponent(url.split('/').pop())
      if (!(t in s.series)) return { status: 404, headers: h({ 'X-MCAP-Build': s.build }), json: async () => ({}) }
      return { status: 200, headers: h({ 'X-MCAP-Build': s.build, ETag: `"${s.build}:${t}"` }),
        json: async () => ({ build_id: s.build, points: s.series[t] }) }
    },
  }
  return s
}

const NVDA = [['2024-06-07', 2.96e12]]
const MCAP = { kind: 'fundamental', metric: 'market_cap' }
const bars = [{ time: '2024-06-07' }]
const legacy = { fundamentals: new Map(), closeOf: () => [1] }

describe('marketCapAuthorityStore', () => {
  it('flag OFF (404): null -> the legacy path, and the status is asked once per page load', async () => {
    const srv = server({ status: 404 })
    const st = createMarketCapAuthorityStore({ fetchImpl: srv.fetchImpl })
    expect(st.ensureMarketCap(['NVDA'])).toBe(st.ensureMarketCap(['NVDA']))   // PENDING while probing
    await flush()
    expect(st.ensureMarketCap(['NVDA'])).toBeNull()
    expect(st.ensureMarketCap(['AAPL'])).toBeNull()
    expect(srv.calls).toEqual(['/api/marketcap/pit-status'])
  })

  it('while probing, Market Cap is NOT COMPUTABLE -- never a flash of close x shares', () => {
    const st = createMarketCapAuthorityStore({ fetchImpl: server().fetchImpl })
    const auth = st.ensureMarketCap(['NVDA'])
    expect(auth).not.toBeNull()
    expect(fundamentalColumnWithAuthority(MCAP, { bars, tf: 'D', sym: 'NVDA', marketCapAuthority: auth, ...legacy })).toBeNull()
  })

  it('ON: series come from the authority; an unknown ticker stays not computable', async () => {
    const st = createMarketCapAuthorityStore({ fetchImpl: server({ series: { NVDA } }).fetchImpl })
    st.ensureMarketCap(['NVDA', 'ZZZZ'])
    await flush()
    const auth = st.ensureMarketCap(['NVDA', 'ZZZZ'])
    await flush(); await flush()
    expect(auth.get('NVDA')).toEqual(NVDA)
    expect(fundamentalColumnWithAuthority(MCAP, { bars, tf: 'D', sym: 'NVDA', marketCapAuthority: auth, ...legacy })).toEqual([2.96e12])
    expect(fundamentalColumnWithAuthority(MCAP, { bars, tf: 'D', sym: 'ZZZZ', marketCapAuthority: auth, ...legacy })).toBeNull()
    expect(fundamentalColumnWithAuthority(MCAP, { bars: [{ time: 1717767000 }], tf: '5', sym: 'NVDA', marketCapAuthority: auth, ...legacy })).toBeNull()
  })

  it('ON but unavailable (503): not computable and retried later, never the legacy methodology', async () => {
    let t = 0
    const srv = server({ status: 503, series: { NVDA } })
    const st = createMarketCapAuthorityStore({ fetchImpl: srv.fetchImpl, now: () => t })
    st.ensureMarketCap(['NVDA'])
    await flush()
    expect(st.ensureMarketCap(['NVDA'])).not.toBeNull()
    expect(srv.calls.length).toBe(1)
    srv.status = 200
    t = 6 * 60_000
    st.ensureMarketCap(['NVDA'])
    await flush()
    st.ensureMarketCap(['NVDA'])
    await flush(); await flush()
    expect(st.ensureMarketCap(['NVDA']).get('NVDA')).toEqual(NVDA)
  })

  it('a new build (advance / rollback) drops every series of the old build', async () => {
    let t = 0
    const srv = server({ series: { NVDA, AAPL: [['2024-06-07', 3e12]] } })
    const st = createMarketCapAuthorityStore({ fetchImpl: srv.fetchImpl, now: () => t, revalidateMs: 10 })
    st.ensureMarketCap(['NVDA', 'AAPL']); await flush()
    st.ensureMarketCap(['NVDA', 'AAPL']); await flush(); await flush()
    expect(st.build()).toBe('MCAP_V1-20261005T234206Z')
    srv.build = 'MCAP_V1-20261006T060000Z'
    srv.series.NVDA = [['2024-06-07', 2.97e12]]
    t = 1000
    const m = st.ensureMarketCap(['NVDA', 'AAPL'])
    m.delete('NVDA')                                    // force a reload of one symbol (what a revalidation does)
    st.ensureMarketCap(['NVDA']); await flush(); await flush()
    expect(st.build()).toBe('MCAP_V1-20261006T060000Z')
    expect(st.ensureMarketCap(['NVDA']).has('AAPL')).toBe(false)   // AAPL of the old build is gone
    expect(st.ensureMarketCap(['NVDA']).get('NVDA')).toEqual([['2024-06-07', 2.97e12]])
  })

  it('no authority map (OFF) keeps every metric on the unchanged legacy path', () => {
    const ctx = { bars, tf: 'D', sym: 'NVDA', fundamentals: new Map(), marketCapAuthority: null }
    expect(fundamentalColumnWithAuthority(MCAP, ctx)).toBeNull()       // legacy: no fundamentals loaded here
  })
})
