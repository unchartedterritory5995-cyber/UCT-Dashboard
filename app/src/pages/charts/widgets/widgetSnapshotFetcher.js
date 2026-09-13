/**
 * ⛔⛔ ONE fetch-and-check for the snapshot widgets.
 *
 * ⚰️ WHY THIS EXISTS. Index and Market Context were written in the same commit,
 * by the same author, minutes apart. One checked `r.ok` before parsing and one
 * did not — and the one that did not would have spread a 500's error body, or
 * this app's SPA catch-all returning **200 HTML**, straight into the widget as
 * if it were market data. The full-suite-only rail (`jsonFetcher.test.js`)
 * caught it; the wave-scope runs were green the whole time.
 *
 * ⭐ A convention that two files must each remember is a convention that one of
 * them will forget. So there is one helper and both call it.
 * (`lesson_a_guard_repeated_is_a_guard_unproved` — delete every copy but one.)
 *
 * ⛔ AND IT FAILS HONESTLY, which is a separate property from checking:
 *
 *   · a failed fetch returns a TRUTHY marker, so a widget's empty state reads
 *     "No readings yet." instead of spinning on "Loading…" forever. This repo
 *     forbids infinite loading states, and `undefined` is how you get one.
 *   · it carries NO `_fetchedAt`. That value is the "as of" stamp a member reads
 *     off the screen, and a timestamp over data that never arrived is a lie they
 *     would act on. Absent is honest; invented is not.
 */

/** The shape a caller gets when the response was not ok, or never arrived. */
export const FAILED = { _failed: true }

export const isFailed = (d) => !!d && d._failed === true

/**
 * @param {string} url
 * @param {object} [opts]
 * @param {Function} [opts.fetchImpl] — injectable so the rail drives the REAL
 *        decision rather than a restatement of it.
 * @param {Function} [opts.now] — injectable clock, same reason.
 */
export async function fetchSnapshot(url, { fetchImpl, now } = {}) {
  const f = fetchImpl || globalThis.fetch
  const clock = now || Date.now
  let res
  try {
    res = await f(url, { credentials: 'include' })
  } catch {
    // ⛔ A transport failure is not data either. Same honest marker.
    return { ...FAILED }
  }
  if (!res || !res.ok) return { ...FAILED }
  let body
  try {
    body = await res.json()
  } catch {
    // ⛔ A 200 whose body is not JSON is the SPA catch-all's tell, and it is the
    // exact case `response.ok` alone cannot see.
    return { ...FAILED }
  }
  if (body === null || typeof body !== 'object') return { ...FAILED }
  return { ...body, _fetchedAt: clock() }
}
