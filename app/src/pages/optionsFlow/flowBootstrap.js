// app/src/pages/optionsFlow/flowBootstrap.js
//
// ONE AUTHORITY over "what does the first screen actually need?"
//
// `/api/flow/aggregate` runs the browser's own `flowCompute` bundle in Node and
// returns `processFlowData`'s value VERBATIM. That function's contract includes
// its own raw inputs (`all_trades` is the full filtered row list), so the
// endpoint was never a summary — it is the whole working set. Measured on prod
// 2026-09-07: **23.83 MB**, `cf-cache-status: DYNAMIC` (the edge caches it not at
// all), 8.2 s cold / 306 ms warm.
//
// A consumption audit of OptionsFlow.jsx on the same day — every `D.*` / `FD.*`
// access classified against the tab guards, default tab `Market Read`
// (lines 4590-5945) — found:
//
//   key               size / rows        read on first paint?
//   ----------------  -----------------  ------------------------------------
//   all_trades        11.43 MB / 29,514  only to build `contractTotals` for the
//                                        single "TOP 10 FLOW PICKS" table
//   all_directional    5.01 MB / 12,893  only to build `tkMap` for that SAME table
//   WATCH              3.17 MB /  9,499  NO - Tracker/Watchlist tabs only
//   ALL_SYMS           -                 NO - Search tab only (7078, 7087)
//   UOA_TRADES         -                 NO - zero references in the entire page
//   darkPool           -                 NO - zero references in the entire page
//   TICKER_DB          2.13 MB /  1,026  yes
//   clean_confirmed    1.10 MB /  2,840  yes (the client re-filters it by cap)
//   CONV               0.61 MB /  1,098  yes (pre-tab hooks)
//   charts/totals      small             yes
//
// So ~16.4 MB of the payload is shipped to first paint to compute ONE 10-row
// table, and a further ~3.2 MB is shipped for tabs the member has not opened.
//
// ⛔ THIS MODULE DOES NOT DECIDE WHAT IS CORRECT — it decides what is DEFERRED.
// Splitting is lossless by construction: `bootstrap` and `deferred` together
// reconstitute the exact object `processFlowData` returned, key for key and
// value for value. Nothing is summarised, rounded, filtered or approximated
// here. A member who opens a deferred tab gets the identical rows they get
// today; they simply arrive when that tab is opened instead of before the page
// has painted. That property is the point, and `flowBootstrap.test.js` asserts
// it rather than trusting this paragraph.

/**
 * Keys `processFlowData` returns that the FIRST SCREEN never reads.
 *
 * ⛔ Membership here is an evidence claim about `OptionsFlow.jsx`, not a size
 * judgement. Adding a key because it is big — without tracing that no
 * first-paint path reads it — is how a fast blank screen gets shipped. Each
 * entry below is justified in the table above; re-run that classification
 * before adding another.
 *
 * ⛔ `clean_confirmed` is deliberately ABSENT despite being 1.1 MB: `FD`
 * (OptionsFlow.jsx:1516) re-filters it by cap band and re-runs `buildCharts`
 * on every load, so removing it would break the cap filter, not just defer it.
 */
export const DEFERRED_KEYS = Object.freeze([
  'all_trades',
  'all_directional',
  'WATCH',
  'ALL_SYMS',
  'UOA_TRADES',
  'darkPool',
])

const DEFERRED = new Set(DEFERRED_KEYS)

/**
 * Split one `processFlowData` result into what first paint needs and what can
 * follow. Lossless: `{...bootstrap, ...deferred}` deep-equals the input.
 *
 * Keys absent from `D` are simply absent from both halves — this never invents
 * an empty array, because a consumer distinguishing "no rows" from "not loaded
 * yet" must be able to see the difference.
 */
export function splitAggregate(D) {
  if (!D || typeof D !== 'object' || Array.isArray(D)) {
    return { bootstrap: D, deferred: null }
  }
  const bootstrap = {}
  const deferred = {}
  for (const k of Object.keys(D)) {
    if (DEFERRED.has(k)) deferred[k] = D[k]
    else bootstrap[k] = D[k]
  }
  return { bootstrap, deferred }
}

/**
 * Which deferred keys a given surface needs, so a tab fetches once for
 * everything it will read rather than once per array.
 *
 * Derived from the same audit. A surface not listed needs nothing deferred.
 */
export const DEFERRED_KEYS_BY_SURFACE = Object.freeze({
  // "TOP 10 FLOW PICKS" is the ONLY first-paint reader, and it reads both.
  marketRead: Object.freeze(['all_directional', 'all_trades']),
  leaderboard: Object.freeze(['all_directional', 'all_trades']),
  topFlow: Object.freeze(['all_trades']),
  search: Object.freeze(['all_directional', 'ALL_SYMS']),
  tracker: Object.freeze(['WATCH']),
  watchlist: Object.freeze(['WATCH', 'all_directional']),
})

/**
 * True when `D` is a bootstrap payload still missing keys the surface reads.
 * Callers use this to decide whether to fetch the deferred half — never to
 * decide whether to RENDER something reduced.
 */
export function needsDeferred(D, surface) {
  const need = DEFERRED_KEYS_BY_SURFACE[surface]
  if (!D || !need) return false
  return need.some((k) => D[k] === undefined)
}

/** Merge a deferred payload into a bootstrap one, returning a new object. */
export function mergeDeferred(bootstrap, deferred) {
  if (!deferred) return bootstrap
  if (!bootstrap) return deferred
  return { ...bootstrap, ...deferred }
}

/**
 * The transport unit: `bootstrap` plus ONE part per deferred key.
 *
 * ⛔ Deliberately NOT `{bootstrap, deferred}`. A single deferred blob would just
 * move the problem — the member would trade "download the whole tape at startup"
 * for "download most of the tape on the first tab click". Per-key parts let a
 * surface request exactly what it reads (see DEFERRED_KEYS_BY_SURFACE): the
 * Tracker asks for WATCH alone and never receives `all_trades`, and each part
 * gets its own cacheable URL rather than sharing one that changes whenever any
 * of its members do.
 *
 * A part is absent when `D` never had that key — never an empty array, so a
 * consumer can still tell "no rows" from "not fetched".
 */
export function partsFrom(D) {
  const { bootstrap, deferred } = splitAggregate(D)
  const parts = { bootstrap }
  for (const k of Object.keys(deferred || {})) parts[k] = deferred[k]
  return parts
}

/** Every part name this contract can produce. `bootstrap` first, then the rest. */
export const PART_NAMES = Object.freeze(['bootstrap', ...DEFERRED_KEYS])

/** True when `name` is a part a caller may legitimately ask for. */
export function isPartName(name) {
  return PART_NAMES.includes(name)
}
