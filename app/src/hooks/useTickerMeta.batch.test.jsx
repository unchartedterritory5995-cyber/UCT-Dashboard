// A list's warm asks for many stocks' details at once: what the server already holds comes back
// in ONE batch request, and only the names it does not hold take the per-symbol route.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import { prefetchTickerMeta, _resetTickerMetaQueue } from './useTickerMeta'

const META = { AAA: { name: 'Aaa Inc', sector: 'Tech', industry: 'Chips', theme: 'AI', exchange: 'NASDAQ' },
  BBB: { name: 'Bbb Inc', sector: 'Energy', industry: 'Oil', theme: null, exchange: 'NYSE' } }
let origFetch
beforeEach(() => {
  origFetch = global.fetch
  localStorage.clear()
  _resetTickerMetaQueue()
  global.fetch = vi.fn(async (url, opts) => {
    if (url === '/api/ticker-meta/batch') {
      const tickers = JSON.parse(opts.body).tickers
      const results = Object.fromEntries(tickers.filter(t => META[t]).map(t => [t, META[t]]))
      return { ok: true, json: async () => ({ results, missing: tickers.filter(t => !META[t]) }) }
    }
    return { ok: true, json: async () => ({ name: 'Cold Co', sector: null, industry: null, theme: null, exchange: 'NYSE' }) }
  })
})
afterEach(() => { global.fetch = origFetch; localStorage.clear(); _resetTickerMetaQueue() })
const calls = () => global.fetch.mock.calls.map(([u, o]) => (o?.method === 'POST' ? `POST ${u} ${o.body}` : `GET ${u}`))

describe('prefetchTickerMeta batching', () => {
  it('a list warm is ONE batch request; only the names the server lacks go one by one', async () => {
    for (const s of ['AAA', 'BBB', 'CCC']) prefetchTickerMeta(s)
    await waitFor(() => expect(localStorage.getItem('tmeta:CCC')).not.toBeNull())
    expect(calls()).toEqual(['POST /api/ticker-meta/batch {"tickers":["AAA","BBB","CCC"]}', 'GET /api/ticker-meta/CCC'])
    expect(JSON.parse(localStorage.getItem('tmeta:AAA')).d).toEqual(META.AAA)
    expect(JSON.parse(localStorage.getItem('tmeta:BBB')).d.exchange).toBe('NYSE')
  })

  it('one symbol on its own (a hover) skips the batch and goes straight to its own request', async () => {
    prefetchTickerMeta('AAA')
    await waitFor(() => expect(localStorage.getItem('tmeta:AAA')).not.toBeNull())
    expect(calls()).toEqual(['GET /api/ticker-meta/AAA'])
  })

  it('a failed batch sends every name down the per-symbol route instead', async () => {
    const real = global.fetch
    global.fetch = vi.fn(async (url, opts) => (url === '/api/ticker-meta/batch' ? { ok: false, status: 502, json: async () => ({}) } : real(url, opts)))
    for (const s of ['AAA', 'BBB']) prefetchTickerMeta(s)
    await waitFor(() => expect(localStorage.getItem('tmeta:BBB')).not.toBeNull())
    expect(global.fetch.mock.calls.map(([u]) => u).sort()).toEqual(['/api/ticker-meta/AAA', '/api/ticker-meta/BBB', '/api/ticker-meta/batch'])
  })
})
