// THE PREBUILT CATALOGUE IS A DIRECTORY. MEMBERSHIP IS FETCHED ON SELECTION.
//
// ⛔ WHAT THIS REPLACES. `GET /api/watchlists/prebuilt` used to answer with all 33
// lists AND every member of each — measured on prod 2026-09-20 at 4,704 item rows /
// 607,445 bytes — to render a picker of 33 NAMES. The picker reads `name`,
// `item_count`, `category`, `issue_date` and `alias`; it never touched `items`. The
// same request in one session ranged 172 ms warm to 9,859 ms cold, essentially all
// of it server time. Russell 2000 alone was 1,872 of those rows.
//
// Two rules keep it that way:
//
//   1. EVERY consumer of the directory imports `PREBUILT_DIRECTORY_URL` from here.
//      The slim response is only a win if nobody re-adds the full one — and a
//      second literal URL string elsewhere is also a second SWR cache key, so the
//      picker and the list view would stop sharing one request. One constant, one
//      key, one in-flight fetch no matter how many Watchlist widgets are mounted
//      (SWR's `dedupingInterval: 8000` in App.jsx does the collapsing).
//
//   2. Membership comes from `usePrebuiltMembership`, per selected list, and is
//      NOT enriched. A member gets "this list contains these symbols" without
//      waiting on a quote, a logo or a fundamental.
import useSWR from 'swr'
import { useMemo } from 'react'

/** The directory: names + counts + picker metadata, no members. */
export const PREBUILT_DIRECTORY_URL = '/api/watchlists/prebuilt?include_items=0'

/** The user's own lists as a PICKER draws them — names and counts only, and never
 *  the admin-owned index lists, which have their own tab. Both flags are the ones
 *  `list_user_watchlists` documents. */
export const PICKER_MY_LISTS_URL = '/api/watchlists?include_items=0&include_prebuilt=0'

const fetchJson = url =>
  fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null))

// How many lists may be hydrated at once. Expanding several prebuilt lists is a
// standalone-page affordance, not a widget one (a widget is pinned to exactly one),
// so this is a guard against a pathological page state, not a hot path.
const MAX_LISTS = 8
// Sequential-with-a-small-width: these are the only requests in flight at selection
// time and each is one indexed SQLite read, but a member who expands eight lists
// should not open eight sockets at once either.
const CONCURRENCY = 3

async function fetchMembership(ids) {
  const out = {}
  const queue = ids.slice(0, MAX_LISTS)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (cursor < queue.length) {
        const id = queue[cursor++]
        try {
          const wl = await fetchJson(`/api/watchlists/${encodeURIComponent(id)}?slim=1`)
          if (wl && Array.isArray(wl.items)) out[id] = wl.items
        } catch {
          /* a list that will not load simply stays empty — the row still renders
             its name and count from the directory */
        }
      }
    }),
  )
  return out
}

/**
 * `{ [listId]: items[] }` for the prebuilt lists currently open.
 *
 * Keyed on the id SET, so re-selecting a list already fetched is served from SWR's
 * cache with no request, and two widgets showing the same list share one fetch.
 */
export function usePrebuiltMembership(ids) {
  const key = useMemo(() => {
    const uniq = Array.from(new Set((ids || []).filter(Boolean))).sort()
    return uniq.length ? ['prebuilt-membership', uniq.join(',')] : null
  }, [ids])

  const { data } = useSWR(key, ([, joined]) => fetchMembership(joined.split(',')), {
    revalidateOnFocus: false,
    // Membership changes when the monthly refresh re-ranks an index. Nothing on a
    // chart session's timescale moves it, so don't re-ask on every remount.
    dedupingInterval: 300000,
  })

  return data || EMPTY
}

const EMPTY = Object.freeze({})

/**
 * The directory rows with `items` filled in for whichever lists have been hydrated.
 *
 * ⚠️ A row whose members have not arrived keeps `items: []` — NOT undefined — so
 * every existing `(wl.items || [])` reader behaves exactly as it did when the
 * directory carried members, and `item_count` still tells the truth about the list
 * while its rows are on their way.
 */
export function mergeMembership(rows, membership) {
  if (!Array.isArray(rows)) return rows
  return rows.map(wl => (
    membership[wl.id] ? { ...wl, items: membership[wl.id] } : (wl.items ? wl : { ...wl, items: [] })
  ))
}
