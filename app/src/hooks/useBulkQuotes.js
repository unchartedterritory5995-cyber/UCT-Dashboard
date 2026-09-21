import useSWR from 'swr'
import { useMemo } from 'react'

// THE SORT VECTOR: whole-list quotes, slowly.
//
// ⛔ WHY THIS IS NOT `useRealtimePrices`. Virtualizing the watchlist means only the
// visible rows are streamed — that is PRESENTATION. But sorting is not: "sort
// Russell 2000 by % Change" must rank all 1,872 members, not the 40 on screen, or
// the column header silently starts lying about what it ordered. So the two needs
// are served separately:
//
//   visible rows  -> useRealtimePrices (SSE + the shared 2 s REST store)  — fast
//   whole list    -> this hook, one slow pass                             — complete
//
// The merge in Watchlists.jsx lets the fast feed win, so a row you can SEE still
// ticks at full rate; the slow pass only has to be fresh enough to order by.
//
// ⭐ CADENCE IS PINNED TO THE SERVER'S OWN CACHE. `/api/live-prices` holds both a
// whole-set and a per-ticker cache for `_CACHE_TTL = 15` seconds, so polling faster
// than that cannot return a newer number — it just re-pays the request. 15 s it is.
//
// ⚠️ This hook is meant to be called with `enabled=false` unless a sort that needs
// it is actually active. Fetching 1,872 quotes to render a list in its stored order
// would be the request storm this whole change exists to remove.

// Mirrors `_MAX_TICKERS` in api/routers/live_prices.py — the backend REJECTS an
// over-cap request with 400 rather than truncating it.
const MAX_PER_REQUEST = 250
// The server funnels uncached batches through a Semaphore(6) shared by every user.
// Firing all eight chunks of a Russell 2000 at once would occupy most of it alone.
const CONCURRENCY = 3
const POLL_MS = 15000

function chunk(list, n) {
  const out = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}

async function fetchAll(tickers) {
  const batches = chunk(tickers, MAX_PER_REQUEST)
  const merged = {}
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
      while (cursor < batches.length) {
        const batch = batches[cursor++]
        try {
          const r = await fetch(`/api/live-prices?tickers=${encodeURIComponent(batch.join(','))}`)
          if (!r.ok) continue
          const j = await r.json()
          // A chunk that fails leaves its symbols unranked rather than ranked wrong,
          // and the next pass picks them up.
          Object.assign(merged, j && typeof j === 'object' ? (j.prices || j) : {})
        } catch {
          /* keep going — a partial vector still orders most of the list */
        }
      }
    }),
  )
  return merged
}

/**
 * `{ SYM: quote }` for every ticker given, refreshed slowly.
 *
 * @param tickers  the WHOLE list's symbols
 * @param enabled  false → no request at all, and the previous result is dropped
 */
export default function useBulkQuotes(tickers, enabled) {
  const key = useMemo(() => {
    if (!enabled) return null
    const uniq = [...new Set((tickers || []).filter(Boolean))].sort()
    return uniq.length ? ['bulk-quotes', uniq.join(',')] : null
  }, [tickers, enabled])

  const { data } = useSWR(key, ([, joined]) => fetchAll(joined.split(',')), {
    refreshInterval: POLL_MS,
    revalidateOnFocus: false,
    // The set changes as the member filters; don't re-ask for a set already in hand.
    dedupingInterval: POLL_MS,
    keepPreviousData: true,
  })

  return data || EMPTY
}

const EMPTY = Object.freeze({})
