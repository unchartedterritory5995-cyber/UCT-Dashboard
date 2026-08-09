/**
 * 🔴 A NON-OK ANSWER IS NOT DATA, AND FOUR SURFACES TREATED IT AS DATA.
 *
 * `url => fetch(url).then(r => r.json())` was copied into page after page. It
 * is fine right up until the route answers something other than 200 — and it
 * now does, because 55 routes were paywalled and a **402 answers JSON too**.
 * The body is `{"detail": "..."}`, which is a perfectly good object, so:
 *
 *   - `!data` is FALSE (an error object is truthy) → the loading branch is skipped
 *   - `data.length === 0` is `undefined === 0` → FALSE → the empty branch is skipped
 *   - `data.map(...)` / `data.slice(...)` → **TypeError, white screen**
 *
 * ⛔ SO THE GUARD CANNOT LIVE IN THE CONSUMER. `(data || []).map(...)` looks
 * like the fix and is the worse bug: it renders a paywalled page as an EMPTY
 * one. "You have no watchlists" and "you need a plan" are different sentences,
 * and only one of them is true. The check belongs at the door, which is here.
 *
 * ⭐ IT THROWS, DELIBERATELY. SWR only populates `error` if the fetcher rejects,
 * so the throw is what makes a paywall — or an outage — visible to the surface
 * instead of silently indistinguishable from an empty account. `err.status`
 * carries the code so a caller can tell 402 from 500. This is the same shape
 * `useUserDefinitions.js`, `ConciergeBox.jsx` and `ScanResults.jsx` each wrote
 * separately; this is the one copy the rest now import.
 *
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<any>} the parsed body of a 2xx response
 * @throws {Error & {status: number}} on any non-ok response
 */
export default async function jsonFetcher(url, init) {
  const r = await fetch(url, init)
  if (!r.ok) {
    const err = new Error(`${url} answered ${r.status}`)
    err.status = r.status
    throw err
  }
  return r.json()
}
