/**
 * The two SWR keys the Breadth Views tab fetches, and their ONE author.
 *
 * ⛔ WHY THIS FILE EXISTS. Two lenses fetch — the Analogue Deck and Score
 * Attribution — and The Read quotes both. It is forbidden from fetching either
 * (spec §4: "The Read must never trigger a network request"), so it reads the
 * SWR cache instead, with `useSWR(key, null)`. A cache read only works on a
 * BYTE-IDENTICAL key: one extra space, a reordered param, a different default
 * and the lookup misses.
 *
 * ⭐ AND THE FAILURE IS SILENT. A missed cache key is indistinguishable from
 * "the user has not opened that lens yet" — the clause is simply absent, which
 * is the correct behaviour for the case it is NOT. Nothing turns red, nothing
 * is logged, and the feature quietly never works. So the key is built here,
 * once, and both the fetcher and the reader call the same function.
 *
 * Framework-free on purpose: `theRead.js` and its tests import this without
 * pulling React or SWR in behind it.
 */

/** The Analogue Deck's feed. `topN` is that style's `matches` option. */
export const analoguesKey = (topN) => `/api/breadth-monitor/analogues?top_n=${topN}`

/**
 * Score Attribution asks for the window the CLIENT loaded, not a fourth one
 * nobody warms — `rows.length` IS that window, clamped the way the view clamps
 * it. Kept separate from the key so The Read can be handed the same row count
 * and land on the same string.
 */
export const attributionDays = (rowCount) => Math.min(3650, Math.max(1, rowCount || 90))

/** Null when there is no session to ask about — SWR treats a null key as "do
 *  not fetch", which is what both callers want. */
export const attributionKey = (date, rowCount) =>
  (date ? `/api/breadth-monitor/score-components/${date}?days=${attributionDays(rowCount)}` : null)
