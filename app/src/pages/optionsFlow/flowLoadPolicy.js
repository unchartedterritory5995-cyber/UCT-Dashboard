/**
 * flowLoadPolicy — load/refresh decisions for the Options Flow CSV pipeline.
 *
 * Extracted as a pure module so the (large, partner-owned, inline-styled)
 * OptionsFlow.jsx keeps a minimal diff and this logic is unit-testable.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * OptionsFlow loads its dataset with TWO effects:
 *
 *   1. the BASE fetch    — `/api/flow/data?days=${fetchDays}` (version-stable)
 *   2. the DELTA merge   — `/api/flow/data?days=1&v=${dataVersion}`,
 *                          `cache:"no-store"`, splicing today's rows into a
 *                          wide range so 20d/60d/All stay live without
 *                          reloading 100k+ trades on every version bump.
 *
 * The delta is the right design for a WIDE base range. But the default view is
 * `fetchDays = 1` — and there the two requests are the SAME ONE DAY. Measured
 * on production 2026-07-25 (default view, cold):
 *
 *   base   /api/flow/data?days=1        12.7MB  2,583ms
 *   parse                                        486ms   (96,178 rows)
 *   process                                    1,420ms
 *   delta  /api/flow/data?days=1&v=N    12.7MB  2,718ms   ← identical payload
 *   parse                                        541ms
 *   process                                    1,661ms
 *   ────────────────────────────────────────────────────
 *   sidebar click → data ready                 9,505ms
 *
 * `_current_version()` in flow_router.py is a 60-SECOND time bucket, so the
 * version changes every minute and on every window focus — meaning that second
 * full pipeline re-ran continuously, not just on mount.
 *
 * `planDelta` collapses the days=1 case to a single pass, and defers the delta
 * until the base rows have actually landed (the old code fired it ~80ms after
 * mount while the base was still 2.6s out, then discarded the merge because
 * `parsedRows` was still empty — a wholly wasted 12.7MB round trip).
 */

/**
 * Decide what the delta-merge effect should do.
 *
 * Returns one of:
 *   {action:'none'}                      — nothing to do
 *   {action:'skip', mergedVer}           — already covered; record and stand down
 *   {action:'refetch-base', mergedVer}   — refresh through the base fetch (1 pass)
 *   {action:'fetch-delta'}               — genuine wide-range delta
 *
 * `mergedVer` is what the caller must write to its "last merged version" ref so
 * the effect cannot re-enter for the same version.
 */
export function planDelta({
  dataVersion,
  lastMergedVer,
  baseFetchedVer,
  baseRowCount,
  dateFrom,
  dateTo,
  loadedFetchDays,
  dataMode,
}) {
  if (dataVersion == null) return { action: 'none' }
  if (lastMergedVer === dataVersion) return { action: 'none' }
  if (dataMode === 'gex' || dataMode === 'darkpool') return { action: 'none' }

  // Ordering guard: a delta can only splice into rows that exist. Without this
  // the fetch races the base and its result is thrown away.
  if (!baseRowCount) return { action: 'none' }

  // An explicit calendar range asks the server for exact dates — the days=1
  // shortcut does not describe that request, so keep the normal delta.
  const isTodayOnly = !dateFrom && !dateTo && loadedFetchDays === 1
  if (!isTodayOnly) return { action: 'fetch-delta' }

  // Base range IS today. A delta here would re-download the same day.
  return baseFetchedVer === dataVersion
    ? { action: 'skip', mergedVer: dataVersion }
    : { action: 'refetch-base', mergedVer: dataVersion }
}

/**
 * Resolve the version a freshly-landed base fetch represents.
 *
 * `served` is the server's `X-Flow-Version` response header — the version the
 * BYTES WE ACTUALLY RECEIVED were built from. When present it is authoritative
 * and ends the guesswork.
 *
 * ── Why the guess was wrong (prod bug, 2026-07-27) ─────────────────────────
 * `/api/flow/data` is a version-STABLE URL so Cloudflare can cache it, and it
 * was served with `max-age=14400`. So the base can land in ~20ms straight from
 * the browser disk cache — BEFORE `/api/flow/version` resolves (~900ms).
 *
 * The old rule was "a base that landed before the version was known IS
 * current, so adopt the first version we learn." That is true for a FRESH
 * network fetch and FALSE for a replayed cache hit — and it stamped a stale
 * body as current. `planDelta` then compared baseFetchedVer === dataVersion,
 * saw a match, and returned {action:'skip'}. Forever.
 *
 * Observed live: the page rendered `7/24 · 862 confirmed of 21515` at 8:54 PM
 * ET on 7/27 while a no-store fetch of the SAME url returned 120,074 rows, all
 * dated 7/27. It polled /api/flow/version and still never refetched, because
 * it believed Friday's bytes were the current version.
 *
 * Trusting `served` fixes that without reintroducing the original triple-fetch
 * bug: a cache-replayed body reports its OWN (old) version -> mismatch ->
 * exactly one versioned `no-store` refetch. The `pending` inference is kept
 * only as a fallback for a response with no header (an old edge object, or a
 * proxy that strips it).
 */
export function adoptVersion({ pending, dataVersion, current, served }) {
  if (served != null && served !== '') {
    return { baseFetchedVer: String(served), pending: false }
  }
  if (pending && dataVersion != null) {
    return { baseFetchedVer: dataVersion, pending: false }
  }
  return { baseFetchedVer: current, pending }
}

/**
 * Should we re-poll /api/flow/version?
 *
 * `_current_version()` is a 60-SECOND TIME BUCKET, not a content hash — it rolls
 * whether or not any trade arrived. The interval poll was already gated to
 * market hours, but the `focus` handler was NOT: every alt-tab back to the app
 * rolled the version, which now means a full base refetch and a ~1,350ms
 * main-thread processFlowData. Observed on prod 2026-07-25 as a re-process every
 * 30-40s, indefinitely, with the market CLOSED.
 *
 * Outside the window the flow data cannot change, so the answer is simply no.
 * Inside it, rate-limit so rapid focus/blur can't thrash the tape.
 */
export function shouldFetchVersion({ inMarketWindow, visible = true, now, lastFetchAt, minGapMs = 30000 }) {
  if (!visible) return false
  if (!inMarketWindow) return false
  if (lastFetchAt != null && now - lastFetchAt < minGapMs) return false
  return true
}

/** Weekday 9:30am-4:15pm ET (the 15min grace matches the existing poll gate). */
export function inFlowMarketWindow(nowEt) {
  const day = nowEt.getDay()
  if (day === 0 || day === 6) return false
  const mins = nowEt.getHours() * 60 + nowEt.getMinutes()
  return mins >= 9 * 60 + 30 && mins <= 16 * 60 + 15
}

// ── Snapshot cache ──────────────────────────────────────────────────────────
// `parsedRows` and the processed dataset are component state, so leaving the
// page throws them away and coming back replays fetch + parse + process in
// full. That is the "3-8 seconds EVERY time I click Options Flow" complaint.
//
// One entry only. A single days=1 payload is ~96k row objects; holding two
// ranges at once would be a real memory regression, and the working set for
// "flip away and come back" is exactly one.

let _snap = null

export function snapshotKey(csvFile) {
  return String(csvFile || '')
}

export function readSnapshot(key) {
  if (!_snap || _snap.key !== key) return null
  return _snap.value
}

export function writeSnapshot(key, value) {
  // Never cache an empty result — a failed or empty load must not be served
  // back as though it were the dataset.
  if (!value || !Array.isArray(value.rows) || value.rows.length === 0) return
  _snap = { key, value }
}

export function clearSnapshots() {
  _snap = null
  _erSet = null
}

// ── Earnings-soon set ───────────────────────────────────────────────────────
// erSoonSet drives a per-row ER badge but is a DEPENDENCY of the processing
// effect, so it landing after parsedRows re-runs the whole 96k-row aggregation
// (~1,351ms). Parallelising its calendar fetches wins that race on a cold load
// — but NOT on a snapshot-hydrated return visit, where parsedRows is available
// in ~0ms and the calendar round trips can never beat it. Caching the set for
// the session makes it available synchronously on remount, so a return visit
// processes exactly once. Earnings dates don't change intraday, so one fetch
// per session is the right granularity.
let _erSet = null

export function getErCache() {
  return _erSet
}

export function setErCache(set) {
  if (set instanceof Set) _erSet = set
}

/**
 * URL for a base fetch.
 *
 * First paint uses the bare, version-STABLE URL so it can be served from a
 * shared cache. A version-driven refresh (`nonce > 0`) appends the version,
 * which is REQUIRED for correctness once Cloudflare caches this endpoint:
 * `cache:"no-store"` is only a *request* directive, and Cloudflare deliberately
 * ignores client no-cache to prevent cache-busting — so an unversioned refetch
 * would be answered from the edge with the very bytes it is trying to replace.
 * A versioned URL is a distinct cache key, so the refresh is guaranteed fresh
 * (and is itself cacheable, so one member's refresh warms it for everyone).
 */
export function baseFetchUrl(csvFile, nonce, dataVersion) {
  if (!nonce || dataVersion == null) return csvFile
  return `${csvFile}${csvFile.includes('?') ? '&' : '?'}v=${dataVersion}`
}

/**
 * Identity for a processed dataset, so a cached `D` is only reused when the
 * filters that produced it are unchanged.
 */
export function processedKey(dateFilter, dateFrom, dateTo) {
  return `${dateFilter || ''}|${dateFrom || ''}|${dateTo || ''}`
}

/**
 * Does clicking a range chip need a REFETCH, or can we filter what's loaded?
 *
 * The old rule was `days > fetchDays && fetchDays !== 0` — refetch only when
 * strictly WIDENING, and never once "All" was loaded. It assumed a wider range
 * is a superset of a narrower one, so narrowing could just slice the rows
 * already in memory.
 *
 * That assumption is false in production. FLOW_CSV_CAP_DAYS=2 means every range
 * of 2+ days returns the top FLOW_CSV_CAP_ROWS (50,000) trades BY PREMIUM
 * across the WHOLE window — not every print in it. So the wide payload is a
 * premium-filtered SAMPLE, and slicing it to one day yields that day's share of
 * a global top-50k rather than that day.
 *
 * Concretely: load "All", click "1d". No refetch fired, and the day rendered
 * from ~500 of its ~96,000 trades — while still labelled "1 trading day". The
 * surviving rows are the highest-premium ones, so every total, rank and
 * bull/bear split looked entirely plausible. flow_router's own docstring
 * documents this exact failure for the CALENDAR path ("511 rows of 128,525 for
 * 7/16") and fixed it by sending date_from/date_to; the range-CHIP path was
 * never fixed.
 *
 * So: any change of window refetches. A capped superset is not a superset.
 * The 1d view is the only uncapped one, and it cannot be narrowed further.
 */
export function shouldRefetchRange(days, fetchDays) {
  return days !== fetchDays
}

/**
 * Should we throw these bytes away WITHOUT parsing them?
 *
 * ── The waste this removes, measured on prod 2026-08-29 ────────────────────
 * `/api/flow/data` is a version-STABLE URL so Cloudflare can cache it, so the
 * bytes that come back may be an older version's. That is already handled: the
 * `X-Flow-Version` mismatch marks the base stale and `planDelta` answers
 * `refetch-base`, which on the days=1 default view re-downloads the SAME 14 MB
 * file. Correct, but the browser first spends a full parse and a full
 * `processFlowData` on the stale copy — work whose only consumer is a dataset
 * that is about to be replaced:
 *
 *     CSV parsed:              2,298 ms   <- on bytes we already know are stale
 *     processFlowData:         3,972 ms   <- on the same doomed rows
 *     Downloaded: 14,324 KB               <- the corrective refetch
 *     CSV parsed:              4,674 ms
 *     processFlowData:         6,014 ms
 *
 * The staleness is knowable from a RESPONSE HEADER, before a single row is
 * built. Deciding here instead of after the parse skips ~6 s of the member's
 * CPU on any load that lands on a stale edge copy.
 *
 * ⛔ IT MUST FIRE AT MOST ONCE. If the corrective refetch ALSO comes back
 * stale, parsing it is strictly better than an empty page — a version that
 * never catches up would otherwise loop forever, refetching and never
 * rendering. Staleness is a reason to prefer fresher bytes, never a reason to
 * show nothing.
 *
 * Returns false whenever it cannot be SURE: an absent header, an unknown
 * current version, or a skip already spent all mean "parse what you have".
 */
export function shouldSkipStaleParse({ servedVer, currentVer, alreadySkipped }) {
  if (alreadySkipped) return false
  if (servedVer == null || currentVer == null) return false
  return String(servedVer) !== String(currentVer)
}
