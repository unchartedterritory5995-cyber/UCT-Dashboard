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
 * `/api/flow/data` is browser-cached (max-age=300), so the base can land in
 * ~50ms — BEFORE `/api/flow/version` resolves. Stamping `null` then reads as
 * "the base does not cover the current version" and triggers a full refetch;
 * on prod that produced three base fetches on a single page load. A base that
 * landed before the version was known IS current, so the first version we
 * learn is the one it represents.
 */
export function adoptVersion({ pending, dataVersion, current }) {
  if (pending && dataVersion != null) {
    return { baseFetchedVer: dataVersion, pending: false }
  }
  return { baseFetchedVer: current, pending }
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
}

/**
 * Identity for a processed dataset, so a cached `D` is only reused when the
 * filters that produced it are unchanged.
 */
export function processedKey(dateFilter, dateFrom, dateTo) {
  return `${dateFilter || ''}|${dateFrom || ''}|${dateTo || ''}`
}
