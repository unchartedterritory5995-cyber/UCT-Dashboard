// TERM-033: the Dark Pool market-cap batch read, with its failure NAMED and RECOVERABLE.
//
// `DarkPool.jsx` fetches market caps in batches of 50 (`/api/schwab/mktcap-batch`). Each batch
// used to end in `.catch(() => null)`: a failed batch and a batch with no caps became the same
// `null`, its names were already marked "attempted" (so the auto-fetch effect never asked again
// for the life of the page), and the Notable Activity / Biggest Prints cap filters silently
// treated those names as having no market cap.
//
// Now a failed batch resolves to `MKTCAP_BATCH_FAILED` (frozen, no `mktcap`, so the page's merge
// loop skips it exactly as before) AND hands its symbols back: they are removed from the
// attempted set, so the next data load re-asks for them instead of leaving them blank for good.
// The failure is logged once per batch with the status or error that caused it.
//
// ⛔ PARTNER FILE, REBASE-SAFE HOOK. `DarkPool.jsx` calls
// `readMktcapBatch(base, batch, mktcapAttemptedRef.current)` in place of the inline fetch chain
// (one line). All logic and wording live here.

/** A market-cap batch that could not be read. Truthy, frozen, carries no `mktcap`. */
export const MKTCAP_BATCH_FAILED = Object.freeze({ ok: false, reason: 'mktcap-batch-read-failed' })

/** True when a batch read failed (as opposed to a batch the server answered with no caps). */
export const isMktcapBatchFailed = (d) => d === MKTCAP_BATCH_FAILED

function failed(batch, attempted, why) {
  // Hand the names back so the auto-fetch effect asks again on the next data load. A ref'd Set,
  // so this never triggers a render and cannot loop: the effect runs only when the data changes.
  if (attempted && typeof attempted.delete === 'function') batch.forEach((t) => attempted.delete(t))
  // eslint-disable-next-line no-console
  console.warn(`[DarkPool] market caps for ${batch.length} symbol(s) could not be read (${why}); they will be asked for again on the next data load`)
  return MKTCAP_BATCH_FAILED
}

/**
 * Read one batch (at most 50 symbols). Resolves the server's body, or `MKTCAP_BATCH_FAILED` on a
 * non-OK status, an unreadable body or a network error. Never rejects.
 *
 * @param {string} base API origin prefix ('' in the app)
 * @param {string[]} batch symbols in this batch
 * @param {Set<string>} [attempted] the page's attempted-set; a failed batch's names are removed
 * @param {Function} [fetchImpl]
 */
export async function readMktcapBatch(base, batch, attempted, fetchImpl) {
  const doFetch = fetchImpl || fetch
  let res
  try {
    res = await doFetch(`${base}/api/schwab/mktcap-batch?symbols=${batch.join(',')}`)
  } catch (e) {
    return failed(batch, attempted, `network: ${(e && e.message) || 'error'}`)
  }
  if (!res || !res.ok) return failed(batch, attempted, `HTTP ${res ? res.status : 'none'}`)
  try {
    const body = await res.json()
    return body && typeof body === 'object' ? body : failed(batch, attempted, 'empty body')
  } catch {
    return failed(batch, attempted, 'unreadable body')
  }
}
