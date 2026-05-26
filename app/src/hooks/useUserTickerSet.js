// app/src/hooks/useUserTickerSet.js
//
// Returns a Set<string> of all tickers the user has flagged or added
// to any of their watchlists. Used by CatalystTable to highlight rows
// whose ticker is on the user's radar.
//
// Combines two existing data sources:
//   - useFlagged() — the flagged shadow list (localStorage + server-synced)
//   - GET /api/watchlists — all user watchlists with their items
//
// Refreshed at the same cadence as the rest of the watchlist surfaces (60s).
import { useMemo } from 'react'
import useSWR from 'swr'
import { useFlagged } from './useFlagged'

const fetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : []))

export default function useUserTickerSet() {
  const { flagged } = useFlagged()
  const { data: watchlists } = useSWR('/api/watchlists', fetcher, {
    refreshInterval: 60000,
    revalidateOnFocus: false,
  })

  return useMemo(() => {
    const s = new Set()
    for (const sym of (flagged || [])) {
      if (sym) s.add(String(sym).toUpperCase())
    }
    for (const wl of (watchlists || [])) {
      for (const item of (wl?.items || [])) {
        const sym = item?.sym || item?.ticker
        if (sym) s.add(String(sym).toUpperCase())
      }
    }
    return s
  }, [flagged, watchlists])
}
