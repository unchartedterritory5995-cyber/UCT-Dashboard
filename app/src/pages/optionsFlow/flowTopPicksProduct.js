// 3b — TOP 10 FLOW PICKS as a DERIVED SERVER PRODUCT.
//
// The browser was shipped ~1.9 MB of raw rows on every cold entry for one
// reason: `buildTopPickCandidates` needs `all_directional` (601 KB gz / 12,893
// rows) and `all_trades` (1,312 KB gz / 29,514 rows) to produce a ten-row
// table. Measured on prod 2026-09-07, that is 77% of the 2,498 KB first-paint
// payload, and it is the largest remaining cold-path cost.
//
// ⛔ THE ALGORITHM IS NOT REIMPLEMENTED. This calls the SAME
// `flowCompute.buildTopPickCandidates` the browser calls — the function that
// was lifted verbatim out of OptionsFlow.jsx and parity-proven on all eight
// variants. A Python port would put a second authority on numbers members
// trade on; a JS re-derivation here would do the same thing one language
// further along. This module only ENUMERATES and PACKAGES.
//
// ── What the client actually consumes ─────────────────────────────────────
// Read off the call site (OptionsFlow.jsx, the TOP 10 FLOW PICKS block):
//
//     const { candidates, standoutCandidates, ad } = buildTopPickCandidates(...)
//     if (!ad.length) return null;
//     … Both / Calls / Puts / Unusual / Standout filter `candidates` …
//     const picks = filtered.slice(0,10)
//
// `ad` is used for NOTHING but `ad.length`. It is a filtered subset of
// `all_directional`, so returning it over the wire would re-ship the array this
// change exists to remove. The product therefore carries `adCount` — the only
// property the renderer reads — and the client reconstructs its own guard from
// it. That is a narrowing of the transport, not of the semantics.
//
// `includeStandout` is TRUE for every variant here even though the browser
// passes it lazily. Standout is a client-side toggle that must stay instant:
// computing it on demand would mean a network request on a filter click, which
// is exactly the kind of trade this workstream refuses. It is safe to force —
// `standoutCandidates` is derived AFTER `candidates` and never mutates it
// (flowCompute.js:1957), so `includeStandout` cannot move the ranked list.
// `flowTopPicksProduct.test.js` asserts that rather than trusting this note.
//
// ── Why all eight variants, and why eight calls ───────────────────────────
// `dataMode × capFilter` = 2 × 4. Every one is reachable by a click that must
// not hit the network, so all eight ship together.
//
// ⛔ EIGHT SEPARATE CALLS, DELIBERATELY. A shared pre-pass could hoist the
// `_tabOk` filter, but `buildTopPickCandidates` filters rows BEFORE `tkMap`
// accumulates, while `tkMap` UPGRADES a ticker's mktcap when a real value
// appears — so aggregate-then-filter is NOT equivalent to filter-then-aggregate
// and silently changes cap-filter results. Two fixtures pin that. The variants
// are built once per data VERSION on the server, so the cost is paid once for
// all members rather than once per member; `flowTopPicksProduct.test.js`
// measures it instead of assuming it is small.

import { buildTopPickCandidates, freshnessFrom } from './flowCompute'

/** The two universes the page can be looking at. */
export const TOP_PICK_DATA_MODES = Object.freeze(['stocks', 'index'])

/** The four cap bands the TOP 10 chip row offers. */
export const TOP_PICK_CAP_FILTERS = Object.freeze(['All', 'Mega', 'Large', 'Mid-Small'])

/** Stable key for one (dataMode, capFilter) pair. */
export function topPickVariantKey(dataMode, capFilter) {
  return `${dataMode}|${capFilter}`
}

/** Every variant key, in a deterministic order. */
export function topPickVariantKeys() {
  const out = []
  for (const m of TOP_PICK_DATA_MODES) for (const c of TOP_PICK_CAP_FILTERS) out.push(topPickVariantKey(m, c))
  return out
}

/**
 * Drop the per-candidate `contracts` map from a served candidate.
 *
 * ⛔ MEASURED DEAD, NOT ASSUMED DEAD. On production this map is 67% of the
 * whole TOP_PICKS payload — 4,370 contract entries across the eight variants,
 * 1,305 KB decoded falling to 432 KB without it. The TOP 10 renderer reads
 * `topC` and the `topCDisplay*` scalars and NEVER `candidate.contracts`; the
 * other `.contracts` reads in OptionsFlow.jsx belong to unrelated local
 * structures (wlPopulate's `flowBy`, the Leaderboard's own tkMap).
 *
 * ⛔ RECURSIVE, because `_moreStrikes` (standout only) holds OTHER CANDIDATE
 * OBJECTS and the renderer reads `m.topC.cp/K/exp` and `m.net` on them. Strip
 * the top level alone and the nested maps — the bulk of the standout payload —
 * would ride along untouched.
 *
 * ⛔ `topC` SURVIVES. In the computation it is a REFERENCE to one entry of the
 * map being removed; JSON serialises it independently, so the contract the
 * table actually shows is unaffected.
 *
 * This projection applies to the SERVED product only. The local fallback keeps
 * computing exactly what it computes today, so a decline is byte-identical to
 * the pre-3b page.
 */
export function stripUnreadContracts(c) {
  if (!c || typeof c !== 'object') return c
  const { contracts: _drop, _moreStrikes, ...rest } = c
  if (Array.isArray(_moreStrikes)) rest._moreStrikes = _moreStrikes.map(stripUnreadContracts)
  return rest
}

/**
 * Build the full TOP 10 product for one processed dataset.
 *
 * `generation` is the content digest of the ETF/index classification the
 * variants were computed against. It is carried, never checked, here — the
 * decision to trust or decline belongs to the consumer (see
 * `topPicksUsable`), because the server cannot know what the client's
 * canonical generation is.
 *
 * Returns `null` when the dataset carries neither raw array, so a caller can
 * tell "not computable" from "computed and empty".
 */
export function buildTopPickProduct(D, { isEtfFn, generation = null } = {}) {
  if (!D || (!D.all_directional && !D.all_trades)) return null
  if (typeof isEtfFn !== 'function') {
    throw new TypeError('buildTopPickProduct: isEtfFn is required — classification is load-bearing')
  }
  const variants = {}
  for (const dataMode of TOP_PICK_DATA_MODES) {
    for (const capFilter of TOP_PICK_CAP_FILTERS) {
      const { candidates, standoutCandidates, ad } = buildTopPickCandidates(
        D.all_directional, D.all_trades,
        { dataMode, capFilter, isEtfFn, includeStandout: true },
      )
      variants[topPickVariantKey(dataMode, capFilter)] = {
        // ⛔ The `contracts` map is 67% of this payload and nothing reads it.
        candidates: candidates.map(stripUnreadContracts),
        standoutCandidates: standoutCandidates ? standoutCandidates.map(stripUnreadContracts) : null,
        // ⛔ COUNT, not the array. See the header note on `ad`.
        adCount: ad ? ad.length : 0,
      }
    }
  }
  return { generation, variants }
}

/**
 * May the client use this product?
 *
 * ⛔ THIS IS A PERMANENT GATE, NOT A MIGRATION SWITCH. The server computes the
 * picks against ITS ETF/index classification; the browser has its own, fetched
 * from `/api/ticker-types/etf-index-symbols`. Classification decides which
 * universe a ticker belongs to, so two different classifications can produce
 * two different TOP 10 lists from the same tape — silently, with no error
 * anywhere, in a table members trade on.
 *
 * The rule is deliberately strict and fails CLOSED: anything other than an
 * exact string match on a non-empty generation declines the product and leaves
 * the client on its existing path. Absent, null, empty, malformed, or merely
 * unknown are all declines — ⛔ "unknown" is NOT agreement (two nulls compare
 * equal, which is how a mismatch disguises itself as a match).
 */
export function topPicksUsable(product, canonicalGeneration) {
  if (!product || typeof product !== 'object') return false
  if (!product.variants || typeof product.variants !== 'object') return false
  const served = product.generation
  if (typeof served !== 'string' || served === '') return false
  if (typeof canonicalGeneration !== 'string' || canonicalGeneration === '') return false
  return served === canonicalGeneration
}

/**
 * Pull one variant out of a product, or null when it is absent.
 *
 * Returns the renderer's own shape (`{candidates, standoutCandidates, adCount}`)
 * so the call site reads the same whether the values came from the server or
 * from a local `buildTopPickCandidates`.
 */
export function topPickVariant(product, dataMode, capFilter) {
  if (!product || !product.variants) return null
  const v = product.variants[topPickVariantKey(dataMode, capFilter)]
  if (!v || !Array.isArray(v.candidates)) return null
  return v
}

/**
 * Restore a served variant to exactly what the client would have computed.
 *
 * ⛔ TWO FIELDS ON A CANDIDATE DEPEND ON THE CLOCK, NOT THE TAPE: `daysSince`
 * and `freshLabel`. Everything else is a pure function of the rows. When the
 * picks are computed on the server and cached per data version, those two are
 * stamped with BUILD time — so a product built at 23:50 would still say
 * "Today" the next morning, and a member would read a staleness label that is
 * a day wrong in a table they trade on. Nothing would fail; the label would
 * simply lie.
 *
 * So the server carries `lastDate` (JSON turns the Date into an ISO string) and
 * the client re-derives both fields HERE, at render time, through the same
 * `freshnessFrom` the computation itself uses. One expression, one clock, and
 * the clock is the reader's.
 *
 * `lastDate` is revived to a Date so a served candidate is shape-identical to a
 * locally computed one — OptionsFlow.jsx never reads it, but a candidate that
 * differs by type depending on its origin is the kind of difference that
 * surfaces later as a bug in whatever reads it next.
 */
export function reviveTopPickVariant(variant, now = new Date()) {
  if (!variant || !Array.isArray(variant.candidates)) return null
  const asDate = (v) => (v instanceof Date ? v : (v ? new Date(v) : null))
  // Contracts carry their OWN `lastDate` Date (flowCompute.js:1906/1911), so a
  // candidate has nested Dates as well as a top-level one. `topC` is a
  // REFERENCE to one of these entries in the local computation and a separate
  // object after JSON; structural comparison is unaffected, and reviving both
  // keeps every date-typed field a Date wherever it came from.
  const reviveContracts = (contracts) => {
    if (!contracts || typeof contracts !== 'object') return contracts
    const out = {}
    for (const k of Object.keys(contracts)) {
      const c = contracts[k]
      out[k] = c && typeof c === 'object' ? { ...c, lastDate: asDate(c.lastDate) } : c
    }
    return out
  }
  const reviveList = (list) => {
    if (!Array.isArray(list)) return list == null ? null : list
    return list.map((c) => {
      const lastDate = asDate(c.lastDate)
      const { daysSince, freshLabel } = freshnessFrom(lastDate, now)
      const out = { ...c, lastDate, daysSince, freshLabel }
      if (c.contracts) out.contracts = reviveContracts(c.contracts)
      if (c.topC && typeof c.topC === 'object') out.topC = { ...c.topC, lastDate: asDate(c.topC.lastDate) }
      return out
    })
  }
  return {
    candidates: reviveList(variant.candidates),
    standoutCandidates: reviveList(variant.standoutCandidates),
    adCount: variant.adCount,
  }
}
