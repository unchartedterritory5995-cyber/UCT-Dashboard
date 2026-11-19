// app/src/hooks/useUserTickerSet.js
//
// Returns a Set<string> of all tickers the user has flagged or added
// to any of their watchlists. Used by CatalystTable to highlight rows
// whose ticker is on the user's radar.
//
// Combines two existing data sources:
//   - useFlagged() — the flagged shadow list (localStorage + server-synced)
//   - GET /api/watchlists?include_prebuilt=0 — the user's OWN watchlists + items
//
// ⛔ `include_prebuilt=0` is load-bearing twice over. CORRECTNESS: the admin-curated
// INDEX lists are owned by the admin account, so they come back as that user's own
// lists — and "is this ticker on your radar?" cannot be answered yes because the
// symbol is in the Russell 2000, which would light up essentially every small-cap.
// COST: this hook runs inside `LogoPrewarm` at APP ROOT, so it is on the shell path
// of EVERY page, every 60 s. Measured on prod 2026-09-07 with the prebuilt lists in:
// 33 of 34 lists, 4,725 of 4,726 items, 592 KB, 28.1 s cold / 6.6 s warm — against
// ONE real list holding ONE symbol.
//
// Refreshed at the same cadence as the rest of the watchlist surfaces (60s).
import { useMemo } from 'react'
import useSWR from 'swr'
import { useFlagged } from './useFlagged'

/** The member's OWN watchlists with their items. ONE key for the app shell (LogoPrewarm), the
 *  catalyst table's star and the Terminal's watchlist marks (components/terminal/
 *  WatchMarksProvider), so they share one SWR cache entry and one request. */
export const USER_LISTS_URL = '/api/watchlists?include_prebuilt=0'

/** The shell's fetcher for that key: a refused read answers `[]`, so a signed-out or failed read
 *  costs the marks and nothing else. */
export const userListsFetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : []))

/** Pure: the watchlist rows in whatever sits under that key. The route answers a bare array.
 *  ⚠️ The Terminal's MON panel (pages/terminal/panels/WatchlistPanel.jsx) reads the SAME key
 *  with a fetcher that stores `{ body, receivedAt }`, and SWR keeps one entry per key, so while
 *  MON is open this hook can be handed that envelope. Unwrapped here rather than read as "no
 *  watchlists". Anything else is an empty list, never a throw (see the note in the hook). */
export function userListRows(data) {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object' && Array.isArray(data.body)) return data.body
  return []
}

// `enabled` defaults to true, so every existing caller (CatalystTable,
// catalystsSection, ArticleReader) is unaffected — it exists for LogoPrewarm,
// which mounts at the app root for EVERY visitor, signed in or not, so it can
// hold off this authed-only GET until a member is actually signed in.
// `useFlagged()` already self-gates on `user` internally (null key / early
// `if (!user) return`), so it needs no change here.
export default function useUserTickerSet(enabled = true) {
  const { flagged } = useFlagged()
  const { data: watchlists } = useSWR(enabled ? USER_LISTS_URL : null, userListsFetcher, {
    refreshInterval: 60000,
    revalidateOnFocus: false,
  })

  return useMemo(() => {
    // ⛔⛔ `|| []` DOES NOT MAKE A VALUE ITERABLE. It only replaces null and
    // undefined — an OBJECT passes straight through it and `for...of` throws
    // "is not iterable". That matters far more here than it looks: `LogoPrewarm`
    // calls this hook at APP ROOT, outside any error boundary, so one unexpected
    // response shape from /api/watchlists takes down the ENTIRE app for every
    // member, on every route. Measured: it crashed five route tests at once, and
    // the failure named the pages rather than the cause.
    // ⭐ THE ENDPOINT RETURNS A LIST TODAY. This is not about doubting it — it is
    // that a proxy error page served with 200, or a future shape change, should
    // cost a warmed logo cache and nothing else.
    const flags = Array.isArray(flagged) ? flagged : []
    const lists = userListRows(watchlists)
    const s = new Set()
    for (const sym of flags) {
      if (sym) s.add(String(sym).toUpperCase())
    }
    for (const wl of lists) {
      for (const item of (wl?.items || [])) {
        const sym = item?.sym || item?.ticker
        if (sym) s.add(String(sym).toUpperCase())
      }
    }
    return s
  }, [flagged, watchlists])
}
