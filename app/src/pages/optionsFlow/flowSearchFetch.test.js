// The Search product transport: what it accepts, and everything it refuses.
//
// ⛔ THE POINT OF THIS FILE IS THE REFUSALS. A served product that is merely
// well-formed is not usable — it has to be the product for THIS ticker, THIS
// source and THIS tape version, or the Search deep dive renders another
// symbol's flow with total confidence. So every decline below is a case where
// the fetch succeeded and the answer still must not be used.
//
// ⛔ AND THE GUARD IT PINS WAS ONCE TAUTOLOGICAL. The first draft stamped the
// product with the identity it had ASKED for and then validated that stamp,
// which agrees by construction and can never fail. `declines a product built
// for a DIFFERENT ticker` is the test that fails against that version and
// passes against this one — it is the reason the file exists.
import { describe, it, expect } from 'vitest'
import {
  fetchSearchProduct, searchProductUrl, SEARCH_DECLINE,
  SEARCH_PRODUCT_SCHEMA, SEARCH_PRODUCT_DEADLINE_MS,
} from './flowSearchFetch'

/** A product shaped like the server's: exactly the two keys Search consumes. */
const PRODUCT = {
  all_directional: [{ S: 'AMD', p: 1000 }, { S: 'AMD', p: 2000 }],
  TICKER_DB: [{ s: 'AMD', n: 2 }],
}

/** A response the endpoint would actually send. Overrides let a test spoil one field. */
function res(over = {}, headerOver = {}) {
  const body = {
    ok: true, sym: 'AMD', source: 'stocks', version: '29814162',
    schema: SEARCH_PRODUCT_SCHEMA, product: PRODUCT, rows: 2,
    ...over,
  }
  const headers = { 'X-Flow-Version': '29814162', ...headerOver }
  return {
    ok: true,
    status: 200,
    headers: { get: (k) => headers[Object.keys(headers).find(h => h.toLowerCase() === k.toLowerCase())] ?? null },
    json: async () => body,
  }
}

const fetchOf = (r) => async () => (typeof r === 'function' ? r() : r)

describe('CONTROL: the happy path really produces a usable product', () => {
  it('accepts a well-formed, correctly-identified response', async () => {
    const out = await fetchSearchProduct('AMD', 'stocks', { fetchImpl: fetchOf(res()) })
    expect(out.ok).toBe(true)
    // Non-vacuity: a decline would also have `ok:false` and no product, so
    // assert the payload is genuinely populated rather than merely present.
    expect(out.product.all_directional).toHaveLength(2)
    expect(out.product.TICKER_DB).toHaveLength(1)
    expect(out.version).toBe('29814162')
  })

  it('stamps the product with the SERVER identity, so a consumer can re-check it', async () => {
    const out = await fetchSearchProduct('AMD', 'stocks', { fetchImpl: fetchOf(res()) })
    expect(out.product.sym).toBe('AMD')
    expect(out.product.source).toBe('stocks')
    expect(out.product.version).toBe('29814162')
  })

  it('builds the endpoint URL the server actually serves', () => {
    expect(searchProductUrl('AMD', 'stocks')).toBe('/api/flow/ticker-product/AMD?source=stocks')
  })
})

describe('it refuses a product that is not the one that was asked for', () => {
  // ⛔ THE REGRESSION TEST FOR THE TAUTOLOGICAL GUARD. Against a version that
  // stamps the requested identity onto whatever came back, this passes the
  // product through and the Search view renders NVDA's flow under AMD's name.
  it('declines a product built for a DIFFERENT ticker', async () => {
    const out = await fetchSearchProduct('AMD', 'stocks', {
      fetchImpl: fetchOf(res({ sym: 'NVDA' })),
    })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe(SEARCH_DECLINE.IDENTITY)
  })

  it('declines a product built from a DIFFERENT source universe', async () => {
    const out = await fetchSearchProduct('AMD', 'stocks', {
      fetchImpl: fetchOf(res({ source: 'indexes' })),
    })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe(SEARCH_DECLINE.IDENTITY)
  })

  it('declines when the header and the body disagree about the version', async () => {
    const out = await fetchSearchProduct('AMD', 'stocks', {
      fetchImpl: fetchOf(res({}, { 'X-Flow-Version': '29814999' })),
    })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe(SEARCH_DECLINE.IDENTITY)
  })

  // Three nulls stringify equal — an unknown identity must never read as agreement.
  it('declines when the version is MISSING rather than treating absence as a match', async () => {
    const out = await fetchSearchProduct('AMD', 'stocks', {
      fetchImpl: fetchOf(res({ version: null }, { 'X-Flow-Version': undefined })),
    })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe(SEARCH_DECLINE.IDENTITY)
  })

  it('declines a product whose shape moved ahead of this client', async () => {
    const out = await fetchSearchProduct('AMD', 'stocks', {
      fetchImpl: fetchOf(res({ schema: SEARCH_PRODUCT_SCHEMA + 1 })),
    })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe(SEARCH_DECLINE.SCHEMA)
  })
})

describe('every server-side refusal leaves the caller on the legacy path', () => {
  it('declines a 503 (the single-flight "busy" contract)', async () => {
    const out = await fetchSearchProduct('AMD', 'stocks', {
      fetchImpl: fetchOf({ ok: false, status: 503 }),
    })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe(SEARCH_DECLINE.HTTP)
    expect(out.status).toBe(503)
  })

  it('declines an ok:false body', async () => {
    const out = await fetchSearchProduct('AMD', 'stocks', {
      fetchImpl: fetchOf(res({ ok: false, product: null })),
    })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe(SEARCH_DECLINE.BAD_BODY)
  })

  it('declines a body that is not JSON at all', async () => {
    const out = await fetchSearchProduct('AMD', 'stocks', {
      fetchImpl: fetchOf({
        ok: true, status: 200,
        headers: { get: () => '29814162' },
        json: async () => { throw new Error('not json') },
      }),
    })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe(SEARCH_DECLINE.BAD_BODY)
  })

  it('declines an empty symbol without touching the network', async () => {
    let called = false
    const out = await fetchSearchProduct('  ', 'stocks', {
      fetchImpl: async () => { called = true; return res() },
    })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe(SEARCH_DECLINE.NO_SYMBOL)
    expect(called).toBe(false)
  })

  it('never rejects — a thrown fetch resolves to a decline', async () => {
    const out = await fetchSearchProduct('AMD', 'stocks', {
      fetchImpl: async () => { throw new Error('network down') },
    })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe(SEARCH_DECLINE.ERROR)
  })
})

describe('the deadline is what keeps a cold build off the member path', () => {
  // Measured on prod: a hit is 178-337 ms, a cold AMD build is 10,787 ms —
  // worse than the 4,232 ms legacy path this would be replacing.
  it('gives up on a slow build and reports a timeout, not an error', async () => {
    const out = await fetchSearchProduct('AMD', 'stocks', {
      deadlineMs: 20,
      fetchImpl: (url, opts) => new Promise((_resolve, reject) => {
        // Mirror what a real fetch does on abort: reject the promise.
        opts.signal.addEventListener('abort', () => reject(new Error('aborted')))
      }),
    })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe(SEARCH_DECLINE.TIMEOUT)
  })

  it('CONTROL: the same slow-fetch shape SUCCEEDS when it answers in time', async () => {
    // Without this, the timeout test above would pass against a module that
    // declines everything.
    const out = await fetchSearchProduct('AMD', 'stocks', {
      deadlineMs: 1000,
      fetchImpl: () => new Promise((resolve) => setTimeout(() => resolve(res()), 5)),
    })
    expect(out.ok).toBe(true)
    expect(out.product.TICKER_DB).toHaveLength(1)
  })

  it('the default deadline admits a measured hit and funds no measured build', () => {
    expect(SEARCH_PRODUCT_DEADLINE_MS).toBeGreaterThan(337)    // slowest observed hit
    expect(SEARCH_PRODUCT_DEADLINE_MS).toBeLessThan(4232)      // legacy path's own cost
  })
})

describe('the request carries nothing user-specific', () => {
  // ⛔ This is what makes the server entry shareable. `erSoon` is re-applied on
  // the client as an overlay; if it ever reached this URL the cache would
  // fragment per member and the whole design would be pointless.
  it('sends only ticker and source — no earnings set, no member identity', async () => {
    let seen = null
    await fetchSearchProduct('amd', 'stocks', {
      fetchImpl: async (url) => { seen = url; return res() },
    })
    expect(seen).toBe('/api/flow/ticker-product/AMD?source=stocks')
    // Stated as the invariant rather than a substring scan: `source` is the
    // ONLY query parameter, so nothing member-specific can be riding along.
    const params = [...new URL(seen, 'https://x').searchParams.keys()]
    expect(params).toEqual(['source'])
  })

  it('normalises an unknown source to stocks rather than forwarding it', async () => {
    let seen = null
    await fetchSearchProduct('AMD', 'wat', {
      fetchImpl: async (url) => { seen = url; return res() },
    })
    expect(seen).toBe('/api/flow/ticker-product/AMD?source=stocks')
  })
})
