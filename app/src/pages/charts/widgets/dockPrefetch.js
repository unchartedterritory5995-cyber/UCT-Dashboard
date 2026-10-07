/**
 * Fetch the Company Panel's OTHER tabs the moment a symbol is opened.
 *
 * Server-side these payloads are already fast once warm (the news feed measures
 * 1-12ms, earnings 0.9ms from cache). What the member feels on a tab click is
 * the round trip, because each tab only starts its request when it mounts. So
 * the fix is not more caching -- it is asking earlier.
 *
 * Two mechanisms, because the tabs fetch two different ways:
 *   • SWR tabs  -> `preload`, which puts the request in SWR's own cache under
 *     the same key the component will use, so its first render already has data.
 *   • News      -> a plain fetch, so its first page is held here as a PROMISE
 *     and DockNews consumes it instead of issuing its own.
 *
 * ⚠️ The news entry is keyed by the exact URL DockNews builds, filters and all.
 * A prefetch under a different key is not a cache hit, it is a wasted request --
 * so the query string is built with the SAME `feedQuery` the component uses.
 *
 * Entries are single-use and dropped after being taken or on symbol change:
 * this is a head start, never a cache with its own staleness rules to reason
 * about. If a prefetch has not arrived when the tab mounts, the tab simply
 * fetches as it always did.
 */
import { preload } from 'swr'

import { feedQuery } from './newsFeedModel'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'

// TERM-033: the preload fetcher THROWS on a failed read, like the panels' own fetchers. It
// used to resolve a 502 to `null`, and SWR hands a preloaded result to the panel as its
// first answer, so a failed PREFETCH put "No earnings history" / "Ownership data is not
// available" on screen even though the panel itself had moved onto a throwing fetcher.
// A 402 stays an absent answer.
const json = (url) => sectionFetcher(url).then((d) => (d?.paywalled ? null : d))

const enc = encodeURIComponent

/** The SWR-keyed payloads, in the order a member is most likely to want them. */
export function panelKeys(sym) {
  const s = enc(sym)
  return [
    `/api/fundamentals-full/${s}`,          // Overview + Ownership
    `/api/fundamentals/${s}`,               // Overview
    `/api/earnings-intel/${s}`,             // Earnings
    `/api/fundamentals-statements/${s}`,    // Financials
    `/api/research/ownership/${s}`,         // Ownership
  ]
}

/** The exact first-page URL DockNews requests with default filters. */
export function newsKey(sym, { limit = 25 } = {}) {
  return `/api/company-news/${enc(sym)}?${feedQuery({ limit })}`
}

const newsInflight = new Map()

/** Take a prefetched news response, if one is waiting for this exact URL. */
export function takeNewsPrefetch(url) {
  const p = newsInflight.get(url)
  if (p) newsInflight.delete(url)     // single use: never serve it twice
  return p
}

export function clearNewsPrefetch() {
  newsInflight.clear()
}

/**
 * Start every panel request for `sym`. Safe to call repeatedly; SWR dedupes and
 * the news map holds one entry per URL.
 */
export function prefetchPanel(sym, { fetcher = json } = {}) {
  const s = (sym || '').trim()
  if (!s) return
  for (const key of panelKeys(s)) {
    try {
      // The panel that mounts awaits this same promise and sees its rejection; the
      // no-op handler only stops an UNTAKEN failed head start being reported as unhandled.
      preload(key, fetcher)?.catch?.(() => {})
    } catch {
      // A preload failure must never break the panel that is already rendering.
    }
  }
  const nk = newsKey(s)
  if (!newsInflight.has(nk)) {
    try {
      // Kept as the RAW response promise: DockNews needs the status code to
      // tell a membership gate (402) from an outage, which a parsed body loses.
      // TERM-033, SOFT ON PURPOSE: `null` here is a sentinel meaning "the head start did
      // not arrive", never an answer. DockNews treats it by issuing its own request, whose
      // failure renders "News is temporarily unavailable" with a Retry.
      const p = fetch(nk).catch(() => null)
      newsInflight.set(nk, p)
    } catch {
      /* ignore */
    }
  }
}
