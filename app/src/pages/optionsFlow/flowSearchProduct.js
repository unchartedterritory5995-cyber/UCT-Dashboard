// The Search deep-dive as a DERIVED SERVER PRODUCT + a client-side `er` overlay.
//
// THE DEFECT. `/api/flow/ticker/{sym}` ships a ticker's UNCAPPED history and the
// browser runs the FULL `processFlowData` over it in the worker to render ~17
// rows. Measured on prod for AMD: 3,651 KB wire, 20,252 KB decoded, 4,232 ms of
// request, then ~2 s of compute. Same class as TOP 10 before 3b: ship raw tape,
// reconstruct a small derived product in the browser.
//
// ⛔ THE ALGORITHM IS NOT REIMPLEMENTED. `processFlowData` runs unchanged; this
// module only PROJECTS its result and re-applies one user-specific field.
//
// ── The contract, and why `er` is separate ────────────────────────────────
// Search reads exactly TWO properties off the per-ticker object — every
// `_uncapped.X` access in OptionsFlow.jsx is `all_directional` or `TICKER_DB`.
//
// ⛔ SEARCH **DOES** CONSUME `er`. An earlier note in this workstream claimed it
// did not; that was wrong, and the corrected contract is the one that matters:
//
//     Search consumes `er`, but `er` is a SEPARABLE USER-SPECIFIC OVERLAY whose
//     exact existing rule can be re-applied on the client.
//
// Measured on the real tape (`searchErIndependence.test.js`): across two
// materially different earnings sets, `all_directional` differs in exactly one
// key — `er` — and `TICKER_DB` differs in exactly {er, t}, where `t` differs
// only because its nested trades carry their own `er`. Nothing else moves: no
// score, classification, mktcap, sector or ordering.
//
// And the licence this module rests on: `processFlowData(rows, null)` followed
// by re-applying the set is DEEP-EQUAL to `processFlowData(rows, set)` on the
// consumed projection. That is not an approximation — `processFlowData` treats
// a Set as the authority and sets `er = set.has(symbol)`, so re-application is
// its own rule, applied later.
//
// WHY IT MATTERS: computing server-side with `erSoon = null` makes the product
// USER-INDEPENDENT, which is what makes it cacheable at all. A per-user product
// could not share a cache entry, and the cache is the entire point.

/**
 * The only properties the Search deep dive reads off the per-ticker object.
 *
 * ⛔ Derived by grepping every `_uncapped.X` access in OptionsFlow.jsx, not by
 * judgement. A third property appearing means this list is stale and the
 * projection below has silently started dropping something a renderer reads.
 */
export const SEARCH_CONSUMED_KEYS = Object.freeze(['all_directional', 'TICKER_DB'])

/**
 * Project a full `processFlowData` result down to what Search consumes.
 *
 * Everything else that function returns — all_trades, WATCH, CONV, clean_confirmed,
 * the chart bundles, the totals — has no reader on this path and is what makes
 * the response enormous.
 *
 * Returns null for a null input so a caller can tell "not computable" from
 * "computed and empty".
 */
export function buildSearchProduct(D) {
  if (!D || typeof D !== 'object') return null
  return {
    all_directional: D.all_directional || [],
    TICKER_DB: D.TICKER_DB || [],
  }
}

/**
 * Re-apply the member's earnings-soon set to a user-independent product.
 *
 * ⛔ COPY-ON-OVERLAY, NEVER IN PLACE. The base product is shared: it is the
 * cached response for a (ticker, range, version) key and may already be held by
 * another render, another Search, or a future re-read. Mutating it would let one
 * member's earnings set leak into an object another read inherits — a
 * user-specific value contaminating a user-independent cache, which is the
 * quietest possible correctness bug. Every object this touches is rebuilt.
 *
 * ⛔ THE RULE IS `set.has(symbol)`, because that is what `processFlowData` does
 * with a Set. It is not re-derived or approximated here.
 *
 * A null/absent set means "this caller is not the authority on earnings", which
 * is exactly what `processFlowData(rows, null)` already encoded — so the base
 * product is returned untouched rather than having every flag forced false.
 */
export function applyErOverlay(product, erSet) {
  if (!product) return null
  if (!(erSet instanceof Set)) return product
  const has = (sym) => erSet.has(sym)
  return {
    all_directional: (product.all_directional || []).map((t) => ({ ...t, er: has(t.S) })),
    TICKER_DB: (product.TICKER_DB || []).map((tk) => ({
      ...tk,
      er: has(tk.s),
      // The nested trades carry their own flag; `t` is why TICKER_DB differed
      // at all between two earnings sets.
      ...(tk.t ? { t: tk.t.map((x) => ({ ...x, er: has(x.S) })) } : {}),
    })),
  }
}

/**
 * Is this served product usable for the view the client is rendering?
 *
 * ⛔ FAILS CLOSED, and the dimensions are the ones that actually change
 * `processFlowData`'s answer: the ticker, the source universe (stocks vs
 * indexes selects a different dataset), and the tape version. `erSoon` is
 * deliberately ABSENT — it is a client overlay now, and putting it in the
 * identity would re-fragment the cache per member and undo the whole point.
 *
 * ⛔ An unknown identity is not agreement: two nulls compare equal, so a missing
 * version on either side declines rather than matching.
 */
export function searchProductUsable(product, { sym, source, version } = {}) {
  if (!product || typeof product !== 'object') return false
  if (!Array.isArray(product.all_directional) || !Array.isArray(product.TICKER_DB)) return false
  const idOk = (a, b) => typeof a === 'string' && a !== '' && a === b
  if (!idOk(product.sym, sym)) return false
  if (!idOk(product.source, source)) return false
  if (!idOk(product.version, version)) return false
  return true
}

/** Stamp a product with the identity `searchProductUsable` checks. */
export function stampSearchProduct(product, { sym, source, version }) {
  if (!product) return null
  return { ...product, sym, source, version }
}
