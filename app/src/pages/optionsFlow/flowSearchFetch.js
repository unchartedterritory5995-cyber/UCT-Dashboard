// Fetch the Search deep-dive product from the server, on a DEADLINE.
//
// ── WHY A DEADLINE, MEASURED ON PROD (2026-09-08, live tape) ───────────────
// The served product is enormously smaller than the raw tape it replaces, but
// only on a cache HIT. The two states are not close:
//
//   ticker  rows      cold miss    warm hit   product gz   legacy tape
//   ALIT        39      425 ms      312 ms       1.6 KB     —
//   CRWD    23,193    2,013 ms      178 ms       148 KB     —
//   AMD    151,267   10,787 ms      337 ms       136 KB     3,651 KB / 4,232 ms
//
// ⛔ A COLD MISS IS A REGRESSION. AMD's 10,787 ms is more than twice the
// legacy path's 4,232 ms, so a member must NEVER wait on one. The hit, by
// contrast, is flat at ~180-340 ms whatever the ticker's size — that is proxy
// plus transfer, not derivation. The deadline is what separates those two
// worlds: wait long enough to collect a hit, never long enough to fund a build.
//
// ⛔ ABANDONING THE REQUEST DOES NOT WASTE THE BUILD. The endpoint deliberately
// finishes a derivation whose caller has gone away and installs its cache entry
// ("a disappearing caller does not cancel the build" — api/flow_router.py). So
// a timeout here is not a loss: the FIRST search for a cold ticker pays the
// legacy cost it already paid today, and warms the entry that makes every later
// search ~300 ms. Give up early and you still get the warming.
//
// ⛔ THIS MODULE NEVER DEGRADES THE ANSWER. Every failure path returns a reason
// and NO product, so the caller runs the legacy raw-tape path, which stays
// semantically identical. There is no state in which a member sees a product
// this module was unsure about.

import { searchProductUsable, stampSearchProduct } from './flowSearchProduct'

/**
 * How long a member may wait for the server product before the legacy path
 * takes over.
 *
 * 2,500 ms is chosen from the measurement above, not from taste: a hit lands in
 * 178-337 ms with an order of magnitude of headroom, while the cheapest real
 * cold build observed (CRWD, 2,013 ms) is already close to this line and the
 * expensive one (AMD, 10,787 ms) is nowhere near it. So this admits every hit
 * and funds no build worth the name.
 *
 * It is deliberately TIGHTER than PREHYDRATE_FALLBACK_MS (3,000 ms). That
 * budget covers a first-paint product with no alternative in flight; this one
 * covers a Search whose fallback is already known to answer in ~4 s.
 */
export const SEARCH_PRODUCT_DEADLINE_MS = 2500

/** The reasons a product was not used. All of them mean "run the legacy path". */
export const SEARCH_DECLINE = Object.freeze({
  NO_SYMBOL: 'no-symbol',
  HTTP: 'http',          // 503 busy / 502 restarting / anything non-2xx
  TIMEOUT: 'timeout',
  BAD_BODY: 'bad-body',  // not JSON, or ok:false
  IDENTITY: 'identity',  // served a product for a different ticker/source/version
  SCHEMA: 'schema',      // server product shape moved ahead of this client
  ERROR: 'error',
})

/**
 * The product shape this client knows how to read.
 *
 * ⛔ Must track `_SEARCH_PRODUCT_SCHEMA` in api/flow_router.py. A deploy can put
 * a NEWER server in front of an OLDER cached bundle, so the client has to be
 * able to say "I do not understand this" and fall back, rather than read a
 * changed shape as an empty one and render a confidently wrong $0 / NEUTRAL.
 */
export const SEARCH_PRODUCT_SCHEMA = 1

export function searchProductUrl(sym, source) {
  return `/api/flow/ticker-product/${encodeURIComponent(sym)}?source=${source}`
}

/**
 * Ask the server for one ticker's Search product.
 *
 * Resolves `{ok: true, product}` ONLY when the response arrived in time, parsed,
 * and carries the identity the caller asked for. Every other outcome resolves
 * `{ok: false, reason}` — it never rejects, because a caller that has to
 * try/catch to find its fallback path will eventually forget to.
 *
 * ⛔ TWO AUTHORITIES OVER THE VERSION, AND THEY MUST AGREE. The body says what
 * the derivation was built from; `X-Flow-Version` says what the server keyed the
 * cache entry on. Reading only one leaves a stale-but-well-formed payload free
 * to validate itself, so this requires both and declines on any disagreement.
 *
 * ⛔ AN UNKNOWN IDENTITY IS NOT AGREEMENT. `searchProductUsable` requires
 * non-empty strings on both sides, so a missing version declines instead of
 * matching a missing expectation — three nulls stringify equal, and that is
 * exactly the bug class this guard exists for.
 */
export async function fetchSearchProduct(sym, source, opts = {}) {
  const symbol = (sym || '').trim().toUpperCase()
  if (!symbol) return { ok: false, reason: SEARCH_DECLINE.NO_SYMBOL }

  const src = source === 'indexes' ? 'indexes' : 'stocks'
  const deadlineMs = opts.deadlineMs == null ? SEARCH_PRODUCT_DEADLINE_MS : opts.deadlineMs
  const doFetch = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null)
  if (!doFetch) return { ok: false, reason: SEARCH_DECLINE.ERROR }

  const ctl = typeof AbortController === 'function' ? new AbortController() : null
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; if (ctl) ctl.abort() }, deadlineMs)

  try {
    const res = await doFetch(searchProductUrl(symbol, src), {
      cache: 'no-store',
      ...(ctl ? { signal: ctl.signal } : {}),
    })
    if (!res || !res.ok) return { ok: false, reason: SEARCH_DECLINE.HTTP, status: res && res.status }

    let body = null
    try {
      body = await res.json()
    } catch {
      return { ok: false, reason: SEARCH_DECLINE.BAD_BODY }
    }
    if (!body || body.ok === false || !body.product) {
      return { ok: false, reason: SEARCH_DECLINE.BAD_BODY }
    }

    // ⛔ THE IDENTITY MUST COME FROM THE SERVER AND BE COMPARED TO THE REQUEST.
    // Stamping the product with the values we ASKED for and then checking them
    // would be a guard that cannot fail — it would agree by construction and
    // wave through a product built for another ticker. So: read what the server
    // says it built, then hold it against what we wanted.
    if (body.schema !== SEARCH_PRODUCT_SCHEMA) {
      return { ok: false, reason: SEARCH_DECLINE.SCHEMA, schema: body.schema }
    }
    const header = res.headers && typeof res.headers.get === 'function'
      ? res.headers.get('X-Flow-Version')
      : null
    const served = {
      sym: typeof body.sym === 'string' ? body.sym : null,
      source: typeof body.source === 'string' ? body.source : null,
      version: body.version == null ? null : String(body.version),
    }
    // The header and the body are two authorities over one value; if they
    // disagree, something between us and the derivation rewrote a response, and
    // neither one is worth trusting.
    if (!served.version || header == null || String(header) !== served.version) {
      return { ok: false, reason: SEARCH_DECLINE.IDENTITY }
    }
    const stamped = stampSearchProduct(body.product, served)
    if (!searchProductUsable(stamped, { sym: symbol, source: src, version: served.version })) {
      return { ok: false, reason: SEARCH_DECLINE.IDENTITY }
    }
    return { ok: true, product: stamped, version: served.version }
  } catch {
    return { ok: false, reason: timedOut ? SEARCH_DECLINE.TIMEOUT : SEARCH_DECLINE.ERROR }
  } finally {
    clearTimeout(timer)
  }
}
