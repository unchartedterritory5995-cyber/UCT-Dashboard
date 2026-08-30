/**
 * flowPrehydrate — show the numbers while the tape is still being parsed.
 *
 * WHAT THE USER ACTUALLY WAITS FOR, measured on prod 2026-08-29 from the page's
 * own `[perf]` logs:
 *
 *     Downloaded:        88 ms   (14,324 KB)
 *     CSV parsed:       854 ms   (107,346 rows, worker)
 *     processFlowData: 1,617-3,433 ms
 *
 * ⭐ THE DOWNLOAD IS NOT THE PROBLEM. 14 MB in 88 ms means the wire is already
 * fast (it is served gzipped). Essentially the whole wait is arithmetic the
 * browser does on the member's own machine — and it is the SAME arithmetic for
 * every member, on the same tape, every time.
 *
 * `GET /api/flow/aggregate` does it once per data version instead. This module
 * decides whether that answer applies to the load about to happen, and fetches
 * it. The CSV still downloads and still parses: the worker has to hold the rows
 * or a range change and a ticker drill would have nothing to work from. What
 * this removes is the wait BEFORE anything appears.
 *
 * ⛔ IT IS AN ACCELERATOR, NEVER A DEPENDENCY. Every failure — 503, offline,
 * a shape the endpoint does not answer for — returns null, and the page follows
 * the path it follows today. Slower is an acceptable failure here. Wrong is not.
 */

/** Sources `/api/flow/aggregate` can answer for, mapped from the CSV base. */
const SOURCE_BY_BASE = {
  '/api/flow/data': 'stocks',
  '/api/flow/indexes-data': 'indexes',
}

/**
 * The aggregate URL for this exact load, or null to skip prehydration.
 *
 * ⛔ NULL IS THE SAFE ANSWER AND THE DEFAULT. A prehydrated view that does not
 * match what the page is about to render is worse than no prehydration at all:
 * the reader sees numbers, believes them, and they change a second later. So
 * this answers only for shapes the endpoint provably covers, and declines
 * everything else rather than approximating:
 *
 *  - `/api/flow/small-data` — the Mid-Small cap stream is a DIFFERENT dataset
 *    (uncapped small-cap rows), and the endpoint has no source for it.
 *  - `?date_from=&date_to=` — an explicit custom range. `date_filter` cannot
 *    express it, so there is nothing honest to ask for.
 *  - `?all_data=true` (fetchDays === 0) — no `days` to key the cache on.
 *  - a `dateFilter` outside the endpoint's allowlist (it mirrors the server's
 *    `valid_date_filter`, so a value this returns is a value that survives).
 */
export function prehydrateUrl(csvFile, dateFilter, dataVersion) {
  if (typeof csvFile !== 'string' || !csvFile) return null
  const [base, query = ''] = csvFile.split('?')
  const source = SOURCE_BY_BASE[base]
  if (!source) return null

  const params = new URLSearchParams(query)
  if (params.has('date_from') || params.has('date_to')) return null
  if (params.has('all_data')) return null

  const days = params.get('days')
  if (!days || !/^\d{1,4}$/.test(days) || days === '0') return null

  // Mirrors api/services/flow_aggregate.valid_date_filter. A selection the
  // server would reject falls back to the whole window THERE, which is not
  // what the page is about to render — so decline here instead of asking.
  if (dateFilter != null && !/^(All|Last\d{1,2})$/.test(dateFilter)) return null

  const out = new URLSearchParams({ source, days })
  if (dateFilter) out.set('date_filter', dateFilter)
  // Version-keyed so a redeploy or a tape bump cannot be answered from a stale
  // Cloudflare/browser copy — the same reason the CSV URL carries `v`.
  if (dataVersion != null) out.set('v', String(dataVersion))
  return `/api/flow/aggregate?${out.toString()}`
}

/**
 * Fetch the precomputed dataset. Resolves to `{ D, stats, version }` or null.
 *
 * Never throws and never rejects: the caller is on the render path and a
 * prehydration failure must be indistinguishable from not having tried.
 */
export async function fetchPrehydrate(csvFile, dateFilter, dataVersion, signal) {
  const url = prehydrateUrl(csvFile, dateFilter, dataVersion)
  if (!url) return null
  try {
    const res = await fetch(url, { signal })
    // 503 is the endpoint's own "not built yet" and is EXPECTED — a cold pod,
    // a version that just rolled. It is not an error to report anywhere.
    if (!res.ok) return null
    const body = await res.json()
    if (!body || body.ok !== true || !body.D) return null
    return {
      D: body.D,
      stats: body.stats || null,
      version: res.headers.get('X-Flow-Version'),
    }
  } catch {
    return null
  }
}
