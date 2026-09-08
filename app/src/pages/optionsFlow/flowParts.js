/**
 * flowParts — assemble first paint from the parts of the aggregate it actually
 * reads, instead of the whole 23.83 MB object.
 *
 * MEASURED ON PROD 2026-09-07 (gzipped, from /api/flow/aggregate-health):
 *
 *     all_trades       1,312.2 KB      bootstrap          583.4 KB
 *     all_directional    601.2 KB      WATCH              463.8 KB
 *     ALL_SYMS/UOA/darkPool  3.6 KB    whole aggregate  2,964.0 KB
 *
 * ⛔ SO THIS SLICE IS WORTH 467 KB, NOT THE ~1,900 KB THE PARTITION SUGGESTS.
 * `bootstrap + all_directional + all_trades` is 2,496.8 KB — everything it can
 * drop is WATCH plus three rounding errors. The two Market Read parts are 77% of
 * what remains, and nothing in this module can remove them: TOP 10 reads both.
 * Only moving that computation to the server (3b) does, taking first paint to the
 * 583.4 KB bootstrap. This module is the transport 3b needs, and it is honest
 * about being a 16% step rather than the headline one.
 *
 * ⛔ AN ACCELERATOR, NEVER A DEPENDENCY — the same contract flowPrehydrate
 * states, and the one Phase A proved is easy to lose. Every failure returns null
 * and the caller falls back to the tape. There are more ways to fail here than
 * with one request, so each is named rather than collapsed into a try/catch.
 */

import { prehydrateUrl } from './flowPrehydrate'

/**
 * The parts first paint needs, re-derived from the CURRENT page after Phase A.
 *
 * ⛔ NOT COPIED FROM THE SLICE-1 AUDIT. `bootstrap` now also carries
 * `stats.availableDates`, which the date-range picker depends on since the tape
 * was deferred — a dependency that did not exist when the partition was written.
 * `all_directional` + `all_trades` are the TOP 10 inputs (flowBootstrap's
 * DEFERRED_KEYS_BY_SURFACE.marketRead).
 */
export const REQUIRED_PARTS = Object.freeze(['bootstrap', 'all_directional', 'all_trades'])

/**
 * First paint when the server computes TOP 10 (3b).
 *
 * `all_directional` (601 KB gz) + `all_trades` (1,312 KB gz) were on this path
 * for ONE reader: the ten-row TOP 10 FLOW PICKS table. `TOP_PICKS` is that
 * table's inputs already reduced — 195 KB gz measured on prod. Reachability was
 * RE-DERIVED from the current page before this list was written, not copied
 * from the slice-1 audit: after 3b the remaining readers of those two arrays
 * are Top Flow (all_trades), Leaderboard + Search (all_directional) and the
 * Watchlist auto-fill action — none of them first paint, none of them the
 * default tab.
 */
export const SERVER_TOPPICKS_PARTS = Object.freeze(['bootstrap', 'TOP_PICKS'])

/**
 * What the PERMANENT fallback fetches when the server product is declined.
 *
 * ⛔ Feature-scoped on purpose. The alternative — "load the raw arrays once
 * the page settles" — would just move 1.9 MB from first paint to second, and a
 * member who never opens a raw-row feature would still pay for it.
 */
export const TOP_PICK_RAW_PARTS = Object.freeze(['all_directional', 'all_trades'])

/**
 * Parts whose body is an OBJECT rather than a bare array.
 *
 * ⛔ An explicit list, not a loosened check. Every deferred part is a slice of
 * `D` and therefore an array; accepting "array OR object" everywhere would let
 * a malformed answer merge silently. `TOP_PICKS` is a DERIVED product
 * (`{generation, variants}`), so it is named here and nowhere else.
 */
export const OBJECT_PART_NAMES = Object.freeze(['TOP_PICKS'])

/** The aggregate URL for one part, or null if the view is not answerable. */
export function partUrlFrom(baseUrl, part) {
  if (!baseUrl || typeof part !== 'string' || !part) return null
  return `${baseUrl}&part=${encodeURIComponent(part)}`
}

/**
 * Decide what a set of per-part results amounts to. PURE — no I/O, no clock.
 *
 * ⛔ SNAPSHOT CONSISTENCY IS THE WHOLE JOB. Parts are cached per (view, version)
 * and the server may serve a STALE entry when its build lock is held, so a
 * bundle can genuinely arrive as bootstrap@N + all_trades@N-1. Merging those
 * silently would render one build's totals beside another's rows — wrong in a way
 * that looks entirely plausible. The served version is on every part response
 * (X-Flow-Version), so agreement is checked, never assumed.
 *
 * Returns `{ ok: true, D, stats, version }` or `{ ok: false, reason }`.
 */
export function planBundle(results, parts = REQUIRED_PARTS) {
  if (!Array.isArray(results) || results.length === 0) {
    return { ok: false, reason: 'no-results' }
  }
  const byPart = new Map()
  for (const r of results) {
    if (r && typeof r.part === 'string' && !byPart.has(r.part)) byPart.set(r.part, r)
  }
  for (const name of parts) {
    const r = byPart.get(name)
    if (!r) return { ok: false, reason: `missing:${name}` }
    if (r.declined) return { ok: false, reason: `declined:${name}` }
    if (r.failed || r.body === undefined || r.body === null) {
      return { ok: false, reason: `failed:${name}` }
    }
  }
  // One identity for the whole bundle, or no bundle.
  const versions = new Set(parts.map((n) => String(byPart.get(n).version)))
  if (versions.size !== 1) return { ok: false, reason: 'version-mismatch' }
  const version = [...versions][0]
  // ⛔ An UNKNOWN identity is not agreement. Three parts that each failed to
  // report a version all stringify to "null" and would pass a set-size check.
  if (version === 'null' || version === 'undefined' || version === '') {
    return { ok: false, reason: 'version-unknown' }
  }

  // ⛔ A bundle need not include `bootstrap`. The 3b fallback asks for the raw
  // arrays ALONE, to merge into a `D` the page already holds — refetching the
  // 583 KB bootstrap to satisfy a shape check would spend most of what the
  // fallback is trying to avoid. When it IS requested it remains the base and
  // its shape is still checked; when it is not, the caller merges the result.
  const wantsBoot = parts.includes('bootstrap')
  let boot = null
  if (wantsBoot) {
    boot = byPart.get('bootstrap').body
    if (!boot || boot.ok !== true || !boot.D || typeof boot.D !== 'object') {
      return { ok: false, reason: 'bootstrap-shape' }
    }
  }
  const D = wantsBoot ? { ...boot.D } : {}
  for (const name of parts) {
    if (name === 'bootstrap') continue
    const body = byPart.get(name).body
    // A deferred part is a bare array; a DERIVED part is an object. Anything
    // else means the server answered with something this contract does not
    // describe — decline rather than merge.
    const wantsObject = OBJECT_PART_NAMES.includes(name)
    const shapeOk = wantsObject
      ? (body && typeof body === 'object' && !Array.isArray(body))
      : Array.isArray(body)
    if (!shapeOk) return { ok: false, reason: `shape:${name}` }
    D[name] = body
  }
  return { ok: true, D, stats: boot ? (boot.stats || null) : null, version }
}

/**
 * Which parts a second attempt should ask for, given the first attempt.
 *
 * ⛔ THE COLD BUILD IS SINGLE-FLIGHT, SO A DECLINE IS EXPECTED, NOT EXCEPTIONAL.
 * One node run produces every part, under a non-blocking lock. Fire three
 * requests at a cold cache and the first one builds while its two siblings are
 * declined — and once that build lands, the siblings are sitting in the cache.
 * So a decline is worth exactly one retry, and only when something else in the
 * bundle actually succeeded (proof a build ran rather than the endpoint being
 * down). A failure that is not a decline is not retried: it is not waiting on a
 * build, and a second identical request would only spend the bundle's clock.
 */
export function retryablePartsFrom(results) {
  if (!Array.isArray(results)) return []
  const anySucceeded = results.some((r) => r && r.body !== undefined && r.body !== null)
  if (!anySucceeded) return []
  return results.filter((r) => r && r.declined).map((r) => r.part)
}

/** Fetch one part. Never throws; every outcome is a described object. */
async function fetchPart(baseUrl, part, { fetchImpl, signal }) {
  const url = partUrlFrom(baseUrl, part)
  if (!url) return { part, failed: true, reason: 'no-url' }
  try {
    const res = await fetchImpl(url, { signal })
    // 503 is the endpoint's own "not built" — a build is in flight elsewhere.
    if (res.status === 503) return { part, declined: true }
    if (!res.ok) return { part, failed: true, reason: `status:${res.status}` }
    // ⛔ THE FALL-THROUGH TELL. An unknown part name still falls through to the
    // whole-D path, which answers 200 with the entire aggregate and sets no
    // X-Flow-Part. Merging that as if it were one part would put whole-D under
    // a key like `all_trades`. The header is what distinguishes them.
    if (res.headers.get('X-Flow-Part') !== part) {
      return { part, failed: true, reason: 'not-a-part-response' }
    }
    const version = res.headers.get('X-Flow-Version')
    const body = await res.json()
    return { part, version, body }
  } catch {
    return { part, failed: true, reason: 'threw' }
  }
}

/**
 * Fetch the required parts and assemble them, or return null.
 *
 * ⛔ ONE CLOCK FOR THE BUNDLE, NEVER ONE PER PART. Three 3-second waits in
 * series is a nine-second blank screen; the member is waiting for first paint,
 * not for a request. The deadline starts once and covers the initial fetches AND
 * the retry, so a slow bundle gives up while there is still time for the tape to
 * be useful.
 */
export async function fetchPartsBundle(csvFile, dateFilter, dataVersion, {
  deadlineMs = 3000,
  fetchImpl = (...a) => fetch(...a),
  signal,
  parts = REQUIRED_PARTS,
} = {}) {
  const base = prehydrateUrl(csvFile, dateFilter, dataVersion)
  if (!base) return null

  let expired = false
  let timer = null
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => { expired = true; resolve('deadline') }, deadlineMs)
  })
  const race = (p) => Promise.race([p, deadline])

  try {
    const first = await race(
      Promise.all(parts.map((p) => fetchPart(base, p, { fetchImpl, signal }))))
    if (expired || first === 'deadline' || !Array.isArray(first)) return null

    let results = first
    const retry = retryablePartsFrom(first)
    if (retry.length) {
      const again = await race(
        Promise.all(retry.map((p) => fetchPart(base, p, { fetchImpl, signal }))))
      if (expired || again === 'deadline' || !Array.isArray(again)) return null
      // The retry's answers REPLACE the declines they were sent for.
      const replaced = new Map(again.map((r) => [r.part, r]))
      results = first.map((r) => replaced.get(r.part) || r)
    }

    const plan = planBundle(results, parts)
    if (!plan.ok) return null
    return { D: plan.D, stats: plan.stats, version: plan.version }
  } finally {
    clearTimeout(timer)
  }
}
