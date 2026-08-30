// Prehydration is only safe when the precomputed answer describes EXACTLY the
// load the page is about to render. A wrong "yes" here is worse than never
// prehydrating: the reader gets numbers, believes them, and they change a
// second later when the real computation lands. So most of these tests are
// about the cases it must DECLINE.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { prehydrateUrl, fetchPrehydrate } from './flowPrehydrate.js'

const q = (url) => Object.fromEntries(new URL(url, 'http://x').searchParams)

describe('prehydrateUrl — what it will answer for', () => {
  it('maps the stocks feed to the stocks source, carrying days + selection', () => {
    expect(q(prehydrateUrl('/api/flow/data?days=1', 'Last1', 42)))
      .toEqual({ source: 'stocks', days: '1', date_filter: 'Last1', v: '42' })
  })

  it('maps the indexes feed to the indexes source', () => {
    expect(q(prehydrateUrl('/api/flow/indexes-data?days=5', 'Last5', 7)).source)
      .toBe('indexes')
  })

  it('omits the selection when the page has none, meaning the whole window', () => {
    expect(q(prehydrateUrl('/api/flow/data?days=1', null, 1)))
      .not.toHaveProperty('date_filter')
  })
})

describe('prehydrateUrl — what it must DECLINE', () => {
  it('declines the Mid-Small stream, which is a different dataset entirely', () => {
    // /api/flow/small-data carries UNCAPPED small-cap rows the bulk feed drops.
    // The endpoint has no source for it, so asking would answer a different
    // question than the page is rendering.
    expect(prehydrateUrl('/api/flow/small-data?days=1', 'Last1', 1)).toBeNull()
  })

  it('declines an explicit custom date range, which date_filter cannot express', () => {
    expect(prehydrateUrl('/api/flow/data?date_from=2026-07-01&date_to=2026-07-05', 'All', 1))
      .toBeNull()
  })

  it('declines all_data, which has no days to key the cache on', () => {
    expect(prehydrateUrl('/api/flow/data?all_data=true', 'All', 1)).toBeNull()
  })

  it('declines a selection the SERVER would reject, rather than asking anyway', () => {
    // The server falls back to the whole window on an unrecognised filter —
    // which is precisely NOT what the page would render. Mirrors
    // api/services/flow_aggregate.valid_date_filter.
    for (const bad of ['last1', 'Last999', 'Custom', '; rm -rf /', 'Last1 x']) {
      expect(prehydrateUrl('/api/flow/data?days=1', bad, 1)).toBeNull()
    }
    // ...and the control: the shapes it DOES accept, so this is not just
    // rejecting everything.
    for (const ok of ['All', 'Last1', 'Last20']) {
      expect(prehydrateUrl('/api/flow/data?days=1', ok, 1)).not.toBeNull()
    }
  })

  it('declines an unknown base, so a new feed cannot be silently mis-sourced', () => {
    expect(prehydrateUrl('/api/flow/something-new?days=1', 'Last1', 1)).toBeNull()
    expect(prehydrateUrl('', 'Last1', 1)).toBeNull()
    expect(prehydrateUrl(null, 'Last1', 1)).toBeNull()
  })

  it('declines days=0 and non-numeric days', () => {
    expect(prehydrateUrl('/api/flow/data?days=0', 'All', 1)).toBeNull()
    expect(prehydrateUrl('/api/flow/data?days=abc', 'All', 1)).toBeNull()
    expect(prehydrateUrl('/api/flow/data', 'All', 1)).toBeNull()
  })
})

describe('fetchPrehydrate — every failure is silence, never a broken page', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  const stub = (impl) => vi.stubGlobal('fetch', vi.fn(impl))

  it('returns the dataset on success', async () => {
    stub(async () => ({
      ok: true,
      headers: { get: () => '99' },
      json: async () => ({ ok: true, stats: { rawRows: 5 }, D: { totalTrades: 3 } }),
    }))
    const got = await fetchPrehydrate('/api/flow/data?days=1', 'Last1', 99)
    expect(got.D.totalTrades).toBe(3)
    expect(got.version).toBe('99')
  })

  it('treats 503 — the endpoint saying "not built yet" — as simply no answer', async () => {
    stub(async () => ({ ok: false, status: 503 }))
    await expect(fetchPrehydrate('/api/flow/data?days=1', 'Last1', 1)).resolves.toBeNull()
  })

  it('never rejects when the network throws', async () => {
    stub(async () => { throw new Error('offline') })
    await expect(fetchPrehydrate('/api/flow/data?days=1', 'Last1', 1)).resolves.toBeNull()
  })

  it('refuses a body that is not a real dataset', async () => {
    for (const body of [null, {}, { ok: false, D: {} }, { ok: true }]) {
      stub(async () => ({ ok: true, headers: { get: () => null }, json: async () => body }))
      await expect(fetchPrehydrate('/api/flow/data?days=1', 'Last1', 1)).resolves.toBeNull()
    }
  })

  it('does not even call fetch for a shape it declines', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await fetchPrehydrate('/api/flow/small-data?days=1', 'Last1', 1)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})
